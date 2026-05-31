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
import { getValueSignal } from "@/lib/value-finder/valueFinderScoring";
import { PlayerValueTooltip } from "./PlayerValueTooltip";

const COLOR: Record<string, string> = {
  buy: "hsl(150, 65%, 45%)",
  sell: "hsl(0, 70%, 55%)",
  neutral: "hsl(220, 12%, 55%)",
};

// Usage score (role strength) vs market value. Strong usage at a low price reads
// as a buy window before production catches up. `usageValue` is the
// usage-implied expected value computed during enrichment.
export function UsageBuysChart({
  players,
}: {
  players: ValueFinderPlayer[];
}) {
  const data = useMemo(
    () =>
      players
        .filter((p) => p.marketValue != null && p.usageScore != null)
        .map((p) => {
          const expected = p.usageValue;
          const sig = getValueSignal({
            marketValue: p.marketValue,
            comparisonValue: expected,
          });
          const tone =
            sig.gapPercent >= 10 ? "buy" : sig.gapPercent <= -10 ? "sell" : "neutral";
          return {
            x: Math.round((p.usageScore ?? 0) * 100),
            y: p.marketValue,
            player: p,
            comparisonValue: expected,
            comparisonLabel: "Expected",
            tone,
          };
        }),
    [players, usageExpected],
  );

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Usage data is not available for this filter set yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Usage"
          domain={[0, 100]}
          tick={{ fontSize: 10 }}
          label={{ value: "Usage Score", position: "insideBottom", offset: -12, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Market"
          tick={{ fontSize: 10 }}
          width={48}
          label={{ value: "Market Value", angle: -90, position: "insideLeft", fontSize: 11 }}
        />
        <ZAxis range={[40, 40]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<PlayerValueTooltip metric="usage" />} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.player.playerId} fill={COLOR[d.tone]} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export default UsageBuysChart;
