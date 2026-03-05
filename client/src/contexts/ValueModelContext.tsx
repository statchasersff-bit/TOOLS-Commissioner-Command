import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import type { ValueSourceId, ValueSourceOption, Player, Pick, Team, TeamMetrics } from "../types";
import { getStaticPickValue } from "../data/pickValues";

const VALUE_SOURCES: ValueSourceOption[] = [
  { id: "fantasycalc", label: "FantasyCalc", description: "FantasyCalc values update daily. StatChasers caches values once per day.", active: true },
  { id: "ktc", label: "KeepTradeCut", description: "KeepTradeCut crowd-sourced dynasty trade values. Coming soon.", active: false },
  { id: "dlf", label: "DLF", description: "Dynasty League Football expert-driven dynasty valuations. Coming soon.", active: false },
  { id: "flock", label: "Flock Fantasy", description: "Flock Fantasy dynasty player valuations. Coming soon.", active: false },
  { id: "custom", label: "Custom Upload", description: "Upload your own CSV of player values. Coming soon.", active: false },
];

export interface UnmatchedRow {
  name: string;
  pos: string;
  team: string;
  value: number;
}

export interface ValueDiagnostics {
  updatedAt: string;
  mappedCount: number;
  unmatchedCount: number;
  unmatchedRows: UnmatchedRow[];
  fetchedAt: string | null;
}

interface ValueModel {
  sourceId: ValueSourceId;
  sources: ValueSourceOption[];
  setSourceId: (id: ValueSourceId) => void;
  isRecalculating: boolean;
  isLoading: boolean;
  isSnapshot: boolean;
  unmatchedCount: number;
  diagnostics: ValueDiagnostics;
  getPlayerValue: (player: Player) => number;
  getPickValue: (pick: Pick) => number;
  calculateTeamValue: (team: Team) => number;
  calculateMetrics: (team: Team) => TeamMetrics;
}

const ValueModelContext = createContext<ValueModel | null>(null);

export function ValueModelProvider({ children }: { children: React.ReactNode }) {
  const [sourceId, setSourceIdRaw] = useState<ValueSourceId>("fantasycalc");
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [valuesBySleeperId, setValuesBySleeperId] = useState<Record<string, number>>({});
  const [nameValueMap, setNameValueMap] = useState<Record<string, number>>({});
  const [diagnostics, setDiagnostics] = useState<ValueDiagnostics>({
    updatedAt: "",
    mappedCount: 0,
    unmatchedCount: 0,
    unmatchedRows: [],
    fetchedAt: null,
  });

  useEffect(() => {
    if (sourceId !== "fantasycalc") return;
    let cancelled = false;
    setIsLoading(true);

    fetch("/api/values/fantasycalc?format=sf")
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then((data: { valuesBySleeperId: Record<string, number>; players: Array<{ name: string; pos: string; value: number }>; unmatched: UnmatchedRow[]; updatedAt: string }) => {
        if (cancelled) return;
        setValuesBySleeperId(data.valuesBySleeperId);
        const byName: Record<string, number> = {};
        for (const p of data.players) {
          byName[`${p.name.toLowerCase().trim()}|${p.pos}`] = p.value;
        }
        setNameValueMap(byName);
        const uc = data.unmatched?.length || 0;
        setUnmatchedCount(uc);
        setIsSnapshot(data.updatedAt === "snapshot");
        setDiagnostics({
          updatedAt: data.updatedAt,
          mappedCount: Object.keys(data.valuesBySleeperId).length,
          unmatchedCount: uc,
          unmatchedRows: data.unmatched || [],
          fetchedAt: new Date().toISOString(),
        });
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[ValueModel] FantasyCalc fetch failed, using mock fallback:", err);
        setIsLoading(false);
        setIsSnapshot(true);
        setDiagnostics((prev) => ({
          ...prev,
          updatedAt: "fetch-failed",
          fetchedAt: new Date().toISOString(),
        }));
      });

    return () => { cancelled = true; };
  }, [sourceId]);

  const setSourceId = useCallback((id: ValueSourceId) => {
    const source = VALUE_SOURCES.find((s) => s.id === id);
    if (!source?.active) return;
    setIsRecalculating(true);
    setTimeout(() => {
      setSourceIdRaw(id);
      setTimeout(() => setIsRecalculating(false), 300);
    }, 400);
  }, []);

  const getPlayerValue = useCallback((player: Player): number => {
    if (sourceId === "fantasycalc" && valuesBySleeperId && Object.keys(valuesBySleeperId).length > 0) {
      if (player.sleeperId && valuesBySleeperId[player.sleeperId] !== undefined) {
        return valuesBySleeperId[player.sleeperId];
      }
      const nameKey = `${player.name.toLowerCase().trim()}|${player.pos}`;
      if (nameValueMap && nameValueMap[nameKey] !== undefined) {
        return nameValueMap[nameKey];
      }
    }
    return player.value;
  }, [sourceId, valuesBySleeperId, nameValueMap]);

  const getPickValue = useCallback((pick: Pick): number => {
    const range = (pick.projectedRange || "Mid").toLowerCase() as "early" | "mid" | "late";
    return getStaticPickValue(pick.year, pick.round, range);
  }, []);

  const calculateTeamValue = useCallback((team: Team): number => {
    const rosterValue = team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
    const pickValue = team.picks.reduce((s, p) => s + getPickValue(p), 0);
    return rosterValue + pickValue;
  }, [getPlayerValue, getPickValue]);

  const calculateMetrics = useCallback((team: Team): TeamMetrics => {
    const roster = team.roster;
    const picks = team.picks;

    const starters = roster.filter((p) => p.starter);
    const bench = roster.filter((p) => !p.starter);

    const starterValue = starters.reduce((s, p) => s + getPlayerValue(p), 0);
    const benchValue = bench.reduce((s, p) => s + getPlayerValue(p), 0);
    const picksTotalValue = picks.reduce((s, p) => s + getPickValue(p), 0);

    const starterAvgAge = starters.length > 0
      ? starters.reduce((s, p) => s + p.age, 0) / starters.length
      : 26;
    const youthScore = Math.max(0, Math.min(100, Math.round(100 - (starterAvgAge - 23) * 8)));

    const maxStarterValue = Math.max(starters.length * 5000, 1);
    const maxBenchValue = Math.max(bench.length * 3000, 1);
    const maxPickValue = 40000;

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
      const total = posPlayers.reduce((s, p) => s + getPlayerValue(p), 0);
      const maxPos = pos === "QB" ? 10000 : pos === "WR" ? 20000 : pos === "RB" ? 15000 : 8000;
      return Math.min(99, Math.max(10, Math.round((total / maxPos) * 100)));
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
  }, [getPlayerValue, getPickValue]);

  const value = useMemo<ValueModel>(() => ({
    sourceId,
    sources: VALUE_SOURCES,
    setSourceId,
    isRecalculating,
    isLoading,
    isSnapshot,
    unmatchedCount,
    diagnostics,
    getPlayerValue,
    getPickValue,
    calculateTeamValue,
    calculateMetrics,
  }), [sourceId, setSourceId, isRecalculating, isLoading, isSnapshot, unmatchedCount, diagnostics, getPlayerValue, getPickValue, calculateTeamValue, calculateMetrics]);

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
