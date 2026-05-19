import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import type { League, Team } from "@/types";
import { calculateAgeCurve, type AgeBand, type Position } from "@/lib/gm-analytics";

interface Props { league: League; userTeam: Team; }

function bandStyle(band: AgeBand): { text: string; bg: string; ring: string } {
  switch (band) {
    case "Young":
      return { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/30" };
    case "Prime":
      return { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/30" };
    case "Aging":
      return { text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10", ring: "ring-rose-500/30" };
  }
}

// Visual band scale per position, used to position the avg-age tick on a
// shared horizontal axis. We pick the bottom/top of each position's
// reasonable range so the bar feels position-aware.
const POS_AXIS: Record<Position, { min: number; max: number }> = {
  QB: { min: 21, max: 38 },
  RB: { min: 20, max: 32 },
  WR: { min: 20, max: 34 },
  TE: { min: 21, max: 35 },
};

export function AgeCurves({ league, userTeam }: Props) {
  const { getPlayerValue } = useValueModel();
  const curve = useMemo(
    () => calculateAgeCurve(userTeam, league, getPlayerValue),
    [league, userTeam, getPlayerValue],
  );

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-age-curves">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Age Curve Analysis</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Roster age health by position — meaningful contributors only.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]" data-testid="gm-age-rank-pills">
        <RankPill label="Youngest roster" rank={curve.youngestRank} total={curve.totalTeams} good="low" />
        <RankPill label="Oldest roster" rank={curve.oldestRank} total={curve.totalTeams} good="high" />
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border/40">
          <span className="text-muted-foreground">Weighted starter age:</span>
          <span className="font-semibold">{curve.weightedStarterAge.toFixed(1)}</span>
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border/40">
          <span className="text-muted-foreground">Whole roster:</span>
          <span className="font-semibold">{curve.weightedRosterAge.toFixed(1)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {curve.entries.map((e) => {
          const style = bandStyle(e.band);
          const axis = POS_AXIS[e.pos];
          const rangeLen = Math.max(1, axis.max - axis.min);
          const yourPct = Math.max(0, Math.min(100, ((e.avgAge - axis.min) / rangeLen) * 100));
          const leaguePct = Math.max(0, Math.min(100, ((e.leagueAvgAge - axis.min) / rangeLen) * 100));
          const delta = e.count > 0 && e.leagueAvgAge > 0 ? e.avgAge - e.leagueAvgAge : 0;
          return (
            <div
              key={e.pos}
              className="rounded-lg border border-border/40 bg-muted/20 p-3 flex flex-col gap-2"
              data-testid={`gm-age-card-${e.pos}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{e.pos}</span>
                <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1", style.text, style.bg, style.ring)}>
                  {e.band}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold leading-none tabular-nums">
                  {e.count > 0 ? e.avgAge.toFixed(1) : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {e.count > 0 ? `${e.count} contributors` : "no qualifying players"}
                </p>
              </div>

              {/* shared axis bar */}
              {e.count > 0 && (
                <div className="relative h-3 mt-1">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-muted/50" />
                  {/* league avg tick */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-muted-foreground/60 rounded"
                    style={{ left: `${leaguePct}%` }}
                    title={`League avg ${e.leagueAvgAge.toFixed(1)}`}
                  />
                  {/* your tick */}
                  <div
                    className={cn("absolute top-1/2 -translate-y-1/2 w-2 h-3 rounded-sm", style.bg, "ring-1", style.ring)}
                    style={{ left: `calc(${yourPct}% - 4px)` }}
                    title={`You ${e.avgAge.toFixed(1)}`}
                  />
                </div>
              )}

              {e.count > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  League avg <span className="font-semibold text-foreground">{e.leagueAvgAge.toFixed(1)}</span>{" "}
                  {Math.abs(delta) >= 0.2 && (
                    <span className={delta < 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}>
                      ({delta < 0 ? "−" : "+"}{Math.abs(delta).toFixed(1)} vs league)
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RankPill({ label, rank, total, good }: { label: string; rank: number; total: number; good: "low" | "high" }) {
  // good=low means rank 1 is desirable (youngest); good=high means rank 1 is least desirable (oldest)
  const isGood = good === "low" ? rank <= Math.ceil(total / 3) : rank <= Math.ceil(total / 3);
  const cls = isGood ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border/40">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-semibold", cls)}>
        #{rank}<span className="text-muted-foreground font-normal">/{total}</span>
      </span>
    </span>
  );
}
