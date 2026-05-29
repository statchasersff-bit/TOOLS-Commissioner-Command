import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import type { ValueSourceId, ValueSourceOption, Player, Pick, Team, TeamMetrics } from "../types";
import { getStaticPickValue } from "../data/pickValues";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "@/lib/fantasycalcApi";
import { getKtcValues, getKtcRedraftValues } from "@/lib/ktcApi";
import { scAuthFetch } from "@/lib/scAuthFetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import dynastySnapshot from "@/data/fantasycalc_snapshot_sf.json";
import redraftSnapshot from "@/data/fantasycalc_snapshot_redraft_sf.json";

// Seed state directly from the bundled snapshots — these ship with the
// SPA so they're available synchronously on first render. The server fetch
// below upgrades the values once the latest payload arrives; if it fails
// (or stalls), the UI keeps running on the snapshot instead of getting
// stuck on the "Loading FantasyCalc values…" overlay.
interface SnapshotShape {
  valuesBySleeperId: Record<string, number>;
  players: Array<{ sleeperId: string; name: string; pos: string; team: string; value: number; age: number; overallRank: number }>;
  updatedAt?: string;
}
const BUNDLED_DYNASTY = dynastySnapshot as unknown as SnapshotShape;
const BUNDLED_REDRAFT = redraftSnapshot as unknown as SnapshotShape;

function buildNameMap(snap: SnapshotShape): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of snap.players || []) {
    out[`${p.name.toLowerCase().trim()}|${p.pos}`] = p.value;
  }
  return out;
}

function buildRankedList(snap: SnapshotShape): RankedPlayer[] {
  return (snap.players || [])
    .filter((p) => p.sleeperId && p.value > 0)
    .sort((a, b) => b.value - a.value);
}

// Server-resolved custom value sets — see server/customValues.ts.
interface ResolvedCustomSet {
  setId: number;
  name: string;
  valuesBySleeperId: Record<string, number>;
  valuesByNamePos: Record<string, number>;
  matchedCount: number;
  unmatchedCount: number;
  updatedAt: string | null;
}
interface ResolvedCustomValuesResponse {
  dynasty: ResolvedCustomSet | null;
  redraft: ResolvedCustomSet | null;
}

const VALUE_SOURCES: ValueSourceOption[] = [
  { id: "fantasycalc", label: "FantasyCalc", description: "FantasyCalc values update daily. StatChasers caches values once per day.", active: true },
  { id: "ktc", label: "KeepTradeCut", description: "KeepTradeCut crowd-sourced values (non-TEP) — dynasty, redraft, and rookie picks. Refreshed daily.", active: true },
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

export interface RankedPlayer {
  sleeperId: string;
  name: string;
  pos: string;
  team: string;
  value: number;
  age: number;
}

export interface CustomSourceStatus {
  active: boolean;
  setId: number | null;
  name: string | null;
  matchedCount: number;
  unmatchedCount: number;
  updatedAt: string | null;
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
  // Per-type source labels for the header UI. "custom" when a user-uploaded
  // set is active, otherwise "fantasycalc".
  dynastySource: "custom" | "fantasycalc" | "ktc";
  redraftSource: "custom" | "fantasycalc" | "ktc";
  dynastyCustom: CustomSourceStatus;
  redraftCustom: CustomSourceStatus;
  /** Force-reload custom values from the server — call after upload/activate. */
  refreshCustomValues: () => Promise<void>;
  getPlayerValue: (player: Player) => number;
  getRedraftValue: (player: Player) => number;
  /**
   * Like getPlayerValue but also returns the source. Useful for UI badges
   * that want to show "Custom" / "FC" per row.
   */
  getPlayerValueWithSource: (player: Player) => { value: number; source: "custom" | "fantasycalc" | "ktc" };
  getRedraftValueWithSource: (player: Player) => { value: number; source: "custom" | "fantasycalc" | "ktc" };
  getPickValue: (pick: Pick) => number;
  calculateTeamValue: (team: Team) => number;
  calculateAllTeamMetrics: (teams: Team[], rosterPositions?: string[]) => Map<string, TeamMetrics>;
  optimizeLineup: (roster: Player[], rosterPositions: string[]) => Player[];
  valuesBySleeperId: Record<string, number>;
  redraftValuesBySleeperId: Record<string, number>;
  dynastyPlayerList: RankedPlayer[];
}

const ValueModelContext = createContext<ValueModel | null>(null);

const PICK_RANGE_MULTIPLIERS: Record<number, Record<string, number>> = {
  1: { early: 1.70, mid: 1.0, late: 0.78 },
  2: { early: 1.19, mid: 1.0, late: 0.91 },
  3: { early: 1.17, mid: 1.0, late: 0.90 },
  4: { early: 1.09, mid: 1.0, late: 0.92 },
};

export function ValueModelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => { console.log("[app] ValueModelProvider mounted"); }, []);
  const [sourceId, setSourceIdRaw] = useState<ValueSourceId>(() => {
    try {
      const saved = localStorage.getItem("sc-value-source");
      if (saved && VALUE_SOURCES.some((s) => s.id === saved && s.active)) return saved as ValueSourceId;
    } catch {}
    return "fantasycalc";
  });
  const [isRecalculating, setIsRecalculating] = useState(false);
  // Start `isLoading=false` — the bundled snapshot below means we have
  // usable values from the first render, so the "Loading FantasyCalc
  // values…" overlay never blocks the UI on a hung upstream. The server
  // fetch in the effect upgrades values when it eventually returns.
  const [isLoading, setIsLoading] = useState(false);
  const [isSnapshot, setIsSnapshot] = useState(true);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [valuesBySleeperId, setValuesBySleeperId] = useState<Record<string, number>>(() => BUNDLED_DYNASTY.valuesBySleeperId ?? {});
  const [nameValueMap, setNameValueMap] = useState<Record<string, number>>(() => buildNameMap(BUNDLED_DYNASTY));
  const [redraftValuesBySleeperId, setRedraftValuesBySleeperId] = useState<Record<string, number>>(() => BUNDLED_REDRAFT.valuesBySleeperId ?? {});
  const [redraftNameValueMap, setRedraftNameValueMap] = useState<Record<string, number>>(() => buildNameMap(BUNDLED_REDRAFT));
  const [dynastyPlayerList, setDynastyPlayerList] = useState<RankedPlayer[]>(() => buildRankedList(BUNDLED_DYNASTY));
  const [customDynasty, setCustomDynasty] = useState<ResolvedCustomSet | null>(null);
  const [customRedraft, setCustomRedraft] = useState<ResolvedCustomSet | null>(null);
  // Exact KTC rookie-pick values keyed `${season}_${round}_${bucket}`. Empty
  // unless KTC is the active source.
  const [ktcPickMap, setKtcPickMap] = useState<Record<string, number>>({});
  const [diagnostics, setDiagnostics] = useState<ValueDiagnostics>({
    updatedAt: "",
    mappedCount: 0,
    unmatchedCount: 0,
    unmatchedRows: [],
    fetchedAt: null,
  });

  // Pull the user's active custom value sets. We don't gate this on auth
  // because the endpoint returns nulls for unauthenticated callers, which
  // means "no overrides — pure FantasyCalc". Re-fetched after upload via
  // refreshCustomValues().
  const refreshCustomValues = useCallback(async () => {
    try {
      const r = await scAuthFetch("/api/values/custom/resolved");
      if (!r.ok) {
        setCustomDynasty(null);
        setCustomRedraft(null);
        return;
      }
      const body = (await r.json()) as ResolvedCustomValuesResponse;
      setCustomDynasty(body.dynasty ?? null);
      setCustomRedraft(body.redraft ?? null);
    } catch (err) {
      console.warn("[ValueModel] resolve custom values failed:", err);
      setCustomDynasty(null);
      setCustomRedraft(null);
    }
  }, []);

  useEffect(() => {
    void refreshCustomValues();
    // Re-pull when the auth token changes (login/logout) so the resolver
    // never serves stale overrides from a previous account.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sc_auth_token") void refreshCustomValues();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshCustomValues]);

  useEffect(() => {
    // Both FantasyCalc and KTC are "online" base sources loaded into the same
    // value state. KTC has no redraft feed of its own, so we use FantasyCalc
    // redraft for win-now values either way.
    if (sourceId !== "fantasycalc" && sourceId !== "ktc") return;
    let cancelled = false;
    // We deliberately do NOT setIsLoading(true) here — state is already
    // seeded from the bundled snapshot, so the upgrade happens silently
    // in the background and the user never sees a blocking spinner.

    const isKtc = sourceId === "ktc";
    const dynastyFetch = isKtc ? getKtcValues("sf") : getFantasyCalcValues("sf");
    // KTC has its own redraft feed (fantasy-rankings); FantasyCalc uses its own.
    const redraftFetch = (isKtc ? getKtcRedraftValues("sf") : getFantasyCalcRedraftValues("sf")).catch((err) => {
      console.warn("[ValueModel] Redraft fetch failed, will use dynasty fallback:", err);
      return null;
    });

    Promise.all([dynastyFetch, redraftFetch])
      .then(([dynastyData, redraftData]: [any, any]) => {
        if (cancelled) return;
        // Defensive: if the source returned malformed OR empty data (e.g. a KTC
        // scrape miss), keep the existing/bundled values rather than nuking them.
        if (
          !dynastyData ||
          !dynastyData.valuesBySleeperId ||
          Object.keys(dynastyData.valuesBySleeperId).length === 0
        ) {
          setIsLoading(false);
          return;
        }

        setValuesBySleeperId(dynastyData.valuesBySleeperId);
        const byName: Record<string, number> = {};
        for (const p of dynastyData.players) {
          byName[`${p.name.toLowerCase().trim()}|${p.pos}`] = p.value;
        }
        setNameValueMap(byName);
        setDynastyPlayerList(
          (dynastyData.players || [])
            .filter((p: any) => p.sleeperId && p.value > 0)
            .sort((a: any, b: any) => b.value - a.value)
        );

        // KTC ships exact rookie-pick values; index them for getPickValue.
        if (isKtc && Array.isArray(dynastyData.picks)) {
          const pm: Record<string, number> = {};
          for (const pk of dynastyData.picks) pm[`${pk.season}_${pk.round}_${pk.bucket}`] = pk.value;
          setKtcPickMap(pm);
        } else {
          setKtcPickMap({});
        }

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
        console.warn("[ValueModel] FantasyCalc fetch failed, keeping bundled snapshot:", err);
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

  // KeepTradeCut only publishes a single trade-value set (it's effectively
  // 0.5-PPR — KTC has no Standard or full-PPR values). This isn't widely known,
  // so we surface a one-time-per-selection notice whenever the user switches to
  // KTC. Only fires on an explicit selection, never on initial load (which uses
  // setSourceIdRaw from localStorage).
  const [ktcNoticeOpen, setKtcNoticeOpen] = useState(false);

  const setSourceId = useCallback((id: ValueSourceId) => {
    const source = VALUE_SOURCES.find((s) => s.id === id);
    if (!source?.active) return;
    if (id === "ktc") setKtcNoticeOpen(true);
    try { localStorage.setItem("sc-value-source", id); } catch {}
    setIsRecalculating(true);
    setTimeout(() => {
      setSourceIdRaw(id);
      setTimeout(() => setIsRecalculating(false), 300);
    }, 400);
  }, []);

  // Custom-set lookup is the first cascade step: if the active user-uploaded
  // set has a value for this player (by sleeper id, then by normalized name+
  // position), return it. Otherwise fall through to FantasyCalc, then to the
  // raw player.value. This is the single source of truth — every downstream
  // consumer (Trade Calculator, Team Value, Rankings, etc.) goes through it.
  const lookupCustom = (custom: ResolvedCustomSet | null, player: Player): number | null => {
    if (!custom) return null;
    if (player.sleeperId && custom.valuesBySleeperId[player.sleeperId] !== undefined) {
      return custom.valuesBySleeperId[player.sleeperId];
    }
    const nameKey = `${player.name.toLowerCase().trim()}|${player.pos}`;
    if (custom.valuesByNamePos[nameKey] !== undefined) {
      return custom.valuesByNamePos[nameKey];
    }
    return null;
  };

  const baseSource: "fantasycalc" | "ktc" = sourceId === "ktc" ? "ktc" : "fantasycalc";

  const getPlayerValueWithSource = useCallback((player: Player): { value: number; source: "custom" | "fantasycalc" | "ktc" } => {
    const customVal = lookupCustom(customDynasty, player);
    if (customVal !== null) return { value: customVal, source: "custom" };

    if ((sourceId === "fantasycalc" || sourceId === "ktc") && valuesBySleeperId && Object.keys(valuesBySleeperId).length > 0) {
      if (player.sleeperId && valuesBySleeperId[player.sleeperId] !== undefined) {
        return { value: valuesBySleeperId[player.sleeperId], source: baseSource };
      }
      const nameKey = `${player.name.toLowerCase().trim()}|${player.pos}`;
      if (nameValueMap && nameValueMap[nameKey] !== undefined) {
        return { value: nameValueMap[nameKey], source: baseSource };
      }
    }
    return { value: player.value, source: baseSource };
  }, [customDynasty, sourceId, baseSource, valuesBySleeperId, nameValueMap]);

  const getPlayerValue = useCallback((player: Player): number => {
    return getPlayerValueWithSource(player).value;
  }, [getPlayerValueWithSource]);

  const getRedraftValueWithSource = useCallback((player: Player): { value: number; source: "custom" | "fantasycalc" | "ktc" } => {
    const customVal = lookupCustom(customRedraft, player);
    if (customVal !== null) return { value: customVal, source: "custom" };

    if ((sourceId === "fantasycalc" || sourceId === "ktc") && redraftValuesBySleeperId && Object.keys(redraftValuesBySleeperId).length > 0) {
      if (player.sleeperId && redraftValuesBySleeperId[player.sleeperId] !== undefined) {
        return { value: redraftValuesBySleeperId[player.sleeperId], source: baseSource };
      }
      const nameKey = `${player.name.toLowerCase().trim()}|${player.pos}`;
      if (redraftNameValueMap && redraftNameValueMap[nameKey] !== undefined) {
        return { value: redraftNameValueMap[nameKey], source: baseSource };
      }
    }
    return getPlayerValueWithSource(player);
  }, [customRedraft, sourceId, baseSource, redraftValuesBySleeperId, redraftNameValueMap, getPlayerValueWithSource]);

  const getRedraftValue = useCallback((player: Player): number => {
    return getRedraftValueWithSource(player).value;
  }, [getRedraftValueWithSource]);

  const getPickValue = useCallback((pick: Pick, totalRosters?: number): number => {
    const range = (pick.projectedRange || "mid").toLowerCase() as "early" | "mid" | "late";

    // KTC ships exact early/mid/late pick values — prefer them when active.
    const ktcPick = ktcPickMap[`${pick.year}_${pick.round}_${range}`];
    if (ktcPick != null && ktcPick > 0) return ktcPick;

    // For 2026 picks with a known draft slot, use exact values regardless of FantasyCalc
    if (pick.year === 2026 && pick.pickSlot != null && pick.pickSlot > 0 && totalRosters != null) {
      return getStaticPickValue(pick.year, pick.round, range, pick.pickSlot, totalRosters);
    }

    const fpKey = `FP_${pick.year}_${pick.round}`;
    const baseValue = valuesBySleeperId[fpKey];

    if (!baseValue) {
      return getStaticPickValue(pick.year, pick.round, range);
    }

    const roundMults = PICK_RANGE_MULTIPLIERS[pick.round] ?? { early: 1.15, mid: 1.0, late: 0.90 };
    const mult = roundMults[range] ?? 1.0;
    return Math.round(baseValue * mult);
  }, [valuesBySleeperId, ktcPickMap]);

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
      const totalDynasty = roster.reduce((s, p) => s + getPlayerValue(p), 0);
      const picksTotal = team.picks.reduce((s, p) => s + getPickValue(p), 0);
      const starterAvgAge = starters.length > 0
        ? starters.reduce((s, p) => s + p.age, 0) / starters.length
        : 26;

      const posStrength = (pos: string) => {
        const posPlayers = [...team.roster]
          .filter((p) => p.pos === pos)
          .map((p) => ({ ...p, val: getPlayerValue(p) }))
          .sort((a, b) => b.val - a.val);
        const starterCount = rosterPositions
          ? rosterPositions.filter((s) => s === pos).length || 1
          : 1;
        const posStarters = posPlayers.slice(0, starterCount);
        const depthPlayers = posPlayers.slice(starterCount, starterCount + 3);
        const starterVal = posStarters.reduce((s, p) => s + p.val, 0);
        const depthVal = depthPlayers.reduce((s, p) => s + p.val, 0);
        return starterVal + 0.5 * depthVal;
      };

      return {
        id: team.id,
        starterRedraft,
        totalDynasty,
        picksTotal,
        starterAvgAge,
        qbStrength: posStrength("QB"),
        rbStrength: posStrength("RB"),
        wrStrength: posStrength("WR"),
        teStrength: posStrength("TE"),
      };
    });

    const minMax = (arr: number[]) => ({ min: Math.min(...arr), max: Math.max(...arr) });
    const starterRange = minMax(rawData.map((d) => d.starterRedraft));
    const depthRange = minMax(rawData.map((d) => d.totalDynasty));
    const picksRange = minMax(rawData.map((d) => d.picksTotal));

    const result = new Map<string, TeamMetrics>();

    const overallRange = minMax(rawData.map((d) => d.starterRedraft + d.totalDynasty + d.picksTotal));

    const posRank = (pos: "qbStrength" | "rbStrength" | "wrStrength" | "teStrength", teamId: string) => {
      const sorted = [...rawData].sort((a, b) => b[pos] - a[pos]);
      const rank = sorted.findIndex((d) => d.id === teamId) + 1;
      const total = sorted.length;
      return Math.max(10, Math.min(99, Math.round(((total - rank) / (total - 1)) * 89 + 10)));
    };

    for (const d of rawData) {
      const combinedRaw = d.starterRedraft + d.totalDynasty + d.picksTotal;
      const overall = scale(combinedRaw, overallRange.min, overallRange.max);
      const starterScore = scale(d.starterRedraft, starterRange.min, starterRange.max);
      const depthScore = scale(d.totalDynasty, depthRange.min, depthRange.max);
      const picksScore = scale(d.picksTotal, picksRange.min, picksRange.max);
      const youthScore = Math.max(0, Math.min(100, Math.round(100 - (d.starterAvgAge - 23) * 8)));

      const contenderWindowYears = youthScore >= 70 && starterScore >= 55
        ? 4
        : youthScore >= 50 && starterScore >= 45
          ? 3
          : youthScore >= 30 && starterScore >= 35
            ? 2
            : 1;

      // How many years until the window opens — based on current roster strength.
      // High-Now teams: window is open immediately (0). Rebuilders: window opens 2-3 years out.
      const windowStartOffset = starterScore >= 55 ? 0
        : starterScore >= 45 ? 1
        : starterScore >= 35 ? 2
        : 3;

      result.set(d.id, {
        overall,
        starters: starterScore,
        depth: depthScore,
        youth: youthScore,
        picks: picksScore,
        qb: posRank("qbStrength", d.id),
        rb: posRank("rbStrength", d.id),
        wr: posRank("wrStrength", d.id),
        te: posRank("teStrength", d.id),
        contenderWindowYears,
        windowStartOffset,
      });
    }

    return result;
  }, [getPlayerValue, getRedraftValue, getPickValue, optimizeLineup]);

  const dynastyCustom: CustomSourceStatus = {
    active: !!customDynasty,
    setId: customDynasty?.setId ?? null,
    name: customDynasty?.name ?? null,
    matchedCount: customDynasty?.matchedCount ?? 0,
    unmatchedCount: customDynasty?.unmatchedCount ?? 0,
    updatedAt: customDynasty?.updatedAt ?? null,
  };
  const redraftCustom: CustomSourceStatus = {
    active: !!customRedraft,
    setId: customRedraft?.setId ?? null,
    name: customRedraft?.name ?? null,
    matchedCount: customRedraft?.matchedCount ?? 0,
    unmatchedCount: customRedraft?.unmatchedCount ?? 0,
    updatedAt: customRedraft?.updatedAt ?? null,
  };

  const value = useMemo<ValueModel>(() => ({
    sourceId,
    sources: VALUE_SOURCES,
    setSourceId,
    isRecalculating,
    isLoading,
    isSnapshot,
    unmatchedCount,
    diagnostics,
    dynastySource: customDynasty ? "custom" : baseSource,
    redraftSource: customRedraft ? "custom" : baseSource,
    dynastyCustom,
    redraftCustom,
    refreshCustomValues,
    getPlayerValue,
    getRedraftValue,
    getPlayerValueWithSource,
    getRedraftValueWithSource,
    getPickValue,
    calculateTeamValue,
    calculateAllTeamMetrics,
    optimizeLineup,
    valuesBySleeperId,
    redraftValuesBySleeperId,
    dynastyPlayerList,
  }), [sourceId, setSourceId, isRecalculating, isLoading, isSnapshot, unmatchedCount, diagnostics, customDynasty, customRedraft, refreshCustomValues, getPlayerValue, getRedraftValue, getPlayerValueWithSource, getRedraftValueWithSource, getPickValue, calculateTeamValue, calculateAllTeamMetrics, optimizeLineup, valuesBySleeperId, redraftValuesBySleeperId, dynastyPlayerList]);

  return (
    <ValueModelContext.Provider value={value}>
      {children}
      <Dialog open={ktcNoticeOpen} onOpenChange={setKtcNoticeOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-ktc-scoring-notice">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[#d4af37]" />
              Heads up about KeepTradeCut
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-left">
              <span className="block">
                KeepTradeCut publishes a single set of trade values — effectively{" "}
                <span className="font-semibold text-foreground">0.5&nbsp;PPR</span>. It does{" "}
                <span className="font-semibold text-foreground">not</span> offer separate{" "}
                Standard (non-PPR) or full&nbsp;1&nbsp;PPR values — that's just how their site works.
              </span>
              <span className="block">
                So while your league is shown for context, KTC values won't change between
                Standard, 0.5&nbsp;PPR, and 1&nbsp;PPR. For PPR-accurate values, use FantasyCalc instead.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setKtcNoticeOpen(false)}
              className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
              data-testid="btn-ktc-notice-ok"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ValueModelContext.Provider>
  );
}

export function useValueModel(): ValueModel {
  const ctx = useContext(ValueModelContext);
  if (!ctx) throw new Error("useValueModel must be used within ValueModelProvider");
  return ctx;
}
