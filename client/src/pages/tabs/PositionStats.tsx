/**
 * PositionStats — Advanced player stats leaderboard.
 *
 * Backed by 16 bundled JSON files in client/src/data/advanced_stats/ (one per
 * position × season combo). Each file is loaded lazily on demand so the initial
 * bundle isn't bloated. The column definitions inside each file drive the table
 * structure — labels, types, and default visibility are all data-driven.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  GitCompare,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import { computeQbCompositeScores, QB_SCORE_CATEGORIES } from "@/lib/qbCompositeScores";
import { computeRbCompositeScores, RB_SCORE_CATEGORIES } from "@/lib/rbCompositeScores";
import {
  computeWrCompositeScores,
  computeTeCompositeScores,
  WR_SCORE_CATEGORIES,
  TE_SCORE_CATEGORIES,
} from "@/lib/receivingComposites";

// ── Types ─────────────────────────────────────────────────────────────────────
type Position = "qb" | "rb" | "wr" | "te";
type SeasonKey = "all" | "2023" | "2024" | "2025";
type SortDir = "asc" | "desc";

interface ColDef {
  key: string;
  label: string;
  type: "number" | "decimal" | "string";
  defaultVisible: boolean;
}

interface AdvancedStatsData {
  updated_at: string;
  season: string | number;
  week: number | null;
  table: string;
  columns: ColDef[];
  rows: Record<string, unknown>[];
}

// ── Static import map (Vite requires string literals for code-splitting) ──────
type DataLoader = () => Promise<{ default: AdvancedStatsData }>;

const DATA_LOADERS: Record<string, DataLoader> = {
  qb_all:  () => import("@/data/advanced_stats/qb_advanced_stats_all.json"),
  qb_2023: () => import("@/data/advanced_stats/qb_advanced_stats_2023.json"),
  qb_2024: () => import("@/data/advanced_stats/qb_advanced_stats_2024.json"),
  qb_2025: () => import("@/data/advanced_stats/qb_advanced_stats_2025.json"),
  rb_all:  () => import("@/data/advanced_stats/rb_advanced_stats_all.json"),
  rb_2023: () => import("@/data/advanced_stats/rb_advanced_stats_2023.json"),
  rb_2024: () => import("@/data/advanced_stats/rb_advanced_stats_2024.json"),
  rb_2025: () => import("@/data/advanced_stats/rb_advanced_stats_2025.json"),
  wr_all:  () => import("@/data/advanced_stats/wr_advanced_stats_all.json"),
  wr_2023: () => import("@/data/advanced_stats/wr_advanced_stats_2023.json"),
  wr_2024: () => import("@/data/advanced_stats/wr_advanced_stats_2024.json"),
  wr_2025: () => import("@/data/advanced_stats/wr_advanced_stats_2025.json"),
  te_all:  () => import("@/data/advanced_stats/te_advanced_stats_all.json"),
  te_2023: () => import("@/data/advanced_stats/te_advanced_stats_2023.json"),
  te_2024: () => import("@/data/advanced_stats/te_advanced_stats_2024.json"),
  te_2025: () => import("@/data/advanced_stats/te_advanced_stats_2025.json"),
};

// ── UI constants ──────────────────────────────────────────────────────────────
const POSITIONS: { key: Position; label: string }[] = [
  { key: "qb", label: "QB" },
  { key: "rb", label: "RB" },
  { key: "wr", label: "WR" },
  { key: "te", label: "TE" },
];

const SEASONS: { key: SeasonKey; label: string }[] = [
  { key: "2025", label: "2025" },
  { key: "2024", label: "2024" },
  { key: "2023", label: "2023" },
  { key: "all",  label: "All" },
];

// Columns that are always pinned left and not in the toggleable list.
const PINNED_KEYS = new Set(["rank", "playerName", "player_name", "name", "team", "nfl_team"]);
// Columns that are never shown in the table (redundant or non-useful in this context).
const ALWAYS_HIDDEN = new Set([
  "playerId", "player_id", "sleeper_id", "sleeperId",
  "season",
  // WR/TE columns with no underlying data yet.
  "contestedCatchRate", "yardsAfterContactPerReception",
]);

// Super-headers: map each column key to the group label shown in the extra
// header row above the column names. Keys are grouped contiguously so the
// colspans line up with the rendered column order.
const QB_COLUMN_GROUPS: Record<string, string> = {
  overallQBGrade: "Composite Grades", volumeScore: "Composite Grades",
  accuracyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  mobilityScore: "Composite Grades", efficiencyScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  attempts: "Volume / Usage", completions: "Volume / Usage", passingYards: "Volume / Usage",
  airYards: "Volume / Usage", completedAirYards: "Volume / Usage", redZoneAttempts: "Volume / Usage",
  passingTouchdowns: "Volume / Usage", rushAttempts: "Volume / Usage", rushYards: "Volume / Usage",
  rushTouchdowns: "Volume / Usage",
  airYardsPerAttempt: "Aggressiveness / Play Style",
  completedAirYardsPerCompletion: "Aggressiveness / Play Style",
  yardsPerCatch: "Aggressiveness / Play Style",
  completionPct: "Efficiency", onTargetPct: "Efficiency", poorThrows: "Efficiency",
  badThrowPct: "Efficiency", interceptions: "Efficiency", epaPerPlay: "Efficiency",
  successRate: "Efficiency", cpoe: "Efficiency",
  passes10Plus: "Explosiveness", passes20Plus: "Explosiveness", passes30Plus: "Explosiveness",
  passes40Plus: "Explosiveness", passes50Plus: "Explosiveness", longestPass: "Explosiveness",
  deepAttemptPct: "Explosiveness",
  pocketTime: "Pressure & Pocket", timeToThrow: "Pressure & Pocket", throwaways: "Pressure & Pocket",
  battedPasses: "Pressure & Pocket", scrambleRate: "Pressure & Pocket", yardsPerScramble: "Pressure & Pocket",
  hurries: "Pressure & Pocket", blitzes: "Pressure & Pocket", knockdowns: "Pressure & Pocket",
  sacks: "Pressure & Pocket", sackYardsLost: "Pressure & Pocket", fumbles: "Pressure & Pocket",
  pressurePct: "Pressure & Pocket",
};

const RB_COLUMN_GROUPS: Record<string, string> = {
  overallRBGrade: "Composite Grades", volumeScore: "Composite Grades",
  efficiencyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  receivingScore: "Composite Grades", elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage / Workload", routes: "Usage / Workload", rushAttempts: "Usage / Workload",
  redZoneOpportunities: "Usage / Workload", goalLineCarries: "Usage / Workload",
  targets: "Usage / Workload", targetSharePct: "Usage / Workload", receptions: "Usage / Workload",
  redZoneTargets: "Usage / Workload", endZoneTargets: "Usage / Workload",
  rushYards: "Production", yardsPerCarry: "Production", rushTouchdowns: "Production",
  receivingYards: "Production", yardsPerReception: "Production", receivingYardsAfterCatch: "Production",
  yardsPerRouteRun: "Production", receivingTouchdowns: "Production", epaPerPlay: "Production",
  rushes10Plus: "Explosive Play Ability", rushes20Plus: "Explosive Play Ability",
  rushes30Plus: "Explosive Play Ability", rushes40Plus: "Explosive Play Ability",
  rushes50Plus: "Explosive Play Ability", explosiveRunPct: "Explosive Play Ability",
  breakawayRunPct: "Explosive Play Ability", longestRush: "Explosive Play Ability",
  longestRushTouchdown: "Explosive Play Ability",
  brokenTackles: "Contact & Tackle Breaking", rushAttemptsPerBrokenTackle: "Contact & Tackle Breaking",
  yardsBeforeContactPerAttempt: "Contact & Tackle Breaking",
  yardsAfterContactPerAttempt: "Contact & Tackle Breaking", tackleEludedRate: "Contact & Tackle Breaking",
  fumbles: "Ball Security / Negative Plays", tacklesForLoss: "Ball Security / Negative Plays",
  tacklesForLossYards: "Ball Security / Negative Plays", rushAttForNegativeYards: "Ball Security / Negative Plays",
};

// WR and TE share the same columns, so they share one group map.
const WR_TE_COLUMN_GROUPS: Record<string, string> = {
  overallWRGrade: "Composite Grades", overallTEGrade: "Composite Grades",
  volumeScore: "Composite Grades", efficiencyScore: "Composite Grades",
  explosivenessScore: "Composite Grades", handsScore: "Composite Grades",
  elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage/Role", routes: "Usage/Role", routePct: "Usage/Role", targets: "Usage/Role",
  targetsPerRouteRun: "Usage/Role", targetSharePct: "Usage/Role", airYardsPerTarget: "Usage/Role",
  airYardsPerReception: "Usage/Role", airYardsSharePct: "Usage/Role", wopr: "Usage/Role",
  redZoneTargets: "Usage/Role", endZoneTargets: "Usage/Role",
  receptions: "Production", receivingYards: "Production",
  yardsBeforeCatchPerReception: "Production", yardsAfterCatchPerReception: "Production",
  yardsPerReception: "Production", yardsPerRouteRun: "Production", receivingTouchdowns: "Production",
  epaPerPlay: "Production", successRate: "Production",
  catchPct: "Hands", contestedCatchRate: "Hands", catchableTargets: "Hands", drops: "Hands",
  dropPct: "Hands", interceptionsWhenTargeted: "Hands", fumbles: "Hands",
  avoidedTackleRate: "Elusiveness", brokenTackles: "Elusiveness",
  yardsAfterContactPerReception: "Elusiveness",
  receptions10Plus: "Explosiveness", receptions20Plus: "Explosiveness",
  receptions30Plus: "Explosiveness", receptions40Plus: "Explosiveness",
  receptions50Plus: "Explosiveness", longestReception: "Explosiveness",
};

// Super-header group maps keyed by position (omit a position to show no groups).
const COLUMN_GROUPS_BY_POSITION: Record<string, Record<string, string>> = {
  qb: QB_COLUMN_GROUPS,
  rb: RB_COLUMN_GROUPS,
  wr: WR_TE_COLUMN_GROUPS,
  te: WR_TE_COLUMN_GROUPS,
};

// Per-section accent colour — drives the left accent bar + header text so each
// stat family is instantly scannable (and consistent across positions).
const SECTION_ACCENTS: Record<string, string> = {
  "Composite Grades":             "#d4af37", // gold
  "Player Info":                  "#94a3b8", // slate
  "Volume / Usage":               "#f59e0b", // amber
  "Usage / Workload":             "#f59e0b",
  "Usage/Role":                   "#f59e0b",
  "Aggressiveness / Play Style":  "#fb923c", // orange
  "Efficiency":                   "#60a5fa", // blue
  "Production":                   "#34d399", // emerald
  "Explosiveness":                "#c084fc", // purple
  "Explosive Play Ability":       "#c084fc",
  "Pressure & Pocket":            "#22d3ee", // cyan
  "Hands":                        "#2dd4bf", // teal
  "Elusiveness":                  "#fb7185", // rose
  "Contact & Tackle Breaking":    "#22d3ee",
  "Ball Security / Negative Plays":"#f87171", // red
};
const sectionAccent = (label: string): string => SECTION_ACCENTS[label] ?? "#94a3b8";
// Shared header bar gradient (left → right). The trailing solid colour matches
// the gradient's end so a sticky label cell + filler cell stay seamless.
const SECTION_BAR_GRADIENT = "linear-gradient(90deg, rgba(20,35,60,0.97) 0%, rgba(12,22,40,0.97) 100%)";
const SECTION_BAR_END = "rgba(12,22,40,0.97)";

// ── Composite scores ───────────────────────────────────────────────────────────
// Per-position grade engine: a function that scores the full pool of rows and
// the ordered category metadata (Overall first) that becomes the grade columns.
interface ScoreCategoryMeta { key: string; label: string; shortLabel: string; description: string }
interface ScoreEngine {
  compute: (rows: Record<string, unknown>[]) => Array<Record<string, number>>;
  categories: ScoreCategoryMeta[];
}
const SCORE_ENGINES: Record<Position, ScoreEngine> = {
  // QB/RB engines return nominal interfaces (all-number fields); cast to the
  // shared index-signature shape the table consumes.
  qb: { compute: computeQbCompositeScores as unknown as ScoreEngine["compute"], categories: QB_SCORE_CATEGORIES },
  rb: { compute: computeRbCompositeScores as unknown as ScoreEngine["compute"], categories: RB_SCORE_CATEGORIES },
  wr: { compute: computeWrCompositeScores, categories: WR_SCORE_CATEGORIES },
  te: { compute: computeTeCompositeScores, categories: TE_SCORE_CATEGORIES },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatVal(v: unknown, type: ColDef["type"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (type === "decimal") return v.toFixed(2);
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(2);
  }
  if (typeof v === "string") return v || "—";
  if (typeof v === "boolean") return v ? "✓" : "—";
  return String(v);
}

function numVal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return -Infinity;
}

// Maximum players that can be compared side-by-side at once.
const MAX_COMPARE = 5;

// Stable identity + display helpers tolerant of the varying key names across
// the bundled JSON files.
function getPlayerKey(row: Record<string, unknown>): string {
  return String(
    row.playerId ?? row.player_id ?? row.sleeper_id ?? row.sleeperId ??
    row.playerName ?? row.player_name ?? row.name ?? "",
  );
}
function getPlayerName(row: Record<string, unknown>): string {
  return String(row.playerName ?? row.player_name ?? row.name ?? "—");
}
function getPlayerTeam(row: Record<string, unknown>): string {
  return String(row.team ?? row.nfl_team ?? "—");
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 opacity-35 shrink-0" />;
  return sortDir === "asc"
    ? <ChevronUp   className="w-3 h-3 text-[#d4af37] shrink-0" />
    : <ChevronDown className="w-3 h-3 text-[#d4af37] shrink-0" />;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PositionStats() {
  const [subTab, setSubTab]         = useState<"data" | "compare">("data");
  const [position, setPosition]     = useState<Position>("qb");
  const [season, setSeason]         = useState<SeasonKey>("2025");
  const [data, setData]             = useState<AdvancedStatsData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [sortKey, setSortKey]       = useState("rank");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set());
  const [showColPanel, setShowColPanel] = useState(false);
  // Compare sub-tab: a fixed set of MAX_COMPARE slots, each holding a player key
  // (or null when empty). openSlot is the slot whose picker dropdown is open.
  const [compareSlots, setCompareSlots] = useState<(string | null)[]>(() =>
    Array(MAX_COMPARE).fill(null),
  );
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [slotQuery, setSlotQuery] = useState("");

  // Load the JSON file whenever position or season changes
  useEffect(() => {
    const loaderKey = `${position}_${season}`;
    const loader = DATA_LOADERS[loaderKey];
    if (!loader) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSortKey("rank");
    setSortDir("asc");
    setSearch("");
    setShowColPanel(false);
    setCompareSlots(Array(MAX_COMPARE).fill(null));
    setOpenSlot(null);
    setSlotQuery("");

    loader()
      .then((mod) => {
        if (cancelled) return;
        setData(mod.default as AdvancedStatsData);
        // Default visible columns are derived from `scoredData` (which adds the
        // grade columns) in the effect below, so they're not set here.
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [position, season]);

  // ── Composite scores ────────────────────────────────────────────────────────
  // Grade columns + descriptions for the active position (Overall first).
  const scoreCategories = SCORE_ENGINES[position].categories;
  const scoreKeySet = useMemo(
    () => new Set(scoreCategories.map((c) => c.key)),
    [scoreCategories],
  );
  const scoreDescByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of scoreCategories) m[c.key] = c.description;
    return m;
  }, [scoreCategories]);

  // The loaded data augmented with composite grade columns. Scores are computed
  // against the FULL pool (every row, unfiltered/unsorted) so percentiles aren't
  // distorted by the current search/sort, then merged onto each row by index.
  // Grade columns are appended so they render at the end of the table and trail
  // the Columns panel.
  const scoredData = useMemo<AdvancedStatsData | null>(() => {
    if (!data) return null;
    const { compute, categories } = SCORE_ENGINES[position];
    const scores = compute(data.rows);
    const scoreCols: ColDef[] = categories.map((c) => ({
      key: c.key,
      label: c.shortLabel,
      type: "number",
      defaultVisible: true,
    }));
    const rows = data.rows.map((r, i) => ({ ...r, ...scores[i] }));
    return { ...data, columns: [...data.columns, ...scoreCols], rows };
  }, [data, position]);

  // Reset visible columns to defaults (including grades) whenever a new dataset
  // loads.
  useEffect(() => {
    if (!scoredData) return;
    setVisibleCols(
      new Set(
        scoredData.columns
          .filter((c) => c.defaultVisible && !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key))
          .map((c) => c.key),
      ),
    );
  }, [scoredData]);

  // All toggleable stat columns (grades first, then the JSON columns in order)
  const allStatCols = useMemo<ColDef[]>(() => {
    if (!scoredData) return [];
    return scoredData.columns.filter(
      (c) => !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key),
    );
  }, [scoredData]);

  // Only the currently-visible stat columns
  const activeCols = useMemo(
    () => allStatCols.filter((c) => visibleCols.has(c.key)),
    [allStatCols, visibleCols],
  );

  // Super-header segments: contiguous column groups → colspans. The first two
  // rendered columns (# and Player) are frozen, so they get their own sticky cell.
  const groupSegments = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    if (!groupMap) return [];
    const seq = ["rank", "playerName", "team", ...activeCols.map((c) => c.key)];
    const segs: { label: string; span: number; sticky?: boolean; showLabel: boolean }[] = [];
    for (const key of seq) {
      const label = groupMap[key] ?? "";
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.span += 1;
      else segs.push({ label, span: 1, showLabel: true });
    }
    // Split off the two frozen columns into a sticky cell that pins to the left.
    const first = segs[0];
    if (first && first.span >= 2) {
      const rest = first.span - 2;
      segs[0] = { label: first.label, span: 2, sticky: true, showLabel: true };
      if (rest > 0) segs.splice(1, 0, { label: first.label, span: rest, showLabel: false });
    }
    return segs;
  }, [position, activeCols]);

  // Keys of the stat columns that begin a new group — used to draw a vertical
  // divider down the table at each group boundary.
  const groupBoundaryKeys = useMemo(() => {
    const set = new Set<string>();
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    if (!groupMap) return set;
    let prevLabel = groupMap["team"] ?? "";
    for (const c of activeCols) {
      const label = groupMap[c.key] ?? "";
      if (label !== prevLabel) set.add(c.key);
      prevLabel = label;
    }
    return set;
  }, [position, activeCols]);

  const colByKey = useMemo<Record<string, ColDef>>(() => {
    const m: Record<string, ColDef> = {};
    for (const c of scoredData?.columns ?? []) m[c.key] = c;
    return m;
  }, [scoredData]);

  // Filter by search, then sort
  const rows = useMemo(() => {
    if (!scoredData) return [];
    let r = scoredData.rows;
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((row) => {
        const name = String(row.playerName ?? row.player_name ?? row.name ?? "").toLowerCase();
        const team = String(row.team ?? row.nfl_team ?? "").toLowerCase();
        return name.includes(q) || team.includes(q);
      });
    }
    if (sortKey) {
      const colDef = colByKey[sortKey];
      const numeric = !colDef || colDef.type === "number" || colDef.type === "decimal";
      r = [...r].sort((a, b) => {
        let cmp: number;
        if (numeric) {
          const av = numVal(a[sortKey]);
          const bv = numVal(b[sortKey]);
          // Push missing values to the end regardless of sort direction
          if (av === -Infinity && bv !== -Infinity) return 1;
          if (bv === -Infinity && av !== -Infinity) return -1;
          cmp = av - bv;
        } else {
          cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [scoredData, search, sortKey, sortDir, colByKey]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" || key === "playerName" || key === "team" ? "asc" : "desc");
    }
  };

  // ── Compare sub-tab derived data ────────────────────────────────────────────
  // The selected players, resolved to their rows in current display order.
  const compareRows = useMemo(() => {
    if (!scoredData) return [];
    const byKey = new Map(scoredData.rows.map((r) => [getPlayerKey(r), r]));
    return compareSlots
      .filter((id): id is string => id != null)
      .map((id) => byKey.get(id))
      .filter((r): r is Record<string, unknown> => r != null);
  }, [scoredData, compareSlots]);

  // Players selectable in the currently-open slot picker: the pool minus anyone
  // already chosen in another slot, filtered by the picker's own search box.
  const slotMatches = useMemo(() => {
    if (!scoredData || openSlot == null) return [];
    const selected = new Set(compareSlots.filter((id): id is string => id != null));
    const q = slotQuery.trim().toLowerCase();
    return scoredData.rows.filter((row) => {
      if (selected.has(getPlayerKey(row))) return false;
      if (!q) return true;
      return (
        getPlayerName(row).toLowerCase().includes(q) ||
        getPlayerTeam(row).toLowerCase().includes(q)
      );
    });
  }, [scoredData, openSlot, slotQuery, compareSlots]);

  // Visible stat columns bucketed by super-header group (the compare table's rows).
  const compareGroups = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    const order: string[] = [];
    const byLabel = new Map<string, ColDef[]>();
    for (const c of activeCols) {
      const label = groupMap?.[c.key] ?? "Other";
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
      byLabel.get(label)!.push(c);
    }
    return order.map((label) => ({ label, cols: byLabel.get(label)! }));
  }, [activeCols, position]);

  const openSlotPicker = (index: number) => {
    setOpenSlot((cur) => (cur === index ? null : index));
    setSlotQuery("");
  };
  const assignSlot = (index: number, row: Record<string, unknown>) => {
    const id = getPlayerKey(row);
    setCompareSlots((prev) => prev.map((s, i) => (i === index ? id : s)));
    setOpenSlot(null);
    setSlotQuery("");
  };
  const clearSlot = (index: number) =>
    setCompareSlots((prev) => prev.map((s, i) => (i === index ? null : s)));
  // Clear whichever slot currently holds this player (used by the table's
  // column-header remove button).
  const removeById = (id: string) =>
    setCompareSlots((prev) => prev.map((s) => (s === id ? null : s)));

  // Toggleable stat columns bucketed by their super-header group, in order.
  // The Columns panel toggles whole groups rather than individual columns.
  const statColGroups = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    const order: string[] = [];
    const byLabel = new Map<string, string[]>();
    for (const c of allStatCols) {
      const label = groupMap?.[c.key] ?? "Other";
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
      byLabel.get(label)!.push(c.key);
    }
    return order.map((label) => ({ label, keys: byLabel.get(label)! }));
  }, [allStatCols, position]);

  // Show every column in the group if any are hidden; otherwise hide them all.
  const toggleGroup = (keys: string[]) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      const allVisible = keys.every((k) => next.has(k));
      keys.forEach((k) => (allVisible ? next.delete(k) : next.add(k)));
      return next;
    });

  const updatedAt = data?.updated_at
    ? new Date(data.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  // Pill-style sub-tab toggle (matches the My Portfolio Overview/Finances tabs)
  const renderSubTabToggle = (testidPrefix: string) =>
    (["data", "compare"] as const).map((tab) => {
      const isActive = subTab === tab;
      const Icon = tab === "data" ? Table2 : GitCompare;
      const label = tab === "data" ? "Data" : "Compare";
      return (
        <button
          key={tab}
          onClick={() => setSubTab(tab)}
          data-testid={`${testidPrefix}-${tab}`}
          className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
          style={{
            borderRadius: 12, fontSize: 13, letterSpacing: "0.01em",
            background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent",
            color: isActive ? "#fff" : "rgba(203,213,225,0.45)",
            border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent",
            boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
          }}
        >
          <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
          {label}
          {isActive && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }} />}
        </button>
      );
    });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Position Stats"
          subtitle="Advanced stats leaderboard — sortable, searchable, with customizable columns."
        />
        <div
          className="hidden md:grid flex-shrink-0"
          style={{ gridTemplateColumns: "1fr 1fr", height: 48, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4, width: 240 }}
        >
          {renderSubTabToggle("stats-subtab")}
        </div>
      </div>

      {/* Mobile sub-tab toggle */}
      <div className="md:hidden flex justify-center sm:justify-start">
        <div
          className="grid w-full sm:w-auto"
          style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 420, height: 48, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4 }}
        >
          {renderSubTabToggle("stats-subtab-mobile")}
        </div>
      </div>

      {/* ── Shared controls card (both Data and Compare sub-tabs) ────────── */}
      <Card className="p-4 space-y-3" data-testid="position-stats-controls">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Position selector */}
          <div className="space-y-1.5 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Position
            </span>
            <div className="flex gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPosition(p.key)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    position === p.key
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
                  )}
                  data-testid={`btn-position-${p.key}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Season selector */}
          <div className="space-y-1.5 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Season
            </span>
            <div className="flex gap-1">
              {SEASONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSeason(s.key)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    season === s.key
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
                  )}
                  data-testid={`btn-season-${s.key}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search + column toggle row. The free-text search filters the Data
            table; Compare selects players via the 5 slot pickers instead. */}
        <div className="flex gap-2">
          {subTab !== "compare" && (
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search player or team…"
                className="pl-8 h-8 text-xs"
                data-testid="input-player-search"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="btn-clear-search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setShowColPanel((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold border transition-colors shrink-0",
              subTab === "compare" && "ml-auto",
              showColPanel
                ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
            data-testid="btn-toggle-col-panel"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Columns
          </button>
        </div>

        {/* Column visibility panel */}
        {showColPanel && allStatCols.length > 0 && (
          <div className="border border-border/50 rounded-lg p-3 bg-muted/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {visibleCols.size} of {allStatCols.length} columns visible
              </span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <button
                  onClick={() => setVisibleCols(new Set(allStatCols.map((c) => c.key)))}
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-show-all-cols"
                >
                  Show all
                </button>
                <span className="opacity-40">·</span>
                <button
                  onClick={() =>
                    setVisibleCols(
                      new Set(allStatCols.filter((c) => c.defaultVisible).map((c) => c.key)),
                    )
                  }
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-reset-cols"
                >
                  Reset defaults
                </button>
                <span className="opacity-40">·</span>
                <button
                  onClick={() => setVisibleCols(new Set())}
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-hide-all-cols"
                >
                  Hide all
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statColGroups.map((g) => {
                const allVisible = g.keys.every((k) => visibleCols.has(k));
                const someVisible = g.keys.some((k) => visibleCols.has(k));
                return (
                  <button
                    key={g.label}
                    onClick={() => toggleGroup(g.keys)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors",
                      allVisible
                        ? "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40"
                        : someVisible
                          ? "bg-[#d4af37]/[0.06] text-[#d4af37]/80 border-[#d4af37]/25 border-dashed"
                          : "bg-transparent text-muted-foreground/50 border-border/50 hover:border-foreground/20 hover:text-muted-foreground",
                    )}
                    data-testid={`btn-col-group-${g.label}`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta row */}
        {!loading && data && (
          <p className="text-[10px] text-muted-foreground/55 leading-none">
            {position.toUpperCase()} · {season === "all" ? "All Seasons" : `${season} Season`}
            {subTab === "compare"
              ? ` · comparing ${compareRows.length} of ${MAX_COMPARE} players`
              : ` · ${rows.length} of ${data.rows.length} players`}
            {updatedAt && ` · Updated ${updatedAt}`}
          </p>
        )}
      </Card>

      {/* ── Loading (shared) ─────────────────────────────────────────────── */}
      {loading && (
        <Card className="p-8 text-center" data-testid="loading-state">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Loading {position.toUpperCase()} · {season === "all" ? "All Seasons" : season}…
          </p>
        </Card>
      )}

      {/* ── Error (shared) ───────────────────────────────────────────────── */}
      {!loading && error && (
        <Card className="p-6 border-red-500/40 bg-red-500/5" data-testid="error-state">
          <p className="text-sm font-semibold text-red-500 mb-1">Failed to load data</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </Card>
      )}

      {/* ── Compare sub-tab — slot pickers + transposed table ───────────── */}
      {!loading && !error && data && subTab === "compare" && (
        <div className="space-y-5">

          {/* Player slot pickers: MAX_COMPARE slots, each a "+ Add player"
              dropdown when empty or a filled chip with a clear button. */}
          <Card className="p-4" data-testid="compare-slots">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Players · {compareRows.length} of {MAX_COMPARE}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {compareSlots.map((slotId, i) => {
                const row = slotId ? scoredData?.rows.find((r) => getPlayerKey(r) === slotId) : null;
                const isOpen = openSlot === i;
                return (
                  <div key={i} className="relative">
                    {row ? (
                      <div
                        className="flex items-center justify-between gap-1.5 h-10 px-2.5 rounded-md border border-[#0b3a7a]/40 bg-[#0b3a7a]/12"
                        data-testid={`compare-slot-${i}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">{getPlayerName(row)}</span>
                          <span className="block text-[10px] text-muted-foreground leading-none">{getPlayerTeam(row)}</span>
                        </span>
                        <button
                          onClick={() => clearSlot(i)}
                          className="shrink-0 text-muted-foreground/70 hover:text-foreground"
                          data-testid={`compare-slot-clear-${i}`}
                          aria-label={`Clear player slot ${i + 1}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openSlotPicker(i)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 w-full h-10 rounded-md border border-dashed text-xs font-semibold transition-colors",
                          isOpen
                            ? "border-[#0b3a7a] text-foreground bg-[#0b3a7a]/10"
                            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                        )}
                        data-testid={`compare-slot-add-${i}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add player
                      </button>
                    )}

                    {/* Per-slot player picker dropdown */}
                    {isOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setOpenSlot(null)} data-testid="compare-slot-backdrop" />
                        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-md border border-border bg-[hsl(var(--card))] shadow-lg overflow-hidden">
                          <div className="relative border-b border-border/50">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                            <Input
                              autoFocus
                              value={slotQuery}
                              onChange={(e) => setSlotQuery(e.target.value)}
                              placeholder={`Search ${position.toUpperCase()}…`}
                              className="pl-8 h-8 text-xs border-0 rounded-none focus-visible:ring-0"
                              data-testid={`compare-slot-search-${i}`}
                            />
                          </div>
                          <div className="max-h-60 overflow-y-auto">
                            {slotMatches.length === 0 ? (
                              <p className="px-3 py-2 text-[11px] text-muted-foreground italic">No players found.</p>
                            ) : (
                              slotMatches.map((pr) => {
                                const pid = getPlayerKey(pr);
                                return (
                                  <button
                                    key={pid}
                                    onClick={() => assignSlot(i, pr)}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#0b3a7a]/10 transition-colors"
                                    data-testid={`compare-slot-option-${i}-${pid}`}
                                  >
                                    <span className="font-medium text-foreground truncate">{getPlayerName(pr)}</span>
                                    <span className="text-[10px] text-muted-foreground shrink-0">{getPlayerTeam(pr)}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Comparison table (or hints) */}
          {compareRows.length === 0 ? (
            <Card className="p-10 text-center" data-testid="compare-empty">
              <GitCompare className="w-7 h-7 text-muted-foreground/60 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">Compare players side-by-side</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Add up to {MAX_COMPARE} {position.toUpperCase()}s using the slots above. Stats run down
                the rows so you can scan each metric across players. Use Columns to choose which stats appear.
              </p>
            </Card>
          ) : activeCols.length === 0 ? (
            <Card className="p-10 text-center" data-testid="compare-no-cols">
              <p className="text-xs text-amber-500/80 italic">
                No stat columns visible — open Columns to add some.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0" data-testid="compare-table-card">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse" data-testid="compare-table">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/25">
                    <th className="sticky left-0 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground border-r border-border/25 min-w-[150px]">
                      Stat
                    </th>
                    {compareRows.map((r) => {
                      const id = getPlayerKey(r);
                      return (
                        <th
                          key={id}
                          className="px-3 py-2.5 text-right font-bold text-muted-foreground whitespace-nowrap min-w-[120px] border-l border-border/25"
                          data-testid={`compare-col-${id}`}
                        >
                          <div className="flex items-start justify-end gap-1.5">
                            <span className="flex flex-col items-end">
                              <span className="text-foreground font-semibold normal-case text-xs">
                                {getPlayerName(r)}
                              </span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {getPlayerTeam(r)}
                              </span>
                            </span>
                            <button
                              onClick={() => removeById(id)}
                              className="text-muted-foreground/60 hover:text-foreground mt-0.5"
                              data-testid={`compare-remove-${id}`}
                              aria-label={`Remove ${getPlayerName(r)}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {compareGroups.map((g, gi) => {
                    const accent = sectionAccent(g.label);
                    return (
                    <Fragment key={g.label}>
                      {/* Vertical separation before each section (not the first) */}
                      {gi > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={1 + compareRows.length} className="p-0">
                            <div className="h-4" />
                          </td>
                        </tr>
                      )}
                      {g.label && (
                        <tr data-testid={`compare-section-${g.label}`}>
                          {/* Sticky label cell: gradient bar + coloured left accent */}
                          <td
                            className="sticky left-0 z-10 px-3 py-2.5 whitespace-nowrap"
                            style={{
                              background: SECTION_BAR_GRADIENT,
                              borderLeft: `3px solid ${accent}`,
                              borderTop: "1px solid rgba(255,255,255,0.08)",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <span
                              className="text-[10px] font-extrabold uppercase"
                              style={{ color: accent, letterSpacing: "0.12em" }}
                            >
                              {g.label}
                            </span>
                          </td>
                          {/* Filler cell continues the bar across the player columns */}
                          <td
                            colSpan={compareRows.length}
                            style={{
                              background: SECTION_BAR_END,
                              borderTop: "1px solid rgba(255,255,255,0.08)",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          />
                        </tr>
                      )}
                      {g.cols.map((col, ci) => {
                        // Highlight the highest numeric value across the compared
                        // players (string columns get no highlight).
                        let max = -Infinity;
                        if (col.type !== "string") {
                          for (const r of compareRows) {
                            const v = numVal(r[col.key]);
                            if (v > max) max = v;
                          }
                        }
                        const hasLeader = max !== -Infinity && compareRows.length > 1;
                        const isScore = scoreKeySet.has(col.key);
                        const stickyBg = ci % 2 === 1
                          ? "linear-gradient(hsl(var(--muted) / 0.7), hsl(var(--muted) / 0.7)), hsl(var(--card))"
                          : "hsl(var(--card))";
                        return (
                          <tr
                            key={col.key}
                            className={cn(
                              "border-b border-border/15 hover:bg-[#0b3a7a]/5 transition-colors",
                              ci % 2 === 1 && "bg-muted/40",
                            )}
                            data-testid={`compare-row-${col.key}`}
                          >
                            <td
                              style={{ background: stickyBg }}
                              title={isScore ? scoreDescByKey[col.key] : undefined}
                              className={cn(
                                "sticky left-0 z-10 px-3 py-2 whitespace-nowrap border-r border-border/25",
                                isScore ? "font-semibold text-foreground/90 cursor-help" : "font-medium text-muted-foreground",
                              )}
                            >
                              {col.label}
                            </td>
                            {compareRows.map((r) => {
                              const raw = r[col.key];
                              const isEmpty = raw == null;
                              const isLeader = hasLeader && !isEmpty && numVal(raw) === max;
                              return (
                                <td
                                  key={getPlayerKey(r)}
                                  className={cn(
                                    "px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-border/25",
                                    isLeader
                                      ? "bg-[#d4af37]/[0.08] text-[#d4af37] font-semibold"
                                      : isEmpty
                                        ? "text-muted-foreground/30"
                                        : "text-foreground/90",
                                  )}
                                  data-testid={`compare-cell-${col.key}-${getPlayerKey(r)}`}
                                >
                                  {formatVal(raw, col.type)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-border/25 bg-muted/10">
              <p className="text-[10px] text-muted-foreground/60">
                Comparing {compareRows.length} of {MAX_COMPARE} player{compareRows.length !== 1 ? "s" : ""}
                {compareRows.length > 1 && " · highest value in each stat highlighted"}
              </p>
            </div>
          </Card>
          )}
        </div>
      )}

      {/* ── Data sub-tab ─────────────────────────────────────────────────── */}
      {!loading && !error && data && subTab === "data" && (
        <Card className="overflow-hidden p-0" data-testid="stats-table-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="stats-table">
              <thead>
                {/* Super-headers (desktop only; mobile hides the Team column) */}
                {groupSegments.length > 0 && (
                  <tr className="hidden md:table-row">
                    {groupSegments.map((seg, i) => {
                      const accent = sectionAccent(seg.label);
                      return (
                      <th
                        key={`grp-${i}`}
                        colSpan={seg.span}
                        className={cn(
                          "px-3 py-2 text-center font-extrabold uppercase text-[10px]",
                          seg.sticky && "sticky left-0 z-30",
                        )}
                        style={{
                          background: SECTION_BAR_GRADIENT,
                          color: seg.showLabel ? accent : undefined,
                          letterSpacing: "0.12em",
                          // Coloured left accent at the start of each labelled section
                          borderLeft: seg.showLabel && i > 0 ? `3px solid ${accent}` : undefined,
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {seg.showLabel ? seg.label : null}
                      </th>
                      );
                    })}
                  </tr>
                )}
                <tr className="border-b border-border/50 bg-muted/25">
                  {/* # (rank) */}
                  <th
                    onClick={() => handleSort("rank")}
                    className="sticky left-0 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25 w-10 min-w-[40px]"
                    data-testid="th-rank"
                  >
                    <span className="flex items-center gap-0.5">
                      # <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Player */}
                  <th
                    onClick={() => handleSort("playerName")}
                    className="sticky left-10 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25 min-w-[148px]"
                    data-testid="th-player"
                  >
                    <span className="flex items-center gap-0.5">
                      Player <SortIcon col="playerName" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Team (hidden on mobile — shown inline next to player name instead) */}
                  <th
                    onClick={() => handleSort("team")}
                    className="hidden md:table-cell px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25"
                    data-testid="th-team"
                  >
                    <span className="flex items-center gap-0.5">
                      Team <SortIcon col="team" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Stat columns */}
                  {activeCols.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      title={scoreKeySet.has(col.key) ? scoreDescByKey[col.key] : undefined}
                      className={cn(
                        "px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-foreground transition-colors whitespace-nowrap",
                        sortKey === col.key
                          ? "text-[#d4af37]"
                          : "text-muted-foreground",
                        groupBoundaryKeys.has(col.key) && "border-l-2 border-border/70",
                      )}
                      data-testid={`th-${col.key}`}
                    >
                      <span className="flex items-center justify-end gap-0.5">
                        {col.label}
                        <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3 + activeCols.length}
                      className="px-4 py-10 text-center text-muted-foreground text-xs italic"
                      data-testid="no-results"
                    >
                      No players match your search.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const rank = row.rank as number | undefined;
                    const name = String(row.playerName ?? row.player_name ?? row.name ?? "—");
                    const team = String(row.team ?? row.nfl_team ?? "—");
                    // Mobile shows "F. Last" (first initial + last name); fall back
                    // to the raw name when it isn't a simple two-part name.
                    const nameParts = name.trim().split(/\s+/);
                    const shortName = nameParts.length >= 2
                      ? `${nameParts[0][0]}. ${nameParts.slice(1).join(" ")}`
                      : name;
                    // Opaque background for the sticky (frozen) cells so scrolled
                    // columns never show through behind the rank/player text.
                    const stickyBg = idx % 2 === 1
                      ? "linear-gradient(hsl(var(--muted) / 0.7), hsl(var(--muted) / 0.7)), hsl(var(--card))"
                      : "hsl(var(--card))";
                    return (
                      <tr
                        key={`${rank ?? idx}-${name}`}
                        className={cn(
                          "border-b border-border/15 hover:bg-[#0b3a7a]/5 transition-colors",
                          idx % 2 === 1 && "bg-muted/70",
                        )}
                        data-testid={`row-player-${idx}`}
                      >
                        {/* Rank */}
                        <td
                          style={{ background: stickyBg }}
                          className="sticky left-0 z-10 px-3 py-2 text-right font-mono text-[11px] text-muted-foreground/60 border-r border-border/25 w-10 min-w-[40px]"
                        >
                          {rank ?? idx + 1}
                        </td>
                        {/* Player name */}
                        <td
                          style={{ background: stickyBg }}
                          className="sticky left-10 z-10 px-3 py-2 font-semibold text-foreground whitespace-nowrap border-r border-border/25 min-w-[148px]"
                        >
                          {/* Desktop: full name. Mobile: "F. Last" + faint team. */}
                          <span className="hidden md:inline">{name}</span>
                          <span className="md:hidden">
                            {shortName}
                            <span className="ml-1.5 font-normal text-muted-foreground/60">{team}</span>
                          </span>
                        </td>
                        {/* Team badge (hidden on mobile — shown inline next to name) */}
                        <td className="hidden md:table-cell px-3 py-2 whitespace-nowrap border-r border-border/25">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-[#0b3a7a]/12 text-white dark:bg-blue-400/15 dark:text-white">
                            {team}
                          </span>
                        </td>
                        {/* Stat cells */}
                        {activeCols.map((col) => {
                          const raw = row[col.key];
                          const isEmpty = raw == null;
                          const isSorted = sortKey === col.key;
                          // Grade cells are bolded so they read as the headline
                          // numbers, but otherwise styled like any stat cell.
                          const isScore = scoreKeySet.has(col.key);
                          return (
                            <td
                              key={col.key}
                              className={cn(
                                "px-3 py-2 text-right tabular-nums whitespace-nowrap",
                                isSorted && "bg-[#d4af37]/[0.04]",
                                isScore && "font-semibold",
                                isEmpty
                                  ? "text-muted-foreground/30"
                                  : "text-foreground/90",
                                groupBoundaryKeys.has(col.key) && "border-l-2 border-border/70",
                              )}
                              data-testid={`cell-${col.key}-${idx}`}
                            >
                              {formatVal(raw, col.type)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {rows.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border/25 bg-muted/10 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60">
                Showing {rows.length} player{rows.length !== 1 ? "s" : ""}
                {search ? ` matching "${search}"` : ""}
              </p>
              {activeCols.length === 0 && (
                <p className="text-[10px] text-amber-500/80 italic">
                  No stat columns visible — open Columns to add some.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
