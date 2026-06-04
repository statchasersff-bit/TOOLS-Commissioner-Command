/**
 * Cached, rate-limit-aware Sleeper API wrapper for League Activity Monitoring.
 *
 * Sleeper warns about excessive call frequency, and a single activity scan can
 * touch many endpoints (users, rosters, plus matchups + transactions per week).
 * This wrapper adds:
 *   • a 10s timeout per request
 *   • one retry on 5xx (NOT on 429 — we back off instead of hammering)
 *   • an in-process TTL cache so repeated scans / multi-league dashboards reuse
 *     recent responses (rosters/users 15m, matchups/transactions 10m, NFL state 5m)
 *
 * The cache is intentionally in-memory (per server instance). It is a politeness
 * / latency optimization, not a source of truth — every scan still persists its
 * results to Postgres.
 */
import type {
  SleeperTransaction,
  SleeperRoster,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperNflState,
} from "./types";

const SLEEPER_BASE_URL = "https://api.sleeper.app/v1";
const TIMEOUT_MS = 10_000;

const TTL = {
  usersRosters: 15 * 60_000,
  weekly: 10 * 60_000,
  nflState: 5 * 60_000,
  league: 15 * 60_000,
} as const;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Drop every cached entry for one league (called after a forced refresh). */
export function invalidateLeagueCache(leagueId: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.includes(`:league:${leagueId}:`)) cache.delete(key);
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Low-level GET with cache, timeout, and a single 5xx retry. Sleeper returns
 * `null` (HTTP 200) for empty collections (e.g. a week with no transactions);
 * callers receive that null and coalesce to []. A 404 also coalesces to the
 * provided empty value rather than throwing — preseason leagues legitimately
 * 404 on matchups/transactions.
 */
async function sleeperGet<T>(
  path: string,
  cacheKey: string,
  ttlMs: number,
  emptyValue: T,
  forceRefresh = false,
): Promise<T> {
  if (!forceRefresh) {
    const hit = getCached<T>(cacheKey);
    if (hit !== undefined) return hit;
  }

  const url = `${SLEEPER_BASE_URL}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.status === 404) {
        setCached(cacheKey, emptyValue, ttlMs);
        return emptyValue;
      }
      if (res.status === 429) {
        // Do NOT retry aggressively on rate limit — surface and let the caller
        // (or the next scheduled scan) try later.
        throw new Error(`Sleeper rate limit (429) for ${path}`);
      }
      if (res.status >= 500) {
        lastErr = new Error(`Sleeper ${res.status} for ${path}`);
        continue; // retry once on 5xx
      }
      if (!res.ok) {
        throw new Error(`Sleeper ${res.status} for ${path}`);
      }
      const json = (await res.json()) as T | null;
      const value = (json ?? emptyValue) as T;
      setCached(cacheKey, value, ttlMs);
      return value;
    } catch (err) {
      lastErr = err;
      // AbortError / network — allow the loop to retry once.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Sleeper request failed: ${path}`);
}

export async function getNflState(forceRefresh = false): Promise<SleeperNflState> {
  return sleeperGet<SleeperNflState>(
    "/state/nfl",
    "sleeper:state:nfl",
    TTL.nflState,
    {},
    forceRefresh,
  );
}

export async function getLeague(leagueId: string, forceRefresh = false): Promise<Record<string, any>> {
  return sleeperGet<Record<string, any>>(
    `/league/${leagueId}`,
    `sleeper:league:${leagueId}:meta`,
    TTL.league,
    {},
    forceRefresh,
  );
}

export async function getLeagueUsers(leagueId: string, forceRefresh = false): Promise<SleeperLeagueUser[]> {
  return sleeperGet<SleeperLeagueUser[]>(
    `/league/${leagueId}/users`,
    `sleeper:league:${leagueId}:users`,
    TTL.usersRosters,
    [],
    forceRefresh,
  );
}

export async function getLeagueRosters(leagueId: string, forceRefresh = false): Promise<SleeperRoster[]> {
  return sleeperGet<SleeperRoster[]>(
    `/league/${leagueId}/rosters`,
    `sleeper:league:${leagueId}:rosters`,
    TTL.usersRosters,
    [],
    forceRefresh,
  );
}

export async function getLeagueMatchups(
  leagueId: string,
  week: number,
  forceRefresh = false,
): Promise<SleeperMatchup[]> {
  if (week < 1) return [];
  return sleeperGet<SleeperMatchup[]>(
    `/league/${leagueId}/matchups/${week}`,
    `sleeper:league:${leagueId}:matchups:${week}`,
    TTL.weekly,
    [],
    forceRefresh,
  );
}

export async function getLeagueTransactions(
  leagueId: string,
  week: number,
  forceRefresh = false,
): Promise<SleeperTransaction[]> {
  if (week < 1) return [];
  return sleeperGet<SleeperTransaction[]>(
    `/league/${leagueId}/transactions/${week}`,
    `sleeper:league:${leagueId}:transactions:${week}`,
    TTL.weekly,
    [],
    forceRefresh,
  );
}
