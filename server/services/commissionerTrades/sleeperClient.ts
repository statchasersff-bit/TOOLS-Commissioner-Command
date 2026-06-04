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
  season?: string;
  settings?: Record<string, number>;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
}

export async function getLeague(leagueId: string): Promise<SleeperLeagueMeta> {
  return fetchJson<SleeperLeagueMeta>(`${SLEEPER_API}/league/${leagueId}`);
}

/** Re-export the shared cached players map for the ingest pipeline. */
export { getSleeperPlayers };
