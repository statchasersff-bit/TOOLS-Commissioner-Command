import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ValueSourceId, ValueSourceOption, Player, Pick, Team, TeamMetrics } from "../types";

const VALUE_SOURCES: ValueSourceOption[] = [
  { id: "ktc", label: "KeepTradeCut", description: "KeepTradeCut values are crowd-sourced dynasty trade values widely used by the dynasty fantasy football community.", active: true },
  { id: "fantasycalc", label: "FantasyCalc", description: "Algorithmic dynasty values combining production, age, and draft capital analysis.", active: false },
  { id: "dynastyprocess", label: "DynastyProcess", description: "Data-driven dynasty valuations using historical trade data and projections.", active: false },
  { id: "market-avg", label: "Market Average", description: "Blended average across all active value sources for consensus pricing.", active: false },
  { id: "statchasers", label: "StatChasers Model", description: "Our proprietary model combining analytics, film grades, and market data. Coming soon.", active: false },
];

const SOURCE_MULTIPLIERS: Record<ValueSourceId, number> = {
  ktc: 1.0,
  fantasycalc: 0.95,
  dynastyprocess: 1.05,
  "market-avg": 1.0,
  statchasers: 1.0,
};

interface ValueModel {
  sourceId: ValueSourceId;
  sources: ValueSourceOption[];
  setSourceId: (id: ValueSourceId) => void;
  isRecalculating: boolean;
  getPlayerValue: (player: Player) => number;
  getPickValue: (pick: Pick) => number;
  calculateTeamValue: (team: Team) => number;
  calculateMetrics: (team: Team) => TeamMetrics;
}

const ValueModelContext = createContext<ValueModel | null>(null);

export function ValueModelProvider({ children }: { children: React.ReactNode }) {
  const [sourceId, setSourceIdRaw] = useState<ValueSourceId>("ktc");
  const [isRecalculating, setIsRecalculating] = useState(false);

  const setSourceId = useCallback((id: ValueSourceId) => {
    const source = VALUE_SOURCES.find((s) => s.id === id);
    if (!source?.active) return;
    setIsRecalculating(true);
    setTimeout(() => {
      setSourceIdRaw(id);
      setTimeout(() => setIsRecalculating(false), 300);
    }, 400);
  }, []);

  const multiplier = SOURCE_MULTIPLIERS[sourceId];

  const getPlayerValue = useCallback((player: Player): number => {
    return Math.round(player.value * multiplier);
  }, [multiplier]);

  const getPickValue = useCallback((pick: Pick): number => {
    return Math.round(pick.value * multiplier);
  }, [multiplier]);

  const calculateTeamValue = useCallback((team: Team): number => {
    const rosterValue = team.roster.reduce((s, p) => s + Math.round(p.value * multiplier), 0);
    const pickValue = team.picks.reduce((s, p) => s + Math.round(p.value * multiplier), 0);
    return rosterValue + pickValue;
  }, [multiplier]);

  const calculateMetrics = useCallback((team: Team): TeamMetrics => {
    const roster = team.roster;
    const picks = team.picks;

    const starters = roster.filter((p) => p.starter);
    const bench = roster.filter((p) => !p.starter);

    const starterValue = starters.reduce((s, p) => s + Math.round(p.value * multiplier), 0);
    const benchValue = bench.reduce((s, p) => s + Math.round(p.value * multiplier), 0);
    const picksTotalValue = picks.reduce((s, p) => s + Math.round(p.value * multiplier), 0);

    const starterAvgAge = starters.length > 0
      ? starters.reduce((s, p) => s + p.age, 0) / starters.length
      : 26;
    const youthScore = Math.max(0, Math.min(100, Math.round(100 - (starterAvgAge - 23) * 8)));

    const maxStarterValue = Math.max(starters.length * 60, 1);
    const maxBenchValue = Math.max(bench.length * 40, 1);
    const maxPickValue = 400;

    const starterScore = Math.min(99, Math.max(10, Math.round((starterValue / maxStarterValue) * 100)));
    const depthScore = Math.min(99, Math.max(10, Math.round((benchValue / maxBenchValue) * 100)));
    const picksScore = Math.min(99, Math.max(10, Math.round((picksTotalValue / maxPickValue) * 100)));

    const overall = Math.min(99, Math.max(10, Math.round(
      starterScore * 0.45 +
      depthScore * 0.25 +
      picksScore * 0.20 +
      youthScore * 0.10
    )));

    const posScore = (pos: string) => {
      const posPlayers = starters.filter((p) => p.pos === pos);
      const total = posPlayers.reduce((s, p) => s + Math.round(p.value * multiplier), 0);
      return Math.min(99, Math.max(10, Math.round(total * 1.5)));
    };

    const contenderWindowYears = youthScore >= 70 && overall >= 65
      ? 4
      : youthScore >= 50 && overall >= 55
        ? 3
        : youthScore >= 30 && overall >= 45
          ? 2
          : 1;

    return {
      overall,
      starters: starterScore,
      depth: depthScore,
      youth: youthScore,
      picks: picksScore,
      qb: posScore("QB"),
      rb: posScore("RB"),
      wr: posScore("WR"),
      te: posScore("TE"),
      contenderWindowYears,
    };
  }, [multiplier]);

  const value = useMemo<ValueModel>(() => ({
    sourceId,
    sources: VALUE_SOURCES,
    setSourceId,
    isRecalculating,
    getPlayerValue,
    getPickValue,
    calculateTeamValue,
    calculateMetrics,
  }), [sourceId, setSourceId, isRecalculating, getPlayerValue, getPickValue, calculateTeamValue, calculateMetrics]);

  return (
    <ValueModelContext.Provider value={value}>
      {children}
    </ValueModelContext.Provider>
  );
}

export function useValueModel(): ValueModel {
  const ctx = useContext(ValueModelContext);
  if (!ctx) throw new Error("useValueModel must be used within ValueModelProvider");
  return ctx;
}
