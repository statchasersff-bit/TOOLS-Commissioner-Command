import type { Projection } from "./types";
import { fetchBuiltInCSV } from "./builtin";
import { buildProjectionIndex, normalizePos } from "./projections";
import { fetchJSON } from "./sleeper";

export type ProjectionSource = "statchasers" | "sleeper";
export type FallbackMode = "fallback_to_statchasers" | "zero" | "exclude";

export const TOP_N_LIMITS: Record<string, number> = {
  QB: 50,
  RB: 140,
  WR: 190,
  TE: 60,
  K: 36,
  DEF: 36,
};

export interface ProjectionProviderOptions {
  season: string;
  week: string | number;
  source: ProjectionSource;
  fallbackMode: FallbackMode;
  playersIndex?: Record<string, any>;
}

export interface PoolBreakdown {
  [pos: string]: { kept: number; limit: number };
}

export interface ProjectionResult {
  projections: Projection[];
  source: ProjectionSource;
  stats: {
    total: number;
    fromPrimary: number;
    fromFallback: number;
    excluded: number;
  };
  pool?: PoolBreakdown;
  cachedAt?: number;
}

const sleeperCache: Record<string, { data: any[]; timestamp: number }> = {};
const CACHE_TTL = 30 * 60 * 1000;

function getCacheKey(season: string, week: string | number): string {
  return `sleeper:${season}:${week}`;
}

export async function fetchSleeperProjections(
  season: string,
  week: string | number
): Promise<any[]> {
  const key = getCacheKey(season, week);
  const cached = sleeperCache[key];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[SleeperProvider] Using cached projections (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
    return cached.data;
  }

  console.log(`[SleeperProvider] Fetching projections for ${season} W${week}`);
  const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`;
  const data = await fetchJSON<any[]>(url);
  console.log(`[SleeperProvider] Got ${data?.length ?? 0} projection records`);

  sleeperCache[key] = { data: data || [], timestamp: Date.now() };
  return data || [];
}

export function getSleeperCacheTimestamp(season: string, week: string | number): number | null {
  const key = getCacheKey(season, week);
  return sleeperCache[key]?.timestamp ?? null;
}

export function clearSleeperCache(season?: string, week?: string | number): void {
  if (season && week) {
    delete sleeperCache[getCacheKey(season, week)];
  } else {
    for (const key of Object.keys(sleeperCache)) {
      delete sleeperCache[key];
    }
  }
}

function sleeperRowToProjection(
  row: any,
  playersIndex: Record<string, any>
): Projection | null {
  const playerId = row.player_id?.toString();
  if (!playerId) return null;

  const playerInfo = playersIndex[playerId];
  if (!playerInfo) return null;

  const name = [playerInfo.first_name, playerInfo.last_name].filter(Boolean).join(" ")
    || playerInfo.full_name || `Player ${playerId}`;
  const pos = normalizePos(playerInfo.position || playerInfo.fantasy_positions?.[0] || "");
  if (!pos) return null;

  const rowStats = row.stats || {};

  const stats: Record<string, number> = {};
  const statMap: Record<string, string> = {
    pass_att: "pass_att",
    pass_cmp: "pass_comp",
    pass_yd: "pass_yd",
    pass_td: "pass_td",
    pass_int: "pass_int",
    rush_att: "rush_att",
    rush_yd: "rush_yd",
    rush_td: "rush_td",
    rec: "rec",
    rec_yd: "rec_yd",
    rec_td: "rec_td",
    fum_lost: "fum_lost",
    fum: "fum_lost",
    pass_2pt: "two_pt",
    rush_2pt: "two_pt",
    rec_2pt: "two_pt",
    xpm: "xpm",
    xpa: "xpa",
    fgm_0_19: "fgm_0_19",
    fgm_20_29: "fgm_20_29",
    fgm_30_39: "fgm_30_39",
    fgm_40_49: "fgm_40_49",
    fgm_50p: "fgm_50p",
    sack: "sacks",
    def_int: "defs_int",  
    fum_rec: "defs_fum_rec",
    def_td: "defs_td",
    safe: "safety",
    blk_kick: "blk_kick",
    def_st_td: "ret_td",
    pts_allow: "pts_allowed",
  };

  for (const [sleeperKey, ourKey] of Object.entries(statMap)) {
    const val = rowStats[sleeperKey];
    if (val !== undefined && val !== null && Number.isFinite(Number(val))) {
      if (ourKey === "two_pt") {
        stats[ourKey] = (stats[ourKey] || 0) + Number(val);
      } else {
        stats[ourKey] = Number(val);
      }
    }
  }

  const proj = rowStats.pts_ppr ?? rowStats.pts_half_ppr ?? rowStats.pts_std ?? 0;

  const team = (playerInfo.team || "").toUpperCase();
  const opp = row.opponent || "";

  return {
    sleeper_id: playerId,
    name,
    team: team || undefined,
    pos,
    proj: Number(proj) || 0,
    opp: opp || undefined,
    stats,
  };
}

function applyTopNFilter(projections: Projection[]): { filtered: Projection[]; pool: PoolBreakdown } {
  const byPos: Record<string, Projection[]> = {};
  for (const p of projections) {
    const pos = (p.pos || "").toUpperCase();
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push(p);
  }

  const filtered: Projection[] = [];
  const pool: PoolBreakdown = {};

  for (const [pos, players] of Object.entries(byPos)) {
    const limit = TOP_N_LIMITS[pos];
    if (limit === undefined) {
      filtered.push(...players);
      continue;
    }
    players.sort((a, b) => (b.proj || 0) - (a.proj || 0));
    const kept = players.slice(0, limit);
    filtered.push(...kept);
    pool[pos] = { kept: kept.length, limit };
  }

  console.log(`[TopN] Pool: ${filtered.length} players — ${Object.entries(pool).map(([p, v]) => `${p}: ${v.kept}/${v.limit}`).join(", ")}`);
  return { filtered, pool };
}

async function fetchStatChasersProjections(
  season: string,
  week: string | number
): Promise<Projection[]> {
  const rows = await fetchBuiltInCSV(season, week);
  return rows as Projection[];
}

export async function getProjections(
  options: ProjectionProviderOptions
): Promise<ProjectionResult> {
  const { season, week, source, fallbackMode, playersIndex } = options;

  if (source === "statchasers") {
    const projections = await fetchStatChasersProjections(season, week);
    return {
      projections,
      source: "statchasers",
      stats: {
        total: projections.length,
        fromPrimary: projections.length,
        fromFallback: 0,
        excluded: 0,
      },
    };
  }

  if (!playersIndex || Object.keys(playersIndex).length === 0) {
    console.warn("[SleeperProvider] No players index available, falling back to StatChasers");
    const projections = await fetchStatChasersProjections(season, week);
    return {
      projections,
      source: "statchasers",
      stats: {
        total: projections.length,
        fromPrimary: projections.length,
        fromFallback: 0,
        excluded: 0,
      },
    };
  }

  const sleeperRaw = await fetchSleeperProjections(season, week);
  const sleeperProjections: Projection[] = [];

  for (const row of sleeperRaw) {
    const proj = sleeperRowToProjection(row, playersIndex);
    if (proj) {
      sleeperProjections.push(proj);
    }
  }

  console.log(`[SleeperProvider] Converted ${sleeperProjections.length} Sleeper projections`);

  let allProjections: Projection[] = [...sleeperProjections];
  let fromFallback = 0;

  if (fallbackMode === "fallback_to_statchasers") {
    let statchasersProjections: Projection[] = [];
    try {
      statchasersProjections = await fetchStatChasersProjections(season, week);
    } catch (e) {
      console.warn("[SleeperProvider] Could not load StatChasers fallback:", e);
    }

    const sleeperIds = new Set(sleeperProjections.map(p => p.sleeper_id).filter(Boolean));
    for (const sc of statchasersProjections) {
      if (sc.sleeper_id && !sleeperIds.has(sc.sleeper_id)) {
        allProjections.push(sc);
        fromFallback++;
      }
    }
    console.log(`[SleeperProvider] Merged: ${sleeperProjections.length} Sleeper + ${fromFallback} StatChasers fallback = ${allProjections.length} total`);
  } else if (fallbackMode === "exclude") {
    allProjections = allProjections.filter(p => p.proj > 0);
  }

  const beforeTopN = allProjections.length;
  const { filtered, pool } = applyTopNFilter(allProjections);
  const excluded = beforeTopN - filtered.length;

  return {
    projections: filtered,
    source: "sleeper",
    stats: {
      total: filtered.length,
      fromPrimary: filtered.length - fromFallback,
      fromFallback,
      excluded,
    },
    pool,
    cachedAt: getSleeperCacheTimestamp(season, week) ?? undefined,
  };
}
