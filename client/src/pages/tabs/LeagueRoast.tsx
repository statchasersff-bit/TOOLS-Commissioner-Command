import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji } from "@/data/mockData";
import type { League, Team, Tier } from "@/types";
import { AlertTriangle, Skull, Trophy, TrendingUp, TrendingDown, Star, Zap, Target, Gem, Clock, Dice1, Eye, Shield, Flame, ChevronDown, ChevronRight } from "lucide-react";

interface ReportCard {
  team: Team;
  overall: number;
  letter: string;
  winNow: string;
  future: string;
  depth: string;
  assetFlex: string;
  strength: string;
  weakness: string;
  roast: string;
  archetype: string;
  archetypeIcon: typeof Trophy;
  tier: Tier;
  badges: string[];
}

function scoreToLetter(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 83) return "A";
  if (score >= 78) return "A-";
  if (score >= 73) return "B+";
  if (score >= 67) return "B";
  if (score >= 62) return "B-";
  if (score >= 56) return "C+";
  if (score >= 50) return "C";
  if (score >= 44) return "C-";
  if (score >= 38) return "D+";
  if (score >= 30) return "D";
  if (score >= 22) return "D-";
  return "F";
}

function subScoreToLetter(score: number): string {
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "B-";
  if (score >= 45) return "C+";
  if (score >= 35) return "C";
  if (score >= 25) return "D+";
  if (score >= 15) return "D";
  return "F";
}

function letterColor(letter: string): string {
  if (letter.startsWith("A")) return "text-emerald-500 dark:text-emerald-400";
  if (letter.startsWith("B")) return "text-blue-500 dark:text-blue-400";
  if (letter.startsWith("C")) return "text-amber-500 dark:text-amber-400";
  if (letter.startsWith("D")) return "text-orange-500 dark:text-orange-400";
  return "text-red-500 dark:text-red-400";
}

function getArchetype(team: Team): { name: string; icon: typeof Trophy } {
  const m = team.metrics;
  if (m.starters >= 85 && m.depth >= 75) return { name: "The Juggernaut", icon: Flame };
  if (m.youth >= 70 && m.picks >= 70 && m.starters < 70) return { name: "The Architect", icon: Gem };
  if (m.starters >= 75 && m.picks < 40 && m.youth < 45) return { name: "The Gambler", icon: Dice1 };
  if (m.picks >= 75 && m.starters < 50) return { name: "The Investor", icon: TrendingUp };
  if (m.starters >= 70 && m.depth < 40) return { name: "The Paper Tiger", icon: Eye };
  if (m.picks >= 80 && m.depth < 40) return { name: "The Time Traveler", icon: Clock };
  if (m.starters >= 40 && m.starters <= 65 && m.depth >= 40 && m.depth <= 65) return { name: "The Treadmill", icon: Target };
  const posScores = [m.qb, m.rb, m.wr, m.te];
  const maxPos = Math.max(...posScores);
  const minPos = Math.min(...posScores);
  if (maxPos - minPos > 50) return { name: "The Sicko", icon: Zap };
  return { name: "The Competitor", icon: Shield };
}

function getRoast(team: Team, league: League): string {
  const m = team.metrics;
  const avgAge = team.roster.length > 0
    ? team.roster.reduce((s, p) => s + p.age, 0) / team.roster.length
    : 26;
  const starterAge = team.roster.filter(p => p.starter).length > 0
    ? team.roster.filter(p => p.starter).reduce((s, p) => s + p.age, 0) / team.roster.filter(p => p.starter).length
    : 26;

  const roasts: string[] = [];

  if (starterAge > 28) roasts.push("This roster belongs in a retirement home.");
  if (m.picks < 25) roasts.push("Traded away the future for a mid-table finish.");
  if (m.picks >= 85) roasts.push("Collects draft picks like they're Pokemon cards.");
  if (m.depth < 25) roasts.push("One injury away from starting a guy last active in 2023.");
  if (m.starters < 30 && m.picks < 40) roasts.push("Still rebuilding... at this point it's a lifestyle.");
  if (m.starters >= 80 && m.picks < 30 && m.youth < 40) roasts.push("Trades like the league is shutting down tomorrow.");
  if (m.starters >= 75 && m.depth < 35) roasts.push("Great starting lineup, terrifying bench.");
  if (m.qb < 25) roasts.push("The QB room is a humanitarian crisis.");
  if (m.rb < 25) roasts.push("Could not name a usable RB on this roster if you tried.");
  if (m.wr < 25) roasts.push("The WR corps looks like a practice squad.");
  if (m.te < 25) roasts.push("Tight end? More like tight budget.");
  if (m.overall >= 90) roasts.push("Running the league like a hedge fund with shoulder pads.");
  if (avgAge < 24.5 && m.starters < 50) roasts.push("Building for a future that may never arrive.");
  if (m.starters >= 60 && m.starters <= 75 && m.depth >= 50 && m.depth <= 70) roasts.push("The definition of 'good enough to lose in the playoffs.'");

  if (roasts.length === 0) roasts.push("Perfectly average. The league's participation trophy.");

  let hash = 0;
  for (let i = 0; i < team.id.length; i++) hash = ((hash << 5) - hash + team.id.charCodeAt(i)) | 0;
  return roasts[Math.abs(hash) % roasts.length];
}

function getStrength(team: Team): string {
  const m = team.metrics;
  const best = [
    { label: "Elite QB room", score: m.qb },
    { label: "Dominant RB room", score: m.rb },
    { label: "Elite WR corps", score: m.wr },
    { label: "Strong TE room", score: m.te },
    { label: "Deep roster", score: m.depth },
    { label: "Loaded with draft capital", score: m.picks },
    { label: "Youth advantage", score: m.youth },
    { label: "Elite starting lineup", score: m.starters },
  ].sort((a, b) => b.score - a.score);
  return best[0].label;
}

function getWeakness(team: Team): string {
  const m = team.metrics;
  const worst = [
    { label: "QB depth crisis", score: m.qb },
    { label: "RB room is barren", score: m.rb },
    { label: "WR corps needs help", score: m.wr },
    { label: "TE position is a void", score: m.te },
    { label: "Paper-thin bench", score: m.depth },
    { label: "No draft capital", score: m.picks },
    { label: "Aging roster", score: m.youth },
    { label: "Weak starting lineup", score: m.starters },
  ].sort((a, b) => a.score - b.score);
  return worst[0].label;
}

function getBadges(team: Team, league: League, rank: number): string[] {
  const m = team.metrics;
  const badges: string[] = [];
  const total = league.teams.length;

  if (rank === 1) badges.push("Best Team");
  if (rank === total) badges.push("Worst Team");

  const youthRank = [...league.teams].sort((a, b) => b.metrics.youth - a.metrics.youth).findIndex(t => t.id === team.id) + 1;
  if (youthRank === 1) badges.push("Best Future");

  if (m.picks >= 85) badges.push("Pick Hoarder");
  if (m.starters >= 85 && m.youth < 40) badges.push("Win-Now Maniac");
  if (m.depth < 25 && m.starters >= 60) badges.push("Most Fragile");
  if (m.picks < 20 && m.starters < 50) badges.push("Most Desperate");

  return badges;
}

function getOutlookText(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "Championship favorite. League problem.";
    case "Win-Now": return "Built to compete this year.";
    case "Future Powerhouse": return "The future is bright. Loaded with assets.";
    case "Pick Hoarder": return "Stockpiling picks but roster needs work.";
    case "Taco": return "Bottom of the barrel across the board.";
    case "Contender": return "Strong team with enough dynasty value to stay competitive.";
    case "Rebuilder": return "Not built to win now, but positioned to improve.";
    case "Weak / Directionless": return "Lacking current strength and a clear long-term plan.";
    case "Balanced": return "Middle-of-the-pack without an extreme archetype.";
  }
}

function badgeColor(badge: string): string {
  switch (badge) {
    case "Best Team": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "Worst Team": return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "Best Future": return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    case "Pick Hoarder": return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    case "Win-Now Maniac": return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
    case "Most Fragile": return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
    case "Most Desperate": return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
    default: return "bg-muted text-muted-foreground";
  }
}

function buildReportCards(league: League, userTeamId: string): ReportCard[] {
  const tierMap = getLeagueTeamTiers(league.teams);
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);

  return sorted.map((team, i) => {
    const rank = i + 1;
    const m = team.metrics;
    const tierInfo = tierMap.get(team.id);
    const tier = tierInfo?.tier ?? "Balanced";
    const archetype = getArchetype(team);

    const winNowScore = Math.round(m.starters * 0.7 + m.depth * 0.3);
    const futureScore = Math.round(m.youth * 0.5 + m.picks * 0.5);
    const depthScore = m.depth;
    const assetFlexScore = Math.round(m.picks * 0.6 + m.depth * 0.2 + m.youth * 0.2);

    return {
      team,
      overall: m.overall,
      letter: scoreToLetter(m.overall),
      winNow: subScoreToLetter(winNowScore),
      future: subScoreToLetter(futureScore),
      depth: subScoreToLetter(depthScore),
      assetFlex: subScoreToLetter(assetFlexScore),
      strength: getStrength(team),
      weakness: getWeakness(team),
      roast: getRoast(team, league),
      archetype: archetype.name,
      archetypeIcon: archetype.icon,
      tier,
      badges: getBadges(team, league, rank),
    };
  });
}

function getLeagueGrade(league: League): { score: number; letter: string; label: string } {
  const avg = Math.round(league.teams.reduce((s, t) => s + t.metrics.overall, 0) / league.teams.length);
  const letter = scoreToLetter(avg);
  let label = "Mickey Mouse League";
  if (avg >= 90) label = "Elite Shark Tank";
  else if (avg >= 80) label = "Competitive League";
  else if (avg >= 70) label = "Solid League";
  else if (avg >= 60) label = "Mid League";
  return { score: avg, letter, label };
}

type Stage = "warning" | "suspense" | "reveal";

export function LeagueRoast({ league, userTeam }: { league: League; userTeam: Team }) {
  const [stage, setStage] = useState<Stage>("warning");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const reportCards = useMemo(() => buildReportCards(league, userTeam.id), [league, userTeam.id]);
  const userCard = reportCards.find(rc => rc.team.id === userTeam.id);
  const isWorst = reportCards.length > 0 && reportCards[reportCards.length - 1].team.id === userTeam.id;
  const worstCard = reportCards[reportCards.length - 1];
  const bestCard = reportCards[0];
  const leagueGrade = useMemo(() => getLeagueGrade(league), [league]);

  const toggleCard = (teamId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  if (stage === "warning") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-md w-full text-center" data-testid="roast-warning">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-black text-foreground mb-3" data-testid="text-warning-title">
            We told you not to click here.
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            If your league mates see this report, friendships may be ruined.
          </p>
          <Button
            onClick={() => setStage("suspense")}
            className="bg-red-600 hover:bg-red-700 text-white font-bold px-6"
            data-testid="button-reveal"
          >
            <Skull className="w-4 h-4 mr-2" />
            Reveal the League Truth
          </Button>
        </Card>
      </div>
    );
  }

  if (stage === "suspense") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-lg w-full text-center" data-testid="roast-suspense">
          {isWorst ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-6">
                <Skull className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-2xl font-black text-foreground mb-3">
                Unfortunately... we have some bad news.
              </h2>
              <p className="text-lg text-red-500 dark:text-red-400 font-bold mb-3">
                You are currently the worst GM in your league.
              </p>
              <div className="mb-6">
                <span className={`text-6xl font-black ${letterColor(userCard?.letter || "F")}`}>
                  {userCard?.letter || "F"}
                </span>
                <p className="text-xs text-muted-foreground mt-2">{userCard?.overall || 0} / 100</p>
              </div>
              <p className="text-sm text-muted-foreground italic mb-8">
                "{userCard?.roast}"
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                <Trophy className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-black text-foreground mb-3">
                Luckily... you're not the worst manager in your league.
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Your grade: <span className={`text-2xl font-black ml-2 ${letterColor(userCard?.letter || "C")}`}>{userCard?.letter}</span>
              </p>
              <p className="text-sm text-muted-foreground mb-2">The worst GM honor goes to:</p>
              <p className="text-lg font-black text-red-500 dark:text-red-400 mb-1">
                {worstCard?.team.owner}
              </p>
              <p className="text-sm text-muted-foreground italic mb-8">
                "{worstCard?.roast}"
              </p>
            </>
          )}
          <Button
            onClick={() => setStage("reveal")}
            className="bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white font-bold px-6"
            data-testid="button-show-full-report"
          >
            See Full League Report
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader title="League Report Card" subtitle="Grades, roasts, and archetypes for every team" />

      <Card className="p-5 text-center" data-testid="card-league-grade">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">League Strength</p>
        <div className="flex items-center justify-center gap-3">
          <span className={`text-4xl font-black ${letterColor(leagueGrade.letter)}`}>{leagueGrade.letter}</span>
          <div className="text-left">
            <p className="text-sm font-bold">{leagueGrade.label}</p>
            <p className="text-xs text-muted-foreground">Avg Score: {leagueGrade.score}</p>
          </div>
        </div>
      </Card>

      <div>
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">League Rankings</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-rankings">
            <thead>
              <tr className="border-b border-border/30 text-xs text-muted-foreground">
                <th className="text-left py-2 px-2 w-10">#</th>
                <th className="text-left py-2 px-2">Manager</th>
                <th className="text-center py-2 px-2 w-16">Grade</th>
                <th className="text-center py-2 px-2 w-16">Score</th>
              </tr>
            </thead>
            <tbody>
              {reportCards.map((rc, i) => {
                const isUser = rc.team.id === userTeam.id;
                return (
                  <tr
                    key={rc.team.id}
                    className={`border-b border-border/10 ${isUser ? "bg-[#0b3a7a]/8 dark:bg-blue-400/8" : ""} ${i === reportCards.length - 1 ? "bg-red-500/5" : ""}`}
                    data-testid={`ranking-row-${rc.team.id}`}
                  >
                    <td className="py-2.5 px-2 text-muted-foreground font-medium">{i + 1}</td>
                    <td className="py-2.5 px-2 font-semibold">
                      {rc.team.owner}
                      {isUser && <Badge variant="outline" className="ml-2 text-[9px] py-0">You</Badge>}
                    </td>
                    <td className={`py-2.5 px-2 text-center font-black ${letterColor(rc.letter)}`}>{rc.letter}</td>
                    <td className="py-2.5 px-2 text-center text-muted-foreground">{rc.overall}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">Dynasty Archetypes</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid="archetypes-grid">
          {reportCards.map(rc => {
            const Icon = rc.archetypeIcon;
            return (
              <Card key={rc.team.id} className="p-3 text-center" data-testid={`archetype-${rc.team.id}`}>
                <Icon className="w-5 h-5 mx-auto mb-1.5 text-[#d4af37]" />
                <p className="text-xs font-bold truncate">{rc.team.owner}</p>
                <p className="text-[10px] text-muted-foreground">{rc.archetype}</p>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">League Roast</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="space-y-2" data-testid="roast-cards">
          {reportCards.map(rc => {
            const isExpanded = expandedCards.has(rc.team.id);
            const Icon = rc.archetypeIcon;
            return (
              <Card key={rc.team.id} className="overflow-hidden" data-testid={`roast-card-${rc.team.id}`}>
                <button
                  onClick={() => toggleCard(rc.team.id)}
                  className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-muted/20 transition-colors text-left"
                  data-testid={`button-expand-roast-${rc.team.id}`}
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                    <span className={`text-xl sm:text-2xl font-black ${letterColor(rc.letter)} flex-shrink-0 w-8 sm:w-10`}>{rc.letter}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{rc.team.owner}</p>
                      <p className="text-[10px] text-muted-foreground italic truncate">"{rc.roast}"</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {rc.badges.slice(0, 1).map(b => (
                      <Badge key={b} className={`text-[9px] ${badgeColor(b)}`}>{b}</Badge>
                    ))}
                    <span className="text-lg font-bold text-muted-foreground">{rc.overall}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-border/30 space-y-4">
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: "Win Now", grade: rc.winNow },
                        { label: "Future", grade: rc.future },
                        { label: "Dynasty", grade: rc.depth },
                        { label: "Flex", grade: rc.assetFlex },
                      ].map(sub => (
                        <div key={sub.label}>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{sub.label}</p>
                          <p className={`text-lg font-black ${letterColor(sub.grade)}`}>{sub.grade}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> Strength
                        </p>
                        <p className="text-xs text-muted-foreground">{rc.strength}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" /> Weakness
                        </p>
                        <p className="text-xs text-muted-foreground">{rc.weakness}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-[#d4af37]" />
                      <span className="text-xs font-bold">{rc.archetype}</span>
                      <span className="text-[10px] text-muted-foreground">· {getOutlookText(rc.tier)}</span>
                    </div>

                    {rc.badges.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {rc.badges.map(b => (
                          <Badge key={b} className={`text-[10px] ${badgeColor(b)}`}>{b}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">League Awards</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="awards-grid">
          {[
            { label: "Best Team", team: bestCard?.team, icon: Trophy, color: "text-emerald-500" },
            { label: "Worst Team", team: worstCard?.team, icon: Skull, color: "text-red-500" },
            { label: "Best Future", team: [...league.teams].sort((a, b) => (b.metrics.youth * 0.5 + b.metrics.picks * 0.5) - (a.metrics.youth * 0.5 + a.metrics.picks * 0.5))[0], icon: Star, color: "text-blue-500" },
            { label: "Pick Hoarder", team: [...league.teams].sort((a, b) => b.metrics.picks - a.metrics.picks)[0], icon: Gem, color: "text-amber-500" },
            { label: "Win-Now Maniac", team: [...league.teams].sort((a, b) => (b.metrics.starters - b.metrics.youth) - (a.metrics.starters - a.metrics.youth))[0], icon: Flame, color: "text-orange-500" },
            { label: "Most Fragile", team: [...league.teams].sort((a, b) => (a.metrics.depth - a.metrics.starters) - (b.metrics.depth - b.metrics.starters))[0], icon: AlertTriangle, color: "text-purple-500" },
          ].map(award => (
            <Card key={award.label} className="p-3 sm:p-4" data-testid={`award-${award.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <award.icon className={`w-5 h-5 ${award.color} mb-1.5`} />
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{award.label}</p>
              <p className="text-sm font-bold mt-1 truncate">{award.team?.owner}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
