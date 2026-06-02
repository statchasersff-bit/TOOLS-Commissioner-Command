// Real-data loader for the Value Finder.
//
// Fetches the aggregated player pool from the backend (`/api/value-finder/players`),
// which joins FantasyCalc + KTC + custom market values, Sleeper production,
// StatChasers usage, and market-value trends — keyed by Sleeper ID. The client
// scoring engine (enrich.ts) computes all derived scores/labels on top of these
// raw inputs, exactly as it did for the bundled sample pool.

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/apiBase";
import {
  loadPositionCompositeScores,
  type PositionCompositeScore,
} from "./positionComposites";
import type {
  ValueFinderPlayer,
  SeasonFilter,
  FormatFilter,
  ScoringFormat,
} from "./types";

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
  scoring: ScoringFormat = "ppr",
): Promise<ValueFinderPlayer[]> {
  const res = await fetch(
    `${API_BASE}/api/value-finder/players?season=${season}&format=${format}&scoring=${scoring}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Value Finder request failed: ${res.status}`);
  const data = await res.json();
  return (data?.players ?? []) as ValueFinderPlayer[];
}

/**
 * React-query hook for the Value Finder pool. Re-fetches when the season, market
 * format, or scoring format changes (those drive the server-side join — scoring
 * picks which Sleeper points column feeds production); the value-source and
 * other filters are applied client-side, so they don't refetch.
 */
export function useValueFinderPlayers(
  season: SeasonFilter,
  format: FormatFilter,
  scoring: ScoringFormat = "ppr",
) {
  const seasonNum = toSeason(season);
  const marketFormat = toMarketFormat(format);
  return useQuery<ValueFinderPlayer[]>({
    queryKey: ["value-finder-players", seasonNum, marketFormat, scoring],
    queryFn: () => fetchValueFinderPlayers(seasonNum, marketFormat, scoring),
  });
}

/**
 * Volume + Efficiency composite scores (0–100, by Sleeper playerId) for the
 * selected season, computed by the SAME engines and SAME data as the Position
 * Stats table. The Value Finder overlays these so its Usage (= Volume composite)
 * and Efficiency charts match that table exactly. Bundled (lazy-imported JSON),
 * so it never changes — cache indefinitely.
 */
export function usePositionCompositeScores(season: SeasonFilter) {
  return useQuery<Record<string, PositionCompositeScore>>({
    queryKey: ["value-finder-position-composites", season],
    queryFn: () => loadPositionCompositeScores(season),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
