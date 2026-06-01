import type { ReactNode } from "react";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import { getValueSignal } from "@/lib/value-finder/valueFinderScoring";
import {
  fmtValue,
  fmtSignedPct,
  fmtPlayerMeta,
  fmtPpg,
  fmtScore,
  fmtPct,
} from "@/lib/value-finder/format";
import { ValueSignalBadge } from "./ValueSignalBadge";
import { ValueLabelBadge } from "./ValueLabelBadge";

export type TooltipMetric =
  | "ppg"
  | "usage"
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

  const comparison = datum.comparisonValue ?? p.modelValue;
  const { signal } = getValueSignal({
    marketValue: p.marketValue,
    comparisonValue: comparison,
  });

  const metricRow = (() => {
    switch (metric) {
      case "ppg":
        return ["PPG", fmtPpg(p.pointsPerGame)];
      case "usage":
        return ["Usage Score", fmtScore(p.usageScore)];
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
      {p.buySignals?.length ? (
        <div className="mt-1.5 text-[10px] text-emerald-600 dark-any:text-emerald-400">
          ▲ {p.buySignals.slice(0, 3).join(" · ")}
        </div>
      ) : null}
      {p.riskSignals?.length ? (
        <div className="mt-0.5 text-[10px] text-red-600 dark-any:text-red-400">
          ▼ {p.riskSignals.slice(0, 3).join(" · ")}
        </div>
      ) : null}
      <div className="mt-1.5">
        {p.finalLabel ? (
          <ValueLabelBadge label={p.finalLabel} />
        ) : (
          <ValueSignalBadge signal={signal} />
        )}
      </div>
    </div>
  );
}

export default PlayerValueTooltip;
