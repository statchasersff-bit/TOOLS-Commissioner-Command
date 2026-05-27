/**
 * Portfolio snapshot calculation + timeline/breakdown/asset queries.
 *
 * Reads the asset ledger (asset_positions + portfolio_events) and computes
 * portfolio_value_snapshots at meaningful dates (monthly + each event date +
 * today), then serves them aggregated as a timeline. Snapshots are persisted so
 * the read path doesn't recompute the ledger on every page load.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, desc } from "drizzle-orm";
import { assetPositions, portfolioEvents, portfolioValueSnapshots } from "@shared/schema";
import {
  loadPlayerValueSeries,
  loadCurrentValues,
  valueFromSeries,
  getPickValueOnDate,
  aggregateConfidence,
  type Confidence,
} from "./portfolioValueService";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const CALC_VERSION = 1;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Month-start dates from `start` to today (inclusive), as YYYY-MM-DD. */
function monthlyDates(start: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const now = new Date();
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= now) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

// ── Snapshot recalculation ───────────────────────────────────────────────────

export async function recalculatePortfolioSnapshots(sleeperUserId: string): Promise<{ snapshots: number }> {
  const positions = await db.select().from(assetPositions).where(eq(assetPositions.sleeperUserId, sleeperUserId));
  if (positions.length === 0) {
    await db.delete(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId));
    return { snapshots: 0 };
  }

  // Preload player value series for all player positions in one query.
  const playerIds = positions.filter((p) => p.assetType === "player" && p.playerId).map((p) => p.playerId as string);
  const series = await loadPlayerValueSeries(playerIds, "sf");
  const currentValues = await loadCurrentValues();

  // Memoize pick valuation by (assetKey|date).
  const pickMemo = new Map<string, { value: number; confidence: Confidence }>();
  const valuePick = async (p: typeof positions[number], date: string) => {
    const key = `${p.assetKey}|${date}`;
    const c = pickMemo.get(key);
    if (c) return c;
    const res = await getPickValueOnDate(
      { season: p.pickSeason ?? 0, round: p.pickRound ?? 1, bucket: (p.pickBucket as any) || "mid" },
      date,
    );
    pickMemo.set(key, res);
    return res;
  };

  // Candidate snapshot dates: monthly from earliest acquisition + every event
  // date + today.
  const earliest = positions.reduce((min, p) => (p.acquiredDate < min ? p.acquiredDate : min), todayStr());
  const events = await db.select().from(portfolioEvents).where(eq(portfolioEvents.sleeperUserId, sleeperUserId));
  const dateSet = new Set<string>([...monthlyDates(earliest), ...events.map((e) => e.eventDate), todayStr()]);
  const dates = Array.from(dateSet).filter((d) => d <= todayStr()).sort();

  // Group positions by league.
  const leagueIds = Array.from(new Set(positions.map((p) => p.leagueId)));

  const rows: Array<typeof portfolioValueSnapshots.$inferInsert> = [];
  for (const date of dates) {
    for (const leagueId of leagueIds) {
      const active = positions.filter(
        (p) =>
          p.leagueId === leagueId &&
          p.acquiredDate <= date &&
          (p.disposedDate == null || p.disposedDate > date),
      );
      if (active.length === 0) continue;

      let rosterValue = 0;
      let pickValue = 0;
      let costBasis = 0;
      const confs: Confidence[] = [];
      for (const p of active) {
        if (p.assetType === "player" && p.playerId) {
          const v = valueFromSeries(series.get(p.playerId), date, { fallbackCurrent: currentValues[p.playerId] });
          rosterValue += v.value;
          confs.push(v.confidence);
        } else if (p.assetType === "pick") {
          const v = await valuePick(p, date);
          pickValue += v.value;
          confs.push(v.confidence);
        }
        costBasis += p.costBasis ?? 0;
      }
      const totalValue = rosterValue + pickValue;
      rows.push({
        sleeperUserId,
        leagueId,
        snapshotDate: date,
        rosterValue: Math.round(rosterValue),
        pickValue: Math.round(pickValue),
        totalValue: Math.round(totalValue),
        costBasis: Math.round(costBasis),
        unrealizedGain: Math.round(totalValue - costBasis),
        realizedGain: 0,
        assetCount: active.length,
        confidence: aggregateConfidence(confs),
        calculationVersion: CALC_VERSION,
      });
    }
  }

  await db.delete(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId));
  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    if (rows.slice(i, i + BATCH).length) await db.insert(portfolioValueSnapshots).values(rows.slice(i, i + BATCH));
  }
  return { snapshots: rows.length };
}

// ── Timeline query ───────────────────────────────────────────────────────────

const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
function rangeCutoff(range: string): string | null {
  const now = new Date();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : range === "1y" || range === "ytd" ? 365 : null;
  if (days == null) return null;
  const d = new Date(now.getTime() - days * 86_400_000);
  if (range === "ytd") return `${now.getUTCFullYear()}-01-01`;
  return d.toISOString().slice(0, 10);
}

export interface TimelinePoint {
  date: string;
  totalValue: number;
  rosterValue: number;
  pickValue: number;
  costBasis: number;
  netValueCreated: number;
  leagueCount: number;
  averageTeamValue: number;
  confidence: string;
}

export async function getPortfolioTimeline(
  sleeperUserId: string,
  opts: { range?: string; leagueId?: string; sameLeague?: boolean } = {},
): Promise<{
  summary: {
    totalPortfolioValue: number;
    rosterValue: number;
    pickValue: number;
    costBasis: number;
    netValueCreated: number;
    change: number;
    changePct: number;
    leaguesTracked: number;
    averageTeamValue: number;
    confidence: string;
  };
  points: TimelinePoint[];
}> {
  const where = opts.leagueId
    ? and(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId), eq(portfolioValueSnapshots.leagueId, opts.leagueId))
    : eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId);
  let snaps = await db.select().from(portfolioValueSnapshots).where(where);

  // Same-league adjusted: only include leagues that were already tracked at the
  // start of the selected range, so adding a new league doesn't fake a jump.
  const cutoffForFilter = rangeCutoff(opts.range ?? "all");
  if (opts.sameLeague) {
    const inRange = snaps.filter((s) => !cutoffForFilter || s.snapshotDate >= cutoffForFilter);
    const startDate = inRange.reduce((min, s) => (s.snapshotDate < min ? s.snapshotDate : min), "9999-12-31");
    const startLeagues = new Set(inRange.filter((s) => s.snapshotDate === startDate).map((s) => s.leagueId));
    if (startLeagues.size > 0) snaps = snaps.filter((s) => startLeagues.has(s.leagueId));
  }

  // Aggregate per date across leagues.
  const byDate = new Map<string, TimelinePoint & { _confs: number[] }>();
  for (const s of snaps) {
    const p = byDate.get(s.snapshotDate) ?? {
      date: s.snapshotDate,
      totalValue: 0,
      rosterValue: 0,
      pickValue: 0,
      costBasis: 0,
      netValueCreated: 0,
      leagueCount: 0,
      averageTeamValue: 0,
      confidence: "low",
      _confs: [],
    };
    p.totalValue += s.totalValue;
    p.rosterValue += s.rosterValue;
    p.pickValue += s.pickValue;
    p.costBasis += s.costBasis;
    p.leagueCount += 1;
    p._confs.push(CONF_RANK[s.confidence] ?? 1);
    byDate.set(s.snapshotDate, p);
  }
  let points: TimelinePoint[] = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const avgConf = p._confs.reduce((x, y) => x + y, 0) / Math.max(1, p._confs.length);
      return {
        date: p.date,
        totalValue: p.totalValue,
        rosterValue: p.rosterValue,
        pickValue: p.pickValue,
        costBasis: p.costBasis,
        netValueCreated: p.totalValue - p.costBasis,
        leagueCount: p.leagueCount,
        averageTeamValue: Math.round(p.totalValue / Math.max(1, p.leagueCount)),
        confidence: avgConf >= 2.4 ? "high" : avgConf >= 1.5 ? "medium" : "low",
      };
    });

  // Range filter (keep at least the last point as the anchor).
  const cutoff = rangeCutoff(opts.range ?? "all");
  if (cutoff) {
    const filtered = points.filter((p) => p.date >= cutoff);
    if (filtered.length > 0) points = filtered;
  }

  const latest = points[points.length - 1];
  const start = points[0];
  const summary = latest
    ? {
        totalPortfolioValue: latest.totalValue,
        rosterValue: latest.rosterValue,
        pickValue: latest.pickValue,
        costBasis: latest.costBasis,
        netValueCreated: latest.netValueCreated,
        change: latest.totalValue - (start?.totalValue ?? latest.totalValue),
        changePct:
          start && start.totalValue > 0
            ? Math.round(((latest.totalValue - start.totalValue) / start.totalValue) * 1000) / 10
            : 0,
        leaguesTracked: latest.leagueCount,
        averageTeamValue: latest.averageTeamValue,
        confidence: latest.confidence,
      }
    : {
        totalPortfolioValue: 0,
        rosterValue: 0,
        pickValue: 0,
        costBasis: 0,
        netValueCreated: 0,
        change: 0,
        changePct: 0,
        leaguesTracked: 0,
        averageTeamValue: 0,
        confidence: "low",
      };

  return { summary, points };
}

// ── Events query ─────────────────────────────────────────────────────────────

export async function getPortfolioEvents(
  sleeperUserId: string,
  opts: { eventType?: string; leagueId?: string; minImpact?: number; limit?: number } = {},
): Promise<Array<{
  id: number;
  date: string;
  type: string;
  title: string;
  description: string;
  netDelta: number;
  valueSent: number | null;
  valueReceived: number | null;
  leagueId: string | null;
  detail: unknown;
  confidence: string;
}>> {
  const rows = await db
    .select()
    .from(portfolioEvents)
    .where(eq(portfolioEvents.sleeperUserId, sleeperUserId))
    .orderBy(desc(portfolioEvents.eventDate));
  const minImpact = opts.minImpact ?? 0;
  return rows
    .filter((e) => (opts.eventType ? e.eventType === opts.eventType : true))
    .filter((e) => (opts.leagueId ? e.leagueId === opts.leagueId : true))
    .filter((e) => Math.abs(e.netDelta) >= minImpact || e.eventType.includes("draft"))
    .slice(0, opts.limit ?? 200)
    .map((e) => ({
      id: e.id,
      date: e.eventDate,
      type: e.eventType,
      title: e.title,
      description: e.description ?? "",
      netDelta: e.netDelta,
      valueSent: e.valueSent,
      valueReceived: e.valueReceived,
      leagueId: e.leagueId,
      detail: e.detail,
      confidence: e.confidence,
    }));
}

// ── League breakdown ─────────────────────────────────────────────────────────

export async function getLeagueBreakdown(
  sleeperUserId: string,
  leagueNames: Record<string, string> = {},
): Promise<Array<{
  leagueId: string;
  leagueName: string;
  currentValue: number;
  rosterValue: number;
  pickValue: number;
  costBasis: number;
  netValueCreated: number;
  confidence: string;
}>> {
  const snaps = await db
    .select()
    .from(portfolioValueSnapshots)
    .where(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId))
    .orderBy(desc(portfolioValueSnapshots.snapshotDate));
  // Latest snapshot per league.
  const latestByLeague = new Map<string, typeof snaps[number]>();
  for (const s of snaps) if (!latestByLeague.has(s.leagueId)) latestByLeague.set(s.leagueId, s);
  return Array.from(latestByLeague.values())
    .map((s) => ({
      leagueId: s.leagueId,
      leagueName: leagueNames[s.leagueId] || s.leagueId,
      currentValue: s.totalValue,
      rosterValue: s.rosterValue,
      pickValue: s.pickValue,
      costBasis: s.costBasis,
      netValueCreated: s.unrealizedGain,
      confidence: s.confidence,
    }))
    .sort((a, b) => b.currentValue - a.currentValue);
}

// ── Value source breakdown ───────────────────────────────────────────────────
// Where did the manager create (or lose) value? Group current open positions by
// how they were acquired and compare current value vs cost basis.

const METHOD_LABELS: Record<string, string> = {
  startup_draft: "Startup Draft",
  rookie_draft: "Rookie Draft",
  pick_conversion: "Rookie Picks",
  trade: "Trades",
  waiver: "Waivers",
  free_agent: "Free Agents",
  league_import: "Imported",
  unknown: "Other",
};

export async function getValueSourceBreakdown(
  sleeperUserId: string,
): Promise<Array<{ method: string; label: string; currentValue: number; costBasis: number; netValueCreated: number; count: number }>> {
  const positions = await db
    .select()
    .from(assetPositions)
    .where(and(eq(assetPositions.sleeperUserId, sleeperUserId), eq(assetPositions.isCurrent, true)));
  if (positions.length === 0) return [];

  const playerIds = positions.filter((p) => p.assetType === "player" && p.playerId).map((p) => p.playerId as string);
  const series = await loadPlayerValueSeries(playerIds, "sf");
  const currentValues = await loadCurrentValues();
  const today = todayStr();

  const byMethod = new Map<string, { currentValue: number; costBasis: number; count: number }>();
  for (const p of positions) {
    const method = p.acquiredMethod || "unknown";
    const cur =
      p.assetType === "player" && p.playerId
        ? valueFromSeries(series.get(p.playerId), today, { fallbackCurrent: currentValues[p.playerId] }).value
        : p.costBasis; // pick current value ≈ cost basis in v1
    const m = byMethod.get(method) ?? { currentValue: 0, costBasis: 0, count: 0 };
    m.currentValue += cur;
    m.costBasis += p.costBasis ?? 0;
    m.count += 1;
    byMethod.set(method, m);
  }

  return Array.from(byMethod.entries())
    .map(([method, m]) => ({
      method,
      label: METHOD_LABELS[method] || method,
      currentValue: Math.round(m.currentValue),
      costBasis: Math.round(m.costBasis),
      netValueCreated: Math.round(m.currentValue - m.costBasis),
      count: m.count,
    }))
    .sort((a, b) => Math.abs(b.netValueCreated) - Math.abs(a.netValueCreated));
}

// ── Asset exposure ───────────────────────────────────────────────────────────

export async function getPortfolioAssets(
  sleeperUserId: string,
  leagueNames: Record<string, string> = {},
): Promise<Array<{
  assetType: string;
  playerId: string | null;
  name: string;
  ownedCount: number;
  currentValueTotal: number;
  costBasisTotal: number;
  netValueCreated: number;
  leagues: Array<{ leagueId: string; leagueName: string; costBasis: number; acquiredMethod: string; acquiredDate: string }>;
}>> {
  const positions = await db
    .select()
    .from(assetPositions)
    .where(and(eq(assetPositions.sleeperUserId, sleeperUserId), eq(assetPositions.isCurrent, true)));

  const byAsset = new Map<string, {
    assetType: string;
    playerId: string | null;
    name: string;
    leagues: Array<{ leagueId: string; leagueName: string; costBasis: number; acquiredMethod: string; acquiredDate: string }>;
    costBasisTotal: number;
  }>();
  for (const p of positions) {
    const key = p.assetType === "player" ? `player_${p.playerId}` : `pick_${p.pickSeason}_${p.pickRound}`;
    const name = p.assetType === "player" ? (p.playerName || p.playerId || "Player") : `${p.pickSeason} R${p.pickRound}`;
    const a = byAsset.get(key) ?? { assetType: p.assetType, playerId: p.playerId, name, leagues: [], costBasisTotal: 0 };
    a.leagues.push({
      leagueId: p.leagueId,
      leagueName: leagueNames[p.leagueId] || p.leagueId,
      costBasis: p.costBasis,
      acquiredMethod: p.acquiredMethod,
      acquiredDate: p.acquiredDate,
    });
    a.costBasisTotal += p.costBasis;
    byAsset.set(key, a);
  }

  // Current value: reuse the latest player series value; picks use cost basis as
  // a stand-in (current pick value ≈ acquisition for v1).
  const playerIds = Array.from(byAsset.values()).filter((a) => a.assetType === "player" && a.playerId).map((a) => a.playerId as string);
  const series = await loadPlayerValueSeries(playerIds, "sf");
  const currentValues = await loadCurrentValues();
  const today = todayStr();

  return Array.from(byAsset.values())
    .map((a) => {
      let currentEach = 0;
      if (a.assetType === "player" && a.playerId)
        currentEach = valueFromSeries(series.get(a.playerId), today, { fallbackCurrent: currentValues[a.playerId] }).value;
      const currentValueTotal = a.assetType === "player" ? currentEach * a.leagues.length : a.costBasisTotal;
      return {
        assetType: a.assetType,
        playerId: a.playerId,
        name: a.name,
        ownedCount: a.leagues.length,
        currentValueTotal: Math.round(currentValueTotal),
        costBasisTotal: Math.round(a.costBasisTotal),
        netValueCreated: Math.round(currentValueTotal - a.costBasisTotal),
        leagues: a.leagues,
      };
    })
    .sort((a, b) => b.currentValueTotal - a.currentValueTotal);
}
