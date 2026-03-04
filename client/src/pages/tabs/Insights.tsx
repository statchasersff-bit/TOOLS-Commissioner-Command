import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getTeamTier, getTierColor } from "@/data/mockData";
import type { League, Team } from "@/types";
import { FileText } from "lucide-react";

interface InsightsProps {
  league: League;
}

export function TeamInsights({ league }: InsightsProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);

  const getTeamNarrative = (team: Team): string[] => {
    const tier = getTeamTier(team.metrics.overall);
    const narratives: string[] = [];

    if (tier === "Elite") {
      narratives.push(`${team.owner}'s team is among the league's elite. With a ${team.metrics.overall} overall score, they should be pushing for a championship.`);
    } else if (tier === "Contender") {
      narratives.push(`${team.owner} is a solid contender with room to improve. One or two key additions could push them to elite status.`);
    } else if (tier === "Competitive") {
      narratives.push(`${team.owner} is in a tough spot -- competitive but not quite contending. A clear direction (buy or sell) would help.`);
    } else {
      narratives.push(`${team.owner} is in full rebuild mode. Focus on accumulating young assets and draft capital for the future.`);
    }

    if (team.metrics.qb >= 75) narratives.push("QB room is a major strength.");
    if (team.metrics.rb < 40) narratives.push("RB depth is concerning and should be addressed.");
    if (team.metrics.wr >= 75) narratives.push("WR corps is among the league's best.");
    if (team.metrics.youth >= 70) narratives.push("Roster skews young with excellent long-term outlook.");
    if (team.picks.filter(p => p.round === 1).length >= 3) narratives.push("Loaded with future first-round picks.");

    return narratives;
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Team Insights" subtitle="Per-team narrative analysis" />

      <div className="space-y-4">
        {sorted.map((team) => {
          const tier = getTeamTier(team.metrics.overall);
          const narratives = getTeamNarrative(team);
          return (
            <Card key={team.id} className="p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{team.name}</h3>
                  <span className="text-xs text-muted-foreground">({team.owner})</span>
                  <Badge variant="outline" className={getTierColor(tier)}>{tier}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{team.metrics.overall}</span>
                  <Button variant="outline" size="sm" data-testid={`button-report-${team.id}`}>
                    <FileText className="w-3 h-3 mr-1" /> Report Card
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {narratives.map((n, i) => (
                  <p key={i} className="text-sm text-muted-foreground leading-relaxed">{n}</p>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function LeagueTrends({ league }: InsightsProps) {
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

  return (
    <div className="space-y-6">
      <SectionHeader title="League Trends" subtitle="Macro-level patterns and observations" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Age Trend
            <span className="block h-0.5 w-8 bg-[#d4af37] rounded-full" />
          </h3>
          <p className="text-2xl font-bold">{avgAge.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground mt-1">League-wide average player age</p>
          <InsightCallout
            text={avgAge > 26 ? "The league skews older -- youth assets may be undervalued." : "The league is relatively young -- expect competitive windows to last."}
            type={avgAge > 26 ? "negative" : "positive"}
            className="mt-3"
          />
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Pick Concentration
            <span className="block h-0.5 w-8 bg-[#d4af37] rounded-full" />
          </h3>
          <p className="text-2xl font-bold">{topPickHolder.name}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Holds {topPickHolder.picks} picks ({topPickHolder.pct}% of league total)
          </p>
          <div className="mt-3 space-y-1">
            {pickConcentration.slice(0, 5).map((pc) => (
              <div key={pc.name} className="flex items-center justify-between text-xs">
                <span>{pc.name}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-[#0b3a7a] dark:bg-blue-500 rounded-full" style={{ width: `${pc.pct}%` }} />
                  </div>
                  <span className="text-muted-foreground w-6 text-right">{pc.picks}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Positional Scarcity
            <span className="block h-0.5 w-8 bg-[#d4af37] rounded-full" />
          </h3>
          <div className="space-y-3">
            {posScarcity.map((ps) => (
              <div key={ps.pos} className="flex items-center justify-between">
                <span className="text-sm font-medium">{ps.pos}</span>
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
  );
}
