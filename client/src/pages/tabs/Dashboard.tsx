import { useState, useMemo, Fragment, lazy, Suspense } from "react";
const LeagueEconomyLazy = lazy(() => import("./LeagueEconomy").then(m => ({ default: m.LeagueEconomy })));
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, getTierTooltip, isContenderTier, isRebuilderTier, generateInsights, computeNowScore, computeFutureScore, getDynastyWindowLabel, getDynastyWindowSubtitle, getDynastyWindowColor } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team, Player, Pick } from "@/types";
import { formatPickLabel } from "@/types";
import { cn } from "@/lib/utils";
import { Trophy, Zap, Target, Calendar, Users, Medal, ArrowRight, ArrowUp, ArrowDown, ArrowUpDown, Table, ArrowRightLeft, Compass, Flame, Sprout, Archive, ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, MapPin, BarChart2, Grid3X3, List, LayoutDashboard, Activity, CheckCircle2, AlertTriangle, Coins, Settings2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlayerAvatar } from "@/components/PlayerAvatar";

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

function getSuggestedDirection(
  team: Team,
  tier: string,
  playoffOdds: number,
  windowStartOffset: number,
  getRedraftValue: (p: Player) => number,
  getPlayerValue: (p: Player) => number,
): string {
  const posScores = [
    { pos: "QB", score: team.metrics.qb },
    { pos: "RB", score: team.metrics.rb },
    { pos: "WR", score: team.metrics.wr },
    { pos: "TE", score: team.metrics.te },
  ];
  const weakest = posScores.reduce((min, p) => p.score < min.score ? p : min, posScores[0]);
  const strongest = posScores.reduce((max, p) => p.score > max.score ? p : max, posScores[0]);

  // Fixed tier-specific directions
  if (tier === "Taco") return "Sell everything for future picks and young players";
  if (tier === "Rebuilder") return "Target young upside players and stockpile future picks";
  if (tier === "Pick Hoarder") return "Package picks for an elite starter to accelerate the rebuild";
  if (tier === "Future Powerhouse") return "Hold and let the young core mature";
  if (tier === "Weak / Directionless") return "Choose a direction: sell aging assets or acquire picks";
  if (tier === "Juggernaut") return "Consolidate depth into elite starters to maximize your title window";
  if (tier === "Win-Now") return "Convert future assets into immediate production";

  // Low playoff odds — steer toward asset liquidation regardless of tier
  if (playoffOdds < 35) {
    // Starters aged 27+ with meaningful redraft value (peak & declining)
    const agingStarters = team.roster
      .filter(p => p.starter && p.age >= 27 && getRedraftValue(p) >= 1500)
      .sort((a, b) => getRedraftValue(b) - getRedraftValue(a));

    // Players whose redraft value meaningfully exceeds dynasty value (sell-high signals)
    const peakRedraftAssets = team.roster
      .filter(p => {
        const rd = getRedraftValue(p);
        const dyn = getPlayerValue(p);
        return rd >= 1200 && dyn > 0 && rd / dyn > 1.3;
      })
      .sort((a, b) => getRedraftValue(b) - getRedraftValue(a));

    if (windowStartOffset >= 2) {
      if (agingStarters.length >= 2) {
        const poses = [...new Set(agingStarters.slice(0, 2).map(p => p.pos))].join("/");
        return `Sell aging ${poses} starters at peak redraft value for picks and young talent`;
      }
      if (agingStarters.length === 1 && peakRedraftAssets.length > 0) {
        return `Move aging ${agingStarters[0].pos}s before their value drops. Convert to picks.`;
      }
      if (peakRedraftAssets.length > 0) {
        const pos = peakRedraftAssets[0].pos;
        return `Sell peak-redraft ${pos}s now. Their dynasty value will fade before your window opens.`;
      }
      if (strongest.score >= 70) {
        return `Unlikely to contend this year. Sell ${strongest.pos} depth for picks and young talent.`;
      }
      return "Pivot to rebuild: sell aging and high-risk assets at peak value and stack draft capital";
    }

    // Low odds, near-term window
    if (agingStarters.length > 0) {
      return `Sell aging ${agingStarters[0].pos} starters and high-risk assets to sharpen your roster`;
    }
    return "On the fringes. Sell high on peak-value players and retool toward your window.";
  }

  // Bubble (35–60%): focus on shoring up weaknesses to make a playoff push
  if (playoffOdds < 60) {
    if (strongest.score >= 85 && weakest.score <= 40) return `Trade ${strongest.pos} depth to upgrade ${weakest.pos}`;
    if (weakest.score < 40) return `Aggressively target ${weakest.pos} upgrades to push into playoff contention`;
    return `Shore up ${weakest.pos} to secure a playoff spot`;
  }

  // Competitive (60%+): maximize the current window
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
  const { getPlayerValue, getRedraftValue } = useValueModel();
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
  // Use league's actual playoff_teams setting (not a guess of total/2).
  const playoffSlots = league.playoffTeams ?? Math.max(2, Math.round(total / 3));
  const sortedByRecord = [...league.teams].sort((a, b) => {
    const aW = a.wins ?? 0, bW = b.wins ?? 0;
    if (bW !== aW) return bW - aW;
    // tiebreaker: more losses = fewer games played = worse, use losses ascending
    return (a.losses ?? 0) - (b.losses ?? 0);
  });
  const standing = sortedByRecord.findIndex((t) => t.id === userTeam.id) + 1 || rank;
  const totalGamesPlayed = (userTeam.wins ?? 0) + (userTeam.losses ?? 0) + (userTeam.ties ?? 0);
  const regularSeasonGames = league.regularSeasonWeeks ?? 14;
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

  // Use redraft starter rank for talent score — same as Portfolio tab.
  // This is more predictive of current-year performance than dynasty overall rank.
  const sortedByRedraft = [...league.teams].sort((a, b) => {
    const aVal = a.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
    const bVal = b.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
    return bVal - aVal;
  });
  const redraftRank = sortedByRedraft.findIndex(t => t.id === userTeam.id) + 1 || rank;

  let talentScore: number;
  if (redraftRank <= playoffSlots) {
    const comfortMargin = playoffSlots > 1 ? (playoffSlots - redraftRank) / (playoffSlots - 1) : 1;
    talentScore = 0.55 + comfortMargin * 0.40;
  } else {
    const spotsBack = redraftRank - playoffSlots;
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
  const suggestedDirection = getSuggestedDirection(userTeam, tier, clampedOdds, userTeam.metrics.windowStartOffset, getRedraftValue, getPlayerValue);

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
              <span className="text-2xl font-bold text-[#0b3a7a] dark:text-blue-400">
                {userTeam.metrics.windowStartOffset > 0
                  ? `~${new Date().getFullYear() + userTeam.metrics.windowStartOffset}`
                  : userTeam.metrics.contenderWindowYears}
              </span>
              <span className="text-xs text-muted-foreground">
                {userTeam.metrics.windowStartOffset > 0 ? "opens" : "years projected"}
              </span>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((offset) => {
                const year = new Date().getFullYear() + offset;
                const isInWindow = offset >= userTeam.metrics.windowStartOffset &&
                  offset < userTeam.metrics.windowStartOffset + userTeam.metrics.contenderWindowYears;
                return (
                  <div
                    key={offset}
                    className={`flex-1 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold transition-colors ${
                      isInWindow
                        ? "bg-[#0b3a7a] dark:bg-blue-600 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                    data-testid={`contender-year-${year}`}
                  >
                    {year}
                  </div>
                );
              })}
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

const POS_COLORS: Record<string, string> = {
  QB: "#f43f5e",
  RB: "#10b981",
  WR: "#3b82f6",
  TE: "#f97316",
};
const POS_LABELS = ["QB", "RB", "WR", "TE"] as const;

function hmBg(rank: number, total: number) {
  const topCut = Math.ceil(total * 0.25);
  const botCut = Math.floor(total * 0.75) + 1;
  if (rank <= topCut) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (rank >= botCut) return "bg-red-500/15 text-red-600 dark:text-red-400";
  return "text-muted-foreground";
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
type HmSortKey = "name" | "dynOverall" | "dynQB" | "dynRB" | "dynWR" | "dynTE" | "picks" | "redOverall" | "redQB" | "redRB" | "redWR" | "redTE";

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

function getScoutingStrengths(team: Team, leagueTeams: Team[]): string[] {
  const strengths: string[] = [];
  const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
    Math.round(leagueTeams.reduce((s, t) => s + t.metrics[key], 0) / leagueTeams.length);
  if (team.metrics.qb >= leagueAvg("qb") + 10) strengths.push("Elite QB room");
  if (team.metrics.rb >= leagueAvg("rb") + 10) strengths.push("Strong RB room");
  if (team.metrics.wr >= leagueAvg("wr") + 10) strengths.push("Elite WR corps");
  if (team.metrics.te >= leagueAvg("te") + 10) strengths.push("Strong TE room");
  if (team.metrics.youth >= 70) strengths.push("Strong youth profile");
  if (team.metrics.depth >= 70) strengths.push("Deep roster");
  if (team.picks.filter(p => p.round === 1).length >= 3) strengths.push("Loaded with 1st round picks");
  return strengths;
}

function getScoutingWeaknesses(team: Team, leagueTeams: Team[]): string[] {
  const weaknesses: string[] = [];
  const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
    Math.round(leagueTeams.reduce((s, t) => s + t.metrics[key], 0) / leagueTeams.length);
  if (team.metrics.qb < leagueAvg("qb") - 10) weaknesses.push("QB depth");
  if (team.metrics.rb < leagueAvg("rb") - 10) weaknesses.push("RB depth");
  if (team.metrics.wr < leagueAvg("wr") - 10) weaknesses.push("WR depth");
  if (team.metrics.te < leagueAvg("te") - 10) weaknesses.push("TE depth");
  if (team.metrics.youth < 40) weaknesses.push("Aging roster");
  if (team.picks.length <= 4) weaknesses.push("Limited draft capital");
  return weaknesses;
}

function getScoutingOutlook(team: Team, tierMap: Map<string, { tier: string }>): string {
  const tier = tierMap.get(team.id)?.tier ?? "Balanced";
  switch (tier) {
    case "Juggernaut": return "Championship contender, league problem";
    case "Win-Now": return "Built to win this year";
    case "Future Powerhouse": return "The future is bright. Loaded with assets.";
    case "Pick Hoarder": return "Stockpiling picks but roster needs work";
    case "Taco": return "Bottom of the barrel across the board";
    case "Contender": return "Strong team with enough dynasty value to stay competitive";
    case "Rebuilder": return "Not built to win now, but positioned to improve";
    case "Weak / Directionless": return "Lacking current strength and a clear long-term plan";
    default: return "Middle-of-the-pack without an extreme archetype";
  }
}

// ─── Scoring Settings Table ───────────────────────────────────────────────────

interface ScoringKeyDef {
  label: string;
  defaultVal: number | null;
  isYards?: boolean;
}

const SCORING_CONFIG: Record<string, ScoringKeyDef> = {
  pass_td:          { label: "Passing TD",           defaultVal: 4 },
  pass_yd:          { label: "Passing Yards",         defaultVal: 0.04, isYards: true },
  pass_int:         { label: "Interception",          defaultVal: -1 },
  pass_2pt:         { label: "Pass 2PT",              defaultVal: 2 },
  rush_td:          { label: "Rushing TD",            defaultVal: 6 },
  rush_yd:          { label: "Rushing Yards",         defaultVal: 0.1,  isYards: true },
  rush_2pt:         { label: "Rush 2PT",              defaultVal: 2 },
  rec_td:           { label: "Receiving TD",          defaultVal: 6 },
  rec_yd:           { label: "Receiving Yards",       defaultVal: 0.1,  isYards: true },
  rec:              { label: "Reception (PPR)",        defaultVal: 1 },
  rec_2pt:          { label: "Rec 2PT",               defaultVal: 2 },
  bonus_rec_te:     { label: "TE Premium",            defaultVal: null },
  fum:              { label: "Fumble",                defaultVal: 0 },
  fum_lost:         { label: "Fumble Lost",           defaultVal: -2 },
  fum_rec:          { label: "Fumble Recovery",       defaultVal: 2 },
  fum_rec_td:       { label: "Fumble Rec TD",         defaultVal: 6 },
  def_int:          { label: "Interception (DEF)",    defaultVal: 2 },
  def_td:           { label: "Defensive TD",          defaultVal: 6 },
  sack:             { label: "Sack (DEF)",            defaultVal: 1 },
  safe:             { label: "Safety",                defaultVal: 2 },
  ff:               { label: "Forced Fumble",         defaultVal: 1 },
  blk_kick:         { label: "Blocked Kick",          defaultVal: 2 },
  pts_allow_0:      { label: "PA 0",                  defaultVal: 10 },
  pts_allow_1_6:    { label: "PA 1–6",                defaultVal: 7 },
  pts_allow_7_13:   { label: "PA 7–13",               defaultVal: 4 },
  pts_allow_14_20:  { label: "PA 14–20",              defaultVal: 1 },
  pts_allow_21_27:  { label: "PA 21–27",              defaultVal: 0 },
  pts_allow_28_34:  { label: "PA 28–34",              defaultVal: -1 },
  pts_allow_35p:    { label: "PA 35+",                defaultVal: -4 },
  def_st_td:        { label: "DEF ST TD",             defaultVal: 6 },
  def_st_ff:        { label: "DEF ST Forced Fumble",  defaultVal: 1 },
  def_st_fum_rec:   { label: "DEF ST Fumble Rec",     defaultVal: 1 },
  st_td:            { label: "ST TD",                 defaultVal: 6 },
  st_ff:            { label: "ST Forced Fumble",      defaultVal: 1 },
  st_fum_rec:       { label: "ST Fumble Rec",         defaultVal: 1 },
};

function fmtScoringVal(val: number, isYards?: boolean): string {
  if (isYards) {
    if (val === 0) return "0";
    const per = Math.round(1 / val);
    return `1 per ${per} yds`;
  }
  return String(val);
}

function ScoringSettingsTable({ settings }: { settings: Record<string, number> }) {
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    return Object.entries(SCORING_CONFIG)
      .map(([key, def]) => {
        const leagueVal = settings[key] ?? null;
        const displayVal = leagueVal !== null ? fmtScoringVal(leagueVal, def.isYards) : "0";
        const defaultDisplay = def.defaultVal !== null ? fmtScoringVal(def.defaultVal, def.isYards) : "—";
        const isDifferent = def.defaultVal !== null
          ? leagueVal !== null ? leagueVal !== def.defaultVal : def.defaultVal !== 0
          : leagueVal !== null && leagueVal !== 0;
        return { key, label: def.label, displayVal, defaultDisplay, isDifferent, leagueVal };
      })
      .filter(r => r.leagueVal !== null || r.isDifferent)
      .sort((a, b) => {
        if (a.isDifferent && !b.isDifferent) return -1;
        if (!a.isDifferent && b.isDifferent) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [settings]);

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        data-testid="button-scoring-settings-toggle"
      >
        <Settings2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-grow">Scoring Settings</span>
        <span className="text-[10px] text-muted-foreground mr-1">
          {rows.filter(r => r.isDifferent).length > 0
            ? `${rows.filter(r => r.isDifferent).length} custom`
            : "standard"}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 bg-muted/10">
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground w-full">Setting</th>
                <th className="text-right px-4 py-2 font-semibold text-muted-foreground whitespace-nowrap">Value</th>
                <th className="text-right px-4 py-2 font-semibold text-muted-foreground whitespace-nowrap">Default</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b border-border/20 last:border-0",
                    row.isDifferent ? "bg-[#d4af37]/5" : i % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                  )}
                  data-testid={`scoring-row-${row.key}`}
                >
                  <td className="px-4 py-2 text-foreground/80">
                    <span className="flex items-center gap-1.5">
                      {row.isDifferent && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />
                      )}
                      {row.label}
                    </span>
                  </td>
                  <td className={cn(
                    "px-4 py-2 text-right font-semibold tabular-nums whitespace-nowrap",
                    row.isDifferent ? "text-[#d4af37]" : "text-foreground"
                  )}>
                    {row.displayVal}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                    {row.defaultDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── DashboardSnapshot ────────────────────────────────────────────────────────

export function DashboardSnapshot({ league, userTeam }: DashboardProps) {
  const teams = league.teams;
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"table" | "economy" | "chart" | "heatmap">("table");
  const [hmSortKey, setHmSortKey] = useState<HmSortKey>("dynOverall");
  const [hmSortDir, setHmSortDir] = useState<"asc" | "desc">("asc");
  const [hmExpandedRow, setHmExpandedRow] = useState<string | null>(null);

  function handleHmSort(key: HmSortKey) {
    if (hmSortKey === key) setHmSortDir(d => d === "asc" ? "desc" : "asc");
    else { setHmSortKey(key); setHmSortDir("asc"); }
  }

  const toggleHmRow = (teamId: string) =>
    setHmExpandedRow(prev => (prev === teamId ? null : teamId));

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

  // ── Chart view data ──────────────────────────────────────────────
  const chartTeams = useMemo(() => {
    return [...teams].map(t => {
      const vals = strengthProfiles.dynastyByTeam[t.id] || {};
      const total = POS_LABELS.reduce((s, p) => s + (vals[p] ?? 0), 0);
      return { team: t, vals, total };
    }).sort((a, b) => b.total - a.total);
  }, [teams, strengthProfiles.dynastyByTeam]);

  const chartMax = useMemo(() => Math.max(...chartTeams.map(c => c.total), 1), [chartTeams]);

  const heatmapTeams = useMemo(() => {
    const tr = teamRanks.ranks;
    const dr = strengthProfiles.dynastyRanks;
    const rr = strengthProfiles.redraftRanks;
    const n = teams.length;
    const accessor: Record<HmSortKey, (t: Team) => number | string> = {
      name:       t => t.owner.toLowerCase(),
      dynOverall: t => tr[t.id]?.dynastyRank ?? n,
      dynQB:      t => dr[t.id]?.["QB"] ?? n,
      dynRB:      t => dr[t.id]?.["RB"] ?? n,
      dynWR:      t => dr[t.id]?.["WR"] ?? n,
      dynTE:      t => dr[t.id]?.["TE"] ?? n,
      picks:      t => tr[t.id]?.picksRank ?? n,
      redOverall: t => tr[t.id]?.redraftRank ?? n,
      redQB:      t => rr[t.id]?.["QB"] ?? n,
      redRB:      t => rr[t.id]?.["RB"] ?? n,
      redWR:      t => rr[t.id]?.["WR"] ?? n,
      redTE:      t => rr[t.id]?.["TE"] ?? n,
    };
    return [...teams].sort((a, b) => {
      const va = accessor[hmSortKey](a);
      const vb = accessor[hmSortKey](b);
      if (typeof va === "number" && typeof vb === "number")
        return hmSortDir === "asc" ? va - vb : vb - va;
      return hmSortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [teams, teamRanks, strengthProfiles, hmSortKey, hmSortDir]);

  const hmRosterByTeamId = useMemo(() => {
    type HmRoster = { qbs: Player[]; rbs: Player[]; wrs: Player[]; tes: Player[]; picks: Pick[] };
    const byValue = (a: Player, b: Player) => (b.value ?? 0) - (a.value ?? 0);
    const map: Record<string, HmRoster> = {};
    for (const team of teams) {
      map[team.id] = {
        qbs:  [...team.roster.filter(p => p.pos === "QB")].sort(byValue),
        rbs:  [...team.roster.filter(p => p.pos === "RB")].sort(byValue),
        wrs:  [...team.roster.filter(p => p.pos === "WR")].sort(byValue),
        tes:  [...team.roster.filter(p => p.pos === "TE")].sort(byValue),
        picks: [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round),
      };
    }
    return map;
  }, [teams]);

  const thHeat = "px-2 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap bg-muted/30 dark:bg-muted/20";
  const thHeatLeft = "px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap bg-muted/30 dark:bg-muted/20";

  // ── View toggle ──────────────────────────────────────────────────
  const viewToggle = (
    <div className="grid flex-shrink-0" style={{ gridTemplateColumns: "repeat(4, 1fr)", height: 48, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4, minWidth: 0 }}>
      {([
        { id: "table",   icon: List,      label: "Table"    },
        { id: "economy", icon: Coins,     label: "Plot"     },
        { id: "chart",   icon: BarChart2, label: "Chart"    },
        { id: "heatmap", icon: Grid3X3,   label: "Heatmap"  },
      ] as const).map(({ id, icon: Icon, label }) => {
        const isActive = viewMode === id;
        return (
          <button
            key={id}
            onClick={() => setViewMode(id)}
            title={label}
            data-testid={`view-toggle-${id}`}
            className="relative flex items-center justify-center gap-1.5 font-semibold transition-all duration-200"
            style={{ borderRadius: 12, fontSize: 12, letterSpacing: "0.01em", background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent", color: isActive ? "#fff" : "rgba(203,213,225,0.45)", border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent", boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none", paddingLeft: 8, paddingRight: 8 }}
          >
            <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span>{label}</span>
            {isActive && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 24, height: 2, background: "#d4af37", opacity: 0.85 }} />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <SectionHeader
          title="League Power Rankings"
          subtitle="League-wide roster rankings by redraft value, dynasty value, and draft capital."
        />
        <div className="flex justify-center sm:justify-end">
          {viewToggle}
        </div>
      </div>

      {/* ── League format pills ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {(() => {
          const rp = league.rosterPositions || [];
          const starterCount = rp.filter(p => p !== "BN" && p !== "IR" && p !== "TAXI").length;
          const pills: Array<{ label: string; show: boolean }> = [
            { label: `${league.teams.length}-Team`,      show: true },
            { label: league.scoringFormat,               show: !!league.scoringFormat },
            { label: league.format ?? "1QB",             show: !league.scoringFormat?.includes(league.format ?? "1QB") },
            { label: `Start ${starterCount}`,            show: starterCount > 0 },
            { label: `Bench ${league.benchSlots}`,       show: (league.benchSlots ?? 0) > 0 },
            { label: `Taxi ${league.taxiSlots}`,         show: (league.taxiSlots ?? 0) > 0 },
            { label: "TEP",                              show: (league.tePremium ?? 0) > 0 },
          ];
          return pills.filter(p => p.show).map(p => (
            <span key={p.label} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
              {p.label}
            </span>
          ));
        })()}
      </div>

      {/* ── VIEW 1: Table ─────────────────────────────────────────── */}
      {viewMode === "table" && (
        <div className="overflow-x-auto rounded-md border border-border/60" data-testid="power-rankings-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40">
                <SortableHeader label="Rank" sortKey="overall" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Team" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <th className="px-2 sm:px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap bg-muted/30 dark:bg-muted/20">Tier</th>
                <SortableHeader label="Win-Now" mobileLabel="W-N" sortKey="redraftRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Dynasty" mobileLabel="Dyn" sortKey="dynastyRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Picks" mobileLabel="Pcks" sortKey="picks" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
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
                            <img src={team.avatar} alt={team.owner} className="w-6 h-6 rounded-full object-cover flex-shrink-0" data-testid={`img-avatar-ranking-${team.id}`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0" data-testid={`img-avatar-ranking-${team.id}`}>
                              {(team.owner || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className={`font-semibold text-foreground ${isUser ? "text-[#0b3a7a] dark:text-blue-400" : ""}`}>{team.owner}</span>
                          {isUser && <Badge className="text-[10px] px-1.5 py-0 bg-[#0b3a7a] text-white dark:bg-blue-600" data-testid="your-team-badge">You</Badge>}
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
                          return <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>#{r}</span>;
                        })()}
                      </td>
                      <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap" data-testid={`dynasty-rank-${team.id}`}>
                        {(() => {
                          const r = teamRanks.ranks[team.id]?.dynastyRank ?? teamRanks.total;
                          const topThird = Math.ceil(teamRanks.total / 3);
                          const bottomStart = teamRanks.total - topThird + 1;
                          return <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>#{r}</span>;
                        })()}
                      </td>
                      <td className="px-2 sm:px-4 py-3.5 whitespace-nowrap border-l border-border/15" data-testid={`picks-rank-${team.id}`}>
                        {(() => {
                          const r = teamRanks.ranks[team.id]?.picksRank ?? teamRanks.total;
                          const topThird = Math.ceil(teamRanks.total / 3);
                          const bottomStart = teamRanks.total - topThird + 1;
                          return <span className={cn("font-bold", r <= topThird ? "text-emerald-600 dark:text-emerald-400" : r >= bottomStart ? "text-red-500 dark:text-red-400" : "text-foreground")}>#{r}</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </td>
                    </tr>

                    {isExpanded && (() => {
                      const dRanks = strengthProfiles.dynastyRanks[team.id] || {};
                      const rRanks = strengthProfiles.redraftRanks[team.id] || {};
                      const total = teams.length;
                      const picksRank = teamRanks.ranks[team.id]?.picksRank ?? total;

                      const POS_CONFIG = [
                        { pos: "QB", textColor: "text-rose-500 dark:text-rose-400",    border: "border-rose-500/25",    bg: "bg-rose-500/5"    },
                        { pos: "RB", textColor: "text-emerald-500 dark:text-emerald-400", border: "border-emerald-500/25", bg: "bg-emerald-500/5" },
                        { pos: "WR", textColor: "text-sky-500 dark:text-sky-400",      border: "border-sky-500/25",     bg: "bg-sky-500/5"     },
                        { pos: "TE", textColor: "text-orange-500 dark:text-orange-400", border: "border-orange-500/25",  bg: "bg-orange-500/5"  },
                      ] as const;

                      function rankBadge(rank: number) {
                        const top = Math.ceil(total * 0.33);
                        const bot = Math.floor(total * 0.67) + 1;
                        const cls = rank <= top
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : rank >= bot
                          ? "text-red-500 dark:text-red-400 bg-red-500/10"
                          : "text-amber-600 dark:text-amber-400 bg-amber-500/10";
                        return <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${cls}`}>#{rank}</span>;
                      }

                      return (
                        <tr className={`border-b border-border/20 ${rowBg}`} data-testid={`expanded-${team.id}`}>
                          <td colSpan={colCount} className="px-3 sm:px-5 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">

                              {POS_CONFIG.map(({ pos, textColor, border, bg }) => {
                                const dynRank = dRanks[pos] ?? total;
                                const wnRank  = rRanks[pos]  ?? total;
                                const players = [...team.roster]
                                  .filter(p => p.pos === pos)
                                  .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
                                  .slice(0, 5);
                                return (
                                  <div key={pos} className={`rounded-lg border ${border} ${bg} p-2.5`} data-testid={`pos-col-${team.id}-${pos.toLowerCase()}`}>
                                    {/* Position header */}
                                    <div className="flex items-center justify-between mb-2">
                                      <span className={`text-xs font-black ${textColor}`}>{pos}</span>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-muted-foreground/60 font-medium">WN</span>
                                        {rankBadge(wnRank)}
                                        <span className="text-[9px] text-muted-foreground/60 font-medium ml-0.5">DYN</span>
                                        {rankBadge(dynRank)}
                                      </div>
                                    </div>
                                    {/* Player list */}
                                    <div className="space-y-1">
                                      {players.map((p, i) => (
                                        <div key={p.sleeperId ?? i} className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-[10px] text-muted-foreground/40 w-3 flex-shrink-0">{i + 1}</span>
                                          <span className="text-[11px] text-foreground truncate flex-1 font-medium">{p.name}</span>
                                          <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">{(getPlayerValue(p) / 1000).toFixed(1)}k</span>
                                        </div>
                                      ))}
                                      {players.length === 0 && (
                                        <p className="text-[10px] text-muted-foreground/50 italic">None rostered</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Picks column */}
                              <div className="rounded-lg border border-purple-500/25 bg-purple-500/5 p-2.5" data-testid={`pos-col-${team.id}-picks`}>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-black text-purple-500 dark:text-purple-400">Picks</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-muted-foreground/60 font-medium">RANK</span>
                                    {rankBadge(picksRank)}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  {team.picks.slice(0, 8).map((pick, i) => {
                                    const rd = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : pick.round === 3 ? "3rd" : `${pick.round}th`;
                                    return (
                                      <div key={i} className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[11px] text-foreground font-medium flex-shrink-0">{pick.year}</span>
                                        <span className="text-[11px] text-muted-foreground font-medium flex-shrink-0">{rd}</span>
                                        {pick.projectedRange && (
                                          <span className="text-[10px] text-muted-foreground/60 truncate ml-auto">{pick.projectedRange}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {team.picks.length > 8 && (
                                    <p className="text-[10px] text-muted-foreground/60">+{team.picks.length - 8} more</p>
                                  )}
                                  {team.picks.length === 0 && (
                                    <p className="text-[10px] text-muted-foreground/50 italic">No picks</p>
                                  )}
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
      )}

      {/* ── VIEW 1.5: Economy ─────────────────────────────────────── */}
      {viewMode === "economy" && (
        <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="text-sm text-muted-foreground">Loading…</span></div>}>
          <LeagueEconomyLazy league={league} />
        </Suspense>
      )}

      {/* ── VIEW 2: Stacked Position Value Chart ──────────────────── */}
      {viewMode === "chart" && (
        <div className="rounded-md border border-border/60 bg-card p-4 sm:p-6" data-testid="power-rankings-chart">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mb-5">
            {POS_LABELS.map(pos => (
              <div key={pos} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: POS_COLORS[pos] }} />
                <span className="text-xs font-semibold text-muted-foreground">{pos}</span>
              </div>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">Dynasty Roster Value by Position</span>
          </div>

          {/* Bars */}
          <div className="space-y-2">
            {chartTeams.map(({ team, vals, total }, idx) => {
              const isUser = team.id === userTeam.id;
              const barWidthPct = (total / chartMax) * 100;
              return (
                <div key={team.id} className="flex items-center gap-3" data-testid={`chart-row-${team.id}`}>
                  {/* Rank + Team label */}
                  <div className="flex items-center gap-2 w-36 sm:w-44 flex-shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground w-5 text-right">#{idx + 1}</span>
                    {team.avatar ? (
                      <img src={team.avatar} alt={team.owner} className="w-5 h-5 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0", isUser ? "bg-[#0b3a7a]/30 text-[#0b3a7a] dark:bg-blue-400/20 dark:text-blue-400" : "bg-muted text-muted-foreground")}>
                        {(team.owner || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className={cn("text-xs font-semibold truncate", isUser ? "text-[#0b3a7a] dark:text-blue-400" : "text-foreground")}>
                      {team.owner}
                    </span>
                    {isUser && <div className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />}
                  </div>

                  {/* Stacked bar */}
                  <div className="flex-1 h-6 bg-muted/40 rounded-md overflow-hidden relative">
                    <div className="h-full flex rounded-md overflow-hidden" style={{ width: `${Math.max(barWidthPct, 1)}%` }}>
                      {POS_LABELS.map(pos => {
                        const val = vals[pos] ?? 0;
                        const segPct = total > 0 ? (val / total) * 100 : 0;
                        return (
                          <Tooltip key={pos}>
                            <TooltipTrigger asChild>
                              <div
                                className="h-full transition-all"
                                style={{ width: `${segPct}%`, backgroundColor: POS_COLORS[pos] }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p className="font-semibold">{team.owner}: {pos}</p>
                              <p>Dynasty value: {Math.round(val).toLocaleString()}</p>
                              <p>League rank #{strengthProfiles.dynastyRanks[team.id]?.[pos] ?? "N/A"}</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>

                  {/* Total label */}
                  <span className="text-[11px] font-mono text-muted-foreground w-14 text-right flex-shrink-0">
                    {total >= 1000 ? `${(total / 1000).toFixed(0)}k` : total.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* X-axis legend */}
          <div className="mt-4 flex justify-between text-[10px] text-muted-foreground pl-[152px] sm:pl-[188px] pr-[60px]">
            <span>0</span>
            <span>{Math.round(chartMax / 2 / 1000)}k</span>
            <span>{Math.round(chartMax / 1000)}k</span>
          </div>
        </div>
      )}

      {/* ── VIEW 3: Heatmap ───────────────────────────────────────── */}
      {viewMode === "heatmap" && (
        <div className="space-y-3" data-testid="power-rankings-heatmap">
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className={thHeatLeft} rowSpan={2}>
                    <button onClick={() => handleHmSort("name")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors" data-testid="hm-sort-name">
                      Team {hmSortKey === "name" ? (hmSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </button>
                  </th>
                  <th
                    className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border-l-2 border-blue-400/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    colSpan={6}
                  >
                    Dynasty (Including Picks)
                  </th>
                  <th
                    className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border-l-2 border-[#d4af37]/50 bg-[#d4af37]/10 text-amber-700 dark:text-[#d4af37]"
                    colSpan={5}
                  >
                    Win-Now (Redraft Starters)
                  </th>
                </tr>
                <tr className="border-b border-border/40">
                  {([
                    { key: "dynOverall" as HmSortKey, label: "Overall", group: "dyn" as const, divider: true },
                    { key: "dynQB"      as HmSortKey, label: "QB",      group: "dyn" as const },
                    { key: "dynRB"      as HmSortKey, label: "RB",      group: "dyn" as const },
                    { key: "dynWR"      as HmSortKey, label: "WR",      group: "dyn" as const },
                    { key: "dynTE"      as HmSortKey, label: "TE",      group: "dyn" as const },
                    { key: "picks"      as HmSortKey, label: "Picks",   group: "dyn" as const },
                    { key: "redOverall" as HmSortKey, label: "Overall", group: "red" as const, divider: true },
                    { key: "redQB"      as HmSortKey, label: "QB",      group: "red" as const },
                    { key: "redRB"      as HmSortKey, label: "RB",      group: "red" as const },
                    { key: "redWR"      as HmSortKey, label: "WR",      group: "red" as const },
                    { key: "redTE"      as HmSortKey, label: "TE",      group: "red" as const },
                  ]).map(({ key, label, group, divider }) => (
                    <th key={key} className={cn(
                      "px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
                      group === "dyn"
                        ? "bg-blue-500/5 text-blue-700 dark:text-blue-300"
                        : "bg-[#d4af37]/8 text-amber-700 dark:text-[#d4af37]",
                      divider && group === "dyn" && "border-l-2 border-blue-400/40",
                      divider && group === "red" && "border-l-2 border-[#d4af37]/50",
                    )}>
                      <button onClick={() => handleHmSort(key)} className="inline-flex items-center gap-0.5 hover:opacity-80 transition-opacity" data-testid={`hm-sort-${key}`}>
                        {label}
                        {hmSortKey === key ? (hmSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapTeams.map((team, idx) => {
                  const isUser = team.id === userTeam.id;
                  const total = heatmapTeams.length;
                  const isEven = idx % 2 === 0;
                  const isExpanded = hmExpandedRow === team.id;
                  const rowBase = isUser
                    ? "bg-[#0b3a7a]/5 dark:bg-blue-400/8"
                    : isEven ? "bg-background" : "bg-muted/10 dark:bg-muted/5";

                  const overallRank = overallRanks[team.id] ?? idx + 1;
                  const dynRank = teamRanks.ranks[team.id]?.dynastyRank ?? total;
                  const redRank = teamRanks.ranks[team.id]?.redraftRank ?? total;
                  const pksRank = teamRanks.ranks[team.id]?.picksRank ?? total;
                  const dRanks = strengthProfiles.dynastyRanks[team.id] || {};
                  const rRanks = strengthProfiles.redraftRanks[team.id] || {};
                  const hmRoster = hmRosterByTeamId[team.id];

                  const hc = (rank: number, divider?: "dyn" | "red") => (
                    <td className={cn(
                      "px-2 py-2.5 text-center font-bold whitespace-nowrap",
                      hmBg(rank, total),
                      divider === "dyn" && "border-l-2 border-blue-400/30",
                      divider === "red" && "border-l-2 border-[#d4af37]/40",
                      rowBase,
                    )}>
                      #{rank}
                    </td>
                  );

                  return (
                    <Fragment key={team.id}>
                      <tr
                        className={cn("border-b border-border/20 cursor-pointer select-none", rowBase, isExpanded && "border-b-0")}
                        onClick={() => toggleHmRow(team.id)}
                        data-testid={`heatmap-row-${team.id}`}
                      >
                        <td className={cn("px-3 py-2.5 whitespace-nowrap", rowBase)}>
                          <div className="flex items-center gap-2">
                            <ChevronRight className={cn(
                              "w-3 h-3 flex-shrink-0 text-muted-foreground/40 transition-transform duration-150",
                              isExpanded && "rotate-90 text-muted-foreground/70",
                            )} />
                            {team.avatar ? (
                              <img src={team.avatar} alt={team.owner} className="w-5 h-5 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0", isUser ? "bg-[#0b3a7a]/20 text-[#0b3a7a] dark:bg-blue-400/20 dark:text-blue-400" : "bg-muted text-muted-foreground")}>
                                {(team.owner || "?").charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className={cn("font-semibold truncate max-w-[80px] sm:max-w-none", isUser ? "text-[#0b3a7a] dark:text-blue-400" : "text-foreground")}>
                              {team.owner}
                            </span>
                            {isUser && <div className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />}
                          </div>
                        </td>
                        {hc(dynRank, "dyn")}
                        {hc(dRanks["QB"] ?? total)}
                        {hc(dRanks["RB"] ?? total)}
                        {hc(dRanks["WR"] ?? total)}
                        {hc(dRanks["TE"] ?? total)}
                        {hc(pksRank)}
                        {hc(redRank, "red")}
                        {hc(rRanks["QB"] ?? total)}
                        {hc(rRanks["RB"] ?? total)}
                        {hc(rRanks["WR"] ?? total)}
                        {hc(rRanks["TE"] ?? total)}
                      </tr>

                      {isExpanded && hmRoster && (() => {
                        function hmRankBadge(rank: number) {
                          const top = Math.ceil(total * 0.33);
                          const bot = Math.floor(total * 0.67) + 1;
                          const cls = rank <= top
                            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                            : rank >= bot
                            ? "text-red-500 dark:text-red-400 bg-red-500/10"
                            : "text-amber-600 dark:text-amber-400 bg-amber-500/10";
                          return <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${cls}`}>#{rank}</span>;
                        }
                        return (
                          <tr className={cn("border-b border-border/20", rowBase)} data-testid={`heatmap-expanded-${team.id}`}>
                            <td colSpan={12} className="px-3 sm:px-5 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                                {([
                                  { pos: "QB", players: hmRoster.qbs, textColor: "text-rose-500 dark:text-rose-400",      border: "border-rose-500/25",    bg: "bg-rose-500/5"    },
                                  { pos: "RB", players: hmRoster.rbs, textColor: "text-emerald-500 dark:text-emerald-400", border: "border-emerald-500/25", bg: "bg-emerald-500/5" },
                                  { pos: "WR", players: hmRoster.wrs, textColor: "text-sky-500 dark:text-sky-400",        border: "border-sky-500/25",     bg: "bg-sky-500/5"     },
                                  { pos: "TE", players: hmRoster.tes, textColor: "text-orange-500 dark:text-orange-400",  border: "border-orange-500/25",  bg: "bg-orange-500/5"  },
                                ] as const).map(({ pos, players, textColor, border, bg }) => {
                                  const wnRank  = rRanks[pos] ?? total;
                                  const dynRank = dRanks[pos] ?? total;
                                  return (
                                    <div key={pos} className={`rounded-lg border ${border} ${bg} p-2.5`} data-testid={`hm-pos-col-${team.id}-${pos.toLowerCase()}`}>
                                      <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-black ${textColor}`}>{pos}</span>
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] text-muted-foreground/60 font-medium">WN</span>
                                          {hmRankBadge(wnRank)}
                                          <span className="text-[9px] text-muted-foreground/60 font-medium ml-0.5">DYN</span>
                                          {hmRankBadge(dynRank)}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        {players.length === 0 ? (
                                          <p className="text-[10px] text-muted-foreground/50 italic">None rostered</p>
                                        ) : (
                                          players.slice(0, 5).map((p, i) => (
                                            <div key={p.sleeperId ?? i} className="flex items-center gap-1.5 min-w-0">
                                              <span className="text-[10px] text-muted-foreground/40 w-3 flex-shrink-0">{i + 1}</span>
                                              <span className="text-[11px] text-foreground truncate flex-1 font-medium">{p.name}</span>
                                              <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">{(getPlayerValue(p) / 1000).toFixed(1)}k</span>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* Picks column */}
                                <div className="rounded-lg border border-purple-500/25 bg-purple-500/5 p-2.5" data-testid={`hm-pos-col-${team.id}-picks`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-black text-purple-500 dark:text-purple-400">Picks</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] text-muted-foreground/60 font-medium">RANK</span>
                                      {hmRankBadge(pksRank)}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {hmRoster.picks.length === 0 ? (
                                      <p className="text-[10px] text-muted-foreground/50 italic">No picks</p>
                                    ) : (
                                      hmRoster.picks.slice(0, 8).map((pick, i) => {
                                        const rd = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : pick.round === 3 ? "3rd" : `${pick.round}th`;
                                        return (
                                          <div key={i} className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[11px] text-foreground font-medium flex-shrink-0">{pick.year}</span>
                                            <span className="text-[11px] text-muted-foreground font-medium flex-shrink-0">{rd}</span>
                                            {pick.projectedRange && (
                                              <span className="text-[10px] text-muted-foreground/60 truncate ml-auto">{pick.projectedRange}</span>
                                            )}
                                          </div>
                                        );
                                      })
                                    )}
                                    {hmRoster.picks.length > 8 && (
                                      <p className="text-[10px] text-muted-foreground/60">+{hmRoster.picks.length - 8} more</p>
                                    )}
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

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/15 border border-emerald-500/30" /> Top 25%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-background border border-border/40" /> Middle 50%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-red-500/15 border border-red-500/30" /> Bottom 25%
            </span>
          </div>
        </div>
      )}


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

// ─── MyTeam: unified Overview + Roster Breakdown ────────────────────────────

function rankBg(rank: number, total: number) {
  const pct = rank / total;
  if (pct <= 0.33) return { bar: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
  if (pct <= 0.66) return { bar: "bg-amber-500",   badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
  return { bar: "bg-red-400", badge: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20" };
}

function percentileLabel(rank: number, total: number): string {
  const pct = Math.round((rank / total) * 100);
  if (pct <= 25) return `Top ${pct}%`;
  if (pct <= 50) return `Top ${pct}%`;
  return `Bot ${100 - pct}%`;
}

export function MyTeam({ league, userTeam, onNavigate }: DashboardOverviewProps) {
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();
  const [posGroupOpen, setPosGroupOpen] = useState(true);

  const total = league.teams.length;

  // ── Rank + odds (same as DashboardOverview) ───────────────────────────────
  const sorted = useMemo(() => [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall), [league.teams]);
  const rank = sorted.findIndex((t) => t.id === userTeam.id) + 1;

  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const tierInfo = tierMap.get(userTeam.id);
  const tier = tierInfo?.tier ?? "Balanced";
  const tierDescription = tierInfo?.tierDescription ?? "";

  const starterAges = userTeam.roster.filter((p) => p.starter);
  const avgAge = starterAges.length > 0
    ? (starterAges.reduce((s, p) => s + p.age, 0) / starterAges.length).toFixed(1)
    : "N/A";
  const future1sts = userTeam.picks.filter((p) => p.round === 1).length;

  const leagueAvg1sts = Math.round(league.teams.reduce((s, t) => s + t.picks.filter(p => p.round === 1).length, 0) / total * 10) / 10;
  const leagueAvgAge = (league.teams.reduce((s, t) => {
    const st = t.roster.filter(p => p.starter);
    return s + (st.length > 0 ? st.reduce((a, p) => a + p.age, 0) / st.length : 0);
  }, 0) / total).toFixed(1);

  const playoffSlots = league.playoffTeams ?? Math.max(2, Math.round(total / 3));
  const sortedByRecord = [...league.teams].sort((a, b) => {
    const aW = a.wins ?? 0, bW = b.wins ?? 0;
    if (bW !== aW) return bW - aW;
    return (a.losses ?? 0) - (b.losses ?? 0);
  });
  const standing = sortedByRecord.findIndex((t) => t.id === userTeam.id) + 1 || rank;
  const totalGamesPlayed = (userTeam.wins ?? 0) + (userTeam.losses ?? 0) + (userTeam.ties ?? 0);
  const regularSeasonGames = league.regularSeasonWeeks ?? 14;
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

  const sortedByRedraft = [...league.teams].sort((a, b) => {
    const aVal = a.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
    const bVal = b.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
    return bVal - aVal;
  });
  const redraftRank = sortedByRedraft.findIndex(t => t.id === userTeam.id) + 1 || rank;

  let talentScore: number;
  if (redraftRank <= playoffSlots) {
    const comfortMargin = playoffSlots > 1 ? (playoffSlots - redraftRank) / (playoffSlots - 1) : 1;
    talentScore = 0.55 + comfortMargin * 0.40;
  } else {
    const spotsBack = redraftRank - playoffSlots;
    talentScore = 0.45 * (1 - spotsBack / Math.max(1, total - playoffSlots));
  }

  const standingWeight = 0.15 + 0.70 * seasonProgress;
  const talentWeight = 1 - standingWeight;
  const clampedOdds = Math.min(99, Math.max(1, Math.round((standingWeight * standingScore + talentWeight * talentScore) * 100)));
  const oddsColor = clampedOdds >= 60 ? "text-emerald-600 dark:text-emerald-400" : clampedOdds >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";

  const winNow = getWinNowScore(userTeam, league);
  const youth = getYouthScore(userTeam, league);
  const capital = getDraftCapitalScore(userTeam, league);
  const suggestedDirection = getSuggestedDirection(userTeam, tier, clampedOdds, userTeam.metrics.windowStartOffset, getRedraftValue, getPlayerValue);

  const nowScore = useMemo(() => computeNowScore(league.teams, userTeam), [league.teams, userTeam]);
  const futureScore = useMemo(() => computeFutureScore(league.teams, userTeam), [league.teams, userTeam]);
  const avgNow = useMemo(() => { const s = league.teams.map(t => computeNowScore(league.teams, t)); return s.reduce((a, b) => a + b, 0) / s.length; }, [league.teams]);
  const avgFuture = useMemo(() => { const s = league.teams.map(t => computeFutureScore(league.teams, t)); return s.reduce((a, b) => a + b, 0) / s.length; }, [league.teams]);
  const dynastyWindowLabel = getDynastyWindowLabel(nowScore, futureScore, avgNow, avgFuture);
  const dynastyWindowColor = getDynastyWindowColor(dynastyWindowLabel);

  const strengths = useMemo(() => getScoutingStrengths(userTeam, league.teams), [userTeam, league.teams]);
  const weaknesses = useMemo(() => getScoutingWeaknesses(userTeam, league.teams), [userTeam, league.teams]);

  // ── Positional ranks (from RosterBreakdown) ───────────────────────────────
  const posRanks = useMemo(() => {
    const positions = ["QB", "RB", "WR", "TE"] as const;
    const rosterPositions = league.rosterPositions || [];
    const redraftRanks: Record<string, Record<string, number>> = {};
    const dynastyRanks: Record<string, Record<string, number>> = {};

    positions.forEach(pos => {
      const redraftTotals = league.teams.map(t => {
        const roster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
        const starters = roster.filter(p => p.starter && p.pos === pos);
        return { id: t.id, total: starters.reduce((s, p) => s + getRedraftValue(p), 0) };
      });
      redraftTotals.sort((a, b) => b.total - a.total);
      redraftTotals.forEach((entry, i) => {
        if (!redraftRanks[entry.id]) redraftRanks[entry.id] = {};
        redraftRanks[entry.id][pos] = i + 1;
      });

      const dynastyTotals = league.teams.map(t => {
        const allAtPos = t.roster.filter(p => p.pos === pos);
        return { id: t.id, total: allAtPos.reduce((s, p) => s + getPlayerValue(p), 0) };
      });
      dynastyTotals.sort((a, b) => b.total - a.total);
      dynastyTotals.forEach((entry, i) => {
        if (!dynastyRanks[entry.id]) dynastyRanks[entry.id] = {};
        dynastyRanks[entry.id][pos] = i + 1;
      });
    });

    return { redraftRanks, dynastyRanks };
  }, [league, getRedraftValue, getPlayerValue, optimizeLineup]);

  const positionData = (["QB", "RB", "WR", "TE"] as const).map(pos => ({
    pos,
    redraftRank: posRanks.redraftRanks[userTeam.id]?.[pos] ?? total,
    dynastyRank: posRanks.dynastyRanks[userTeam.id]?.[pos] ?? total,
    players: [...userTeam.roster.filter(p => p.pos === pos)]
      .sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0) || b.value - a.value),
  }));


  return (
    <div className="space-y-8">

      <SectionHeader title="Overview" subtitle={`${userTeam.name} · managed by ${userTeam.owner}`} />

      {/* ── 1. KPI STRIP ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="myteam-kpi-strip">
        {[
          {
            label: "Power Rank",
            value: `#${rank}`,
            sub: `of ${total}`,
            ctx: percentileLabel(rank, total),
            ctxColor: rankBg(rank, total).badge.split(" ").filter(c => c.startsWith("text-")).join(" "),
            icon: Trophy,
            testId: "kpi-power-rank",
          },
          {
            label: "Playoff Odds",
            value: `${clampedOdds}%`,
            sub: null,
            ctx: clampedOdds >= 70 ? "Strong outlook" : clampedOdds >= 50 ? "Favorable" : clampedOdds >= 35 ? "On the bubble" : "Long shot",
            ctxColor: oddsColor,
            icon: Target,
            testId: "kpi-playoff-odds",
          },
          {
            label: "Avg Starter Age",
            value: avgAge,
            sub: null,
            ctx: `Lg avg: ${leagueAvgAge}`,
            ctxColor: Number(avgAge) < Number(leagueAvgAge) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
            icon: Calendar,
            testId: "kpi-starter-age",
          },
          {
            label: "Future 1sts",
            value: future1sts,
            sub: null,
            ctx: `Lg avg: ${leagueAvg1sts}`,
            ctxColor: future1sts >= leagueAvg1sts ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
            icon: Users,
            testId: "kpi-future-1sts",
          },
        ].map(({ label, value, sub, ctx, ctxColor, icon: Icon, testId }) => (
          <Card key={label} className="p-4 flex items-center gap-3 hover-elevate" data-testid={testId}>
            <div className="p-2 rounded-lg bg-[#0b3a7a]/8 dark:bg-blue-400/10 flex-shrink-0">
              <Icon className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">{label}</p>
              <p className="text-xl font-black text-foreground leading-tight mt-0.5">
                {value}<span className="text-xs font-normal text-muted-foreground ml-0.5">{sub}</span>
              </p>
              <p className={cn("text-[11px] font-medium mt-0.5", ctxColor)}>{ctx}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* ── 5. POSITION GROUPS (single collapsible, columns per position) ──── */}
      <div data-testid="myteam-position-groups">
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">My Roster</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <Card className="overflow-hidden">
          {/* Header toggle */}
          <button
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
            onClick={() => setPosGroupOpen(v => !v)}
            data-testid="group-toggle-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">QB · RB · WR · TE · Picks</span>
              <Badge variant="secondary" className="text-xs">
                {positionData.reduce((s, d) => s + d.players.length, 0)} players · {userTeam.picks.length} picks
              </Badge>
            </div>
            {posGroupOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          </button>

          {posGroupOpen && (
            <div className="border-t border-border/40">
              {/* 5-column grid: 4 positions + picks */}
              <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-border/30">
                {positionData.map(({ pos, redraftRank, dynastyRank, players }) => {
                  const starters = players.filter(p => p.starter);
                  const bench    = players.filter(p => !p.starter);
                  const rStyle   = rankBg(redraftRank, total);
                  const dStyle   = rankBg(dynastyRank, total);
                  const posTextColor: Record<string, string> = {
                    QB: "text-rose-500 dark:text-rose-400",
                    RB: "text-emerald-500 dark:text-emerald-400",
                    WR: "text-sky-500 dark:text-sky-400",
                    TE: "text-orange-500 dark:text-orange-400",
                  };
                  const posBgColor: Record<string, string> = {
                    QB: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
                    RB: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                    WR: "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400",
                    TE: "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400",
                  };
                  return (
                    <div key={pos} className="flex flex-col" data-testid={`group-${pos.toLowerCase()}`}>
                      {/* Position header */}
                      <div className="px-3 pt-3 pb-2 border-b border-border/20">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("text-xs font-black uppercase tracking-widest", posTextColor[pos] ?? "text-foreground")}>{pos}</span>
                          <Badge variant="outline" className={cn("text-[10px] px-1 h-4 border", posBgColor[pos])}>{players.length}</Badge>
                        </div>
                      </div>

                      {/* Players */}
                      <div className="flex-1 px-3 py-2 space-y-0">
                        {players.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic py-1">None</p>
                        ) : (
                          <>
                            {starters.length > 0 && (
                              <>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider pt-1 pb-1">Starters</p>
                                {starters.map(p => (
                                  <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0" data-testid={`group-player-${p.id}`}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <PlayerAvatar id={p.sleeperId ?? p.id} name={p.name} pos={p.pos} team={p.team ?? ""} size="sm" compact />
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-semibold text-foreground leading-tight truncate">{p.name}</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">{p.team} · {p.age}y</p>
                                      </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums ml-1 flex-shrink-0">{p.value}</span>
                                  </div>
                                ))}
                              </>
                            )}
                            {bench.length > 0 && (
                              <>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider pt-2 pb-1">Bench</p>
                                {bench.map(p => (
                                  <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0" data-testid={`group-bench-${p.id}`}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <PlayerAvatar id={p.sleeperId ?? p.id} name={p.name} pos={p.pos} team={p.team ?? ""} size="sm" compact />
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-medium text-muted-foreground leading-tight truncate">{p.name}</p>
                                        <p className="text-[10px] text-muted-foreground/60 leading-tight">{p.team} · {p.age}y</p>
                                      </div>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground tabular-nums ml-1 flex-shrink-0">{p.value}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </div>

                      {/* Rank footer */}
                      <div className="px-3 py-2.5 border-t border-border/20 bg-muted/20 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Win-Now</span>
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", rStyle.badge)}>
                            #{redraftRank}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Dynasty</span>
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", dStyle.badge)}>
                            #{dynastyRank}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* ── Picks column ── */}
                {(() => {
                  const picks = [...userTeam.picks].sort((a, b) =>
                    a.year !== b.year ? a.year - b.year : a.round - b.round
                  );
                  const rankedTeams = [...league.teams].sort(
                    (a, b) => (b.metrics?.picks ?? 0) - (a.metrics?.picks ?? 0)
                  );
                  const picksRank = rankedTeams.findIndex(t => t.id === userTeam.id) + 1 || total;
                  const pStyle = rankBg(picksRank, total);
                  return (
                    <div className="flex flex-col" data-testid="group-picks">
                      {/* Header */}
                      <div className="px-3 pt-3 pb-2 border-b border-border/20">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black uppercase tracking-widest text-violet-500 dark:text-violet-400">Picks</span>
                          <Badge variant="outline" className="text-[10px] px-1 h-4 border bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400">
                            {picks.length}
                          </Badge>
                        </div>
                      </div>

                      {/* Pick list */}
                      <div className="flex-1 px-3 py-2 space-y-0">
                        {picks.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic py-1">None</p>
                        ) : picks.map((pk, i) => (
                          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-foreground leading-tight truncate">{formatPickLabel(pk)}</p>
                              {pk.projectedRange && (
                                <p className="text-[10px] text-muted-foreground leading-tight">{pk.projectedRange}</p>
                              )}
                            </div>
                            <span className="text-[10px] font-bold text-violet-500 dark:text-violet-400 tabular-nums ml-1 flex-shrink-0">{pk.value}</span>
                          </div>
                        ))}
                      </div>

                      {/* Rank footer */}
                      <div className="px-3 py-2.5 border-t border-border/20 bg-muted/20 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Pick Capital</span>
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", pStyle.badge)}>
                            #{picksRank}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── 3. TEAM DNA ────────────────────────────────────────────────────── */}
      <div data-testid="myteam-dna">
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">Team DNA</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Identity bars */}
          <Card className="p-5" data-testid="dna-identity">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">Team Identity</p>
            <div className="space-y-4">
              {[
                { label: "Win-Now", icon: Flame, value: winNow, color: "bg-orange-500", iconColor: "text-orange-500" },
                { label: "Long-Term", icon: Sprout, value: youth, color: "bg-emerald-500", iconColor: "text-emerald-500" },
                { label: "Draft Capital", icon: Archive, value: capital, color: "bg-[#0b3a7a] dark:bg-blue-500", iconColor: "text-[#0b3a7a] dark:text-blue-400" },
              ].map(({ label, icon: Icon, value, color, iconColor }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-4 h-4", iconColor)} />
                      <span className="text-sm font-semibold text-foreground">{label}</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{value}<span className="text-xs text-muted-foreground font-normal"> / 10</span></span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value * 10}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Strengths & Weaknesses */}
          <Card className="p-5" data-testid="dna-strengths-weaknesses">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">Strengths & Needs</p>
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Strengths</span>
                </div>
                {strengths.length > 0 ? (
                  <ul className="space-y-1.5">
                    {strengths.slice(0, 4).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                        <span className="text-emerald-500 mt-0.5 flex-shrink-0">•</span>{s}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No standout strengths detected</p>
                )}
              </div>
              <div className="border-t border-border/40 pt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Weaknesses</span>
                </div>
                {weaknesses.length > 0 ? (
                  <ul className="space-y-1.5">
                    {weaknesses.slice(0, 4).map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                        <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>{w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No major weaknesses detected</p>
                )}
              </div>
            </div>
          </Card>

          {/* Strategy */}
          <Card className="p-5 flex flex-col gap-4" data-testid="dna-strategy">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Strategy</p>
              <div className="flex items-start gap-2 mb-3">
                <Compass className="w-4 h-4 text-[#d4af37] flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-foreground leading-relaxed">"{suggestedDirection}"</p>
              </div>
            </div>
            <div className="border-t border-border/40 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-3.5 h-3.5 text-[#d4af37]" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Dynasty Window</span>
              </div>
              <p className={cn("text-lg font-bold leading-tight", dynastyWindowColor)} data-testid="dna-window-label">{dynastyWindowLabel}</p>
              <div className="flex gap-1 mt-3">
                {[0, 1, 2, 3, 4].map((offset) => {
                  const year = new Date().getFullYear() + offset;
                  const isInWindow = offset >= userTeam.metrics.windowStartOffset &&
                    offset < userTeam.metrics.windowStartOffset + userTeam.metrics.contenderWindowYears;
                  return (
                    <div key={offset} className={cn(
                      "flex-1 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold",
                      isInWindow ? "bg-[#0b3a7a] dark:bg-blue-600 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {year}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}
