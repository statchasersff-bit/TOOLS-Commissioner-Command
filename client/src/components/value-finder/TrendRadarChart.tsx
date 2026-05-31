import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ValueFinderPlayer, TrendWindow } from "@/lib/value-finder/types";
import { getMarketTrend, getRoleTrend } from "@/lib/value-finder/trends";
import { PlayerValueTooltip } from "./PlayerValueTooltip";

// Quadrant scatter: role/production trend (x) vs market value trend (y).
//  ┌ Hype Riser     │ Legit Riser ┐
//  └ Falling Asset  │ Hidden Riser┘
const COLOR = {
  legit: "hsl(150, 65%, 45%)", // top-right
  hype: "hsl(35, 85%, 55%)", // top-left
  hidden: "hsl(205, 75%, 52%)", // bottom-right
  falling: "hsl(0, 70%, 55%)", // bottom-left
};

function quadrant(role: number, value: number): keyof typeof COLOR {
  if (value >= 0 && role >= 0) return "legit";
  if (value >= 0 && role < 0) return "hype";
  if (value < 0 && role >= 0) return "hidden";
  return "falling";
}

export function TrendRadarChart({
  players,
  trendWindow,
}: {
  players: ValueFinderPlayer[];
  trendWindow: TrendWindow;
}) {
  const data = useMemo(
    () =>
      players.map((p) => {
        const role = getRoleTrend(p);
        const value = getMarketTrend(p, trendWindow);
        return {
          x: role,
          y: value,
          player: p,
          comparisonValue: p.modelValue,
          comparisonLabel: "Model",
          q: quadrant(role, value),
        };
      }),
    [players, trendWindow],
  );

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Trend data is not available for this window yet.
      </p>
    );
  }

  const label = (text: string, cls: string) => (
    <span className={`text-[9px] font-bold uppercase tracking-wide ${cls}`}>{text}</span>
  );

  return (
    <div className="relative">
      {/* Quadrant labels */}
      <div className="pointer-events-none absolute inset-0 z-10 hidden sm:block">
        <div className="absolute top-2 right-3">{label("Legit Riser", "text-emerald-500")}</div>
        <div className="absolute top-2 left-12">{label("Hype Riser", "text-amber-500")}</div>
        <div className="absolute bottom-8 right-3">{label("Hidden Riser", "text-sky-500")}</div>
        <div className="absolute bottom-8 left-12">{label("Falling Asset", "text-red-500")}</div>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
          <XAxis
            type="number"
            dataKey="x"
            name="Role Trend"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            label={{ value: "Role / Production Trend", position: "insideBottom", offset: -12, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Value Trend"
            tick={{ fontSize: 10 }}
            width={48}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            label={{ value: "Market Value Trend", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <ZAxis range={[45, 45]} />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PlayerValueTooltip metric="trend" />} />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.player.playerId} fill={COLOR[d.q]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendRadarChart;
