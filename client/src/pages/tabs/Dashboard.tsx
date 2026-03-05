import { useState, useMemo, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getTeamTier, getTierColor, generateInsights } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team } from "@/types";
import { cn } from "@/lib/utils";
import { Trophy, Zap, Target, Calendar, Users, Medal, ArrowRight, ArrowUp, ArrowDown, ArrowUpDown, Table, Lightbulb, Compass, Flame, Sprout, Archive, ChevronDown, ChevronUp } from "lucide-react";

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

function getWinNowScore(team: Team, league: League): number {
  const sorted = [...league.teams].sort((a, b) => b.metrics.starters - a.metrics.starters);
  const starterRank = sorted.findIndex(t => t.id === team.id) + 1;
  const starterPct = 1 - (starterRank - 1) / league.teams.length;

  const depthSorted = [...league.teams].sort((a, b) => b.metrics.depth - a.metrics.depth);
  const depthRank = depthSorted.findIndex(t => t.id === team.id) + 1;
  const depthPct = 1 - (depthRank - 1) / league.teams.length;

  const raw = starterPct * 0.7 + depthPct * 0.3;
  return Math.round(raw * 100) / 10;
}

function getYouthScore(team: Team, league: League): number {
  const sorted = [...league.teams].sort((a, b) => b.metrics.youth - a.metrics.youth);
  const youthRank = sorted.findIndex(t => t.id === team.id) + 1;
  const youthPct = 1 - (youthRank - 1) / league.teams.length;

  const starters = team.roster.filter(p => p.starter);
  const avgAge = starters.length > 0 ? starters.reduce((s, p) => s + p.age, 0) / starters.length : 27;
  const ageFactor = Math.max(0, Math.min(1, (30 - avgAge) / 8));

  const raw = youthPct * 0.6 + ageFactor * 0.4;
  return Math.round(raw * 100) / 10;
}

function getDraftCapitalLevel(team: Team, league: League): "High" | "Medium" | "Low" {
  const total = league.teams.length;
  const sorted = [...league.teams].sort((a, b) => b.metrics.picks - a.metrics.picks);
  const pickRank = sorted.findIndex(t => t.id === team.id) + 1;
  const pct = pickRank / total;
  if (pct <= 0.33) return "High";
  if (pct <= 0.66) return "Medium";
  return "Low";
}

function getStrategy(winNow: number, youth: number, capital: "High" | "Medium" | "Low"): { label: string; color: string } {
  if (winNow >= 7 && youth >= 6) return { label: "Dynasty Powerhouse", color: "text-emerald-600 dark:text-emerald-400" };
  if (winNow >= 7) return { label: "Win-Now Contender", color: "text-blue-600 dark:text-blue-400" };
  if (winNow >= 5 && youth >= 5) return { label: "Soft Contender", color: "text-blue-500 dark:text-blue-400" };
  if (winNow >= 5) return { label: "Aging Contender", color: "text-amber-600 dark:text-amber-400" };
  if (youth >= 7 && capital === "High") return { label: "Rising Dynasty", color: "text-emerald-500 dark:text-emerald-400" };
  if (youth >= 6) return { label: "Youth Movement", color: "text-cyan-600 dark:text-cyan-400" };
  if (capital === "High") return { label: "Capital Rich Rebuild", color: "text-purple-600 dark:text-purple-400" };
  return { label: "Full Rebuild", color: "text-red-500 dark:text-red-400" };
}

function getDirection(team: Team): string {
  const posScores = [
    { pos: "QB", score: team.metrics.qb },
    { pos: "RB", score: team.metrics.rb },
    { pos: "WR", score: team.metrics.wr },
    { pos: "TE", score: team.metrics.te },
  ];
  const weakest = posScores.reduce((min, p) => p.score < min.score ? p : min, posScores[0]);
  const strongest = posScores.reduce((max, p) => p.score > max.score ? p : max, posScores[0]);

  if (weakest.score < 30) return `Aggressively buy ${weakest.pos} depth`;
  if (weakest.score < 50) return `Target ${weakest.pos} upgrades in trades`;
  if (strongest.score >= 75 && weakest.score >= 50) return `Maintain balance, sell aging assets at peak`;
  return `Shore up ${weakest.pos} while window is open`;
}

function ScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TeamIdentityCard({ league, userTeam }: DashboardProps) {
  const winNow = getWinNowScore(userTeam, league);
  const youth = getYouthScore(userTeam, league);
  const capital = getDraftCapitalLevel(userTeam, league);
  const strategy = getStrategy(winNow, youth, capital);
  const direction = getDirection(userTeam);

  const capitalColor = capital === "High" ? "text-emerald-600 dark:text-emerald-400" : capital === "Medium" ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";
  const capitalBg = capital === "High" ? "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-800" : capital === "Medium" ? "bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800" : "bg-red-100 dark:bg-red-900/40 border-red-200 dark:border-red-800";

  return (
    <Card className="p-6" data-testid="team-identity-card">
      <div className="mb-5">
        <h3 className="text-base font-bold text-foreground">Team Identity</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div data-testid="identity-win-now">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold text-foreground">Win-Now Score</span>
              </div>
              <span className="text-lg font-bold text-foreground">{winNow} <span className="text-xs font-normal text-muted-foreground">/ 10</span></span>
            </div>
            <ScoreBar value={winNow} color="bg-orange-500" />
          </div>

          <div data-testid="identity-youth">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Sprout className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-foreground">Youth Score</span>
              </div>
              <span className="text-lg font-bold text-foreground">{youth} <span className="text-xs font-normal text-muted-foreground">/ 10</span></span>
            </div>
            <ScoreBar value={youth} color="bg-emerald-500" />
          </div>

          <div data-testid="identity-draft-capital">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                <span className="text-sm font-semibold text-foreground">Draft Capital</span>
              </div>
              <Badge className={`text-xs font-bold border ${capitalBg} ${capitalColor}`} data-testid="identity-capital-badge">
                {capital}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="rounded-lg bg-muted/40 border border-border/50 p-5" data-testid="identity-strategy">
            <div className="flex items-center gap-2 mb-3">
              <Compass className="w-4 h-4 text-[#d4af37]" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Suggested Strategy</span>
            </div>
            <p className={`text-xl font-bold leading-tight ${strategy.color}`} data-testid="identity-strategy-label">
              {strategy.label}
            </p>
          </div>

          <div className="rounded-lg bg-[#0b3a7a]/5 dark:bg-blue-400/5 border border-[#0b3a7a]/10 dark:border-blue-400/10 p-4 mt-3" data-testid="identity-direction">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Suggested Direction</span>
            <p className="text-sm font-semibold text-foreground mt-1.5 leading-relaxed" data-testid="identity-direction-text">
              "{direction}"
            </p>
          </div>
        </div>
      </div>
    </Card>
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
              onClick={() => onNavigate("league-analyzer", "power-rankings")}
              data-testid="jump-to-rankings"
            >
              <Table className="w-3 h-3 mr-1" />
              Rankings
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2.5"
              onClick={() => onNavigate("league-analyzer", "key-insights")}
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

      <TeamIdentityCard league={league} userTeam={userTeam} />

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

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#d4af37]/15 text-[#d4af37] font-bold text-sm" data-testid="rank-badge-1">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-300/20 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400 font-bold text-sm" data-testid="rank-badge-2">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700/10 dark:bg-amber-600/15 text-amber-700 dark:text-amber-500 font-bold text-sm" data-testid="rank-badge-3">3</span>;
  return <span className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground font-semibold text-sm">{rank}</span>;
}

function PowerBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-[#0b3a7a] dark:bg-blue-500" : value >= 30 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2.5 min-w-[140px]">
      <span className="font-bold text-base w-7 text-right">{value}</span>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function posRankColor(rank: number): string {
  if (rank <= 3) return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  if (rank <= 7) return "text-amber-600 dark:text-amber-400 bg-amber-500/10";
  return "text-red-500 dark:text-red-400 bg-red-500/10";
}

function posBarColor(rank: number): string {
  if (rank <= 3) return "bg-emerald-500";
  if (rank <= 7) return "bg-amber-500";
  return "bg-red-400";
}

type SortKey = "name" | "overall" | "redraftRank" | "dynastyRank" | "picks";

function SortableHeader({ label, sortKey, activeSortKey, sortDir, onSort, className }: {
  label: string; sortKey: SortKey; activeSortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void; className?: string;
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className={`px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${className || ""}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-${sortKey}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

export function DashboardSnapshot({ league, userTeam }: DashboardProps) {
  const teams = league.teams;
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();
  const maxOverall = Math.max(...teams.map(t => t.metrics.overall), 1);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const teamRanks = useMemo(() => {
    const rosterPositions = league.rosterPositions || [];
    const total = teams.length;
    const redraftTotals = teams.map(t => {
      const roster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
      return { id: t.id, total: roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0) };
    }).sort((a, b) => b.total - a.total);
    const dynastyTotals = teams.map(t => ({
      id: t.id, total: t.roster.reduce((s, p) => s + getPlayerValue(p), 0),
    })).sort((a, b) => b.total - a.total);
    const ranks: Record<string, { redraftRank: number; dynastyRank: number }> = {};
    redraftTotals.forEach((e, i) => { ranks[e.id] = { redraftRank: i + 1, dynastyRank: total }; });
    dynastyTotals.forEach((e, i) => { if (ranks[e.id]) ranks[e.id].dynastyRank = i + 1; });
    return { ranks, total };
  }, [teams, league.rosterPositions, getPlayerValue, getRedraftValue, optimizeLineup]);

  const toggleRow = (teamId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const posRanks = useMemo(() => {
    const positions = ["qb", "rb", "wr", "te"] as const;
    const rankMap: Record<string, Record<string, number>> = {};
    positions.forEach(pos => {
      const sorted = [...teams].sort((a, b) => b.metrics[pos] - a.metrics[pos]);
      sorted.forEach((t, i) => {
        if (!rankMap[t.id]) rankMap[t.id] = {};
        rankMap[t.id][pos] = i + 1;
      });
    });
    return rankMap;
  }, [teams]);

  const sortedTeams = useMemo(() => {
    const accessor: Record<SortKey, (t: Team) => number | string> = {
      name: t => t.name.toLowerCase(),
      overall: t => t.metrics.overall,
      redraftRank: t => -(teamRanks.ranks[t.id]?.redraftRank ?? teamRanks.total),
      dynastyRank: t => -(teamRanks.ranks[t.id]?.dynastyRank ?? teamRanks.total),
      picks: t => t.metrics.picks,
    };
    return [...teams].sort((a, b) => {
      const va = accessor[sortKey](a);
      const vb = accessor[sortKey](b);
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [teams, sortKey, sortDir, teamRanks]);

  const leaders = useMemo(() => [
    { label: "Best QB Room", team: [...teams].sort((a, b) => b.metrics.qb - a.metrics.qb)[0] },
    { label: "Best RB Room", team: [...teams].sort((a, b) => b.metrics.rb - a.metrics.rb)[0] },
    { label: "Best WR Room", team: [...teams].sort((a, b) => b.metrics.wr - a.metrics.wr)[0] },
    { label: "Best TE Room", team: [...teams].sort((a, b) => b.metrics.te - a.metrics.te)[0] },
    { label: "Deepest Roster", team: [...teams].sort((a, b) => b.metrics.depth - a.metrics.depth)[0] },
    { label: "Most Draft Capital", team: [...teams].sort((a, b) => b.picks.length - a.picks.length)[0] },
  ], [teams]);

  const colCount = 8;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="League Power Rankings"
        subtitle="League-wide roster rankings by redraft value, dynasty value, and draft capital."
      />

      <div data-testid="league-dominators">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-foreground">League Dominators</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {leaders.map(({ label, team }) => (
            <Card key={label} className="p-3.5 hover-elevate" data-testid={`dominator-${label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-sm font-bold mt-1 truncate">{team.owner}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border/60" data-testid="power-rankings-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              <th className="sticky left-0 z-10 bg-muted/30 dark:bg-muted/20" rowSpan={2} />
              <th className="bg-muted/30 dark:bg-muted/20 cursor-pointer select-none hover:text-foreground transition-colors" rowSpan={2} onClick={() => handleSort("name")} data-testid="sort-name">
                <span className="inline-flex items-center gap-1 px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Team
                  {sortKey === "name" ? (
                    sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 opacity-30" />
                  )}
                </span>
              </th>
              <th className="px-3 py-1.5 text-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 uppercase tracking-widest border-b border-border/20 bg-muted/30 dark:bg-muted/20" colSpan={2} data-testid="col-group-strength">
                Team Strength
              </th>
              <th className="px-3 py-1.5 text-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 uppercase tracking-widest border-b border-border/20 bg-muted/30 dark:bg-muted/20 border-l border-border/30" colSpan={2} data-testid="col-group-roster">
                Roster Value
              </th>
              <th className="px-3 py-1.5 text-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 uppercase tracking-widest border-b border-border/20 bg-muted/30 dark:bg-muted/20 border-l border-border/30" colSpan={1} data-testid="col-group-capital">
                Draft Capital
              </th>
              <th className="bg-muted/30 dark:bg-muted/20" rowSpan={2} />
            </tr>
            <tr className="border-b border-border bg-muted/30 dark:bg-muted/20">
              <SortableHeader label="Power" sortKey="overall" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Tier</th>
              <SortableHeader label="Redraft" sortKey="redraftRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="border-l border-border/30" />
              <SortableHeader label="Dynasty" sortKey="dynastyRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Draft" sortKey="picks" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="border-l border-border/30" />
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team, idx) => {
              const rank = idx + 1;
              const tier = getTeamTier(team.metrics.overall);
              const isUser = team.id === userTeam.id;
              const isEven = idx % 2 === 0;
              const isExpanded = expandedRows.has(team.id);
              const rowBg = isUser
                ? "bg-[#0b3a7a]/5 dark:bg-blue-400/8"
                : isEven ? "bg-background" : "bg-muted/10 dark:bg-muted/5";

              const teamPosRanks = posRanks[team.id] || {};
              const topPositions = (["qb", "rb", "wr", "te"] as const)
                .map(p => ({ pos: p.toUpperCase(), rank: teamPosRanks[p] || 0 }))
                .filter(p => p.rank <= 3)
                .sort((a, b) => a.rank - b.rank);

              return (
                <Fragment key={team.id}>
                  <tr
                    className={`border-b border-border/20 transition-colors hover:bg-muted/20 dark:hover:bg-muted/15 cursor-pointer ${rowBg}`}
                    data-testid={`ranking-row-${team.id}`}
                    onClick={() => toggleRow(team.id)}
                  >
                    <td className={`px-4 py-3.5 whitespace-nowrap sticky left-0 z-10 ${isUser ? "bg-[#0b3a7a]/5 dark:bg-blue-400/8" : rowBg}`}>
                      <RankBadge rank={rank} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-foreground ${isUser ? "text-[#0b3a7a] dark:text-blue-400" : ""}`}>{team.name}</span>
                          <span className="text-xs text-muted-foreground">({team.owner})</span>
                          {isUser && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-[#0b3a7a] text-white dark:bg-blue-600" data-testid="your-team-badge">You</Badge>
                          )}
                        </div>
                        {topPositions.length > 0 && (
                          <div className="flex gap-1">
                            {topPositions.map(p => (
                              <span key={p.pos} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" data-testid={`badge-${team.id}-${p.pos.toLowerCase()}`}>
                                {p.pos} #{p.rank}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <PowerBar value={team.metrics.overall} max={maxOverall} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <Badge variant="outline" className={getTierColor(tier)}>{tier}</Badge>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap border-l border-border/15" data-testid={`redraft-rank-${team.id}`}>
                      {(() => {
                        const r = teamRanks.ranks[team.id]?.redraftRank ?? teamRanks.total;
                        const topThird = Math.ceil(teamRanks.total / 3);
                        const bottomStart = teamRanks.total - topThird + 1;
                        return (
                          <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>
                            #{r}<span className="text-xs text-muted-foreground font-normal"> / {teamRanks.total}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap" data-testid={`dynasty-rank-${team.id}`}>
                      {(() => {
                        const r = teamRanks.ranks[team.id]?.dynastyRank ?? teamRanks.total;
                        const topThird = Math.ceil(teamRanks.total / 3);
                        const bottomStart = teamRanks.total - topThird + 1;
                        return (
                          <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>
                            #{r}<span className="text-xs text-muted-foreground font-normal"> / {teamRanks.total}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap border-l border-border/15 font-medium">{team.metrics.picks}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      }
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className={`border-b border-border/20 ${rowBg}`} data-testid={`expanded-${team.id}`}>
                      <td colSpan={colCount} className="px-6 py-4">
                        <div className="flex flex-col md:flex-row gap-6">
                          <div className="flex-1">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Roster Strength Profile</p>
                            <div className="space-y-2.5">
                              {(["qb", "rb", "wr", "te"] as const).map(pos => {
                                const score = team.metrics[pos];
                                const pRank = teamPosRanks[pos] || teams.length;
                                return (
                                  <div key={pos} className="flex items-center gap-3" data-testid={`profile-${team.id}-${pos}`}>
                                    <span className="text-xs font-bold w-6 uppercase">{pos}</span>
                                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden max-w-[200px]">
                                      <div className={`h-full rounded-full transition-all ${posBarColor(pRank)}`} style={{ width: `${score}%` }} />
                                    </div>
                                    <span className="text-sm font-bold w-8 text-right">{score}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${posRankColor(pRank)}`}>
                                      #{pRank}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex-1">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Position Rank Heat Map</p>
                            <div className="grid grid-cols-4 gap-2">
                              {(["qb", "rb", "wr", "te"] as const).map(pos => {
                                const pRank = teamPosRanks[pos] || teams.length;
                                return (
                                  <div key={pos} className={`text-center p-3 rounded-lg ${posRankColor(pRank)}`} data-testid={`heatmap-${team.id}-${pos}`}>
                                    <p className="text-[10px] font-bold uppercase">{pos}</p>
                                    <p className="text-xl font-bold mt-1">#{pRank}</p>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> 1-3</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 4-7</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> 8+</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const INSIGHT_CATEGORIES = [
  { id: "league-leaders" as const, label: "League Leaders", icon: Trophy, description: "Who dominates each position group" },
  { id: "draft-capital" as const, label: "Draft Capital", icon: Archive, description: "Future pick distribution across the league" },
  { id: "contender-analysis" as const, label: "Contender Analysis", icon: Flame, description: "Championship window and competitive landscape" },
  { id: "trade-opportunities" as const, label: "Trade Opportunities", icon: Target, description: "Positional weaknesses to exploit" },
  { id: "your-team" as const, label: "Your Team", icon: Compass, description: "Personalized insights for your roster" },
];

export function DashboardKeyInsights({ league, userTeam }: DashboardProps) {
  const insights = generateInsights(league, userTeam.id);

  return (
    <div className="space-y-8">
      <SectionHeader title="Key Insights" subtitle="Auto-generated analysis from league data" />

      {INSIGHT_CATEGORIES.map(({ id, label, icon: Icon, description }) => {
        const categoryInsights = insights.filter((i) => i.category === id);
        if (categoryInsights.length === 0) return null;

        return (
          <div key={id} data-testid={`insight-category-${id}`}>
            <div className="mb-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-[#0b3a7a]/8 dark:bg-blue-400/10">
                <Icon className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">{label}</h3>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-[52px]">
              {categoryInsights.map((insight, i) => (
                <InsightCallout key={i} text={insight.text} type={insight.type} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
