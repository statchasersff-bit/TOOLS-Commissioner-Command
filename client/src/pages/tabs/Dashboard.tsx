import { useState, useMemo, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, getTierTooltip, isContenderTier, isRebuilderTier, generateInsights, computeNowScore, computeFutureScore, getDynastyWindowLabel, getDynastyWindowSubtitle, getDynastyWindowColor } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team } from "@/types";
import { cn } from "@/lib/utils";
import { Trophy, Zap, Target, Calendar, Users, Medal, ArrowRight, ArrowUp, ArrowDown, ArrowUpDown, Table, ArrowRightLeft, Compass, Flame, Sprout, Archive, ChevronDown, ChevronUp, MapPin } from "lucide-react";

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
    case "Juggernaut": return "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40";
    case "Win-Now": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800";
    case "Future Powerhouse": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
    case "Pick Hoarder": return "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800";
    case "Taco": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800";
    case "Contender": return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800";
    case "Pretender": return "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800";
    case "Rebuilder": return "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800";
    case "Weak / Directionless": return "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800";
    case "Balanced": return "bg-slate-100 dark:bg-slate-900/40 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800";
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

function getDraftCapitalScore(team: Team, league: League): number {
  const total = league.teams.length;
  const sorted = [...league.teams].sort((a, b) => b.metrics.picks - a.metrics.picks);
  const pickRank = sorted.findIndex(t => t.id === team.id) + 1;
  const pct = 1 - (pickRank - 1) / total;
  return Math.round(pct * 100) / 10;
}

function getSuggestedDirection(team: Team, tier: string): string {
  const posScores = [
    { pos: "QB", score: team.metrics.qb },
    { pos: "RB", score: team.metrics.rb },
    { pos: "WR", score: team.metrics.wr },
    { pos: "TE", score: team.metrics.te },
  ];
  const weakest = posScores.reduce((min, p) => p.score < min.score ? p : min, posScores[0]);
  const strongest = posScores.reduce((max, p) => p.score > max.score ? p : max, posScores[0]);

  if (tier === "Taco") return "Sell everything for future picks and young players";
  if (tier === "Rebuilder") return "Target young upside players and stockpile future picks";
  if (tier === "Pick Hoarder") return "Package picks for an elite starter to accelerate the rebuild";
  if (tier === "Future Powerhouse") return "Hold and let the young core mature";
  if (tier === "Weak / Directionless") return "Choose a direction: sell aging assets or acquire picks";
  if (tier === "Pretender") return `Upgrade ${weakest.pos} or pivot toward a retool`;
  if (tier === "Juggernaut") return "Consolidate depth into elite starters to maximize your title window";
  if (tier === "Win-Now") return "Convert future assets into immediate production";

  if (strongest.score >= 85 && weakest.score <= 40) return `Trade ${strongest.pos} depth to upgrade ${weakest.pos}`;
  if (weakest.score < 30) return `Aggressively buy ${weakest.pos} depth`;
  if (weakest.score < 50) return `Target ${weakest.pos} upgrades in trades`;
  if (strongest.score >= 75 && weakest.score >= 50) return "Maintain balance and sell aging assets at peak value";
  return `Shore up ${weakest.pos} while your window is open`;
}

function getGrade(score: number): string {
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case "A": return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "B": return "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20";
    case "C": return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "D": return "text-red-500 dark:text-red-400 bg-red-500/10 border-red-500/20";
    default: return "text-muted-foreground";
  }
}

function ScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashboardOverview({ league, userTeam, onNavigate }: DashboardOverviewProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const rank = sorted.findIndex((t) => t.id === userTeam.id) + 1;
  const total = league.teams.length;
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const tierInfo = tierMap.get(userTeam.id);
  const tier = tierInfo?.tier ?? "Balanced";
  const tierDescription = tierInfo?.tierDescription ?? "";
  const starterAges = userTeam.roster.filter((p) => p.starter);
  const avgAge = starterAges.length > 0 ? (starterAges.reduce((s, p) => s + p.age, 0) / starterAges.length).toFixed(1) : "N/A";
  const future1sts = userTeam.picks.filter((p) => p.round === 1).length;

  // Compute playoff odds using the same blended formula as the Portfolio tab.
  // Blend actual standing (weighted more as the season progresses) with dynasty rank talent.
  const playoffSlots = Math.max(Math.floor(total / 2), 1);
  const sortedByRecord = [...league.teams].sort((a, b) => {
    const aW = a.wins ?? 0, bW = b.wins ?? 0;
    if (bW !== aW) return bW - aW;
    return (b.wins ?? 0) - (a.wins ?? 0);
  });
  const standing = sortedByRecord.findIndex((t) => t.id === userTeam.id) + 1 || rank;
  const totalGamesPlayed = (userTeam.wins ?? 0) + (userTeam.losses ?? 0) + (userTeam.ties ?? 0);
  const regularSeasonGames = 14;
  const seasonProgress = Math.min(totalGamesPlayed / regularSeasonGames, 1);

  let standingScore: number;
  if (total <= 1) {
    standingScore = 1;
  } else if (standing <= playoffSlots) {
    const comfortMargin = playoffSlots > 1 ? (playoffSlots - standing) / (playoffSlots - 1) : 1;
    standingScore = 0.55 + comfortMargin * 0.40;
  } else {
    const spotsBack = standing - playoffSlots;
    standingScore = 0.45 * (1 - spotsBack / Math.max(1, total - playoffSlots));
  }

  let talentScore: number;
  if (rank <= playoffSlots) {
    const comfortMargin = playoffSlots > 1 ? (playoffSlots - rank) / (playoffSlots - 1) : 1;
    talentScore = 0.55 + comfortMargin * 0.40;
  } else {
    const spotsBack = rank - playoffSlots;
    talentScore = 0.45 * (1 - spotsBack / Math.max(1, total - playoffSlots));
  }

  const standingWeight = 0.15 + 0.70 * seasonProgress;
  const talentWeight = 1 - standingWeight;
  const clampedOdds = Math.min(99, Math.max(1, Math.round((standingWeight * standingScore + talentWeight * talentScore) * 100)));

  const oddsContext = clampedOdds >= 70 ? "Strong outlook" : clampedOdds >= 50 ? "Favorable" : clampedOdds >= 35 ? "On the bubble" : "Long shot";
  const oddsColor = clampedOdds >= 60 ? "text-emerald-600 dark:text-emerald-400" : clampedOdds >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";

  const leagueAvg1sts = Math.round(league.teams.reduce((s, t) => s + t.picks.filter(p => p.round === 1).length, 0) / total * 10) / 10;
  const leagueAvgAge = (league.teams.reduce((s, t) => {
    const st = t.roster.filter(p => p.starter);
    return s + (st.length > 0 ? st.reduce((a, p) => a + p.age, 0) / st.length : 0);
  }, 0) / total).toFixed(1);

  const winNow = getWinNowScore(userTeam, league);
  const youth = getYouthScore(userTeam, league);
  const capital = getDraftCapitalScore(userTeam, league);
  const suggestedDirection = getSuggestedDirection(userTeam, tier);

  const nowScore = useMemo(() => computeNowScore(league.teams, userTeam), [league.teams, userTeam]);
  const futureScore = useMemo(() => computeFutureScore(league.teams, userTeam), [league.teams, userTeam]);
  const avgNow = useMemo(() => {
    const scores = league.teams.map(t => computeNowScore(league.teams, t));
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [league.teams]);
  const avgFuture = useMemo(() => {
    const scores = league.teams.map(t => computeFutureScore(league.teams, t));
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [league.teams]);
  const dynastyWindowLabel = getDynastyWindowLabel(nowScore, futureScore, avgNow, avgFuture);
  const dynastyWindowSubtitle = getDynastyWindowSubtitle(dynastyWindowLabel);
  const dynastyWindowColor = getDynastyWindowColor(dynastyWindowLabel);

  const positions: Array<{ pos: string; score: number; grade: string }> = [
    { pos: "QB", score: userTeam.metrics.qb, grade: getGrade(userTeam.metrics.qb) },
    { pos: "RB", score: userTeam.metrics.rb, grade: getGrade(userTeam.metrics.rb) },
    { pos: "WR", score: userTeam.metrics.wr, grade: getGrade(userTeam.metrics.wr) },
    { pos: "TE", score: userTeam.metrics.te, grade: getGrade(userTeam.metrics.te) },
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
              onClick={() => onNavigate("trade-center", "trade-calculator")}
              data-testid="jump-to-trade-calc"
            >
              <ArrowRightLeft className="w-3 h-3 mr-1" />
              Trade Calculator
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" data-testid="overview-top-row">
        <Card className="p-5 lg:col-span-4" data-testid="archetype-card">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Archetype</p>
          <div className="flex items-center gap-3 mb-2">
            <Badge className={`text-lg font-bold px-4 py-1 border ${getTierBadgeClasses(tier)}`} data-testid="archetype-badge">
              {tier}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="archetype-description">
            {tierDescription}
          </p>
        </Card>
        <div className="lg:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SnapshotStat
            label="Power Rank"
            value={`#${rank} / ${total}`}
            context={getPercentileLabel(rank, total)}
            contextColor={getPercentileColor(rank, total)}
            icon={Trophy}
            testId="snapshot-power-rank"
          />
          <SnapshotStat
            label="Playoff Odds"
            value={`${clampedOdds}%`}
            context={oddsContext}
            contextColor={oddsColor}
            icon={Target}
            testId="snapshot-playoff-odds"
          />
          <SnapshotStat
            label="Avg Starter Age"
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="p-5 lg:col-span-4" data-testid="team-identity-card">
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground">Team Identity</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-4">
            <div data-testid="identity-win-now">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-foreground">Win-Now</span>
                </div>
                <span className="text-lg font-bold text-foreground">{winNow} <span className="text-xs font-normal text-muted-foreground">/ 10</span></span>
              </div>
              <ScoreBar value={winNow} color="bg-orange-500" />
            </div>
            <div data-testid="identity-youth">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Sprout className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-semibold text-foreground">Long-Term</span>
                </div>
                <span className="text-lg font-bold text-foreground">{youth} <span className="text-xs font-normal text-muted-foreground">/ 10</span></span>
              </div>
              <ScoreBar value={youth} color="bg-emerald-500" />
            </div>
            <div data-testid="identity-draft-capital">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Archive className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                  <span className="text-sm font-semibold text-foreground">Draft Capital</span>
                </div>
                <span className="text-lg font-bold text-foreground">{capital} <span className="text-xs font-normal text-muted-foreground">/ 10</span></span>
              </div>
              <ScoreBar value={capital} color="bg-[#0b3a7a] dark:bg-blue-500" />
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-4" data-testid="strengths-needs-card">
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground">Strengths & Needs</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-3">
            {positions.map((p) => (
              <div key={p.pos} className="flex items-center gap-3" data-testid={`strength-${p.pos.toLowerCase()}`}>
                <span className="text-xs font-bold text-muted-foreground w-7">{p.pos}</span>
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all bg-[#0b3a7a] dark:bg-blue-500"
                    style={{ width: `${p.score}%` }}
                  />
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getGradeColor(p.grade)}`} data-testid={`grade-${p.pos.toLowerCase()}`}>
                  {p.grade}
                </span>
                <span className="text-xs font-medium text-muted-foreground w-6 text-right" data-testid={`score-${p.pos.toLowerCase()}`}>{p.score}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-4 flex flex-col gap-4">
          <Card className="p-5 flex-1" data-testid="dynasty-window-card">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-[#d4af37]" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Dynasty Window</span>
            </div>
            <p className={`text-xl font-bold leading-tight ${dynastyWindowColor}`} data-testid="dynasty-window-label">
              {dynastyWindowLabel}
            </p>
            <p className="text-xs text-muted-foreground mt-1" data-testid="dynasty-window-subtitle">
              {dynastyWindowSubtitle}
            </p>
          </Card>

          <Card className="p-5 flex-1" data-testid="suggested-direction-card">
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-4 h-4 text-[#d4af37]" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Suggested Direction</span>
            </div>
            <p className="text-sm font-semibold text-foreground leading-relaxed" data-testid="suggested-direction-text">
              "{suggestedDirection}"
            </p>
          </Card>

          <Card className="p-5 flex-1" data-testid="contender-window-card">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-[#d4af37]" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Contender Window</span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold text-[#0b3a7a] dark:text-blue-400">{userTeam.metrics.contenderWindowYears}</span>
              <span className="text-xs text-muted-foreground">years projected</span>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((y) => (
                <div
                  key={y}
                  className={`flex-1 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold transition-colors ${
                    y <= userTeam.metrics.contenderWindowYears
                      ? "bg-[#0b3a7a] dark:bg-blue-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {2024 + y}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

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
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <span className="font-bold text-sm w-6 text-right">{value}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
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

function SortableHeader({ label, mobileLabel, sortKey, activeSortKey, sortDir, onSort, className, rowSpan }: {
  label: string; mobileLabel?: string; sortKey: SortKey; activeSortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void; className?: string; rowSpan?: number;
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className={`px-2 sm:px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors bg-muted/30 dark:bg-muted/20 ${className || ""}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-${sortKey}`}
      rowSpan={rowSpan}
    >
      <span className="inline-flex items-center gap-1">
        {mobileLabel ? (<><span className="sm:hidden">{mobileLabel}</span><span className="hidden sm:inline">{label}</span></>) : label}
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
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const snapshotTierMap = useMemo(() => getLeagueTeamTiers(teams), [teams]);

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
    const picksTotals = [...teams].sort((a, b) => b.metrics.picks - a.metrics.picks);
    const ranks: Record<string, { redraftRank: number; dynastyRank: number; picksRank: number }> = {};
    redraftTotals.forEach((e, i) => { ranks[e.id] = { redraftRank: i + 1, dynastyRank: total, picksRank: total }; });
    dynastyTotals.forEach((e, i) => { if (ranks[e.id]) ranks[e.id].dynastyRank = i + 1; });
    picksTotals.forEach((t, i) => { if (ranks[t.id]) ranks[t.id].picksRank = i + 1; });
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

  const strengthProfiles = useMemo(() => {
    const positions = ["QB", "RB", "WR", "TE"] as const;
    const rosterPositions = league.rosterPositions || [];

    const dynastyByTeam: Record<string, Record<string, number>> = {};
    const redraftByTeam: Record<string, Record<string, number>> = {};

    teams.forEach(team => {
      const dyn: Record<string, number> = {};
      const rdf: Record<string, number> = {};
      positions.forEach(p => { dyn[p] = 0; rdf[p] = 0; });

      team.roster.forEach(player => {
        const pos = player.pos as string;
        if (positions.includes(pos as any)) {
          dyn[pos] += getPlayerValue(player);
        }
      });

      const optimized = rosterPositions.length > 0 ? optimizeLineup(team.roster, rosterPositions) : team.roster;
      optimized.filter(p => p.starter).forEach(player => {
        const pos = player.pos as string;
        if (positions.includes(pos as any)) {
          rdf[pos] += getRedraftValue(player);
        }
      });

      dynastyByTeam[team.id] = dyn;
      redraftByTeam[team.id] = rdf;
    });

    const dynastyRanks: Record<string, Record<string, number>> = {};
    const redraftRanks: Record<string, Record<string, number>> = {};
    positions.forEach(pos => {
      const dSorted = [...teams].sort((a, b) => (dynastyByTeam[b.id]?.[pos] ?? 0) - (dynastyByTeam[a.id]?.[pos] ?? 0));
      const rSorted = [...teams].sort((a, b) => (redraftByTeam[b.id]?.[pos] ?? 0) - (redraftByTeam[a.id]?.[pos] ?? 0));
      dSorted.forEach((t, i) => { if (!dynastyRanks[t.id]) dynastyRanks[t.id] = {}; dynastyRanks[t.id][pos] = i + 1; });
      rSorted.forEach((t, i) => { if (!redraftRanks[t.id]) redraftRanks[t.id] = {}; redraftRanks[t.id][pos] = i + 1; });
    });

    return { dynastyByTeam, redraftByTeam, dynastyRanks, redraftRanks };
  }, [teams, league.rosterPositions, getPlayerValue, getRedraftValue, optimizeLineup]);

  const overallRanks = useMemo(() => {
    const byOverall = [...teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
    const map: Record<string, number> = {};
    byOverall.forEach((t, i) => { map[t.id] = i + 1; });
    return map;
  }, [teams]);

  const sortedTeams = useMemo(() => {
    const accessor: Record<SortKey, (t: Team) => number | string> = {
      name: t => t.name.toLowerCase(),
      overall: t => t.metrics.overall,
      redraftRank: t => -(teamRanks.ranks[t.id]?.redraftRank ?? teamRanks.total),
      dynastyRank: t => -(teamRanks.ranks[t.id]?.dynastyRank ?? teamRanks.total),
      picks: t => -(teamRanks.ranks[t.id]?.picksRank ?? teamRanks.total),
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

  const colCount = 7;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="League Power Rankings"
        subtitle="League-wide roster rankings by redraft value, dynasty value, and draft capital."
      />

      <div className="overflow-x-auto rounded-md border border-border/60" data-testid="power-rankings-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              <SortableHeader label="Rank" sortKey="overall" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Team" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="px-2 sm:px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap bg-muted/30 dark:bg-muted/20">Tier</th>
              <SortableHeader label="Redraft" mobileLabel="Red" sortKey="redraftRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Dynasty" mobileLabel="Dyn" sortKey="dynastyRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Draft" mobileLabel="Pcks" sortKey="picks" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="bg-muted/30 dark:bg-muted/20" />
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team, idx) => {
              const rank = overallRanks[team.id] ?? idx + 1;
              const tier = snapshotTierMap.get(team.id)?.tier ?? "Balanced";
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
                    <td className={`px-1.5 sm:px-3 py-3.5 whitespace-nowrap ${isUser ? "bg-[#0b3a7a]/5 dark:bg-blue-400/8" : ""}`}>
                      <RankBadge rank={rank} />
                    </td>
                    <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {team.avatar ? (
                          <img
                            src={team.avatar}
                            alt={team.owner}
                            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                            data-testid={`img-avatar-ranking-${team.id}`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0"
                            data-testid={`img-avatar-ranking-${team.id}`}
                          >
                            {(team.owner || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className={`font-semibold text-foreground ${isUser ? "text-[#0b3a7a] dark:text-blue-400" : ""}`}>{team.owner}</span>
                        {isUser && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-[#0b3a7a] text-white dark:bg-blue-600" data-testid="your-team-badge">You</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap">
                      <Badge variant="outline" className={cn(getTierColor(tier), "cursor-default")} data-testid={`tier-badge-snapshot-${team.id}`}>
                        <span>{getTierEmoji(tier)} {tier}</span>
                      </Badge>
                    </td>
                    <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap border-l border-border/15" data-testid={`redraft-rank-${team.id}`}>
                      {(() => {
                        const r = teamRanks.ranks[team.id]?.redraftRank ?? teamRanks.total;
                        const topThird = Math.ceil(teamRanks.total / 3);
                        const bottomStart = teamRanks.total - topThird + 1;
                        return (
                          <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>
                            #{r}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap" data-testid={`dynasty-rank-${team.id}`}>
                      {(() => {
                        const r = teamRanks.ranks[team.id]?.dynastyRank ?? teamRanks.total;
                        const topThird = Math.ceil(teamRanks.total / 3);
                        const bottomStart = teamRanks.total - topThird + 1;
                        return (
                          <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>
                            #{r}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap border-l border-border/15" data-testid={`picks-rank-${team.id}`}>
                      {(() => {
                        const r = teamRanks.ranks[team.id]?.picksRank ?? teamRanks.total;
                        const topThird = Math.ceil(teamRanks.total / 3);
                        const bottomStart = teamRanks.total - topThird + 1;
                        return (
                          <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>
                            #{r}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      }
                    </td>
                  </tr>

                  {isExpanded && (() => {
                    const dynastyValues = strengthProfiles.dynastyByTeam[team.id] || {};
                    const redraftValues = strengthProfiles.redraftByTeam[team.id] || {};
                    const dRanks = strengthProfiles.dynastyRanks[team.id] || {};
                    const rRanks = strengthProfiles.redraftRanks[team.id] || {};
                    const maxDynasty = Math.max(...(["QB", "RB", "WR", "TE"] as const).flatMap(p => teams.map(t => strengthProfiles.dynastyByTeam[t.id]?.[p] ?? 0)), 1);
                    const maxRedraft = Math.max(...(["QB", "RB", "WR", "TE"] as const).flatMap(p => teams.map(t => strengthProfiles.redraftByTeam[t.id]?.[p] ?? 0)), 1);
                    return (
                      <tr className={`border-b border-border/20 ${rowBg}`} data-testid={`expanded-${team.id}`}>
                        <td colSpan={colCount} className="px-6 py-4">
                          <div className="flex flex-col md:flex-row gap-6">
                            <div className="flex-1">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Dynasty Roster Strength</p>
                              <p className="text-[10px] text-muted-foreground mb-3">Full roster dynasty value by position</p>
                              <div className="space-y-2.5">
                                {(["QB", "RB", "WR", "TE"] as const).map(pos => {
                                  const value = dynastyValues[pos] ?? 0;
                                  const pRank = dRanks[pos] ?? teams.length;
                                  const pct = maxDynasty > 0 ? (value / maxDynasty) * 100 : 0;
                                  return (
                                    <div key={pos} className="flex items-center gap-3" data-testid={`dynasty-profile-${team.id}-${pos.toLowerCase()}`}>
                                      <span className="text-xs font-bold w-6">{pos}</span>
                                      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden max-w-[200px]">
                                        <div className={`h-full rounded-full transition-all ${posBarColor(pRank)}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                                      </div>
                                      <span className="text-xs font-mono font-semibold w-14 text-right text-muted-foreground">{value.toLocaleString()}</span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${posRankColor(pRank)}`}>
                                        #{pRank}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex-1">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Redraft Roster Strength</p>
                              <p className="text-[10px] text-muted-foreground mb-3">Optimal starter redraft value by position</p>
                              <div className="space-y-2.5">
                                {(["QB", "RB", "WR", "TE"] as const).map(pos => {
                                  const value = redraftValues[pos] ?? 0;
                                  const pRank = rRanks[pos] ?? teams.length;
                                  const pct = maxRedraft > 0 ? (value / maxRedraft) * 100 : 0;
                                  return (
                                    <div key={pos} className="flex items-center gap-3" data-testid={`redraft-profile-${team.id}-${pos.toLowerCase()}`}>
                                      <span className="text-xs font-bold w-6">{pos}</span>
                                      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden max-w-[200px]">
                                        <div className={`h-full rounded-full transition-all ${posBarColor(pRank)}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                                      </div>
                                      <span className="text-xs font-mono font-semibold w-14 text-right text-muted-foreground">{value.toLocaleString()}</span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${posRankColor(pRank)}`}>
                                        #{pRank}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
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
