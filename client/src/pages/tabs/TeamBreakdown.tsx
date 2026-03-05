import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getPositionColor } from "@/data/mockData";
import type { League, Team, Player } from "@/types";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

interface TeamProps {
  league: League;
  userTeam: Team;
}

export function RosterBreakdown({ league, userTeam }: TeamProps) {
  const [search, setSearch] = useState("");

  const leagueAvg = {
    qb: Math.round(league.teams.reduce((s, t) => s + t.metrics.qb, 0) / league.teams.length),
    rb: Math.round(league.teams.reduce((s, t) => s + t.metrics.rb, 0) / league.teams.length),
    wr: Math.round(league.teams.reduce((s, t) => s + t.metrics.wr, 0) / league.teams.length),
    te: Math.round(league.teams.reduce((s, t) => s + t.metrics.te, 0) / league.teams.length),
  };

  const positions: Array<{ pos: string; score: number; avg: number }> = [
    { pos: "QB", score: userTeam.metrics.qb, avg: leagueAvg.qb },
    { pos: "RB", score: userTeam.metrics.rb, avg: leagueAvg.rb },
    { pos: "WR", score: userTeam.metrics.wr, avg: leagueAvg.wr },
    { pos: "TE", score: userTeam.metrics.te, avg: leagueAvg.te },
  ];

  const weakest = [...positions].sort((a, b) => (a.score - a.avg) - (b.score - b.avg))[0];

  const starters = [...userTeam.roster.filter((p) => p.starter)].sort((a, b) => b.value - a.value);
  const bench = [...userTeam.roster.filter((p) => !p.starter)].sort((a, b) => b.value - a.value);

  const buckets = { "21-24": 0, "25-28": 0, "29+": 0 };
  userTeam.roster.forEach((p) => {
    if (p.age <= 24) buckets["21-24"]++;
    else if (p.age <= 28) buckets["25-28"]++;
    else buckets["29+"]++;
  });
  const maxBucket = Math.max(...Object.values(buckets));

  const depthPositions = ["QB", "RB", "WR", "TE"] as const;
  const filtered = useMemo(() => {
    if (!search) return userTeam.roster;
    return userTeam.roster.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [search, userTeam.roster]);

  return (
    <div className="space-y-10">
      <SectionHeader title="Roster Breakdown" subtitle={`${userTeam.name} — strength, age, and depth analysis`} />

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Roster Strength</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {positions.map((p) => (
            <Card key={p.pos} className="p-5 hover-elevate" data-testid={`strength-${p.pos.toLowerCase()}`}>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{p.pos}</p>
              <p className="text-3xl font-bold mt-1.5">{p.score}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-xs text-muted-foreground">Avg: {p.avg}</span>
                <Badge variant={p.score >= p.avg ? "default" : "outline"} className="text-xs">
                  {p.score >= p.avg ? "+" : ""}{p.score - p.avg}
                </Badge>
              </div>
            </Card>
          ))}
        </div>

        {weakest.score < weakest.avg && (
          <div className="mt-4">
            <InsightCallout
              text={`${weakest.pos} depth is below league average (${weakest.score} vs ${weakest.avg}). Consider targeting ${weakest.pos} in trades.`}
              type="negative"
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <Card className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold">Starters ({starters.length})</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <div className="space-y-1">
              {starters.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`starter-${p.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                    <span className="text-sm font-semibold">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Age {p.age}</span>
                    <span className="text-xs font-bold">{p.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold">Bench ({bench.length})</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <div className="space-y-1">
              {bench.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`bench-${p.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                    <span className="text-sm">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Age {p.age}</span>
                    <span className="text-xs font-bold">{p.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Age Curve</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <Card className="p-6">
          <div className="grid grid-cols-3 gap-6">
            {Object.entries(buckets).map(([range, count]) => (
              <div key={range} className="text-center" data-testid={`age-bucket-${range}`}>
                <div className="mx-auto w-full max-w-[90px]">
                  <div className="h-36 bg-muted rounded-md relative overflow-hidden flex items-end">
                    <div
                      className={cn(
                        "w-full rounded-md transition-all",
                        range === "21-24" ? "bg-emerald-500" :
                        range === "25-28" ? "bg-[#0b3a7a] dark:bg-blue-500" :
                        "bg-amber-500"
                      )}
                      style={{ height: `${(count / maxBucket) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="text-xl font-bold mt-3">{count}</p>
                <p className="text-xs text-muted-foreground font-medium">{range}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <KpiCard label="Contender Window" value={`${userTeam.metrics.contenderWindowYears} Years`} subtitle="Based on roster age and value" />
          <KpiCard label="Youth Score" value={userTeam.metrics.youth} subtitle={userTeam.metrics.youth >= 60 ? "Above average" : "Below average"} trend={userTeam.metrics.youth >= 60 ? "up" : "down"} />
        </div>

        <Card className="p-6 mt-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your roster skews {buckets["21-24"] > buckets["29+"] ? "younger" : "older"} with {buckets["21-24"]} players under 25.
            {userTeam.metrics.contenderWindowYears >= 3
              ? " You have a strong multi-year window to compete. Consider making a push for championship-caliber talent."
              : " Your window may be closing. Consider selling aging assets for younger players and draft picks."
            }
          </p>
        </Card>
      </div>

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Depth Chart</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="relative max-w-sm mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-depth"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {depthPositions.map((pos) => {
            const players = filtered.filter((p) => p.pos === pos);
            if (players.length === 0 && search) return null;
            return (
              <Card key={pos} className="p-6" data-testid={`depth-${pos.toLowerCase()}`}>
                <div className="mb-4">
                  <h3 className="text-base font-bold flex items-center gap-2">
                    {pos}
                    <Badge variant="secondary">{players.length}</Badge>
                  </h3>
                  <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
                </div>
                <div className="space-y-1">
                  {players.sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0) || b.value - a.value).map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`depth-player-${p.id}`}>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.starter ? "default" : "outline"} className="text-xs">
                          {p.starter ? "Starter" : "Bench"}
                        </Badge>
                        <span className={cn("text-sm", p.starter ? "font-semibold" : "")}>{p.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{p.team}</span>
                        <span className="text-xs text-muted-foreground">Age {p.age}</span>
                        <span className="text-xs font-bold w-6 text-right">{p.value}</span>
                      </div>
                    </div>
                  ))}
                  {players.length === 0 && <p className="text-xs text-muted-foreground">No players found</p>}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
