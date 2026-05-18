import { useState, useMemo, useCallback, useEffect, Component } from "react";
import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/SectionHeader";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Search, SlidersHorizontal, List, LayoutGrid, Hexagon,
  TrendingUp, TrendingDown, Minus, AlertCircle, RefreshCw, ChevronUp, ChevronDown,
  Calendar, X,
} from "lucide-react";
import {
  DEFAULT_FILTERS, toIsoDate,
  type ADPResult, type DraftFilters, type Position, type RookieMode,
} from "@/types/draft";
import { AdpCrawlPanel } from "@/components/admin/AdpCrawlPanel";
import { useAuth } from "@/contexts/AuthContext";
import { PlayerProfileDrawer } from "@/components/PlayerProfileDrawer";

// The frontend never queries Sleeper for ADP — it reads our cached endpoint
// which serves the most recent adp_snapshots row for the active filter set.
function buildAdpUrl(filters: DraftFilters): string {
  const p = new URLSearchParams();
  p.set("draftType", filters.draftType);
  p.set("draftFormat", filters.draftFormat);
  p.set("rookieMode", filters.rookieMode);
  p.set("leagueMode", filters.leagueMode);
  if (filters.scoring !== "all") p.set("scoring", filters.scoring);
  if (filters.superflex !== "all") p.set("superflex", filters.superflex);
  if (filters.tePremium !== "all") p.set("tePremium", filters.tePremium);
  if (filters.bestBall !== "all") p.set("bestBall", filters.bestBall);
  if (filters.teams !== "all") p.set("teams", String(filters.teams));
  if (filters.passTd !== "all") p.set("passTd", String(filters.passTd));
  if (filters.dateRange.start) p.set("startDate", filters.dateRange.start);
  if (filters.dateRange.end) p.set("endDate", filters.dateRange.end);
  return `/api/adp?${p.toString()}`;
}

interface AdpResponseMeta {
  computed_at: string | null;
  draft_count: number;
  pick_count: number;
  filter_key: string | null;
  is_empty: boolean;
  cached: boolean;
  snapshot_date: string | null;
  message?: string;
  error?: boolean;
}

interface AdpResponse {
  items: ADPResult[];
  meta: AdpResponseMeta;
}

// ── Visual tokens shared by all views ────────────────────────────────────────
// Hex anchors per position — used in the List/Box chip styling and mirrored
// (in richer form) by HEX_POS_THEME for the hex view. QB=red, RB=green,
// WR=blue, TE=yellow, K=purple, PICK keeps the StatChasers gold.
const POS_HEX: Record<Position, string> = {
  QB:   "#ef4444",
  RB:   "#22c55e",
  WR:   "#3b82f6",
  TE:   "#eab308",
  K:    "#a855f7",
  PICK: "#d4af37",
};

const POS_COLOR: Record<Position, { bg: string; text: string; ring: string; chip: string }> = {
  QB:   { bg: "bg-[#ef4444]/15", text: "text-[#ef4444]", ring: "ring-[#ef4444]/30", chip: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30" },
  RB:   { bg: "bg-[#22c55e]/15", text: "text-[#22c55e]", ring: "ring-[#22c55e]/30", chip: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30" },
  WR:   { bg: "bg-[#3b82f6]/15", text: "text-[#3b82f6]", ring: "ring-[#3b82f6]/30", chip: "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30" },
  TE:   { bg: "bg-[#eab308]/15", text: "text-[#eab308]", ring: "ring-[#eab308]/30", chip: "bg-[#eab308]/10 text-[#eab308] border-[#eab308]/30" },
  K:    { bg: "bg-[#a855f7]/15", text: "text-[#a855f7]", ring: "ring-[#a855f7]/30", chip: "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/30" },
  PICK: { bg: "bg-[#d4af37]/15", text: "text-[#d4af37]", ring: "ring-[#d4af37]/30", chip: "bg-[#d4af37]/10 text-[#d4af37] border-[#d4af37]/30" },
};

type ViewMode = "list" | "box" | "hex";

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: typeof List }[] = [
  { id: "list", label: "List", icon: List },
  { id: "box",  label: "Box",  icon: LayoutGrid },
  { id: "hex",  label: "Hex",  icon: Hexagon },
];

const ROOKIE_MODE_OPTIONS: { id: RookieMode; label: string; sub: string }[] = [
  { id: "picks",  label: "Rookie Picks",   sub: "Placeholders" },
  { id: "direct", label: "Direct Rookies", sub: "Actual players" },
];

const RANGE_SHORTCUTS = [
  { id: "7",   label: "7D",  days: 7 },
  { id: "30",  label: "30D", days: 30 },
  { id: "90",  label: "90D", days: 90 },
] as const;

// ── Main page ────────────────────────────────────────────────────────────────
export function DraftCommand() {
  const [filters, setFilters] = useState<DraftFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewMode>("list");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const [rows, setRows] = useState<ADPResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [meta, setMeta] = useState<AdpResponseMeta | null>(null);

  const [profilePlayer, setProfilePlayer] = useState<ADPResult | null>(null);
  const handlePlayerClick = useCallback((row: ADPResult) => setProfilePlayer(row), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    const url = buildAdpUrl(filters);
    console.log("[ADP] fetch URL:", url);
    fetch(url)
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          // Server returned HTML / non-JSON. The /api JSON-404 fallback should
          // make this impossible — if you hit it, the catch-all SPA route is
          // shadowing /api. Distinguish HTML from other non-JSON so the error
          // points at the right cause.
          const text = await r.text().catch(() => "");
          const looksLikeHtml = /^\s*<!doctype|^\s*<html/i.test(text);
          throw new Error(
            looksLikeHtml
              ? "API route returned app HTML. Check server route registration."
              : `Non-JSON response (${r.status}, content-type=${ct})`
          );
        }
        const body = (await r.json()) as AdpResponse;
        // Even on a 500, our server returns the {items, meta} shape so we
        // can render an error message inline. Detect that here.
        if (!r.ok && body?.meta?.error) {
          throw new Error(body.meta.message || `HTTP ${r.status}`);
        }
        return body;
      })
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data.items) ? data.items : []);
        setMeta(data.meta ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[DraftCommand] /api/adp fetch failed:", err);
        setErrorMessage(err?.message || "Failed to load ADP");
        setRows([]);
        setMeta(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  // Search runs client-side over whatever the server returned so typing is
  // instant; everything else is already filtered by the API.
  const filtered = useMemo(() => filterAdp(rows, filters), [rows, filters]);
  // Two distinct empty states: dataset legitimately empty (no ingest yet, or
  // current filters match no drafts) vs. fetch failure. The latter shows the
  // error card; the former shows a friendly "no data yet" message.
  const hasError = errorMessage !== null;
  const isEmpty = !isLoading && !hasError && filtered.length === 0;
  const lastUpdated = meta?.computed_at ?? null;

  const updateFilter = useCallback(<K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setRange = useCallback((days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    updateFilter("dateRange", { start: toIsoDate(start), end: toIsoDate(end) });
  }, [updateFilter]);

  const rangeDays = daysBetween(filters.dateRange.start, filters.dateRange.end);
  const activeShortcut = RANGE_SHORTCUTS.find((s) => s.days === rangeDays)?.id ?? null;

  const filterCount = countActiveFilters(filters);

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader
        title="Draft Command"
        subtitle="Real Sleeper draft data, ADP trends, and startup market movement."
      />

      {/* Mobile-only header — SectionHeader hides on mobile. */}
      <div className="md:hidden">
        <h2 className="text-lg font-bold text-foreground tracking-tight">Draft Command</h2>
        <p className="text-xs text-muted-foreground mt-1">Real Sleeper draft data, ADP trends, and startup market movement.</p>
      </div>

      {/* ── Top controls row ─────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {/* Search + filter button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
            <Input
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              placeholder="Search players or rookie picks…"
              className="pl-9 h-9 text-sm"
              data-testid="input-draft-search"
            />
            {filters.search && (
              <button
                onClick={() => updateFilter("search", "")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                data-testid="btn-clear-search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => setFilterSheetOpen(true)}
            className="h-9 px-3 gap-1.5 border-border/60 flex-shrink-0"
            data-testid="btn-open-filters"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">Filters</span>
            {filterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#d4af37] text-[10px] font-bold text-[#0a1628]">{filterCount}</span>
            )}
          </Button>
        </div>

        {/* View switcher + Rookie mode + Date range */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View switcher */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6">
            {VIEW_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  view === id ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/40 hover:text-white/70",
                )}
                data-testid={`view-${id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Rookie mode */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6">
            {ROOKIE_MODE_OPTIONS.map((m) => (
              <button
                key={m.id}
                onClick={() => updateFilter("rookieMode", m.id)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap",
                  filters.rookieMode === m.id ? "bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30" : "text-white/40 hover:text-white/70",
                )}
                data-testid={`rookie-mode-${m.id}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Date range shortcuts */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6">
            {RANGE_SHORTCUTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setRange(s.days)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  activeShortcut === s.id ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/40 hover:text-white/70",
                )}
                data-testid={`range-${s.id}`}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() => setFilterSheetOpen(true)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                activeShortcut === null ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/40 hover:text-white/70",
              )}
              data-testid="range-custom"
            >
              <Calendar className="w-3 h-3" />
              <span>Custom</span>
            </button>
          </div>

          {/* Last updated — pushes right on wide viewports */}
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            <span>{lastUpdated ? `Last updated ${formatRelative(lastUpdated)}` : "Loading…"}</span>
          </div>
        </div>
      </div>

      {/* ── Main body ─────────────────────────────────────────────────────── */}
      {isLoading && <LoadingState />}
      {hasError  && <ErrorState message={errorMessage} />}
      {isEmpty   && <EmptyState message={meta?.message} />}
      {!isLoading && !hasError && !isEmpty && (
        <>
          {/* Confidence banner — under ~25 drafts ADP swings hard, so we
              call it out instead of letting users read noisy numbers. */}
          {meta && meta.draft_count > 0 && meta.draft_count < 25 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300 flex items-center gap-2" data-testid="adp-small-sample-warning">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                <span className="font-semibold">Small sample size.</span>{" "}
                Only {meta.draft_count} draft{meta.draft_count === 1 ? "" : "s"} match these filters
                ({meta.pick_count.toLocaleString()} picks). Expand the date range or relax filters for more reliable ADP.
              </span>
            </div>
          )}

          {view === "list" && <ListView rows={filtered} onPlayerClick={handlePlayerClick} />}
          {view === "box"  && <BoxView  rows={filtered} teams={typeof filters.teams === "number" ? filters.teams : 12} onPlayerClick={handlePlayerClick} />}
          {view === "hex"  && <HexView  rows={filtered} teams={typeof filters.teams === "number" ? filters.teams : 12} onPlayerClick={handlePlayerClick} />}
        </>
      )}

      {/* Dev-only debug panel — surfaces what the API actually returned so
          we can spot empty-vs-error issues without opening DevTools. */}
      {import.meta.env.DEV && meta && (
        <div className="mt-3 rounded-lg border border-dashed border-border/50 bg-white/[0.02] px-3 py-2 text-[10px] font-mono text-muted-foreground/80">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
            <span>filter_key: <span className="text-foreground/80">{meta.filter_key ?? "—"}</span></span>
            <span>cached: <span className="text-foreground/80">{String(meta.cached)}</span></span>
            <span>is_empty: <span className="text-foreground/80">{String(meta.is_empty)}</span></span>
            <span>draft_count: <span className="text-foreground/80">{meta.draft_count}</span></span>
            <span>pick_count: <span className="text-foreground/80">{meta.pick_count}</span></span>
            <span>rows: <span className="text-foreground/80">{rows.length}</span></span>
            <span className="col-span-2 md:col-span-3">computed_at: <span className="text-foreground/80">{meta.computed_at ?? "—"}</span></span>
            {meta.message && <span className="col-span-2 md:col-span-3">message: <span className="text-foreground/80">{meta.message}</span></span>}
          </div>
        </div>
      )}

      {/* ── Filter sheet (right side, mobile + desktop) ───────────────────── */}
      <FilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        filters={filters}
        update={updateFilter}
        onReset={() => setFilters(DEFAULT_FILTERS)}
      />

      {/* ── Admin-only "ADP Data Crawl" tools (see shared/admin.ts) ───────── */}
      {/* useAuth().isAdmin is server-derived for DC users and locally derived
          for Sleeper-username matches. Backend routes do their own strict
          email-based check — this gate only governs UI visibility. */}
      <AdminAdpTools />

      {/* Player profile drawer — opened from any of List/Box/Hex tiles. */}
      <PlayerProfileDrawer
        open={profilePlayer != null}
        adp={profilePlayer}
        teams={typeof filters.teams === "number" ? filters.teams : 12}
        onClose={() => setProfilePlayer(null)}
      />
    </div>
  );
}

class AdminToolsBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-400">
          Admin tools crashed: {this.state.error.message}
          <button
            className="ml-3 underline opacity-70 hover:opacity-100"
            onClick={() => this.setState({ error: null })}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AdminAdpTools() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return (
    <AdminToolsBoundary>
      <AdpCrawlPanel />
    </AdminToolsBoundary>
  );
}

// ── List View ────────────────────────────────────────────────────────────────
type ListSortKey = "overall_rank" | "avg_pick" | "min_pick" | "max_pick" | "draft_count" | "trend_30d" | "positional_rank";

function ListView({ rows, onPlayerClick }: { rows: ADPResult[]; onPlayerClick?: (row: ADPResult) => void }) {
  const [sortKey, setSortKey] = useState<ListSortKey>("overall_rank");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const handleSort = (key: ListSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ col }: { col: ListSortKey }) => {
    if (sortKey !== col) return <Minus className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-[#d4af37]" /> : <ChevronDown className="w-3 h-3 text-[#d4af37]" />;
  };

  return (
    <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
      {/* Mobile: card-list */}
      <div className="md:hidden divide-y divide-border/20">
        {sorted.map((r) => (
          <MobileListRow key={r.player_id} row={r} onPlayerClick={onPlayerClick} />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30 dark:bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("overall_rank")}>
                <span className="inline-flex items-center gap-0.5">Rk <SortIcon col="overall_rank" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("positional_rank")}>
                <span className="inline-flex items-center gap-0.5">PosRk <SortIcon col="positional_rank" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("avg_pick")}>
                <span className="inline-flex items-center gap-0.5">ADP <SortIcon col="avg_pick" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("min_pick")}>
                <span className="inline-flex items-center gap-0.5">Min <SortIcon col="min_pick" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("max_pick")}>
                <span className="inline-flex items-center gap-0.5">Max <SortIcon col="max_pick" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("draft_count")}>
                <span className="inline-flex items-center gap-0.5"># <SortIcon col="draft_count" /></span>
              </th>
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("trend_30d")}>
                <span className="inline-flex items-center gap-0.5">30D <SortIcon col="trend_30d" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {sorted.map((r) => (
              <tr
                key={r.player_id}
                className={cn("hover:bg-muted/20", onPlayerClick && "cursor-pointer")}
                data-testid={`row-adp-${r.player_id}`}
                onClick={() => onPlayerClick?.(r)}
              >
                <td className="px-3 py-2.5">
                  <PlayerCell row={r} />
                </td>
                <td className="px-2 py-2.5 text-center font-semibold tabular-nums">{r.overall_rank}</td>
                <td className="px-2 py-2.5 text-center">
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border", POS_COLOR[r.position].chip)}>
                    {r.position}{r.positional_rank}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-center font-semibold tabular-nums">{r.avg_pick.toFixed(1)}</td>
                <td className="px-2 py-2.5 text-center text-muted-foreground tabular-nums">{r.min_pick}</td>
                <td className="px-2 py-2.5 text-center text-muted-foreground tabular-nums">{r.max_pick}</td>
                <td className="px-2 py-2.5 text-center tabular-nums">
                  <span className={r.sample_size_warning ? "text-amber-500" : "text-muted-foreground"}>{r.draft_count}</span>
                </td>
                <td className="px-2 py-2.5 text-center">
                  <TrendBadge value={r.trend_30d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MobileListRow({ row, onPlayerClick }: { row: ADPResult; onPlayerClick?: (row: ADPResult) => void }) {
  return (
    <div
      className={cn("flex items-center gap-2.5 px-3 py-2.5", onPlayerClick && "cursor-pointer hover:bg-muted/20")}
      data-testid={`row-adp-mobile-${row.player_id}`}
      onClick={() => onPlayerClick?.(row)}
    >
      <PositionTile pos={row.position} text={row.position === "PICK" ? "RP" : row.position} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[13px] truncate">{row.player_name}</span>
          {row.sample_size_warning && (
            <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0" />
          )}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {row.team || (row.is_rookie_placeholder ? "Rookie pick" : "—")} · {row.position}{row.positional_rank} · {row.draft_count} drafts
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-sm font-bold tabular-nums text-foreground">{row.avg_pick.toFixed(1)}</span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
          <span>{row.min_pick}–{row.max_pick}</span>
          <TrendBadge value={row.trend_30d} compact />
        </div>
      </div>
    </div>
  );
}

function PlayerCell({ row }: { row: ADPResult }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <PositionTile pos={row.position} text={row.position === "PICK" ? "RP" : row.position} />
      <div className="min-w-0">
        <div className="font-semibold text-sm truncate flex items-center gap-1.5">
          {row.player_name}
          {row.sample_size_warning && (
            <span title="Small sample size — ADP may be volatile">
              <AlertCircle className="w-3 h-3 text-amber-500" />
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {row.team || (row.is_rookie_placeholder ? "Rookie pick" : "—")}
        </div>
      </div>
    </div>
  );
}

// ── Box View ─────────────────────────────────────────────────────────────────
// Draft Board reconstruction. We arrange the ADP results into a snake-draft
// grid so the layout reads like an actual Sleeper startup replay:
//
//   T1   T2   T3  ...  T12        Round 1 →
//   24   23   22       13         Round 2 ←   (snake reverses direction)
//   25   26   27       36         Round 3 →
//
// Architecture notes (matches the future-ready spec in req #10):
// - Each cell is a presentational <DraftPickCell>; positional runs, value
//   pockets, tier cliffs, stack indicators etc. layer on top as siblings
//   without touching the grid math.
// - HEX_POS_THEME (defined further down) is the single source of truth for
//   board palette — shared between Hex and Box for visual consistency.

function BoxView({ rows, teams, onPlayerClick }: { rows: ADPResult[]; teams: number; onPlayerClick?: (row: ADPResult) => void }) {
  const isMobile = useIsMobile();
  // Each row = round; each column = team slot. Cell tile is narrower on mobile
  // so the board can still show all 12 columns within a comfortable horizontal
  // scroll instead of squashing names.
  const cellW = isMobile ? 86 : 104;
  const labelColW = isMobile ? 48 : 64;

  // Build the snake-layout grid. We sort by ADP ascending and assign each
  // entry a (round, slot) coordinate so the resulting grid reads exactly like
  // a startup draft room replay.
  const { grid, totalRounds } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.avg_pick - b.avg_pick);
    const g = new Map<number, Array<ADPResult | null>>();
    let maxRound = 0;
    sorted.forEach((r, idx) => {
      const seq = idx + 1;
      const round = Math.ceil(seq / teams);
      const pickInRound = ((seq - 1) % teams) + 1;
      const slot = round % 2 === 1 ? pickInRound : teams - pickInRound + 1; // snake
      if (!g.has(round)) g.set(round, Array.from({ length: teams }, () => null));
      g.get(round)![slot - 1] = r;
      maxRound = Math.max(maxRound, round);
    });
    return { grid: g, totalRounds: maxRound };
  }, [rows, teams]);

  if (totalRounds === 0) return null;

  return (
    <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-[#0a1628] to-[#070f1c]">
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-4 h-4 text-[#d4af37] flex-shrink-0" />
          <h3 className="text-sm font-bold text-white">Draft Board</h3>
          <span className="text-[10px] text-white/40 truncate">{teams}-team snake · ADP replay</span>
        </div>
        <HexLegend />
      </div>

      <div className="overflow-x-auto overflow-y-hidden">
        <div className="inline-block min-w-full">
          {/* Team header row */}
          <div className="flex sticky top-0 z-30 bg-[#070f1c] border-b border-white/10">
            <div
              className="sticky left-0 z-40 flex items-center justify-center text-[9px] font-bold uppercase tracking-wider text-white/30 border-r border-white/10 bg-[#070f1c]"
              style={{ width: labelColW, height: 32, flexShrink: 0 }}
            >
              Rd
            </div>
            {Array.from({ length: teams }, (_, i) => (
              <div
                key={i}
                className="flex flex-col items-center justify-center text-[9px] font-bold uppercase tracking-wider text-white/55 border-r border-white/5"
                style={{ width: cellW, height: 32, flexShrink: 0 }}
              >
                <span>Team</span>
                <span className="text-[10px] font-bold text-white/80 tabular-nums leading-none">{i + 1}</span>
              </div>
            ))}
          </div>

          {/* Round rows */}
          {Array.from({ length: totalRounds }, (_, rIdx) => {
            const round = rIdx + 1;
            const cells = grid.get(round) ?? Array.from({ length: teams }, () => null);
            const isOdd = round % 2 === 1;
            return (
              <div
                key={round}
                className={cn(
                  "flex border-b border-white/5",
                  rIdx % 2 === 1 && "bg-white/[0.015]", // subtle row striping
                )}
              >
                <RoundLabel round={round} isOdd={isOdd} width={labelColW} />
                {cells.map((cell, slotIdx) => (
                  <DraftPickCell
                    key={slotIdx}
                    pick={cell}
                    round={round}
                    pickInRound={isOdd ? slotIdx + 1 : teams - slotIdx}
                    width={cellW}
                    onPlayerClick={onPlayerClick}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function RoundLabel({ round, isOdd, width }: { round: number; isOdd: boolean; width: number }) {
  return (
    <div
      className="sticky left-0 z-20 flex flex-col items-center justify-center text-[10px] font-bold border-r border-white/10 bg-[#070f1c]"
      style={{ width, flexShrink: 0, minHeight: 76 }}
    >
      <span className={cn(
        "px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap border",
        round === 1
          ? "bg-[#d4af37]/20 border-[#d4af37]/40 text-[#d4af37]"
          : "bg-white/5 border-white/15 text-white/70",
      )}>
        Rd {round}
      </span>
      <span className="text-[10px] text-white/30 mt-0.5">{isOdd ? "→" : "←"}</span>
    </div>
  );
}

function DraftPickCell({
  pick, round, pickInRound, width, onPlayerClick,
}: {
  pick: ADPResult | null;
  round: number;
  pickInRound: number;
  width: number;
  onPlayerClick?: (row: ADPResult) => void;
}) {
  const pickLabel = `${round}.${String(pickInRound).padStart(2, "0")}`;
  if (!pick) {
    return (
      <div
        className="flex items-center justify-center text-[9px] text-white/15 border-r border-white/5 bg-black/10"
        style={{ width, minHeight: 76, flexShrink: 0 }}
      >
        {pickLabel}
      </div>
    );
  }

  const color = HEX_POS_THEME[pick.position].base;
  const isElite = pick.overall_rank <= ELITE_RANK_CUTOFF && !pick.is_rookie_placeholder;
  const isPick = pick.is_rookie_placeholder;

  return (
    <div
      className="relative group border-r border-white/5 transition-all duration-150 hover:bg-white/[0.04] hover:z-10 cursor-pointer"
      style={{ width, minHeight: 76, flexShrink: 0 }}
      title={`${pickLabel} · ${pick.player_name} · ${pick.position}${pick.positional_rank} · ADP ${pick.avg_pick.toFixed(1)} · ${pick.draft_count} drafts`}
      data-testid={`board-cell-${round}-${pickInRound}`}
      onClick={() => onPlayerClick?.(pick)}
    >
      {/* Top position-color stripe — the dominant scan cue. */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 3, background: color, boxShadow: isElite ? `0 0 8px ${color}` : undefined }}
      />
      {/* Elite pick — subtle gold accent line on the left edge. */}
      {isElite && <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-[#d4af37]/70" />}

      <div className="absolute inset-0 px-1.5 pt-2 pb-1 flex flex-col">
        {/* Pick label row */}
        <div className="flex items-center justify-between text-[9px] font-bold tabular-nums">
          <span className="text-white/40">{pickLabel}</span>
          <span className="text-white/85 tracking-wide" style={{ color }}>
            {isPick ? "RP" : pick.position}{pick.positional_rank}
          </span>
        </div>

        {/* Player name dominates the cell */}
        <div className="mt-0.5 text-[11px] md:text-[12px] font-bold text-white leading-[1.1] line-clamp-2">
          {pick.player_name}
        </div>

        {/* Footer: ADP + trend */}
        <div className="mt-auto flex items-center justify-between">
          <span className="text-[10px] font-bold tabular-nums" style={{ color: "#d4af37" }}>
            {pick.avg_pick.toFixed(1)}
          </span>
          <TrendBadge value={pick.trend_30d} compact />
        </div>
      </div>

      {pick.sample_size_warning && (
        <AlertCircle className="absolute top-1 right-1 w-2.5 h-2.5 text-amber-400 pointer-events-none" />
      )}
    </div>
  );
}

// ── Hex View — "Dynasty Command Center" ──────────────────────────────────────
// True honeycomb draft board reimagined as a tactical HUD.
//
// Visual stack (back → front), per tile:
//   1. Hex clip-path shell (filled with a positional gradient — light at top,
//      saturated at the equator, deep navy at the base, giving the tile real
//      dimension instead of a flat colored polygon).
//   2. Inner highlight stroke at the top edge (~1px white tint clipped to the
//      hex), reads as edge lighting / glass reflection.
//   3. Vignette wash (radial dark fade in lower half) so the player name has
//      consistent contrast over QB purple, WR amber, etc.
//   4. Content: positional badge → player headshot (circular crop on a soft
//      glow halo) → player name → ADP & trend footer.
//   5. Glow drop-shadow that intensifies on hover (group-hover) — this is the
//      "alive" cue that makes the board feel responsive.
//   6. Hover panel (absolute, escapes the clip-path via a separate wrapper):
//      ADP min/median/max bar, 7D & 30D trend, sample size, value indicator.
//
// Board background: tactical hex-grid lighting (radial blue glow up top, gold
// glow bottom-right, subtle 28px grid overlay, animated scan line). All low
// opacity — atmospheric, not noisy.
//
// Architecture: HexTile remains presentational — layered overlays (live
// drafted-by markers, exposure heatmaps, tier-break separators, riser/faller
// arrows) attach as siblings inside <HexTile> without touching layout math.

type PosTheme = {
  /** Base position color — used for accents and the legend dot.        */
  base: string;
  /** Gradient stop array applied to the hex shell (top → equator → base). */
  shell: [string, string, string];
  /** Glow color used for outer drop-shadow (mostly hover).               */
  glow: string;
  /** Ring color around the player headshot.                              */
  ring: string;
  /** Pill/label text + background tint behind position chip.             */
  text: string;
  chipBg: string;
};

const HEX_POS_THEME: Record<Position, PosTheme> = {
  QB: {
    base: "#ef4444",
    shell: ["#f87171", "#dc2626", "#3a0a0a"],
    glow:  "rgba(239, 68, 68, 0.55)",
    ring:  "rgba(248, 113, 113, 0.85)",
    text:  "#fecaca",
    chipBg: "rgba(220, 38, 38, 0.35)",
  },
  RB: {
    base: "#22c55e",
    shell: ["#4ade80", "#16a34a", "#062a1f"],
    glow:  "rgba(34, 197, 94, 0.55)",
    ring:  "rgba(74, 222, 128, 0.85)",
    text:  "#bbf7d0",
    chipBg: "rgba(22, 163, 74, 0.35)",
  },
  WR: {
    base: "#3b82f6",
    shell: ["#60a5fa", "#1d4ed8", "#0a1d3a"],
    glow:  "rgba(59, 130, 246, 0.55)",
    ring:  "rgba(96, 165, 250, 0.85)",
    text:  "#bfdbfe",
    chipBg: "rgba(29, 78, 216, 0.35)",
  },
  TE: {
    base: "#eab308",
    shell: ["#facc15", "#ca8a04", "#3a2a06"],
    glow:  "rgba(234, 179, 8, 0.55)",
    ring:  "rgba(250, 204, 21, 0.85)",
    text:  "#fef08a",
    chipBg: "rgba(202, 138, 4, 0.35)",
  },
  K: {
    base: "#a855f7",
    shell: ["#c084fc", "#7c3aed", "#2a0e4a"],
    glow:  "rgba(168, 85, 247, 0.55)",
    ring:  "rgba(192, 132, 252, 0.85)",
    text:  "#e9d5ff",
    chipBg: "rgba(124, 58, 237, 0.35)",
  },
  PICK: {
    base: "#d4af37",
    shell: ["#f3d97a", "#b18a1a", "#332305"],
    glow:  "rgba(212, 175, 55, 0.55)",
    ring:  "rgba(243, 217, 122, 0.85)",
    text:  "#fde68a",
    chipBg: "rgba(177, 138, 26, 0.35)",
  },
};

const ELITE_RANK_CUTOFF = 12;

function HexView({ rows, teams, onPlayerClick }: { rows: ADPResult[]; teams: number; onPlayerClick?: (row: ADPResult) => void }) {
  const isMobile = useIsMobile();
  // Larger tiles than before — the redesign uses a prominent square headshot
  // so we give it more room. Mobile still shrinks but keeps a readable layout.
  const tileW = isMobile ? 104 : 132;
  const tileH = Math.round(tileW * 2 / Math.sqrt(3));

  // Group rows into rounds, placing each at its (round, pickInRound) slot
  // derived from rounded ADP. Each round row is exactly `teams` slots wide;
  // empty slots get a placeholder tile so the visual layout always reflects
  // the draft size setting (12 slots when teams=12, 10 when teams=10, etc.).
  const grouped = useMemo(() => {
    const byRound = new Map<number, Array<ADPResult | null>>();
    for (const r of rows) {
      const visualPick = Math.max(1, Math.round(r.avg_pick));
      const round = Math.ceil(visualPick / teams);
      const pickInRound = ((visualPick - 1) % teams) + 1;
      if (!byRound.has(round)) byRound.set(round, Array.from({ length: teams }, () => null));
      const slots = byRound.get(round)!;
      // First player at this slot wins; collisions push to the next empty
      // slot in the same round so we never lose data due to ADP rounding ties.
      if (slots[pickInRound - 1] == null) {
        slots[pickInRound - 1] = r;
      } else {
        for (let i = 0; i < teams; i++) {
          if (slots[i] == null) { slots[i] = r; break; }
        }
      }
    }
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows, teams]);

  return (
    <Card className="overflow-hidden border-[#1a2d4a]/80 bg-[#070f1c] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
      {/* ── HUD title bar ─────────────────────────────────────────────────── */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/5 bg-[linear-gradient(180deg,rgba(11,58,122,0.25),rgba(11,58,122,0)_70%)]">
        {/* Corner ticks — subtle "instrument panel" framing. */}
        <span className="absolute top-1 left-1 w-2 h-2 border-l border-t border-[#d4af37]/40" />
        <span className="absolute top-1 right-1 w-2 h-2 border-r border-t border-[#d4af37]/40" />

        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex items-center justify-center w-6 h-6">
            <div className="absolute inset-0 rounded-full bg-[#d4af37]/15 blur-[6px]" />
            <Hexagon className="relative w-4 h-4 text-[#d4af37] flex-shrink-0 drop-shadow-[0_0_4px_rgba(212,175,55,0.7)]" />
          </div>
          <h3 className="text-sm font-bold text-white tracking-wide uppercase">Draft Board</h3>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md border border-[#0b3a7a]/60 bg-[#0b3a7a]/20 text-[9px] font-bold uppercase tracking-wider text-white/55">
            <span className="w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse" />
            Live · {teams}-team
          </span>
        </div>
        <HexLegend />
      </div>

      {/* ── Board canvas ──────────────────────────────────────────────────── */}
      <div className="relative overflow-x-auto overflow-y-hidden hex-tactical-bg">
        {/* Animated scan line — opacity barely perceptible, adds "alive" feel. */}
        <div className="hex-scan-line absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent pointer-events-none" />

        {/* Faint coordinate ticks down the right edge (HUD garnish). */}
        <div className="absolute top-0 bottom-0 right-1 w-1 flex flex-col justify-between py-3 pointer-events-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="block w-1 h-px bg-white/15" />
          ))}
        </div>

        <div
          className="relative inline-block py-5 pl-1 pr-6"
          style={{ "--hex-w": `${tileW}px`, "--hex-h": `${tileH}px` } as React.CSSProperties}
        >
          {grouped.map(([round, slots], rowIdx) => (
            <HexRow key={round} round={round} slots={slots} rowIdx={rowIdx} onPlayerClick={onPlayerClick} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function HexRow({
  round, slots, rowIdx, onPlayerClick,
}: {
  round: number;
  slots: Array<ADPResult | null>;
  rowIdx: number;
  onPlayerClick?: (row: ADPResult) => void;
}) {
  const isOffsetRow = rowIdx % 2 === 1;
  return (
    <div
      className="flex items-start relative"
      style={{
        marginTop: rowIdx === 0 ? 0 : "calc(var(--hex-h) * -0.25)",
      }}
    >
      {/* Sticky round label — futuristic "Rd 01 →" badge with status tick. */}
      <div
        className="sticky left-0 z-20 flex-shrink-0 flex items-start pl-3 md:pl-4 pr-3 pt-3"
        style={{
          background: "linear-gradient(to right, rgba(6,12,24,1) 70%, rgba(6,12,24,0))",
          minWidth: 68,
        }}
      >
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap border tabular-nums",
            round === 1
              ? "bg-[#d4af37]/15 border-[#d4af37]/45 text-[#d4af37] shadow-[0_0_12px_-2px_rgba(212,175,55,0.5)]"
              : "bg-white/[0.04] border-white/15 text-white/75",
          )}
        >
          <span className="text-[8px] opacity-60">RD</span>
          <span>{String(round).padStart(2, "0")}</span>
        </div>
      </div>

      <div
        className="flex flex-nowrap"
        style={{ paddingLeft: isOffsetRow ? "calc(var(--hex-w) * 0.5)" : 0 }}
      >
        {slots.map((p, i) => (
          p
            ? <HexTile key={`${round}-${i}-${p.player_id}`} row={p} pickInRound={i + 1} onClick={onPlayerClick} />
            : <HexEmpty key={`${round}-${i}-empty`} pickInRound={i + 1} />
        ))}
      </div>
    </div>
  );
}

/** Placeholder hex shown when no player's ADP rounds to this slot. Keeps the
 *  row at exactly `teams` slots wide regardless of how sparse the data is. */
function HexEmpty({ pickInRound }: { pickInRound: number }) {
  return (
    <div
      className="relative"
      style={{ width: "var(--hex-w)", height: "var(--hex-h)", flexShrink: 0 }}
    >
      <div
        className="absolute inset-0"
        style={{
          clipPath: HEX_CLIP,
          background: "rgba(255,255,255,0.015)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      />
      <span className="absolute top-[8%] left-1/2 -translate-x-1/2 text-[8px] font-bold tabular-nums text-white/20">
        {String(pickInRound).padStart(2, "0")}
      </span>
    </div>
  );
}

// Pointy-top hex clip — shared between the tile shell and the inner highlight.
const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

function HexTile({ row, pickInRound, onClick }: { row: ADPResult; pickInRound: number; onClick?: (row: ADPResult) => void }) {
  const theme = HEX_POS_THEME[row.position];
  const isElite = row.overall_rank <= ELITE_RANK_CUTOFF && !row.is_rookie_placeholder;
  const isPick = row.is_rookie_placeholder;
  const isRising = row.trend_30d < -2;
  const isFalling = row.trend_30d > 2;

  return (
    // Outer wrapper is NOT clipped — so the hover panel + drop-shadow glow
    // can render outside the hexagon bounds. The clipping lives one level in.
    <div
      className="relative group cursor-pointer"
      style={{ width: "var(--hex-w)", height: "var(--hex-h)", flexShrink: 0 }}
      data-testid={`hex-${row.player_id}`}
      onClick={() => onClick?.(row)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(row); } : undefined}
    >
      {/* Inner transform layer — handles lift + glow intensification. */}
      <div
        className="absolute inset-0 transition-all duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.06] group-hover:z-30"
        style={{
          filter: isElite
            ? `drop-shadow(0 0 10px rgba(212,175,55,0.55)) drop-shadow(0 0 4px ${theme.glow})`
            : `drop-shadow(0 6px 10px rgba(0,0,0,0.45))`,
        }}
      >
        {/* Soft "halo" — sits just behind the tile and brightens on hover.
            Slightly larger than the hex itself so a halo bleeds out of the
            clip. Reads as ambient lighting / volumetric glow.            */}
        <div
          className="absolute -inset-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          style={{
            clipPath: HEX_CLIP,
            background: `radial-gradient(ellipse at center, ${theme.glow} 0%, transparent 70%)`,
          }}
        />

        {/* ── Tile shell (the hex). ─────────────────────────────────────── */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: HEX_CLIP,
            background: [
              // Top edge specular highlight.
              "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 18%)",
              // Positional gradient — light → saturated → deep base.
              `linear-gradient(165deg, ${theme.shell[0]} 0%, ${theme.shell[1]} 50%, ${theme.shell[2]} 100%)`,
            ].join(", "),
          }}
        />

        {/* Inner ring stroke — 1px white "glass" edge clipped to hex. The
            stroke is faked by stacking a slightly inset second hex. */}
        <div
          className="absolute inset-[1px]"
          style={{
            clipPath: HEX_CLIP,
            background: `linear-gradient(165deg, ${theme.shell[0]} 0%, ${theme.shell[1]} 50%, ${theme.shell[2]} 100%)`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        />

        {/* Bottom vignette — darkens lower 60% so player name is legible
            over the loudest position colors (amber WR, gold PICK).      */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            clipPath: HEX_CLIP,
            background:
              "radial-gradient(ellipse 110% 75% at 50% 110%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)",
          }}
        />

        {/* Subtle reflected sheen — diagonal lighter band, hover-only. */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            clipPath: HEX_CLIP,
            background:
              "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%)",
          }}
        />

        {/* ── Content stack ────────────────────────────────────────────── */}
        <div className="absolute inset-0 flex flex-col items-center px-1.5 pt-[10%] pb-[10%]">
          {/* Top header row — pick coordinate + position rank chip side by side. */}
          <div className="w-full flex items-center justify-between px-1 mb-1">
            <span className="text-[8px] font-bold tabular-nums tracking-[0.1em] text-white/55 leading-none pointer-events-none">
              {String(pickInRound).padStart(2, "0")}
            </span>
            <span
              className="px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider border leading-none"
              style={{ background: theme.chipBg, color: theme.text, borderColor: `${theme.ring}aa` }}
            >
              {isPick ? "RP" : `${row.position}${row.positional_rank}`}
            </span>
          </div>

          {/* Player image — large square crop, the dominant visual element. */}
          {isPick ? (
            <PickGlyph theme={theme} label={row.rookie_pick_label} />
          ) : (
            <PlayerHeadshotHex
              playerId={row.player_id}
              name={row.player_name}
              theme={theme}
            />
          )}

          {/* Name + ADP. */}
          <div className="w-full text-center mt-1">
            <div className="text-[11px] font-bold text-white leading-[1.05] line-clamp-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] tracking-tight px-0.5">
              {shortenName(row.player_name)}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] leading-none">
              <span className="font-bold tabular-nums text-[#d4af37] drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                {row.avg_pick.toFixed(1)}
              </span>
              {isRising && (
                <TrendingUp className="w-2.5 h-2.5 text-emerald-300 drop-shadow-[0_0_4px_rgba(52,211,153,0.7)]" />
              )}
              {isFalling && (
                <TrendingDown className="w-2.5 h-2.5 text-red-300 drop-shadow-[0_0_4px_rgba(248,113,113,0.7)]" />
              )}
            </div>
          </div>
        </div>

        {/* Elite indicator — pulsing gold beacon at top tip. */}
        {isElite && (
          <div className="absolute top-[3%] left-1/2 w-1.5 h-1.5 rounded-full bg-[#d4af37] shadow-[0_0_10px_rgba(212,175,55,1)] hex-elite-pulse pointer-events-none" />
        )}

        {/* Sample-size warning. */}
        {row.sample_size_warning && (
          <AlertCircle
            className="absolute top-[16%] right-[14%] w-3 h-3 text-amber-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] pointer-events-none"
          />
        )}
      </div>

      {/* ── Hover panel — escapes the clip-path. ─────────────────────────── */}
      <HexHoverPanel row={row} theme={theme} />
    </div>
  );
}

/**
 * Headshot for the hex board. Larger, slightly-rounded square crop — the
 * dominant visual element of the tile. Uses Sleeper's CDN; falls back to a
 * positional-tinted initial avatar when the image fails (covers the case
 * where mock data uses synthesized ids that don't resolve).
 */
function PlayerHeadshotHex({
  playerId, name, theme,
}: {
  playerId: string;
  name: string;
  theme: PosTheme;
}) {
  const [errored, setErrored] = useState(false);
  const looksLikeSleeperId = /^\d+$/.test(playerId);
  const showImage = looksLikeSleeperId && !errored;

  return (
    <div className="relative flex items-center justify-center">
      {/* Soft glow halo behind the headshot. */}
      <div
        className="absolute -inset-1 rounded-xl blur-md opacity-80"
        style={{ background: theme.glow }}
      />
      <div
        className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-md overflow-hidden flex items-center justify-center"
        style={{
          boxShadow: `0 0 0 2px ${theme.ring}, inset 0 0 0 1px rgba(255,255,255,0.15)`,
          background: `linear-gradient(180deg, ${theme.shell[1]}, ${theme.shell[2]})`,
        }}
      >
        {showImage ? (
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
            alt={name}
            className="w-full h-full object-cover object-top"
            onError={() => setErrored(true)}
          />
        ) : (
          <span className="text-base font-black text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]">
            {initialsOf(name)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Rookie-pick glyph — gold hexagon emblem sized to match the square headshot. */
function PickGlyph({ theme, label }: { theme: PosTheme; label?: string | null }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute -inset-1 rounded-xl blur-md opacity-80" style={{ background: theme.glow }} />
      <div
        className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-md flex items-center justify-center"
        style={{
          background: `linear-gradient(165deg, ${theme.shell[0]}, ${theme.shell[1]}, ${theme.shell[2]})`,
          boxShadow: `0 0 0 2px ${theme.ring}, inset 0 1px 0 rgba(255,255,255,0.3)`,
        }}
      >
        <Hexagon className="w-7 h-7 text-[#1a1300]" strokeWidth={2.5} />
        {label && (
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider whitespace-nowrap bg-black/40 text-[#fde68a] leading-none">
            {label.replace(/^\d{4}\s+Rookie\s+/i, "")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Premium hover panel — expanded player intelligence card.
 *
 * Architecture-ready slots: ADP range bar (today), trend deltas (today),
 * sample size (today), and reserved space for exposure %, value score,
 * startup trend chart, and stack indicators once the live data lands.
 */
function HexHoverPanel({ row, theme }: { row: ADPResult; theme: PosTheme }) {
  const rangeSpan = Math.max(1, row.max_pick - row.min_pick);
  const medianPct = ((row.median_pick - row.min_pick) / rangeSpan) * 100;
  const rising  = row.trend_30d < 0;
  const falling = row.trend_30d > 0;
  return (
    <div
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 w-[220px] opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 z-40"
      role="tooltip"
    >
      <div
        className="rounded-xl border border-white/10 bg-[#0a1628]/95 backdrop-blur-md p-2.5 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)]"
        style={{ boxShadow: `0 0 0 1px ${theme.ring}33, 0 20px 50px -10px rgba(0,0,0,0.8)` }}
      >
        {/* Header row — full name + position rank. */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-bold text-white truncate">{row.player_name}</div>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border"
            style={{ color: theme.text, borderColor: `${theme.ring}99`, background: theme.chipBg }}
          >
            {row.is_rookie_placeholder ? "RP" : row.position}{row.positional_rank}
          </span>
        </div>
        <div className="text-[9px] text-white/40 uppercase tracking-wider mt-0.5">
          {row.team || (row.is_rookie_placeholder ? "Rookie Pick" : "—")} · Overall #{row.overall_rank}
        </div>

        {/* ADP range bar. */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-[9px] text-white/55 mb-1 tabular-nums">
            <span>MIN {row.min_pick}</span>
            <span className="text-[#d4af37] font-bold">ADP {row.avg_pick.toFixed(1)}</span>
            <span>MAX {row.max_pick}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden border border-white/5">
            <div
              className="absolute inset-y-0 left-0 right-0 rounded-full"
              style={{ background: `linear-gradient(90deg, ${theme.ring}55, ${theme.ring}aa, ${theme.ring}55)` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3 rounded-sm bg-[#d4af37] shadow-[0_0_6px_rgba(212,175,55,0.9)]"
              style={{ left: `calc(${medianPct}% - 3px)` }}
            />
          </div>
        </div>

        {/* Trend grid. */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <StatCell label="7D" value={row.trend_7d} accent />
          <StatCell label="30D" value={row.trend_30d} accent />
          <StatCell label="DRAFTS" value={row.draft_count} mono />
        </div>

        {/* Risers / fallers tag. */}
        {(rising || falling) && (
          <div className={cn(
            "mt-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-1 rounded-md border",
            rising  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-red-400/30 bg-red-400/10 text-red-300",
          )}>
            {rising ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {rising ? "Rising in market" : "Falling in market"}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value, accent, mono }: { label: string; value: number; accent?: boolean; mono?: boolean }) {
  const rising = value < 0;
  const flat = Math.abs(value) < 2;
  const color = !accent ? "text-white" : flat ? "text-white/60" : rising ? "text-emerald-300" : "text-red-300";
  const sign = accent && !flat ? (rising ? "▲" : "▼") : "";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1">
      <div className="text-[8px] uppercase tracking-wider text-white/40 leading-none">{label}</div>
      <div className={cn("mt-0.5 text-[11px] font-bold leading-none tabular-nums", color)}>
        {sign} {accent ? Math.abs(value) : value}
        {mono ? "" : ""}
      </div>
    </div>
  );
}

function HexLegend() {
  const entries: Array<[string, PosTheme]> = [
    ["QB", HEX_POS_THEME.QB], ["RB", HEX_POS_THEME.RB],
    ["WR", HEX_POS_THEME.WR], ["TE", HEX_POS_THEME.TE],
    ["K", HEX_POS_THEME.K], ["RP", HEX_POS_THEME.PICK],
  ];
  return (
    <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
      {entries.map(([label, t]) => (
        <div
          key={label}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border bg-white/[0.02]"
          style={{ borderColor: `${t.ring}40` }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: t.base, boxShadow: `0 0 6px ${t.glow}` }}
          />
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: t.text }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.replace(/[^\w\s.'-]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


// ── Position tile reused by List and Box ────────────────────────────────────
function PositionTile({ pos, text, size = "sm" }: { pos: Position; text: string; size?: "sm" | "md" }) {
  const c = POS_COLOR[pos];
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center flex-shrink-0 ring-1 font-bold",
        c.bg, c.text, c.ring,
        size === "md" ? "w-10 h-10 text-[11px]" : "w-9 h-9 text-[10px]",
      )}
    >
      {text}
    </div>
  );
}

function TrendBadge({ value, compact = false }: { value: number; compact?: boolean }) {
  const isFlat = Math.abs(value) < 2;
  // Negative trend means ADP got smaller → player rising. Color it green.
  const isRising = value < 0;
  const Icon = isFlat ? Minus : isRising ? TrendingUp : TrendingDown;
  const color = isFlat ? "text-muted-foreground" : isRising ? "text-emerald-500" : "text-red-500";
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", color, compact ? "text-[10px]" : "text-xs")}>
      <Icon className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {!isFlat && <span>{Math.abs(value)}</span>}
    </span>
  );
}

// ── Filter Sheet ─────────────────────────────────────────────────────────────
function FilterSheet({
  open, onOpenChange, filters, update, onReset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filters: DraftFilters;
  update: <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => void;
  onReset: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-background">
        <SheetHeader className="text-left mb-4">
          <SheetTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#d4af37]" />
            Draft Filters
          </SheetTitle>
          <SheetDescription>Narrow the ADP dataset by draft characteristics.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {/* Date range */}
          <FilterGroup label="Date Range">
            <div className="grid grid-cols-2 gap-2">
              <DateField label="Start" value={filters.dateRange.start} onChange={(v) => update("dateRange", { ...filters.dateRange, start: v })} />
              <DateField label="End"   value={filters.dateRange.end}   onChange={(v) => update("dateRange", { ...filters.dateRange, end:   v })} />
            </div>
          </FilterGroup>

          <FilterGroup label="Draft Type">
            <SelectField value={filters.draftType} onChange={(v) => update("draftType", v as DraftFilters["draftType"])} options={[
              { value: "startup",      label: "Startup" },
              { value: "rookie",       label: "Rookie" },
              { value: "supplemental", label: "Supplemental" },
              { value: "all",          label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Draft Format">
            <SelectField value={filters.draftFormat} onChange={(v) => update("draftFormat", v as DraftFilters["draftFormat"])} options={[
              { value: "snake",   label: "Snake" },
              { value: "auction", label: "Auction" },
              { value: "linear",  label: "Linear" },
              { value: "all",     label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Picks / Rookies">
            <div className="grid grid-cols-2 gap-1.5">
              {ROOKIE_MODE_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => update("rookieMode", m.id)}
                  className={cn(
                    "px-2 py-2 rounded-lg border text-[11px] font-semibold transition-all text-center",
                    filters.rookieMode === m.id
                      ? "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40"
                      : "bg-muted/30 text-muted-foreground border-border/40 hover:border-border",
                  )}
                  data-testid={`filter-rookie-${m.id}`}
                >
                  <div>{m.label}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{m.sub}</div>
                </button>
              ))}
            </div>
          </FilterGroup>

          <FilterGroup label="Teams">
            <SelectField value={String(filters.teams)} onChange={(v) => update("teams", v === "all" ? "all" : Number(v) as DraftFilters["teams"])} options={[
              { value: "8",  label: "8" }, { value: "10", label: "10" }, { value: "12", label: "12" },
              { value: "14", label: "14" }, { value: "16", label: "16" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Scoring">
            <SelectField value={filters.scoring} onChange={(v) => update("scoring", v as DraftFilters["scoring"])} options={[
              { value: "ppr",      label: "PPR" }, { value: "half", label: "Half PPR" },
              { value: "standard", label: "Standard" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Pass TD">
            <SelectField value={String(filters.passTd)} onChange={(v) => update("passTd", v === "all" ? "all" : Number(v) as DraftFilters["passTd"])} options={[
              { value: "4", label: "4 pt" }, { value: "6", label: "6 pt" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="TE Premium">
            <SelectField value={filters.tePremium} onChange={(v) => update("tePremium", v as DraftFilters["tePremium"])} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Best Ball">
            <SelectField value={filters.bestBall} onChange={(v) => update("bestBall", v as DraftFilters["bestBall"])} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Superflex">
            <SelectField value={filters.superflex} onChange={(v) => update("superflex", v as DraftFilters["superflex"])} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "all", label: "All" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Starters">
            <SelectField value={String(filters.starters)} onChange={(v) => update("starters", v === "all" ? "all" : Number(v) as DraftFilters["starters"])} options={[
              { value: "all", label: "All" }, { value: "8", label: "8" }, { value: "9", label: "9" },
              { value: "10", label: "10" }, { value: "11", label: "11" },
            ]} />
          </FilterGroup>

          <FilterGroup label="Roster Size">
            <SelectField value={String(filters.rosterSize)} onChange={(v) => update("rosterSize", v === "all" ? "all" : Number(v) as DraftFilters["rosterSize"])} options={[
              { value: "all", label: "All" }, { value: "20", label: "20" }, { value: "22", label: "22" },
              { value: "24", label: "24" }, { value: "26", label: "26" }, { value: "28", label: "28" },
            ]} />
          </FilterGroup>

        </div>

        <div className="flex items-center gap-2 mt-6 pb-4">
          <Button variant="outline" onClick={onReset} className="flex-1 border-border/60" data-testid="btn-reset-filters">
            Reset
          </Button>
          <Button onClick={() => onOpenChange(false)} className="flex-1 bg-[#d4af37] hover:bg-[#c49b2e] text-[#0a1628] font-semibold" data-testid="btn-apply-filters">
            Apply
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground mb-1">{label}</label>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" />
    </div>
  );
}

function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Empty / Loading / Error states ───────────────────────────────────────────
function LoadingState() {
  return (
    <Card className="flex items-center justify-center py-20 border-border/60 dark:border-[#1a2d4a]/80">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin text-[#d4af37]" />
        <span>Loading ADP…</span>
      </div>
    </Card>
  );
}

function ErrorState({ message }: { message: string | null }) {
  return (
    <Card className="flex flex-col items-center justify-center py-16 px-6 text-center border-border/60 dark:border-[#1a2d4a]/80">
      <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
      <h3 className="text-sm font-bold mb-1">Couldn’t load draft data</h3>
      <p className="text-xs text-muted-foreground max-w-xs">
        {message || "Something went wrong while fetching ADP. Try refreshing or come back in a moment."}
      </p>
    </Card>
  );
}

function EmptyState({ message }: { message?: string }) {
  const isFresh = message && message.toLowerCase().includes("no adp data");
  return (
    <Card className="flex flex-col items-center justify-center py-16 px-6 text-center border-border/60 dark:border-[#1a2d4a]/80">
      <Search className="w-8 h-8 text-muted-foreground mb-2" />
      <h3 className="text-sm font-bold mb-1">
        {isFresh ? "No draft data available yet" : "No matching drafts found"}
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs">
        {isFresh
          ? "Ingest drafts from the admin tools to populate ADP."
          : (message || "Try expanding your date range or relaxing filters.")}
      </p>
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function filterAdp(all: ADPResult[], filters: DraftFilters): ADPResult[] {
  const q = filters.search.trim().toLowerCase();
  return all.filter((r) => {
    if (filters.rookieMode === "picks"  && !r.is_rookie_placeholder) return false;
    if (filters.rookieMode === "direct" &&  r.is_rookie_placeholder) return false;
    if (q && !r.player_name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function countActiveFilters(f: DraftFilters): number {
  let n = 0;
  if (f.draftType   !== DEFAULT_FILTERS.draftType)   n++;
  if (f.draftFormat !== DEFAULT_FILTERS.draftFormat) n++;
  if (f.teams       !== DEFAULT_FILTERS.teams)       n++;
  if (f.scoring     !== DEFAULT_FILTERS.scoring)     n++;
  if (f.passTd      !== DEFAULT_FILTERS.passTd)      n++;
  if (f.tePremium   !== DEFAULT_FILTERS.tePremium)   n++;
  if (f.bestBall    !== DEFAULT_FILTERS.bestBall)    n++;
  if (f.superflex   !== DEFAULT_FILTERS.superflex)   n++;
  if (f.starters    !== DEFAULT_FILTERS.starters)    n++;
  if (f.rosterSize  !== DEFAULT_FILTERS.rosterSize)  n++;
  return n;
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.round((e - s) / 86_400_000);
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function shortenName(name: string): string {
  // For hex tiles, abbreviate first name to initial when full name doesn't fit.
  if (name.length <= 14) return name;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}
