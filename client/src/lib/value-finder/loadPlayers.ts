// Real-data loader for the Value Finder.
//
// Fetches the aggregated player pool from the backend (`/api/value-finder/players`),
// which joins FantasyCalc + KTC + custom market values, Sleeper production,
// StatChasers usage, and market-value trends — keyed by Sleeper ID. The client
// scoring engine (enrich.ts) computes all derived scores/labels on top of these
// raw inputs, exactly as it did for the bundled sample pool.

import { useQuery } from "@tanstack/react-query";
import type { ValueFinderPlayer, SeasonFilter, FormatFilter } from "./types";

/** Map the UI format filter to a FantasyCalc/KTC market format. */
function toMarketFormat(format: FormatFilter): "sf" | "1qb" {
  return format === "1QB" ? "1qb" : "sf";
}

/** Map the UI season filter to a concrete season (production/usage need one). */
function toSeason(season: SeasonFilter): number {
  const n = parseInt(season, 10);
  return Number.isFinite(n) ? n : 2025;
}

export async function fetchValueFinderPlayers(
  season: number,
  format: "sf" | "1qb",
): Promise<ValueFinderPlayer[]> {
  const res = await fetch(
    `/api/value-finder/players?season=${season}&format=${format}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Value Finder request failed: ${res.status}`);
  const data = await res.json();
  return (data?.players ?? []) as ValueFinderPlayer[];
}

/**
 * React-query hook for the Value Finder pool. Re-fetches when the season or
 * market format changes (those drive the server-side join); the value-source
 * and other filters are applied client-side, so they don't refetch.
 */
export function useValueFinderPlayers(season: SeasonFilter, format: FormatFilter) {
  const seasonNum = toSeason(season);
  const marketFormat = toMarketFormat(format);
  return useQuery<ValueFinderPlayer[]>({
    queryKey: ["value-finder-players", seasonNum, marketFormat],
    queryFn: () => fetchValueFinderPlayers(seasonNum, marketFormat),
  });
}
