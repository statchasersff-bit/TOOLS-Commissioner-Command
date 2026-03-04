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
    { key: "year", header: "Year", sticky: true, render: (row: any) => <span className="font-semibold">{row.year}</span> },
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
    { key: "value", header: "Value", render: (row: any) => <span className="font-bold text-lg">{row.value}</span> },
  ];

  const totalValue = userTeam.picks.reduce((s, p) => s + p.value, 0);
  const leagueTotal = league.teams.reduce((s, t) => s + t.picks.reduce((ps, p) => ps + p.value, 0), 0);
  const leagueAvg = Math.round(leagueTotal / league.teams.length);

  return (
    <div className="space-y-8">
      <SectionHeader title="Pick Value" subtitle={`${userTeam.name}'s draft capital inventory`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5 hover-elevate">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Picks</p>
          <p className="text-3xl font-bold mt-1.5">{userTeam.picks.length}</p>
        </Card>
        <Card className="p-5 hover-elevate">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Value</p>
          <p className="text-3xl font-bold mt-1.5">{totalValue}</p>
        </Card>
        <Card className="p-5 hover-elevate">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">League Avg</p>
          <p className="text-3xl font-bold mt-1.5">{leagueAvg}</p>
        </Card>
        <Card className="p-5 hover-elevate">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">vs Average</p>
          <p className={cn("text-3xl font-bold mt-1.5", totalValue >= leagueAvg ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
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
    { key: "rank", header: "#", sticky: true, render: (_: any, i: number) => <span className="font-bold text-muted-foreground">{i + 1}</span> },
    { key: "name", header: "Team", render: (row: any) => (
      <div>
        <span className="font-semibold">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "totalPicks", header: "Picks", render: (row: any) => <span className="font-semibold">{row.totalPicks}</span> },
    { key: "firstRounders", header: "1sts", render: (row: any) => <span className="font-bold text-[#d4af37]">{row.firstRounders}</span> },
    { key: "totalPickValue", header: "Total Value", render: (row: any) => <span className="font-bold text-lg">{row.totalPickValue}</span> },
    { key: "bar", header: "", render: (row: any) => (
      <div className="w-28 h-2.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-[#0b3a7a] dark:bg-blue-500 rounded-full transition-all" style={{ width: `${(row.totalPickValue / maxPickValue) * 100}%` }} />
      </div>
    )},
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Pick Distribution" subtitle="Draft capital across the league" />
      <DataTable
        columns={columns}
        data={teamPickData}
        highlightRow={(row: any) => row.totalPickValue === maxPickValue}
      />
    </div>
  );
}
