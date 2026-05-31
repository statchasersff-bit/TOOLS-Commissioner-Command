import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, ReferenceLine, Cell,
} from "recharts";
import type { MarketPlayer } from "@/lib/market/marketModel";
import { TONE_HEX } from "@/lib/market/marketSignals";

const PALETTE = { grid: "#9ca3af40", axis: "#9ca3af" };

export type GapView = "buys" | "sells" | "all";

function fmt(n?: number) {
  return n == null ? "—" : Math.round(n).toLocaleString();
}

function GapTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: MarketPlayer = payload[0].payload.player;
  return (
    <div className="rounded-lg border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-lg text-[11px]">
      <p className="font-bold text-foreground text-[12px]">{p.playerName}</p>
      <p className="text-muted-foreground mb-1.5">
        {p.position}{p.team ? ` · ${p.team}` : ""}{p.age ? ` · Age ${p.age}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Market Value</span><span className="text-right font-semibold">{fmt(p.marketValue)}</span>
        <span className="text-muted-foreground">Model Value</span><span className="text-right">{fmt(p.modelValue)}</span>
        <span className="text-muted-foreground">Gap</span>
        <span className={`text-right font-semibold ${(p.gap ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {(p.gap ?? 0) >= 0 ? "+" : ""}{fmt(p.gap)} ({(p.gapPercent ?? 0) >= 0 ? "+" : ""}{(p.gapPercent ?? 0).toFixed(1)}%)
        </span>
        <span className="text-muted-foreground">Market Rank</span><span className="text-right">{p.marketRank ?? "—"}</span>
        <span className="text-muted-foreground">Model Rank</span><span className="text-right">{p.modelRank ?? "—"}</span>
      </div>
      <p className={`mt-1.5 font-bold ${(p.gap ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>Signal: {p.signal}</p>
    </div>
  );
}

/** Horizontal bars of modelValue − marketValue; top 25 by the selected view. */
export function MarketGapChart({ players, view }: { players: MarketPlayer[]; view: GapView }) {
  let list: MarketPlayer[];
  if (view === "buys") {
    list = players.filter((p) => (p.gap ?? 0) > 0).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0)).slice(0, 25);
  } else if (view === "sells") {
    list = players.filter((p) => (p.gap ?? 0) < 0).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 25);
  } else {
    list = [...players].sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)).slice(0, 25);
  }

  if (!list.length) {
    return (
      <div className="h-[320px] flex items-center justify-center text-center text-[12px] text-muted-foreground px-6">
        No {view === "buys" ? "buy-low" : view === "sells" ? "sell-high" : ""} candidates in this filter set.
      </div>
    );
  }

  // Biggest magnitude on top.
  const data = [...list].reverse().map((p) => ({ name: p.playerName, gap: Math.round(p.gap ?? 0), player: p }));
  const height = Math.max(320, data.length * 22 + 24);

  return (
    <div className="w-full overflow-y-auto" style={{ maxHeight: 560 }} data-testid="chart-market-gap">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} horizontal={false} />
            <XAxis type="number" tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={{ stroke: PALETTE.axis }} axisLine={{ stroke: PALETTE.axis }} />
            <YAxis
              type="category" dataKey="name" width={108} interval={0}
              tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={false} axisLine={{ stroke: PALETTE.axis }}
            />
            <ReferenceLine x={0} stroke={PALETTE.axis} />
            <RechartsTooltip content={<GapTooltip />} cursor={{ fill: "#9ca3af18" }} />
            <Bar dataKey="gap" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.gap >= 0 ? TONE_HEX.buy : TONE_HEX.sell} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
