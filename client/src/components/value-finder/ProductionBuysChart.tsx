import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import { POSITION_COLORS } from "@/lib/value-finder/types";
import { PlayerValueTooltip } from "./PlayerValueTooltip";

// Production vs market value. Players below the production-implied curve (high
// PPG, low price) read as buys; above it as sells. Dots are colored by position;
// the buy/sell read is surfaced in the tooltip.
export function ProductionBuysChart({ players }: { players: ValueFinderPlayer[] }) {
  const data = useMemo(
    () =>
      players
        .filter((p) => p.marketValue != null && p.pointsPerGame != null)
        .map((p) => ({
          x: p.pointsPerGame,
          y: p.marketValue,
          player: p,
          comparisonValue: p.expectedValue,
          comparisonLabel: "Expected",
        })),
    [players],
  );

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Production data is not available for this filter set yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" aspect={2.31}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
        <XAxis
          type="number"
          dataKey="x"
          name="PPG"
          tick={{ fontSize: 10 }}
          label={{ value: "Points / Game", position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Market"
          tick={{ fontSize: 10 }}
          width={48}
          label={{ value: "Dynasty Market Value", angle: -90, position: "insideLeft", fontSize: 11 }}
        />
        <ZAxis range={[40, 40]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PlayerValueTooltip metric="ppg" />} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.player.playerId} fill={POSITION_COLORS[d.player.position]} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export default ProductionBuysChart;
