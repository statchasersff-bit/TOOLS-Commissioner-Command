/**
 * ingestSleeperTrades — the Trade Review Center ingestion pipeline.
 *
 * For a league: determine which weeks to scan, pull Sleeper transactions, keep
 * only trades, and for each NEW trade normalize its assets, value them, score
 * value + risk, raise flags, persist everything, and update the manager-pair
 * aggregates. Re-ingesting an already-stored trade is a no-op unless
 * `forceRefresh` is set (which re-scores it WITHOUT disturbing commissioner
 * review decisions or double-counting manager stats).
 *
 * Nothing here writes back to Sleeper — this is read + analyze only.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  commissionerTrades,
  commissionerTradeAssets,
  commissionerTradeFlags,
} from "@shared/schema";
import {
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueTransactions,
  getNflState,
  getSleeperPlayers,
} from "./sleeperClient";
import { parseTradeTransaction } from "./parseTradeTransaction";
import { valueAssets } from "./tradeValueService";
import { scoreTrade } from "./scoreTrade";
import { generateTradeFlags } from "./generateTradeFlags";
import { generateCommissionerTradeSummary } from "./tradeSummary";
import { computeRepeatPartnerCount, recordTradeForPairs } from "./managerTradeStats";
import { detectPremiumFuturePicks } from "./helpers";
import {
  DEFAULT_TRADE_REVIEW_SETTINGS,
  type LeagueValueSettings,
  type ManagerIdentity,
  type SleeperLeagueUserLite,
  type SleeperRosterLite,
  type SleeperTransaction,
  type TradeReviewSettings,
} from "./types";

export interface IngestOptions {
  season?: string;
  weeks?: number[];
  forceRefresh?: boolean;
  settings?: TradeReviewSettings;
}

export interface IngestResult {
  success: boolean;
  leagueId: string;
  tradesFound: number;
  newTrades: number;
  updatedTrades: number;
  error?: string;
}

/** Build a roster id → manager identity map from Sleeper rosters + users. */
function resolveManagers(
  rosters: SleeperRosterLite[],
  users: SleeperLeagueUserLite[],
): ManagerIdentity[] {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  return rosters.map((r) => {
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    const teamName = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
    const managerName = u?.username || u?.display_name || `Team ${r.roster_id}`;
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id ?? null,
      managerName,
      teamName,
    };
  });
}

/** Derive value-affecting league settings from Sleeper league meta. */
function deriveValueSettings(meta: {
  settings?: Record<string, number>;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
}): { value: LeagueValueSettings; fcFormat: string } {
  const positions = meta.roster_positions ?? [];
  const qbSlots = positions.filter((p) => p === "QB").length;
  const superflex = positions.includes("SUPER_FLEX") || qbSlots >= 2;
  const tep = Number(meta.scoring_settings?.["bonus_rec_te"] ?? 0) > 0;
  const bestBall = Number(meta.settings?.["best_ball"] ?? 0) === 1;
  const starters = positions.filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI").length;
  return {
    value: { superflex, tep, bestBall, starters },
    fcFormat: superflex ? "sf" : "1qb",
  };
}

/** Whether a trade should land in the review queue based on its signals. */
function computeNeedsReview(opts: {
  riskScore: number;
  valueDiffPct: number;
  includesFutureFirst: boolean;
  repeatPartnerCount: number;
  settings: TradeReviewSettings;
}): boolean {
  return (
    opts.riskScore >= 25 ||
    opts.valueDiffPct >= opts.settings.lopsidedThresholdPct ||
    opts.includesFutureFirst ||
    opts.repeatPartnerCount >= opts.settings.repeatPartnerThreshold
  );
}

export async function ingestSleeperTradesForLeague(
  leagueId: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const settings = options.settings ?? DEFAULT_TRADE_REVIEW_SETTINGS;
  try {
    const [leagueMeta, nflState, rosters, users, players] = await Promise.all([
      getLeague(leagueId),
      getNflState(),
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
      getSleeperPlayers(),
    ]);

    const season = options.season ?? leagueMeta.season ?? nflState.season ?? "";
    const currentSeason = Number(season) || new Date().getUTCFullYear();
    const currentWeek = Number(nflState.week || nflState.display_week || 1);
    const weeksToScan =
      options.weeks ??
      Array.from({ length: Math.max(1, currentWeek) }, (_, i) => i + 1);

    const managers = resolveManagers(rosters, users);
    const { value: valueSettings, fcFormat } = deriveValueSettings(leagueMeta);

    let tradesFound = 0;
    let newTrades = 0;
    let updatedTrades = 0;

    for (const week of weeksToScan) {
      let transactions: SleeperTransaction[] = [];
      try {
        transactions = await getLeagueTransactions(leagueId, week);
      } catch (err) {
        console.warn(`[TradeReview] week ${week} transactions failed for ${leagueId}:`, err);
        continue;
      }
      const trades = transactions.filter((tx) => tx.type === "trade");
      tradesFound += trades.length;

      for (const tx of trades) {
        const outcome = await upsertTrade({
          leagueId,
          season,
          currentSeason,
          week,
          tx,
          players,
          managers,
          valueSettings,
          fcFormat,
          settings,
          forceRefresh: options.forceRefresh ?? false,
        });
        if (outcome === "new") newTrades++;
        else if (outcome === "updated") updatedTrades++;
      }
    }

    return { success: true, leagueId, tradesFound, newTrades, updatedTrades };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TradeReview] ingest failed for ${leagueId}:`, msg);
    return { success: false, leagueId, tradesFound: 0, newTrades: 0, updatedTrades: 0, error: msg };
  }
}

interface UpsertArgs {
  leagueId: string;
  season: string;
  currentSeason: number;
  week: number;
  tx: SleeperTransaction;
  players: Record<string, any>;
  managers: ManagerIdentity[];
  valueSettings: LeagueValueSettings;
  fcFormat: string;
  settings: TradeReviewSettings;
  forceRefresh: boolean;
}

async function upsertTrade(args: UpsertArgs): Promise<"new" | "updated" | "skipped"> {
  const { leagueId, season, currentSeason, week, tx, players, managers, valueSettings, fcFormat, settings, forceRefresh } = args;

  const existing = await db
    .select({ id: commissionerTrades.id })
    .from(commissionerTrades)
    .where(eq(commissionerTrades.sleeperTransactionId, tx.transaction_id))
    .limit(1);
  const alreadyStored = existing.length > 0;
  if (alreadyStored && !forceRefresh) return "skipped";

  // Parse + value assets.
  const assets = parseTradeTransaction(tx, players);
  await valueAssets(assets, { format: fcFormat, settings: valueSettings, currentSeason });

  const rosterIds = (tx.roster_ids ?? []).map(Number);
  // Repeat-partner count: for an already-stored trade we must NOT add +1 again,
  // so re-scores use the stored aggregate as-is.
  const repeatPartnerCount = alreadyStored
    ? Math.max(0, await computeRepeatPartnerCount(leagueId, rosterIds))
    : await computeRepeatPartnerCount(leagueId, rosterIds);

  const score = scoreTrade(
    assets,
    { currentSeason, repeatPartnerCount },
    valueSettings,
  );

  const flags = generateTradeFlags(assets, score, {
    currentSeason,
    repeatPartnerCount,
    settings,
  });

  const includesFutureFirst = detectPremiumFuturePicks(assets, currentSeason).length > 0;
  const needsReview = computeNeedsReview({
    riskScore: score.riskScore,
    valueDiffPct: score.valueDiffPct,
    includesFutureFirst,
    repeatPartnerCount,
    settings,
  });

  const summary = generateCommissionerTradeSummary({
    week,
    assets,
    score,
    flags,
    managers,
    includeValue: settings.showValueInPublicSummary,
  });

  if (alreadyStored && forceRefresh) {
    const tradeId = existing[0].id;
    // Re-score in place; preserve the commissioner's review_status + reviews.
    await db
      .update(commissionerTrades)
      .set({
        season,
        week,
        status: tx.status ?? null,
        createdTs: tx.created ?? null,
        statusUpdatedTs: tx.status_updated ?? null,
        rosterIds: rosterIds,
        consenterIds: (tx.consenter_ids ?? []).map(Number),
        rawTransaction: tx as any,
        totalValueByRoster: score.totalValueByRoster,
        valueDiffAbs: String(score.valueDiffAbs),
        valueDiffPct: String(score.valueDiffPct),
        riskScore: score.riskScore,
        fairnessScore: score.fairnessScore,
        summary,
        updatedAt: new Date(),
      })
      .where(eq(commissionerTrades.id, tradeId));
    // Replace derived rows (assets + flags) only.
    await db.delete(commissionerTradeAssets).where(eq(commissionerTradeAssets.tradeId, tradeId));
    await db.delete(commissionerTradeFlags).where(eq(commissionerTradeFlags.tradeId, tradeId));
    await insertAssetsAndFlags(tradeId, leagueId, assets, flags);
    return "updated";
  }

  // Brand new trade.
  const inserted = await db
    .insert(commissionerTrades)
    .values({
      leagueId,
      sleeperTransactionId: tx.transaction_id,
      season,
      week,
      status: tx.status ?? null,
      type: "trade",
      createdTs: tx.created ?? null,
      statusUpdatedTs: tx.status_updated ?? null,
      rosterIds: rosterIds,
      consenterIds: (tx.consenter_ids ?? []).map(Number),
      rawTransaction: tx as any,
      totalValueByRoster: score.totalValueByRoster,
      valueDiffAbs: String(score.valueDiffAbs),
      valueDiffPct: String(score.valueDiffPct),
      riskScore: score.riskScore,
      fairnessScore: score.fairnessScore,
      reviewStatus: needsReview ? "unreviewed" : "no_action",
      summary,
    })
    .onConflictDoNothing({ target: commissionerTrades.sleeperTransactionId })
    .returning({ id: commissionerTrades.id });

  // A concurrent ingest may have inserted it first (onConflictDoNothing → empty).
  if (inserted.length === 0) return "skipped";
  const tradeId = inserted[0].id;

  await insertAssetsAndFlags(tradeId, leagueId, assets, flags);

  // Update manager-pair aggregates ONLY for genuinely new trades.
  const valueMoved = Object.values(score.totalValueByRoster).reduce((s, v) => s + v, 0);
  await recordTradeForPairs({
    leagueId,
    rosterIds,
    tradeTs: tx.status_updated ?? tx.created ?? null,
    valueMoved,
    valueDiffPct: score.valueDiffPct,
  });

  return "new";
}

async function insertAssetsAndFlags(
  tradeId: number,
  leagueId: string,
  assets: ReturnType<typeof parseTradeTransaction>,
  flags: ReturnType<typeof generateTradeFlags>,
): Promise<void> {
  if (assets.length > 0) {
    await db.insert(commissionerTradeAssets).values(
      assets.map((a) => ({
        tradeId,
        leagueId,
        assetType: a.assetType,
        playerId: a.playerId ?? null,
        playerName: a.playerName ?? null,
        position: a.position ?? null,
        team: a.team ?? null,
        pickSeason: a.pickSeason ?? null,
        pickRound: a.pickRound ?? null,
        pickOriginalRosterId: a.pickOriginalRosterId ?? null,
        faabAmount: a.faabAmount != null ? String(a.faabAmount) : null,
        fromRosterId: a.fromRosterId ?? null,
        toRosterId: a.toRosterId ?? null,
        assetValue: a.assetValue != null ? String(a.assetValue) : "0",
        assetValueSource: a.assetValueSource ?? null,
      })),
    );
  }
  if (flags.length > 0) {
    await db.insert(commissionerTradeFlags).values(
      flags.map((f) => ({
        tradeId,
        flagType: f.flagType,
        severity: f.severity,
        title: f.title,
        description: f.description,
      })),
    );
  }
}
