import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, Legend, Label,
} from "recharts";
import { MARKET_POSITIONS, POSITION_COLORS, bucketAverages, type MarketPlayer } from "@/lib/market/marketModel";

const PALETTE = { grid: "#9ca3af40", axis: "#9ca3af", label: "#9ca3af" };

function fmt(n?: number) {
  return n == null ? "—" : Math.round(n).toLocaleString();
}

function AgeTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (row.__avg) {
    return (
      <div className="rounded-lg border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-lg text-[11px]">
        <p className="font-bold text-[#d4af37]">Avg market value</p>
        <p className="text-muted-foreground">Age ~{row.age}: {fmt(row.marketValue)}</p>
      </div>
    );
  }
  const p: MarketPlayer = row;
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
          {(p.gap ?? 0) >= 0 ? "+" : ""}{fmt(p.gap)}
        </span>
      </div>
      <p className={`mt-1.5 font-bold ${(p.gap ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>Signal: {p.signal}</p>
    </div>
  );
}

/** Age (X) vs market value (Y). Dots per position; gold line = bucket averages. */
export function AgeCurveChart({ players }: { players: MarketPlayer[] }) {
  const pts = players.filter((p) => p.age != null);
  if (pts.length < 3) {
    return (
      <div className="h-[360px] flex items-center justify-center text-center text-[12px] text-muted-foreground px-6">
        Not enough age data to chart this filter set. Try widening the filters.
      </div>
    );
  }

  const avgLine = bucketAverages(pts).map((d) => ({ ...d, __avg: true }));
  const positions = MARKET_POSITIONS.filter((pos) => pts.some((p) => p.position === pos));

  return (
    <div className="h-[360px] w-full" data-testid="chart-age-curve">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
          <XAxis
            type="number" dataKey="age" name="Age" domain={["dataMin - 1", "dataMax + 1"]}
            tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={{ stroke: PALETTE.axis }} axisLine={{ stroke: PALETTE.axis }}
          >
            <Label value="Age →" position="insideBottom" offset={-16} style={{ fill: PALETTE.label, fontSize: 11, fontWeight: 600 }} />
          </XAxis>
          <YAxis
            type="number" dataKey="marketValue" name="Market Value" width={48}
            tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={{ stroke: PALETTE.axis }} axisLine={{ stroke: PALETTE.axis }}
          >
            <Label value="Dynasty Market Value →" angle={-90} position="insideLeft" offset={6} style={{ fill: PALETTE.label, fontSize: 11, fontWeight: 600, textAnchor: "middle" }} />
          </YAxis>
          <RechartsTooltip content={<AgeTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {positions.map((pos) => (
            <Scatter
              key={pos}
              name={pos}
              data={pts.filter((p) => p.position === pos)}
              fill={POSITION_COLORS[pos]}
              fillOpacity={0.8}
            />
          ))}
          <Scatter
            name="Avg by age"
            data={avgLine}
            fill="#d4af37"
            line={{ stroke: "#d4af37", strokeWidth: 2 }}
            lineType="joint"
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
