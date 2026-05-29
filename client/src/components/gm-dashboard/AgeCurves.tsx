import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import type { League, Team } from "@/types";
import { calculateAgeCurve, type AgeBand } from "@/lib/gm-analytics";

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
        <p className="text-xs text-muted-foreground mt-2">Roster age health by position, across the entire roster.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {curve.entries.map((e) => {
          const style = bandStyle(e.band);
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
                  {e.count > 0 ? `${e.count} player${e.count === 1 ? "" : "s"}` : "no players"}
                </p>
              </div>

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
