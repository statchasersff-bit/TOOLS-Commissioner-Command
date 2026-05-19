import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import type { League, Team } from "@/types";
import { calculatePowerDifferentials } from "@/lib/gm-analytics";

interface Props { league: League; userTeam: Team; }

function deltaCls(delta: number): { text: string; bar: string; sign: string } {
  if (delta > 0) return { text: "text-emerald-500 dark:text-emerald-400", bar: "bg-emerald-500/70", sign: "+" };
  if (delta < 0) return { text: "text-rose-500 dark:text-rose-400", bar: "bg-rose-500/70", sign: "" };
  return { text: "text-muted-foreground", bar: "bg-muted-foreground/40", sign: "" };
}

function DiffRow({ label, delta, sub }: { label: string; delta: number; sub: string }) {
  const cls = deltaCls(delta);
  // Map -100..+100 onto bar widths centered at 50%
  const clamped = Math.max(-100, Math.min(100, delta));
  const absPct = Math.min(50, Math.abs(clamped) / 2);
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-32 text-xs">
        <p className="font-semibold leading-tight">{label}</p>
        <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
      </div>
      <div className="flex-1 relative h-2 rounded-full bg-muted/40 overflow-hidden">
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-border/60" />
        {delta >= 0 ? (
          <div className={cn("absolute h-full rounded-r-full", cls.bar)} style={{ left: "50%", width: `${absPct}%` }} />
        ) : (
          <div className={cn("absolute h-full rounded-l-full", cls.bar)} style={{ right: "50%", width: `${absPct}%` }} />
        )}
      </div>
      <span className={cn("w-16 text-right text-sm font-bold tabular-nums", cls.text)}>
        {cls.sign}{delta.toFixed(1)}%
      </span>
    </div>
  );
}

export function PowerDifferential({ league, userTeam }: Props) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const diff = useMemo(
    () => calculatePowerDifferentials(userTeam, league, getPlayerValue, getRedraftValue, getPickValue),
    [league, userTeam, getPlayerValue, getRedraftValue, getPickValue],
  );

  const sentence =
    diff.vsTopPct >= -5
      ? "You're in striking distance of the league favorite — championship contention is realistic."
      : diff.vsTopPct >= -15
        ? `You're ${Math.abs(diff.vsTopPct).toFixed(1)}% below the projected championship favorite — a smart trade or hot streak closes the gap.`
        : `You're ${Math.abs(diff.vsTopPct).toFixed(1)}% below the projected championship favorite — climbing here means meaningful upgrades.`;

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-power-differential">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">League Power Differential</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Where your dynasty value sits vs. league peers.</p>
      </div>

      <div className="space-y-1">
        <DiffRow label="vs league average" sub="Your dynasty value vs. mean" delta={diff.vsLeagueAvgPct} />
        <DiffRow label="vs championship favorite" sub="Top dynasty team in the league" delta={diff.vsTopPct} />
        <DiffRow label="vs playoff cutoff" sub="Team at the last playoff seed" delta={diff.vsCutoffPct} />
        <DiffRow label="vs worst team" sub="Floor of the league" delta={diff.vsWorstPct} />
      </div>

      <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-foreground/85" data-testid="gm-power-summary">
        {sentence}
      </div>

      {diff.closestTeam && (
        <div className="rounded-lg border border-[#0b3a7a]/30 dark:border-blue-500/30 bg-[#0b3a7a]/5 dark:bg-blue-500/5 p-3 flex items-center gap-3" data-testid="gm-power-closest">
          <Users className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Closest comparable team</p>
            <p className="text-sm font-bold truncate">{diff.closestTeam.name}</p>
            <p className="text-[11px] text-muted-foreground">
              Roster value ≈ yours. Watch this team — your build mirrors theirs.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
