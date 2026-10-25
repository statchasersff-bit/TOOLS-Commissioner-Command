/**
 * Collusion Risk Check — a read-only forensic scan of two Sleeper managers.
 *
 * IMPORTANT FRAMING: this surfaces SIGNALS, never verdicts. It identifies
 * unusual trade and shared-league patterns that may warrant commissioner
 * review. It never determines intent or "proves" collusion. All copy and labels
 * stay neutral (Low Risk / Watchlist / Moderate Concern / High Concern).
 *
 * It reuses the Trade Review Center pipeline (parse → value → score → flag) but
 * runs entirely in-memory against live Sleeper data — it does NOT persist
 * anything, so it works for any two users across any shared leagues, not just
 * leagues the commissioner has ingested.
 */
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  getSleeperPlayers,
  type SleeperLeagueSummary,
} from "../../sleeper";
import {
  getNflState,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueTransactions,
} from "./sleeperClient";
import { parseTradeTransaction } from "./parseTradeTransaction";
import { valueAssets, buildValuationContext } from "./tradeValueService";
import { scoreTrade } from "./scoreTrade";
import { generateTradeFlags } from "./generateTradeFlags";
import { deriveValueSettings } from "./ingestSleeperTrades";
import { detectPremiumFuturePicks } from "./helpers";
import {
  DEFAULT_TRADE_REVIEW_SETTINGS,
  type ParsedTradeAsset,
  type SleeperRosterLite,
  type SleeperLeagueUserLite,
  type SleeperTransaction,
  type TradeFlag,
} from "./types";
import type { ValuationContext } from "./tradeValue";

// ── Public result shape ───────────────────────────────────────────────────────

export interface CollusionUser {
  username: string;
  displayName: string;
  userId: string;
  avatar: string | null;
}

export interface CollusionTradeAsset {
  assetType: "player" | "pick" | "faab";
  playerName?: string | null;
  position?: string | null;
  team?: string | null;
  pickSeason?: string | null;
  pickRound?: number | null;
  faabAmount?: number | null;
  fromRosterId?: number | null;
  toRosterId?: number | null;
  assetValue: number;
}

export interface CollusionTrade {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  week: number;
  createdTs: number | null;
  statusUpdatedTs: number | null;
  rosterIds: number[];
  rosterNames: Record<number, string>;
  rosterIdA: number;
  rosterIdB: number;
  totalValueByRoster: Record<string, number>;
  aReceivedValue: number;
  bReceivedValue: number;
  valueGapAbs: number;
  valueGapPct: number;
  winner: "A" | "B" | "even";
  riskScore: number;
  fairnessScore: number;
  isMultiTeam: boolean;
  assets: CollusionTradeAsset[];
  flags: TradeFlag[];
  /** "deadline" | "playoffs" | null — timing context relative to league settings. */
  timing: "deadline" | "playoffs" | null;
  /** A future 1st-round pick moved to the side that won the trade. */
  premiumToWinner: boolean;
}

export interface SharedLeagueRow {
  leagueId: string;
  leagueName: string;
  format: string;
  /** DYNASTY | KEEPER | REDRAFT */
  leagueType: string;
  userATeam: string;
  userBTeam: string;
  tradesBetween: number;
  flags: number;
  status: string;
  /** Seasons of this league (lineage) that were scanned, newest first. */
  seasonsScanned: string[];
}

export interface PatternFlag {
  key: string;
  title: string;
  description: string;
  severity: "info" | "low" | "medium" | "high";
}

export interface ScoreComponent {
  label: string;
  weight: number;
  score: number;
}

export interface CollusionResult {
  userA: CollusionUser;
  userB: CollusionUser;
  riskScore: number;
  riskLabel: string;
  evidenceStrength: number;
  sharedLeaguesCount: number;
  tradesTogether: number;
  flaggedTrades: number;
  valueFlow: { aGained: number; bGained: number; net: number; netSide: "A" | "B" | "even" };
  lastTrade: { week: number; season: string } | null;
  sharedLeagues: SharedLeagueRow[];
  trades: CollusionTrade[];
  patternFlags: PatternFlag[];
  scoreBreakdown: ScoreComponent[];
  activity: { aTotalTrades: number; bTotalTrades: number; aWithB: number; scope: string };
  scannedSeasons: string[];
}

// ── Tuning ──────────────────────────────────────────────────────────────────

const MAX_SEASONS = 4; // current + 3 prior seasons of history per league lineage
const MAX_LEAGUE_INSTANCES = 24; // cap the live scan so the request stays bounded
const INSTANCE_CONCURRENCY = 4; // league-instances scanned at once (Sleeper-friendly)
const SCAN_WEEKS = 18; // Sleeper logs trades by week; cover a full season

/** Run an async map with bounded concurrency to stay friendly to Sleeper. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const WEIGHTS = {
  sharedLeaguePattern: 0.15,
  tradeFrequency: 0.15,
  valueImbalance: 0.25,
  oneDirectionalFlow: 0.2,
  suspiciousTiming: 0.1,
  premiumAssetRisk: 0.1,
  activityPattern: 0.05,
} as const;

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Neutral, escalating labels — never an accusation. */
function collusionLabel(score: number): string {
  if (score >= 75) return "High Concern";
  if (score >= 50) return "Moderate Concern";
  if (score >= 25) return "Watchlist";
  return "Low Risk";
}

function teamNameFor(
  rosterId: number,
  rosters: SleeperRosterLite[],
  usersById: Map<string, SleeperLeagueUserLite>,
): string {
  const roster = rosters.find((r) => r.roster_id === rosterId);
  const u = roster?.owner_id ? usersById.get(roster.owner_id) : undefined;
  return u?.metadata?.team_name || u?.display_name || u?.username || `Team ${rosterId}`;
}

/** One season-instance of a shared league, scanned for trades + activity. */
interface InstanceScan {
  leagueId: string;
  /** Prior-season instance id (for grouping seasons of the same league). */
  previousLeagueId: string | null;
  season: string;
  leagueName: string;
  format: string;
  leagueType: string;
  status: string;
  userATeam: string;
  userBTeam: string;
  trades: CollusionTrade[];
  flagged: number;
  /** Activity tallies WITHIN this instance (trades involving each user). */
  aTotalTrades: number;
  bTotalTrades: number;
  aWithB: number;
}

/** Scan one season-instance of a shared league for A↔B trades + activity. */
async function scanInstance(
  league: SleeperLeagueSummary,
  userAId: string,
  userBId: string,
  players: Record<string, any>,
  ctxByFormat: Map<string, Promise<ValuationContext>>,
): Promise<InstanceScan | null> {
  const [meta, rosters, users] = await Promise.all([
    getLeague(league.leagueId),
    getLeagueRosters(league.leagueId),
    getLeagueUsers(league.leagueId),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rosterA = rosters.find((r) => r.owner_id === userAId)?.roster_id;
  const rosterB = rosters.find((r) => r.owner_id === userBId)?.roster_id;
  if (rosterA == null || rosterB == null) return null; // not both present this season

  const { value: valueSettings, fcFormat } = deriveValueSettings(meta);
  if (!ctxByFormat.has(fcFormat)) {
    ctxByFormat.set(fcFormat, buildValuationContext(fcFormat, valueSettings));
  }
  const ctx = await ctxByFormat.get(fcFormat)!;

  const currentSeason = Number(league.season) || new Date().getUTCFullYear();
  const tradeDeadline = Number(meta.settings?.["trade_deadline"] ?? 0);
  const playoffStart = Number(meta.settings?.["playoff_week_start"] ?? 0);

  // Pull every week's transactions in parallel; Sleeper returns [] for empties.
  const weekTx = await Promise.all(
    Array.from({ length: SCAN_WEEKS }, (_, i) => i + 1).map(async (week) => {
      try {
        const txs = await getLeagueTransactions(league.leagueId, week);
        return { week, txs };
      } catch {
        return { week, txs: [] as SleeperTransaction[] };
      }
    }),
  );

  let aTotalTrades = 0;
  let bTotalTrades = 0;
  let aWithB = 0;
  const trades: CollusionTrade[] = [];

  for (const { week, txs } of weekTx) {
    for (const tx of txs) {
      if (tx.type !== "trade") continue;
      const rosterIds = (tx.roster_ids ?? []).map(Number);
      const hasA = rosterIds.includes(rosterA);
      const hasB = rosterIds.includes(rosterB);
      if (hasA) aTotalTrades++;
      if (hasB) bTotalTrades++;
      if (!(hasA && hasB)) continue;
      aWithB++;

      const assets = parseTradeTransaction(tx, players);
      await valueAssets(assets, { format: fcFormat, settings: valueSettings, currentSeason });
      const score = scoreTrade(assets, { currentSeason, repeatPartnerCount: 0, valuationCtx: ctx }, valueSettings);
      // Per-trade flags reuse the review pipeline; repeat-partner is surfaced at
      // the case-file level instead, so we pass 0 here to avoid double-counting.
      const flags = generateTradeFlags(assets, score, {
        currentSeason,
        repeatPartnerCount: 0,
        settings: DEFAULT_TRADE_REVIEW_SETTINGS,
      });

      const aReceivedValue = score.totalValueByRoster[String(rosterA)] ?? 0;
      const bReceivedValue = score.totalValueByRoster[String(rosterB)] ?? 0;
      const valueGapAbs = Math.abs(aReceivedValue - bReceivedValue);
      const denom = Math.max(aReceivedValue, bReceivedValue, 1);
      const valueGapPct = Math.round((valueGapAbs / denom) * 1000) / 10;
      const winner: "A" | "B" | "even" =
        aReceivedValue > bReceivedValue ? "A" : bReceivedValue > aReceivedValue ? "B" : "even";

      const rosterNames: Record<number, string> = {};
      for (const rid of rosterIds) rosterNames[rid] = teamNameFor(rid, rosters, usersById);

      // Premium future-1st movement toward the winning side.
      const futureFirsts = detectPremiumFuturePicks(assets, currentSeason);
      const winnerRoster = winner === "A" ? rosterA : winner === "B" ? rosterB : null;
      const premiumToWinner =
        winnerRoster != null && futureFirsts.some((p) => p.toRosterId === winnerRoster);

      let timing: "deadline" | "playoffs" | null = null;
      if (playoffStart > 0 && week >= playoffStart) timing = "playoffs";
      else if (tradeDeadline > 0 && week >= tradeDeadline - 1 && week <= tradeDeadline) timing = "deadline";

      trades.push({
        id: tx.transaction_id,
        leagueId: league.leagueId,
        leagueName: league.name,
        season: league.season,
        week,
        createdTs: tx.created ?? null,
        statusUpdatedTs: tx.status_updated ?? null,
        rosterIds,
        rosterNames,
        rosterIdA: rosterA,
        rosterIdB: rosterB,
        totalValueByRoster: score.totalValueByRoster,
        aReceivedValue: Math.round(aReceivedValue),
        bReceivedValue: Math.round(bReceivedValue),
        valueGapAbs: Math.round(valueGapAbs),
        valueGapPct,
        winner,
        riskScore: score.riskScore,
        fairnessScore: score.fairnessScore,
        isMultiTeam: rosterIds.length > 2,
        assets: assets.map(shapeAsset),
        flags,
        timing,
        premiumToWinner,
      });
    }
  }

  const flagged = trades.filter((t) => t.flags.some((f) => f.severity !== "info")).length;

  return {
    leagueId: league.leagueId,
    previousLeagueId: meta.previous_league_id ?? null,
    season: league.season,
    leagueName: league.name,
    format: league.format,
    leagueType: league.type,
    status: league.status,
    userATeam: teamNameFor(rosterA, rosters, usersById),
    userBTeam: teamNameFor(rosterB, rosters, usersById),
    trades,
    flagged,
    aTotalTrades,
    bTotalTrades,
    aWithB,
  };
}

function shapeAsset(a: ParsedTradeAsset): CollusionTradeAsset {
  return {
    assetType: a.assetType,
    playerName: a.playerName ?? null,
    position: a.position ?? null,
    team: a.team ?? null,
    pickSeason: a.pickSeason ?? null,
    pickRound: a.pickRound ?? null,
    faabAmount: a.faabAmount ?? null,
    fromRosterId: a.fromRosterId ?? null,
    toRosterId: a.toRosterId ?? null,
    assetValue: Math.round(a.assetValue ?? 0),
  };
}

// ── Scoring + pattern flags ────────────────────────────────────────────────

function buildScore(args: {
  sharedLeaguesCount: number;
  leaguesWithTrades: number;
  tradesTogether: number;
  avgGapPct: number;
  aWins: number;
  bWins: number;
  netRatio: number;
  timedTrades: number;
  premiumOneSideMax: number;
  activityConcentration: number;
}): ScoreComponent[] {
  const n = args.tradesTogether;

  const sharedLeaguePattern = clamp100(
    args.leaguesWithTrades * 35 + Math.min(15, args.sharedLeaguesCount * 2),
  );
  const tradeFrequency = clamp100(n * 16);
  const valueImbalance = clamp100(args.avgGapPct * 2.2);

  const directionRatio = n > 0 ? Math.max(args.aWins, args.bWins) / n : 0;
  const oneDirectionalFlowRaw = directionRatio * 70 + Math.min(60, args.netRatio * 100 * 0.6);
  const oneDirectionalFlow = clamp100(n >= 2 ? oneDirectionalFlowRaw : oneDirectionalFlowRaw * 0.4);

  const suspiciousTiming = n > 0 ? clamp100((args.timedTrades / n) * 100) : 0;
  const premiumAssetRisk = clamp100(args.premiumOneSideMax * 40);
  const activityPattern = clamp100(args.activityConcentration * 100);

  return [
    { label: "Shared League Pattern", weight: WEIGHTS.sharedLeaguePattern, score: sharedLeaguePattern },
    { label: "Trade Frequency", weight: WEIGHTS.tradeFrequency, score: tradeFrequency },
    { label: "Value Imbalance", weight: WEIGHTS.valueImbalance, score: valueImbalance },
    { label: "One-Directional Value Flow", weight: WEIGHTS.oneDirectionalFlow, score: oneDirectionalFlow },
    { label: "Suspicious Timing", weight: WEIGHTS.suspiciousTiming, score: suspiciousTiming },
    { label: "Future Pick / Premium Asset Risk", weight: WEIGHTS.premiumAssetRisk, score: premiumAssetRisk },
    { label: "Activity Pattern", weight: WEIGHTS.activityPattern, score: activityPattern },
  ];
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function runCollusionRiskCheck(
  usernameA: string,
  usernameB: string,
): Promise<CollusionResult> {
  const [userARaw, userBRaw] = await Promise.all([
    fetchSleeperUser(usernameA.trim()),
    fetchSleeperUser(usernameB.trim()),
  ]);
  if (userARaw.userId === userBRaw.userId) {
    throw new Error("Enter two different Sleeper users.");
  }

  const nfl = await getNflState();
  const currentSeasonNum = Number(nfl.season) || new Date().getUTCFullYear();
  const seasons = Array.from({ length: MAX_SEASONS }, (_, i) => String(currentSeasonNum - i));

  const userA: CollusionUser = { ...userARaw };
  const userB: CollusionUser = { ...userBRaw };

  // Shared league instances per season (ALL league types — dynasty, keeper,
  // redraft), then dedupe by league id across seasons.
  const sharedPerSeason = await Promise.all(
    seasons.map(async (s) => {
      try {
        const [la, lb] = await Promise.all([
          fetchSleeperLeagues(userARaw.userId, s, { includeAllTypes: true }),
          fetchSleeperLeagues(userBRaw.userId, s, { includeAllTypes: true }),
        ]);
        const bIds = new Set(lb.map((l) => l.leagueId));
        return la.filter((l) => bIds.has(l.leagueId));
      } catch {
        return [] as SleeperLeagueSummary[];
      }
    }),
  );
  const instances: SleeperLeagueSummary[] = [];
  const seenIds = new Set<string>();
  for (const arr of sharedPerSeason) {
    for (const l of arr) {
      if (seenIds.has(l.leagueId)) continue;
      seenIds.add(l.leagueId);
      instances.push(l);
    }
  }
  const capped = instances.slice(0, MAX_LEAGUE_INSTANCES);

  if (capped.length === 0) {
    return emptyResult(userA, userB, seasons);
  }

  const players = await getSleeperPlayers();
  const ctxByFormat = new Map<string, Promise<ValuationContext>>();

  const scans = (
    await mapLimit(capped, INSTANCE_CONCURRENCY, (l) =>
      scanInstance(l, userARaw.userId, userBRaw.userId, players, ctxByFormat).catch(() => null),
    )
  ).filter((s): s is InstanceScan => s != null);

  // Group season-instances into league lineages via previous_league_id, so the
  // same league across multiple seasons collapses into one shared-league row.
  const scanById = new Map(scans.map((s) => [s.leagueId, s]));
  const lineageRootId = (s: InstanceScan): string => {
    let cur = s;
    const guard = new Set<string>();
    while (cur.previousLeagueId && scanById.has(cur.previousLeagueId) && !guard.has(cur.leagueId)) {
      guard.add(cur.leagueId);
      cur = scanById.get(cur.previousLeagueId)!;
    }
    return cur.leagueId;
  };
  const lineages = new Map<string, InstanceScan[]>();
  for (const s of scans) {
    const root = lineageRootId(s);
    const group = lineages.get(root);
    if (group) group.push(s);
    else lineages.set(root, [s]);
  }

  const sharedLeagues: SharedLeagueRow[] = [];
  for (const insts of Array.from(lineages.values())) {
    const ordered = [...insts].sort((a, b) => Number(b.season) - Number(a.season));
    const top = ordered[0];
    sharedLeagues.push({
      leagueId: top.leagueId,
      leagueName: top.leagueName,
      format: top.format,
      leagueType: top.leagueType,
      userATeam: top.userATeam,
      userBTeam: top.userBTeam,
      tradesBetween: insts.reduce((sum, i) => sum + i.trades.length, 0),
      flags: insts.reduce((sum, i) => sum + i.flagged, 0),
      status: top.status,
      seasonsScanned: ordered.map((i) => i.season),
    });
  }
  sharedLeagues.sort((a, b) => b.tradesBetween - a.tradesBetween);

  const sharedLeaguesCount = sharedLeagues.length;
  const scannedSeasons = Array.from(new Set(capped.map((l) => l.season))).sort(
    (a, b) => Number(b) - Number(a),
  );

  const trades = scans
    .flatMap((s) => s.trades)
    .sort((a, b) => (b.createdTs ?? 0) - (a.createdTs ?? 0));

  // ── Aggregate signals ──────────────────────────────────────────────────────
  const tradesTogether = trades.length;
  const flaggedTrades = trades.filter((t) => t.flags.some((f) => f.severity !== "info")).length;
  const aGained = trades.reduce((s, t) => s + t.aReceivedValue, 0);
  const bGained = trades.reduce((s, t) => s + t.bReceivedValue, 0);
  const net = aGained - bGained;
  const netSide: "A" | "B" | "even" = net > 0 ? "A" : net < 0 ? "B" : "even";
  const aWins = trades.filter((t) => t.winner === "A").length;
  const bWins = trades.filter((t) => t.winner === "B").length;
  const avgGapPct = tradesTogether > 0 ? trades.reduce((s, t) => s + t.valueGapPct, 0) / tradesTogether : 0;
  const timedTrades = trades.filter((t) => t.timing != null).length;
  const netRatio = aGained + bGained > 0 ? Math.abs(net) / (aGained + bGained) : 0;

  // Premium future-1st direction: count toward each user.
  let premiumToA = 0;
  let premiumToB = 0;
  for (const t of trades) {
    for (const a of t.assets) {
      const isFutureFirst =
        a.assetType === "pick" && a.pickRound === 1 && Number(a.pickSeason) > Number(t.season);
      if (!isFutureFirst) continue;
      if (a.toRosterId === t.rosterIdA) premiumToA++;
      else if (a.toRosterId === t.rosterIdB) premiumToB++;
    }
  }
  const premiumOneSideMax = Math.max(premiumToA, premiumToB);

  const aTotalTrades = scans.reduce((s, sc) => s + sc.aTotalTrades, 0);
  const bTotalTrades = scans.reduce((s, sc) => s + sc.bTotalTrades, 0);
  const aWithB = tradesTogether; // by construction, trades involving both
  const activityConcentration = Math.max(
    aTotalTrades > 0 ? aWithB / aTotalTrades : 0,
    bTotalTrades > 0 ? aWithB / bTotalTrades : 0,
  );

  const leaguesWithTrades = sharedLeagues.filter((l) => l.tradesBetween > 0).length;

  const scoreBreakdown = buildScore({
    sharedLeaguesCount,
    leaguesWithTrades,
    tradesTogether,
    avgGapPct,
    aWins,
    bWins,
    netRatio,
    timedTrades,
    premiumOneSideMax,
    activityConcentration,
  });
  const riskScore = clamp100(scoreBreakdown.reduce((s, c) => s + c.score * c.weight, 0));

  const patternFlags = buildPatternFlags({
    userA,
    userB,
    tradesTogether,
    leaguesWithTrades,
    sharedLeaguesCount,
    aWins,
    bWins,
    netSide,
    net,
    timedTrades,
    premiumToA,
    premiumToB,
    aTotalTrades,
    bTotalTrades,
    aWithB,
  });

  const lastTrade = trades.length
    ? { week: trades[0].week, season: trades[0].season }
    : null;

  return {
    userA,
    userB,
    riskScore,
    riskLabel: collusionLabel(riskScore),
    evidenceStrength: riskScore,
    sharedLeaguesCount,
    tradesTogether,
    flaggedTrades,
    valueFlow: { aGained: Math.round(aGained), bGained: Math.round(bGained), net: Math.round(net), netSide },
    lastTrade,
    sharedLeagues,
    trades,
    patternFlags,
    scoreBreakdown,
    activity: {
      aTotalTrades,
      bTotalTrades,
      aWithB,
      scope: `within shared leagues across ${scannedSeasons.length} season${scannedSeasons.length === 1 ? "" : "s"}`,
    },
    scannedSeasons,
  };
}

function buildPatternFlags(a: {
  userA: CollusionUser;
  userB: CollusionUser;
  tradesTogether: number;
  leaguesWithTrades: number;
  sharedLeaguesCount: number;
  aWins: number;
  bWins: number;
  netSide: "A" | "B" | "even";
  net: number;
  timedTrades: number;
  premiumToA: number;
  premiumToB: number;
  aTotalTrades: number;
  bTotalTrades: number;
  aWithB: number;
}): PatternFlag[] {
  const flags: PatternFlag[] = [];
  const nameA = a.userA.displayName;
  const nameB = a.userB.displayName;
  const n = a.tradesTogether;

  if (n >= 3) {
    flags.push({
      key: "repeat_partner",
      title: "Repeated Trade Partner",
      description: `These two managers have traded with each other ${n} time${n === 1 ? "" : "s"} across ${a.leaguesWithTrades} shared league${a.leaguesWithTrades === 1 ? "" : "s"}.`,
      severity: n >= 5 ? "high" : "medium",
    });
  }

  const maxWins = Math.max(a.aWins, a.bWins);
  if (n >= 3 && maxWins / n >= 0.7) {
    const winner = a.aWins >= a.bWins ? nameA : nameB;
    flags.push({
      key: "one_directional",
      title: "One-Directional Value Flow",
      description: `${winner} has gained estimated value in ${maxWins} of ${n} trades between these two managers.`,
      severity: maxWins / n >= 0.85 ? "high" : "medium",
    });
  }

  if (a.timedTrades > 0) {
    flags.push({
      key: "timing",
      title: "Deadline / Playoff Timing",
      description: `${a.timedTrades} trade${a.timedTrades === 1 ? "" : "s"} occurred near a trade deadline or after playoffs began.`,
      severity: a.timedTrades >= 2 ? "medium" : "low",
    });
  }

  const premiumMax = Math.max(a.premiumToA, a.premiumToB);
  if (premiumMax >= 2) {
    const toUser = a.premiumToA >= a.premiumToB ? nameA : nameB;
    const fromUser = a.premiumToA >= a.premiumToB ? nameB : nameA;
    flags.push({
      key: "premium_movement",
      title: "Premium Asset Movement",
      description: `Multiple future 1st-round picks moved from ${fromUser} to ${toUser}.`,
      severity: premiumMax >= 3 ? "high" : "medium",
    });
  }

  // Low outside activity — for whichever user trades mostly with the other.
  const aConc = a.aTotalTrades > 0 ? a.aWithB / a.aTotalTrades : 0;
  const bConcVal = a.bTotalTrades > 0 ? a.aWithB / a.bTotalTrades : 0;
  if (a.aTotalTrades >= 3 && aConc >= 0.6) {
    flags.push({
      key: "low_activity_a",
      title: "Low Outside Trade Activity",
      description: `${nameA} has made ${a.aTotalTrades} trades within shared leagues, ${a.aWithB} of them with ${nameB}.`,
      severity: aConc >= 0.8 ? "medium" : "low",
    });
  }
  if (a.bTotalTrades >= 3 && bConcVal >= 0.6) {
    flags.push({
      key: "low_activity_b",
      title: "Low Outside Trade Activity",
      description: `${nameB} has made ${a.bTotalTrades} trades within shared leagues, ${a.aWithB} of them with ${nameA}.`,
      severity: bConcVal >= 0.8 ? "medium" : "low",
    });
  }

  // Weak supporting signal — never drives the score, info only.
  if (a.sharedLeaguesCount >= 4) {
    flags.push({
      key: "many_shared",
      title: "Many Shared Leagues",
      description: `These managers are in ${a.sharedLeaguesCount} of the same leagues. On its own this is a weak signal — leaguemates often play together across multiple leagues.`,
      severity: "info",
    });
  }

  return flags;
}

function emptyResult(userA: CollusionUser, userB: CollusionUser, seasons: string[]): CollusionResult {
  return {
    userA,
    userB,
    riskScore: 0,
    riskLabel: collusionLabel(0),
    evidenceStrength: 0,
    sharedLeaguesCount: 0,
    tradesTogether: 0,
    flaggedTrades: 0,
    valueFlow: { aGained: 0, bGained: 0, net: 0, netSide: "even" },
    lastTrade: null,
    sharedLeagues: [],
    trades: [],
    patternFlags: [],
    scoreBreakdown: buildScore({
      sharedLeaguesCount: 0,
      leaguesWithTrades: 0,
      tradesTogether: 0,
      avgGapPct: 0,
      aWins: 0,
      bWins: 0,
      netRatio: 0,
      timedTrades: 0,
      premiumOneSideMax: 0,
      activityConcentration: 0,
    }),
    activity: { aTotalTrades: 0, bTotalTrades: 0, aWithB: 0, scope: "within shared leagues" },
    scannedSeasons: seasons,
  };
}
