/**
 * useWeeklyPlayerProjections — backend-ready hook that today returns
 * mock projection data, but is shaped so a real weekly projections API
 * (multi-source: StatChasers / Sleeper / FanDuel / DraftKings / CBS) can be
 * dropped in without changing call sites.
 *
 * Call sites should treat the returned `players` as the authoritative weekly
 * snapshot — projections, matchup, trends — and pass it into the start/sit
 * helpers in `@/lib/startSit`.
 */

import { useEffect, useMemo, useState } from "react";
import {
  MOCK_START_SIT_PLAYERS,
  type MockPlayerWeekly,
} from "@/data/mockStartSitProjections";

export type ScoringFormat = "ppr" | "half_ppr" | "std";

export interface UseWeeklyPlayerProjectionsOpts {
  playerIds: string[];
  week: number;
  scoringFormat?: ScoringFormat;
}

export interface UseWeeklyPlayerProjectionsResult {
  players: MockPlayerWeekly[];
  loading: boolean;
  error: string | null;
}

export function useWeeklyPlayerProjections(
  opts: UseWeeklyPlayerProjectionsOpts,
): UseWeeklyPlayerProjectionsResult {
  const { playerIds, week } = opts;
  // scoringFormat is accepted for API parity; mock data is format-agnostic.

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock fetch effect — simulates an async boundary so swapping to a real
  // fetch later is a no-op for callers.
  useEffect(() => {
    if (playerIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [playerIds.join("|"), week]);

  const players = useMemo(() => {
    return playerIds
      .map((id) => MOCK_START_SIT_PLAYERS.find((p) => p.playerId === id))
      .filter((p): p is MockPlayerWeekly => Boolean(p));
  }, [playerIds]);

  return { players, loading, error };
}

/** Static directory used by the search UI. Returns all known mock players. */
export function getAvailableMockPlayers(): MockPlayerWeekly[] {
  return MOCK_START_SIT_PLAYERS;
}
