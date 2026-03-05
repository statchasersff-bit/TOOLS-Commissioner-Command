import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { getTeamTier, getTierColor, getTierBg, getPositionColor } from "@/data/mockData";
import type { League, Team, Tier } from "@/types";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, TrendingUp, TrendingDown, Target } from "lucide-react";

interface TradeProps {
  league: League;
  userTeam: Team;
}

export function TradeFinder({ league, userTeam }: TradeProps) {
  const partners = league.teams
    .filter((t) => t.id !== userTeam.id)
    .map((t) => {
      const reasons: string[] = [];
      const tier = getTeamTier(t.metrics.overall);
      if (t.metrics.rb > 70 && userTeam.metrics.rb < 50) reasons.push("RB surplus");
      if (t.metrics.wr > 70 && userTeam.metrics.wr < 50) reasons.push("WR surplus");
      if (tier === "Rebuild") reasons.push("Rebuilding - selling vets");
      if (tier === "Contender" && t.metrics.te < 40) reasons.push("Needs TE");
      if (tier === "Contender" && t.metrics.qb < 50) reasons.push("Needs QB");
      if (t.picks.filter((p) => p.round === 1).length >= 3) reasons.push("Pick rich");
      if (reasons.length === 0) reasons.push("Balanced roster");
      return { ...t, reasons, tier };
    })
    .sort((a, b) => b.reasons.length - a.reasons.length);

  const columns = [
    { key: "name", header: "Team", sticky: true, sortable: true, sortAccessor: (row: any) => row.name, render: (row: any) => (
      <div>
        <span className="font-semibold">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "tier", header: "Tier", sortable: true, sortAccessor: (row: any) => row.metrics.overall, render: (row: any) => <Badge variant="outline" className={getTierColor(row.tier)}>{row.tier}</Badge> },
    { key: "overall", header: "Score", sortable: true, sortAccessor: (row: any) => row.metrics.overall, render: (row: any) => <span className="font-bold text-lg">{row.metrics.overall}</span> },
    { key: "reasons", header: "Trade Reasons", sortable: true, sortAccessor: (row: any) => row.reasons.length, render: (row: any) => (
      <div className="flex flex-wrap gap-1">
        {row.reasons.map((r: string, i: number) => (
          <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
        ))}
      </div>
    )},
    { key: "target", header: "", render: (row: any) => (
      <Button variant="ghost" size="sm" data-testid={`button-explore-${row.id}`}>
        <ArrowRightLeft className="w-3 h-3 mr-1" /> Explore
      </Button>
    )},
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Finder" subtitle="Best trade partners based on roster needs" />
      <DataTable columns={columns} data={partners} />
    </div>
  );
}

export function TradeTargets({ league, userTeam }: TradeProps) {
  const rebuildTeams = league.teams.filter((t) => getTeamTier(t.metrics.overall) === "Rebuild" && t.id !== userTeam.id);
  const contenderTeams = league.teams.filter((t) => ["Elite", "Contender"].includes(getTeamTier(t.metrics.overall)) && t.id !== userTeam.id);

  const buyLow = rebuildTeams.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.value >= 30).map((p) => ({ ...p, ownerName: t.owner, reason: "Rebuilder selling vets" }))
  ).slice(0, 5);

  const contenderPush = contenderTeams.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.value >= 50).map((p) => ({ ...p, ownerName: t.owner, reason: "Contender depth piece" }))
  ).slice(0, 5);

  const youthUpside = league.teams
    .filter((t) => t.id !== userTeam.id)
    .flatMap((t) =>
      t.roster.filter((p) => p.age <= 24 && p.value >= 20).map((p) => ({ ...p, ownerName: t.owner, reason: "Young upside" }))
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const renderGroup = (title: string, icon: any, players: any[]) => (
    <Card className="p-6">
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
      </div>
      <div className="space-y-1">
        {players.length === 0 && <p className="text-xs text-muted-foreground">No targets found</p>}
        {players.map((p, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
              <div>
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">From {p.ownerName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Age {p.age}</span>
              <Badge variant="secondary">{p.value} pts</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Targets" subtitle="Recommended acquisition targets by strategy" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {renderGroup("Buy Low", <TrendingDown className="w-4 h-4 text-emerald-500" />, buyLow)}
        {renderGroup("Contender Push", <Target className="w-4 h-4 text-blue-500" />, contenderPush)}
        {renderGroup("Youth Upside", <TrendingUp className="w-4 h-4 text-amber-500" />, youthUpside)}
      </div>
    </div>
  );
}

export function TradeBlockScanner({ league }: { league: League }) {
  const sellers = league.teams.filter((t) => getTeamTier(t.metrics.overall) === "Rebuild");
  const buyers = league.teams.filter((t) => ["Elite", "Contender"].includes(getTeamTier(t.metrics.overall)));

  const tradeBlockCandidates = sellers.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.age >= 27).map((p) => ({ ...p, teamName: t.name, ownerName: t.owner }))
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Block Scanner" subtitle="Identify likely sellers and buyers in your league" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Likely Sellers
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-2.5">
            {sellers.map((t) => (
              <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg("Rebuild"))}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.owner}</p>
                  </div>
                  <Badge variant="outline" className={getTierColor("Rebuild")}>Rebuild</Badge>
                </div>
              </div>
            ))}
            {sellers.length === 0 && <p className="text-xs text-muted-foreground">No clear sellers identified</p>}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Likely Buyers
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-2.5">
            {buyers.map((t) => {
              const tier = getTeamTier(t.metrics.overall);
              return (
                <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg(tier))}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.owner}</p>
                    </div>
                    <Badge variant="outline" className={getTierColor(tier)}>{tier}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            Trade Block Candidates
            <Badge variant="secondary">{tradeBlockCandidates.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="space-y-1">
          {tradeBlockCandidates.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                <div>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.teamName} ({p.ownerName})</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Age {p.age}</span>
                <Badge variant="secondary">{p.value} pts</Badge>
              </div>
            </div>
          ))}
          {tradeBlockCandidates.length === 0 && <p className="text-xs text-muted-foreground">No trade block candidates found</p>}
        </div>
      </Card>
    </div>
  );
}
