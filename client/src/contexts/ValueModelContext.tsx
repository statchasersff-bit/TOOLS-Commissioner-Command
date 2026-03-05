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
  getRedraftValue: (player: Player) => number;
  getPickValue: (pick: Pick) => number;
  calculateTeamValue: (team: Team) => number;
  calculateAllTeamMetrics: (teams: Team[], rosterPositions?: string[]) => Map<string, TeamMetrics>;
  optimizeLineup: (roster: Player[], rosterPositions: string[]) => Player[];
  valuesBySleeperId: Record<string, number>;
  redraftValuesBySleeperId: Record<string, number>;
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
  const [redraftValuesBySleeperId, setRedraftValuesBySleeperId] = useState<Record<string, number>>({});
  const [redraftNameValueMap, setRedraftNameValueMap] = useState<Record<string, number>>({});
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

    Promise.all([
      fetch("/api/values/fantasycalc?format=sf").then((r) => {
        if (!r.ok) throw new Error(`Dynasty API error ${r.status}`);
        return r.json();
      }),
      fetch("/api/values/fantasycalc/redraft?format=sf").then((r) => {
        if (!r.ok) throw new Error(`Redraft API error ${r.status}`);
        return r.json();
      }).catch((err) => {
        console.warn("[ValueModel] Redraft fetch failed, will use dynasty fallback:", err);
        return null;
      }),
    ])
      .then(([dynastyData, redraftData]: [any, any]) => {
        if (cancelled) return;

        setValuesBySleeperId(dynastyData.valuesBySleeperId);
        const byName: Record<string, number> = {};
        for (const p of dynastyData.players) {
          byName[`${p.name.toLowerCase().trim()}|${p.pos}`] = p.value;
        }
        setNameValueMap(byName);

        if (redraftData && redraftData.valuesBySleeperId && Object.keys(redraftData.valuesBySleeperId).length > 0) {
          setRedraftValuesBySleeperId(redraftData.valuesBySleeperId);
          const redraftByName: Record<string, number> = {};
          for (const p of redraftData.players || []) {
            redraftByName[`${p.name.toLowerCase().trim()}|${p.pos}`] = p.value;
          }
          setRedraftNameValueMap(redraftByName);
        } else {
          setRedraftValuesBySleeperId(dynastyData.valuesBySleeperId);
          setRedraftNameValueMap(byName);
        }

        const uc = dynastyData.unmatched?.length || 0;
        setUnmatchedCount(uc);
        setIsSnapshot(dynastyData.updatedAt === "snapshot");
        setDiagnostics({
          updatedAt: dynastyData.updatedAt,
          mappedCount: Object.keys(dynastyData.valuesBySleeperId).length,
          unmatchedCount: uc,
          unmatchedRows: dynastyData.unmatched || [],
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

  const getRedraftValue = useCallback((player: Player): number => {
    if (sourceId === "fantasycalc" && redraftValuesBySleeperId && Object.keys(redraftValuesBySleeperId).length > 0) {
      if (player.sleeperId && redraftValuesBySleeperId[player.sleeperId] !== undefined) {
        return redraftValuesBySleeperId[player.sleeperId];
      }
      const nameKey = `${player.name.toLowerCase().trim()}|${player.pos}`;
      if (redraftNameValueMap && redraftNameValueMap[nameKey] !== undefined) {
        return redraftNameValueMap[nameKey];
      }
    }
    return getPlayerValue(player);
  }, [sourceId, redraftValuesBySleeperId, redraftNameValueMap, getPlayerValue]);

  const getPickValue = useCallback((pick: Pick): number => {
    const range = (pick.projectedRange || "Mid").toLowerCase() as "early" | "mid" | "late";
    return getStaticPickValue(pick.year, pick.round, range);
  }, []);

  const calculateTeamValue = useCallback((team: Team): number => {
    const rosterValue = team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
    const pickValue = team.picks.reduce((s, p) => s + getPickValue(p), 0);
    return rosterValue + pickValue;
  }, [getPlayerValue, getPickValue]);

  const optimizeLineup = useCallback((roster: Player[], rosterPositions: string[]): Player[] => {
    const SLOT_ELIGIBILITY: Record<string, string[]> = {
      QB: ["QB"],
      RB: ["RB"],
      WR: ["WR"],
      TE: ["TE"],
      FLEX: ["RB", "WR", "TE"],
      SUPER_FLEX: ["QB", "RB", "WR", "TE"],
      REC_FLEX: ["WR", "TE"],
      WRRB_FLEX: ["WR", "RB"],
    };

    const sorted = [...roster]
      .map((p) => ({ ...p, redraftVal: getRedraftValue(p) }))
      .sort((a, b) => b.redraftVal - a.redraftVal);

    const used = new Set<string>();
    const starterIds = new Set<string>();

    const positionalSlots = rosterPositions.filter(
      (s) => s === "QB" || s === "RB" || s === "WR" || s === "TE"
    );
    const flexSlots = rosterPositions.filter(
      (s) => s !== "QB" && s !== "RB" && s !== "WR" && s !== "TE" && SLOT_ELIGIBILITY[s]
    );

    for (const slot of positionalSlots) {
      const eligible = SLOT_ELIGIBILITY[slot] || [];
      const best = sorted.find((p) => eligible.includes(p.pos) && !used.has(p.id));
      if (best) {
        used.add(best.id);
        starterIds.add(best.id);
      }
    }

    for (const slot of flexSlots) {
      const eligible = SLOT_ELIGIBILITY[slot] || [];
      const best = sorted.find((p) => eligible.includes(p.pos) && !used.has(p.id));
      if (best) {
        used.add(best.id);
        starterIds.add(best.id);
      }
    }

    return roster.map((p) => ({ ...p, starter: starterIds.has(p.id) }));
  }, [getRedraftValue]);

  const calculateAllTeamMetrics = useCallback((teams: Team[], rosterPositions?: string[]): Map<string, TeamMetrics> => {
    if (teams.length === 0) return new Map();

    const scale = (raw: number, min: number, max: number) =>
      max === min ? 50 : Math.min(99, Math.max(10, Math.round(10 + ((raw - min) / (max - min)) * 89)));

    const rawData = teams.map((team) => {
      const roster = rosterPositions
        ? optimizeLineup(team.roster, rosterPositions)
        : team.roster;
      const starters = roster.filter((p) => p.starter);
      const bench = roster.filter((p) => !p.starter);

      const starterRedraft = starters.reduce((s, p) => s + getRedraftValue(p), 0);
      const benchDynasty = bench.reduce((s, p) => s + getPlayerValue(p), 0);
      const picksTotal = team.picks.reduce((s, p) => s + getPickValue(p), 0);
      const starterAvgAge = starters.length > 0
        ? starters.reduce((s, p) => s + p.age, 0) / starters.length
        : 26;

      const posTotal = (pos: string) =>
        starters.filter((p) => p.pos === pos).reduce((s, p) => s + getRedraftValue(p), 0);

      return {
        id: team.id,
        starterRedraft,
        benchDynasty,
        picksTotal,
        starterAvgAge,
        qbRaw: posTotal("QB"),
        rbRaw: posTotal("RB"),
        wrRaw: posTotal("WR"),
        teRaw: posTotal("TE"),
      };
    });

    const minMax = (arr: number[]) => ({ min: Math.min(...arr), max: Math.max(...arr) });
    const starterRange = minMax(rawData.map((d) => d.starterRedraft));
    const depthRange = minMax(rawData.map((d) => d.benchDynasty));
    const picksRange = minMax(rawData.map((d) => d.picksTotal));
    const qbRange = minMax(rawData.map((d) => d.qbRaw));
    const rbRange = minMax(rawData.map((d) => d.rbRaw));
    const wrRange = minMax(rawData.map((d) => d.wrRaw));
    const teRange = minMax(rawData.map((d) => d.teRaw));

    const result = new Map<string, TeamMetrics>();

    for (const d of rawData) {
      const starterScore = scale(d.starterRedraft, starterRange.min, starterRange.max);
      const depthScore = scale(d.benchDynasty, depthRange.min, depthRange.max);
      const picksScore = scale(d.picksTotal, picksRange.min, picksRange.max);
      const youthScore = Math.max(0, Math.min(100, Math.round(100 - (d.starterAvgAge - 23) * 8)));

      const overall = Math.min(99, Math.max(10, Math.round(
        starterScore * 0.45 +
        depthScore * 0.25 +
        picksScore * 0.20 +
        youthScore * 0.10
      )));

      const contenderWindowYears = youthScore >= 70 && starterScore >= 55
        ? 4
        : youthScore >= 50 && starterScore >= 45
          ? 3
          : youthScore >= 30 && starterScore >= 35
            ? 2
            : 1;

      result.set(d.id, {
        overall,
        starters: starterScore,
        depth: depthScore,
        youth: youthScore,
        picks: picksScore,
        qb: scale(d.qbRaw, qbRange.min, qbRange.max),
        rb: scale(d.rbRaw, rbRange.min, rbRange.max),
        wr: scale(d.wrRaw, wrRange.min, wrRange.max),
        te: scale(d.teRaw, teRange.min, teRange.max),
        contenderWindowYears,
      });
    }

    return result;
  }, [getPlayerValue, getRedraftValue, getPickValue, optimizeLineup]);

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
    getRedraftValue,
    getPickValue,
    calculateTeamValue,
    calculateAllTeamMetrics,
    optimizeLineup,
    valuesBySleeperId,
    redraftValuesBySleeperId,
  }), [sourceId, setSourceId, isRecalculating, isLoading, isSnapshot, unmatchedCount, diagnostics, getPlayerValue, getRedraftValue, getPickValue, calculateTeamValue, calculateAllTeamMetrics, optimizeLineup, valuesBySleeperId, redraftValuesBySleeperId]);

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
