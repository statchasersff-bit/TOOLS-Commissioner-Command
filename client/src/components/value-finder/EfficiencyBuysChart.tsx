import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import { POSITION_COLORS } from "@/lib/value-finder/types";
import { PlayerValueTooltip } from "./PlayerValueTooltip";
import { useBoxZoom } from "./useBoxZoom";
import { ZoomResetButton } from "./ZoomResetButton";

// Efficiency score (production per opportunity) vs market value. Strong efficiency
// at a low price reads as a buy window — the player is doing more with his touches
// than the market has priced in. `efficiencyScore` is the Advanced Stats Efficiency
// composite (0–1) overlaid during enrichment. Dots are colored by position.
export function EfficiencyBuysChart({
  players,
}: {
  players: ValueFinderPlayer[];
}) {
  const data = useMemo(
    () =>
      players
        .filter((p) => p.marketValue != null && p.efficiencyScore != null)
        .map((p) => ({
          x: Math.round((p.efficiencyScore ?? 0) * 100),
          y: p.marketValue,
          player: p,
        })),
    [players],
  );

  const zoom = useBoxZoom();

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Efficiency data is not available for this filter set yet.
      </p>
    );
  }

  return (
    <div className={zoom.enabled ? "relative select-none" : "relative"}>
      {zoom.isZoomed && <ZoomResetButton onReset={zoom.reset} />}
      <ResponsiveContainer width="100%" aspect={2.31}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }} {...zoom.zoomProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
          <XAxis
            type="number"
            dataKey="x"
            name="Efficiency"
            domain={zoom.xDomain ?? [0, 100]}
            allowDataOverflow
            tick={{ fontSize: 10 }}
            label={{ value: "Efficiency Score", position: "insideBottom", offset: -12, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Market"
            domain={zoom.yDomain}
            allowDataOverflow
            tick={{ fontSize: 10 }}
            width={48}
            label={{ value: "Dynasty Market Value", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PlayerValueTooltip metric="efficiency" />} />
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

export default EfficiencyBuysChart;
