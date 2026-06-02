/**
 * Per-player Sleeper metadata + season-stats lookups for the ADP Explorer
 * player modal. Two responsibilities:
 *
 *   getPlayerMetadata(playerId)
 *     Single-player normalized read from the cached /players/nfl payload.
 *     Surfaces age, years_exp, injury_status, college, height/weight, etc.
 *     so the modal header isn't limited to whatever fields ADP rows carry.
 *
 *   getPlayerProduction(playerId, scoring)
 *     Per-season fantasy production from Sleeper's
 *     /v1/stats/nfl/regular/{season} endpoint, which IS season-totals for
 *     every player and is freely callable. Cached on disk per-season since
 *     the payload is large and changes infrequently outside the live
 *     in-season window.
 *
 * Both reads are deliberately read-only against Sleeper's public API — no
 * auth, no league context required. Caching is on-disk so the cache
 * survives process restarts; the existing /players/nfl cache uses the same
 * pattern (server/sleeper.ts).
 */

import fs from "fs";
import path from "path";
import { getSleeperPlayers } from "./sleeper";

const SLEEPER_API = "https://api.sleeper.app/v1";
const STATS_CACHE_DIR = path.join(process.cwd(), ".cache", "sleeper-stats");
// Season totals don't move much outside the live in-season window. Daily TTL
// is plenty during the season and effectively permanent after it ends.
const STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function ensureCacheDir() {
  try { fs.mkdirSync(STATS_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

function statsCachePath(season: number): string {
  return path.join(STATS_CACHE_DIR, `regular-${season}.json`);
}

export type SleeperStatsRow = {
  team?: string | null;
  pts_ppr?: number | null;
  pts_half_ppr?: number | null;
  pts_std?: number | null;
  gms_active?: number | null;
  gp?: number | null;
};

async function fetchSeasonStats(season: number): Promise<Record<string, SleeperStatsRow>> {
  ensureCacheDir();
  const p = statsCachePath(season);
  try {
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs < STATS_CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch { /* fall through to network */ }

  const url = `${SLEEPER_API}/stats/nfl/regular/${season}`;
  const r = await fetch(url);
  if (!r.ok) {
    // Treat missing seasons as empty rather than throwing — historical
    // payloads sometimes lag on Sleeper's side. Caller skips empty seasons.
    return {};
  }
  const data = (await r.json()) as Record<string, SleeperStatsRow>;
  try { fs.writeFileSync(p, JSON.stringify(data), "utf-8"); } catch { /* ignore */ }
  return data;
}

/**
 * Bulk read of Sleeper season totals for every player, keyed by Sleeper ID.
 * Shares the same on-disk per-season cache used by getPlayerProduction, so
 * callers that need season totals for the whole player pool (e.g. the Value
 * Finder aggregator) pay the cold fetch once and reuse it. Returns an empty
 * map when Sleeper has no data for the season rather than throwing.
 */
export async function getSeasonStatsMap(
  season: number,
): Promise<Record<string, SleeperStatsRow>> {
  return fetchSeasonStats(season);
}

export interface PlayerMetadata {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  injury_status: string | null;
  fantasy_positions: string[] | null;
  active: boolean;
  college: string | null;
  height: string | null;
  weight: string | null;
  birth_date: string | null;
  number: number | null;
  status: string | null;
  /** Derived: current calendar year minus years_exp. Null when we can't
   *  infer (e.g. years_exp not present). Used by the UI rookie badge. */
  rookie_year: number | null;
}

export async function getPlayerMetadata(playerId: string): Promise<PlayerMetadata | null> {
  const all = await getSleeperPlayers();
  const raw = all[playerId] as unknown as Record<string, unknown> | undefined;
  if (!raw) return null;

  const yearsExpRaw = raw.years_exp;
  const yearsExp = typeof yearsExpRaw === "number" ? yearsExpRaw : null;
  const currentYear = new Date().getFullYear();
  const rookie_year = yearsExp != null ? currentYear - yearsExp : null;

  const firstName = (raw.first_name as string | null | undefined) ?? "";
  const lastName = (raw.last_name as string | null | undefined) ?? "";
  const fullName = (raw.full_name as string | null | undefined) ?? `${firstName} ${lastName}`.trim();

  return {
    player_id: (raw.player_id as string | undefined) ?? playerId,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    position: (raw.position as string | null | undefined) ?? null,
    team: (raw.team as string | null | undefined) ?? null,
    age: typeof raw.age === "number" ? (raw.age as number) : null,
    years_exp: yearsExp,
    injury_status: (raw.injury_status as string | null | undefined) ?? null,
    fantasy_positions: (raw.fantasy_positions as string[] | null | undefined) ?? null,
    active: raw.active !== false,
    college: (raw.college as string | null | undefined) ?? null,
    height: (raw.height as string | null | undefined) ?? null,
    weight: (raw.weight as string | null | undefined) ?? null,
    birth_date: (raw.birth_date as string | null | undefined) ?? null,
    number: typeof raw.number === "number" ? (raw.number as number) : null,
    status: (raw.status as string | null | undefined) ?? null,
    rookie_year,
  };
}

export interface ProductionSeason {
  season: number;
  team: string | null;
  games: number;
  // Fantasy PPG by scoring format (null when the player had no games).
  ppgStd: number | null;
  ppgHalf: number | null;
  ppgPpr: number | null;
  // Positional finish (1 = best) by scoring format, ranked on season TOTAL.
  finishStd: number | null;
  finishHalf: number | null;
  finishPpr: number | null;
  // Positional finish ranked on points-per-game (min-games gated). Null when unranked.
  ppgFinishStd: number | null;
  ppgFinishHalf: number | null;
  ppgFinishPpr: number | null;
}

export type ScoringKey = "ppr" | "half_ppr" | "std";

function pickPoints(row: SleeperStatsRow | undefined | null, scoring: ScoringKey): number {
  if (!row) return 0;
  if (scoring === "ppr")      return row.pts_ppr      ?? row.pts_half_ppr ?? row.pts_std      ?? 0;
  if (scoring === "half_ppr") return row.pts_half_ppr ?? row.pts_ppr      ?? row.pts_std      ?? 0;
  return                              row.pts_std      ?? row.pts_half_ppr ?? row.pts_ppr      ?? 0;
}

/** Fallback lookback (in seasons) used only when we can't derive a player's
 *  rookie year from Sleeper years_exp. */
const SEASONS_TO_FETCH = 5;
/** Earliest season Sleeper exposes usable season totals. Career lookback is
 *  clamped here so we never fan out into empty pre-history. Verified that
 *  /stats/nfl/regular/{season} returns data back to at least 2009. */
const STATS_DATA_FLOOR = 2009;
/** Minimum games for a player to be included in the positional-finish
 *  ranking. Filters out cup-of-coffee rosters that would otherwise pad the
 *  ranks and make a real RB1 look like an RB6. */
const MIN_GAMES_FOR_RANK = 4;

export async function getPlayerProduction(
  playerId: string,
  scoring: ScoringKey = "ppr",
): Promise<ProductionSeason[]> {
  const allPlayers = await getSleeperPlayers();
  const meRaw = allPlayers[playerId] as unknown as Record<string, unknown> | undefined;
  if (!meRaw) return [];
  const myPos = (meRaw.position as string | null | undefined) ?? null;
  const myTeamFallback = (meRaw.team as string | null | undefined) ?? null;

  const currentYear = new Date().getFullYear();
  const lastCompleted = currentYear - 1; // never the in-progress year

  // Cover the player's entire NFL career rather than a fixed recent window.
  // Sleeper years_exp counts completed seasons, so debut ≈ currentYear -
  // years_exp; we subtract one extra year as a buffer against Sleeper lagging
  // its offseason increment (extra empty seasons are simply skipped below).
  // When years_exp is unknown, fall back to the old N-season lookback. Clamp
  // to STATS_DATA_FLOOR so we never fan out into empty pre-history.
  const yearsExp = meRaw.years_exp;
  const careerStart = typeof yearsExp === "number" && yearsExp >= 0
    ? currentYear - yearsExp - 1
    : lastCompleted - (SEASONS_TO_FETCH - 1);
  const firstSeason = Math.max(STATS_DATA_FLOOR, careerStart);

  const seasons: number[] = [];
  for (let s = lastCompleted; s >= firstSeason; s--) seasons.push(s);

  // Fetch every season payload up front in parallel. They're large (~3-5 MB)
  // but cached on disk per-season and shared across all players, so the cold
  // cost is paid once; sequential fetching would make a long career's first
  // load very slow.
  const seasonStatsList = await Promise.all(seasons.map((s) => fetchSeasonStats(s)));

  const results: ProductionSeason[] = [];

  for (let si = 0; si < seasons.length; si++) {
    const season = seasons[si];
    const seasonStats = seasonStatsList[si];
    const myRow = seasonStats[playerId];
    if (!myRow) continue;
    // Games PLAYED (gp), not gms_active — gms_active counts every active-roster
    // week (17 even after a season-ending injury), which deflates PPG.
    const games = (myRow.gp ?? myRow.gms_active ?? 0) as number;
    const myStd = pickPoints(myRow, "std");
    const myHalf = pickPoints(myRow, "half_ppr");
    const myPpr = pickPoints(myRow, "ppr");
    if (myStd <= 0 && myHalf <= 0 && myPpr <= 0 && games <= 0) continue;

    // Positional finish per scoring format — rank everyone at this position by
    // that format's season total. Peers are collected once (filtered by
    // MIN_GAMES_FOR_RANK so an injured 2-game player can't pad the ranks),
    // then ranked three times.
    let finishStd: number | null = null, finishHalf: number | null = null, finishPpr: number | null = null;
    let ppgFinishStd: number | null = null, ppgFinishHalf: number | null = null, ppgFinishPpr: number | null = null;
    if (myPos) {
      const peers: Array<{ pid: string; std: number; half: number; ppr: number; games: number }> = [];
      for (const pid of Object.keys(seasonStats)) {
        const peerPos = (allPlayers[pid] as unknown as Record<string, unknown> | undefined)?.position;
        if (peerPos !== myPos) continue;
        const row = seasonStats[pid];
        const g = (row?.gp ?? row?.gms_active ?? 0) as number;
        if (g < MIN_GAMES_FOR_RANK && pid !== playerId) continue;
        const std = pickPoints(row, "std"), half = pickPoints(row, "half_ppr"), ppr = pickPoints(row, "ppr");
        if (std <= 0 && half <= 0 && ppr <= 0 && pid !== playerId) continue;
        peers.push({ pid, std, half, ppr, games: g });
      }
      // Total-based finish: rank by season total.
      const rankBy = (key: "std" | "half" | "ppr"): number | null => {
        const idx = [...peers].sort((a, b) => b[key] - a[key]).findIndex((x) => x.pid === playerId);
        return idx >= 0 ? idx + 1 : null;
      };
      // PPG-based finish: rank by points-per-game (only peers with games).
      const ppgRankBy = (key: "std" | "half" | "ppr"): number | null => {
        const idx = peers
          .filter((p) => p.games > 0)
          .sort((a, b) => b[key] / b.games - a[key] / a.games)
          .findIndex((x) => x.pid === playerId);
        return idx >= 0 ? idx + 1 : null;
      };
      finishStd = rankBy("std");
      finishHalf = rankBy("half");
      finishPpr = rankBy("ppr");
      ppgFinishStd = ppgRankBy("std");
      ppgFinishHalf = ppgRankBy("half");
      ppgFinishPpr = ppgRankBy("ppr");
    }

    const ppgOf = (pts: number): number | null => (games > 0 ? Math.round((pts / games) * 10) / 10 : null);
    results.push({
      season,
      team: (myRow.team as string | null | undefined) ?? myTeamFallback,
      games,
      ppgStd: ppgOf(myStd),
      ppgHalf: ppgOf(myHalf),
      ppgPpr: ppgOf(myPpr),
      finishStd,
      finishHalf,
      finishPpr,
      ppgFinishStd,
      ppgFinishHalf,
      ppgFinishPpr,
    });
  }

  // Newest season first — matches how the table renders.
  return results.sort((a, b) => b.season - a.season);
}

// ── Week-by-week game logs ────────────────────────────────────────────────────
// Backed by Sleeper's per-player weekly stats endpoint. NOTE: this endpoint is
// on api.sleeper.com (not the documented /v1 host) and is NOT part of Sleeper's
// officially-supported API — it works today but may change/break without
// notice. We cache per player+season+type on disk: a short TTL for the live
// (current) season, effectively permanent for completed seasons.
const GAMELOG_CACHE_DIR = path.join(process.cwd(), ".cache", "sleeper-gamelogs");
const GAMELOG_TTL_CURRENT_MS = 30 * 60 * 1000;        // 30 min in-season
const GAMELOG_TTL_PAST_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days offseason/historical

export type GameLogSeasonType = "regular" | "post";

export interface GameLogRow {
  week: number;
  opponent: string | null;
  team: string | null;
  ptsPPR: number | null;
  ptsHalf: number | null;
  ptsStd: number | null;
  passCmp: number; passAtt: number; passYd: number; passTd: number; passInt: number;
  rushAtt: number; rushYd: number; rushTd: number;
  tgt: number; rec: number; recYd: number; recTd: number;
  snapPct: number | null;
}

function ensureGamelogDir() {
  try { fs.mkdirSync(GAMELOG_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}
function gamelogCachePath(playerId: string, season: number, type: GameLogSeasonType): string {
  return path.join(GAMELOG_CACHE_DIR, `${type}-${season}-${playerId}.json`);
}
/** NFL season year — Aug onward counts as the new season. */
function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}
function gnum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function normalizeGameLogs(data: Record<string, any>): GameLogRow[] {
  const rows: GameLogRow[] = [];
  for (const [week, entry] of Object.entries(data || {})) {
    if (!entry) continue; // bye / DNP weeks come back null
    const e = entry as any;
    const s = (e.stats ?? e) as Record<string, any>;
    const wk = Number(e.week ?? week);
    if (!Number.isFinite(wk)) continue;
    const offSnp = gnum(s.off_snp);
    const tmOff = gnum(s.tm_off_snp);
    rows.push({
      week: wk,
      opponent: e.opponent ?? null,
      team: e.team ?? null,
      ptsPPR: s.pts_ppr ?? null,
      ptsHalf: s.pts_half_ppr ?? null,
      ptsStd: s.pts_std ?? null,
      passCmp: gnum(s.pass_cmp), passAtt: gnum(s.pass_att), passYd: gnum(s.pass_yd),
      passTd: gnum(s.pass_td), passInt: gnum(s.pass_int),
      rushAtt: gnum(s.rush_att), rushYd: gnum(s.rush_yd), rushTd: gnum(s.rush_td),
      tgt: gnum(s.rec_tgt), rec: gnum(s.rec), recYd: gnum(s.rec_yd), recTd: gnum(s.rec_td),
      snapPct: tmOff > 0 ? Math.round((offSnp / tmOff) * 100) : null,
    });
  }
  return rows.sort((a, b) => a.week - b.week);
}

export async function getPlayerGameLogs(
  playerId: string,
  season: number,
  seasonType: GameLogSeasonType = "regular",
): Promise<GameLogRow[]> {
  ensureGamelogDir();
  const cachePath = gamelogCachePath(playerId, season, seasonType);
  const ttl = season >= currentNflSeason() ? GAMELOG_TTL_CURRENT_MS : GAMELOG_TTL_PAST_MS;
  try {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < ttl) {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    }
  } catch { /* fall through to network */ }

  const url = `https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(playerId)}?season_type=${seasonType}&season=${season}&grouping=week`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Sleeper stats request failed: ${r.status}`);
  }
  const data = (await r.json()) as Record<string, any>;
  const rows = normalizeGameLogs(data);
  try { fs.writeFileSync(cachePath, JSON.stringify(rows), "utf-8"); } catch { /* ignore */ }
  return rows;
}
