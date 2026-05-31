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

const GOLD = "hsl(43, 65%, 52%)";
const DIM = "hsl(220, 10%, 50%)";

// Horizontal bars ranked by contenderGap = contenderValue − marketValue.
// Highlights the strongest win-now discounts.
export function WinNowDiscountsChart({ players }: { players: ValueFinderPlayer[] }) {
  const data = useMemo(() => {
    return players
      .filter((p) => p.marketValue != null && p.contenderValue != null)
      .map((p) => ({
        name: p.playerName,
        gap: (p.contenderValue ?? 0) - (p.marketValue ?? 0),
        player: p,
        comparisonValue: p.contenderValue,
        comparisonLabel: "Contender",
      }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 20)
      .reverse();
  }, [players]);

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Not enough data to rank win-now discounts.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`} />
        <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10 }} interval={0} />
        <ReferenceLine x={0} stroke="hsl(var(--border))" />
        <Tooltip cursor={{ fill: "hsl(var(--muted)/0.2)" }} content={<PlayerValueTooltip metric="startRate" />} />
        <Bar dataKey="gap" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.player.playerId} fill={d.gap >= 0 ? GOLD : DIM} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default WinNowDiscountsChart;
