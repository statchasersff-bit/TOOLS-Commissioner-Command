import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/KpiCard";
import { DataTable } from "@/components/DataTable";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getTeamTier, getTierColor, generateInsights } from "@/data/mockData";
import type { League, Team } from "@/types";
import { Trophy, Zap, Target, Calendar, Users, Medal, ArrowRight } from "lucide-react";

interface DashboardProps {
  league: League;
  userTeam: Team;
}

export function DashboardOverview({ league, userTeam }: DashboardProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const rank = sorted.findIndex((t) => t.id === userTeam.id) + 1;
  const tier = getTeamTier(userTeam.metrics.overall);
  const starterAges = userTeam.roster.filter((p) => p.starter);
  const avgAge = starterAges.length > 0 ? (starterAges.reduce((s, p) => s + p.age, 0) / starterAges.length).toFixed(1) : "N/A";
  const future1sts = userTeam.picks.filter((p) => p.round === 1).length;
  const playoffOdds = rank <= 6 ? Math.round(95 - (rank - 1) * 12) : Math.round(40 - (rank - 6) * 6);

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
      <SectionHeader title="Overview" subtitle={`${userTeam.name} - managed by ${userTeam.owner}`} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Team Rank" value={`#${rank}`} icon={Trophy} subtitle={`of ${league.teams.length}`} />
        <KpiCard label="Power Score" value={userTeam.metrics.overall} icon={Zap} subtitle="Overall rating" />
        <KpiCard label="Contender Tier" value={tier} icon={Medal} />
        <KpiCard label="Playoff Odds" value={`${Math.max(5, playoffOdds)}%`} icon={Target} trend={playoffOdds > 50 ? "up" : "down"} />
        <KpiCard label="Avg Starter Age" value={avgAge} icon={Calendar} trend={Number(avgAge) < 26 ? "up" : "down"} subtitle={Number(avgAge) < 26 ? "Young core" : "Veteran core"} />
        <KpiCard label="Future 1sts" value={future1sts} icon={Users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-6">
          <h3 className="text-base font-bold text-foreground mb-5 flex items-center gap-2">
            Strengths & Needs
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full" />
          </h3>
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
          <h3 className="text-base font-bold text-foreground mb-5 flex items-center gap-2">
            Contender Window
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full" />
          </h3>
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
        <h3 className="text-base font-bold text-foreground mb-5 flex items-center gap-2">
          Recent League Movement
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full" />
        </h3>
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
