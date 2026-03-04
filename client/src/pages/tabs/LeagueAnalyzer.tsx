import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getTeamTier, getTierColor, getTierBg } from "@/data/mockData";
import type { League, Team, Tier } from "@/types";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

interface AnalyzerProps {
  league: League;
}

export function PowerRankings({ league }: AnalyzerProps) {
  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const tiers: Record<Tier, Team[]> = { Elite: [], Contender: [], Competitive: [], Rebuild: [] };
  sorted.forEach((t) => { tiers[getTeamTier(t.metrics.overall)].push(t); });

  const columns = [
    { key: "rank", header: "#", sticky: true, render: (_: any, i: number) => <span className="font-semibold">{i + 1}</span> },
    { key: "name", header: "Team", render: (row: any) => <span className="font-medium">{row.name} <span className="text-muted-foreground">({row.owner})</span></span> },
    { key: "overall", header: "Overall", render: (row: any) => <span className="font-bold">{row.metrics.overall}</span> },
    { key: "tier", header: "Tier", render: (row: any) => <Badge variant="outline" className={getTierColor(getTeamTier(row.metrics.overall))}>{getTeamTier(row.metrics.overall)}</Badge> },
    { key: "starters", header: "Starters", render: (row: any) => row.metrics.starters },
    { key: "depth", header: "Depth", render: (row: any) => row.metrics.depth },
    { key: "youth", header: "Youth", render: (row: any) => row.metrics.youth },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader title="Power Rankings" subtitle="Teams ranked and grouped by tier" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {(["Elite", "Contender", "Competitive", "Rebuild"] as Tier[]).map((tier) => (
          <div key={tier} className={cn("rounded-md p-3 border border-border/40", getTierBg(tier))}>
            <h4 className={cn("text-sm font-semibold mb-2", getTierColor(tier))}>{tier}</h4>
            <div className="space-y-2">
              {tiers[tier].length === 0 && <p className="text-xs text-muted-foreground">No teams</p>}
              {tiers[tier].map((team) => (
                <Card key={team.id} className="p-3 hover-elevate">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{team.owner}</p>
                    </div>
                    <span className="text-lg font-bold text-foreground">{team.metrics.overall}</span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={sorted} />
    </div>
  );
}

export function TierBreakdown({ league }: AnalyzerProps) {
  const tierCounts: Record<Tier, number> = { Elite: 0, Contender: 0, Competitive: 0, Rebuild: 0 };
  league.teams.forEach((t) => { tierCounts[getTeamTier(t.metrics.overall)]++; });
  const total = league.teams.length;

  return (
    <div className="space-y-6">
      <SectionHeader title="Tier Breakdown" subtitle="Distribution of teams across competitive tiers" />

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold">Tier Distribution</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-[200px]">Tiers based on overall score combining starters, depth, picks, and age metrics.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-4">
          {(["Elite", "Contender", "Competitive", "Rebuild"] as Tier[]).map((tier) => (
            <div key={tier} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className={cn("text-sm font-medium", getTierColor(tier))}>{tier}</span>
                <span className="text-sm text-muted-foreground">{tierCounts[tier]} team{tierCounts[tier] !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    tier === "Elite" ? "bg-emerald-500" :
                    tier === "Contender" ? "bg-blue-500" :
                    tier === "Competitive" ? "bg-amber-500" :
                    "bg-red-500"
                  )}
                  style={{ width: `${(tierCounts[tier] / total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["Elite", "Contender", "Competitive", "Rebuild"] as Tier[]).map((tier) => (
          <Card key={tier} className={cn("p-4 text-center", getTierBg(tier))}>
            <p className="text-3xl font-bold">{tierCounts[tier]}</p>
            <p className={cn("text-sm font-medium mt-1", getTierColor(tier))}>{tier}</p>
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
    { key: "depth", label: "Depth" },
    { key: "youth", label: "Youth" },
    { key: "qb", label: "QB" },
    { key: "rb", label: "RB" },
    { key: "wr", label: "WR" },
    { key: "te", label: "TE" },
    { key: "picks", label: "Draft Capital" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader title="Roster Comparison" subtitle="Compare two teams head-to-head" />

      <div className="flex flex-wrap items-center gap-4">
        <Select value={teamAId} onValueChange={setTeamAId}>
          <SelectTrigger className="w-[200px]" data-testid="select-team-a">
            <SelectValue placeholder="Team A" />
          </SelectTrigger>
          <SelectContent>
            {league.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-semibold text-muted-foreground">VS</span>
        <Select value={teamBId} onValueChange={setTeamBId}>
          <SelectTrigger className="w-[200px]" data-testid="select-team-b">
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
        <Card className="p-5">
          <div className="space-y-4">
            {categories.map((cat) => {
              const valA = teamA.metrics[cat.key as keyof typeof teamA.metrics] as number;
              const valB = teamB.metrics[cat.key as keyof typeof teamB.metrics] as number;
              const maxVal = Math.max(valA, valB, 1);
              return (
                <div key={cat.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-medium", valA >= valB ? "text-[#0b3a7a] dark:text-blue-400" : "text-muted-foreground")}>{valA}</span>
                    <span className="font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                    <span className={cn("font-medium", valB >= valA ? "text-[#d4af37]" : "text-muted-foreground")}>{valB}</span>
                  </div>
                  <div className="flex gap-1 h-3">
                    <div className="flex-1 flex justify-end">
                      <div
                        className="h-full rounded-l-full bg-[#0b3a7a] dark:bg-blue-500"
                        style={{ width: `${(valA / maxVal) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1">
                      <div
                        className="h-full rounded-r-full bg-[#d4af37]"
                        style={{ width: `${(valB / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-4 pt-3 border-t border-border/40">
            <div className="text-center">
              <p className="text-sm font-semibold text-[#0b3a7a] dark:text-blue-400">{teamA.name}</p>
              <p className="text-xs text-muted-foreground">{teamA.owner}</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[#d4af37]">{teamB.name}</p>
              <p className="text-xs text-muted-foreground">{teamB.owner}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
