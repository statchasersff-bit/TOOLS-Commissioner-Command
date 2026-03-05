import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, generateInsights } from "@/data/mockData";
import type { League, Team } from "@/types";
import { Trophy, Archive, Flame, Target, Compass, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";

const INSIGHT_CATEGORIES = [
  { id: "league-leaders" as const, label: "League Leaders", icon: Trophy, description: "Who dominates each position group" },
  { id: "draft-capital" as const, label: "Draft Capital", icon: Archive, description: "Future pick distribution across the league" },
  { id: "contender-analysis" as const, label: "Contender Analysis", icon: Flame, description: "Championship window and competitive landscape" },
  { id: "trade-opportunities" as const, label: "Trade Opportunities", icon: Target, description: "Positional weaknesses to exploit" },
  { id: "your-team" as const, label: "Your Team", icon: Compass, description: "Personalized insights for your roster" },
];

interface Props {
  league: League;
  userTeam: Team;
}

export function LeagueIntelligence({ league, userTeam }: Props) {
  const insights = generateInsights(league, userTeam.id);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);

  const avgAge = league.teams.reduce((s, t) => {
    const teamAvg = t.roster.reduce((ps, p) => ps + p.age, 0) / t.roster.length;
    return s + teamAvg;
  }, 0) / league.teams.length;

  const totalPicks = league.teams.reduce((s, t) => s + t.picks.length, 0);
  const pickConcentration = league.teams.map(t => ({
    name: t.owner,
    picks: t.picks.length,
    pct: Math.round((t.picks.length / totalPicks) * 100)
  })).sort((a, b) => b.picks - a.picks);
  const topPickHolder = pickConcentration[0];

  const posScarcity = (["QB", "RB", "WR", "TE"] as const).map(pos => {
    const key = pos.toLowerCase() as "qb" | "rb" | "wr" | "te";
    const avg = Math.round(league.teams.reduce((s, t) => s + t.metrics[key], 0) / league.teams.length);
    const below = league.teams.filter(t => t.metrics[key] < avg - 10).length;
    return { pos, avg, below };
  });

  const getStrengths = (team: Team): string[] => {
    const strengths: string[] = [];
    const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
      Math.round(league.teams.reduce((s, t) => s + t.metrics[key], 0) / league.teams.length);

    if (team.metrics.qb >= leagueAvg("qb") + 10) strengths.push("Elite QB room");
    if (team.metrics.rb >= leagueAvg("rb") + 10) strengths.push("Strong RB room");
    if (team.metrics.wr >= leagueAvg("wr") + 10) strengths.push("Elite WR corps");
    if (team.metrics.te >= leagueAvg("te") + 10) strengths.push("Strong TE room");
    if (team.metrics.youth >= 70) strengths.push("Strong youth profile");
    if (team.metrics.depth >= 70) strengths.push("Deep roster");
    if (team.picks.filter(p => p.round === 1).length >= 3) strengths.push("Loaded with 1st round picks");
    return strengths;
  };

  const getWeaknesses = (team: Team): string[] => {
    const weaknesses: string[] = [];
    const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
      Math.round(league.teams.reduce((s, t) => s + t.metrics[key], 0) / league.teams.length);

    if (team.metrics.qb < leagueAvg("qb") - 10) weaknesses.push("QB depth");
    if (team.metrics.rb < leagueAvg("rb") - 10) weaknesses.push("RB depth");
    if (team.metrics.wr < leagueAvg("wr") - 10) weaknesses.push("WR depth");
    if (team.metrics.te < leagueAvg("te") - 10) weaknesses.push("TE depth");
    if (team.metrics.youth < 40) weaknesses.push("Aging roster");
    if (team.picks.length <= 4) weaknesses.push("Limited draft capital");
    return weaknesses;
  };

  const insightTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const getOutlook = (team: Team): string => {
    const tier = insightTierMap.get(team.id)?.tier ?? "Competitive";
    switch (tier) {
      case "Juggernaut": return "Championship contender — league problem";
      case "Contender": return "Built to win this year";
      case "Ascending": return "The future is bright — probably a year early";
      case "Competitive": return "Good roster, not scary";
      case "Rebuild": return "Playing the long game";
      case "Directionless": return "Unclear direction — roster is messy";
      case "Taco": return "Dynasty team turned seasonal rental";
    }
  };

  return (
    <div className="space-y-10">
      <SectionHeader title="League Intelligence" subtitle="AI-powered league analysis — leaders, trends, and team narratives" />

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">League Leaders</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <p className="text-xs text-muted-foreground mb-4">Who dominates each category across the league</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5" data-testid="league-leaders-cards">
          {[
            { label: "Best QB Room", team: [...league.teams].sort((a, b) => b.metrics.qb - a.metrics.qb)[0], stat: (t: Team) => t.metrics.qb },
            { label: "Best RB Room", team: [...league.teams].sort((a, b) => b.metrics.rb - a.metrics.rb)[0], stat: (t: Team) => t.metrics.rb },
            { label: "Best WR Room", team: [...league.teams].sort((a, b) => b.metrics.wr - a.metrics.wr)[0], stat: (t: Team) => t.metrics.wr },
            { label: "Best TE Room", team: [...league.teams].sort((a, b) => b.metrics.te - a.metrics.te)[0], stat: (t: Team) => t.metrics.te },
            { label: "Deepest Roster", team: [...league.teams].sort((a, b) => b.metrics.depth - a.metrics.depth)[0], stat: (t: Team) => t.metrics.depth },
            { label: "Most Draft Capital", team: [...league.teams].sort((a, b) => b.picks.length - a.picks.length)[0], stat: (t: Team) => t.picks.length },
          ].map(({ label, team, stat }) => (
            <Card key={label} className="p-4 hover-elevate" data-testid={`leader-${label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-lg font-bold mt-1">{team.owner}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{team.name} · {stat(team)}</p>
            </Card>
          ))}
        </div>

        {INSIGHT_CATEGORIES.map(({ id, label, icon: Icon, description }) => {
          const categoryInsights = insights.filter((i) => i.category === id);
          if (categoryInsights.length === 0) return null;

          return (
            <div key={id} className="mb-5" data-testid={`insight-category-${id}`}>
              <div className="mb-3 flex items-center gap-3">
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

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">League Trends</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <p className="text-xs text-muted-foreground mb-4">Macro-level patterns across the league</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Card className="p-6" data-testid="trend-age">
            <div className="mb-4">
              <h3 className="text-base font-bold">Avg Roster Age</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <p className="text-3xl font-bold">{avgAge.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-1.5">League-wide average player age</p>
            <InsightCallout
              text={avgAge > 26 ? "The league skews older — youth assets may be undervalued." : "The league is relatively young — expect competitive windows to last."}
              type={avgAge > 26 ? "negative" : "positive"}
              className="mt-4"
            />
          </Card>

          <Card className="p-6" data-testid="trend-picks">
            <div className="mb-4">
              <h3 className="text-base font-bold">Pick Concentration</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <p className="text-3xl font-bold">{topPickHolder.name}</p>
            <p className="text-xs text-muted-foreground mt-1.5">
              Holds {topPickHolder.picks} picks ({topPickHolder.pct}% of league total)
            </p>
            <div className="mt-4 space-y-2">
              {pickConcentration.slice(0, 5).map((pc) => (
                <div key={pc.name} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{pc.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-[#0b3a7a] dark:bg-blue-500 rounded-full" style={{ width: `${pc.pct}%` }} />
                    </div>
                    <span className="text-muted-foreground w-6 text-right font-medium">{pc.picks}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6" data-testid="trend-scarcity">
            <div className="mb-4">
              <h3 className="text-base font-bold">Positional Scarcity</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <div className="space-y-4">
              {posScarcity.map((ps) => (
                <div key={ps.pos} className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{ps.pos}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{ps.below} needy</span>
                    <Badge variant={ps.below >= 4 ? "destructive" : ps.below >= 2 ? "secondary" : "outline"} className="text-xs">
                      {ps.below >= 4 ? "High" : ps.below >= 2 ? "Medium" : "Low"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Team Narratives</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <p className="text-xs text-muted-foreground mb-4">Expandable per-team scouting report</p>

        <div className="space-y-3" data-testid="team-narratives">
          {sorted.map((team) => {
            const tierInfo = insightTierMap.get(team.id);
            const tier = tierInfo?.tier ?? "Competitive";
            const isExpanded = expandedTeams.has(team.id);
            const strengths = getStrengths(team);
            const weaknesses = getWeaknesses(team);
            const outlook = getOutlook(team);

            return (
              <Card key={team.id} className="overflow-hidden" data-testid={`narrative-${team.id}`}>
                <button
                  onClick={() => toggleTeam(team.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors text-left"
                  data-testid={`button-expand-${team.id}`}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-sm font-bold">{team.owner}</span>
                    <span className="text-xs text-muted-foreground">{team.name}</span>
                    <Badge variant="outline" className={getTierColor(tier)}>{getTierEmoji(tier)} {tier}</Badge>
                  </div>
                  <span className="text-xl font-bold">{team.metrics.overall}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-5 pt-1 border-t border-border/30 space-y-4">
                    {strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3" /> Strengths
                        </p>
                        <ul className="space-y-1 pl-5">
                          {strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-red-500 dark:text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <TrendingDown className="w-3 h-3" /> Weaknesses
                        </p>
                        <ul className="space-y-1 pl-5">
                          {weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 uppercase tracking-wider mb-1.5">Outlook</p>
                      <p className="text-sm text-muted-foreground">{outlook}</p>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
