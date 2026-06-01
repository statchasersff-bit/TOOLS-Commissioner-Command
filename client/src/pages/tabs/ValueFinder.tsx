import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ValueFinderPlayer,
  ValueFinderFilters as Filters,
} from "@/lib/value-finder/types";
import { getValueFinderPlayers as getMockValueFinderPlayers } from "@/lib/value-finder/mockPlayers";
import { useValueFinderPlayers } from "@/lib/value-finder/loadPlayers";
import {
  enrichPlayers,
  filterPlayers,
  hasMarketValues,
} from "@/lib/value-finder/enrich";
import { getValueSignal } from "@/lib/value-finder/valueFinderScoring";
import { getMarketTrend, getRoleTrend, getProductionTrend } from "@/lib/value-finder/trends";
import {
  fmtValue,
  fmtSignedPct,
  fmtPpg,
  fmtScore,
  fmtAge,
} from "@/lib/value-finder/format";

import { ValueFinderFilters } from "@/components/value-finder/ValueFinderFilters";
import { HowToReadCard } from "@/components/value-finder/HowToReadCard";
import { ValueLabelBadge } from "@/components/value-finder/ValueLabelBadge";
import {
  ValueFinderTable,
  PlayerNameCell,
  type VFColumn,
} from "@/components/value-finder/ValueFinderTable";
import { ProductionBuysChart } from "@/components/value-finder/ProductionBuysChart";
import { UsageBuysChart } from "@/components/value-finder/UsageBuysChart";
import { TrendRadarChart } from "@/components/value-finder/TrendRadarChart";
import { MarketInsights } from "@/pages/tabs/MarketInefficiencies";

type TabId =
  | "production-buys"
  | "usage-buys"
  | "trend-radar"
  | "value-vs-production"
  | "market-gap"
  | "age-curve";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "production-buys", label: "Production Discounts" },
  { id: "usage-buys", label: "Usage Buys" },
  { id: "trend-radar", label: "Trend Radar" },
  { id: "value-vs-production", label: "Value vs Production" },
  { id: "market-gap", label: "Market Gap" },
  { id: "age-curve", label: "Age Curve" },
];

// The last three tabs are the relocated Market Inefficiency views; they run on
// their own market data pipeline (see MarketInsights), so they render
// independently of the Value Finder's player fetch.
const MARKET_TAB_VIEW: Partial<Record<TabId, "value" | "gap" | "age">> = {
  "value-vs-production": "value",
  "market-gap": "gap",
  "age-curve": "age",
};

const DEFAULT_FILTERS: Filters = {
  position: "All",
  format: "Superflex",
  season: "2025",
  valueSource: "FantasyCalc",
  ageRange: "All",
  minGamesPlayed: 0,
  search: "",
  trendWindow: "30D",
};

// Attach gap/gapPercent/signal for a given comparison metric.
function withSignal(
  p: ValueFinderPlayer,
  comparison?: number,
): ValueFinderPlayer {
  const sig = getValueSignal({ marketValue: p.marketValue, comparisonValue: comparison });
  return { ...p, gap: sig.gap, gapPercent: sig.gapPercent, signal: sig.signal, tone: sig.tone };
}

// ── Shared cell renderers ─────────────────────────────────────────────────
const GapPctCell = ({ p }: { p: ValueFinderPlayer }) => (
  <span
    className={cn(
      "font-semibold",
      (p.gapPercent ?? 0) >= 0
        ? "text-emerald-600 dark-any:text-emerald-400"
        : "text-red-600 dark-any:text-red-400",
    )}
  >
    {fmtSignedPct(p.gapPercent)}
  </span>
);

const playerCol = (): VFColumn => ({
  key: "player",
  header: "Player",
  mobile: true,
  cell: (p) => <PlayerNameCell p={p} />,
});
const posCol = (): VFColumn => ({ key: "pos", header: "Pos", cell: (p) => p.position });
const ageCol = (): VFColumn => ({
  key: "age",
  header: "Age",
  align: "right",
  cell: (p) => fmtAge(p.age),
  sortValue: (p) => p.age ?? 0,
});
const gapCol = (): VFColumn => ({
  key: "gap",
  header: "Gap %",
  align: "right",
  mobile: true,
  cell: (p) => <GapPctCell p={p} />,
  sortValue: (p) => p.gapPercent ?? 0,
});
const labelCol = (): VFColumn => ({
  key: "label",
  header: "Label",
  align: "right",
  mobile: true,
  cell: (p) => <ValueLabelBadge label={p.finalLabel} />,
});
const bestFitCol = (): VFColumn => ({
  key: "bestfit",
  header: "Best Fit",
  align: "right",
  cell: (p) => p.bestFit ?? "—",
});
const longevityCol = (): VFColumn => ({
  key: "longevity",
  header: "Longevity",
  align: "right",
  cell: (p) => fmtScore(p.longevityScore),
  sortValue: (p) => p.longevityScore ?? 0,
});
const marketCol = (): VFColumn => ({
  key: "market",
  header: "Market",
  align: "right",
  cell: (p) => fmtValue(p.marketValue),
  sortValue: (p) => p.marketValue ?? 0,
});

// ── Tab switcher ──────────────────────────────────────────────────────────
function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-muted/20 border border-border overflow-x-auto">
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
  );
}

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-card/40 p-3">{children}</div>
);

export function ValueFinder() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<TabId>("production-buys");

  // Fetch the real, server-aggregated pool (season + market format drive the
  // join). Falls back to the bundled sample pool if the request fails or
  // returns nothing, so the page never blanks out.
  const playersQuery = useValueFinderPlayers(filters.season, filters.format);

  const loading = playersQuery.isLoading;

  // Enrich the full pool (cohort percentiles need every player), then filter.
  // While the request is in flight we hold off (empty pool) rather than flash
  // the sample data; once it settles we use the real pool, falling back to the
  // bundled sample only if the request failed or returned nothing.
  const { enriched, error } = useMemo(() => {
    if (loading) return { enriched: [] as ValueFinderPlayer[], error: false };
    const pool =
      playersQuery.data && playersQuery.data.length > 0
        ? playersQuery.data
        : getMockValueFinderPlayers();
    try {
      return { enriched: enrichPlayers(pool, filters.valueSource), error: false };
    } catch (e) {
      console.error("[ValueFinder] enrichment failed:", e);
      return { enriched: [] as ValueFinderPlayer[], error: true };
    }
  }, [playersQuery.data, loading, filters.valueSource]);

  const filtered = useMemo(() => filterPlayers(enriched, filters), [enriched, filters]);

  const noMarket = !hasMarketValues(filtered);
  const empty = filtered.length === 0;

  // ── Market Inefficiency tabs ──────────────────────────────────────────────
  // These run on their own market data pipeline (own filters + value source),
  // so they render independently of the Value Finder's player fetch above.
  const marketView = MARKET_TAB_VIEW[tab];
  if (marketView) {
    return (
      <div className="space-y-4 pb-12">
        <TabBar tab={tab} setTab={setTab} />
        <MarketInsights activeTab={marketView} />
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 pb-12">
        <ValueFinderFilters filters={filters} setFilters={setFilters} />
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
          Loading live player values…
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4 pb-12">
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center">
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
            Unable to load Value Finder data. Try refreshing or changing filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <ValueFinderFilters filters={filters} setFilters={setFilters} />
      <TabBar tab={tab} setTab={setTab} />

      {empty ? (
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
          {tab === "trend-radar" && <TrendRadarTab players={filtered} window={filters.trendWindow} />}
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
        This compares fantasy production against market value. A production discount is not
        automatically a dynasty buy — an older player can out-produce his price while still being a
        poor long-term hold. Check the Label and the Win-Now / Rebuild tabs for fit.
      </HowToReadCard>
      <Panel>
        <ProductionBuysChart players={players} />
      </Panel>
    </div>
  );
}

// ── Tab 3: Usage Buys ───────────────────────────────────────────────────────
function UsageBuysTab({ players }: { players: ValueFinderPlayer[] }) {
  const rows = useMemo(
    () => players.map((p) => withSignal(p, p.usageValue)),
    [players],
  );
  const buys = rows.filter((p) => (p.gapPercent ?? 0) > 0 && p.usageScore != null).sort((a, b) => (b.gapPercent ?? 0) - (a.gapPercent ?? 0)).slice(0, 12);
  const sells = rows.filter((p) => (p.gapPercent ?? 0) < 0 && p.usageScore != null).sort((a, b) => (a.gapPercent ?? 0) - (b.gapPercent ?? 0)).slice(0, 12);

  const usageCol: VFColumn = {
    key: "usage",
    header: "Usage",
    align: "right",
    cell: (p) => fmtScore(p.usageScore),
    sortValue: (p) => p.usageScore ?? 0,
  };
  // Player · Age · Usage · Market · Longevity · Best Fit · Label
  const columns: VFColumn[] = [
    playerCol(), posCol(), ageCol(), usageCol, marketCol(),
    longevityCol(), bestFitCol(), labelCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This compares usage / role strength against market value. Strong usage at a low price may signal
        a buy window before production catches up — but a strong role doesn't mean "buy for everyone."
        The Longevity and Best Fit columns separate long-term holds from short-term rentals.
      </HowToReadCard>
      <Panel>
        <UsageBuysChart players={players} />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ValueFinderTable title="Usage-Based Buys" rows={buys} columns={columns} defaultSortKey="gap" testId="vf-table-usage-buys" emptyText="No usage-based buys in this filter set." />
        <ValueFinderTable title="Role-Based Sells" rows={sells} columns={columns} defaultSortKey="gap" defaultSortDir="asc" testId="vf-table-usage-sells" emptyText="No role-based sells in this filter set." />
      </div>
    </div>
  );
}

// ── Tab 4: Trend Radar ──────────────────────────────────────────────────────
function TrendRadarTab({
  players,
  window,
}: {
  players: ValueFinderPlayer[];
  window: Filters["trendWindow"];
}) {
  const rows = useMemo(
    () =>
      players.map((p) => {
        const valueTrend = getMarketTrend(p, window);
        const roleTrend = getRoleTrend(p);
        return { ...withSignal(p, p.modelValue), _value: valueTrend, _role: roleTrend, _prod: getProductionTrend(p) };
      }),
    [players, window],
  );
  // Hidden risers: role up, value flat/down. Hype risers: value up, role flat/down.
  const hidden = rows.filter((r) => r._role > 0 && r._value <= 0).sort((a, b) => b._role - a._role).slice(0, 12);
  const hype = rows.filter((r) => r._value > 0 && r._role <= 0).sort((a, b) => b._value - a._value).slice(0, 12);

  const trendColumns: VFColumn[] = [
    playerCol(),
    posCol(),
    ageCol(),
    { key: "vtrend", header: "Value", align: "right", cell: (p) => <TrendNum v={getMarketTrend(p, window)} /> },
    { key: "rtrend", header: "Role", align: "right", cell: (p) => <TrendNum v={getRoleTrend(p)} /> },
    { key: "ptrend", header: "Prod", align: "right", cell: (p) => <TrendNum v={getProductionTrend(p)} /> },
    longevityCol(),
    bestFitCol(),
    labelCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares market movement against role and production trends. Hidden risers may be
        gaining opportunity before their value reacts. Hype risers may be gaining value without enough
        role improvement. Longevity and Best Fit matter here: a 30-year-old whose role is rising is not
        the same asset as a 22-year-old with the same trend.
      </HowToReadCard>
      <Panel>
        <TrendRadarChart players={players} trendWindow={window} />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ValueFinderTable title="Hidden Risers" rows={hidden} columns={trendColumns} testId="vf-table-hidden-risers" emptyText="No hidden risers in this window." />
        <ValueFinderTable title="Hype Risers" rows={hype} columns={trendColumns} testId="vf-table-hype-risers" emptyText="No hype risers in this window." />
      </div>
    </div>
  );
}

const TrendNum = ({ v }: { v: number }) => (
  <span className={cn("font-semibold", v >= 0 ? "text-emerald-600 dark-any:text-emerald-400" : "text-red-600 dark-any:text-red-400")}>
    {fmtSignedPct(v)}
  </span>
);

export default ValueFinder;
