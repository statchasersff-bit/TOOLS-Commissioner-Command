import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/SectionHeader";
import { ManagerNameButton } from "@/components/ManagerNameButton";
import { getLeagueTeamTiers } from "@/data/mockData";
import type { League, Team } from "@/types";

interface Props {
  league: League;
  userTeam: Team;
}

export function LeagueIntelligence({ league, userTeam }: Props) {
  const insightTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  return (
    <div className="space-y-10">
      <SectionHeader title="League Intelligence" subtitle="Per-team scouting reports: strengths, weaknesses, and outlook" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3" data-testid="league-leaders-cards">
        {[
          { label: "Best QB Room", team: [...league.teams].sort((a, b) => b.metrics.qb - a.metrics.qb)[0], stat: (t: Team) => t.metrics.qb },
          { label: "Best RB Room", team: [...league.teams].sort((a, b) => b.metrics.rb - a.metrics.rb)[0], stat: (t: Team) => t.metrics.rb },
          { label: "Best WR Room", team: [...league.teams].sort((a, b) => b.metrics.wr - a.metrics.wr)[0], stat: (t: Team) => t.metrics.wr },
          { label: "Best TE Room", team: [...league.teams].sort((a, b) => b.metrics.te - a.metrics.te)[0], stat: (t: Team) => t.metrics.te },
          { label: "Deepest Roster", team: [...league.teams].sort((a, b) => b.metrics.depth - a.metrics.depth)[0], stat: (t: Team) => t.metrics.depth },
          { label: "Most Draft Capital", team: [...league.teams].sort((a, b) => b.picks.length - a.picks.length)[0], stat: (t: Team) => t.picks.length },
        ].map(({ label, team }) => (
          <Card key={label} className="p-4 hover-elevate" data-testid={`leader-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
            <div className="flex items-center gap-2.5">
              {team.avatar ? (
                <img
                  src={team.avatar}
                  alt={team.owner}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 ring-1 ring-border/40 flex items-center justify-center">
                  <span className="text-xs font-bold text-muted-foreground">{team.owner.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div className="min-w-0">
                <ManagerNameButton
                  userId={team.ownerId}
                  username={team.owner}
                  avatar={team.avatar}
                  leagueId={league.id}
                  className="text-sm font-bold truncate block"
                >
                  {team.owner}
                </ManagerNameButton>
                <p className="text-[10px] text-muted-foreground truncate">{team.name}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
