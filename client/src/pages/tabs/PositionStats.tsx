/**
 * PositionStats — Advanced player stats leaderboard.
 *
 * Backed by 16 bundled JSON files in client/src/data/advanced_stats/ (one per
 * position × season combo). Each file is loaded lazily on demand so the initial
 * bundle isn't bloated. The column definitions inside each file drive the table
 * structure — labels, types, and default visibility are all data-driven.
 */

import { useEffect, useMemo, useState } from "react";
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
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";

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
]);

// Super-headers: map each column key to the group label shown in the extra
// header row above the column names. Keys are grouped contiguously so the
// colspans line up with the rendered column order.
const QB_COLUMN_GROUPS: Record<string, string> = {
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

    loader()
      .then((mod) => {
        if (cancelled) return;
        const d = mod.default as AdvancedStatsData;
        setData(d);
        const defaults = new Set<string>(
          d.columns
            .filter((c) => c.defaultVisible && !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key))
            .map((c) => c.key),
        );
        setVisibleCols(defaults);
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

  // All toggleable stat columns (ordered as in the JSON)
  const allStatCols = useMemo<ColDef[]>(() => {
    if (!data) return [];
    return data.columns.filter(
      (c) => !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key),
    );
  }, [data]);

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
    for (const c of data?.columns ?? []) m[c.key] = c;
    return m;
  }, [data]);

  // Filter by search, then sort
  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
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
  }, [data, search, sortKey, sortDir, colByKey]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" || key === "playerName" || key === "team" ? "asc" : "desc");
    }
  };

  const toggleCol = (key: string) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
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

      {/* ── Compare sub-tab ──────────────────────────────────────────────── */}
      {subTab === "compare" && (
        <Card className="p-10 text-center" data-testid="compare-placeholder">
          <GitCompare className="w-7 h-7 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">Player Comparison</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Compare players side-by-side across advanced stats. This view is coming soon.
          </p>
        </Card>
      )}

      {/* ── Data sub-tab ─────────────────────────────────────────────────── */}
      {subTab === "data" && (
      <div className="space-y-5">
      {/* ── Controls card ────────────────────────────────────────────────── */}
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

        {/* Search + column toggle row */}
        <div className="flex gap-2">
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
          <button
            onClick={() => setShowColPanel((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold border transition-colors shrink-0",
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
              {allStatCols.map((c) => (
                <button
                  key={c.key}
                  onClick={() => toggleCol(c.key)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                    visibleCols.has(c.key)
                      ? "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40"
                      : "bg-transparent text-muted-foreground/50 border-border/50 hover:border-foreground/20 hover:text-muted-foreground",
                  )}
                  data-testid={`btn-col-toggle-${c.key}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Meta row */}
        {!loading && data && (
          <p className="text-[10px] text-muted-foreground/55 leading-none">
            {position.toUpperCase()} · {season === "all" ? "All Seasons" : `${season} Season`}
            {" · "}{rows.length} of {data.rows.length} players
            {updatedAt && ` · Updated ${updatedAt}`}
          </p>
        )}
      </Card>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {loading && (
        <Card className="p-8 text-center" data-testid="loading-state">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Loading {position.toUpperCase()} · {season === "all" ? "All Seasons" : season}…
          </p>
        </Card>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <Card className="p-6 border-red-500/40 bg-red-500/5" data-testid="error-state">
          <p className="text-sm font-semibold text-red-500 mb-1">Failed to load data</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </Card>
      )}

      {/* ── Stats table ──────────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <Card className="overflow-hidden p-0" data-testid="stats-table-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="stats-table">
              <thead>
                {/* Super-headers (desktop only; mobile hides the Team column) */}
                {groupSegments.length > 0 && (
                  <tr className="hidden md:table-row border-b border-border/40">
                    {groupSegments.map((seg, i) => (
                      <th
                        key={`grp-${i}`}
                        colSpan={seg.span}
                        className={cn(
                          "px-3 py-1.5 text-center font-bold uppercase tracking-wider text-[9px] text-muted-foreground/75 bg-[hsl(var(--muted))]",
                          seg.sticky && "sticky left-0 z-30",
                          seg.showLabel && i > 0 && "border-l-2 border-border/70",
                        )}
                      >
                        {seg.showLabel ? seg.label : null}
                      </th>
                    ))}
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
                          return (
                            <td
                              key={col.key}
                              className={cn(
                                "px-3 py-2 text-right tabular-nums whitespace-nowrap",
                                isSorted && "bg-[#d4af37]/[0.04]",
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
      )}
    </div>
  );
}
