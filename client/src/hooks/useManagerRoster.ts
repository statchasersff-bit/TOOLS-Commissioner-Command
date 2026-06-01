import { useEffect, useState } from "react";

// A single league team's roster (the players it owns), hydrated server-side with
// name, position, age, team, starter/bench status, and FantasyCalc dynasty +
// redraft values. Loaded separately from the manager-intel payload so the Roster
// card can populate independently. Players arrive sorted by dynasty value (desc).
export interface RosterPlayer {
  playerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  team: string;
  age: number | null;
  isStarter: boolean;
  dynastyValue: number;
  redraftValue: number;
}

interface ManagerRosterState {
  players: RosterPlayer[];
  format: "SF" | "1QB" | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a manager's roster for a league from our API (which hydrates Sleeper
 * roster IDs with player + value data). Null `leagueId`/`rosterId` is a no-op.
 */
export function useManagerRoster(
  leagueId: string | null,
  rosterId: number | null,
): ManagerRosterState {
  const [state, setState] = useState<ManagerRosterState>({
    players: [], format: null, loading: false, error: null,
  });

  useEffect(() => {
    if (!leagueId || rosterId == null) {
      setState({ players: [], format: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/roster/${rosterId}`);
        if (!res.ok) throw new Error(`Roster request failed (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        setState({
          players: Array.isArray(data?.players) ? data.players : [],
          format: data?.format ?? null,
          loading: false,
          error: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        console.warn("[useManagerRoster]", err);
        setState({ players: [], format: null, loading: false, error: err?.message || "Failed to load roster" });
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, rosterId]);

  return state;
}
