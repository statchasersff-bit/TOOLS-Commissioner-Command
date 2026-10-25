/**
 * Trade Review Center HTTP routes (Commissioner decision-support).
 *
 *   POST /api/commissioner/trades/ingest                 → scan Sleeper, store new trades
 *   GET  /api/commissioner/trades                        → filtered trade feed
 *   GET  /api/commissioner/trades/analytics              → league-level analytics
 *   GET  /api/commissioner/trades/manager/:rosterId      → one manager's trade history
 *   GET  /api/commissioner/trades/:tradeId               → one trade (assets/flags/reviews/summary)
 *   PATCH /api/commissioner/trades/:tradeId/review       → record a review decision + notes
 *
 * Phase 1 is decision-support only — no route ever writes back to Sleeper. All
 * routes require an authenticated StatChasers user (the commissioner).
 */
import type { Express } from "express";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  commissionerTrades,
  commissionerTradeAssets,
  commissionerTradeFlags,
  commissionerTradeReviews,
  commissionerManagerTradeStats,
} from "@shared/schema";
import { getUserIdFromRequest } from "./scAuthRoutes";
import {
  ingestSleeperTradesForLeague,
  getRiskLabel,
  getLeagueDirectory,
  getStartupPickSeasons,
  type LeagueDirectory,
  type ReviewStatus,
} from "./services/commissionerTrades";
import { runCollusionRiskCheck } from "./services/commissionerTrades/collusionRisk";

const REVIEW_STATUSES: ReviewStatus[] = [
  "unreviewed",
  "reviewed",
  "watchlist",
  "disputed",
  "no_action",
];

const RISK_BANDS: Record<string, [number, number]> = {
  low: [0, 24],
  medium: [25, 49],
  high: [50, 74],
  critical: [75, 100],
};

function parseIntStrict(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function registerCommissionerTradesRoutes(app: Express): void {
  const requireUser = (req: any, res: any): string | null => {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      res.status(401).json({ error: "Not authenticated" });
      return null;
    }
    return uid;
  };

  // ── Ingest trades for a league ─────────────────────────────────────────────
  app.post("/api/commissioner/trades/ingest", async (req, res) => {
    if (!requireUser(req, res)) return;
    const { leagueId, weeks, forceRefresh, season } = req.body || {};
    if (!leagueId || typeof leagueId !== "string") {
      return res.status(400).json({ error: "leagueId required" });
    }
    const weekList = Array.isArray(weeks)
      ? weeks.map((w: unknown) => Number(w)).filter((w) => Number.isFinite(w))
      : undefined;
    try {
      const result = await ingestSleeperTradesForLeague(leagueId, {
        weeks: weekList && weekList.length > 0 ? weekList : undefined,
        forceRefresh: Boolean(forceRefresh),
        season: typeof season === "string" ? season : undefined,
      });
      if (!result.success) {
        return res.status(502).json(result);
      }
      res.json(result);
    } catch (err: any) {
      const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
      res.status(status).json({ error: err?.message || "Ingest failed" });
    }
  });

  // ── Collusion Risk Check ───────────────────────────────────────────────────
  // Read-only forensic scan of two Sleeper users across their shared leagues.
  // Surfaces signals, never verdicts. Reads only public Sleeper data + explicit
  // username inputs, so it does not require a StatChasers login (matches the
  // tool's "readonly" gate). Nothing is persisted.
  app.get("/api/commissioner/collusion-risk", async (req, res) => {
    const usernameA = String(req.query.userA || "").trim();
    const usernameB = String(req.query.userB || "").trim();
    if (!usernameA || !usernameB) {
      return res.status(400).json({ error: "Two Sleeper usernames are required." });
    }
    try {
      const result = await runCollusionRiskCheck(usernameA, usernameB);
      res.json(result);
    } catch (err: any) {
      const msg = err?.message || "Collusion risk check failed";
      const status = /not found/i.test(msg)
        ? 404
        : /different sleeper/i.test(msg)
          ? 400
          : /sleeper|fetch/i.test(msg)
            ? 502
            : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ── Trade feed (filtered) ──────────────────────────────────────────────────
  // Accepts either a single `leagueId` or a comma-separated `leagueIds` so the
  // Trade Review Center can show one league or every league the user commissions.
  app.get("/api/commissioner/trades", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueIds = String(req.query.leagueIds || req.query.leagueId || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (leagueIds.length === 0) return res.status(400).json({ error: "leagueId required" });

    const conds = [
      leagueIds.length === 1
        ? eq(commissionerTrades.leagueId, leagueIds[0])
        : inArray(commissionerTrades.leagueId, leagueIds),
    ];

    const reviewStatus = String(req.query.reviewStatus || "");
    if (reviewStatus && REVIEW_STATUSES.includes(reviewStatus as ReviewStatus)) {
      conds.push(eq(commissionerTrades.reviewStatus, reviewStatus));
    }
    const risk = String(req.query.risk || "");
    if (risk && RISK_BANDS[risk]) {
      const [lo, hi] = RISK_BANDS[risk];
      conds.push(gte(commissionerTrades.riskScore, lo));
      conds.push(lte(commissionerTrades.riskScore, hi));
    }
    const fromDate = parseIntStrict(req.query.fromDate);
    if (fromDate != null) conds.push(gte(commissionerTrades.createdTs, fromDate));
    const toDate = parseIntStrict(req.query.toDate);
    if (toDate != null) conds.push(lte(commissionerTrades.createdTs, toDate));

    try {
      let rows = await db
        .select()
        .from(commissionerTrades)
        .where(and(...conds))
        .orderBy(desc(commissionerTrades.createdTs))
        .limit(500);

      // Optional manager filter — done in JS because rosterIds is JSONB.
      const managerRosterId = parseIntStrict(req.query.managerRosterId);
      if (managerRosterId != null) {
        rows = rows.filter((r) =>
          Array.isArray(r.rosterIds) && (r.rosterIds as number[]).map(Number).includes(managerRosterId),
        );
      }

      const assets = await loadAssetsFor(rows.map((r) => r.id));
      const flags = await loadFlagsFor(rows.map((r) => r.id));
      const noted = await loadNotedTradeIds(rows.map((r) => r.id));

      // Resolve display names (league + team names) and startup-draft seasons for
      // every league present in the result. Both cached per league.
      const presentLeagueIds = Array.from(new Set(rows.map((r) => r.leagueId)));
      const directories = new Map<string, LeagueDirectory>();
      const startupSeasonsByLeague = new Map<string, Set<string>>();
      await Promise.all(
        presentLeagueIds.map(async (id) => {
          const [dir, startup] = await Promise.all([
            getLeagueDirectory(id).catch(() => null),
            getStartupPickSeasons(id).catch(() => new Set<string>()),
          ]);
          if (dir) directories.set(id, dir);
          startupSeasonsByLeague.set(id, startup);
        }),
      );

      // Exclude trades that include a startup-draft pick — a pick whose season
      // matches a full-roster startup draft for its league. (Deep rounds are a
      // safety net for when draft data is unavailable: no rookie draft runs that
      // many rounds.)
      const isStartupPick = (
        a: typeof commissionerTradeAssets.$inferSelect,
        leagueId: string,
      ): boolean => {
        if (a.assetType !== "pick") return false;
        const startup = startupSeasonsByLeague.get(leagueId);
        if (a.pickSeason != null && startup?.has(String(a.pickSeason))) return true;
        return Number(a.pickRound ?? 0) >= 10;
      };
      const visibleRows = rows.filter((r) => {
        const ra = assets.get(r.id) ?? [];
        return !ra.some((a) => isStartupPick(a, r.leagueId));
      });

      const feed = visibleRows.map((r) =>
        shapeTrade(r, assets.get(r.id) ?? [], flags.get(r.id) ?? [], directories.get(r.leagueId), noted.has(r.id)),
      );
      res.json({ leagueId: leagueIds[0], leagueIds, trades: feed });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load trades" });
    }
  });

  // ── League analytics ───────────────────────────────────────────────────────
  // NOTE: registered BEFORE the /:tradeId param route so "analytics" / "manager"
  // are not captured as a tradeId.
  app.get("/api/commissioner/trades/analytics", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const rows = await db
        .select()
        .from(commissionerTrades)
        .where(eq(commissionerTrades.leagueId, leagueId));

      const pairs = await db
        .select()
        .from(commissionerManagerTradeStats)
        .where(eq(commissionerManagerTradeStats.leagueId, leagueId));

      const totalTrades = rows.length;
      const tradesByWeek: Record<string, number> = {};
      const managerCount: Record<string, number> = {};
      let diffSum = 0;
      let highRiskTrades = 0;
      let futurePickTrades = 0;
      let reviewedCount = 0;
      let unreviewedCount = 0;

      const flagsByTrade = await loadFlagsFor(rows.map((r) => r.id));

      for (const r of rows) {
        const wk = r.week != null ? String(r.week) : "?";
        tradesByWeek[wk] = (tradesByWeek[wk] ?? 0) + 1;
        for (const rid of (r.rosterIds as number[]) ?? []) {
          managerCount[String(rid)] = (managerCount[String(rid)] ?? 0) + 1;
        }
        diffSum += Number(r.valueDiffPct ?? 0);
        if (Number(r.riskScore ?? 0) >= 50) highRiskTrades++;
        const fl = flagsByTrade.get(r.id) ?? [];
        if (fl.some((f) => f.flagType === "future_pick")) futurePickTrades++;
        if (r.reviewStatus === "reviewed") reviewedCount++;
        if (r.reviewStatus === "unreviewed") unreviewedCount++;
      }

      const mostActiveManagers = Object.entries(managerCount)
        .map(([rosterId, count]) => ({ rosterId: Number(rosterId), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const frequentTradePairs = pairs
        .map((p) => ({
          rosterIdA: p.rosterIdA,
          rosterIdB: p.rosterIdB,
          tradeCount: p.tradeCount ?? 0,
          totalValueMoved: Number(p.totalValueMoved ?? 0),
        }))
        .sort((a, b) => b.tradeCount - a.tradeCount)
        .slice(0, 10);

      res.json({
        totalTrades,
        tradesByWeek,
        mostActiveManagers,
        frequentTradePairs,
        avgValueDiffPct: totalTrades > 0 ? Math.round((diffSum / totalTrades) * 10) / 10 : 0,
        highRiskTrades,
        futurePickTrades,
        reviewedCount,
        unreviewedCount,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load analytics" });
    }
  });

  // ── Manager trade history ──────────────────────────────────────────────────
  app.get("/api/commissioner/trades/manager/:rosterId", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    const rosterId = parseIntStrict(req.params.rosterId);
    if (!leagueId || rosterId == null) {
      return res.status(400).json({ error: "leagueId and rosterId required" });
    }
    try {
      const all = await db
        .select()
        .from(commissionerTrades)
        .where(eq(commissionerTrades.leagueId, leagueId))
        .orderBy(desc(commissionerTrades.createdTs));
      const rows = all.filter((r) =>
        Array.isArray(r.rosterIds) && (r.rosterIds as number[]).map(Number).includes(rosterId),
      );

      const assets = await loadAssetsFor(rows.map((r) => r.id));
      const flags = await loadFlagsFor(rows.map((r) => r.id));

      // Aggregate value sent / received for this roster across all its trades.
      let valueReceived = 0;
      let valueSent = 0;
      let futurePicksTradedAway = 0;
      let highRisk = 0;
      let disputed = 0;
      for (const r of rows) {
        const as = assets.get(r.id) ?? [];
        for (const a of as) {
          if (a.toRosterId === rosterId) valueReceived += Number(a.assetValue ?? 0);
          if (a.fromRosterId === rosterId) {
            valueSent += Number(a.assetValue ?? 0);
            if (a.assetType === "pick" && Number(a.pickSeason) > Number(r.season)) {
              futurePicksTradedAway++;
            }
          }
        }
        if (Number(r.riskScore ?? 0) >= 50) highRisk++;
        if (r.reviewStatus === "disputed") disputed++;
      }

      const directory = await getLeagueDirectory(leagueId).catch(() => undefined);
      const trades = rows.map((r) => shapeTrade(r, assets.get(r.id) ?? [], flags.get(r.id) ?? [], directory));

      res.json({
        rosterId,
        leagueId,
        totalTrades: rows.length,
        valueReceived: Math.round(valueReceived),
        valueSent: Math.round(valueSent),
        netValue: Math.round(valueReceived - valueSent),
        futurePicksTradedAway,
        highRiskTrades: highRisk,
        disputedTrades: disputed,
        trades,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load manager history" });
    }
  });

  // ── Single trade detail ────────────────────────────────────────────────────
  app.get("/api/commissioner/trades/:tradeId", async (req, res) => {
    if (!requireUser(req, res)) return;
    const tradeId = parseIntStrict(req.params.tradeId);
    if (tradeId == null) return res.status(400).json({ error: "Invalid trade id" });
    try {
      const [trade] = await db
        .select()
        .from(commissionerTrades)
        .where(eq(commissionerTrades.id, tradeId))
        .limit(1);
      if (!trade) return res.status(404).json({ error: "Trade not found" });

      const assets = (await loadAssetsFor([tradeId])).get(tradeId) ?? [];
      const flags = (await loadFlagsFor([tradeId])).get(tradeId) ?? [];
      const reviews = await db
        .select()
        .from(commissionerTradeReviews)
        .where(eq(commissionerTradeReviews.tradeId, tradeId))
        .orderBy(desc(commissionerTradeReviews.createdAt));

      const directory = await getLeagueDirectory(trade.leagueId).catch(() => undefined);
      const hasNote = reviews.some((r) => typeof r.notes === "string" && r.notes.trim().length > 0);
      res.json({
        trade: shapeTrade(trade, assets, flags, directory, hasNote),
        assets,
        flags,
        reviews,
        generatedSummary: trade.summary ?? "",
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load trade" });
    }
  });

  // ── Update review status / add notes ───────────────────────────────────────
  app.patch("/api/commissioner/trades/:tradeId/review", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const tradeId = parseIntStrict(req.params.tradeId);
    if (tradeId == null) return res.status(400).json({ error: "Invalid trade id" });
    const { reviewStatus, notes, decisionReason } = req.body || {};
    if (!reviewStatus || !REVIEW_STATUSES.includes(reviewStatus)) {
      return res.status(400).json({ error: `reviewStatus must be one of ${REVIEW_STATUSES.join(", ")}` });
    }
    try {
      const [trade] = await db
        .select({ id: commissionerTrades.id })
        .from(commissionerTrades)
        .where(eq(commissionerTrades.id, tradeId))
        .limit(1);
      if (!trade) return res.status(404).json({ error: "Trade not found" });

      // Record the decision in the audit log...
      await db.insert(commissionerTradeReviews).values({
        tradeId,
        reviewerUserId: uid,
        reviewStatus,
        notes: typeof notes === "string" ? notes : null,
        decisionReason: typeof decisionReason === "string" ? decisionReason : null,
      });
      // ...and reflect the current status on the trade row.
      await db
        .update(commissionerTrades)
        .set({ reviewStatus, updatedAt: new Date() })
        .where(eq(commissionerTrades.id, tradeId));

      res.json({ success: true, tradeId, reviewStatus });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update review" });
    }
  });
}

// ── Shared loaders / shapers ─────────────────────────────────────────────────

async function loadAssetsFor(tradeIds: number[]) {
  const map = new Map<number, (typeof commissionerTradeAssets.$inferSelect)[]>();
  if (tradeIds.length === 0) return map;
  const rows = await db
    .select()
    .from(commissionerTradeAssets)
    .where(inArray(commissionerTradeAssets.tradeId, tradeIds));
  for (const r of rows) {
    (map.get(r.tradeId) ?? map.set(r.tradeId, []).get(r.tradeId)!).push(r);
  }
  return map;
}

async function loadFlagsFor(tradeIds: number[]) {
  const map = new Map<number, (typeof commissionerTradeFlags.$inferSelect)[]>();
  if (tradeIds.length === 0) return map;
  const rows = await db
    .select()
    .from(commissionerTradeFlags)
    .where(inArray(commissionerTradeFlags.tradeId, tradeIds));
  for (const r of rows) {
    (map.get(r.tradeId) ?? map.set(r.tradeId, []).get(r.tradeId)!).push(r);
  }
  return map;
}

/** Trade ids that have at least one review row carrying a non-empty note. */
async function loadNotedTradeIds(tradeIds: number[]): Promise<Set<number>> {
  const set = new Set<number>();
  if (tradeIds.length === 0) return set;
  const rows = await db
    .select({ tradeId: commissionerTradeReviews.tradeId, notes: commissionerTradeReviews.notes })
    .from(commissionerTradeReviews)
    .where(inArray(commissionerTradeReviews.tradeId, tradeIds));
  for (const r of rows) {
    if (typeof r.notes === "string" && r.notes.trim().length > 0) set.add(r.tradeId);
  }
  return set;
}

/** Flatten a trade row + its assets/flags into the shape the UI consumes. */
function shapeTrade(
  trade: typeof commissionerTrades.$inferSelect,
  assets: (typeof commissionerTradeAssets.$inferSelect)[],
  flags: (typeof commissionerTradeFlags.$inferSelect)[],
  directory?: LeagueDirectory,
  hasNote = false,
) {
  const rosterNames: Record<number, string> = {};
  if (directory) {
    for (const [rid, names] of Object.entries(directory.rosterNames)) {
      rosterNames[Number(rid)] = names.teamName;
    }
  }
  return {
    id: trade.id,
    leagueId: trade.leagueId,
    leagueName: directory?.leagueName ?? null,
    rosterNames,
    sleeperTransactionId: trade.sleeperTransactionId,
    season: trade.season,
    week: trade.week,
    status: trade.status,
    createdTs: trade.createdTs,
    statusUpdatedTs: trade.statusUpdatedTs,
    rosterIds: (trade.rosterIds as number[]) ?? [],
    totalValueByRoster: (trade.totalValueByRoster as Record<string, number>) ?? {},
    valueDiffAbs: Number(trade.valueDiffAbs ?? 0),
    valueDiffPct: Number(trade.valueDiffPct ?? 0),
    riskScore: trade.riskScore ?? 0,
    riskLabel: getRiskLabel(trade.riskScore ?? 0),
    fairnessScore: trade.fairnessScore ?? 100,
    reviewStatus: trade.reviewStatus,
    summary: trade.summary ?? "",
    hasNote,
    isMultiTeam: ((trade.rosterIds as number[]) ?? []).length > 2,
    assets: assets.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      playerId: a.playerId,
      playerName: a.playerName,
      position: a.position,
      team: a.team,
      pickSeason: a.pickSeason,
      pickRound: a.pickRound,
      faabAmount: a.faabAmount != null ? Number(a.faabAmount) : null,
      fromRosterId: a.fromRosterId,
      toRosterId: a.toRosterId,
      assetValue: Number(a.assetValue ?? 0),
      assetValueSource: a.assetValueSource,
    })),
    flags: flags.map((f) => ({
      flagType: f.flagType,
      severity: f.severity,
      title: f.title,
      description: f.description,
    })),
  };
}
