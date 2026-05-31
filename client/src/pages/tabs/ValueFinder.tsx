import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ValueFinderPlayer,
  ValueFinderFilters as Filters,
} from "@/lib/value-finder/types";
import { getValueFinderPlayers } from "@/lib/value-finder/mockPlayers";
import {
  enrichPlayers,
  filterPlayers,
  computeSummary,
  hasMarketValues,
} from "@/lib/value-finder/enrich";
import { getValueSignal } from "@/lib/value-finder/valueFinderScoring";
import { getMarketTrend, getRoleTrend, getProductionTrend } from "@/lib/value-finder/trends";
import {
  fmtValue,
  fmtSignedPct,
  fmtPpg,
  fmtPct,
  fmtScore,
  fmtAge,
} from "@/lib/value-finder/format";

import { ValueFinderHeader } from "@/components/value-finder/ValueFinderHeader";
import { ValueFinderFilters } from "@/components/value-finder/ValueFinderFilters";
import { HowToReadCard } from "@/components/value-finder/HowToReadCard";
import { ValueSignalBadge } from "@/components/value-finder/ValueSignalBadge";
import { ValueLabelBadge } from "@/components/value-finder/ValueLabelBadge";
import {
  ValueFinderTable,
  PlayerNameCell,
  type VFColumn,
} from "@/components/value-finder/ValueFinderTable";
import { MarketGapChart, type GapView } from "@/components/value-finder/MarketGapChart";
import { ProductionBuysChart } from "@/components/value-finder/ProductionBuysChart";
import { UsageBuysChart } from "@/components/value-finder/UsageBuysChart";
import { TrendRadarChart } from "@/components/value-finder/TrendRadarChart";
import { WinNowDiscountsChart } from "@/components/value-finder/WinNowDiscountsChart";
import { RebuildTargetsChart } from "@/components/value-finder/RebuildTargetsChart";

type TabId =
  | "market-gaps"
  | "production-buys"
  | "usage-buys"
  | "trend-radar"
  | "win-now"
  | "rebuild";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "market-gaps", label: "Market Gaps" },
  { id: "production-buys", label: "Production Discounts" },
  { id: "usage-buys", label: "Usage Buys" },
  { id: "trend-radar", label: "Trend Radar" },
  { id: "win-now", label: "Win-Now Discounts" },
  { id: "rebuild", label: "Rebuild Targets" },
];

const DEFAULT_FILTERS: Filters = {
  position: "All",
  format: "Superflex",
  season: "2025",
  valueSource: "Dynasty Command",
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
const signalCol = (): VFColumn => ({
  key: "signal",
  header: "Signal",
  align: "right",
  mobile: true,
  cell: (p) => <ValueSignalBadge signal={p.signal} compact />,
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
  const [tab, setTab] = useState<TabId>("market-gaps");
  const [gapView, setGapView] = useState<GapView>("all");

  // Enrich the full pool (cohort percentiles need every player), then filter.
  const { enriched, error } = useMemo(() => {
    try {
      return { enriched: enrichPlayers(getValueFinderPlayers(), filters.valueSource), error: false };
    } catch (e) {
      console.error("[ValueFinder] enrichment failed:", e);
      return { enriched: [] as ValueFinderPlayer[], error: true };
    }
  }, [filters.valueSource]);

  const filtered = useMemo(() => filterPlayers(enriched, filters), [enriched, filters]);
  const summary = useMemo(() => computeSummary(filtered), [filtered]);

  const noMarket = !hasMarketValues(filtered);
  const empty = filtered.length === 0;

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4 pb-12">
        <ValueFinderHeader summary={summary} />
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
      <ValueFinderHeader summary={summary} />
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
          {tab === "market-gaps" && <MarketGapsTab players={filtered} gapView={gapView} setGapView={setGapView} />}
          {tab === "production-buys" && <ProductionBuysTab players={filtered} />}
          {tab === "usage-buys" && <UsageBuysTab players={filtered} />}
          {tab === "trend-radar" && <TrendRadarTab players={filtered} window={filters.trendWindow} />}
          {tab === "win-now" && <WinNowTab players={filtered} />}
          {tab === "rebuild" && <RebuildTab players={filtered} />}
        </>
      )}
    </div>
  );
}

// ── Tab 1: Market Gaps ─────────────────────────────────────────────────────
function MarketGapsTab({
  players,
  gapView,
  setGapView,
}: {
  players: ValueFinderPlayer[];
  gapView: GapView;
  setGapView: (v: GapView) => void;
}) {
  const rows = useMemo(
    () =>
      [...players]
        .map((p) => withSignal(p, p.modelValue))
        .sort((a, b) => Math.abs(b.gapPercent ?? 0) - Math.abs(a.gapPercent ?? 0))
        .slice(0, 25),
    [players],
  );
  const columns: VFColumn[] = [
    playerCol(),
    posCol(),
    ageCol(),
    marketCol(),
    { key: "model", header: "Model", align: "right", cell: (p) => fmtValue(p.modelValue), sortValue: (p) => p.modelValue ?? 0 },
    gapCol(),
    signalCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares player market value against Dynasty Command's internal model.
        Positive gaps may indicate buy-low targets. Negative gaps may indicate sell-high candidates.
      </HowToReadCard>
      <div className="flex gap-1.5">
        {([["all", "All"], ["buys", "Biggest Buys"], ["sells", "Biggest Sells"]] as Array<[GapView, string]>).map(
          ([id, label]) => (
            <button
              key={id}
              onClick={() => setGapView(id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-semibold border",
                gapView === id
                  ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <Panel>
        <MarketGapChart players={players} view={gapView} />
      </Panel>
      <ValueFinderTable
        title="Largest Market Gaps"
        rows={rows}
        columns={columns}
        defaultSortKey="gap"
        testId="vf-table-market-gaps"
        emptyText="Not enough data to rank market gaps."
      />
    </div>
  );
}

// ── Tab 2: Production Buys ──────────────────────────────────────────────────
function ProductionBuysTab({ players }: { players: ValueFinderPlayer[] }) {
  const rows = useMemo(() => players.map((p) => withSignal(p, p.expectedValue)), [players]);
  const buys = rows.filter((p) => (p.gapPercent ?? 0) > 0).sort((a, b) => (b.gapPercent ?? 0) - (a.gapPercent ?? 0)).slice(0, 12);
  const sells = rows.filter((p) => (p.gapPercent ?? 0) < 0).sort((a, b) => (a.gapPercent ?? 0) - (b.gapPercent ?? 0)).slice(0, 12);

  const columns: VFColumn[] = [
    playerCol(),
    posCol(),
    ageCol(),
    { key: "ppg", header: "PPG", align: "right", cell: (p) => fmtPpg(p.pointsPerGame), sortValue: (p) => p.pointsPerGame ?? 0 },
    marketCol(),
    { key: "expected", header: "Expected", align: "right", cell: (p) => fmtValue(p.expectedValue), sortValue: (p) => p.expectedValue ?? 0 },
    gapCol(),
    signalCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares fantasy production against dynasty market value. Players producing more
        than their price suggests may be buy-low targets. Players priced above their production profile
        may be sell-high candidates.
      </HowToReadCard>
      <Panel>
        <ProductionBuysChart players={players} />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ValueFinderTable title="Production-Based Buys" rows={buys} columns={columns} defaultSortKey="gap" testId="vf-table-prod-buys" emptyText="No production-based buys in this filter set." />
        <ValueFinderTable title="Production-Based Sells" rows={sells} columns={columns} defaultSortKey="gap" defaultSortDir="asc" testId="vf-table-prod-sells" emptyText="No production-based sells in this filter set." />
      </div>
    </div>
  );
}

// ── Tab 3: Usage Buys ───────────────────────────────────────────────────────
function UsageBuysTab({
  players,
  usageExpected,
}: {
  players: ValueFinderPlayer[];
  usageExpected: Map<string, number>;
}) {
  const rows = useMemo(
    () => players.map((p) => withSignal(p, usageExpected.get(p.playerId))),
    [players, usageExpected],
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
  const buyColumns: VFColumn[] = [
    playerCol(), posCol(), ageCol(), usageCol, marketCol(),
    { key: "expected", header: "Expected", align: "right", cell: (p) => fmtValue(usageExpected.get(p.playerId)), sortValue: (p) => usageExpected.get(p.playerId) ?? 0 },
    gapCol(), signalCol(),
  ];
  const sellColumns: VFColumn[] = [playerCol(), posCol(), ageCol(), usageCol, marketCol(), gapCol(), signalCol()];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares player usage and role strength against market value. Strong usage at a low
        price may signal a buy window before production fully catches up.
      </HowToReadCard>
      <Panel>
        <UsageBuysChart players={players} usageExpected={usageExpected} />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ValueFinderTable title="Usage-Based Buys" rows={buys} columns={buyColumns} defaultSortKey="gap" testId="vf-table-usage-buys" emptyText="No usage-based buys in this filter set." />
        <ValueFinderTable title="Role-Based Sells" rows={sells} columns={sellColumns} defaultSortKey="gap" defaultSortDir="asc" testId="vf-table-usage-sells" emptyText="No role-based sells in this filter set." />
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
    signalCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This chart compares market movement against role and production trends. Hidden risers may be
        gaining opportunity before their value reacts. Hype risers may be gaining value without enough
        role improvement.
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

// ── Tab 5: Win-Now Discounts ────────────────────────────────────────────────
function WinNowTab({ players }: { players: ValueFinderPlayer[] }) {
  const rows = useMemo(
    () =>
      players
        .map((p) => withSignal(p, p.contenderValue))
        .sort((a, b) => (b.gapPercent ?? 0) - (a.gapPercent ?? 0))
        .slice(0, 20),
    [players],
  );
  const columns: VFColumn[] = [
    playerCol(),
    posCol(),
    ageCol(),
    { key: "ppg", header: "PPG", align: "right", mobile: true, cell: (p) => fmtPpg(p.pointsPerGame), sortValue: (p) => p.pointsPerGame ?? 0 },
    { key: "start", header: "Start", align: "right", cell: (p) => fmtPct((p.startRate ?? 0) / 100), sortValue: (p) => p.startRate ?? 0 },
    marketCol(),
    { key: "contender", header: "Contender", align: "right", cell: (p) => fmtValue(p.contenderValue), sortValue: (p) => p.contenderValue ?? 0 },
    gapCol(),
    signalCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This view is built for contenders. It highlights players whose short-term production,
        startability, and role are stronger than their dynasty market value.
      </HowToReadCard>
      <Panel>
        <WinNowDiscountsChart players={players} />
      </Panel>
      <ValueFinderTable title="Best Win-Now Discounts" rows={rows} columns={columns} defaultSortKey="gap" testId="vf-table-win-now" emptyText="Not enough data to rank win-now discounts." />
    </div>
  );
}

// ── Tab 6: Rebuild Targets ──────────────────────────────────────────────────
function RebuildTab({ players }: { players: ValueFinderPlayer[] }) {
  const rows = useMemo(
    () =>
      players
        .map((p) => withSignal(p, p.rebuilderValue))
        .sort((a, b) => (b.gapPercent ?? 0) - (a.gapPercent ?? 0))
        .slice(0, 20),
    [players],
  );
  const columns: VFColumn[] = [
    playerCol(),
    posCol(),
    { key: "age", header: "Age", align: "right", mobile: true, cell: (p) => fmtAge(p.age), sortValue: (p) => p.age ?? 0 },
    { key: "utrend", header: "Usage Trend", align: "right", cell: (p) => <TrendNum v={p.usageTrend ?? 0} />, sortValue: (p) => p.usageTrend ?? 0 },
    marketCol(),
    { key: "rebuilder", header: "Rebuilder", align: "right", cell: (p) => fmtValue(p.rebuilderValue), sortValue: (p) => p.rebuilderValue ?? 0 },
    gapCol(),
    signalCol(),
  ];

  return (
    <div className="space-y-3">
      <HowToReadCard defaultOpen>
        This view is built for rebuilders. It highlights younger players and future-focused assets
        whose long-term profile may be stronger than their current market price.
      </HowToReadCard>
      <Panel>
        <RebuildTargetsChart players={players} />
      </Panel>
      <ValueFinderTable title="Best Rebuild Targets" rows={rows} columns={columns} defaultSortKey="gap" testId="vf-table-rebuild" emptyText="Not enough data to rank rebuild targets." />
    </div>
  );
}

export default ValueFinder;
