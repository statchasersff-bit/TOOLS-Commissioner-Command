import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ValueFinderPlayer,
  ValueFinderFilters as Filters,
  AgeRange,
} from "@/lib/value-finder/types";
import {
  useValueFinderPlayers,
  usePositionCompositeScores,
} from "@/lib/value-finder/loadPlayers";
import {
  enrichPlayers,
  filterPlayers,
  hasMarketValues,
} from "@/lib/value-finder/enrich";
import { useValueModel } from "@/contexts/ValueModelContext";
import type {
  MarketFilters,
  AgeRange as MarketAgeRange,
} from "@/lib/market/marketModel";
import { ValueFinderFilters } from "@/components/value-finder/ValueFinderFilters";
import { HowToReadCard } from "@/components/value-finder/HowToReadCard";
import { ProductionBuysChart } from "@/components/value-finder/ProductionBuysChart";
import { UsageBuysChart } from "@/components/value-finder/UsageBuysChart";
import { EfficiencyBuysChart } from "@/components/value-finder/EfficiencyBuysChart";
import { TrendRadarChart } from "@/components/value-finder/TrendRadarChart";
import { MarketInsights, type MarketFormat } from "@/pages/tabs/MarketInefficiencies";

type TabId =
  | "production-buys"
  | "usage-buys"
  | "efficiency-buys"
  | "trend-radar"
  | "value-vs-production"
  | "age-curve";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "production-buys", label: "PPG" },
  { id: "usage-buys", label: "Usage" },
  { id: "efficiency-buys", label: "Efficiency" },
  { id: "trend-radar", label: "Trend" },
  { id: "value-vs-production", label: "Value" },
  { id: "age-curve", label: "Age" },
];

// The trailing tabs are the relocated Market Inefficiency views; they run on
// their own market data pipeline (see MarketInsights), so they render
// independently of the Value Finder's player fetch.
const MARKET_TAB_VIEW: Partial<Record<TabId, "value" | "gap" | "age">> = {
  "value-vs-production": "value",
  "age-curve": "age",
};

const DEFAULT_FILTERS: Filters = {
  position: "All",
  format: "Superflex",
  scoring: "ppr",
  season: "2025",
  valueSource: "FantasyCalc",
  ageRange: "All",
  minGamesPlayed: 0,
  minMarketValue: 0,
  search: "",
  trendWindow: "30D",
};

// The market pipeline (Value vs Production / Age Curve) speaks its own filter
// shape. Translate the shared Value Finder filters into it so both pipelines
// react to the same bar. Age ranges differ only in the "Under 23" id.
const AGE_TO_MARKET: Record<AgeRange, MarketAgeRange> = {
  All: "All",
  "Under 23": "u23",
  "23-25": "23-25",
  "26-28": "26-28",
  "29+": "29+",
};

function toMarketFilters(f: Filters): MarketFilters {
  return {
    position: f.position,
    ageRange: AGE_TO_MARKET[f.ageRange],
    minMarketValue: f.minMarketValue ?? 0,
    minGamesPlayed: f.minGamesPlayed,
    search: f.search,
  };
}

const toMarketFormat = (f: Filters["format"]): MarketFormat => (f === "1QB" ? "1qb" : "sf");

// ── Tab switcher ──────────────────────────────────────────────────────────
// Desktop shows the full segmented button row; on mobile that row turns into a
// horizontal scrollbar, so below sm we swap to a native dropdown instead.
function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <>
      {/* Mobile: dropdown selector */}
      <select
        value={tab}
        onChange={(e) => setTab(e.target.value as TabId)}
        data-testid="vf-tab-select"
        aria-label="Chart view"
        className="sm:hidden w-full h-10 rounded-xl bg-card/40 border border-border px-3 text-[13px] font-semibold text-foreground"
      >
        {TABS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Desktop/tablet: segmented button row */}
      <div className="hidden sm:flex gap-1 p-1 rounded-xl bg-muted/20 border border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`vf-tab-${t.id}`}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] sm:text-[12px] font-semibold transition-colors whitespace-nowrap",
              tab === t.id
                ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-card/40 p-3">{children}</div>
);

export function ValueFinder() {
  const vm = useValueModel();
  // Seed the client-side source from the (possibly persisted) global source so
  // the Source chip and the Value Finder pipeline agree on first paint.
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    valueSource: vm.sourceId === "ktc" ? "KTC" : "FantasyCalc",
  }));
  const [tab, setTab] = useState<TabId>("production-buys");

  // Fetch the real, server-aggregated pool (season + market format drive the
  // join). This is the only source — there is no fake-data fallback, so if the
  // request fails or returns nothing we surface that explicitly rather than
  // showing fabricated players.
  const playersQuery = useValueFinderPlayers(filters.season, filters.format, filters.scoring);
  // Usage + Efficiency scores come from the Position Stats table's composite
  // engines (by Sleeper playerId): the exact same 0–100 Volume and Efficiency
  // grades that table shows. The Usage chart plots the Volume composite; the
  // Efficiency chart plots the Efficiency composite.
  const compositeQuery = usePositionCompositeScores(filters.season);

  const loading = playersQuery.isLoading;

  // Enrich the full real pool (cohort percentiles need every player), then
  // filter. While the request is in flight we hold off (empty pool) rather than
  // flash stale content.
  const { enriched, enrichError } = useMemo(() => {
    const pool = playersQuery.data ?? [];
    if (pool.length === 0) return { enriched: [] as ValueFinderPlayer[], enrichError: false };
    // Overlay the Position Stats composites (Volume → usageScore, Efficiency →
    // efficiencyScore; 0–100 → 0–1) by Sleeper id, so both charts show the exact
    // same grades that table does. A player present in the composite data gets
    // those scores; a player absent from it gets none — and for usage we also
    // clear the raw fields that getUsageScore would otherwise blend into a
    // fallback, so an off-data player can't surface a usage number that disagrees
    // with the table. (Trend fields are left untouched; they drive separate
    // signals.) Until the (bundled) composites resolve, use the pool as-is.
    const compositeMap = compositeQuery.data;
    const pool2 = compositeMap
      ? pool.map((p) => {
          const c = compositeMap[p.playerId];
          if (c != null) {
            return {
              ...p,
              usageScore: c.volumeScore / 100,
              efficiencyScore: c.efficiencyScore / 100,
            };
          }
          return {
            ...p,
            usageScore: undefined,
            efficiencyScore: undefined,
            snapShare: undefined,
            redZoneTouches: undefined,
            redZoneTargets: undefined,
            dropbacks: undefined,
            designedRushAttempts: undefined,
          };
        })
      : pool;
    try {
      return { enriched: enrichPlayers(pool2, filters.valueSource), enrichError: false };
    } catch (e) {
      console.error("[ValueFinder] enrichment failed:", e);
      return { enriched: [] as ValueFinderPlayer[], enrichError: true };
    }
  }, [playersQuery.data, compositeQuery.data, filters.valueSource]);

  const filtered = useMemo(() => filterPlayers(enriched, filters), [enriched, filters]);

  // Upper bound for the Min value slider — derived from the enriched pool so the
  // slider scales to whatever value source is active.
  const maxMarket = useMemo(
    () => enriched.reduce((m, p) => Math.max(m, p.marketValue ?? 0), 0),
    [enriched],
  );

  // The request errored, or it succeeded but the server returned no players —
  // either way there's no real data to show.
  const dataError = playersQuery.isError || enrichError;
  const noData = !loading && !dataError && (playersQuery.data?.length ?? 0) === 0;

  const noMarket = !hasMarketValues(filtered);
  const empty = filtered.length === 0;

  // Source is driven by the global control in the app header (no duplicate
  // control here) — keep the client-side Value Finder source in lockstep with
  // the global value-model source so the enrichment uses the right market feed.
  useEffect(() => {
    setFilters((prev) => {
      const next = vm.sourceId === "ktc" ? "KTC" : "FantasyCalc";
      return prev.valueSource === next ? prev : { ...prev, valueSource: next };
    });
  }, [vm.sourceId]);

  // ── Market Inefficiency tabs ──────────────────────────────────────────────
  // These run on their own market data pipeline but are now driven by the same
  // shared filter bar (translated into the market filter shape).
  const marketView = MARKET_TAB_VIEW[tab];

  return (
    <div className="space-y-4 pb-12">
      <ValueFinderFilters
        filters={filters}
        setFilters={setFilters}
        maxMarket={maxMarket}
      />
      <TabBar tab={tab} setTab={setTab} />

      {marketView ? (
        <MarketInsights
          activeTab={marketView}
          filters={toMarketFilters(filters)}
          format={toMarketFormat(filters.format)}
          season={filters.season}
        />
      ) : loading ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
          Loading live player values…
        </div>
      ) : dataError ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center">
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
            Unable to load live Value Finder data. Try refreshing or changing the season/format.
          </p>
        </div>
      ) : noData ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center">
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
            No live player values are available right now. Please try again shortly.
          </p>
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
          No players match these filters.
        </div>
      ) : noMarket ? (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
          No market values found for this value source. Try another value source or upload custom values.
        </div>
      ) : (
        <>
          {tab === "production-buys" && <ProductionBuysTab players={filtered} />}
          {tab === "usage-buys" && <UsageBuysTab players={filtered} />}
          {tab === "efficiency-buys" && <EfficiencyBuysTab players={filtered} />}
          {tab === "trend-radar" && (
            <TrendRadarTab
              players={filtered}
              window={filters.trendWindow}
              setWindow={(w) => setFilters((prev) => ({ ...prev, trendWindow: w }))}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Tab: Production Discounts ───────────────────────────────────────────────
function ProductionBuysTab({ players }: { players: ValueFinderPlayer[] }) {
  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This compares Fantasy Points scored per game against dynasty market value. An older player
        can out-produce his price while still being a poor long-term hold.
      </HowToReadCard>
      <Panel>
        <ProductionBuysChart players={players} />
      </Panel>
    </div>
  );
}

// ── Tab 3: Usage Buys ───────────────────────────────────────────────────────
function UsageBuysTab({ players }: { players: ValueFinderPlayer[] }) {
  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This compares StatChasers Usage Score against dynasty market value. Strong usage at a low price
        may signal a buy window before production catches up, but a strong role doesn't mean "buy for
        everyone" as player age is important to consider as well.
      </HowToReadCard>
      <Panel>
        <UsageBuysChart players={players} />
      </Panel>
    </div>
  );
}

// ── Tab 4: Efficiency Buys ──────────────────────────────────────────────────
function EfficiencyBuysTab({ players }: { players: ValueFinderPlayer[] }) {
  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This compares StatChasers Efficiency Score against dynasty market value. Strong efficiency at a
        low price may signal a buy window — the player is doing more with his opportunities than the
        market has priced in — but efficiency on light usage can be noisy, so weigh role and age too.
      </HowToReadCard>
      <Panel>
        <EfficiencyBuysChart players={players} />
      </Panel>
    </div>
  );
}

// ── Tab 5: Trend Radar ──────────────────────────────────────────────────────
// The trend window lives here (not in the shared filter bar) since it only
// applies to this view.
const TREND_WINDOWS: Array<Filters["trendWindow"]> = ["7D", "30D", "90D"];

function TrendRadarTab({
  players,
  window,
  setWindow,
}: {
  players: ValueFinderPlayer[];
  window: Filters["trendWindow"];
  setWindow: (w: Filters["trendWindow"]) => void;
}) {
  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares market movement against role and production trends. Hidden risers may be
        gaining opportunity before their value reacts. Hype risers may be gaining value without enough
        role improvement. Longevity and Best Fit matter here: a 30-year-old whose role is rising is not
        the same asset as a 22-year-old with the same trend.
      </HowToReadCard>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-16">Trend</span>
        {TREND_WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            data-testid={`vf-trend-${w}`}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap",
              window === w
                ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {w}
          </button>
        ))}
      </div>
      <Panel>
        <TrendRadarChart players={players} trendWindow={window} />
      </Panel>
    </div>
  );
}

export default ValueFinder;
