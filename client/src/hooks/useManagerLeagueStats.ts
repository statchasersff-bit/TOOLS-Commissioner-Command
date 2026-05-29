import { useEffect, useState } from "react";

// Standings/points ranks for a single manager in a league, derived directly
// from Sleeper roster settings (wins/losses, fpts, ppts). Kept separate from
// the playoff-odds hook so each card can load independently.
export interface ManagerLeagueStats {
  standing: number | null;   // 1 = first place
  pfRank: number | null;     // 1 = most points for
  maxPfRank: number | null;  // 1 = most max (optimal) points for
  totalTeams: number | null;
}

interface ManagerLeagueStatsState extends ManagerLeagueStats {
  loading: boolean;
  error: string | null;
}

const SLEEPER_API = "https://api.sleeper.app/v1";

interface RosterSettings {
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number;
  fpts_decimal?: number;
  ppts?: number;
  ppts_decimal?: number;
}

interface RosterRaw {
  roster_id: number;
  owner_id: string | null;
  settings?: RosterSettings;
}

const pts = (whole?: number, decimal?: number): number =>
  whole != null ? whole + (decimal ?? 0) / 100 : 0;

// Rank `ownerId`'s roster within `rosters` by the given comparator (1-based).
function rankBy(
  rosters: RosterRaw[],
  ownerId: string,
  compare: (a: RosterRaw, b: RosterRaw) => number,
): number | null {
  const sorted = [...rosters].sort(compare);
  const idx = sorted.findIndex((r) => r.owner_id === ownerId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Fetch a manager's league standing, points-for rank, and max-points-for rank
 * from Sleeper's public rosters endpoint. Standing uses Sleeper's tiebreak
 * (record → points for). Null `leagueId`/`ownerId` is a no-op.
 */
export function useManagerLeagueStats(
  leagueId: string | null,
  ownerId: string | null,
): ManagerLeagueStatsState {
  const [state, setState] = useState<ManagerLeagueStatsState>({
    standing: null, pfRank: null, maxPfRank: null, totalTeams: null,
    loading: false, error: null,
  });

  useEffect(() => {
    if (!leagueId || !ownerId) {
      setState({ standing: null, pfRank: null, maxPfRank: null, totalTeams: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(`${SLEEPER_API}/league/${leagueId}/rosters`);
        if (!res.ok) throw new Error(`Sleeper rosters failed (${res.status})`);
        const rosters: RosterRaw[] = await res.json();
        if (cancelled) return;

        // Preseason: no games played and no points scored yet, so every roster
        // is tied at zero and any "rank" would be arbitrary. Surface "—" instead.
        const hasPlayed = rosters.some((r) => {
          const s = r.settings;
          return (s?.wins ?? 0) + (s?.losses ?? 0) + (s?.ties ?? 0) > 0
            || pts(s?.fpts, s?.fpts_decimal) > 0
            || pts(s?.ppts, s?.ppts_decimal) > 0;
        });
        if (!hasPlayed) {
          setState({ standing: null, pfRank: null, maxPfRank: null, totalTeams: rosters.length, loading: false, error: null });
          return;
        }

        const standing = rankBy(rosters, ownerId, (a, b) => {
          const aW = a.settings?.wins ?? 0;
          const bW = b.settings?.wins ?? 0;
          if (bW !== aW) return bW - aW;
          return pts(b.settings?.fpts, b.settings?.fpts_decimal) - pts(a.settings?.fpts, a.settings?.fpts_decimal);
        });
        const pfRank = rankBy(rosters, ownerId, (a, b) =>
          pts(b.settings?.fpts, b.settings?.fpts_decimal) - pts(a.settings?.fpts, a.settings?.fpts_decimal));
        const maxPfRank = rankBy(rosters, ownerId, (a, b) =>
          pts(b.settings?.ppts, b.settings?.ppts_decimal) - pts(a.settings?.ppts, a.settings?.ppts_decimal));

        setState({
          standing,
          pfRank,
          maxPfRank,
          totalTeams: rosters.length,
          loading: false,
          error: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        console.warn("[useManagerLeagueStats]", err);
        setState({ standing: null, pfRank: null, maxPfRank: null, totalTeams: null, loading: false, error: err?.message || "Failed to load standings" });
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, ownerId]);

  return state;
}
