import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import { PlayerValueTooltip } from "./PlayerValueTooltip";

const SKY = "hsl(205, 75%, 52%)";
const DIM = "hsl(220, 10%, 50%)";

// Horizontal bars ranked by rebuilderGap = rebuilderValue − marketValue.
export function RebuildTargetsChart({ players }: { players: ValueFinderPlayer[] }) {
  const data = useMemo(() => {
    return players
      .filter((p) => p.marketValue != null && p.rebuilderValue != null)
      .map((p) => ({
        name: p.playerName,
        gap: (p.rebuilderValue ?? 0) - (p.marketValue ?? 0),
        player: p,
        comparisonValue: p.rebuilderValue,
        comparisonLabel: "Rebuilder",
      }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 20)
      .reverse();
  }, [players]);

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Not enough data to rank rebuild targets.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`} />
        <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10 }} interval={0} />
        <ReferenceLine x={0} stroke="hsl(var(--border))" />
        <Tooltip cursor={{ fill: "hsl(var(--muted)/0.2)" }} content={<PlayerValueTooltip metric="rebuild" />} />
        <Bar dataKey="gap" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.player.playerId} fill={d.gap >= 0 ? SKY : DIM} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default RebuildTargetsChart;
