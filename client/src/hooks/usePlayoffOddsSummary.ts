import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/apiBase";

// Per-team odds pulled from the Monte Carlo playoff calculator. Keyed by
// Sleeper roster_id so callers can look up their own team.
export interface TeamOdds {
  makePlayoffsPct: number;
  championshipPct: number;
}

interface PlayoffOddsState {
  odds: Record<number, TeamOdds> | null;
  loading: boolean;
  error: string | null;
}

const SIM_COUNT = 1000;

/**
 * Fetch make-playoffs and championship odds for every team in a league from
 * the shared `/playoff-calculator` endpoint (same source as the Playoff Odds
 * tab). Returns a roster_id → odds map plus loading/error flags. Null `leagueId`
 * is a no-op so callers can guard on data availability without conditional hooks.
 */
export function usePlayoffOddsSummary(leagueId: string | null): PlayoffOddsState {
  const [state, setState] = useState<PlayoffOddsState>({ odds: null, loading: false, error: null });

  useEffect(() => {
    if (!leagueId) {
      setState({ odds: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ odds: null, loading: true, error: null });

    (async () => {
      try {
        const url = `${API_BASE}/api/leagues/${leagueId}/playoff-calculator?simulations=${SIM_COUNT}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`Playoff API failed (${res.status})`);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) throw new Error("Expected JSON from playoff API");
        const json = await res.json();
        if (cancelled) return;
        const map: Record<number, TeamOdds> = {};
        for (const t of json.teams ?? []) {
          map[t.roster_id] = {
            makePlayoffsPct: t.make_playoffs_pct ?? 0,
            championshipPct: t.championship_pct ?? 0,
          };
        }
        setState({ odds: map, loading: false, error: null });
      } catch (err: any) {
        if (cancelled) return;
        console.warn("[usePlayoffOddsSummary]", err);
        setState({ odds: null, loading: false, error: err?.message || "Failed to load odds" });
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

  return state;
}
