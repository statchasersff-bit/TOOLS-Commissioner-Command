import type { ReactNode } from "react";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import {
  fmtValue,
  fmtSignedPct,
  fmtPlayerMeta,
  fmtPpg,
  fmtScore,
  fmtPct,
} from "@/lib/value-finder/format";
export type TooltipMetric =
  | "ppg"
  | "usage"
  | "efficiency"
  | "trend"
  | "startRate"
  | "rebuild"
  | "none";

interface TooltipDatum {
  player: ValueFinderPlayer;
  comparisonValue?: number;
  comparisonLabel?: string;
}

// Shared Recharts tooltip. Recharts injects `active` + `payload`; the plotted
// datum is expected to carry the full player (and optionally a tab-specific
// comparison value/label) on `payload[0].payload`.
export function PlayerValueTooltip({
  active,
  payload,
  metric = "none",
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipDatum }>;
  metric?: TooltipMetric;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  const p = datum?.player;
  if (!p) return null;

  const metricRow = (() => {
    switch (metric) {
      case "ppg":
        return ["PPG", fmtPpg(p.pointsPerGame)];
      case "usage":
        return ["Usage Score", fmtScore(p.usageScore)];
      case "efficiency":
        return ["Efficiency Score", fmtScore(p.efficiencyScore)];
      case "trend":
        return ["Role Trend", fmtSignedPct(p.roleTrend ?? p.usageTrend)];
      case "startRate":
        return ["Start Rate", fmtPct((p.startRate ?? 0) / 100)];
      case "rebuild":
        return ["Usage Trend", fmtSignedPct(p.usageTrend)];
      default:
        return null;
    }
  })();

  const row = (label: string, value: ReactNode) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-lg text-[11px] min-w-[180px]">
      <div className="font-bold text-foreground text-[12px]">{p.playerName}</div>
      <div className="text-muted-foreground mb-1.5">
        {fmtPlayerMeta(p.position, p.team, p.age)}
      </div>
      <div className="space-y-0.5">
        {row("Market", fmtValue(p.marketValue))}
        {metricRow && row(metricRow[0], metricRow[1])}
      </div>
    </div>
  );
}

export default PlayerValueTooltip;
