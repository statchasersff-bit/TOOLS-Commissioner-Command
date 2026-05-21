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

type SleeperStatsRow = {
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
  fantasy_points: number;
  ppg: number;
  positional_finish: string | null;
}

export type ScoringKey = "ppr" | "half_ppr" | "std";

function pickPoints(row: SleeperStatsRow | undefined | null, scoring: ScoringKey): number {
  if (!row) return 0;
  if (scoring === "ppr")      return row.pts_ppr      ?? row.pts_half_ppr ?? row.pts_std      ?? 0;
  if (scoring === "half_ppr") return row.pts_half_ppr ?? row.pts_ppr      ?? row.pts_std      ?? 0;
  return                              row.pts_std      ?? row.pts_half_ppr ?? row.pts_ppr      ?? 0;
}

/** Number of past seasons we backfill. Five gives a clear five-year trend
 *  without exploding cache size (each season payload is ~3-5 MB). */
const SEASONS_TO_FETCH = 5;
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
  // We pull "previous N completed seasons" — never the in-progress year,
  // which would mix mid-season partial totals into a "career" table.
  const seasons = Array.from({ length: SEASONS_TO_FETCH }, (_, i) => currentYear - 1 - i)
    .filter((s) => s >= 2018);

  const results: ProductionSeason[] = [];

  for (const season of seasons) {
    const seasonStats = await fetchSeasonStats(season);
    const myRow = seasonStats[playerId];
    if (!myRow) continue;
    const pts = pickPoints(myRow, scoring);
    const games = (myRow.gms_active ?? myRow.gp ?? 0) as number;
    if (pts <= 0 && games <= 0) continue;

    // Positional finish — rank everyone at this position by their
    // same-scoring season total. Filtered by MIN_GAMES_FOR_RANK so an
    // injured 2-game player can't sneak into the top 5 on a tiny sample.
    let positional_finish: string | null = null;
    if (myPos) {
      const peers: Array<{ pid: string; pts: number }> = [];
      for (const pid of Object.keys(seasonStats)) {
        const peerPos = (allPlayers[pid] as unknown as Record<string, unknown> | undefined)?.position;
        if (peerPos !== myPos) continue;
        const row = seasonStats[pid];
        const g = (row?.gms_active ?? row?.gp ?? 0) as number;
        if (g < MIN_GAMES_FOR_RANK && pid !== playerId) continue;
        const p = pickPoints(row, scoring);
        if (p <= 0 && pid !== playerId) continue;
        peers.push({ pid, pts: p });
      }
      peers.sort((a, b) => b.pts - a.pts);
      const rank = peers.findIndex((x) => x.pid === playerId);
      if (rank >= 0) positional_finish = `${myPos}${rank + 1}`;
    }

    results.push({
      season,
      team: (myRow.team as string | null | undefined) ?? myTeamFallback,
      games,
      fantasy_points: Math.round(pts * 10) / 10,
      ppg: games > 0 ? Math.round((pts / games) * 10) / 10 : 0,
      positional_finish,
    });
  }

  // Newest season first — matches how the modal renders the table.
  return results.sort((a, b) => b.season - a.season);
}
