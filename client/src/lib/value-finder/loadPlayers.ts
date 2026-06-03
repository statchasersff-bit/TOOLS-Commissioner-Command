// Real-data loader for the Value Finder.
//
// Fetches the aggregated player pool from the backend (`/api/value-finder/players`),
// which joins FantasyCalc + KTC + custom market values, Sleeper production,
// StatChasers usage, and market-value trends — keyed by Sleeper ID. The client
// scoring engine (enrich.ts) computes all derived scores/labels on top of these
// raw inputs, exactly as it did for the bundled sample pool.
//
// NOTE: useQuery / useMutation from @tanstack/react-query must NOT be used here
// (dual React instance issue). All async work goes through useState + useEffect.

import { useEffect, useRef, useState } from "react";
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

// ---------------------------------------------------------------------------
// Module-level in-memory cache so re-mounting the tab doesn't re-fetch.
// TTL matches the server's 30-min base cache so there's no point hitting it
// more often than that.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  builtAt: number;
}

const playerCache = new Map<string, CacheEntry<ValueFinderPlayer[]>>();
const compositeCache = new Map<string, CacheEntry<Record<string, PositionCompositeScore>>>();

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hooks — useState + useEffect only (no @tanstack/react-query)
// ---------------------------------------------------------------------------

export interface AsyncState<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
}

/**
 * React hook for the Value Finder pool. Re-fetches when the season, market
 * format, or scoring format changes; results are cached for 30 min so
 * re-mounting the tab is instant.
 */
export function useValueFinderPlayers(
  season: SeasonFilter,
  format: FormatFilter,
  scoring: ScoringFormat = "ppr",
): AsyncState<ValueFinderPlayer[]> {
  const seasonNum = toSeason(season);
  const marketFormat = toMarketFormat(format);
  const cacheKey = `${seasonNum}:${marketFormat}:${scoring}`;

  const [state, setState] = useState<AsyncState<ValueFinderPlayer[]>>(() => {
    const hit = playerCache.get(cacheKey);
    if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) {
      return { data: hit.data, isLoading: false, isError: false, error: undefined };
    }
    return { data: undefined, isLoading: true, isError: false, error: undefined };
  });

  // Track the key that this effect last fetched for so stale responses don't
  // overwrite results from a newer key (format/season changed mid-flight).
  const activeKey = useRef(cacheKey);

  useEffect(() => {
    activeKey.current = cacheKey;

    // Serve from cache if still fresh.
    const hit = playerCache.get(cacheKey);
    if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) {
      setState({ data: hit.data, isLoading: false, isError: false, error: undefined });
      return;
    }

    setState({ data: undefined, isLoading: true, isError: false, error: undefined });

    let cancelled = false;
    fetchValueFinderPlayers(seasonNum, marketFormat, scoring)
      .then((players) => {
        if (cancelled || activeKey.current !== cacheKey) return;
        playerCache.set(cacheKey, { data: players, builtAt: Date.now() });
        setState({ data: players, isLoading: false, isError: false, error: undefined });
      })
      .catch((err: unknown) => {
        if (cancelled || activeKey.current !== cacheKey) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: undefined, isLoading: false, isError: true, error });
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return state;
}

/**
 * Volume + Efficiency composite scores (0–100, by Sleeper playerId) for the
 * selected season. Bundled (lazy-imported JSON) so it never changes — cached
 * indefinitely once loaded.
 */
export function usePositionCompositeScores(
  season: SeasonFilter,
): AsyncState<Record<string, PositionCompositeScore>> {
  const cacheKey = String(season);

  const [state, setState] = useState<AsyncState<Record<string, PositionCompositeScore>>>(() => {
    const hit = compositeCache.get(cacheKey);
    if (hit) {
      return { data: hit.data, isLoading: false, isError: false, error: undefined };
    }
    return { data: undefined, isLoading: false, isError: false, error: undefined };
  });

  const activeKey = useRef(cacheKey);

  useEffect(() => {
    activeKey.current = cacheKey;

    const hit = compositeCache.get(cacheKey);
    if (hit) {
      setState({ data: hit.data, isLoading: false, isError: false, error: undefined });
      return;
    }

    let cancelled = false;
    loadPositionCompositeScores(season)
      .then((scores) => {
        if (cancelled || activeKey.current !== cacheKey) return;
        compositeCache.set(cacheKey, { data: scores, builtAt: Date.now() });
        setState({ data: scores, isLoading: false, isError: false, error: undefined });
      })
      .catch((err: unknown) => {
        if (cancelled || activeKey.current !== cacheKey) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: undefined, isLoading: false, isError: true, error });
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return state;
}
