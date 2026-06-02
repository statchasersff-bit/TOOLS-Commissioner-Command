import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  ReferenceLine,
  ReferenceArea,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ValueFinderPlayer, TrendWindow } from "@/lib/value-finder/types";
import { POSITION_COLORS } from "@/lib/value-finder/types";
import { getMarketTrend, getRoleTrend } from "@/lib/value-finder/trends";
import { PlayerValueTooltip } from "./PlayerValueTooltip";
import { useBoxZoom } from "./useBoxZoom";
import { ZoomResetButton } from "./ZoomResetButton";
import { useScatterLayout } from "./useScatterLayout";

// Quadrant scatter: role/production trend (x) vs market value trend (y). The
// quadrant region labels (below) describe each corner; dots are colored by
// position.
//  ┌ Hype Riser     │ Legit Riser ┐
//  └ Falling Asset  │ Hidden Riser┘
export function TrendRadarChart({
  players,
  trendWindow,
}: {
  players: ValueFinderPlayer[];
  trendWindow: TrendWindow;
}) {
  const data = useMemo(
    () =>
      players.map((p) => ({
        x: getRoleTrend(p),
        y: getMarketTrend(p, trendWindow),
        player: p,
        comparisonValue: p.modelValue,
        comparisonLabel: "Model",
      })),
    [players, trendWindow],
  );

  const zoom = useBoxZoom();
  const layout = useScatterLayout();

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
    <div className={zoom.enabled ? "relative select-none" : "relative"}>
      {zoom.isZoomed && <ZoomResetButton onReset={zoom.reset} />}
      {/* Quadrant labels */}
      <div className="pointer-events-none absolute inset-0 z-10 hidden sm:block">
        <div className="absolute top-2 right-3">{label("Legit Riser", "text-emerald-500")}</div>
        <div className="absolute top-2 left-12">{label("Hype Riser", "text-amber-500")}</div>
        <div className="absolute bottom-8 right-3">{label("Hidden Riser", "text-sky-500")}</div>
        <div className="absolute bottom-8 left-12">{label("Falling Asset", "text-red-500")}</div>
      </div>
      <ResponsiveContainer width="100%" {...layout.containerSize}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }} {...zoom.zoomProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
          <XAxis
            type="number"
            dataKey="x"
            name="Role Trend"
            domain={zoom.xDomain}
            allowDataOverflow
            tickCount={layout.xTickCount}
            tick={{ fontSize: layout.tickFontSize }}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            label={{ value: layout.isMobile ? "Role Trend" : "Role / Production Trend", position: "insideBottom", offset: -12, fontSize: layout.labelFontSize }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Value Trend"
            domain={zoom.yDomain}
            allowDataOverflow
            tick={{ fontSize: layout.tickFontSize }}
            width={layout.yAxisWidth}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            label={{ value: layout.isMobile ? "Value Trend" : "Dynasty Market Value Trend", angle: -90, position: "insideLeft", fontSize: layout.labelFontSize }}
          />
          <ZAxis range={layout.pointRange} />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PlayerValueTooltip metric="trend" />} />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.player.playerId} fill={POSITION_COLORS[d.player.position]} />
            ))}
          </Scatter>
          {zoom.dragRect && (
            <ReferenceArea
              x1={zoom.dragRect.x1}
              x2={zoom.dragRect.x2}
              y1={zoom.dragRect.y1}
              y2={zoom.dragRect.y2}
              strokeOpacity={0.3}
              fill="hsl(var(--foreground))"
              fillOpacity={0.08}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendRadarChart;
