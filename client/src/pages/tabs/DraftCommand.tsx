import { useState, useMemo, useCallback, useEffect, useRef, Component } from "react";
import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/SectionHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/apiBase";
import {
  Search, SlidersHorizontal, List, LayoutGrid, Hexagon,
  TrendingUp, TrendingDown, Minus, AlertCircle, RefreshCw, ChevronUp, ChevronDown, ChevronRight,
  Calendar, X, Trophy, Rocket, Sparkles, Database,
} from "lucide-react";
import {
  DEFAULT_FILTERS, toIsoDate,
  type ADPResult, type DraftFilters, type Position, type RookieMode,
} from "@/types/draft";
import { AdpCrawlPanel } from "@/components/admin/AdpCrawlPanel";
import { UsageLogPanel } from "@/components/admin/UsageLogPanel";
import { MoversPanel } from "@/components/draft/MoversPanel";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";

// The frontend never queries Sleeper for ADP — it reads our cached endpoint
// which serves the most recent adp_snapshots row for the active filter set.
function buildAdpUrl(filters: DraftFilters): string {
  const p = new URLSearchParams();
  // Season MUST be sent — the API defaults to "current year" when omitted,
  // but being explicit makes the cache key obvious and pins the snapshot
  // to the filter the user is actually viewing.
  if (filters.season === "all") {
    p.set("season", "all");
  } else if (Array.isArray(filters.season)) {
    p.set("season", filters.season.join(","));
  } else if (filters.season) {
    p.set("season", filters.season);
  }
  // Rookie Picks (placeholder mode) only ever returns data from rookie
  // drafts — startup drafts have isRookiePlaceholder=false on every pick by
  // definition, so leaving draftType=startup here returned zero rows and
  // the chip appeared broken. Force draftType=rookie at request time when
  // the user has selected the placeholder filter; the URL-level override
  // doesn't mutate filter state, so toggling back to "Direct Rookies" still
  // queries whatever draftType the user has chosen.
  const effectiveDraftType = filters.rookieMode === "picks"
    ? "rookie"
    : filters.draftType;
  p.set("draftType", effectiveDraftType);
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
  // Prefix with API_BASE so production builds hit the Express backend on the
  // separate API origin instead of the static host's SPA fallback (which would
  // return index.html and trip the "API route returned app HTML" guard).
  return `${API_BASE}/api/adp?${p.toString()}`;
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

type ViewMode = "list" | "box" | "hex" | "round";

// ── Top-level tabs (Startup ADP vs Rookie Drafts) ───────────────────────────
// Live Drafts lives at a higher level (Draft Board sub-tab in the Command
// Center sidebar), so it doesn't appear here — including a third tab would
// double-route to the same view.
type DraftTopTab = "startup" | "rookie";

const TOP_TABS: { id: DraftTopTab; label: string; subtitle: string; icon: typeof List }[] = [
  { id: "startup", label: "Startup Drafts",  subtitle: "Real Sleeper startup draft data and market movement.", icon: Rocket },
  { id: "rookie",  label: "Rookie Drafts", subtitle: "Track rookie-only draft ADP from real Sleeper rookie drafts.", icon: Sparkles },
];

const STARTUP_VIEW_OPTIONS: { id: ViewMode; label: string; icon: typeof List }[] = [
  { id: "list", label: "List", icon: List },
  { id: "box",  label: "Box",  icon: LayoutGrid },
  { id: "hex",  label: "Hex",  icon: Hexagon },
];

const ROOKIE_VIEW_OPTIONS: { id: ViewMode; label: string; icon: typeof List }[] = [
  { id: "list", label: "List", icon: List },
  { id: "box",  label: "Box",  icon: LayoutGrid },
  { id: "hex",  label: "Hex",  icon: Hexagon },
];

// Rookie-tab defaults — 12-team superflex PPR over the last 90 days, Actual
// Rookies mode. Per the spec these override DEFAULT_FILTERS only for the
// fields that diverge; everything else is inherited.
function rookieTabDefaults(prev: DraftFilters): DraftFilters {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 90);
  return {
    ...prev,
    draftType: "rookie",
    rookieMode: "direct",
    scoring: "all",
    superflex: "all",
    teams: 12,
    dateRange: { start: toIsoDate(start), end: toIsoDate(end) },
    search: "",
  };
}

function startupTabDefaults(prev: DraftFilters): DraftFilters {
  // Hop back to startup-friendly defaults — keep most things, but reset the
  // rookie-specific bits so we don't accidentally re-query rookie data.
  return {
    ...prev,
    draftType: "startup",
    rookieMode: "direct",
    search: "",
  };
}

const ROOKIE_MODE_OPTIONS: { id: RookieMode; label: string; sub: string }[] = [
  { id: "picks",  label: "Rookie Picks",   sub: "Placeholders" },
  { id: "direct", label: "Direct Rookies", sub: "Actual players" },
  { id: "both",   label: "Both",           sub: "All rookie data" },
];

/** Top-N cap applied across all three views — beyond this depth the data is
 *  mostly noise (waiver fodder) and the Box/Hex draft boards become unwieldy. */
const MAX_PLAYERS_SHOWN = 490;

/** Hard upper bound on rounds rendered in the Box/Hex draft-room views. At
 *  490 players ÷ 12 teams ≈ 41 rounds, so the cap mainly binds for smaller
 *  team counts and protects against runaway grids. */
const MAX_ROUNDS_SHOWN = 45;

const RANGE_SHORTCUTS = [
  { id: "7",   label: "7D",  days: 7 },
  { id: "30",  label: "30D", days: 30 },
  { id: "90",  label: "90D", days: 90 },
] as const;

// ── Main page ────────────────────────────────────────────────────────────────
export function DraftCommand() {
  const [filters, setFilters] = useState<DraftFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewMode>("list");
  const [topTab, setTopTab] = useState<DraftTopTab>("startup");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const switchTab = useCallback((next: DraftTopTab) => {
    if (next === topTab) return;
    setTopTab(next);
    setFilters((prev) => next === "rookie" ? rookieTabDefaults(prev) : startupTabDefaults(prev));
    // If the active view isn't valid for the new tab, drop back to List.
    setView((cur) => {
      const allowed = (next === "rookie" ? ROOKIE_VIEW_OPTIONS : STARTUP_VIEW_OPTIONS).map((v) => v.id);
      return allowed.includes(cur) ? cur : "list";
    });
  }, [topTab]);

  const currentViewOptions = topTab === "rookie" ? ROOKIE_VIEW_OPTIONS : STARTUP_VIEW_OPTIONS;
  const currentTabMeta = TOP_TABS.find((t) => t.id === topTab) ?? TOP_TABS[0];

  const [rows, setRows] = useState<ADPResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [meta, setMeta] = useState<AdpResponseMeta | null>(null);
  // Corpus-wide ADP totals (real picks + dynasty drafts scanned). Global + cached.
  const [adpStats, setAdpStats] = useState<{ totalPicks: number; dynastyDraftsScanned: number } | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/adp/stats`)
      .then((r) => r.json())
      .then((data) => { if (typeof data?.totalPicks === "number") setAdpStats(data); })
      .catch(() => {});
  }, []);
  // Stash the AbortController so the Cancel button (and effect cleanup) can
  // actually kill the in-flight HTTP request, not just discard its result.
  const [scanController, setScanController] = useState<AbortController | null>(null);
  const [wasCancelled, setWasCancelled] = useState(false);
  // Retry counter — bumped by the Cancelled-state Retry button to force the
  // fetch effect to re-run with the same filters. setFilters(filters) won't
  // re-trigger the effect because the reference is unchanged.
  const [retryNonce, setRetryNonce] = useState(0);
  // Distinguishes user-initiated cancels from filter-change aborts. Without
  // it, every filter change would briefly mark the explorer "cancelled"
  // because the cleanup also aborts the in-flight fetch.
  const userCancelledRef = useRef(false);

  // Clicking a player opens the full-page profile (/players/:slug) via the
  // global navigator, rather than the old in-explorer side drawer. Rookie-pick
  // placeholders have no NFL profile page, so they stay non-navigating.
  const { openPlayerProfile } = usePlayerProfile();
  const handlePlayerClick = useCallback((row: ADPResult) => {
    if (row.is_rookie_placeholder) return;
    openPlayerProfile(row.player_id);
  }, [openPlayerProfile]);

  useEffect(() => {
    const controller = new AbortController();
    setScanController(controller);
    setIsLoading(true);
    setErrorMessage(null);
    setWasCancelled(false);
    userCancelledRef.current = false;

    const url = buildAdpUrl(filters);
    console.log("[ADP] fetch URL:", url);
    fetch(url, { signal: controller.signal })
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
        if (controller.signal.aborted) return;
        setRows(Array.isArray(data.items) ? data.items : []);
        setMeta(data.meta ?? null);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          // Only present the soft "Cancelled" state if the user actually
          // clicked Cancel — filter-change aborts shouldn't briefly flash
          // "cancelled" on their way to the next fetch.
          if (userCancelledRef.current) setWasCancelled(true);
          return;
        }
        console.error("[DraftCommand] /api/adp fetch failed:", err);
        setErrorMessage(err?.message || "Failed to load ADP");
        setRows([]);
        setMeta(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [filters, retryNonce]);

  const cancelScan = useCallback(() => {
    userCancelledRef.current = true;
    scanController?.abort();
  }, [scanController]);

  const retryScan = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  // Search runs client-side over whatever the server returned so typing is
  // instant; everything else is already filtered by the API. After filtering
  // we cap to the top MAX_PLAYERS_SHOWN by overall_rank — beyond that depth
  // the data is mostly noise (deep waiver fodder) and the Box/Hex grids get
  // unmanageably tall.
  const filtered = useMemo(() => {
    const f = filterAdp(rows, filters);
    if (f.length <= MAX_PLAYERS_SHOWN) return f;
    return [...f]
      .sort((a, b) => a.overall_rank - b.overall_rank)
      .slice(0, MAX_PLAYERS_SHOWN);
  }, [rows, filters]);
  // Two distinct empty states: dataset legitimately empty (no ingest yet, or
  // current filters match no drafts) vs. fetch failure. The latter shows the
  // error card; the former shows a friendly "no data yet" message.
  const hasError = errorMessage !== null;
  const isEmpty = !isLoading && !hasError && filtered.length === 0;

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
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <SectionHeader
            title="ADP Explorer"
            subtitle={currentTabMeta.subtitle}
          />
        </div>

        {/* ── Top tabs: Startup ADP / Rookie Drafts — inline with the header
            row, right-aligned on desktop (centered on mobile), matching the
            Table/Plot/Chart/Heatmap toggle. The .sc-subtab-underline marker
            gives it the shared light-mode gold/black treatment. */}
        <div className="flex justify-center md:justify-end flex-shrink-0">
          <div
            className="grid w-[90vw] md:w-fit"
            style={{ gridTemplateColumns: "repeat(2, 1fr)", height: 48, borderRadius: 16, padding: 4, background: "var(--sc-toggle-bg)", border: "1px solid var(--sc-toggle-border)", gap: 4, minWidth: 0 }}
            data-testid="draft-command-top-tabs"
          >
        {TOP_TABS.map((t) => {
          const active = topTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              title={t.label}
              data-testid={`draft-tab-${t.id}`}
              className="relative flex items-center justify-center gap-1.5 font-semibold transition-all duration-200"
              style={{ borderRadius: 12, fontSize: 12, letterSpacing: "0.01em", background: active ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent", color: active ? "#fff" : "var(--sc-toggle-inactive-text)", border: active ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent", boxShadow: active ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none", paddingLeft: 12, paddingRight: 12 }}
            >
              <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
              <span>{t.label}</span>
              {active && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 24, height: 2, background: "#d4af37", opacity: 0.85 }} />}
            </button>
          );
        })}
          </div>
        </div>
      </div>

      {/* ── Database stats banner ────────────────────────────────────────── */}
      <div className="flex items-start justify-center md:justify-start gap-3 p-3 rounded-lg bg-[#0b3a7a]/5 dark:bg-blue-400/5 border border-[#0b3a7a]/10 dark:border-blue-400/10" data-testid="adp-db-stats-banner">
        <Database className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 mt-0.5" />
        {adpStats && typeof adpStats.totalPicks === "number" && typeof adpStats.dynastyDraftsScanned === "number" ? (
          <p className="text-sm leading-snug text-center md:text-left">
            <span className="font-bold text-[#d4af37]" data-testid="text-total-picks">{adpStats.totalPicks.toLocaleString()}</span>
            <span className="text-muted-foreground"> Real Picks | </span>
            <span className="font-bold text-[#d4af37]" data-testid="text-dynasty-drafts">{adpStats.dynastyDraftsScanned.toLocaleString()}</span>
            <span className="text-muted-foreground"> Dynasty Drafts Scanned</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-center md:text-left">Loading draft database stats...</p>
        )}
      </div>

      {/* ── Biggest 7-day ADP movers (startup + rookie drafts) ───────────── */}
      <MoversPanel
        rows={rows}
        teams={typeof filters.teams === "number" ? filters.teams : 12}
        totalDrafts={meta?.draft_count ?? null}
        mode={topTab}
      />

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
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
          {/* View switcher — set varies by top tab (rookie tab swaps Hex
              for the rookie-board layout). */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--sc-card-soft)] border border-[var(--sc-border)] dark-any:bg-white/[0.03] dark-any:border-white/6">
            {currentViewOptions.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  view === id
                    ? "bg-[var(--sc-blue)] dark-any:bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25"
                    : "text-[var(--sc-text-muted)] hover:text-[var(--sc-blue)] dark-any:text-white/40 dark-any:hover:text-white/70",
                )}
                data-testid={`view-${id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Rookie Mode toggle removed — both Startup and Rookie tabs are
              now locked to Direct Rookies via *TabDefaults. The Picks / Both
              modes remain reachable via the API (admin tooling) but aren't
              exposed in the UI. */}

          {/* Date range shortcuts */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6">
            {RANGE_SHORTCUTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setRange(s.days)}
                className={cn(
                  "range-pill px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  activeShortcut === s.id ? "range-active bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/40 hover:text-white/70",
                )}
                data-testid={`range-${s.id}`}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() => setFilterSheetOpen(true)}
              className={cn(
                "range-pill flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                activeShortcut === null ? "range-active bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/40 hover:text-white/70",
              )}
              data-testid="range-custom"
            >
              <Calendar className="w-3 h-3" />
              <span>Custom</span>
            </button>
          </div>

        </div>
      </div>

      {/* ── Main body ─────────────────────────────────────────────────────── */}
      {/* When the user cancels mid-fetch we keep any previously-loaded rows
          on screen rather than wiping the explorer — only fall back to the
          dedicated "Scan cancelled" empty state when there's literally
          nothing to display. */}
      {isLoading                                              && <LoadingState onCancel={cancelScan} />}
      {!isLoading && hasError                                 && <ErrorState message={errorMessage} />}
      {!isLoading && !hasError && isEmpty && wasCancelled     && <CancelledState onRetry={retryScan} />}
      {!isLoading && !hasError && isEmpty && !wasCancelled    && (
        <EmptyState
          message={
            topTab === "rookie"
              ? "No rookie draft data found. Try expanding your date range or changing rookie mode."
              : meta?.message
          }
        />
      )}
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

          {view === "list" && <ListView rows={filtered} filters={filters} onPlayerClick={handlePlayerClick} />}
          {view === "box"  && <BoxView  rows={filtered} teams={typeof filters.teams === "number" ? filters.teams : 12} filters={filters} onPlayerClick={handlePlayerClick} />}
          {view === "hex"  && <HexView  rows={filtered} teams={typeof filters.teams === "number" ? filters.teams : 12} draftFormat={filters.draftFormat} filters={filters} onPlayerClick={handlePlayerClick} />}
        </>
      )}

      {/* ── Filter sheet (right side, mobile + desktop) ───────────────────── */}
      <FilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        filters={filters}
        update={updateFilter}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        topTab={topTab}
      />

      {/* ── Admin-only "ADP Data Crawl" tools (see shared/admin.ts) ───────── */}
      {/* useAuth().isAdmin is server-derived for DC users and locally derived
          for Sleeper-username matches. Backend routes do their own strict
          email-based check — this gate only governs UI visibility. */}
      <AdminAdpTools />
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
  const { isServerAdmin } = useAuth();
  // Gate on the SERVER-confirmed admin flag — this matches exactly what the
  // backend crawl routes authorize (admin email / secret), and it intentionally
  // excludes the Sleeper-username frontend hint (e.g. @makitrain synced
  // read-only with no DC login), whose crawl the server would 403. Note: this
  // is NOT tied to subscription / write-access domain, because the crawl
  // endpoints don't require those — only an admin account.
  if (!isServerAdmin) return null;
  return (
    <AdminToolsBoundary>
      <AdpCrawlPanel />
      <UsageLogPanel />
      <ReclassifyDraftsButton />
    </AdminToolsBoundary>
  );
}

function ReclassifyDraftsButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{
    drafts: number;
    picksReclassified: number;
    rookieYearsBackfilled?: number;
    byMode: Record<"direct_rookies" | "rookie_picks" | "mixed" | "unknown", number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setError(null);
    try {
      const token = (() => { try { return localStorage.getItem("sc_auth_token"); } catch { return null; } })();
      const r = await fetch(`${API_BASE}/api/admin/adp/reclassify`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      const body = await r.json();
      setResult(body);
      setState("done");
    } catch (e: any) {
      setError(e?.message ?? "Reclassify failed");
      setState("error");
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-white">Reclassify rookie drafts</div>
          <div className="text-[11px] text-white/55 mt-0.5">
            Walks all stored draft picks, fixes kicker-as-placeholder rows, recomputes
            each draft's rookieMode, and clears the snapshot cache.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state === "running"}
          data-testid="button-reclassify-adp"
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
            state === "running"
              ? "bg-white/[0.04] border-white/10 text-white/40 cursor-not-allowed"
              : "bg-[#d4af37]/12 border-[#d4af37]/35 text-[#d4af37] hover:bg-[#d4af37]/20",
          )}
        >
          {state === "running" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {state === "running" ? "Reclassifying…" : "Reclassify"}
        </button>
      </div>
      {state === "done" && result && (
        <div className="mt-3 text-[11px] text-white/65 grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 tabular-nums">
          <span>Drafts scanned: <span className="text-white">{result.drafts}</span></span>
          <span>Picks updated: <span className="text-white">{result.picksReclassified}</span></span>
          {typeof result.rookieYearsBackfilled === "number" && (
            <span>Rookie years filled: <span className="text-white">{result.rookieYearsBackfilled}</span></span>
          )}
          <span>Direct rookies: <span className="text-white">{result.byMode.direct_rookies}</span></span>
          <span>Rookie picks: <span className="text-white">{result.byMode.rookie_picks}</span></span>
          <span>Mixed: <span className="text-white">{result.byMode.mixed}</span></span>
          <span>Unknown: <span className="text-white">{result.byMode.unknown}</span></span>
        </div>
      )}
      {state === "error" && (
        <div className="mt-2 text-[11px] text-rose-300">{error}</div>
      )}
    </div>
  );
}

// ── List View ────────────────────────────────────────────────────────────────
type ListSortKey = "overall_rank" | "avg_pick" | "min_pick" | "max_pick" | "draft_count" | "trend_30d" | "positional_rank";

const LIST_PAGE_SIZE = 50;

/** Human-readable summary of the active filter set — e.g. "12-team · Snake ·
 *  PPR · SF · TEP". Drops segments that are "all" or otherwise unset so the
 *  badge only shows what the user actually constrained. */
function formatDraftLabel(f: DraftFilters): string {
  const parts: string[] = [];
  if (f.teams !== "all") parts.push(`${f.teams}-team`);
  if (f.draftFormat !== "all") {
    parts.push(
      f.draftFormat === "snake" ? "Snake"
        : f.draftFormat === "auction" ? "Auction"
        : "Linear",
    );
  }
  if (f.scoring !== "all") {
    parts.push(
      f.scoring === "ppr" ? "PPR"
        : f.scoring === "half" ? "Half PPR"
        : "Standard",
    );
  }
  if (f.superflex === "yes") parts.push("SF");
  else if (f.superflex === "no") parts.push("1QB");
  if (f.tePremium === "yes") parts.push("TEP");
  if (f.bestBall === "yes") parts.push("Best Ball");
  if (f.passTd === 6) parts.push("6pt TD");
  if (f.leagueMode === "redraft") parts.push("Redraft");
  else if (f.leagueMode === "keeper") parts.push("Keeper");
  if (f.draftType !== "all") {
    parts.push(f.draftType === "rookie" ? "Rookie Draft" : "Startup");
  }
  return parts.join(" · ");
}

function ListView({ rows, filters, onPlayerClick }: { rows: ADPResult[]; filters: DraftFilters; onPlayerClick?: (row: ADPResult) => void }) {
  const [sortKey, setSortKey] = useState<ListSortKey>("overall_rank");
  const [sortAsc, setSortAsc] = useState(true);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);

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

  // Reset pagination when the dataset or sort changes so the user isn't
  // stranded inside a re-sorted list.
  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [rows, sortKey, sortAsc]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;
  const nextChunk = Math.min(LIST_PAGE_SIZE, sorted.length - visibleCount);

  const handleSort = (key: ListSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ col }: { col: ListSortKey }) => {
    if (sortKey !== col) return <Minus className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-[#d4af37]" /> : <ChevronDown className="w-3 h-3 text-[#d4af37]" />;
  };

  const draftLabel = formatDraftLabel(filters);

  return (
    <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
      {/* Active-filter summary — surfaces what kind of draft these ADPs come
           from at a glance. Hidden when no constraints are active. */}
      {draftLabel && (
        <div className="px-3 md:px-4 py-2 border-b border-border/40 bg-muted/20 dark:bg-white/[0.02] flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Draft Type
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#d4af37] text-[11px] font-bold tabular-nums"
            data-testid="list-draft-label"
          >
            {draftLabel}
          </span>
        </div>
      )}

      {/* Mobile: card-list */}
      <div className="md:hidden divide-y divide-border/20">
        {visible.map((r) => (
          <MobileListRow key={r.player_id} row={r} onPlayerClick={onPlayerClick} />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30 dark:bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-2 text-center cursor-pointer hover:text-foreground w-12" onClick={() => handleSort("overall_rank")}>
                <span className="inline-flex items-center gap-0.5">Rk <SortIcon col="overall_rank" /></span>
              </th>
              <th className="px-3 py-2 text-left">Player</th>
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
            {visible.map((r) => (
              <tr
                key={r.player_id}
                className={cn("hover:bg-muted/20", onPlayerClick && "cursor-pointer")}
                data-testid={`row-adp-${r.player_id}`}
                onClick={() => onPlayerClick?.(r)}
              >
                <td className="px-2 py-2.5 text-center font-semibold tabular-nums">{r.overall_rank}</td>
                <td className="px-3 py-2.5">
                  <PlayerCell row={r} />
                </td>
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

      {/* Pagination footer */}
      <div className="border-t border-border/40 bg-muted/20 dark:bg-white/[0.015] px-3 py-2.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums" data-testid="list-pagination-count">
          Showing <span className="font-semibold text-foreground">{visible.length}</span> of{" "}
          <span className="font-semibold text-foreground">{sorted.length}</span>
        </span>
        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
            data-testid="button-list-show-more"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#d4af37]/30 bg-[#d4af37]/8 hover:bg-[#d4af37]/15 px-3 py-1 text-[11px] font-semibold text-[#d4af37] transition-colors"
          >
            Show next {nextChunk}
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
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
      <PlayerAvatar
        compact
        id={row.player_id}
        name={row.player_name}
        pos={row.position}
        team={row.team}
        size="sm"
      />
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
  // Mirrors the Market Value tab's Player column: circular headshot with
  // team-logo badge, name, and pos/team text — provided by PlayerAvatar.
  return (
    <PlayerAvatar
      id={row.player_id}
      name={row.player_name}
      pos={row.position}
      team={row.team}
      size="sm"
    />
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

function BoxView({ rows, teams, filters, onPlayerClick }: { rows: ADPResult[]; teams: number; filters: DraftFilters; onPlayerClick?: (row: ADPResult) => void }) {
  const draftLabel = formatDraftLabel(filters);
  const isMobile = useIsMobile();
  // Sleeper / OTC / FFPC density: short tiles, ~1px gutter, dark navy body
  // with a thin position-tinted top stripe. Cells must fit a position rank
  // badge, pick number, single-line player name, pos·team meta, and a small
  // bottom-right headshot inside ~72px tall (~5–6 rounds visible on a
  // typical 13" laptop without scroll).
  const cellW = isMobile ? 100 : 116;
  const cellH = isMobile ? 56 : 60;
  const labelColW = isMobile ? 32 : 36;

  // Build the snake-layout grid. We sort by ADP ascending and assign each
  // entry a (round, slot) coordinate so the resulting grid reads exactly like
  // a startup draft room replay. Hard cap at MAX_ROUNDS_SHOWN — anything
  // deeper falls off the board.
  const { grid, totalRounds } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.avg_pick - b.avg_pick);
    const g = new Map<number, Array<ADPResult | null>>();
    let maxRound = 0;
    sorted.forEach((r, idx) => {
      const seq = idx + 1;
      const round = Math.ceil(seq / teams);
      if (round > MAX_ROUNDS_SHOWN) return;
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
    <Card className="overflow-hidden border-white/8 bg-[#070f1c]">
      <div className="px-3 py-1.5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
          <h3 className="text-[13px] font-bold text-white">Draft Board</h3>
          <span className="text-[10px] text-white/40 truncate">{teams}-team snake</span>
        </div>
        <HexLegend />
      </div>

      {draftLabel && (
        <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
            Draft Type
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#d4af37] text-[11px] font-bold tabular-nums"
            data-testid="box-draft-label"
          >
            {draftLabel}
          </span>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-hidden">
        <div className="inline-block min-w-full">
          {/* Team header row — tighter, Sleeper-style "Team N" labels. */}
          <div className="flex sticky top-0 z-30 bg-[#070f1c] border-b border-white/[0.08]">
            <div
              className="sticky left-0 z-40 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.18em] text-white/30 border-r border-white/[0.08] bg-[#070f1c]"
              style={{ width: labelColW, height: 20, flexShrink: 0 }}
            >
              R
            </div>
            {Array.from({ length: teams }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.15em] text-white/45 border-r border-white/[0.04]"
                style={{ width: cellW, height: 20, flexShrink: 0 }}
              >
                <span>T{i + 1}</span>
              </div>
            ))}
          </div>

          {/* Round rows — no row striping, no per-row bottom border (each
               cell renders its own hairline so rows blend into a grid). */}
          {Array.from({ length: totalRounds }, (_, rIdx) => {
            const round = rIdx + 1;
            const cells = grid.get(round) ?? Array.from({ length: teams }, () => null);
            const isOdd = round % 2 === 1;
            return (
              <div key={round} className="flex">
                <RoundLabel round={round} isOdd={isOdd} width={labelColW} height={cellH} />
                {cells.map((cell, slotIdx) => (
                  <DraftPickCell
                    key={slotIdx}
                    pick={cell}
                    round={round}
                    pickInRound={isOdd ? slotIdx + 1 : teams - slotIdx}
                    width={cellW}
                    height={cellH}
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

function RoundLabel({ round, width, height }: { round: number; isOdd: boolean; width: number; height: number }) {
  return (
    <div
      className="sticky left-0 z-20 flex items-center justify-center text-[10px] font-bold border-r border-white/8 bg-[#070f1c]"
      style={{ width, flexShrink: 0, minHeight: height }}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/35 tabular-nums">
        R{round}
      </span>
    </div>
  );
}

// Position colour as ACCENT only — a thin top stripe and the badge text.
// The card body itself stays neutral navy (Sleeper-style: position is a
// scan cue, not the dominant visual).
const BOX_POS_ACCENT: Record<Position, {
  stripe: string;
  badgeText: string;
  metaText: string;
  /** Filled background of the card body. Soft enough that white text stays
   *  legible without an overlay. */
  bg: string;
  /** Hover variant — slightly brighter fill. */
  hoverBg: string;
  /** Per-card border that picks up the position tint. */
  border: string;
}> = {
  QB:   {
    stripe: "bg-rose-500/80",    badgeText: "text-rose-200",
    metaText: "text-rose-200/80",
    bg: "bg-rose-900/35",        hoverBg: "hover:bg-rose-900/55",
    border: "border-rose-500/40",
  },
  RB:   {
    stripe: "bg-emerald-500/80", badgeText: "text-emerald-200",
    metaText: "text-emerald-200/80",
    bg: "bg-emerald-900/35",     hoverBg: "hover:bg-emerald-900/55",
    border: "border-emerald-500/40",
  },
  WR:   {
    stripe: "bg-sky-500/80",     badgeText: "text-sky-200",
    metaText: "text-sky-200/80",
    bg: "bg-sky-900/40",         hoverBg: "hover:bg-sky-900/60",
    border: "border-sky-500/40",
  },
  TE:   {
    stripe: "bg-amber-500/80",   badgeText: "text-amber-200",
    metaText: "text-amber-200/80",
    bg: "bg-amber-900/35",       hoverBg: "hover:bg-amber-900/55",
    border: "border-amber-500/40",
  },
  K:    {
    stripe: "bg-purple-500/80",  badgeText: "text-purple-200",
    metaText: "text-purple-200/80",
    bg: "bg-purple-900/35",      hoverBg: "hover:bg-purple-900/55",
    border: "border-purple-500/40",
  },
  PICK: {
    stripe: "bg-[#d4af37]/85",   badgeText: "text-[#d4af37]",
    metaText: "text-[#fde68a]/80",
    bg: "bg-[#d4af37]/15",       hoverBg: "hover:bg-[#d4af37]/25",
    border: "border-[#d4af37]/45",
  },
};

function DraftPickCell({
  pick, round, pickInRound, width, height, onPlayerClick,
}: {
  pick: ADPResult | null;
  round: number;
  pickInRound: number;
  width: number;
  height: number;
  onPlayerClick?: (row: ADPResult) => void;
}) {
  const pickLabel = `${round}.${String(pickInRound).padStart(2, "0")}`;

  // Empty future-pick slot — sits in the same gapped grid as filled cells,
  // dark navy body with a muted chevron + pick number.
  if (!pick) {
    return (
      <div
        className="p-px"
        style={{ width, minHeight: height, flexShrink: 0 }}
        data-testid={`board-cell-${round}-${pickInRound}-empty`}
      >
        <div className="w-full h-full rounded-[2px] bg-[#0a1424] flex items-center justify-between px-1.5 border border-white/[0.04]">
          <ChevronRight className="w-3 h-3 text-white/12" />
          <span className="text-[10px] font-semibold tabular-nums text-white/20">
            {pickLabel}
          </span>
        </div>
      </div>
    );
  }

  const accent = BOX_POS_ACCENT[pick.position];
  const isPick = pick.is_rookie_placeholder;
  const posTeam = isPick
    ? "Rookie Pick"
    : `${pick.position}${pick.team ? ` · ${pick.team}` : ""}`;

  return (
    <div
      className="p-px"
      style={{ width, minHeight: height, flexShrink: 0 }}
    >
    <button
      type="button"
      onClick={() => onPlayerClick?.(pick)}
      className={cn(
        "group relative w-full h-full rounded-[2px] border cursor-pointer text-left overflow-hidden",
        "transition-colors duration-150",
        accent.bg,
        accent.hoverBg,
        accent.border,
      )}
      title={`${pickLabel} · ${pick.player_name} · ${pick.position}${pick.positional_rank}`}
      data-testid={`board-cell-${round}-${pickInRound}`}
    >
      {/* Thin position-tinted top stripe — Sleeper's main scan cue. */}
      <div className={cn("absolute inset-x-0 top-0 h-[2px]", accent.stripe)} />

      {/* Top-left: position rank — text only, coloured by pos. */}
      <span
        className={cn(
          "absolute top-[3px] left-1 text-[10px] font-bold uppercase tracking-wider leading-none",
          accent.badgeText,
        )}
        data-testid={`box-posrank-${round}-${pickInRound}`}
      >
        {isPick ? "RP" : `${pick.position}${pick.positional_rank}`}
      </span>

      {/* Top-right: pick number — muted, slightly bumped for scannability. */}
      <span
        className="absolute top-[3px] right-1 text-[10px] font-semibold tabular-nums text-white/40 leading-none"
        data-testid={`box-pick-${round}-${pickInRound}`}
      >
        {pickLabel}
      </span>

      {/* Player name — dominant text element. Single-line truncate; first
           name abbreviated so the tile stays compact. Right padding reserves
           space for the bottom-right headshot so the name never collides
           with the avatar bleed. */}
      <div className="absolute inset-x-1 top-[14px] bottom-[14px] flex items-center pr-[30px]">
        <span
          className="block w-full text-[12px] sm:text-[13px] font-bold text-white leading-[1.1] tracking-tight truncate"
          title={pick.player_name}
        >
          {abbreviateFirstName(pick.player_name)}
        </span>
      </div>

      {/* Bottom-left: pos · team — small + muted, lightly position-tinted. */}
      <span
        className={cn(
          "absolute bottom-[3px] left-1 text-[9px] font-semibold uppercase tracking-wider leading-none truncate max-w-[60%]",
          accent.metaText,
        )}
      >
        {posTeam}
      </span>

      {/* Bottom-right: headshot. Smaller than before (28px) and anchored
           tight to the bottom-right corner. The outer `overflow-hidden`
           clips any bleed. */}
      <div className="absolute bottom-0.5 right-0.5">
        <PlayerImageCircle
          playerId={pick.player_id}
          name={pick.player_name}
          team={pick.team}
          isPick={isPick}
        />
      </div>
    </button>
    </div>
  );
}

/** Small circular player headshot anchored at the bottom-right of the cell. */
function PlayerImageCircle({
  playerId, name, isPick,
}: {
  playerId: string;
  name: string;
  team: string;
  isPick: boolean;
}) {
  const [imgErr, setImgErr] = useState(false);
  const looksLikeSleeperId = /^\d+$/.test(playerId);
  const showImage = looksLikeSleeperId && !imgErr && !isPick;

  return (
    <div
      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-[#0a1424] flex items-center justify-center"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
    >
      {isPick ? (
        <Hexagon className="w-3.5 h-3.5 text-white/40" strokeWidth={2} />
      ) : showImage ? (
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span className="text-[9px] font-bold text-white/65">
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

// ── Round Board View (rookie tab) ─────────────────────────────────────────
// Simpler rookie-board layout: one row per round, each pick rendered as a
// compact card showing slot number, player/placeholder name, position/team,
// ADP, draft count. Picks within a round flow left-to-right (rookie drafts
// are typically snake but reading order matches the natural pick sequence —
// the slot column tells you the team). Sorted by avg_pick ascending so the
// first card in each round is the earliest pick on average.
function RoundBoardView({ rows, teams, onPlayerClick }: { rows: ADPResult[]; teams: number; onPlayerClick?: (row: ADPResult) => void }) {
  const grouped = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.avg_pick - b.avg_pick);
    const byRound = new Map<number, ADPResult[]>();
    sorted.forEach((r, idx) => {
      const seq = idx + 1;
      const round = Math.ceil(seq / Math.max(teams, 1));
      if (round > MAX_ROUNDS_SHOWN) return;
      const arr = byRound.get(round) ?? [];
      arr.push(r);
      byRound.set(round, arr);
    });
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows, teams]);

  if (grouped.length === 0) return null;

  return (
    <Card className="overflow-hidden border-white/8 bg-[#070f1c]">
      <div className="px-3 py-1.5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="w-3.5 h-3.5 text-[#d4af37]" />
          <h3 className="text-[13px] font-bold text-white">Rookie Round Board</h3>
          <span className="text-[10px] text-white/40 truncate">{teams}-team · {grouped.length} {grouped.length === 1 ? "round" : "rounds"}</span>
        </div>
        <HexLegend />
      </div>
      <div className="divide-y divide-white/5">
        {grouped.map(([round, picks]) => (
          <div key={round} className="px-3 py-2" data-testid={`round-board-round-${round}`}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d4af37]">Round {round}</span>
              <span className="text-[9px] text-white/35">{picks.length} {picks.length === 1 ? "pick" : "picks"}</span>
            </div>
            <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
              {picks.map((p, idx) => (
                <RoundBoardCard key={`${round}-${p.player_id}`} pick={p} slot={idx + 1} round={round} onClick={() => onPlayerClick?.(p)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RoundBoardCard({ pick, slot, round, onClick }: { pick: ADPResult; slot: number; round: number; onClick?: () => void }) {
  const accent = BOX_POS_ACCENT[pick.position];
  const isPick = pick.is_rookie_placeholder;
  const posLine = isPick
    ? (pick.rookie_pick_label ? `Rookie Pick · ${pick.rookie_pick_label}` : "Rookie Pick")
    : `${pick.position}${pick.positional_rank}${pick.team ? ` · ${pick.team}` : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-[3px] border overflow-hidden transition-colors duration-150",
        accent.bg, accent.hoverBg, accent.border,
        "px-2 py-1.5",
      )}
      data-testid={`round-board-card-${round}-${slot}`}
    >
      <div className={cn("absolute inset-x-0 top-0 h-[2px]", accent.stripe)} />
      <div className="flex items-center justify-between text-[10px] leading-none">
        <span className={cn("font-bold uppercase tracking-wider", accent.badgeText)}>
          {isPick ? "RP" : `${pick.position}${pick.positional_rank}`}
        </span>
        <span className="font-semibold tabular-nums text-white/40">
          #{slot}
        </span>
      </div>
      <p className="mt-1 text-[12px] font-bold text-white truncate" title={pick.player_name}>
        {abbreviateFirstName(pick.player_name)}
      </p>
      <p className={cn("text-[10px] truncate", accent.metaText)}>{posLine}</p>
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/55">
        <span>ADP <span className="tabular-nums text-white/80">{pick.avg_pick.toFixed(1)}</span></span>
        <span className="tabular-nums">{pick.draft_count} {pick.draft_count === 1 ? "draft" : "drafts"}</span>
      </div>
    </button>
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

function HexView({ rows, teams, draftFormat, filters, onPlayerClick }: { rows: ADPResult[]; teams: number; draftFormat: DraftFilters["draftFormat"]; filters: DraftFilters; onPlayerClick?: (row: ADPResult) => void }) {
  const draftLabel = formatDraftLabel(filters);
  // Tile sizing is driven by CSS variables set on the board wrapper with
  // responsive Tailwind classes — see the `[--hex-w:..]` arbitrary-property
  // utilities below. Heights derive from W·2/√3 (pointy-top hex math) and
  // are pre-baked at each breakpoint to avoid runtime calc():
  //
  //   <430px (very small): 76 / 88
  //    430–639 (mobile):   88 / 102
  //    640–767 (tablet):   110 / 127
  //    768+ (desktop):     144 / 166

  // Position filter — defaults to all selected. Toggling a legend pill hides
  // hexes of that position WITHOUT collapsing the layout: the slot still
  // exists, it just renders as the empty placeholder so pick numbers
  // (1.01, 1.02, ...) stay anchored to the original ADP positions.
  const [selectedPositions, setSelectedPositions] = useState<Set<LegendKey>>(
    () => new Set<LegendKey>(["QB", "RB", "WR", "TE", "PICK"]),
  );
  const togglePosition = (key: LegendKey) => {
    setSelectedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Group rows into rounds, placing each at its (round, slot) coordinate
  // derived from sequential ADP ordering. Each round row is exactly `teams`
  // slots wide; empty slots get a placeholder tile so the visual layout
  // always reflects the draft size setting (12 slots when teams=12, etc.).
  // Anything beyond MAX_ROUNDS_SHOWN is dropped to keep the grid bounded.
  //
  // When the draftFormat filter is "snake", even rounds reverse direction
  // so the board reads exactly like a startup draft replay (matches
  // BoxView). For "linear"/"auction"/"all", picks fill left-to-right every
  // round.
  const isSnake = draftFormat === "snake";
  const grouped = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.avg_pick - b.avg_pick);
    const byRound = new Map<number, Array<ADPResult | null>>();
    sorted.forEach((r, idx) => {
      const seq = idx + 1;
      const round = Math.ceil(seq / teams);
      if (round > MAX_ROUNDS_SHOWN) return;
      const pickInRound = ((seq - 1) % teams) + 1;
      const slot = isSnake && round % 2 === 0 ? teams - pickInRound + 1 : pickInRound;
      if (!byRound.has(round)) byRound.set(round, Array.from({ length: teams }, () => null));
      byRound.get(round)![slot - 1] = r;
    });
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows, teams, isSnake]);

  return (
    <Card className="overflow-hidden border-white/8 bg-[#070f1c]">
      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <Hexagon className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
          <h3 className="text-sm font-bold text-white tracking-wide uppercase">Draft Board</h3>
          <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-[9px] font-bold uppercase tracking-wider text-white/50">
            {teams}-team
          </span>
        </div>
        <HexLegend selected={selectedPositions} onToggle={togglePosition} />
      </div>

      {draftLabel && (
        <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
            Draft Type
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#d4af37] text-[11px] font-bold tabular-nums"
            data-testid="hex-draft-label"
          >
            {draftLabel}
          </span>
        </div>
      )}

      {/* ── Board canvas ──────────────────────────────────────────────────── */}
      <div
        className="relative overflow-x-auto overflow-y-hidden snap-x snap-proximity pb-3 md:pb-0"
        style={{ WebkitOverflowScrolling: "touch", scrollBehavior: "smooth" }}
      >
        <div
          className={cn(
            "relative inline-block py-3 md:py-5 pl-1 pr-6 [min-width:max-content]",
            // Hex dimensions per breakpoint (W / H pre-baked from W·2/√3).
            "[--hex-w:88px] [--hex-h:102px]",
            "max-[430px]:[--hex-w:76px] max-[430px]:[--hex-h:88px]",
            "sm:[--hex-w:110px] sm:[--hex-h:127px]",
            "md:[--hex-w:144px] md:[--hex-h:166px]",
          )}
        >
          {grouped.map(([round, slots], rowIdx) => (
            <HexRow
              key={round}
              round={round}
              slots={slots}
              rowIdx={rowIdx}
              onPlayerClick={onPlayerClick}
              selectedPositions={selectedPositions}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function HexRow({
  round, slots, rowIdx, onPlayerClick, selectedPositions,
}: {
  round: number;
  slots: Array<ADPResult | null>;
  rowIdx: number;
  onPlayerClick?: (row: ADPResult) => void;
  /** Positions currently shown. Anything else renders as an empty slot,
   *  preserving pick-number alignment across the board. */
  selectedPositions?: Set<LegendKey>;
}) {
  const isOffsetRow = rowIdx % 2 === 1;
  // Translate a player's position to the legend key set we filter by.
  // K is not in the legend, so it's always visible.
  const isVisible = (p: ADPResult): boolean => {
    if (!selectedPositions) return true;
    const key: LegendKey | "K" = p.is_rookie_placeholder ? "PICK" : p.position;
    if (key === "K") return true;
    return selectedPositions.has(key);
  };
  return (
    <div
      className="flex items-start relative"
      style={{
        marginTop: rowIdx === 0 ? 0 : "calc(var(--hex-h) * -0.25)",
      }}
    >
      {/* Sticky round label — narrower on mobile so it doesn't eat the row. */}
      <div
        className="sticky left-0 z-20 flex-shrink-0 flex items-start pl-1.5 sm:pl-3 md:pl-4 pr-1.5 sm:pr-3 pt-2 md:pt-3 min-w-[44px] sm:min-w-[60px] md:min-w-[68px]"
        style={{
          background: "linear-gradient(to right, rgba(6,12,24,1) 70%, rgba(6,12,24,0))",
        }}
      >
        <div
          className={cn(
            "inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 md:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold whitespace-nowrap border tabular-nums",
            round === 1
              ? "bg-[#d4af37]/15 border-[#d4af37]/45 text-[#d4af37] shadow-[0_0_12px_-2px_rgba(212,175,55,0.5)]"
              : "bg-white/[0.04] border-white/15 text-white/75",
          )}
        >
          <span className="text-[7px] sm:text-[8px] opacity-60">RD</span>
          <span>{String(round).padStart(2, "0")}</span>
        </div>
      </div>

      <div
        className="flex flex-nowrap"
        style={{ paddingLeft: isOffsetRow ? "calc(var(--hex-w) * 0.5)" : 0 }}
      >
        {slots.map((p, i) => (
          p && isVisible(p)
            ? <HexTile key={`${round}-${i}-${p.player_id}`} row={p} round={round} pickInRound={i + 1} onClick={onPlayerClick} />
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
      className="relative snap-start"
      style={{ width: "var(--hex-w)", height: "var(--hex-h)", flexShrink: 0 }}
    >
      <div
        className="absolute inset-[3px]"
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

// Small position-color map used for the position badge text/border AND the
// soft position-tinted hex shell. Kept understated — a wash, not a paint.
const HEX_BADGE_COLOR: Record<Position, { text: string; border: string }> = {
  QB:   { text: "text-rose-300",    border: "border-rose-500/40"    },
  RB:   { text: "text-emerald-300", border: "border-emerald-500/40" },
  WR:   { text: "text-sky-300",     border: "border-sky-500/40"     },
  TE:   { text: "text-amber-300",   border: "border-amber-500/40"   },
  K:    { text: "text-purple-300",  border: "border-purple-500/40"  },
  PICK: { text: "text-[#d4af37]",   border: "border-[#d4af37]/40"   },
};

// Soft position tint layered over the dark hex base + a subtle position-
// coloured border. Same colour family as the badge, lower opacity. The
// `hoverTint` / `hoverBorder` / `glow` set lights the position colour up
// when the user mouses over the tile.
const HEX_POS_SHELL: Record<Position, {
  tint: string; border: string;
  hoverTint: string; hoverBorder: string; glow: string;
}> = {
  QB:   {
    tint: "rgba(244, 63, 94, 0.12)",   border: "rgba(244, 63, 94, 0.28)",
    hoverTint: "rgba(244, 63, 94, 0.28)", hoverBorder: "rgba(244, 63, 94, 0.85)",
    glow: "rgba(244, 63, 94, 0.45)",
  },
  RB:   {
    tint: "rgba(16, 185, 129, 0.12)",  border: "rgba(16, 185, 129, 0.28)",
    hoverTint: "rgba(16, 185, 129, 0.28)", hoverBorder: "rgba(16, 185, 129, 0.85)",
    glow: "rgba(16, 185, 129, 0.45)",
  },
  WR:   {
    tint: "rgba(14, 165, 233, 0.12)",  border: "rgba(14, 165, 233, 0.28)",
    hoverTint: "rgba(14, 165, 233, 0.28)", hoverBorder: "rgba(14, 165, 233, 0.85)",
    glow: "rgba(14, 165, 233, 0.45)",
  },
  TE:   {
    tint: "rgba(245, 158, 11, 0.12)",  border: "rgba(245, 158, 11, 0.28)",
    hoverTint: "rgba(245, 158, 11, 0.28)", hoverBorder: "rgba(245, 158, 11, 0.85)",
    glow: "rgba(245, 158, 11, 0.45)",
  },
  K:    {
    tint: "rgba(168, 85, 247, 0.12)",  border: "rgba(168, 85, 247, 0.28)",
    hoverTint: "rgba(168, 85, 247, 0.28)", hoverBorder: "rgba(168, 85, 247, 0.85)",
    glow: "rgba(168, 85, 247, 0.45)",
  },
  PICK: {
    tint: "rgba(212, 175, 55, 0.14)",  border: "rgba(212, 175, 55, 0.32)",
    hoverTint: "rgba(212, 175, 55, 0.32)", hoverBorder: "rgba(212, 175, 55, 0.9)",
    glow: "rgba(212, 175, 55, 0.55)",
  },
};

function HexTile({ row, round, pickInRound, onClick }: { row: ADPResult; round: number; pickInRound: number; onClick?: (row: ADPResult) => void }) {
  const theme = HEX_POS_THEME[row.position];
  const isPick = row.is_rookie_placeholder;
  const badge = HEX_BADGE_COLOR[row.position];
  const shellColor = HEX_POS_SHELL[row.position];
  const pickLabel = `${round}.${String(pickInRound).padStart(2, "0")}`;

  return (
    // Outer wrapper is NOT clipped — so the hover panel can render outside
    // the hexagon bounds. The clipping lives one level in.
    <div
      className="relative group cursor-pointer hover:z-30 snap-start [touch-action:manipulation]"
      style={{ width: "var(--hex-w)", height: "var(--hex-h)", flexShrink: 0 }}
      data-testid={`hex-${row.player_id}`}
      onClick={() => onClick?.(row)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(row); } : undefined}
    >
      {/* Position-tinted hex shell — dark base + soft positional wash and
           border. Inset a few px inside the layout cell so each tile has a
           small transparent gap around it (snake-layout math sits on the
           outer cell, not on the visible shell). */}
      <div
        className="absolute inset-[3px] transition-colors duration-150"
        style={{
          clipPath: HEX_CLIP,
          background: `linear-gradient(${shellColor.tint}, ${shellColor.tint}), #0e1828`,
          boxShadow: `inset 0 0 0 1px ${shellColor.border}`,
        }}
      />
      {/* Hover overlay — same hex clip, stronger position-coloured wash +
           bright border + soft outer glow. Fades in on group-hover. */}
      <div
        className="absolute inset-[3px] transition-opacity duration-200 opacity-0 group-hover:opacity-100 pointer-events-none"
        style={{
          clipPath: HEX_CLIP,
          background: `linear-gradient(${shellColor.hoverTint}, ${shellColor.hoverTint})`,
          boxShadow: `inset 0 0 0 1.5px ${shellColor.hoverBorder}, inset 0 0 14px ${shellColor.glow}`,
        }}
      />

      {/* ── Content stack ────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex flex-col items-center px-1.5 sm:px-2 pt-[14%] sm:pt-[16%] pb-[6%]">
        {/* Position rank — centered above the player image. */}
        <span
          className={cn(
            "px-1 sm:px-1.5 py-px rounded border text-[9px] sm:text-[10px] font-bold uppercase tracking-wider leading-none",
            badge.text,
            badge.border,
            "bg-white/[0.03]",
          )}
          data-testid={`hex-posrank-${row.player_id}`}
        >
          {isPick ? "RP" : `${row.position}${row.positional_rank}`}
        </span>

        {/* Player image — slightly smaller, centered below the rank, with a
             faint team-logo watermark bleeding around the edges (matches the
             Compare Players card treatment). */}
        <div className="relative mt-1 flex items-center justify-center">
          {!isPick && row.team && (
            <img
              src={`https://sleepercdn.com/images/team_logos/nfl/${row.team.toLowerCase()}.png`}
              alt=""
              aria-hidden="true"
              className="absolute w-[80px] h-[80px] sm:w-[110px] sm:h-[110px] md:w-[120px] md:h-[120px] object-contain opacity-[0.14] pointer-events-none"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          {isPick ? (
            <PickGlyph label={row.rookie_pick_label} />
          ) : (
            <PlayerHeadshotHex playerId={row.player_id} name={row.player_name} />
          )}
        </div>

        {/* Name + team abbreviation, tight stack directly below the image. */}
        <div className="w-full text-center mt-1 leading-none">
          <div
            className="text-[10px] sm:text-[11px] md:text-[12px] font-semibold text-white/90 leading-[1.1] line-clamp-1 tracking-tight px-0.5"
            data-testid={`hex-name-${row.player_id}`}
          >
            {shortenName(row.player_name)}
          </div>
          {row.team && (
            <div
              className="hidden sm:block text-[9px] font-semibold tabular-nums text-white/45 mt-0.5 uppercase tracking-wider"
              data-testid={`hex-team-${row.player_id}`}
            >
              {row.team}
            </div>
          )}
          <div
            className="text-[8px] sm:text-[9px] font-bold tabular-nums text-white/35 mt-0.5"
            data-testid={`hex-pick-${row.player_id}`}
          >
            {pickLabel}
          </div>
        </div>
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
  playerId, name,
}: {
  playerId: string;
  name: string;
}) {
  const [errored, setErrored] = useState(false);
  const looksLikeSleeperId = /^\d+$/.test(playerId);
  const showImage = looksLikeSleeperId && !errored;

  return (
    <div
      className="relative w-[42px] h-[48px] max-[430px]:w-[36px] max-[430px]:h-[42px] sm:w-[50px] sm:h-[58px] md:w-[58px] md:h-[66px] rounded-md overflow-hidden bg-white/[0.04] flex items-center justify-center"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
    >
      {showImage ? (
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="text-xs sm:text-sm font-bold text-white/70">
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

/** Rookie-pick placeholder — neutral rectangular tile matching the headshot. */
function PickGlyph({ label }: { label?: string | null }) {
  return (
    <div
      className="relative w-[42px] h-[48px] max-[430px]:w-[36px] max-[430px]:h-[42px] sm:w-[50px] sm:h-[58px] md:w-[58px] md:h-[66px] rounded-md flex items-center justify-center bg-white/[0.04]"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
    >
      <Hexagon className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-white/40" strokeWidth={2} />
      {label && (
        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider whitespace-nowrap bg-black/40 text-white/65 leading-none">
          {label.replace(/^\d{4}\s+Rookie\s+/i, "")}
        </span>
      )}
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

type LegendKey = keyof typeof HEX_BADGE_COLOR;
const LEGEND_ENTRIES: Array<[string, LegendKey]> = [
  ["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["RP", "PICK"],
];

function HexLegend({
  selected, onToggle,
}: {
  /** When provided, pills become toggleable. Default: all selected (static display). */
  selected?: Set<LegendKey>;
  onToggle?: (key: LegendKey) => void;
} = {}) {
  const interactive = !!(selected && onToggle);
  return (
    <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
      {LEGEND_ENTRIES.map(([label, key]) => {
        const b = HEX_BADGE_COLOR[key];
        const isOn = !interactive || selected!.has(key);
        const baseCls = "px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider transition-opacity";
        if (!interactive) {
          return (
            <span
              key={label}
              className={cn(baseCls, "bg-white/[0.02]", b.text, b.border)}
            >
              {label}
            </span>
          );
        }
        return (
          <button
            key={label}
            type="button"
            onClick={() => onToggle!(key)}
            aria-pressed={isOn}
            className={cn(
              baseCls,
              "cursor-pointer",
              isOn
                ? cn("bg-white/[0.04]", b.text, b.border)
                : "bg-transparent border-white/15 text-white/30 line-through decoration-1",
            )}
            data-testid={`hex-legend-${key.toLowerCase()}`}
          >
            {label}
          </button>
        );
      })}
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
  open, onOpenChange, filters, update, onReset, topTab,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filters: DraftFilters;
  update: <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => void;
  onReset: () => void;
  topTab: DraftTopTab;
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

          {/* Picks / Rookies filter group removed — both Startup and Rookie
              tabs are locked to Direct Rookies. See header-bar comment. */}

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
function LoadingState({ onCancel }: { onCancel?: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-20 border-border/60 dark:border-[#1a2d4a]/80">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin text-[#d4af37]" />
        <span>Loading ADP…</span>
      </div>
      {onCancel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-7 px-2.5 text-xs"
          data-testid="button-cancel-adp-scan"
        >
          <X className="w-3 h-3 mr-1" />
          Cancel
        </Button>
      )}
    </Card>
  );
}

function CancelledState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center py-16 px-6 text-center border-border/60 dark:border-[#1a2d4a]/80" data-testid="adp-cancelled-state">
      <X className="w-8 h-8 text-muted-foreground mb-2" />
      <h3 className="text-sm font-bold mb-1">Scan cancelled</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-3">
        You stopped the ADP fetch. Adjust filters or retry below.
      </p>
      <Button
        size="sm"
        onClick={onRetry}
        className="h-7 px-3 text-xs bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
        data-testid="button-retry-adp-scan"
      >
        <RefreshCw className="w-3 h-3 mr-1" />
        Retry
      </Button>
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
// Allowlist for ADP Explorer display. Anything outside this set should never
// reach the screen — backend is the primary defense (IDP-containing drafts
// are excluded at ingest), but a stray defensive row in cached snapshots
// would still leak through without this filter.
const ALLOWED_DISPLAY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "PICK"]);

function filterAdp(all: ADPResult[], filters: DraftFilters): ADPResult[] {
  const q = filters.search.trim().toLowerCase();
  // Direct Rookies must never render kicker rows. Sleeper rookie drafts
  // often use real-named kickers as future-pick placeholders and ingest-
  // time heuristics don't catch every case; the cleanest UX is to drop K
  // rows whenever rookieMode === "direct", regardless of draftType. The
  // server applies the same rule (see buildDraftWhere in server/adp.ts).
  const dropKickers = filters.rookieMode === "direct";
  // Startup-tab Rookie Picks: K rows from startup-labelled placeholder
  // drafts are NOT flagged is_rookie_placeholder at ingest (the
  // detectKickerPlaceholderDraft heuristic skips startups). The backend
  // surfaces those K rows under picks mode; the frontend must let them
  // through here even though the placeholder flag is false.
  const allowKAsPlaceholder =
    filters.rookieMode === "picks" && filters.draftType === "startup";
  return all.filter((r) => {
    // Frontend defensive guardrail. Backend drops IDP-containing drafts at
    // ingest, but if a cached snapshot still references a defensive player
    // (e.g. before the reclassify job ran) we still don't want to render it.
    if (!ALLOWED_DISPLAY_POSITIONS.has(r.position)) return false;
    if (filters.rookieMode === "picks" && !r.is_rookie_placeholder) {
      if (!(allowKAsPlaceholder && r.position === "K")) return false;
    }
    if (filters.rookieMode === "direct" &&  r.is_rookie_placeholder) return false;
    if (dropKickers && r.position === "K") return false;
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

function shortenName(name: string): string {
  // For hex tiles, abbreviate first name to initial when full name doesn't fit.
  if (name.length <= 14) return name;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * Always abbreviate the first name to an initial, e.g.
 *   "Justin Jefferson"          → "J. Jefferson"
 *   "Marvin Harrison Jr."       → "M. Harrison Jr."
 *   "CeeDee"                    → "CeeDee"  (single token, no change)
 *
 * Used by the Box View where every tile renders the name on a single line.
 */
function abbreviateFirstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0];
  if (!first) return name;
  return `${first[0]}. ${parts.slice(1).join(" ")}`;
}
