/**
 * Minimal Sleeper REST client for the Trade Review Center ingestion pipeline.
 *
 * We deliberately keep this self-contained (rather than reaching into
 * server/sleeper.ts internals) so the trade-review feature owns exactly the
 * endpoints it needs. The heavy /players/nfl payload is reused from the shared,
 * cached `getSleeperPlayers()` helper to avoid re-downloading ~10MB per run.
 */
import { getSleeperPlayers } from "../../sleeper";
import type {
  SleeperLeagueUserLite,
  SleeperRosterLite,
  SleeperTransaction,
} from "./types";

const SLEEPER_API = "https://api.sleeper.app/v1";
const TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Sleeper ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface NflState {
  week?: number;
  display_week?: number;
  season?: string;
  season_type?: string;
}

export async function getNflState(): Promise<NflState> {
  return fetchJson<NflState>(`${SLEEPER_API}/state/nfl`);
}

export async function getLeagueTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  // Sleeper returns null for weeks with no data — normalize to [].
  const data = await fetchJson<SleeperTransaction[] | null>(
    `${SLEEPER_API}/league/${leagueId}/transactions/${week}`,
  );
  return Array.isArray(data) ? data : [];
}

export async function getLeagueRosters(leagueId: string): Promise<SleeperRosterLite[]> {
  const data = await fetchJson<SleeperRosterLite[] | null>(
    `${SLEEPER_API}/league/${leagueId}/rosters`,
  );
  return Array.isArray(data) ? data : [];
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperLeagueUserLite[]> {
  const data = await fetchJson<SleeperLeagueUserLite[] | null>(
    `${SLEEPER_API}/league/${leagueId}/users`,
  );
  return Array.isArray(data) ? data : [];
}

export interface TradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export async function getTradedPicks(leagueId: string): Promise<TradedPick[]> {
  const data = await fetchJson<TradedPick[] | null>(
    `${SLEEPER_API}/league/${leagueId}/traded_picks`,
  );
  return Array.isArray(data) ? data : [];
}

export interface SleeperLeagueMeta {
  league_id: string;
  name?: string;
  season?: string;
  settings?: Record<string, number>;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
}

export async function getLeague(leagueId: string): Promise<SleeperLeagueMeta> {
  return fetchJson<SleeperLeagueMeta>(`${SLEEPER_API}/league/${leagueId}`);
}

/**
 * League display directory: league name + a roster-id → {team, manager} map.
 * Used to label cross-league trade feeds without re-fetching per request.
 * Cached for a few minutes since names rarely change mid-season.
 */
export interface LeagueDirectory {
  leagueId: string;
  leagueName: string;
  rosterNames: Record<number, { teamName: string; managerName: string }>;
}

const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map<string, { ts: number; data: LeagueDirectory }>();

export async function getLeagueDirectory(leagueId: string): Promise<LeagueDirectory> {
  const cached = directoryCache.get(leagueId);
  if (cached && Date.now() - cached.ts < DIRECTORY_TTL_MS) return cached.data;

  const [meta, rosters, users] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getLeagueRosters(leagueId).catch(() => [] as SleeperRosterLite[]),
    getLeagueUsers(leagueId).catch(() => [] as SleeperLeagueUserLite[]),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rosterNames: LeagueDirectory["rosterNames"] = {};
  for (const r of rosters) {
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    rosterNames[r.roster_id] = {
      teamName: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
      managerName: u?.username || u?.display_name || `Team ${r.roster_id}`,
    };
  }

  const data: LeagueDirectory = {
    leagueId,
    leagueName: meta?.name || `League ${leagueId}`,
    rosterNames,
  };
  directoryCache.set(leagueId, { ts: Date.now(), data });
  return data;
}

// ── Startup-draft detection ───────────────────────────────────────────────────
// Sleeper trade picks only carry a season + round — no startup-vs-rookie flag.
// We identify startup-draft picks by matching a pick's season against the
// league's actual drafts: a "startup" draft fills full rosters (many rounds),
// unlike a rookie draft (~4-5 rounds). Seasons that have such a draft are
// startup seasons, so any pick for those seasons is a startup-draft pick.
export interface SleeperDraftLite {
  draft_id: string;
  season?: string;
  type?: string;
  status?: string;
  settings?: { rounds?: number; [k: string]: unknown };
}

export async function getLeagueDrafts(leagueId: string): Promise<SleeperDraftLite[]> {
  const data = await fetchJson<SleeperDraftLite[] | null>(
    `${SLEEPER_API}/league/${leagueId}/drafts`,
  );
  return Array.isArray(data) ? data : [];
}

const STARTUP_MIN_ROUNDS = 10; // rookie drafts are ≤ ~7 rounds; startup fills full rosters
const STARTUP_TTL_MS = 60 * 60 * 1000;
const startupSeasonsCache = new Map<string, { ts: number; data: Set<string> }>();

/** Seasons whose draft is a full-roster startup draft (cached per league). */
export async function getStartupPickSeasons(leagueId: string): Promise<Set<string>> {
  const cached = startupSeasonsCache.get(leagueId);
  if (cached && Date.now() - cached.ts < STARTUP_TTL_MS) return cached.data;

  const seasons = new Set<string>();
  try {
    const drafts = await getLeagueDrafts(leagueId);
    for (const d of drafts) {
      if (d.season && Number(d.settings?.rounds ?? 0) >= STARTUP_MIN_ROUNDS) {
        seasons.add(String(d.season));
      }
    }
  } catch {
    /* leave empty — no startup exclusion when draft data is unavailable */
  }
  startupSeasonsCache.set(leagueId, { ts: Date.now(), data: seasons });
  return seasons;
}

/** Re-export the shared cached players map for the ingest pipeline. */
export { getSleeperPlayers };
