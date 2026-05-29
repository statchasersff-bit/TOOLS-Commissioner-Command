import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { Zap, Shield, TrendingUp, Star } from "lucide-react";
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
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();

  // Evaluate every team on its OPTIMAL (best-ball) lineup rather than the
  // manager's currently-set lineup, so Contender Strength / Bench Depth reflect
  // roster quality instead of lineup-setting mistakes. optimizeLineup rewrites
  // each player's `starter` flag; downstream helpers key off that flag.
  const optLeague = useMemo(() => {
    const rp = league.rosterPositions || [];
    if (rp.length === 0) return league;
    return { ...league, teams: league.teams.map((t) => ({ ...t, roster: optimizeLineup(t.roster, rp) })) };
  }, [league, optimizeLineup]);
  const optUserTeam = useMemo(
    () => optLeague.teams.find((t) => t.id === userTeam.id) ?? userTeam,
    [optLeague, userTeam],
  );

  const snap = useMemo(
    () => calculateStrengthSnapshot(optUserTeam, optLeague, getRedraftValue, getPlayerValue, getPickValue),
    [optUserTeam, optLeague, getRedraftValue, getPlayerValue, getPickValue],
  );

  // League comparison data for the mini bars — also optimal-lineup based.
  const starterVals = useMemo(
    () => optLeague.teams.map((t) => t.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0)),
    [optLeague, getRedraftValue],
  );
  const benchVals = useMemo(
    () => optLeague.teams.map((t) => t.roster.filter((p) => !p.starter && !p.onTaxi && !p.onReserve).reduce((s, p) => s + getPlayerValue(p), 0)),
    [optLeague, getPlayerValue],
  );
  const dynastyVals = useMemo(
    () => optLeague.teams.map((t) =>
      t.roster.reduce((s, p) => s + getPlayerValue(p), 0) + t.picks.reduce((s, p) => s + getPickValue(p), 0)),
    [optLeague, getPlayerValue, getPickValue],
  );
  const pickVals = useMemo(
    () => optLeague.teams.map((t) => t.picks.reduce((s, p) => s + getPickValue(p), 0)),
    [optLeague, getPickValue],
  );
  const starterAvg = Math.round(starterVals.reduce((s, v) => s + v, 0) / Math.max(1, starterVals.length));
  const starterBest = Math.max(0, ...starterVals);
  const benchAvg = Math.round(benchVals.reduce((s, v) => s + v, 0) / Math.max(1, benchVals.length));
  const benchBest = Math.max(0, ...benchVals);
  const dynastyAvg = Math.round(dynastyVals.reduce((s, v) => s + v, 0) / Math.max(1, dynastyVals.length));
  const dynastyBest = Math.max(0, ...dynastyVals);
  const pickAvg = Math.round(pickVals.reduce((s, v) => s + v, 0) / Math.max(1, pickVals.length));
  const pickBest = Math.max(0, ...pickVals);

  const starter = rankLabel(snap.starterRank, snap.totalTeams);
  const bench = rankLabel(snap.benchRank, snap.totalTeams);
  const dynastyRank = rankLabel(snap.dynastyRank, snap.totalTeams);
  const pickRank = rankLabel(snap.pickRank, snap.totalTeams);

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-roster-strength">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Roster Strength Profile</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Starters, depth, dynasty value &amp; draft capital.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Zap className="w-3.5 h-3.5 text-[#d4af37]" />}
          label="Contender Strength"
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
          icon={<TrendingUp className="w-3.5 h-3.5 text-blue-400" />}
          label="Dynasty Rank"
          value={`#${snap.dynastyRank}`}
          context={dynastyRank.label}
          contextCls={dynastyRank.cls}
        >
          <ComparisonBar yours={snap.dynastyValue} avg={dynastyAvg} best={dynastyBest} />
        </StatCard>

        <StatCard
          icon={<Star className="w-3.5 h-3.5 text-violet-400" />}
          label="Rookie Pick Strength"
          value={`#${snap.pickRank}`}
          context={pickRank.label}
          contextCls={pickRank.cls}
        >
          <ComparisonBar yours={snap.pickValue} avg={pickAvg} best={pickBest} />
        </StatCard>
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
