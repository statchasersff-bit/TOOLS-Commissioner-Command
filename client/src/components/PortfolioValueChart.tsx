/**
 * Portfolio value-over-time chart. Self-contained: given a Sleeper handle
 * (user_id), it fetches the basket timeline and renders a total-value line
 * chart with a range control and a data-fitted Y-axis. Used on the My
 * Portfolio tab.
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
} from "recharts";
import { LineChart as LineChartIcon, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPortfolioTimeline, type TimelineResponse, type TimelinePoint } from "@/lib/portfolioApi";

const RANGES: Array<{ id: string; label: string }> = [
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = MONTH_ABBR[parseInt(m[2], 10) - 1] ?? "";
  return `${mon} '${m[1].slice(2)}`;
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}
function kfmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

export function PortfolioValueChart({ handle }: { handle: string | null }) {
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("all");

  const load = useCallback(
    async (rng: string) => {
      if (!handle) return;
      setLoading(true);
      setError(null);
      try {
        setTimeline(await getPortfolioTimeline(handle, { range: rng }));
      } catch (err: any) {
        setError(err?.message || "Failed to load portfolio timeline");
      } finally {
        setLoading(false);
      }
    },
    [handle],
  );

  useEffect(() => {
    if (handle) void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const points = timeline?.points ?? [];
  const chartData = useMemo(
    () => points.map((p) => ({ ...p, x: shortDate(p.date), value: p.totalValue })),
    [points],
  );
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const vals = chartData.map((d) => d.value).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return undefined;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (min === max) return [Math.max(0, min * 0.95), max * 1.05];
    const pad = (max - min) * 0.12;
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [chartData]);

  if (!handle) return null;

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="text-[13px] font-bold text-foreground flex items-center gap-1.5">
          <LineChartIcon className="w-4 h-4 text-[#d4af37]" /> Portfolio value over time
        </h3>
        <div className="flex items-center gap-2">
          <Segmented
            options={RANGES}
            value={range}
            onChange={(r) => {
              setRange(r);
              void load(r);
            }}
          />
        </div>
      </div>

      {error ? (
        <p className="text-[12px] text-red-300 py-8 text-center">{error}</p>
      ) : loading && !timeline ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-5 h-5 animate-spin text-[#d4af37]" />
        </div>
      ) : chartData.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-8 text-center">No portfolio value history yet.</p>
      ) : (
        <div className="h-[300px] sm:h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#9ca3af" }} width={48} tickFormatter={kfmt} domain={yDomain ?? ["auto", "auto"]} allowDecimals={false} />
              <RechartsTooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/70 italic mt-2">
        Your current roster valued at each month's market (from startup-draft ADP). Older months are estimated.
      </p>
    </Card>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "px-2.5 py-1 text-[10px] font-semibold transition-colors",
            value === o.id ? "bg-[#d4af37]/15 text-[#d4af37]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload as TimelinePoint;
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
