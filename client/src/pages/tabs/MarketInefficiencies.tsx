import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useValueModel } from "@/contexts/ValueModelContext";
import { HowToReadCard } from "@/components/value-finder/HowToReadCard";
import {
  buildMarketPlayers, applyFilters, relevantPool,
  POSITION_COLORS,
  type MarketFilters, type MarketPlayer,
} from "@/lib/market/marketModel";
import { useValueFinderPlayers } from "@/lib/value-finder/loadPlayers";
import { type SeasonFilter } from "@/lib/value-finder/types";
import { MarketSignalBadge } from "@/components/market/MarketSignalBadge";
import { MarketInefficiencyTable, type MarketColumn } from "@/components/market/MarketInefficiencyTable";
import { ValueProductionScatter } from "@/components/market/ValueProductionScatter";
import { MarketGapChart, type GapView } from "@/components/market/MarketGapChart";
import { AgeCurveChart } from "@/components/market/AgeCurveChart";

export type MarketTabId = "value" | "gap" | "age";
type TabId = MarketTabId;
export type MarketFormat = "sf" | "1qb";

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

const GAP_COLUMNS: MarketColumn[] = [
  playerCol(), posCol(), ageCol(),
  { key: "market", header: "Market", align: "right", cell: (p) => fmtNum(p.marketValue) },
  { key: "model", header: "Model", align: "right", cell: (p) => fmtNum(p.modelValue) },
  gapCol(),
  { key: "mrank", header: "Mkt Rk", align: "right", cell: (p) => p.marketRank ?? "—" },
  { key: "morank", header: "Mdl Rk", align: "right", cell: (p) => p.modelRank ?? "—" },
  signalCol(),
];

// ── Page ──────────────────────────────────────────────────────────────────────
// Embeddable market-inefficiency panels. The active panel (value / gap / age)
// is driven by the parent (the Value Finder tab bar), so this component has no
// internal tab bar of its own; it keeps its own filters + market data pipeline.
// The filter bar lives in the parent (ValueFinder) and is shared across every
// sub-tab, so this component is controlled: it receives the active filters,
// market format, and season rather than owning them.
export function MarketInsights({ activeTab, filters, format, season }: {
  activeTab: TabId;
  filters: MarketFilters;
  format: MarketFormat;
  season: SeasonFilter;
}) {
  const vm = useValueModel();
  const [gapView, setGapView] = useState<GapView>("all");

  // Games-played comes from the Value Finder pool (the only feed with per-season
  // game counts). We reuse it purely as a sleeperId → GP lookup for the selected
  // season; the market values themselves stay current. Superflex covers every
  // position, and GP is format-independent, so one fetch per season is enough.
  const gpQuery = useValueFinderPlayers(season, "Superflex");
  const gamesPlayedById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of gpQuery.data ?? []) {
      if (p.playerId && p.gamesPlayed != null) m[p.playerId] = p.gamesPlayed;
    }
    return m;
  }, [gpQuery.data]);

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

  // Join the selected season's games-played onto each market player so the
  // Min GP filter has data to act on (the market feed itself carries no GP).
  const allPlayers = useMemo(() => {
    const base = format === "1qb" ? oqb.players : sfPlayers;
    return base.map((p) => ({ ...p, gamesPlayed: gamesPlayedById[p.playerId] }));
  }, [format, oqb.players, sfPlayers, gamesPlayedById]);
  const filtered = useMemo(() => applyFilters(allPlayers, filters), [allPlayers, filters]);

  // Model-gap views (tabs 2 & 3) rank by modelValue − marketValue, which the
  // deep-value tail distorts, so restrict them to relevant assets. The scatter
  // charts keep the full set so every dot is plotted.
  const rankable = useMemo(() => relevantPool(filtered), [filtered]);

  // Tab 2 model-gap table.
  const largestGaps = useMemo(() => [...rankable].sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)).slice(0, 25), [rankable]);

  // Tab 3 age tables.

  // Full-page empty state only for the synchronous Superflex path — if even the
  // bundled values are missing there's nothing to show. The 1QB path keeps the
  // header/filters mounted and surfaces loading/error inline (below) so the user
  // can switch back.
  if (format === "sf" && !sfPlayers.length) {
    return (
      <div className="rounded-xl border border-border bg-card/40 p-8 text-center">
        <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
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
          Not enough data to show these views for this format.
        </div>
      )}

      {showPanels && activeTab === "value" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <ValueProductionScatter players={filtered} />
          </div>
          <HowToReadCard>
            Players below the expected value curve may be underpriced because their production is stronger than
            their market cost. Players above the curve may be overpriced because their market value is higher than
            their production profile.
          </HowToReadCard>
        </div>
      )}

      {showPanels && activeTab === "gap" && (
        <div className="space-y-3">
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
          <HowToReadCard>
            This compares market value against Dynasty Command’s internal model. Positive gaps may indicate
            buy-low targets. Negative gaps may indicate sell-high candidates.
          </HowToReadCard>
        </div>
      )}

      {showPanels && activeTab === "age" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <AgeCurveChart players={filtered} />
          </div>
          <HowToReadCard>
            Dynasty markets often price players differently by age and position. Use this chart to find productive
            veterans being discounted or young assets whose market value may already be inflated.
          </HowToReadCard>
        </div>
      )}
    </div>
  );
}

export default MarketInsights;
