import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/apiBase";

// One regular-season week from a single manager's point of view, distilled from
// the shared /playoff-calculator/matchups endpoint (same win-probability model
// as the Matchups tab).
export interface ManagerWeekMatchup {
  week: number;
  status: "upcoming" | "live" | "final";
  isBye: boolean;
  winProbability: number;       // this manager's win prob, 0..100
  pointsFor: number;            // this manager's points (0 until played)
  opponentName: string | null;
  opponentAvatar: string | null;
  opponentPointsFor: number;
}

interface State {
  weeks: ManagerWeekMatchup[];
  currentWeek: number | null;
  loading: boolean;
  error: string | null;
}

interface WMTeamLite {
  rosterId: number;
  ownerName: string;
  teamName: string;
  avatar: string | null;
  pointsFor: number;
  winProbability: number;
}
interface WMCardLite {
  status: "upcoming" | "live" | "final";
  isBye: boolean;
  teamA: WMTeamLite;
  teamB: WMTeamLite | null;
}
interface WMResponseLite {
  week: number;
  currentWeek: number;
  regularSeasonWeeks: number;
  matchups: WMCardLite[];
}

function extractWeek(json: WMResponseLite, rosterId: number): ManagerWeekMatchup | null {
  for (const m of json.matchups) {
    const isA = m.teamA.rosterId === rosterId;
    const isB = m.teamB?.rosterId === rosterId;
    if (!isA && !isB) continue;
    const me = isA ? m.teamA : (m.teamB as WMTeamLite);
    const opp = isA ? m.teamB : m.teamA;
    return {
      week: json.week,
      status: m.status,
      isBye: m.isBye || !opp,
      winProbability: me.winProbability,
      pointsFor: me.pointsFor,
      opponentName: opp ? (opp.teamName || opp.ownerName) : null,
      opponentAvatar: opp ? opp.avatar : null,
      opponentPointsFor: opp ? opp.pointsFor : 0,
    };
  }
  return null;
}

/**
 * Build a manager's week-by-week schedule with win probabilities by querying
 * the matchups endpoint for each regular-season week. One initial request
 * discovers the season length, then the remaining weeks are fetched in
 * parallel. Server responses are cached, so repeat views are cheap.
 */
export function useManagerWeeklyMatchups(
  leagueId: string | null,
  rosterId: number | null,
): State {
  const [state, setState] = useState<State>({ weeks: [], currentWeek: null, loading: false, error: null });

  useEffect(() => {
    if (!leagueId || rosterId == null) {
      setState({ weeks: [], currentWeek: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ weeks: [], currentWeek: null, loading: true, error: null });

    const fetchWeek = async (week?: number): Promise<WMResponseLite> => {
      const qs = week ? `?week=${week}` : "";
      const res = await fetch(`${API_BASE}/api/leagues/${leagueId}/playoff-calculator/matchups${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Matchups API failed (${res.status})`);
      return res.json();
    };

    (async () => {
      try {
        const first = await fetchWeek();
        if (cancelled) return;
        const total = Math.max(1, first.regularSeasonWeeks || 1);

        const rest = await Promise.all(
          Array.from({ length: total }, (_, i) => i + 1)
            .filter((w) => w !== first.week)
            .map((w) => fetchWeek(w).catch(() => null)),
        );
        if (cancelled) return;

        const byWeek = new Map<number, ManagerWeekMatchup>();
        for (const resp of [first, ...rest]) {
          if (!resp) continue;
          const row = extractWeek(resp, rosterId);
          if (row) byWeek.set(row.week, row);
        }
        const weeks = Array.from(byWeek.values()).sort((a, b) => a.week - b.week);
        setState({ weeks, currentWeek: first.currentWeek ?? null, loading: false, error: null });
      } catch (err: any) {
        if (cancelled) return;
        console.warn("[useManagerWeeklyMatchups]", err);
        setState({ weeks: [], currentWeek: null, loading: false, error: err?.message || "Failed to load matchups" });
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, rosterId]);

  return state;
}
