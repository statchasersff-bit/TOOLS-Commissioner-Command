import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import type { League, Team } from "@/types";
import { buildAssetTiers, TIER_ORDER, type TierName } from "@/lib/gm-analytics";

interface Props { league: League; userTeam: Team; }

const TIER_COLORS: Record<TierName, { label: string; bar: string; text: string; bg: string; ring: string }> = {
  Elite: {
    label: "Elite",
    bar: "bg-[#d4af37]",
    text: "text-[#d4af37]",
    bg: "bg-[#d4af37]/10",
    ring: "ring-[#d4af37]/40",
  },
  Core: {
    // Light mode → StatChasers navy (brand). Dark/x-mode keep the legible
    // emerald they already used (navy would vanish on a dark canvas).
    label: "Core",
    bar: "bg-[#0b3978] dark-any:bg-emerald-500",
    text: "text-[#0b3978] dark-any:text-emerald-400",
    bg: "bg-[#0b3978]/10 dark-any:bg-emerald-500/10",
    ring: "ring-[#0b3978]/30 dark-any:ring-emerald-500/30",
  },
  Flex: {
    label: "Flex",
    bar: "bg-blue-500",
    text: "text-blue-500 dark:text-blue-400",
    bg: "bg-blue-500/10",
    ring: "ring-blue-500/30",
  },
  Depth: {
    label: "Depth",
    bar: "bg-slate-400",
    text: "text-slate-500 dark:text-slate-300",
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/30",
  },
  Lottery: {
    label: "Lottery",
    bar: "bg-violet-500",
    text: "text-violet-500 dark:text-violet-400",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/30",
  },
};

export function TierBreakdown({ league, userTeam }: Props) {
  const { getPlayerValue } = useValueModel();
  const result = useMemo(() => buildAssetTiers(userTeam, league, getPlayerValue), [league, userTeam, getPlayerValue]);

  const total = TIER_ORDER.reduce((s, t) => s + result.tiers[t].length, 0);

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-tier-breakdown">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Asset Tier Breakdown</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Bucketed by league-wide value percentiles.</p>
      </div>

      {/* Stacked summary bar */}
      <div className="space-y-1.5">
        <div className="flex items-center h-3 w-full rounded-md overflow-hidden bg-muted/30 ring-1 ring-border/40" data-testid="gm-tier-stack">
          {TIER_ORDER.map((t) => {
            const count = result.tiers[t].length;
            if (count === 0) return null;
            const pct = (count / Math.max(1, total)) * 100;
            return (
              <div
                key={t}
                className={cn("h-full", TIER_COLORS[t].bar)}
                style={{ width: `${pct}%` }}
                title={`${t} • ${count}`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          {TIER_ORDER.map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className={cn("inline-block w-2 h-2 rounded-sm", TIER_COLORS[t].bar)} />
              <span className="text-muted-foreground">{t}</span>
              <span className="font-semibold">{result.tiers[t].length}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Per-tier expanded cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {TIER_ORDER.map((t) => {
          const col = TIER_COLORS[t];
          const players = result.tiers[t];
          const positions = result.positionDistribution[t];
          return (
            <div
              key={t}
              className="sc-mini-card rounded-lg border border-border/40 bg-muted/20 p-3 flex flex-col gap-2 min-h-[140px]"
              data-testid={`gm-tier-card-${t}`}
            >
              <div className="flex items-center justify-between">
                <span className={cn(`sc-tier-badge-${t.toLowerCase()} text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1`, col.text, col.bg, col.ring)}>
                  {col.label}
                </span>
                <span className="text-xl font-bold tabular-nums">{players.length}</span>
              </div>

              {/* Mini positional row */}
              {players.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`gm-tier-pos-${t}`}>
                  {(["QB", "RB", "WR", "TE"] as const).map((pos) =>
                    positions[pos] > 0 ? (
                      <span key={pos} className="inline-flex items-center gap-0.5 px-1 rounded bg-muted/40">
                        <span className="font-bold text-foreground">{positions[pos]}</span>
                        {pos}
                      </span>
                    ) : null,
                  )}
                </div>
              )}

              {/* Top names */}
              <div className="space-y-0.5 text-[11px]">
                {players.length === 0 ? (
                  <p className="text-muted-foreground italic text-[10px]">None at this tier.</p>
                ) : (
                  players.slice(0, 4).map((p) => (
                    <p key={p.id} className="truncate">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground"> · {p.pos}</span>
                    </p>
                  ))
                )}
                {players.length > 4 && (
                  <p className="text-[10px] text-muted-foreground">+{players.length - 4} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
