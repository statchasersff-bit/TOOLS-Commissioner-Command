import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getTeamTier, getTierColor, generateInsights } from "@/data/mockData";
import type { League, Team } from "@/types";
import { Trophy, Zap, Target, Calendar, Users, Medal, ArrowRight, Table, Lightbulb } from "lucide-react";

interface DashboardProps {
  league: League;
  userTeam: Team;
}

interface DashboardOverviewProps extends DashboardProps {
  onNavigate?: (mainTab: string, subTab: string) => void;
}

function getPercentileLabel(rank: number, total: number): string {
  const topPct = Math.round((rank / total) * 100);
  if (topPct <= 25) return `Top ${topPct}%`;
  if (topPct <= 50) return `Top ${topPct}%`;
  return `Bottom ${100 - topPct}%`;
}

function getPercentileColor(rank: number, total: number): string {
  const topPct = (rank / total) * 100;
  if (topPct <= 25) return "text-emerald-600 dark:text-emerald-400";
  if (topPct <= 50) return "text-blue-600 dark:text-blue-400";
  if (topPct <= 75) return "text-amber-600 dark:text-amber-400";
  return "text-red-500 dark:text-red-400";
}

function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case "Elite": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
    case "Contender": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800";
    case "Competitive": return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800";
    case "Rebuild": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800";
    default: return "bg-muted text-muted-foreground";
  }
}

interface SnapshotStatProps {
  label: string;
  value: string | number;
  context: string;
  contextColor?: string;
  icon: React.ElementType;
  testId: string;
}

function SnapshotStat({ label, value, context, contextColor, icon: Icon, testId }: SnapshotStatProps) {
  return (
    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/30 border border-border/40" data-testid={testId}>
      <div className="p-2 rounded-md bg-[#0b3a7a]/8 dark:bg-blue-400/10 mb-2.5">
        <Icon className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
      </div>
      <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-1.5">{label}</p>
      <p className={`text-[11px] font-medium mt-1 ${contextColor || "text-muted-foreground"}`}>{context}</p>
    </div>
  );
}

export function DashboardOverview({ league, userTeam, onNavigate }: DashboardOverviewProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const rank = sorted.findIndex((t) => t.id === userTeam.id) + 1;
  const total = league.teams.length;
  const tier = getTeamTier(userTeam.metrics.overall);
  const starterAges = userTeam.roster.filter((p) => p.starter);
  const avgAge = starterAges.length > 0 ? (starterAges.reduce((s, p) => s + p.age, 0) / starterAges.length).toFixed(1) : "N/A";
  const future1sts = userTeam.picks.filter((p) => p.round === 1).length;
  const playoffOdds = rank <= 6 ? Math.round(95 - (rank - 1) * 12) : Math.round(40 - (rank - 6) * 6);
  const clampedOdds = Math.max(5, playoffOdds);

  const leagueAvg1sts = Math.round(league.teams.reduce((s, t) => s + t.picks.filter(p => p.round === 1).length, 0) / total * 10) / 10;
  const leagueAvgAge = (league.teams.reduce((s, t) => {
    const st = t.roster.filter(p => p.starter);
    return s + (st.length > 0 ? st.reduce((a, p) => a + p.age, 0) / st.length : 0);
  }, 0) / total).toFixed(1);

  const positions: Array<{ pos: string; score: number; grade: string }> = [
    { pos: "QB", score: userTeam.metrics.qb, grade: userTeam.metrics.qb >= 75 ? "A" : userTeam.metrics.qb >= 60 ? "B" : userTeam.metrics.qb >= 40 ? "C" : "D" },
    { pos: "RB", score: userTeam.metrics.rb, grade: userTeam.metrics.rb >= 75 ? "A" : userTeam.metrics.rb >= 60 ? "B" : userTeam.metrics.rb >= 40 ? "C" : "D" },
    { pos: "WR", score: userTeam.metrics.wr, grade: userTeam.metrics.wr >= 75 ? "A" : userTeam.metrics.wr >= 60 ? "B" : userTeam.metrics.wr >= 40 ? "C" : "D" },
    { pos: "TE", score: userTeam.metrics.te, grade: userTeam.metrics.te >= 75 ? "A" : userTeam.metrics.te >= 60 ? "B" : userTeam.metrics.te >= 40 ? "C" : "D" },
  ];

  const movements = [
    { action: "Trade", detail: `${sorted[2]?.owner} traded a 2026 1st to ${sorted[5]?.owner}`, time: "2 days ago" },
    { action: "Waiver", detail: `${sorted[0]?.owner} picked up a free agent RB`, time: "3 days ago" },
    { action: "Trade", detail: `${sorted[7]?.owner} acquired a WR from ${sorted[1]?.owner}`, time: "5 days ago" },
    { action: "Drop", detail: `${sorted[4]?.owner} dropped a bench TE`, time: "1 week ago" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <SectionHeader title="Overview" subtitle={`${userTeam.name} - managed by ${userTeam.owner}`} className="mb-0" />
        {onNavigate && (
          <div className="flex items-center gap-1.5" data-testid="jump-to-menu">
            <span className="text-xs font-semibold text-muted-foreground mr-1">Jump to:</span>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2.5"
              onClick={() => onNavigate("dashboard", "snapshot")}
              data-testid="jump-to-snapshot"
            >
              <Table className="w-3 h-3 mr-1" />
              Snapshot
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2.5"
              onClick={() => onNavigate("dashboard", "key-insights")}
              data-testid="jump-to-insights"
            >
              <Lightbulb className="w-3 h-3 mr-1" />
              Insights
            </Button>
          </div>
        )}
      </div>

      <Card className="p-6" data-testid="team-snapshot-card">
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Team Snapshot</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SnapshotStat
            label="League Rank"
            value={`#${rank} / ${total}`}
            context={getPercentileLabel(rank, total)}
            contextColor={getPercentileColor(rank, total)}
            icon={Trophy}
            testId="snapshot-league-rank"
          />
          <SnapshotStat
            label="Power Score"
            value={userTeam.metrics.overall}
            context={getPercentileLabel(rank, total)}
            contextColor={getPercentileColor(rank, total)}
            icon={Zap}
            testId="snapshot-power-score"
          />
          <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/30 border border-border/40" data-testid="snapshot-tier">
            <div className="p-2 rounded-md bg-[#0b3a7a]/8 dark:bg-blue-400/10 mb-2.5">
              <Medal className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <Badge className={`text-sm font-bold px-3 py-0.5 border ${getTierBadgeClasses(tier)}`} data-testid="snapshot-tier-badge">
              {tier}
            </Badge>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-2">Tier</p>
            <p className={`text-[11px] font-medium mt-1 ${getTierColor(tier)}`}>
              {tier === "Elite" ? "Championship caliber" : tier === "Contender" ? "Playoff threat" : tier === "Competitive" ? "Fringe contender" : "Asset accumulation"}
            </p>
          </div>
          <SnapshotStat
            label="Playoff Odds"
            value={`${clampedOdds}%`}
            context={clampedOdds >= 60 ? "Strong outlook" : clampedOdds >= 40 ? "On the bubble" : "Long shot"}
            contextColor={clampedOdds >= 60 ? "text-emerald-600 dark:text-emerald-400" : clampedOdds >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400"}
            icon={Target}
            testId="snapshot-playoff-odds"
          />
          <SnapshotStat
            label="Starter Age"
            value={avgAge}
            context={`Lg avg: ${leagueAvgAge}`}
            contextColor={Number(avgAge) < Number(leagueAvgAge) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}
            icon={Calendar}
            testId="snapshot-starter-age"
          />
          <SnapshotStat
            label="Future 1sts"
            value={future1sts}
            context={`Lg avg: ${leagueAvg1sts}`}
            contextColor={future1sts >= leagueAvg1sts ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}
            icon={Users}
            testId="snapshot-future-1sts"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-6">
          <div className="mb-5">
            <h3 className="text-base font-bold text-foreground">Strengths & Needs</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-4">
            {positions.map((p) => (
              <div key={p.pos} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-7">{p.pos}</span>
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all bg-[#0b3a7a] dark:bg-blue-500"
                    style={{ width: `${p.score}%` }}
                  />
                </div>
                <Badge variant={p.grade === "A" ? "default" : p.grade === "B" ? "secondary" : "outline"}>
                  {p.grade}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground w-8 text-right">{p.score}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-5">
            <h3 className="text-base font-bold text-foreground">Contender Window</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-4">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-4xl font-bold text-[#0b3a7a] dark:text-blue-400">{userTeam.metrics.contenderWindowYears}</span>
              <span className="text-sm text-muted-foreground">years projected</span>
            </div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((y) => (
                <div
                  key={y}
                  className={`flex-1 h-10 rounded-md flex items-center justify-center text-xs font-semibold transition-colors ${
                    y <= userTeam.metrics.contenderWindowYears
                      ? "bg-[#0b3a7a] dark:bg-blue-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {2024 + y}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              Based on roster age, starter strength, and draft capital projection.
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Recent League Movement</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="space-y-1">
          {movements.map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
              <Badge variant={m.action === "Trade" ? "default" : "secondary"}>{m.action}</Badge>
              <span className="text-sm text-foreground flex-1">{m.detail}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{m.time}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function DashboardSnapshot({ league }: { league: League }) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);

  const columns = [
    { key: "rank", header: "#", sticky: true, render: (_: any, i: number) => <span className="font-bold text-muted-foreground">{i + 1}</span> },
    { key: "name", header: "Team", render: (row: any) => (
      <div>
        <span className="font-semibold text-foreground">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "overall", header: "Overall", render: (row: any) => <span className="font-bold text-lg">{row.metrics.overall}</span> },
    { key: "tier", header: "Tier", render: (row: any) => {
      const tier = getTeamTier(row.metrics.overall);
      return <Badge variant="outline" className={getTierColor(tier)}>{tier}</Badge>;
    }},
    { key: "starters", header: "Starters", render: (row: any) => row.metrics.starters },
    { key: "depth", header: "Depth", render: (row: any) => row.metrics.depth },
    { key: "youth", header: "Youth", render: (row: any) => row.metrics.youth },
    { key: "picks", header: "Picks", render: (row: any) => row.metrics.picks },
    { key: "action", header: "", render: () => (
      <Button variant="ghost" size="sm" data-testid="button-view-team">
        View <ArrowRight className="w-3 h-3 ml-1" />
      </Button>
    )},
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="League Snapshot" subtitle="All teams ranked by overall power score" />
      <DataTable columns={columns} data={sorted} />
    </div>
  );
}

export function DashboardKeyInsights({ league, userTeam }: DashboardProps) {
  const insights = generateInsights(league, userTeam.id);

  return (
    <div className="space-y-8">
      <SectionHeader title="Key Insights" subtitle="Auto-generated analysis from league data" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map((insight, i) => (
          <InsightCallout key={i} text={insight.text} type={insight.type} />
        ))}
      </div>
    </div>
  );
}
