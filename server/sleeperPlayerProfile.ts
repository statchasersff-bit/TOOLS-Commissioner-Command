/**
 * Sleeper season-stats lookups — per-season fantasy totals from Sleeper's
 * /v1/stats/nfl/regular/{season} endpoint (season totals for every player,
 * freely callable). Read-only against Sleeper's public API: no auth, no league
 * context. Cached on disk per-season since the payload is large and changes
 * infrequently outside the live in-season window, so the cache survives
 * process restarts (same pattern as the /players/nfl cache in server/sleeper.ts).
 *
 * Consumed by the Value Finder aggregator (getSeasonStatsMap), which needs
 * season totals for the whole player pool.
 */

import fs from "fs";
import path from "path";

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
 * Callers that need season totals for the whole player pool (e.g. the Value
 * Finder aggregator) pay the cold fetch once and reuse the on-disk per-season
 * cache. Returns an empty map when Sleeper has no data for the season rather
 * than throwing.
 */
export async function getSeasonStatsMap(
  season: number,
): Promise<Record<string, SleeperStatsRow>> {
  return fetchSeasonStats(season);
}

export type ScoringKey = "ppr" | "half_ppr" | "std";
