import { useQuery } from "@tanstack/react-query";

export interface SleeperScoringSettings {
  pass_td?: number;
  pass_yd?: number;
  pass_int?: number;
  pass_cmp?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rush_td?: number;
  rush_yd?: number;
  bonus_rec_te?: number;
  bonus_rec_rb?: number;
  bonus_rec_wr?: number;
  fum_lost?: number;
  sack?: number;
  [key: string]: number | undefined;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  scoring_settings: SleeperScoringSettings;
  roster_positions: string[];
  settings: {
    num_teams: number;
    waiver_budget?: number;
    waiver_type?: number;
    max_keepers?: number;
    taxi_slots?: number;
    reserve_slots?: number;
    reserve_allow_cov?: number;
    [key: string]: unknown;
  };
}

export function useSleeperLeague(leagueId: string | null | undefined) {
  return useQuery({
    queryKey: ["sleeper-league", leagueId],
    queryFn: async (): Promise<SleeperLeague> => {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
      if (!res.ok) throw new Error(`Sleeper API error: ${res.status}`);
      const data = await res.json() as SleeperLeague;
      if (!data || !data.league_id) throw new Error("Invalid league response");
      return data;
    },
    enabled: !!leagueId && leagueId.trim().length > 5,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Derive human-readable scoring labels from Sleeper scoring_settings */
export function deriveScoringHighlights(s: SleeperScoringSettings, positions: string[]) {
  const ppr = s.rec ?? 0;
  const pprLabel = ppr === 0 ? "Standard" : ppr === 0.5 ? "Half PPR" : ppr === 1 ? "Full PPR" : `${ppr} rec`;

  const tep = s.bonus_rec_te ?? 0;
  const tepLabel = tep > 0 ? `+${tep} TE` : null;

  const hasSF = positions.some(p => p === "SUPER_FLEX" || p === "SF");
  const ppc = s.pass_cmp ?? 0;
  const passTd = s.pass_td ?? 4;

  const passYd = s.pass_yd ?? 0;
  const passYdLabel = passYd ? `${(1 / passYd).toFixed(0)} yd/pt` : null;

  return {
    pprLabel,
    tepLabel,
    hasSF,
    passTd,
    passYdLabel,
    ppc: ppc > 0 ? `+${ppc}/cmp` : null,
    fum: s.fum_lost ?? -2,
    intPts: s.pass_int ?? -1,
  };
}

/** Categorize roster_positions into starters/flex/bench/taxi/IR */
export function categorizeRosterPositions(positions: string[]) {
  const counts: Record<string, number> = {};
  for (const p of positions) {
    counts[p] = (counts[p] ?? 0) + 1;
  }

  const starterSlots: { label: string; count: number }[] = [];
  const benchCount = counts["BN"] ?? 0;
  const taxiCount = counts["TAXI"] ?? 0;
  const irCount = counts["IL"] ?? counts["IR"] ?? 0;

  const starterKeys = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "SF", "K", "DEF", "DL", "LB", "DB", "IDP_FLEX", "REC_FLEX", "WRRB_FLEX"];
  for (const key of starterKeys) {
    if (counts[key]) starterSlots.push({ label: key === "SUPER_FLEX" ? "SF" : key, count: counts[key] });
  }

  return { starterSlots, benchCount, taxiCount, irCount };
}
