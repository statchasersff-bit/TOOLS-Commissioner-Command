/**
 * Portfolio Timeline — a stock-portfolio-style view of a manager's dynasty
 * value over time. The model is a fixed basket: we take the CURRENT roster
 * holdings across the manager's leagues and mark them to market at each of the
 * last 36 months, using values derived from crawled startup-draft ADP (see
 * server/portfolioBasketValue.ts).
 *
 * Older months are estimated from nearby ADP, so everything is
 * confidence-labeled and the chart is honest about it.
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
  getLeagueBreakdown,
  runPortfolioBackfill,
  type TimelineResponse,
  type LeagueBreakdownRow,
} from "@/lib/portfolioApi";

// ── Config ────────────────────────────────────────────────────────────────

type ModeId = "total" | "average";
const MODES: Array<{ id: ModeId; label: string; field: keyof import("@/lib/portfolioApi").TimelinePoint }> = [
  { id: "total", label: "Total", field: "totalValue" },
  { id: "average", label: "Avg Team", field: "averageTeamValue" },
];
const RANGES: Array<{ id: string; label: string }> = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
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
  const { isConnected, user, leagues } = useSleeper();
  const handle = user?.userId ?? null;

  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [breakdown, setBreakdown] = useState<LeagueBreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [mode, setMode] = useState<ModeId>("total");
  const [range, setRange] = useState("all");
  const [sameLeagueOnly, setSameLeagueOnly] = useState(false);

  const loadAll = useCallback(
    async (rng: string, sameLeague: boolean) => {
      if (!handle) return;
      setLoading(true);
      setError(null);
      try {
        const [tl, br] = await Promise.all([
          getPortfolioTimeline(handle, { range: rng, sameLeague }),
          getLeagueBreakdown(handle),
        ]);
        setTimeline(tl);
        setBreakdown(br.leagues);
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
      await runPortfolioBackfill(handle, leagues.map((l) => l.leagueId));
      await loadAll(range, sameLeagueOnly);
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
              tooltip="Current market value of all rostered players across every connected dynasty league, summed today." />
            <KpiCard
              label={`Change (${range.toUpperCase()})`}
              value={signed(summary!.change)}
              icon={Activity}
              trend={summary!.change > 0 ? "up" : summary!.change < 0 ? "down" : "neutral"}
              subtitle={`${summary!.changePct >= 0 ? "+" : ""}${summary!.changePct}%`}
            />
            <KpiCard label="Leagues Tracked" value={summary!.leaguesTracked} icon={Trophy} />
            <KpiCard label="Average Team Value" value={fmt(summary!.averageTeamValue)} icon={Users}
              tooltip="Total value divided by number of tracked leagues." />
          </div>

          {/* Chart */}
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <Segmented options={MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={(v) => setMode(v as ModeId)} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleSameLeague}
                  title="Only include leagues that were already tracked at the start of the selected range, so adding a new league doesn't fake a jump."
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
                    sameLeagueOnly
                      ? "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#d4af37]"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                  data-testid="portfolio-same-league"
                >
                  Same-league
                </button>
                <Segmented options={RANGES} value={range} onChange={onRangeChange} />
              </div>
            </div>
            <div className="h-[300px] sm:h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} width={48} tickFormatter={kfmt} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground/70 italic mt-2">
              Your current roster valued at each month's market (from startup-draft ADP). Older months are estimated; confidence is shown above.
            </p>
          </Card>

          {/* League breakdown */}
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
                      <th className="text-right py-1.5 font-semibold">Current Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((l) => (
                      <tr key={l.leagueId} className="border-b border-border/30 last:border-0">
                        <td className="py-1.5 pr-2 truncate max-w-[240px] text-foreground/85">{l.leagueName}</td>
                        <td className="py-1.5 text-right tabular-nums text-foreground/85">{fmt(l.currentValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
            Visible Sleeper leagues only — private leagues and DMs are not included. The timeline values your current roster at
            each month's market, derived from crawled startup-draft ADP; months before our draft data begins (and thin
            off-season months) are estimated and labeled by confidence.
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

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload as import("@/lib/portfolioApi").TimelinePoint;
  return (
    <div className="rounded-lg border border-white/10 bg-[rgba(8,16,32,0.96)] px-3 py-2 text-[11px] shadow-xl">
      <div className="font-bold text-white mb-1">{shortDate(p.date)}</div>
      <Row label="Total" value={fmt(p.totalValue)} />
      <Row label="Avg team" value={fmt(p.averageTeamValue)} />
      <Row label="Leagues" value={String(p.leagueCount)} />
      <div className="mt-1 pt-1 border-t border-white/10 text-[10px] text-white/50">Confidence: {p.confidence}</div>
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
          : "We value your current roster across every connected dynasty league at each of the last 36 months, using market values from crawled startup-draft ADP. Older months are estimated from nearby data."}
      </p>
      <Button onClick={onBackfill} disabled={backfilling} data-testid="portfolio-run-backfill">
        {backfilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
        {backfilling ? "Building…" : "Run Historical Backfill"}
      </Button>
    </Card>
  );
}
