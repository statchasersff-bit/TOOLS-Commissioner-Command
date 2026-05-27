/**
 * Portfolio Timeline — a stock-portfolio-style view of a manager's dynasty
 * value over time, reconstructed as an asset ledger from Sleeper drafts,
 * trades, waivers, and picks (see server/portfolioLedger.ts).
 *
 * Historical values are estimated (we only have value snapshots going forward),
 * so everything is confidence-labeled and the chart is honest about it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Coins,
  Info,
  Layers,
  LineChart as LineChartIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/KpiCard";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import {
  getPortfolioTimeline,
  getPortfolioEvents,
  getLeagueBreakdown,
  getPortfolioAssets,
  getValueSourceBreakdown,
  runPortfolioBackfill,
  type TimelineResponse,
  type PortfolioEvent,
  type LeagueBreakdownRow,
  type AssetRow,
  type ValueSourceRow,
} from "@/lib/portfolioApi";

// ── Config ────────────────────────────────────────────────────────────────

type ModeId = "total" | "roster" | "picks" | "average" | "costBasis" | "netValueCreated";
const MODES: Array<{ id: ModeId; label: string; field: keyof import("@/lib/portfolioApi").TimelinePoint }> = [
  { id: "total", label: "Total", field: "totalValue" },
  { id: "roster", label: "Roster", field: "rosterValue" },
  { id: "picks", label: "Picks", field: "pickValue" },
  { id: "average", label: "Avg Team", field: "averageTeamValue" },
  { id: "costBasis", label: "Cost Basis", field: "costBasis" },
  { id: "netValueCreated", label: "Value Created", field: "netValueCreated" },
];
const RANGES: Array<{ id: string; label: string }> = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];

const EVENT_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "trade", label: "Trades" },
  { id: "waiver_claim", label: "Waivers" },
  { id: "rookie_draft", label: "Drafts" },
];

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}
function kfmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${fmt(n)}`;
}
function shortDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

const EVENT_COLOR: Record<string, string> = {
  trade: "#d4af37",
  waiver_claim: "#38bdf8",
  free_agent_add: "#38bdf8",
  rookie_draft: "#34d399",
  startup_draft: "#34d399",
  pick_conversion: "#a855f7",
  league_added: "#94a3b8",
  league_removed: "#94a3b8",
};
function eventColor(type: string): string {
  return EVENT_COLOR[type] ?? "#94a3b8";
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PortfolioTimeline() {
  const { isConnected, user } = useSleeper();
  const handle = user?.userId ?? null;

  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [breakdown, setBreakdown] = useState<LeagueBreakdownRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [valueSources, setValueSources] = useState<ValueSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [mode, setMode] = useState<ModeId>("total");
  const [range, setRange] = useState("all");
  const [sameLeagueOnly, setSameLeagueOnly] = useState(false);
  const [eventFilter, setEventFilter] = useState("all");

  const loadAll = useCallback(
    async (rng: string, sameLeague: boolean) => {
      if (!handle) return;
      setLoading(true);
      setError(null);
      try {
        const [tl, ev, br, as, vs] = await Promise.all([
          getPortfolioTimeline(handle, { range: rng, sameLeague }),
          getPortfolioEvents(handle, { limit: 100 }),
          getLeagueBreakdown(handle),
          getPortfolioAssets(handle),
          getValueSourceBreakdown(handle),
        ]);
        setTimeline(tl);
        setEvents(ev.events);
        setBreakdown(br.leagues);
        setAssets(as.assets);
        setValueSources(vs.sources);
      } catch (err: any) {
        setError(err?.message || "Failed to load portfolio timeline");
      } finally {
        setLoading(false);
      }
    },
    [handle],
  );

  useEffect(() => {
    if (handle) void loadAll(range, sameLeagueOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const onRangeChange = (r: string) => {
    setRange(r);
    void loadAll(r, sameLeagueOnly);
  };
  const onToggleSameLeague = () => {
    const next = !sameLeagueOnly;
    setSameLeagueOnly(next);
    void loadAll(range, next);
  };

  const onBackfill = async () => {
    if (!handle || backfilling) return;
    setBackfilling(true);
    setError(null);
    try {
      await runPortfolioBackfill(handle);
      await loadAll(range);
    } catch (err: any) {
      setError(err?.message || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const activeMode = MODES.find((m) => m.id === mode)!;
  const points = timeline?.points ?? [];
  const chartData = useMemo(
    () => points.map((p) => ({ ...p, x: shortDate(p.date), value: p[activeMode.field] as number })),
    [points, activeMode.field],
  );
  // Event markers: only dates present in the chart, deduped to one per date.
  const markerByDate = useMemo(() => {
    const m = new Map<string, PortfolioEvent>();
    const valueByDate = new Map(chartData.map((d) => [d.date, d.value]));
    for (const e of events) {
      if (!valueByDate.has(e.date)) continue;
      if (!m.has(e.date)) m.set(e.date, e);
    }
    return { m, valueByDate };
  }, [events, chartData]);

  const filteredEvents = useMemo(
    () =>
      events.filter((e) =>
        eventFilter === "all"
          ? true
          : eventFilter === "rookie_draft"
          ? e.type.includes("draft")
          : eventFilter === "waiver_claim"
          ? e.type === "waiver_claim" || e.type === "free_agent_add"
          : e.type === eventFilter,
      ),
    [events, eventFilter],
  );

  if (!isConnected || !handle) {
    return <EmptyShell text="Connect your Sleeper account to track your dynasty portfolio over time." />;
  }

  const summary = timeline?.summary;
  const hasData = points.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-1 sm:px-2 space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-[#d4af37]" />
            Portfolio Timeline
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            Your dynasty value over time across all visible leagues.
            <span title="Historical values are estimated using Dynasty Command's value-snapshot history, draft history, roster history, and transaction data. When exact daily values are unavailable, values are interpolated from nearby snapshots.">
              <Info className="w-3.5 h-3.5 inline text-muted-foreground/70" />
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary && <ConfidenceBadge level={summary.confidence} />}
          <Button variant="outline" size="sm" onClick={onBackfill} disabled={backfilling || loading} data-testid="portfolio-backfill">
            {backfilling ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            {backfilling ? "Building…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 text-[13px] text-red-300">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        </Card>
      )}

      {loading && !timeline ? (
        <LoadingShell />
      ) : !hasData ? (
        <EmptyState backfilling={backfilling} onBackfill={onBackfill} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <KpiCard label="Total Portfolio Value" value={fmt(summary!.totalPortfolioValue)} icon={TrendingUp}
              tooltip="Sum of all player + rookie-pick values across every connected dynasty league." />
            <KpiCard label="Roster Value" value={fmt(summary!.rosterValue)} icon={Users} tooltip="Player values only." />
            <KpiCard label="Pick Value" value={fmt(summary!.pickValue)} icon={Layers} tooltip="Rookie / future pick values only." />
            <KpiCard
              label={`Change (${range.toUpperCase()})`}
              value={signed(summary!.change)}
              icon={Activity}
              trend={summary!.change > 0 ? "up" : summary!.change < 0 ? "down" : "neutral"}
              subtitle={`${summary!.changePct >= 0 ? "+" : ""}${summary!.changePct}%`}
            />
            <KpiCard label="Estimated Cost Basis" value={fmt(summary!.costBasis)} icon={Coins}
              tooltip="Estimated value paid to acquire current holdings (draft slot, trade-in, or waiver value at acquisition)." />
            <KpiCard label="Net Value Created" value={signed(summary!.netValueCreated)} icon={Sparkles}
              trend={summary!.netValueCreated > 0 ? "up" : summary!.netValueCreated < 0 ? "down" : "neutral"}
              tooltip="Current value minus cost basis." />
            <KpiCard label="Leagues Tracked" value={summary!.leaguesTracked} icon={Trophy} />
            <KpiCard label="Average Team Value" value={fmt(summary!.averageTeamValue)} icon={Users}
              tooltip="Total value divided by number of tracked leagues." />
          </div>

          {/* Chart */}
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <Segmented options={MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={(v) => setMode(v as ModeId)} />
              <Segmented options={RANGES} value={range} onChange={onRangeChange} />
            </div>
            <div className="h-[300px] sm:h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} width={48} tickFormatter={kfmt} />
                  <RechartsTooltip content={<ChartTooltip markerByDate={markerByDate.m} />} />
                  <Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  {Array.from(markerByDate.m.entries()).map(([date, ev]) => (
                    <ReferenceDot
                      key={date}
                      x={shortDate(date)}
                      y={markerByDate.valueByDate.get(date) ?? 0}
                      r={4}
                      fill={eventColor(ev.type)}
                      stroke="#0a1628"
                      strokeWidth={1}
                      isFront
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground/70 italic mt-2">
              Dots mark trades, waivers, drafts, and league changes. Past values are estimated; confidence is shown above.
            </p>
          </Card>

          {/* Event feed + league breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-[13px] font-bold text-foreground flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-[#d4af37]" /> Event feed
                </h3>
                <Segmented options={EVENT_FILTERS} value={eventFilter} onChange={setEventFilter} small />
              </div>
              {filteredEvents.length === 0 ? (
                <p className="text-[12px] text-muted-foreground py-4 text-center">No events in this category.</p>
              ) : (
                <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredEvents.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-3 sm:p-4">
              <h3 className="text-[13px] font-bold text-foreground flex items-center gap-1.5 mb-2">
                <Trophy className="w-4 h-4 text-[#d4af37]" /> League breakdown
              </h3>
              {breakdown.length === 0 ? (
                <p className="text-[12px] text-muted-foreground py-4 text-center">No leagues tracked yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                        <th className="text-left py-1.5 font-semibold">League</th>
                        <th className="text-right py-1.5 font-semibold">Value</th>
                        <th className="text-right py-1.5 font-semibold hidden sm:table-cell">Picks</th>
                        <th className="text-right py-1.5 font-semibold">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map((l) => (
                        <tr key={l.leagueId} className="border-b border-border/30 last:border-0">
                          <td className="py-1.5 pr-2 truncate max-w-[140px] text-foreground/85">{l.leagueName}</td>
                          <td className="py-1.5 text-right tabular-nums text-foreground/85">{fmt(l.currentValue)}</td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmt(l.pickValue)}</td>
                          <td className={cn("py-1.5 text-right tabular-nums font-semibold", l.netValueCreated >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {signed(l.netValueCreated)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
            Visible Sleeper leagues only — private leagues and DMs are not included. Playoff appearances, championships, and
            historical finishes are limited by Sleeper public-data availability. Values for past dates are estimated from the
            nearest available snapshot and labeled by confidence.
          </p>
        </>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function Segmented({
  options,
  value,
  onChange,
  small,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-muted/20 p-0.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2 py-1 font-semibold transition-colors",
            small ? "text-[10px]" : "text-[11px]",
            value === o.id ? "bg-[#d4af37] text-[#07111f]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const tone =
    level === "high"
      ? "text-emerald-300 border-emerald-500/40"
      : level === "medium"
      ? "text-amber-300 border-amber-500/40"
      : "text-muted-foreground border-border/60";
  const label = level === "high" ? "Tracked history" : level === "medium" ? "Mostly estimated" : "Estimated history";
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-bold", tone)}
      title="Confidence reflects how much of your history comes from real value snapshots vs. estimated/nearest values."
    >
      {label}
    </Badge>
  );
}

function ChartTooltip({ active, payload, markerByDate }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload as import("@/lib/portfolioApi").TimelinePoint;
  const ev = markerByDate?.get(p.date) as PortfolioEvent | undefined;
  return (
    <div className="rounded-lg border border-white/10 bg-[rgba(8,16,32,0.96)] px-3 py-2 text-[11px] shadow-xl">
      <div className="font-bold text-white mb-1">{shortDate(p.date)}</div>
      <Row label="Total" value={fmt(p.totalValue)} />
      <Row label="Roster" value={fmt(p.rosterValue)} />
      <Row label="Picks" value={fmt(p.pickValue)} />
      <Row label="Cost basis" value={fmt(p.costBasis)} />
      <Row label="Net created" value={signed(p.netValueCreated)} />
      <Row label="Leagues" value={String(p.leagueCount)} />
      <div className="mt-1 pt-1 border-t border-white/10 text-[10px] text-white/50">Confidence: {p.confidence}</div>
      {ev && <div className="mt-1 text-[10px]" style={{ color: eventColor(ev.type) }}>● {ev.title}</div>}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-white/50">{label}</span>
      <span className="text-white/90 tabular-nums">{value}</span>
    </div>
  );
}

function EventCard({ event }: { event: PortfolioEvent }) {
  const [open, setOpen] = useState(false);
  const color = eventColor(event.type);
  const hasDetail = !!(event.detail?.sent?.length || event.detail?.received?.length);
  return (
    <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2">
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-[12.5px] font-semibold text-foreground/90 truncate">{event.title}</span>
          </div>
          <span
            className={cn(
              "text-[12px] font-bold tabular-nums flex-shrink-0",
              event.netDelta > 0 ? "text-emerald-400" : event.netDelta < 0 ? "text-red-400" : "text-muted-foreground",
            )}
          >
            {event.netDelta !== 0 ? signed(event.netDelta) : "—"}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {shortDate(event.date)} · {event.description}
        </div>
      </button>
      {open && hasDetail && (
        <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-border/30">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-red-300/80 mb-1">Sent</div>
            {(event.detail?.sent ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-0.5">
                {event.detail!.sent!.map((a, i) => (
                  <li key={i} className="text-[11px] text-foreground/80 flex justify-between gap-2">
                    <span className="truncate">{a.name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmt(a.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-emerald-300/80 mb-1">Received</div>
            {(event.detail?.received ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-0.5">
                {event.detail!.received!.map((a, i) => (
                  <li key={i} className="text-[11px] text-foreground/80 flex justify-between gap-2">
                    <span className="truncate">{a.name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmt(a.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-6 h-6 animate-spin text-[#d4af37]" />
    </div>
  );
}

function EmptyShell({ text }: { text: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-20 px-4">
      <LineChartIcon className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
      <p className="text-[13px] text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyState({ backfilling, onBackfill }: { backfilling: boolean; onBackfill: () => void }) {
  return (
    <Card className="p-8 text-center max-w-lg mx-auto">
      <LineChartIcon className="w-10 h-10 text-[#d4af37]/60 mx-auto mb-3" />
      <h3 className="text-[15px] font-bold text-foreground mb-1">Build your portfolio history</h3>
      <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-4">
        {backfilling
          ? "Building portfolio history… this may take a minute for managers with many leagues."
          : "We can reconstruct your dynasty portfolio value over time from your Sleeper drafts, trades, waivers, and picks. Older values are estimated from nearby snapshots."}
      </p>
      <Button onClick={onBackfill} disabled={backfilling} data-testid="portfolio-run-backfill">
        {backfilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
        {backfilling ? "Building…" : "Run Historical Backfill"}
      </Button>
    </Card>
  );
}
