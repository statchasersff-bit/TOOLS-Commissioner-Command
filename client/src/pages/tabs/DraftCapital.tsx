import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import type { League, Team } from "@/types";
import { cn } from "@/lib/utils";

interface DraftProps {
  league: League;
  userTeam: Team;
}

export function PickValue({ league, userTeam }: DraftProps) {
  const columns = [
    { key: "year", header: "Year", sticky: true, render: (row: any) => <span className="font-medium">{row.year}</span> },
    { key: "round", header: "Round", render: (row: any) => <span>Round {row.round}</span> },
    { key: "projectedRange", header: "Projected", render: (row: any) => (
      <Badge variant="outline" className={cn(
        row.projectedRange === "Early" ? "text-emerald-600 dark:text-emerald-400" :
        row.projectedRange === "Late" ? "text-red-600 dark:text-red-400" :
        "text-amber-600 dark:text-amber-400"
      )}>
        {row.projectedRange}
      </Badge>
    )},
    { key: "value", header: "Value", render: (row: any) => <span className="font-bold">{row.value}</span> },
  ];

  const totalValue = userTeam.picks.reduce((s, p) => s + p.value, 0);
  const leagueTotal = league.teams.reduce((s, t) => s + t.picks.reduce((ps, p) => ps + p.value, 0), 0);
  const leagueAvg = Math.round(leagueTotal / league.teams.length);

  return (
    <div className="space-y-6">
      <SectionHeader title="Pick Value" subtitle={`${userTeam.name}'s draft capital inventory`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 hover-elevate">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Total Picks</p>
          <p className="text-2xl font-bold mt-1">{userTeam.picks.length}</p>
        </Card>
        <Card className="p-4 hover-elevate">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Total Value</p>
          <p className="text-2xl font-bold mt-1">{totalValue}</p>
        </Card>
        <Card className="p-4 hover-elevate">
          <p className="text-xs font-semibold text-muted-foreground uppercase">League Avg</p>
          <p className="text-2xl font-bold mt-1">{leagueAvg}</p>
        </Card>
        <Card className="p-4 hover-elevate">
          <p className="text-xs font-semibold text-muted-foreground uppercase">vs Average</p>
          <p className={cn("text-2xl font-bold mt-1", totalValue >= leagueAvg ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {totalValue >= leagueAvg ? "+" : ""}{totalValue - leagueAvg}
          </p>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={[...userTeam.picks].sort((a, b) => a.year - b.year || a.round - b.round)}
      />
    </div>
  );
}

export function PickDistribution({ league }: { league: League }) {
  const teamPickData = league.teams
    .map((t) => ({
      ...t,
      totalPicks: t.picks.length,
      totalPickValue: t.picks.reduce((s, p) => s + p.value, 0),
      firstRounders: t.picks.filter((p) => p.round === 1).length,
    }))
    .sort((a, b) => b.totalPickValue - a.totalPickValue);

  const maxPickValue = Math.max(...teamPickData.map((t) => t.totalPickValue));

  const columns = [
    { key: "rank", header: "#", sticky: true, render: (_: any, i: number) => <span className="text-muted-foreground">{i + 1}</span> },
    { key: "name", header: "Team", render: (row: any) => (
      <div>
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "totalPicks", header: "Picks", render: (row: any) => <span className="font-medium">{row.totalPicks}</span> },
    { key: "firstRounders", header: "1sts", render: (row: any) => <span className="font-bold text-[#d4af37]">{row.firstRounders}</span> },
    { key: "totalPickValue", header: "Total Value", render: (row: any) => <span className="font-bold">{row.totalPickValue}</span> },
    { key: "bar", header: "", render: (row: any) => (
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-[#0b3a7a] dark:bg-blue-500 rounded-full" style={{ width: `${(row.totalPickValue / maxPickValue) * 100}%` }} />
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <SectionHeader title="Pick Distribution" subtitle="Draft capital across the league" />
      <DataTable
        columns={columns}
        data={teamPickData}
        highlightRow={(row: any) => row.totalPickValue === maxPickValue}
      />
    </div>
  );
}
