import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { League, Team } from "@/types";

interface Props { league: League; userTeam: Team; }

// Canonical position-identity colors, matched to the roster tables app-wide
// (QB rose, RB emerald, WR sky, TE orange). Picks use violet — our consistent
// "future value" hue (shared with the Picks column and the Lottery tier).
export const SLICE_COLORS: Record<string, string> = {
  QB: "#f43f5e",   // rose-500
  RB: "#10b981",   // emerald-500
  WR: "#0ea5e9",   // sky-500
  TE: "#f97316",   // orange-500
  Picks: "#8b5cf6", // violet-500
};

// Color a league rank by percentile (1 = best).
function rankColor(rank: number, totalTeams: number): string {
  if (totalTeams <= 1) return "text-muted-foreground";
  const pct = rank / totalTeams;
  if (rank === 1 || pct <= 0.34) return "text-emerald-500 dark:text-emerald-400";
  if (pct <= 0.66) return "text-amber-500 dark:text-amber-400";
  return "text-rose-500 dark:text-rose-400";
}

export function DynastyValueByPosition({ league, userTeam }: Props) {
  const { getPlayerValue, getPickValue } = useValueModel();
  const totalTeams = league.teams.length;

  const data = useMemo(() => {
    const byPos: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const p of userTeam.roster) {
      if (p.pos in byPos) byPos[p.pos] += getPlayerValue(p);
    }
    const picks = userTeam.picks.reduce((s, p) => s + getPickValue(p), 0);

    // League rank for userTeam by a per-team value accessor (1 = best).
    const rankFor = (valueOf: (t: Team) => number) => {
      const totals = league.teams.map((t) => ({ id: t.id, v: valueOf(t) }));
      totals.sort((a, b) => b.v - a.v);
      return (totals.findIndex((t) => t.id === userTeam.id) + 1) || totalTeams;
    };
    const posValue = (pos: string) => (t: Team) =>
      t.roster.filter((p) => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);

    return [
      { name: "QB", value: Math.round(byPos.QB), rank: rankFor(posValue("QB")) },
      { name: "RB", value: Math.round(byPos.RB), rank: rankFor(posValue("RB")) },
      { name: "WR", value: Math.round(byPos.WR), rank: rankFor(posValue("WR")) },
      { name: "TE", value: Math.round(byPos.TE), rank: rankFor(posValue("TE")) },
      { name: "Picks", value: Math.round(picks), rank: rankFor((t) => t.picks.reduce((s, p) => s + getPickValue(p), 0)) },
    ].filter((d) => d.value > 0);
  }, [league, userTeam, getPlayerValue, getPickValue, totalTeams]);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-dynasty-by-position">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Dynasty Value by Position</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Share, value, and league rank by position, including draft picks.</p>
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground py-10 text-center">No dynasty value to chart yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="relative h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={SLICE_COLORS[d.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* center total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold tabular-nums text-foreground leading-none">
                {total.toLocaleString()}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Total value</span>
            </div>
          </div>

          {/* breakdown: share + raw value + league rank per category */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              <span className="w-2.5 flex-shrink-0" />
              <span className="w-12">Pos</span>
              <span className="flex-1" />
              <span className="w-10 text-right">Share</span>
              <span className="w-16 text-right">Value</span>
              <span className="w-16 text-right">Lg rank</span>
            </div>
            {data
              .slice()
              .sort((a, b) => b.value - a.value)
              .map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs" data-testid={`gm-dvp-row-${d.name}`}>
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: SLICE_COLORS[d.name] ?? "#94a3b8" }}
                  />
                  <span className="w-12 font-semibold text-foreground">{d.name}</span>
                  <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(d.value / total) * 100}%`, background: SLICE_COLORS[d.name] ?? "#94a3b8" }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums text-muted-foreground">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                  <span className="w-16 text-right tabular-nums font-medium text-foreground">
                    {d.value.toLocaleString()}
                  </span>
                  <span className={cn("w-16 text-right tabular-nums font-bold", rankColor(d.rank, totalTeams))}>
                    #{d.rank}<span className="text-muted-foreground font-normal">/{totalTeams}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Card>
  );
}
