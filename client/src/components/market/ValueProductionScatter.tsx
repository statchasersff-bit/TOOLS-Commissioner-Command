import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, ReferenceLine, Legend, Label,
} from "recharts";
import { MARKET_POSITIONS, POSITION_COLORS, type MarketPlayer } from "@/lib/market/marketModel";
import { linearRegression } from "@/lib/market/valueNormalization";

const PALETTE = { grid: "#9ca3af40", axis: "#9ca3af", label: "#9ca3af" };

function fmt(n?: number) {
  return n == null ? "—" : Math.round(n).toLocaleString();
}

function VPTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: MarketPlayer = payload[0].payload;
  const expected = p.expectedValue;
  const gap = expected != null ? expected - p.marketValue : 0;
  const gapPct = expected != null && p.marketValue ? (gap / p.marketValue) * 100 : 0;
  const label = gapPct >= 8 ? "Underpriced" : gapPct <= -8 ? "Overpriced" : "Fair Value";
  const labelCls = gapPct >= 8 ? "text-emerald-400" : gapPct <= -8 ? "text-red-400" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-lg text-[11px]">
      <p className="font-bold text-foreground text-[12px]">{p.playerName}</p>
      <p className="text-muted-foreground mb-1.5">
        {p.position}{p.team ? ` · ${p.team}` : ""}{p.age ? ` · Age ${p.age}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Market Value</span><span className="text-right font-semibold">{fmt(p.marketValue)}</span>
        <span className="text-muted-foreground">Production</span><span className="text-right">{fmt(p.production)}</span>
        <span className="text-muted-foreground">Expected Value</span><span className="text-right">{fmt(expected)}</span>
        <span className="text-muted-foreground">Gap</span>
        <span className={`text-right font-semibold ${labelCls}`}>{expected != null ? `${gap >= 0 ? "+" : ""}${fmt(gap)}` : "—"}</span>
      </div>
      <p className={`mt-1.5 font-bold ${labelCls}`}>Signal: {label}</p>
    </div>
  );
}

/**
 * Market value (Y) vs production (X). Dots colored by position; the dashed gold
 * line is expected market value from production. Dots below the line are
 * underpriced, above are overpriced.
 */
export function ValueProductionScatter({ players }: { players: MarketPlayer[] }) {
  const pts = players.filter((p) => (p.production ?? 0) > 0);
  if (pts.length < 3) {
    return (
      <div className="h-[360px] flex items-center justify-center text-center text-[12px] text-muted-foreground px-6">
        Not enough production data to chart this filter set. Try widening the filters.
      </div>
    );
  }

  const prods = pts.map((p) => p.production!);
  const minX = Math.min(...prods);
  const maxX = Math.max(...prods);
  const { slope, intercept } = linearRegression(pts.map((p) => ({ x: p.production!, y: p.marketValue })));
  const lineSeg = [
    { x: minX, y: Math.max(0, slope * minX + intercept) },
    { x: maxX, y: Math.max(0, slope * maxX + intercept) },
  ];

  const positions = MARKET_POSITIONS.filter((pos) => pts.some((p) => p.position === pos));

  return (
    <div className="w-full" data-testid="chart-value-production">
      <ResponsiveContainer width="100%" aspect={2.31}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
          <XAxis
            type="number" dataKey="production" name="Production" domain={["dataMin", "dataMax"]}
            tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={{ stroke: PALETTE.axis }} axisLine={{ stroke: PALETTE.axis }}
          >
            <Label value="Redraft Market Value →" position="insideBottom" offset={-16} style={{ fill: PALETTE.label, fontSize: 11, fontWeight: 600 }} />
          </XAxis>
          <YAxis
            type="number" dataKey="marketValue" name="Market Value" width={48}
            tick={{ fill: PALETTE.axis, fontSize: 10 }} tickLine={{ stroke: PALETTE.axis }} axisLine={{ stroke: PALETTE.axis }}
          >
            <Label value="Dynasty Market Value →" angle={-90} position="insideLeft" offset={6} style={{ fill: PALETTE.label, fontSize: 11, fontWeight: 600, textAnchor: "middle" }} />
          </YAxis>
          <ReferenceLine
            segment={lineSeg as any}
            stroke="#d4af37"
            strokeWidth={2}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
          />
          <RechartsTooltip content={<VPTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 11 }} />
          {positions.map((pos) => (
            <Scatter
              key={pos}
              name={pos}
              data={pts.filter((p) => p.position === pos)}
              fill={POSITION_COLORS[pos]}
              fillOpacity={0.8}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
