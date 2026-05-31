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

export type GapView = "all" | "buys" | "sells";

const BUY = "hsl(150, 65%, 45%)";
const SELL = "hsl(0, 70%, 55%)";

// Horizontal bar chart of model − market gaps. Top 25 by absolute gap, with a
// Buys / Sells / All toggle handled by the parent (passed as `view`).
export function MarketGapChart({
  players,
  view = "all",
}: {
  players: ValueFinderPlayer[];
  view?: GapView;
}) {
  const data = useMemo(() => {
    const rows = players
      .filter((p) => p.marketValue != null && p.modelValue != null)
      .map((p) => {
        const gap = (p.modelValue ?? 0) - (p.marketValue ?? 0);
        return {
          name: p.playerName,
          gap,
          player: p,
          comparisonValue: p.modelValue,
          comparisonLabel: "Model",
        };
      });
    const filtered =
      view === "buys"
        ? rows.filter((r) => r.gap > 0)
        : view === "sells"
          ? rows.filter((r) => r.gap < 0)
          : rows;
    return filtered
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 25)
      .reverse(); // recharts plots bottom-up
  }, [players, view]);

  if (!data.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        Not enough data to rank market gaps.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 22)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`} />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tick={{ fontSize: 10 }}
          interval={0}
        />
        <ReferenceLine x={0} stroke="hsl(var(--border))" />
        <Tooltip cursor={{ fill: "hsl(var(--muted)/0.2)" }} content={<PlayerValueTooltip metric="none" />} />
        <Bar dataKey="gap" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.player.playerId} fill={d.gap >= 0 ? BUY : SELL} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default MarketGapChart;
