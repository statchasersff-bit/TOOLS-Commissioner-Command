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
  Loader2,
  Search,
  SlidersHorizontal,
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
const PINNED_KEYS = new Set(["rank", "playerName", "player_name", "name"]);
// Columns that are never shown in the table (redundant or non-useful in this context).
const ALWAYS_HIDDEN = new Set([
  "playerId", "player_id", "sleeper_id", "sleeperId",
  "position", "pos", "age", "season",
]);

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

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Position Stats"
        subtitle="Advanced stats leaderboard — sortable, searchable, with customizable columns."
      />

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
                  {/* Team */}
                  <th
                    onClick={() => handleSort("team")}
                    className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25"
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
                    return (
                      <tr
                        key={`${rank ?? idx}-${name}`}
                        className={cn(
                          "border-b border-border/15 hover:bg-[#0b3a7a]/5 transition-colors",
                          idx % 2 === 1 && "bg-muted/[0.04]",
                        )}
                        data-testid={`row-player-${idx}`}
                      >
                        {/* Rank */}
                        <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-right font-mono text-[11px] text-muted-foreground/60 border-r border-border/25 w-10 min-w-[40px]">
                          {rank ?? idx + 1}
                        </td>
                        {/* Player name */}
                        <td className="sticky left-10 z-10 bg-inherit px-3 py-2 font-semibold text-foreground whitespace-nowrap border-r border-border/25 min-w-[148px]">
                          {name}
                        </td>
                        {/* Team badge */}
                        <td className="px-3 py-2 whitespace-nowrap border-r border-border/25">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-[#0b3a7a]/12 text-[#0b3a7a] dark:bg-blue-400/15 dark:text-blue-300">
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
