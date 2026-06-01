import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, TrendingUp, TrendingDown, Scale, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useValueModel } from "@/contexts/ValueModelContext";
import {
  buildMarketPlayers, applyFilters, computeSummary, relevantPool, ageBucketKey,
  DEFAULT_FILTERS, MARKET_POSITIONS, POSITION_COLORS,
  type MarketFilters, type MarketPlayer, type AgeRange,
} from "@/lib/market/marketModel";
import { getMarketSignal } from "@/lib/market/marketSignals";
import { MarketSignalBadge } from "@/components/market/MarketSignalBadge";
import { MarketInefficiencyTable, type MarketColumn } from "@/components/market/MarketInefficiencyTable";
import { ValueProductionScatter } from "@/components/market/ValueProductionScatter";
import { MarketGapChart, type GapView } from "@/components/market/MarketGapChart";
import { AgeCurveChart } from "@/components/market/AgeCurveChart";

type TabId = "value" | "gap" | "age";
type MarketFormat = "sf" | "1qb";

const fmtNum = (n?: number) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtSignedNum = (n?: number) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}`);
const fmtSignedPct = (n?: number) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

// ── Shared cell renderers ─────────────────────────────────────────────────────
function PlayerCell({ p }: { p: MarketPlayer }) {
  return (
    <div className="flex items-center gap-1.5 text-left">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: POSITION_COLORS[p.position] }} />
      <span className="font-semibold text-foreground truncate max-w-[130px]">{p.playerName}</span>
    </div>
  );
}
function GapCell({ p }: { p: MarketPlayer }) {
  const g = p.gap ?? 0;
  return (
    <span className={cn("font-semibold", g >= 0 ? "text-emerald-600 dark-any:text-emerald-400" : "text-red-600 dark-any:text-red-400")}>
      {fmtSignedNum(g)}<span className="text-muted-foreground font-normal"> ({fmtSignedPct(p.gapPercent)})</span>
    </span>
  );
}

const playerCol = (): MarketColumn => ({ key: "player", header: "Player", mobile: true, cell: (p) => <PlayerCell p={p} /> });
const posCol = (): MarketColumn => ({ key: "pos", header: "Pos", mobile: true, cell: (p) => p.position });
const ageCol = (): MarketColumn => ({ key: "age", header: "Age", mobile: true, align: "right", cell: (p) => p.age ?? "—" });
const gapCol = (): MarketColumn => ({ key: "gap", header: "Gap", mobile: true, align: "right", cell: (p) => <GapCell p={p} /> });
const signalCol = (): MarketColumn => ({ key: "signal", header: "Signal", mobile: true, align: "right", cell: (p) => <MarketSignalBadge signal={p.signal} tone={p.tone} /> });

const VALUE_COLUMNS: MarketColumn[] = [
  playerCol(), posCol(), ageCol(),
  { key: "market", header: "Market", align: "right", cell: (p) => fmtNum(p.marketValue) },
  { key: "prod", header: "Production", align: "right", cell: (p) => fmtNum(p.production) },
  { key: "expected", header: "Expected", align: "right", cell: (p) => fmtNum(p.expectedValue) },
  gapCol(), signalCol(),
];

const GAP_COLUMNS: MarketColumn[] = [
  playerCol(), posCol(), ageCol(),
  { key: "market", header: "Market", align: "right", cell: (p) => fmtNum(p.marketValue) },
  { key: "model", header: "Model", align: "right", cell: (p) => fmtNum(p.modelValue) },
  gapCol(),
  { key: "mrank", header: "Mkt Rk", align: "right", cell: (p) => p.marketRank ?? "—" },
  { key: "morank", header: "Mdl Rk", align: "right", cell: (p) => p.modelRank ?? "—" },
  signalCol(),
];

const AGE_COLUMNS: MarketColumn[] = [
  playerCol(), posCol(), ageCol(),
  { key: "market", header: "Market", align: "right", cell: (p) => fmtNum(p.marketValue) },
  { key: "model", header: "Model", align: "right", cell: (p) => fmtNum(p.modelValue) },
  gapCol(),
  { key: "bucket", header: "Age Band", align: "right", cell: (p) => ageBucketKey(p.age) },
  signalCol(),
];

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, player, accent }: {
  icon: typeof TrendingUp; label: string; player: MarketPlayer | null; accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("w-3.5 h-3.5", accent)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {player ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-bold text-foreground truncate">{player.playerName}</span>
          <span className={cn("text-[13px] font-black tabular-nums", accent)}>{fmtSignedPct(player.gapPercent)}</span>
        </div>
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      )}
    </div>
  );
}

// ── How to read ───────────────────────────────────────────────────────────────
function HowToRead({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        How to read this
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="px-3 pb-2.5 text-[12px] text-muted-foreground leading-snug">{children}</p>}
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────
function Filters({ filters, setFilters, maxMarket, sources, sourceId, setSourceId, format, setFormat }: {
  filters: MarketFilters;
  setFilters: (f: MarketFilters) => void;
  maxMarket: number;
  sources: Array<{ id: string; label: string; active: boolean }>;
  sourceId: string;
  setSourceId: (id: any) => void;
  format: MarketFormat;
  setFormat: (f: MarketFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<MarketFilters>) => setFilters({ ...filters, ...patch });
  const ageOptions: Array<{ id: AgeRange; label: string }> = [
    { id: "All", label: "All ages" }, { id: "u23", label: "Under 23" },
    { id: "23-25", label: "23–25" }, { id: "26-28", label: "26–28" }, { id: "29+", label: "29+" },
  ];
  const chip = (active: boolean) => cn(
    "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors",
    active ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
      : "border-border text-muted-foreground hover:text-foreground hover:border-border",
  );

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search player…"
            className="pl-8 h-8 text-[12px]"
            data-testid="market-search"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="sm:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
        </button>
      </div>

      <div className={cn("flex-col gap-2.5", open ? "flex" : "hidden", "sm:flex")}>
        {/* Position */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14">Position</span>
          <button className={chip(filters.position === "All")} onClick={() => set({ position: "All" })}>All</button>
          {MARKET_POSITIONS.map((pos) => (
            <button key={pos} className={chip(filters.position === pos)} onClick={() => set({ position: pos })}>{pos}</button>
          ))}
        </div>
        {/* Format */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14">Format</span>
          {([["sf", "Superflex"], ["1qb", "1QB"]] as Array<[MarketFormat, string]>).map(([id, label]) => (
            <button key={id} className={chip(format === id)} onClick={() => setFormat(id)} data-testid={`market-format-${id}`}>{label}</button>
          ))}
        </div>
        {/* Age range */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14">Age</span>
          {ageOptions.map((o) => (
            <button key={o.id} className={chip(filters.ageRange === o.id)} onClick={() => set({ ageRange: o.id })}>{o.label}</button>
          ))}
        </div>
        {/* Value source */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14">Source</span>
          {sources.filter((s) => s.active).map((s) => (
            <button key={s.id} className={chip(sourceId === s.id)} onClick={() => setSourceId(s.id)}>{s.label}</button>
          ))}
        </div>
        {/* Min market value */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14">Min value</span>
          <Slider
            value={[filters.minMarketValue]}
            onValueChange={([v]) => set({ minMarketValue: v })}
            min={0}
            max={Math.max(1000, Math.round(maxMarket))}
            step={100}
            className="flex-1 max-w-[280px]"
          />
          <span className="text-[11px] tabular-nums text-foreground w-14 text-right">{fmtNum(filters.minMarketValue)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
// Embeddable market-inefficiency panels. The active panel (value / gap / age)
// is driven by the parent (the Value Finder tab bar), so this component has no
// internal tab bar of its own; it keeps its own filters + market data pipeline.
export function MarketInsights({ activeTab }: { activeTab: TabId }) {
  const vm = useValueModel();
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [gapView, setGapView] = useState<GapView>("all");
  const [format, setFormat] = useState<MarketFormat>("sf");

  const sourceLabel = useMemo(
    () => vm.sources.find((s) => s.id === vm.sourceId)?.label ?? vm.sourceId,
    [vm.sources, vm.sourceId],
  );

  // Superflex is served synchronously from the value-model context (bundled
  // snapshot upgraded in the background), so the default view is instant and
  // works offline.
  const sfPlayers = useMemo(
    () => buildMarketPlayers(vm.dynastyPlayerList, vm.redraftValuesBySleeperId, sourceLabel),
    [vm.dynastyPlayerList, vm.redraftValuesBySleeperId, sourceLabel],
  );

  // 1QB isn't held in the context, so we pull it from the shared API endpoint
  // (same model, computed server-side) the first time the user toggles to it.
  const [oqb, setOqb] = useState<{ players: MarketPlayer[]; loading: boolean; error: boolean }>({
    players: [], loading: false, error: false,
  });
  useEffect(() => {
    if (format !== "1qb") return;
    let cancelled = false;
    setOqb((s) => ({ ...s, loading: true, error: false }));
    fetch(`/api/market-inefficiencies?format=1qb&valueSource=${encodeURIComponent(vm.sourceId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setOqb({ players: data.players ?? [], loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setOqb({ players: [], loading: false, error: true });
      });
    return () => { cancelled = true; };
  }, [format, vm.sourceId]);

  const allPlayers = format === "1qb" ? oqb.players : sfPlayers;
  const maxMarket = useMemo(() => allPlayers.reduce((m, p) => Math.max(m, p.marketValue), 0), [allPlayers]);
  const filtered = useMemo(() => applyFilters(allPlayers, filters), [allPlayers, filters]);
  const summary = useMemo(() => computeSummary(filtered), [filtered]);

  // Tab 1 uses expected-from-production gaps (not model gaps).
  const valueRows = useMemo(() => filtered
    .filter((p) => p.expectedValue != null)
    .map((p) => {
      const sig = getMarketSignal({ marketValue: p.marketValue, expectedValue: p.expectedValue });
      return { ...p, gap: sig.gap, gapPercent: sig.gapPercent, signal: sig.signal, tone: sig.tone };
    }), [filtered]);
  const underpriced = useMemo(() => valueRows.filter((p) => (p.gap ?? 0) > 0).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0)).slice(0, 10), [valueRows]);
  const overpriced = useMemo(() => valueRows.filter((p) => (p.gap ?? 0) < 0).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 10), [valueRows]);

  // Model-gap views (tabs 2 & 3) rank by modelValue − marketValue, which the
  // deep-value tail distorts, so restrict them to relevant assets. The scatter
  // charts keep the full set so every dot is plotted.
  const rankable = useMemo(() => relevantPool(filtered), [filtered]);

  // Tab 2 model-gap table.
  const largestGaps = useMemo(() => [...rankable].sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)).slice(0, 25), [rankable]);

  // Tab 3 age tables.
  const discountedVets = useMemo(() => rankable.filter((p) => (p.age ?? 0) >= 26 && (p.gap ?? 0) > 0).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0)).slice(0, 10), [rankable]);
  const youthRisks = useMemo(() => rankable.filter((p) => (p.age ?? 99) <= 23 && (p.gap ?? 0) < 0).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 10), [rankable]);

  // Full-page empty state only for the synchronous Superflex path — if even the
  // bundled values are missing there's nothing to show. The 1QB path keeps the
  // header/filters mounted and surfaces loading/error inline (below) so the user
  // can switch back.
  if (format === "sf" && !sfPlayers.length) {
    return (
      <div className="rounded-xl border border-border bg-card/40 p-8 text-center">
        <h2 className="text-base font-bold text-foreground">Market Inefficiencies</h2>
        <p className="text-[13px] text-muted-foreground mt-2 max-w-md mx-auto">
          No market values found. Connect a value source or wait for values to load to unlock these charts.
        </p>
      </div>
    );
  }

  const oqbLoading = format === "1qb" && oqb.loading;
  const oqbError = format === "1qb" && oqb.error;
  const showPanels = !oqbLoading && !oqbError && allPlayers.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <StatCard icon={TrendingUp} label="Best Buy" player={summary.bestBuy} accent="text-emerald-600 dark-any:text-emerald-400" />
        <StatCard icon={TrendingDown} label="Biggest Sell" player={summary.biggestSell} accent="text-red-600 dark-any:text-red-400" />
        <StatCard icon={Scale} label="Largest Market Gap" player={summary.largestGap} accent="text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" />
      </div>

      <Filters
        filters={filters}
        setFilters={setFilters}
        maxMarket={maxMarket}
        sources={vm.sources}
        sourceId={vm.sourceId}
        setSourceId={vm.setSourceId}
        format={format}
        setFormat={setFormat}
      />

      {/* 1QB async states (Superflex renders synchronously). */}
      {oqbLoading && (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground" data-testid="market-1qb-loading">
          Loading 1QB market values…
        </div>
      )}
      {oqbError && (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center" data-testid="market-1qb-error">
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
            Couldn’t load 1QB values right now. Try again, or switch back to Superflex.
          </p>
        </div>
      )}
      {!showPanels && !oqbLoading && !oqbError && (
        <div className="rounded-xl border border-border bg-card/40 p-8 text-center text-[13px] text-muted-foreground">
          Not enough data to calculate market inefficiencies for this format.
        </div>
      )}

      {showPanels && activeTab === "value" && (
        <div className="space-y-3">
          <HowToRead>
            Players below the expected value curve may be underpriced because their production is stronger than
            their market cost. Players above the curve may be overpriced because their market value is higher than
            their production profile.
          </HowToRead>
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <ValueProductionScatter players={filtered} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <MarketInefficiencyTable title="Top Underpriced" rows={underpriced} columns={VALUE_COLUMNS} testId="table-underpriced"
              emptyText="No clearly underpriced players in this filter set." />
            <MarketInefficiencyTable title="Top Overpriced" rows={overpriced} columns={VALUE_COLUMNS} testId="table-overpriced"
              emptyText="No clearly overpriced players in this filter set." />
          </div>
        </div>
      )}

      {showPanels && activeTab === "gap" && (
        <div className="space-y-3">
          <HowToRead>
            This compares market value against Dynasty Command’s internal model. Positive gaps may indicate
            buy-low targets. Negative gaps may indicate sell-high candidates.
          </HowToRead>
          <div className="flex gap-1.5">
            {([["all", "All"], ["buys", "Biggest Buys"], ["sells", "Biggest Sells"]] as Array<[GapView, string]>).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setGapView(id)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-semibold border",
                  gapView === id ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <MarketGapChart players={rankable} view={gapView} />
          </div>
          <MarketInefficiencyTable title="Largest Market Gaps" rows={largestGaps} columns={GAP_COLUMNS} testId="table-market-gaps"
            emptyText="Not enough data to rank market gaps." />
        </div>
      )}

      {showPanels && activeTab === "age" && (
        <div className="space-y-3">
          <HowToRead>
            Dynasty markets often price players differently by age and position. Use this chart to find productive
            veterans being discounted or young assets whose market value may already be inflated.
          </HowToRead>
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <AgeCurveChart players={filtered} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <MarketInefficiencyTable title="Discounted Veterans" rows={discountedVets} columns={AGE_COLUMNS} testId="table-discounted-vets"
              emptyText="No discounted veterans (26+) in this filter set." />
            <MarketInefficiencyTable title="Youth Premium Risks" rows={youthRisks} columns={AGE_COLUMNS} testId="table-youth-risks"
              emptyText="No overpriced young players in this filter set." />
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketInsights;
