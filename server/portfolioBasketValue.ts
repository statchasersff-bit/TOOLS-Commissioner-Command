/**
 * Fixed-basket portfolio valuation from historical ADP.
 *
 * Model (replaces the trade-ledger reconstruction):
 *   1. Determine the manager's CURRENT holdings per league (rostered players).
 *   2. Mark that fixed basket to market at each of the last 36 monthly dates,
 *      using a value derived from crawled startup-draft ADP for that month.
 *
 * The league need not be 3 years old — we value today's players using whatever
 * the market (startup ADP) said they were worth in each past month.
 *
 * Turning ADP (a pick number, 1..N) into an SF-dynasty value (FantasyCalc's
 * 0-10000 scale) is done with a curve anchored to TODAY's market: pair each
 * player's current FantasyCalc value with their current startup ADP, fit a
 * smooth monotone curve value=f(pick). A player's value in month M is then
 * f(their average startup pick in month M). As ADP rose/fell over time, the
 * derived value moves with it. (FantasyCalc has no historical endpoint, so
 * today's market is the only sound anchor.)
 *
 * v1 scope: rostered PLAYERS only. Draft picks held as assets are not valued
 * yet (see the Portfolio Timeline plan).
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { drafts, draftPicks, portfolioValueSnapshots } from "@shared/schema";
import { buildDraftWhere, computeAdp } from "./adp";
import { getFantasyCalcValues } from "./fantasycalc";
import { getSleeperPlayers } from "./sleeper";
import { valueFromSeries, aggregateConfidence, type Confidence, type ValuePoint } from "./portfolioValueService";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const SLEEPER_API = "https://api.sleeper.app/v1";
const CALC_VERSION = 2; // 2 = ADP-derived fixed-basket model
const MAX_LEAGUES = 150;
const FETCH_CONCURRENCY = 8;
// The crawled startup-draft corpus begins Jan 2024, so the timeline starts
// there rather than carrying flat estimates back into months with no data.
const HISTORY_START = "2024-01-01";

type Format = "sf" | "1qb";

// ── small utilities ──────────────────────────────────────────────────────────

async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function sleeperJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SLEEPER_API}${path}`);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Month-start (YYYY-MM-01) dates from `start` through the current month, ascending. */
function monthStartsFrom(start: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const now = new Date();
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

const formatToSuperflex = (f: Format): "yes" | "no" => (f === "sf" ? "yes" : "no");

// ── ADP → value curve (anchored to today's market) ───────────────────────────

interface ValueCurve {
  /** Value (SF/1QB scale) for an average pick position. */
  valueForPick: (pick: number) => number;
  anchors: number; // number of (pick,value) points the curve was fit from
}

/**
 * Build value=f(pick) by pairing each player's current FantasyCalc value with
 * their current startup ADP, then smoothing into a monotone-ish lookup.
 */
async function buildAdpValueCurve(format: Format): Promise<ValueCurve> {
  const [fc, adp] = await Promise.all([
    getFantasyCalcValues(format),
    computeAdp({
      season: String(new Date().getFullYear()),
      draftType: "startup",
      leagueMode: "dynasty",
      superflex: formatToSuperflex(format),
      rookieMode: "direct", // real players only, no placeholder picks
      // bias toward the live market — last ~75 days of startups
      startDate: new Date(Date.now() - 75 * 86_400_000).toISOString().slice(0, 10),
    }),
  ]);
  const vals = fc.valuesBySleeperId;

  const pts: Array<{ pick: number; value: number }> = [];
  for (const r of adp.rows) {
    if (r.position === "PICK") continue;
    const v = vals[r.player_id];
    if (typeof v === "number" && v > 0 && r.avg_pick > 0) pts.push({ pick: r.avg_pick, value: v });
  }
  pts.sort((a, b) => a.pick - b.pick);

  // Bin by rounded pick, average value within each bin.
  const binSum = new Map<number, { sum: number; n: number }>();
  for (const p of pts) {
    const b = Math.max(1, Math.round(p.pick));
    const cur = binSum.get(b) ?? { sum: 0, n: 0 };
    cur.sum += p.value;
    cur.n += 1;
    binSum.set(b, cur);
  }
  let anchors = Array.from(binSum.entries())
    .map(([pick, { sum, n }]) => ({ pick, value: sum / n }))
    .sort((a, b) => a.pick - b.pick);

  // Light smoothing (window 5) to tame off-season noise.
  const smoothed = anchors.map((a, idx) => {
    const lo = Math.max(0, idx - 2);
    const hi = Math.min(anchors.length - 1, idx + 2);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += anchors[j].value;
    return { pick: a.pick, value: s / (hi - lo + 1) };
  });
  anchors = smoothed;

  const valueForPick = (pick: number): number => {
    if (anchors.length === 0) return 0;
    if (pick <= anchors[0].pick) return Math.round(anchors[0].value);
    const last = anchors[anchors.length - 1];
    if (pick >= last.pick) return Math.round(last.value);
    let lo = 0;
    let hi = anchors.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].pick <= pick) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    const span = b.pick - a.pick || 1;
    const f = (pick - a.pick) / span;
    return Math.round(a.value + f * (b.value - a.value));
  };

  return { valueForPick, anchors: anchors.length };
}

// ── Historical monthly ADP for a set of players ──────────────────────────────

/**
 * Average startup pick by (player, YYYY-MM) since `HISTORY_START`.
 * Reuses the ADP Explorer's draft-eligibility gate (buildDraftWhere) so values
 * are computed from the same clean startup corpus.
 */
async function monthlyAdpByPlayer(
  playerIds: string[],
  format: Format,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const ids = Array.from(new Set(playerIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const cutoffStr = HISTORY_START;

  const monthExpr = sql<string>`to_char(${drafts.draftDate}, 'YYYY-MM')`;
  const rows = await db
    .select({
      playerId: draftPicks.playerId,
      ym: monthExpr,
      avgPick: sql<number>`avg(${draftPicks.pickNo})`,
    })
    .from(draftPicks)
    .innerJoin(drafts, eq(drafts.draftId, draftPicks.draftId))
    .where(
      and(
        buildDraftWhere({
          season: "all",
          draftType: "startup",
          leagueMode: "dynasty",
          superflex: formatToSuperflex(format),
        }),
        inArray(draftPicks.playerId, ids),
        eq(draftPicks.isRookiePlaceholder, false),
        isNotNull(draftPicks.pickNo),
        isNotNull(drafts.draftDate),
        gte(drafts.draftDate, sql`${cutoffStr}::timestamp`),
      ),
    )
    .groupBy(draftPicks.playerId, monthExpr);

  for (const r of rows) {
    if (!r.playerId || !r.ym) continue;
    const m = out.get(r.playerId) ?? new Map<string, number>();
    m.set(r.ym, Number(r.avgPick));
    out.set(r.playerId, m);
  }
  return out;
}

/** Per-player ADP-derived value points (date = month-start), ascending. */
function buildPlayerValuePoints(
  monthlyAdp: Map<string, number>,
  curve: ValueCurve,
  pos: string,
): ValuePoint[] {
  return Array.from(monthlyAdp.entries())
    .map(([ym, avgPick]) => ({ date: `${ym}-01`, value: curve.valueForPick(avgPick), pos }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Basket assembly ──────────────────────────────────────────────────────────

interface LeagueBasket {
  leagueId: string;
  format: Format;
  playerIds: string[];
}

interface SleeperRosterRaw {
  owner_id: string | null;
  players: string[] | null;
}
interface SleeperLeagueRaw {
  roster_positions?: string[];
}

async function loadBaskets(sleeperUserId: string, leagueIds: string[]): Promise<LeagueBasket[]> {
  const results = await mapBounded(leagueIds, FETCH_CONCURRENCY, async (leagueId) => {
    const [league, rosters] = await Promise.all([
      sleeperJson<SleeperLeagueRaw>(`/league/${leagueId}`),
      sleeperJson<SleeperRosterRaw[]>(`/league/${leagueId}/rosters`),
    ]);
    if (!rosters || !Array.isArray(rosters)) return null;
    const format: Format = (league?.roster_positions || []).includes("SUPER_FLEX") ? "sf" : "1qb";
    const mine = rosters.find((r) => String(r.owner_id) === String(sleeperUserId));
    const playerIds = (mine?.players || []).filter((p): p is string => typeof p === "string" && p.length > 0);
    if (playerIds.length === 0) return null;
    return { leagueId, format, playerIds } as LeagueBasket;
  });
  return results.filter((b): b is LeagueBasket => b != null);
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface BasketResult {
  snapshots: number;
  leagues: number;
  players: number;
  months: number;
}

/**
 * Rebuild a manager's portfolio_value_snapshots from the fixed current basket,
 * valued monthly from Jan 2024 to today via historical ADP. Replaces any
 * existing snapshots for the user.
 */
export async function rebuildBasketSnapshots(
  sleeperUserId: string,
  leagueIds: string[],
): Promise<BasketResult> {
  const scanned = leagueIds.slice(0, MAX_LEAGUES);
  const baskets = await loadBaskets(sleeperUserId, scanned);

  if (baskets.length === 0) {
    await db.delete(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId));
    return { snapshots: 0, leagues: 0, players: 0, months: 0 };
  }

  const playersDb = await getSleeperPlayers();
  const posOf = (pid: string): string =>
    (playersDb[pid]?.fantasy_positions?.[0] || playersDb[pid]?.position || "") as string;

  const formats = Array.from(new Set(baskets.map((b) => b.format)));
  const allIdsByFormat = new Map<Format, string[]>();
  for (const f of formats) {
    const ids = new Set<string>();
    for (const b of baskets) if (b.format === f) b.playerIds.forEach((p) => ids.add(p));
    allIdsByFormat.set(f, Array.from(ids));
  }

  // Per-format: value curve, current FC values, and per-player ADP value points.
  const curves = new Map<Format, ValueCurve>();
  const fcByFormat = new Map<Format, Record<string, number>>();
  const valuePointsByFormat = new Map<Format, Map<string, ValuePoint[]>>();
  for (const f of formats) {
    const [curve, fc, monthly] = await Promise.all([
      buildAdpValueCurve(f),
      getFantasyCalcValues(f).then((r) => r.valuesBySleeperId),
      monthlyAdpByPlayer(allIdsByFormat.get(f) ?? [], f),
    ]);
    curves.set(f, curve);
    fcByFormat.set(f, fc);
    const points = new Map<string, ValuePoint[]>();
    for (const pid of allIdsByFormat.get(f) ?? []) {
      const m = monthly.get(pid);
      points.set(pid, m ? buildPlayerValuePoints(m, curve, posOf(pid)) : []);
    }
    valuePointsByFormat.set(f, points);
  }

  const months = monthStartsFrom(HISTORY_START);

  const rows: Array<typeof portfolioValueSnapshots.$inferInsert> = [];
  for (const basket of baskets) {
    const fc = fcByFormat.get(basket.format)!;
    const points = valuePointsByFormat.get(basket.format)!;
    for (const date of months) {
      let rosterValue = 0;
      const confs: Confidence[] = [];
      for (const pid of basket.playerIds) {
        const v = valueFromSeries(points.get(pid), date, { pos: posOf(pid), fallbackCurrent: fc[pid] });
        rosterValue += v.value;
        confs.push(v.confidence);
      }
      rows.push({
        sleeperUserId,
        leagueId: basket.leagueId,
        snapshotDate: date,
        rosterValue: Math.round(rosterValue),
        pickValue: 0,
        totalValue: Math.round(rosterValue),
        costBasis: 0,
        unrealizedGain: Math.round(rosterValue),
        realizedGain: 0,
        assetCount: basket.playerIds.length,
        confidence: aggregateConfidence(confs),
        calculationVersion: CALC_VERSION,
      });
    }
  }

  await db.delete(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.sleeperUserId, sleeperUserId));
  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    if (chunk.length) await db.insert(portfolioValueSnapshots).values(chunk);
  }

  const totalPlayers = new Set<string>();
  for (const b of baskets) b.playerIds.forEach((p) => totalPlayers.add(p));
  return { snapshots: rows.length, leagues: baskets.length, players: totalPlayers.size, months: months.length };
}
