import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { Zap, Shield, TrendingUp, Activity } from "lucide-react";
import type { League, Team } from "@/types";
import { calculateStrengthSnapshot } from "@/lib/gm-analytics";

interface Props { league: League; userTeam: Team; }

function rankLabel(rank: number, total: number): { label: string; cls: string } {
  if (total <= 1) return { label: "—", cls: "text-muted-foreground" };
  const pct = rank / total;
  if (rank === 1) return { label: "Best", cls: "text-emerald-500 dark:text-emerald-400" };
  if (pct <= 0.34) return { label: "Top tier", cls: "text-emerald-500 dark:text-emerald-400" };
  if (pct <= 0.66) return { label: "Mid pack", cls: "text-amber-500 dark:text-amber-400" };
  return { label: "Bottom tier", cls: "text-rose-500 dark:text-rose-400" };
}

function scoreLabel(score: number, thresholds: [number, number]): { label: string; cls: string } {
  const [hi, mid] = thresholds;
  if (score >= hi) return { label: "Elite", cls: "text-emerald-500 dark:text-emerald-400" };
  if (score >= mid) return { label: "Strong", cls: "text-blue-500 dark:text-blue-400" };
  if (score >= 50) return { label: "Average", cls: "text-amber-500 dark:text-amber-400" };
  return { label: "Risky", cls: "text-rose-500 dark:text-rose-400" };
}

function ComparisonBar({ yours, avg, best }: { yours: number; avg: number; best: number }) {
  const max = Math.max(1, yours, avg, best);
  const w = (v: number) => Math.max(1, Math.round((v / max) * 100));
  return (
    <div className="mt-2 space-y-1">
      <Row label="You" value={yours} widthPct={w(yours)} barCls="bg-[#0b3a7a] dark:bg-blue-500" />
      <Row label="Avg" value={avg} widthPct={w(avg)} barCls="bg-muted-foreground/40" />
      <Row label="Best" value={best} widthPct={w(best)} barCls="bg-[#d4af37]/70" />
    </div>
  );
}

function Row({ label, value, widthPct, barCls }: { label: string; value: number; widthPct: number; barCls: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width: `${widthPct}%` }} />
      </div>
      <span className="w-12 text-right text-[10px] tabular-nums text-muted-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

export function RosterStrengthProfile({ league, userTeam }: Props) {
  const { getPlayerValue, getRedraftValue } = useValueModel();
  const snap = useMemo(
    () => calculateStrengthSnapshot(userTeam, league, getRedraftValue, getPlayerValue),
    [userTeam, league, getRedraftValue, getPlayerValue],
  );

  // League comparison data for the mini bars.
  const starterVals = useMemo(
    () => league.teams.map((t) => t.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0)),
    [league, getRedraftValue],
  );
  const benchVals = useMemo(
    () => league.teams.map((t) => t.roster.filter((p) => !p.starter && !p.onTaxi && !p.onReserve).reduce((s, p) => s + getPlayerValue(p), 0)),
    [league, getPlayerValue],
  );
  const starterAvg = Math.round(starterVals.reduce((s, v) => s + v, 0) / Math.max(1, starterVals.length));
  const starterBest = Math.max(0, ...starterVals);
  const benchAvg = Math.round(benchVals.reduce((s, v) => s + v, 0) / Math.max(1, benchVals.length));
  const benchBest = Math.max(0, ...benchVals);

  const starter = rankLabel(snap.starterRank, snap.totalTeams);
  const bench = rankLabel(snap.benchRank, snap.totalTeams);
  const ceiling = scoreLabel(snap.ceilingScore, [85, 65]);
  const floor = scoreLabel(snap.floorScore, [85, 65]);
  const stability = scoreLabel(snap.stabilityScore, [80, 60]);

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-roster-strength">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Roster Strength Profile</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Starters vs depth, ceiling vs floor.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          icon={<Zap className="w-3.5 h-3.5 text-[#d4af37]" />}
          label="Starter Strength"
          value={`#${snap.starterRank}`}
          context={starter.label}
          contextCls={starter.cls}
        >
          <ComparisonBar yours={snap.starterStrength} avg={starterAvg} best={starterBest} />
        </StatCard>

        <StatCard
          icon={<Shield className="w-3.5 h-3.5 text-blue-400" />}
          label="Bench Depth"
          value={`#${snap.benchRank}`}
          context={bench.label}
          contextCls={bench.cls}
        >
          <ComparisonBar yours={snap.benchDepth} avg={benchAvg} best={benchBest} />
        </StatCard>

        <StatCard
          icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
          label="Weekly Ceiling"
          value={ceiling.label}
          context={`${snap.ceilingScore}/100`}
          contextCls={ceiling.cls}
        />

        <StatCard
          icon={<Shield className="w-3.5 h-3.5 text-sky-400" />}
          label="Weekly Floor"
          value={floor.label}
          context={`${snap.floorScore}/100`}
          contextCls={floor.cls}
        />

        <StatCard
          icon={<Activity className="w-3.5 h-3.5 text-violet-400" />}
          label="Lineup Stability"
          value={stability.label}
          context={`${snap.stabilityScore}/100`}
          contextCls={stability.cls}
        />
      </div>
    </Card>
  );
}

function StatCard({
  icon, label, value, context, contextCls, children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  context: string;
  contextCls: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sc-mini-card rounded-lg border border-border/40 bg-muted/20 p-3 flex flex-col">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-foreground leading-none">{value}</p>
      <p className={cn("mt-1 text-[11px] font-medium", contextCls)}>{context}</p>
      {children}
    </div>
  );
}
