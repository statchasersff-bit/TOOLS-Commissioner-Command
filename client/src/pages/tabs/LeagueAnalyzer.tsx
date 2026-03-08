import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getTierTooltip } from "@/data/mockData";
import { formatPickLabel } from "@/types";
import type { League, Team, Tier } from "@/types";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

interface AnalyzerProps {
  league: League;
}

const TIER_ORDER: Tier[] = ["Juggernaut", "Win-Now", "Contender", "Future Powerhouse", "Pick Hoarder", "Rebuilder", "Weak / Directionless", "Taco", "Balanced"];
const TIER_BAR_COLOR: Record<Tier, string> = {
  "Juggernaut": "bg-[#d4af37]",
  "Win-Now": "bg-blue-500",
  "Contender": "bg-amber-500",
  "Future Powerhouse": "bg-emerald-500",
  "Pick Hoarder": "bg-purple-500",
  "Rebuilder": "bg-orange-500",
  "Weak / Directionless": "bg-rose-500",
  "Taco": "bg-red-500",
  "Balanced": "bg-slate-500",
};

export function PowerRankings({ league }: AnalyzerProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const tiers = useMemo(() => {
    const groups: Record<Tier, Team[]> = { "Juggernaut": [], "Win-Now": [], "Contender": [], "Future Powerhouse": [], "Pick Hoarder": [], "Rebuilder": [], "Weak / Directionless": [], "Taco": [], "Balanced": [] };
    sorted.forEach((t) => { const ti = tierMap.get(t.id); if (ti) groups[ti.tier].push(t); });
    return groups;
  }, [sorted, tierMap]);

  const columns = [
    { key: "rank", header: "Rank", sticky: true, render: (_: any, i: number) => <span className="font-bold">{i + 1}</span> },
    { key: "name", header: "Team", sortable: true, sortAccessor: (row: any) => row.owner, render: (row: any) => <span className="font-semibold">{row.owner}</span> },
    { key: "tier", header: "Tier", sortable: true, sortAccessor: (row: any) => { const ti = tierMap.get(row.id); return ti ? TIER_ORDER.indexOf(ti.tier) : 99; }, render: (row: any) => {
      const ti = tierMap.get(row.id);
      if (!ti) return null;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={cn(getTierColor(ti.tier), "cursor-default")} data-testid={`tier-badge-${row.id}`}>
              {getTierEmoji(ti.tier)} {ti.tier}
            </Badge>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs max-w-[220px]">{ti.tooltip}</p></TooltipContent>
        </Tooltip>
      );
    }},
    { key: "starters", header: "Starters", sortable: true, sortAccessor: (row: any) => row.metrics.starters, render: (row: any) => row.metrics.starters },
    { key: "depth", header: "Dynasty", sortable: true, sortAccessor: (row: any) => row.metrics.depth, render: (row: any) => row.metrics.depth },
    { key: "youth", header: "Youth", sortable: true, sortAccessor: (row: any) => row.metrics.youth, render: (row: any) => row.metrics.youth },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Power Rankings" subtitle="Teams ranked and grouped by archetype" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TIER_ORDER.filter(tier => tiers[tier].length > 0).map((tier) => (
          <div key={tier} className={cn("rounded-md p-4 border border-border/40", getTierBg(tier))}>
            <Tooltip>
              <TooltipTrigger asChild>
                <h4 className={cn("text-sm font-bold mb-3 cursor-default flex items-center gap-1.5", getTierColor(tier))}>
                  <span>{getTierEmoji(tier)}</span> {tier}
                </h4>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[220px]">{getTierTooltip(tier)}</p></TooltipContent>
            </Tooltip>
            <div className="space-y-2.5">
              {tiers[tier].map((team) => (
                <Card key={team.id} className="p-4 hover-elevate">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{team.owner}</p>
                    </div>
                    <span className="text-xl font-bold text-foreground">{team.metrics.overall}</span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={sorted} defaultSortKey="overall" defaultSortDir="desc" />
    </div>
  );
}

export function TierBreakdown({ league }: AnalyzerProps) {
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const tierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { "Juggernaut": 0, "Win-Now": 0, "Contender": 0, "Future Powerhouse": 0, "Pick Hoarder": 0, "Rebuilder": 0, "Weak / Directionless": 0, "Taco": 0, "Balanced": 0 };
    league.teams.forEach((t) => { const ti = tierMap.get(t.id); if (ti) counts[ti.tier]++; });
    return counts;
  }, [league.teams, tierMap]);
  const total = league.teams.length;

  return (
    <div className="space-y-8">
      <SectionHeader title="Tier Breakdown" subtitle="Distribution of teams across competitive archetypes" />

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <h3 className="text-base font-bold">Tier Distribution</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-[200px]">Archetypes based on Power, Dynasty, Redraft, and Draft capital rankings.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-5">
          {TIER_ORDER.map((tier) => (
            <div key={tier} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn("text-sm font-semibold cursor-default flex items-center gap-1", getTierColor(tier))}>
                      {getTierEmoji(tier)} {tier}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs max-w-[220px]">{getTierTooltip(tier)}</p></TooltipContent>
                </Tooltip>
                <span className="text-sm text-muted-foreground">{tierCounts[tier]} team{tierCounts[tier] !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", TIER_BAR_COLOR[tier])}
                  style={{ width: `${(tierCounts[tier] / total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {TIER_ORDER.filter(tier => tierCounts[tier] > 0).map((tier) => (
          <Card key={tier} className={cn("p-5 text-center", getTierBg(tier))}>
            <p className="text-4xl font-bold">{tierCounts[tier]}</p>
            <p className={cn("text-sm font-semibold mt-1.5 flex items-center justify-center gap-1", getTierColor(tier))}>
              {getTierEmoji(tier)} {tier}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{Math.round((tierCounts[tier] / total) * 100)}% of league</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function RosterComparison({ league }: AnalyzerProps) {
  const [teamAId, setTeamAId] = useState(league.teams[0]?.id || "");
  const [teamBId, setTeamBId] = useState(league.teams[1]?.id || "");

  const teamA = league.teams.find((t) => t.id === teamAId);
  const teamB = league.teams.find((t) => t.id === teamBId);

  const categories = [
    { key: "overall", label: "Overall" },
    { key: "starters", label: "Starters" },
    { key: "depth", label: "Dynasty" },
    { key: "youth", label: "Youth" },
    { key: "qb", label: "QB" },
    { key: "rb", label: "RB" },
    { key: "wr", label: "WR" },
    { key: "te", label: "TE" },
    { key: "picks", label: "Draft Capital" },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Roster Comparison" subtitle="Compare two teams head-to-head" />

      <div className="flex items-center gap-2 sm:gap-4">
        <Select value={teamAId} onValueChange={setTeamAId}>
          <SelectTrigger className="min-w-0 flex-1 sm:w-[200px] sm:flex-none" data-testid="select-team-a">
            <SelectValue placeholder="Team A" />
          </SelectTrigger>
          <SelectContent>
            {league.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-bold text-muted-foreground shrink-0">VS</span>
        <Select value={teamBId} onValueChange={setTeamBId}>
          <SelectTrigger className="min-w-0 flex-1 sm:w-[200px] sm:flex-none" data-testid="select-team-b">
            <SelectValue placeholder="Team B" />
          </SelectTrigger>
          <SelectContent>
            {league.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {teamA && teamB && (
        <Card className="p-6">
          <div className="space-y-5">
            {categories.map((cat) => {
              const valA = teamA.metrics[cat.key as keyof typeof teamA.metrics] as number;
              const valB = teamB.metrics[cat.key as keyof typeof teamB.metrics] as number;
              const maxVal = Math.max(valA, valB, 1);
              return (
                <div key={cat.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-bold", valA >= valB ? "text-[#0b3a7a] dark:text-blue-400" : "text-muted-foreground")}>{valA}</span>
                    <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">{cat.label}</span>
                    <span className={cn("font-bold", valB >= valA ? "text-[#d4af37]" : "text-muted-foreground")}>{valB}</span>
                  </div>
                  <div className="flex gap-1 h-3.5">
                    <div className="flex-1 flex justify-end">
                      <div
                        className="h-full rounded-l-full bg-[#0b3a7a] dark:bg-blue-500 transition-all"
                        style={{ width: `${(valA / maxVal) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1">
                      <div
                        className="h-full rounded-r-full bg-[#d4af37] transition-all"
                        style={{ width: `${(valB / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-5 pt-4 border-t border-border/40">
            <div className="text-center">
              <p className="text-sm font-bold text-[#0b3a7a] dark:text-blue-400">{teamA.name}</p>
              <p className="text-xs text-muted-foreground">{teamA.owner}</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-[#d4af37]">{teamB.name}</p>
              <p className="text-xs text-muted-foreground">{teamB.owner}</p>
            </div>
          </div>
        </Card>
      )}

      {teamA && teamB && (() => {
        const positions = ["QB", "RB", "WR", "TE"] as const;
        const getPlayers = (team: typeof teamA, pos: string) =>
          [...team.roster].filter(p => p.pos === pos).sort((a, b) => b.value - a.value);
        const teamConfig = [
          { team: teamA, color: "text-[#0b3a7a] dark:text-blue-400", accent: "border-[#0b3a7a]/20 dark:border-blue-400/20" },
          { team: teamB, color: "text-[#d4af37]", accent: "border-[#d4af37]/20" },
        ];

        return (
          <div className="space-y-4 sm:space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-5">
              {teamConfig.map(({ team, color }) => (
                <div key={team.id} className="px-1 sm:px-2">
                  <h3 className={`text-xs sm:text-sm font-bold ${color} truncate`}>{team.name}</h3>
                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{team.owner}</p>
                  <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
                </div>
              ))}
            </div>

            {positions.map(pos => {
              const playersA = getPlayers(teamA, pos);
              const playersB = getPlayers(teamB, pos);
              const maxRows = Math.max(playersA.length, playersB.length, 1);

              return (
                <Card key={pos} className="p-2.5 sm:p-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    <Badge variant="outline" className={`text-[9px] sm:text-[10px] w-6 sm:w-7 justify-center ${POS_COLORS[pos]}`}>{pos}</Badge>
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                      {playersA.length} vs {playersB.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:gap-5">
                    {[playersA, playersB].map((players, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {Array.from({ length: maxRows }).map((_, rowIdx) => {
                          const p = players[rowIdx];
                          if (!p) return <div key={rowIdx} className="py-0.5 sm:py-1 px-1 sm:px-2 h-[22px] sm:h-[28px]" />;
                          return (
                            <div key={p.id} className="flex items-center justify-between py-0.5 sm:py-1 px-1 sm:px-2 rounded-md hover:bg-muted/30 transition-colors" data-testid={`roster-player-${p.id}`}>
                              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                                {p.starter && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                                <span className={`text-[10px] sm:text-xs truncate ${p.starter ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{p.name}</span>
                              </div>
                              <span className="text-[10px] sm:text-xs font-mono font-semibold text-muted-foreground ml-1 flex-shrink-0">{p.value > 0 ? p.value.toLocaleString() : "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}

            {(() => {
              const getPicks = (team: typeof teamA) =>
                [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round);
              const picksA = getPicks(teamA);
              const picksB = getPicks(teamB);
              const maxPickRows = Math.max(picksA.length, picksB.length, 1);
              const totalValueA = picksA.reduce((s, p) => s + p.value, 0);
              const totalValueB = picksB.reduce((s, p) => s + p.value, 0);

              return (
                <Card className="p-2.5 sm:p-4" data-testid="draft-capital-comparison">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    <Badge variant="outline" className="text-[9px] sm:text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30 justify-center">PICKS</Badge>
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                      {picksA.length} vs {picksB.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:gap-5">
                    {[picksA, picksB].map((picks, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {Array.from({ length: maxPickRows }).map((_, rowIdx) => {
                          const pk = picks[rowIdx];
                          if (!pk) return <div key={rowIdx} className="py-0.5 sm:py-1 px-1 sm:px-2 h-[22px] sm:h-[28px]" />;
                          return (
                            <div key={`${pk.year}-${pk.round}-${rowIdx}`} className="flex items-center justify-between py-0.5 sm:py-1 px-1 sm:px-2 rounded-md hover:bg-muted/30 transition-colors">
                              <span className="text-[10px] sm:text-xs font-semibold text-foreground">{formatPickLabel(pk)}</span>
                              <span className="text-[10px] sm:text-xs font-mono font-semibold text-muted-foreground ml-1 flex-shrink-0">{pk.value > 0 ? pk.value.toLocaleString() : "—"}</span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between py-1 px-1 sm:px-2 border-t border-border/40 mt-1">
                          <span className="text-[10px] sm:text-xs font-bold text-muted-foreground">Total</span>
                          <span className="text-[10px] sm:text-xs font-mono font-bold text-foreground">{(colIdx === 0 ? totalValueA : totalValueB).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
}

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  RB: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  WR: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  TE: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
};
