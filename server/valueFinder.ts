/**
 * Value Finder data aggregator.
 *
 * Joins the app's real data sources into the ValueFinderPlayer shape the client
 * scoring engine (client/src/lib/value-finder) consumes, replacing the bundled
 * mock pool. The client still computes all derived scores/labels — this module
 * only supplies the *raw inputs*:
 *
 *   market values   FantasyCalc + KTC + (optional) user custom set, by sleeperId
 *   production      Sleeper season totals (PPR points, games, PPG)
 *   vor             derived: points over a positional replacement baseline
 *   usage           StatChasers public data (keyed by Sleeper ID directly) —
 *                   the precomputed composite usageScore (0–1) plus the raw
 *                   fields that map 1:1 (snap share, red-zone/goal-line, QB
 *                   per-game volume)
 *   market trends   value-snapshot deltas (7/30/90d % change), by sleeperId
 *
 * Fields with no real source (dynastyCommandValue, projectedPoints, true
 * target/route/air-yards shares, numeric production/usage/role trends, league
 * exposure) are intentionally left undefined; the client model degrades
 * gracefully (reweights the metrics it does have).
 *
 * The non-user-specific base (everything except custom values) is cached
 * in-memory per (season, format); custom values are overlaid per request.
 */

import { getFantasyCalcValues } from "./fantasycalc";
import { getKtcValues } from "./ktc";
import { getResolvedValues } from "./customValues";
import { getSeasonStatsMap, type SleeperStatsRow } from "./sleeperPlayerProfile";
import { getValueChanges } from "./valueSnapshots";

export type VfPosition = "QB" | "RB" | "WR" | "TE";
const POSITIONS: VfPosition[] = ["QB", "RB", "WR", "TE"];
const POS_SET = new Set<string>(POSITIONS);

/** Subset of the client's ValueFinderPlayer that we populate server-side. */
export interface ValueFinderRawPlayer {
  playerId: string;
  playerName: string;
  position: VfPosition;
  team?: string;
  age?: number;
  season?: number;

  fantasyCalcValue?: number;
  ktcValue?: number;
  customValue?: number;

  fantasyPoints?: number;
  pointsPerGame?: number;
  fantasyPointsPerGame?: number;
  gamesPlayed?: number;
  vor?: number;

  // 0–1 composite usage signal from StatChasers (preferred by the model).
  usageScore?: number;
  snapShare?: number;
  redZoneTouches?: number;
  redZoneTargets?: number;
  goalLineTouches?: number;
  dropbacks?: number;
  designedRushAttempts?: number;

  marketValueChange7d?: number;
  marketValueChange30d?: number;
  marketValueChange90d?: number;
  // Trajectory signals (≈ percentage-point scale; the model percentiles them
  // within each position cohort, and the UI shows them as % trends).
  usageTrend?: number;
  roleTrend?: number;
  productionTrend?: number;
}

// StatChasers data only exists for these seasons; clamp anything else.
const STATCHASERS_YEARS = new Set([2023, 2024, 2025]);
const STATCHASERS_BASE =
  "https://raw.githubusercontent.com/statchasersff-bit/statchasers-data/master/statchasers-data/output";

// Replacement-level rank per position for a 12-team league (≈ last startable
// player). VOR = season PPR points minus this baseline. Indices are 0-based.
const REPLACEMENT_RANK: Record<VfPosition, number> = { QB: 11, RB: 23, WR: 35, TE: 11 };

type StatChasersRow = Record<string, unknown>;

// StatChasers ships roleTrend as a qualitative label; map it to a signed
// ≈[-8,8] value (the client model reads roleTrend on that scale). Labels that
// convey no direction ("Insufficient Data", "Limited Sample", null) stay
// undefined so the cohort isn't anchored on a fake zero.
const ROLE_TREND_NUM: Record<string, number> = {
  "Rising Fast": 8,
  "Trending Up": 4,
  Rising: 4,
  Stable: 0,
  "Boom/Bust Role": 0,
  Declining: -4,
  "Trending Down": -4,
  "Falling Fast": -8,
};

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** StatChasers snapPct ships as a 0–1 fraction for WR/TE but a percent for RB;
 *  normalize everything to a 0–1 share. */
function normShare(v: unknown): number | undefined {
  const n = num(v);
  if (n == null) return undefined;
  return n > 1.5 ? n / 100 : n;
}

/** Normalize a snap-share delta to percentage points: WR/TE ship it as a 0–1
 *  fraction change, RB as percentage points already. */
function normDeltaPoints(v: unknown): number | undefined {
  const n = num(v);
  if (n == null) return undefined;
  return Math.abs(n) <= 1.5 ? Math.round(n * 100 * 10) / 10 : Math.round(n * 10) / 10;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Load StatChasers usage rows for one position+season, keyed by Sleeper ID
 *  (their `playerId` IS the Sleeper ID). Returns {} on any failure. */
async function fetchUsage(
  pos: VfPosition,
  season: number,
): Promise<Record<string, StatChasersRow>> {
  const year = STATCHASERS_YEARS.has(season) ? season : 2025;
  const url = `${STATCHASERS_BASE}/positions/${pos.toLowerCase()}/usage_${year}.json`;
  try {
    const json = await fetchJsonWithTimeout(url, 8_000);
    const rows: StatChasersRow[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.rows)
        ? json.rows
        : [];
    const out: Record<string, StatChasersRow> = {};
    for (const r of rows) {
      const id = r?.["playerId"];
      if (typeof id === "string" && id) out[id] = r;
      else if (typeof id === "number") out[String(id)] = r;
    }
    return out;
  } catch (err) {
    console.warn(`[ValueFinder] StatChasers usage fetch failed (${pos} ${year}):`, err);
    return {};
  }
}

/** Map a StatChasers usage row onto the raw ValueFinder usage fields. */
function applyUsage(p: ValueFinderRawPlayer, row: StatChasersRow): void {
  const usageScore = num(row["usageScore"]);
  if (usageScore != null) p.usageScore = Math.min(1, Math.max(0, usageScore / 100));

  const snap = normShare(row["snapPct"]);
  if (snap != null) p.snapShare = snap;

  // Role-trajectory label → signed numeric trend.
  const roleLabel = row["roleTrend"];
  if (typeof roleLabel === "string" && roleLabel in ROLE_TREND_NUM) {
    p.roleTrend = ROLE_TREND_NUM[roleLabel];
  }

  if (p.position === "RB") {
    const rzt = num(row["redZoneTouches"]);
    if (rzt != null) p.redZoneTouches = rzt;
    const gl = num(row["goalLineAttempts"]);
    if (gl != null) p.goalLineTouches = gl;
    const ut = normDeltaPoints(row["deltaSnapPct"]);
    if (ut != null) p.usageTrend = ut;
  } else if (p.position === "WR" || p.position === "TE") {
    const rzt = num(row["redZoneTargets"]);
    if (rzt != null) p.redZoneTargets = rzt;
    const ut = normDeltaPoints(row["deltaSnapPct"]);
    if (ut != null) p.usageTrend = ut;
  } else if (p.position === "QB") {
    // Per-game volume — the model percentiles these within the cohort, so
    // per-game (vs season totals) preserves the ordering it needs.
    const dpg = num(row["dropbacksPerGame"]);
    if (dpg != null) p.dropbacks = dpg;
    const rpg = num(row["rushAttemptsPerGame"]);
    if (rpg != null) p.designedRushAttempts = rpg;
    // QBs have no snap share; the dropbacks-per-game delta is the usage proxy.
    const ut = num(row["deltaDropbacksPerGame"]);
    if (ut != null) p.usageTrend = Math.round(ut * 10) / 10;
  }
}

/** PPG for a season-stats row, or undefined when the player had no games. */
function ppgOf(row: SleeperStatsRow | undefined): number | undefined {
  if (!row) return undefined;
  const fp = num(row.pts_ppr);
  const games = num(row.gms_active) ?? num(row.gp) ?? 0;
  if (fp == null || games <= 0) return undefined;
  return fp / games;
}

/** Attach Sleeper season production, a positional VOR baseline, and a
 *  year-over-year production trend (PPG % change vs the prior season). */
function applyProduction(
  players: ValueFinderRawPlayer[],
  stats: Record<string, SleeperStatsRow>,
  prevStats: Record<string, SleeperStatsRow>,
): void {
  for (const p of players) {
    const row = stats[p.playerId];
    if (!row) continue;
    const fp = num(row.pts_ppr);
    const games = num(row.gms_active) ?? num(row.gp) ?? 0;
    if (fp != null) p.fantasyPoints = Math.round(fp);
    if (games > 0) p.gamesPlayed = games;
    if (fp != null && games > 0) {
      const ppg = Math.round((fp / games) * 10) / 10;
      p.pointsPerGame = ppg;
      p.fantasyPointsPerGame = ppg;
    }

    // Year-over-year PPG change — a real production trajectory signal.
    const curPpg = ppgOf(row);
    const prevPpg = ppgOf(prevStats[p.playerId]);
    if (curPpg != null && prevPpg != null && prevPpg > 0) {
      p.productionTrend = Math.round(((curPpg - prevPpg) / prevPpg) * 100);
    }
  }

  // VOR: per position, baseline = points of the replacement-rank player.
  for (const pos of POSITIONS) {
    const cohort = players
      .filter((p) => p.position === pos && p.fantasyPoints != null)
      .sort((a, b) => (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0));
    if (cohort.length === 0) continue;
    const idx = Math.min(REPLACEMENT_RANK[pos], cohort.length - 1);
    const baseline = cohort[idx].fantasyPoints ?? 0;
    for (const p of cohort) {
      p.vor = Math.round((p.fantasyPoints ?? 0) - baseline);
    }
  }
}

/** Market-value % change maps (by sleeperId) for each trend window. Best-effort
 *  — value snapshots live in Postgres and may be sparse, so any failure or
 *  empty window simply yields no trend for that window. */
async function fetchTrendMaps(
  format: "sf" | "1qb",
): Promise<{ d7: Map<string, number>; d30: Map<string, number>; d90: Map<string, number> }> {
  const toMap = (rows: Array<{ sleeperId: string; changePct: number }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.sleeperId, r.changePct);
    return m;
  };
  try {
    const [c7, c30, c90] = await Promise.all([
      getValueChanges(format, "dynasty", 7),
      getValueChanges(format, "dynasty", 30),
      getValueChanges(format, "dynasty", 90),
    ]);
    return { d7: toMap(c7), d30: toMap(c30), d90: toMap(c90) };
  } catch (err) {
    console.warn("[ValueFinder] value-change trends unavailable:", err);
    return { d7: new Map(), d30: new Map(), d90: new Map() };
  }
}

// ── Base cache (everything except per-user custom values) ───────────────────
interface CacheEntry {
  builtAt: number;
  players: ValueFinderRawPlayer[];
}
const BASE_TTL_MS = 30 * 60 * 1000;
const baseCache = new Map<string, CacheEntry>();

async function buildBase(
  season: number,
  format: "sf" | "1qb",
): Promise<ValueFinderRawPlayer[]> {
  const [fc, ktc, stats, prevStats, trends, usageByPos] = await Promise.all([
    getFantasyCalcValues(format),
    getKtcValues(format),
    getSeasonStatsMap(season),
    getSeasonStatsMap(season - 1),
    fetchTrendMaps(format),
    Promise.all(POSITIONS.map((pos) => fetchUsage(pos, season))).then((arr) =>
      Object.fromEntries(POSITIONS.map((pos, i) => [pos, arr[i]])) as Record<
        VfPosition,
        Record<string, StatChasersRow>
      >,
    ),
  ]);

  // Universe = every skill-position player with a FantasyCalc or KTC value.
  const byId = new Map<string, ValueFinderRawPlayer>();
  const seed = (
    src: { sleeperId: string; name: string; pos: string; team: string; age: number },
    apply: (p: ValueFinderRawPlayer) => void,
  ) => {
    const pos = src.pos.toUpperCase();
    if (!POS_SET.has(pos)) return;
    let p = byId.get(src.sleeperId);
    if (!p) {
      p = {
        playerId: src.sleeperId,
        playerName: src.name,
        position: pos as VfPosition,
        team: src.team && src.team !== "FA" ? src.team : undefined,
        age: src.age > 0 ? src.age : undefined,
        season,
      };
      byId.set(src.sleeperId, p);
    }
    apply(p);
  };

  for (const pl of fc.players) seed(pl, (p) => { p.fantasyCalcValue = pl.value; });
  for (const pl of ktc.players) seed(pl, (p) => { p.ktcValue = pl.value; });

  const players = Array.from(byId.values());

  // Production + VOR + year-over-year production trend.
  applyProduction(players, stats, prevStats);

  // Usage.
  for (const p of players) {
    const row = usageByPos[p.position]?.[p.playerId];
    if (row) applyUsage(p, row);
  }

  // Market-value trends.
  for (const p of players) {
    const d7 = trends.d7.get(p.playerId);
    const d30 = trends.d30.get(p.playerId);
    const d90 = trends.d90.get(p.playerId);
    if (d7 != null) p.marketValueChange7d = d7;
    if (d30 != null) p.marketValueChange30d = d30;
    if (d90 != null) p.marketValueChange90d = d90;
  }

  return players;
}

async function getBase(
  season: number,
  format: "sf" | "1qb",
): Promise<ValueFinderRawPlayer[]> {
  const key = `${season}:${format}`;
  const hit = baseCache.get(key);
  if (hit && Date.now() - hit.builtAt < BASE_TTL_MS) return hit.players;
  const players = await buildBase(season, format);
  baseCache.set(key, { builtAt: Date.now(), players });
  return players;
}

export interface ValueFinderQuery {
  season?: number;
  format?: "sf" | "1qb";
  userId?: string;
}

/**
 * Full Value Finder player pool. Returns shallow clones of the cached base with
 * the requesting user's active custom values (if any) overlaid, so the cache is
 * shared across users while custom values stay per-request.
 */
export async function getValueFinderPlayers(
  query: ValueFinderQuery = {},
): Promise<ValueFinderRawPlayer[]> {
  const season = query.season ?? 2025;
  const format = query.format === "1qb" ? "1qb" : "sf";
  const base = await getBase(season, format);

  let customById: Record<string, number> | null = null;
  if (query.userId) {
    try {
      const resolved = await getResolvedValues(query.userId);
      customById = resolved.dynasty?.valuesBySleeperId ?? null;
    } catch (err) {
      console.warn("[ValueFinder] custom values unavailable:", err);
    }
  }

  return base.map((p) => {
    const clone: ValueFinderRawPlayer = { ...p };
    if (customById) {
      const cv = customById[p.playerId];
      if (typeof cv === "number") clone.customValue = cv;
    }
    return clone;
  });
}
