import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getPositionColor, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { getStaticPickValue } from "@/data/pickValues";
import { apiRequest } from "@/lib/queryClient";
import type { League, Team, Tier, Player, Pick, TradeRecord, TradeSide, CrawlStatus } from "@/types";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, TrendingUp, TrendingDown, Target, X, Plus, Search, Info, Scale, RotateCcw, Database, Play, Pause, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

interface TradeProps {
  league: League;
  userTeam: Team;
}

export function TradeFinder({ league, userTeam }: TradeProps) {
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();
  const tradeFinderTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const partners = useMemo(() => {
    const positions = ["QB", "RB", "WR", "TE"] as const;
    const rosterPositions = league.rosterPositions || [];

    const posRedraftTotals: Record<string, Record<string, number>> = {};
    const posDynastyTotals: Record<string, Record<string, number>> = {};
    league.teams.forEach(t => {
      const roster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
      posRedraftTotals[t.id] = {};
      posDynastyTotals[t.id] = {};
      positions.forEach(pos => {
        posRedraftTotals[t.id][pos] = roster.filter(p => p.starter && p.pos === pos).reduce((s, p) => s + getRedraftValue(p), 0);
        posDynastyTotals[t.id][pos] = t.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
      });
    });

    const posRedraftRanks: Record<string, Record<string, number>> = {};
    const posDynastyRanks: Record<string, Record<string, number>> = {};
    const total = league.teams.length;
    positions.forEach(pos => {
      const byRedraft = [...league.teams].sort((a, b) => (posRedraftTotals[b.id][pos] || 0) - (posRedraftTotals[a.id][pos] || 0));
      byRedraft.forEach((t, i) => {
        if (!posRedraftRanks[t.id]) posRedraftRanks[t.id] = {};
        posRedraftRanks[t.id][pos] = i + 1;
      });
      const byDynasty = [...league.teams].sort((a, b) => (posDynastyTotals[b.id][pos] || 0) - (posDynastyTotals[a.id][pos] || 0));
      byDynasty.forEach((t, i) => {
        if (!posDynastyRanks[t.id]) posDynastyRanks[t.id] = {};
        posDynastyRanks[t.id][pos] = i + 1;
      });
    });

    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;

    const userRedraft = posRedraftRanks[userTeam.id] || {};
    const userDynasty = posDynastyRanks[userTeam.id] || {};

    const totalRedraft = league.teams.map(t => {
      const roster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
      return { id: t.id, total: roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0) };
    });
    totalRedraft.sort((a, b) => b.total - a.total);
    const totalDynasty = league.teams.map(t => ({
      id: t.id, total: t.roster.reduce((s, p) => s + getPlayerValue(p), 0),
    }));
    totalDynasty.sort((a, b) => b.total - a.total);
    const overallRedraftRank: Record<string, number> = {};
    const overallDynastyRank: Record<string, number> = {};
    totalRedraft.forEach((e, i) => { overallRedraftRank[e.id] = i + 1; });
    totalDynasty.forEach((e, i) => { overallDynastyRank[e.id] = i + 1; });

    return league.teams
      .filter((t) => t.id !== userTeam.id)
      .map((t) => {
        const tRedraft = posRedraftRanks[t.id] || {};
        const tDynasty = posDynastyRanks[t.id] || {};
        const tier = tradeFinderTierMap.get(t.id)?.tier ?? "Competitive";

        const redraftReasons: string[] = [];
        const dynastyReasons: string[] = [];

        positions.forEach(pos => {
          if (tRedraft[pos] <= topThird && userRedraft[pos] >= bottomStart) {
            redraftReasons.push(`${pos} surplus (they #${tRedraft[pos]}, you #${userRedraft[pos]})`);
          }
          if (tRedraft[pos] >= bottomStart && userRedraft[pos] <= topThird) {
            redraftReasons.push(`Needs ${pos} (they #${tRedraft[pos]})`);
          }
        });

        positions.forEach(pos => {
          if (tDynasty[pos] <= topThird && userDynasty[pos] >= bottomStart) {
            dynastyReasons.push(`${pos} surplus (they #${tDynasty[pos]}, you #${userDynasty[pos]})`);
          }
          if (tDynasty[pos] >= bottomStart && userDynasty[pos] <= topThird) {
            dynastyReasons.push(`Needs ${pos} (they #${tDynasty[pos]})`);
          }
        });

        const tOverallRedraft = overallRedraftRank[t.id] || total;
        const tOverallDynasty = overallDynastyRank[t.id] || total;
        if (tOverallDynasty <= topThird && tOverallRedraft >= bottomStart) {
          const agingTargets = t.roster.filter(p => p.age >= 28 && getRedraftValue(p) >= 2000);
          if (agingTargets.length > 0) {
            redraftReasons.push(`Strong dynasty, weak redraft — ${agingTargets.length} aging target${agingTargets.length > 1 ? "s" : ""}`);
          } else {
            redraftReasons.push("Strong dynasty, weak redraft");
          }
        }

        if (tOverallRedraft <= topThird && tOverallDynasty >= bottomStart) {
          dynastyReasons.push("Win-now heavy, dynasty thin");
        }

        return {
          ...t,
          redraftRank: tOverallRedraft,
          dynastyRank: tOverallDynasty,
          redraftReasons,
          dynastyReasons,
          tier,
          reasonCount: redraftReasons.length + dynastyReasons.length,
        };
      })
      .sort((a, b) => b.reasonCount - a.reasonCount);
  }, [league, userTeam, getPlayerValue, getRedraftValue, optimizeLineup]);

  const total = league.teams.length;

  const columns = [
    { key: "name", header: "Team", sticky: true, sortable: true, sortAccessor: (row: any) => row.name, render: (row: any) => (
      <div>
        <span className="font-semibold">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "tier", header: "Tier", sortable: true, sortAccessor: (row: any) => row.metrics.overall, render: (row: any) => <Badge variant="outline" className={getTierColor(row.tier)}>{row.tier}</Badge> },
    { key: "redraftRank", header: "Redraft", sortable: true, sortAccessor: (row: any) => row.redraftRank, render: (row: any) => (
      <span className={cn("font-bold text-base", row.redraftRank <= Math.ceil(total / 3) ? "text-emerald-600 dark:text-emerald-400" : row.redraftRank >= total - Math.ceil(total / 3) + 1 ? "text-red-500 dark:text-red-400" : "text-foreground")} data-testid={`text-redraft-rank-${row.id}`}>
        #{row.redraftRank}<span className="text-xs text-muted-foreground font-normal"> / {total}</span>
      </span>
    )},
    { key: "dynastyRank", header: "Dynasty", sortable: true, sortAccessor: (row: any) => row.dynastyRank, render: (row: any) => (
      <span className={cn("font-bold text-base", row.dynastyRank <= Math.ceil(total / 3) ? "text-emerald-600 dark:text-emerald-400" : row.dynastyRank >= total - Math.ceil(total / 3) + 1 ? "text-red-500 dark:text-red-400" : "text-foreground")} data-testid={`text-dynasty-rank-${row.id}`}>
        #{row.dynastyRank}<span className="text-xs text-muted-foreground font-normal"> / {total}</span>
      </span>
    )},
    { key: "redraftReasons", header: "Redraft Reasons", sortable: true, sortAccessor: (row: any) => row.redraftReasons.length, render: (row: any) => (
      <div className="flex flex-wrap gap-1">
        {row.redraftReasons.map((r: string, i: number) => (
          <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-redraft-reason-${row.id}-${i}`}>{r}</Badge>
        ))}
      </div>
    )},
    { key: "dynastyReasons", header: "Dynasty Reasons", sortable: true, sortAccessor: (row: any) => row.dynastyReasons.length, render: (row: any) => (
      <div className="flex flex-wrap gap-1">
        {row.dynastyReasons.map((r: string, i: number) => (
          <Badge key={i} variant="outline" className="text-xs" data-testid={`badge-dynasty-reason-${row.id}-${i}`}>{r}</Badge>
        ))}
      </div>
    )},
    { key: "target", header: "", render: (row: any) => (
      <Button variant="ghost" size="sm" data-testid={`button-explore-${row.id}`}>
        <ArrowRightLeft className="w-3 h-3 mr-1" /> Explore
      </Button>
    )},
  ];

  const tradeBlockCandidates = useMemo(() => {
    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;

    return league.teams
      .filter(t => t.id !== userTeam.id)
      .flatMap(t => {
        const tOverallDynasty = partners.find(p => p.id === t.id)?.dynastyRank ?? total;
        const tOverallRedraft = partners.find(p => p.id === t.id)?.redraftRank ?? total;
        const tier = tradeFinderTierMap.get(t.id)?.tier ?? "Competitive";
        const isRebuilder = isRebuilderTier(tier);
        const isDynastyStrong = tOverallDynasty <= topThird && tOverallRedraft >= bottomStart;

        if (!isRebuilder && !isDynastyStrong) return [];

        return t.roster
          .filter(p => p.age >= 27 && getRedraftValue(p) >= 1500)
          .map(p => ({
            ...p,
            teamName: t.name,
            ownerName: t.owner,
            tier,
            redraftVal: getRedraftValue(p),
            dynastyVal: getPlayerValue(p),
            reason: isRebuilder ? "Rebuilder" as const : "Dynasty-heavy" as const,
          }));
      })
      .sort((a, b) => b.redraftVal - a.redraftVal);
  }, [league, userTeam, partners, total, getRedraftValue, getPlayerValue, tradeFinderTierMap]);

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Finder" subtitle="Best trade partners based on positional surplus/deficit and roster imbalance" />
      <DataTable columns={columns} data={partners} />

      <Card className="p-6" data-testid="card-trade-block-candidates">
        <div className="mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            Trade Block Candidates
            <Badge variant="secondary">{tradeBlockCandidates.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">
            Veteran players (27+) on rebuilding or dynasty-heavy teams with strong redraft value — likely trade targets
          </p>
        </div>
        <div className="space-y-0">
          {tradeBlockCandidates.length === 0 && <p className="text-xs text-muted-foreground">No trade block candidates found</p>}
          {tradeBlockCandidates.slice(0, 20).map((p, i) => (
            <div key={`${p.sleeperId || p.id}-${i}`} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`trade-block-candidate-${p.sleeperId || p.id}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                <Badge variant="outline" className={`text-xs w-8 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{p.name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{p.teamName}</span>
                    <span className="text-[10px] text-muted-foreground">· {p.ownerName}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground">Age {p.age}</span>
                <div className="text-right">
                  <p className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400">{p.redraftVal.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">redraft</p>
                </div>
                <Badge variant="outline" className={cn("text-[10px]", p.reason === "Rebuilder" ? getTierColor("Rebuild") : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700")} data-testid={`trade-block-reason-${p.sleeperId || p.id}`}>
                  {p.reason}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

interface ValueChange {
  sleeperId: string;
  name: string;
  pos: string;
  team: string | null;
  age: number | null;
  currentValue: number;
  previousValue: number;
  change: number;
  changePct: number;
}

export function TradeTargets({ league, userTeam }: TradeProps) {
  const { sourceId } = useValueModel();
  const format = league.format === "SF" ? "sf" : "1qb";

  const [valueType, setValueType] = useState<"dynasty" | "redraft">("dynasty");
  const [days, setDays] = useState(30);

  const { data: changes, isLoading } = useQuery<ValueChange[]>({
    queryKey: ["/api/values/changes", format, valueType, days],
    queryFn: async () => {
      const res = await fetch(`/api/values/changes?format=${format}&type=${valueType}&days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch value changes");
      return res.json();
    },
  });

  const { data: snapshotDates } = useQuery<string[]>({
    queryKey: ["/api/values/snapshot-dates"],
    queryFn: async () => {
      const res = await fetch("/api/values/snapshot-dates");
      if (!res.ok) throw new Error("Failed to fetch snapshot dates");
      return res.json();
    },
  });

  const leagueSleeperIds = useMemo(() => {
    const ids = new Set<string>();
    league.teams.forEach(t => {
      t.roster.forEach(p => {
        if (p.sleeperId) ids.add(p.sleeperId);
      });
    });
    return ids;
  }, [league]);

  const ownerMap = useMemo(() => {
    const map = new Map<string, string>();
    league.teams.forEach(t => {
      t.roster.forEach(p => {
        if (p.sleeperId) map.set(p.sleeperId, t.id === userTeam.id ? "Your Team" : t.owner);
      });
    });
    return map;
  }, [league, userTeam]);

  const { buyLow, sellHigh } = useMemo(() => {
    if (!changes || changes.length === 0) return { buyLow: [], sellHigh: [] };

    const relevantChanges = changes.filter(c => c.currentValue >= 500);

    const buyLow = relevantChanges
      .filter(c => c.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, 15)
      .map(c => ({
        ...c,
        inLeague: leagueSleeperIds.has(c.sleeperId),
        owner: ownerMap.get(c.sleeperId) || null,
      }));

    const sellHigh = relevantChanges
      .filter(c => c.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 15)
      .map(c => ({
        ...c,
        inLeague: leagueSleeperIds.has(c.sleeperId),
        owner: ownerMap.get(c.sleeperId) || null,
      }));

    return { buyLow, sellHigh };
  }, [changes, leagueSleeperIds, ownerMap]);

  const dateCount = snapshotDates?.length || 0;
  const hasMultipleSnapshots = dateCount >= 2;

  const renderPlayerRow = (p: ValueChange & { inLeague: boolean; owner: string | null }, idx: number, isBuyLow: boolean) => (
    <div
      key={p.sleeperId}
      className={cn(
        "flex items-center justify-between py-2.5 border-b border-border/20 last:border-0",
        p.inLeague && "bg-blue-50/50 dark:bg-blue-950/20"
      )}
      data-testid={`${isBuyLow ? "buy-low" : "sell-high"}-${p.sleeperId}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}.</span>
        <Badge variant="outline" className={`text-xs w-8 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{p.name}</p>
          <div className="flex items-center gap-1.5">
            {p.team && <span className="text-[10px] text-muted-foreground">{p.team}</span>}
            {p.age && <span className="text-[10px] text-muted-foreground">· Age {p.age}</span>}
            {p.inLeague && p.owner && (
              <span className={cn("text-[10px] font-medium", p.owner === "Your Team" ? "text-[#0b3a7a] dark:text-blue-400" : "text-muted-foreground")}>
                · {p.owner}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <p className="text-sm font-bold">{p.currentValue.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">was {p.previousValue.toLocaleString()}</p>
        </div>
        <Badge
          variant={isBuyLow ? "outline" : "secondary"}
          className={cn(
            "text-xs min-w-[52px] justify-center",
            isBuyLow
              ? "text-red-600 dark:text-red-400 border-red-300 dark:border-red-800"
              : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
          )}
          data-testid={`badge-change-${p.sleeperId}`}
        >
          {p.change > 0 ? "+" : ""}{p.change.toLocaleString()}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Targets" subtitle="Buy-low and sell-high opportunities based on value trends" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Value Type:</span>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setValueType("dynasty")}
              className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", valueType === "dynasty" ? "bg-[#0b3a7a] text-white" : "hover:bg-muted/50")}
              data-testid="button-dynasty-values"
            >
              Dynasty
            </button>
            <button
              onClick={() => setValueType("redraft")}
              className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", valueType === "redraft" ? "bg-[#0b3a7a] text-white" : "hover:bg-muted/50")}
              data-testid="button-redraft-values"
            >
              Redraft
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Period:</span>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[100px] h-8 text-xs" data-testid="select-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {snapshotDates && (
          <span className="text-[10px] text-muted-foreground">
            {dateCount} snapshot{dateCount !== 1 ? "s" : ""} available
            {dateCount > 0 && ` (${snapshotDates[snapshotDates.length - 1]} — ${snapshotDates[0]})`}
          </span>
        )}
      </div>

      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#0b3a7a] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading value changes...</p>
        </Card>
      )}

      {!isLoading && !hasMultipleSnapshots && (
        <Card className="p-8 text-center" data-testid="snapshot-notice">
          <Info className="w-6 h-6 text-[#0b3a7a] mx-auto mb-3" />
          <p className="text-sm font-semibold mb-1">Building Value History</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Player values are captured daily. Once we have at least 2 snapshots, you'll see buy-low and sell-high opportunities based on value changes.
            {dateCount === 1 && " First snapshot captured today — check back tomorrow!"}
            {dateCount === 0 && " The first snapshot will be captured shortly."}
          </p>
        </Card>
      )}

      {!isLoading && hasMultipleSnapshots && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card className="p-6" data-testid="card-buy-low">
            <div className="mb-5">
              <h3 className="text-base font-bold flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-emerald-500" />
                Buy Low
              </h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
              <p className="text-[10px] text-muted-foreground mt-2">Players whose {valueType} value dropped the most — potential bargains</p>
            </div>
            <div className="space-y-0">
              {buyLow.length === 0 && <p className="text-xs text-muted-foreground">No significant value drops found</p>}
              {buyLow.map((p, i) => renderPlayerRow(p, i, true))}
            </div>
          </Card>

          <Card className="p-6" data-testid="card-sell-high">
            <div className="mb-5">
              <h3 className="text-base font-bold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-red-500" />
                Sell High
              </h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
              <p className="text-[10px] text-muted-foreground mt-2">Players whose {valueType} value surged the most — consider cashing in</p>
            </div>
            <div className="space-y-0">
              {sellHigh.length === 0 && <p className="text-xs text-muted-foreground">No significant value rises found</p>}
              {sellHigh.map((p, i) => renderPlayerRow(p, i, false))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

interface CrossLeagueTrade {
  playerName: string;
  playerId: string;
  pos: string;
  team: string;
  leagueName: string;
  leagueId: string;
  tradedTo: string;
  timestamp: number;
}

function CrossLeagueTradeIntel({ league }: { league: League }) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [results, setResults] = useState<{ trades: CrossLeagueTrade[]; leaguesScanned: number } | null>(null);

  const selectedTeam = league.teams.find(t => t.id === selectedTeamId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeam?.ownerId) throw new Error("No owner ID available");
      const rosterPlayerIds = selectedTeam.roster.map(p => p.sleeperId).filter(Boolean);
      const res = await apiRequest("POST", "/api/sleeper/cross-league-trades", {
        userId: selectedTeam.ownerId,
        currentLeagueId: league.id,
        rosterPlayerIds,
      });
      return res.json();
    },
    onSuccess: (data) => setResults(data),
  });

  const canAnalyze = !!selectedTeam?.ownerId && selectedTeam.roster.length > 0;

  const handleAnalyze = () => {
    if (!selectedTeamId || !canAnalyze) return;
    setResults(null);
    mutation.mutate();
  };

  return (
    <Card className="p-6" data-testid="card-cross-league-intel">
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Search className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
          Cross-League Trade Intel
        </h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-[10px] text-muted-foreground mt-2">
          Select a league member to scan their other leagues for players they've traded away that they still roster here
        </p>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <Select value={selectedTeamId} onValueChange={(v) => { setSelectedTeamId(v); setResults(null); }}>
          <SelectTrigger className="w-[260px]" data-testid="select-cross-league-team">
            <SelectValue placeholder="Select a team member..." />
          </SelectTrigger>
          <SelectContent>
            {league.teams.filter(t => t.ownerId).map(t => (
              <SelectItem key={t.id} value={t.id} data-testid={`option-team-${t.id}`}>
                {t.owner} — {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleAnalyze}
          disabled={!selectedTeamId || !canAnalyze || mutation.isPending}
          size="sm"
          variant="default"
          data-testid="button-analyze-cross-league"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
          Analyze
        </Button>
      </div>

      {selectedTeam && !selectedTeam.ownerId && (
        <p className="text-xs text-muted-foreground mb-3">This team has no linked Sleeper account — cross-league analysis unavailable.</p>
      )}

      {mutation.isPending && (
        <div className="text-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-[#0b3a7a] mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Scanning {selectedTeam?.owner}'s other leagues... This may take a minute.</p>
        </div>
      )}

      {mutation.isError && (
        <p className="text-xs text-red-500" data-testid="text-cross-league-error">Failed to scan leagues. Please try again.</p>
      )}

      {results && !mutation.isPending && (
        <div data-testid="cross-league-results">
          <p className="text-[10px] text-muted-foreground mb-3">
            Scanned {results.leaguesScanned} other dynasty league{results.leaguesScanned !== 1 ? "s" : ""}
          </p>
          {results.trades.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No cross-league trade signals found for {selectedTeam?.owner}.</p>
              <p className="text-[10px] text-muted-foreground mt-1">They haven't traded away any players in other leagues that they still roster here.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {results.trades.map((t, i) => (
                <div key={`${t.playerId}-${t.leagueId}-${i}`} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`cross-league-trade-${t.playerId}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={`text-xs w-8 justify-center flex-shrink-0 ${getPositionColor(t.pos)}`}>{t.pos}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{t.playerName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.team}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] font-medium text-red-500 dark:text-red-400">Traded away in</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[160px]">{t.leagueName}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400">
                      Sell Signal
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function TradeBlockScanner({ league }: { league: League }) {
  const scannerTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const sellers = league.teams.filter((t) => { const ti = scannerTierMap.get(t.id); return ti && isRebuilderTier(ti.tier); });
  const buyers = league.teams.filter((t) => { const ti = scannerTierMap.get(t.id); return ti && isContenderTier(ti.tier); });

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
            {sellers.map((t) => {
              const tier = scannerTierMap.get(t.id)?.tier ?? "Rebuild";
              return (
                <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg(tier))}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.owner}</p>
                    </div>
                    <Badge variant="outline" className={getTierColor(tier)}>{getTierEmoji(tier)} {tier}</Badge>
                  </div>
                </div>
              );
            })}
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
              const tier = scannerTierMap.get(t.id)?.tier ?? "Contender";
              return (
                <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg(tier))}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.owner}</p>
                    </div>
                    <Badge variant="outline" className={getTierColor(tier)}>{getTierEmoji(tier)} {tier}</Badge>
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

      <CrossLeagueTradeIntel league={league} />
    </div>
  );
}

const DIMINISHING_WEIGHTS = [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.36, 0.31];

interface TradeAsset {
  id: string;
  type: "player" | "pick";
  player?: Player;
  pickYear?: number;
  pickRound?: number;
  pickRange?: "Early" | "Mid" | "Late";
  value: number;
  label: string;
  pos?: string;
}

function getWeight(index: number): number {
  return index < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[index] : 0.31;
}

function calculateAdjustedTotal(assets: TradeAsset[]): number {
  const sorted = [...assets].sort((a, b) => b.value - a.value);
  return sorted.reduce((sum, asset, i) => sum + asset.value * getWeight(i), 0);
}

function calculateRawTotal(assets: TradeAsset[]): number {
  return assets.reduce((sum, a) => sum + a.value, 0);
}

interface PlayerSearchProps {
  allPlayers: Player[];
  onAdd: (player: Player) => void;
  side: "a" | "b";
  getPlayerValue: (player: Player) => number;
}

function PlayerSearchInput({ allPlayers, onAdd, side, getPlayerValue }: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    const q = query.toLowerCase();
    return allPlayers
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
      .slice(0, 10);
  }, [query, allPlayers, getPlayerValue]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search players..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          className="pl-8"
          data-testid={`input-player-search-${side}`}
        />
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {results.map((p) => {
            const val = getPlayerValue(p);
            return (
              <button
                key={p.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover-elevate"
                onClick={() => {
                  onAdd(p);
                  setQuery("");
                  setShowResults(false);
                }}
                data-testid={`button-add-player-${side}-${p.id}`}
              >
                <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.team} | Age {p.age}</span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{val.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface PickAdderProps {
  onAdd: (year: number, round: number, range: "Early" | "Mid" | "Late") => void;
  side: "a" | "b";
}

function PickAdder({ onAdd, side }: PickAdderProps) {
  const [show, setShow] = useState(false);
  const [year, setYear] = useState("2025");
  const [round, setRound] = useState("1");
  const [range, setRange] = useState<"Early" | "Mid" | "Late">("Mid");

  if (!show) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShow(true)}
        data-testid={`button-show-pick-adder-${side}`}
      >
        <Plus className="w-3 h-3 mr-1" /> Add Pick
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={year} onValueChange={setYear}>
        <SelectTrigger className="w-20" data-testid={`select-pick-year-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="2025">2025</SelectItem>
          <SelectItem value="2026">2026</SelectItem>
          <SelectItem value="2027">2027</SelectItem>
          <SelectItem value="2028">2028</SelectItem>
        </SelectContent>
      </Select>
      <Select value={round} onValueChange={setRound}>
        <SelectTrigger className="w-20" data-testid={`select-pick-round-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Rd 1</SelectItem>
          <SelectItem value="2">Rd 2</SelectItem>
          <SelectItem value="3">Rd 3</SelectItem>
          <SelectItem value="4">Rd 4</SelectItem>
        </SelectContent>
      </Select>
      <Select value={range} onValueChange={(v) => setRange(v as "Early" | "Mid" | "Late")}>
        <SelectTrigger className="w-20" data-testid={`select-pick-range-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Early">Early</SelectItem>
          <SelectItem value="Mid">Mid</SelectItem>
          <SelectItem value="Late">Late</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={() => {
          onAdd(parseInt(year), parseInt(round), range);
          setShow(false);
        }}
        data-testid={`button-confirm-pick-${side}`}
      >
        Add
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShow(false)}
        data-testid={`button-cancel-pick-${side}`}
      >
        Cancel
      </Button>
    </div>
  );
}

interface TradeCalculatorProps {
  league: League;
  userTeam: Team;
}

export function TradeCalculator({ league, userTeam }: TradeCalculatorProps) {
  const { getPlayerValue, valuesBySleeperId } = useValueModel();
  const [sideA, setSideA] = useState<TradeAsset[]>([]);
  const [sideB, setSideB] = useState<TradeAsset[]>([]);
  const [valueAdjustment, setValueAdjustment] = useState(true);
  const [overpayTax, setOverpayTax] = useState(false);
  const [tradePartnerId, setTradePartnerId] = useState<string>("");
  const [sideARosterId, setSideARosterId] = useState<string>(userTeam.id);
  const [sideBRosterId, setSideBRosterId] = useState<string>("");

  const leagueFormat = useMemo(() => {
    const sf = league.scoringFormat?.toLowerCase() || "";
    return sf.includes("sf") || sf.includes("superflex") ? "SF" : "1QB";
  }, [league]);

  const playerToTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of league.teams) {
      for (const p of team.roster) {
        map.set(p.sleeperId || p.id, team.id);
      }
    }
    return map;
  }, [league]);

  const sideATeam = useMemo(() => league.teams.find((t) => t.id === sideARosterId), [league, sideARosterId]);
  const sideBTeam = useMemo(() => league.teams.find((t) => t.id === sideBRosterId), [league, sideBRosterId]);

  const sideAPlayers = useMemo(() => sideATeam?.roster || [], [sideATeam]);
  const sideBPlayers = useMemo(() => sideBTeam?.roster || [], [sideBTeam]);

  const handleTradePartnerChange = useCallback((teamId: string) => {
    setTradePartnerId(teamId);
    setSideBRosterId(teamId);
    setSideB([]);
  }, []);

  const addPlayer = useCallback((side: "a" | "b", player: Player) => {
    const setter = side === "a" ? setSideA : setSideB;
    const val = getPlayerValue(player);
    const asset: TradeAsset = {
      id: `player-${player.sleeperId || player.id}-${Date.now()}`,
      type: "player",
      player,
      value: val,
      label: player.name,
      pos: player.pos,
    };
    setter((prev) => [...prev, asset]);

    const playerId = player.sleeperId || player.id;
    const ownerTeamId = playerToTeamMap.get(playerId);
    if (ownerTeamId) {
      if (side === "a" && !sideARosterId) {
        setSideARosterId(ownerTeamId);
      } else if (side === "b" && !sideBRosterId) {
        setSideBRosterId(ownerTeamId);
        setTradePartnerId(ownerTeamId);
      }
    }
  }, [getPlayerValue, playerToTeamMap, sideARosterId, sideBRosterId]);

  const addPick = useCallback((side: "a" | "b", year: number, round: number, range: "Early" | "Mid" | "Late") => {
    const setter = side === "a" ? setSideA : setSideB;
    const rangeKey = range.toLowerCase() as "early" | "mid" | "late";
    const val = getStaticPickValue(year, round, rangeKey);
    const asset: TradeAsset = {
      id: `pick-${year}-${round}-${range}-${Date.now()}`,
      type: "pick",
      pickYear: year,
      pickRound: round,
      pickRange: range,
      value: val,
      label: `${year} ${range} ${round}${round === 1 ? "st" : round === 2 ? "nd" : round === 3 ? "rd" : "th"}`,
    };
    setter((prev) => [...prev, asset]);
  }, []);

  const removeAsset = useCallback((side: "a" | "b", assetId: string) => {
    const setter = side === "a" ? setSideA : setSideB;
    setter((prev) => prev.filter((a) => a.id !== assetId));
  }, []);

  const clearAll = useCallback(() => {
    setSideA([]);
    setSideB([]);
    setTradePartnerId("");
    setSideARosterId(userTeam.id);
    setSideBRosterId("");
  }, [userTeam.id]);

  const rawA = calculateRawTotal(sideA);
  const rawB = calculateRawTotal(sideB);
  const adjA = calculateAdjustedTotal(sideA);
  const adjB = calculateAdjustedTotal(sideB);

  const applyOverpayPenalty = useCallback((assets: TradeAsset[], adjustedTotal: number, rawTotal: number): number => {
    if (!overpayTax || assets.length === 0) return adjustedTotal;
    const topAsset = Math.max(...assets.map((a) => a.value));
    if (topAsset > rawTotal * 0.35) {
      return adjustedTotal * 0.97;
    }
    return adjustedTotal;
  }, [overpayTax]);

  const finalA = valueAdjustment ? applyOverpayPenalty(sideA, adjA, rawA) : rawA;
  const finalB = valueAdjustment ? applyOverpayPenalty(sideB, adjB, rawB) : rawB;

  const diff = Math.abs(finalA - finalB);
  const maxVal = Math.max(finalA, finalB, 1);
  const diffPct = (diff / maxVal) * 100;

  const fairnessLabel = diffPct <= 5 ? "Fair" : diffPct <= 12 ? "Slight Overpay" : "Overpay";
  const fairnessColor = diffPct <= 5
    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
    : diffPct <= 12
      ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
      : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400";

  const winnerSide = finalA >= finalB ? "A" : "B";
  const loserSide = finalA >= finalB ? "B" : "A";

  const positionImpact = useMemo(() => {
    if (!league || !userTeam) return null;
    const positions: ("QB" | "RB" | "WR" | "TE")[] = ["QB", "RB", "WR", "TE"];

    const playersGivenBySideA = sideA.filter((a) => a.type === "player" && a.player).map((a) => a.player!);
    const playersGivenBySideB = sideB.filter((a) => a.type === "player" && a.player).map((a) => a.player!);

    const calcImpact = (team: Team | undefined) => {
      if (!team) return null;
      const starters = team.roster.filter((p) => p.starter);
      const isUserSide = team.id === sideARosterId;
      const receiving = isUserSide ? playersGivenBySideB : playersGivenBySideA;
      const giving = isUserSide ? playersGivenBySideA : playersGivenBySideB;

      return positions.map((pos) => {
        const currentVal = starters.filter((p) => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
        const addedVal = receiving.filter((p) => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
        const removedVal = giving.filter((p) => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
        const afterVal = currentVal + addedVal - removedVal;
        return { pos, before: currentVal, after: afterVal, change: afterVal - currentVal };
      });
    };

    return {
      sideA: calcImpact(sideATeam),
      sideB: calcImpact(sideBTeam),
    };
  }, [league, userTeam, sideA, sideB, getPlayerValue, sideATeam, sideBTeam, sideARosterId]);

  const allPlayers = useMemo(() => {
    const seen = new Set<string>();
    const players: Player[] = [];
    for (const team of league.teams) {
      for (const p of team.roster) {
        const key = p.sleeperId || p.id;
        if (!seen.has(key)) {
          seen.add(key);
          players.push(p);
        }
      }
    }
    return players;
  }, [league]);

  const renderSide = (side: "a" | "b", assets: TradeAsset[], rawTotal: number) => {
    const sideLabel = side === "a" ? "A" : "B";
    const rosterTeam = side === "a" ? sideATeam : sideBTeam;
    const rosterPlayers = side === "a" ? sideAPlayers : sideBPlayers;
    const addedPlayerIds = new Set(assets.filter((a) => a.type === "player" && a.player).map((a) => a.player!.sleeperId || a.player!.id));

    return (
      <Card className="p-5 flex-1">
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2" data-testid={`text-side-${side}-header`}>
              <Scale className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              Side {sideLabel} Gets...
            </h3>
            {rosterTeam && (
              <Badge variant="secondary" className="text-[10px]" data-testid={`badge-side-${side}-team`}>
                {rosterTeam.owner || rosterTeam.name}
              </Badge>
            )}
          </div>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="space-y-3">
          <PlayerSearchInput
            allPlayers={rosterPlayers.length > 0 ? rosterPlayers : allPlayers}
            onAdd={(p) => addPlayer(side, p)}
            side={side}
            getPlayerValue={getPlayerValue}
          />

          <PickAdder onAdd={(y, r, rng) => addPick(side, y, r, rng)} side={side} />

          <div className="space-y-1 min-h-[80px]">
            {assets.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center" data-testid={`text-empty-side-${side}`}>
                Add players or picks to this side
              </p>
            )}
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center justify-between py-2 px-2.5 rounded-md bg-muted/20 dark:bg-muted/10"
                data-testid={`asset-${side}-${asset.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {asset.type === "player" && asset.pos && (
                    <Badge variant="outline" className={`text-[10px] w-7 justify-center flex-shrink-0 ${getPositionColor(asset.pos)}`}>
                      {asset.pos}
                    </Badge>
                  )}
                  {asset.type === "pick" && (
                    <Badge variant="outline" className="text-[10px] w-7 justify-center flex-shrink-0 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
                      PK
                    </Badge>
                  )}
                  <span className="text-sm font-medium truncate">{asset.label}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground">{asset.value.toLocaleString()}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAsset(side, asset.id)}
                    data-testid={`button-remove-${side}-${asset.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <span className="text-xs text-muted-foreground">{assets.length} piece{assets.length !== 1 ? "s" : ""}</span>
            <span className="text-sm font-bold" data-testid={`text-raw-total-${side}`}>
              {rawTotal.toLocaleString()}
            </span>
          </div>

          {rosterTeam && rosterPlayers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {rosterTeam.owner || rosterTeam.name}'s Roster
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {[...rosterPlayers]
                  .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
                  .map((p) => {
                    const pid = p.sleeperId || p.id;
                    const isAdded = addedPlayerIds.has(pid);
                    const val = getPlayerValue(p);
                    return (
                      <button
                        key={pid}
                        className={cn(
                          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-xs transition-colors",
                          isAdded
                            ? "bg-[#d4af37]/10 opacity-50 cursor-default"
                            : "hover:bg-muted/40 cursor-pointer"
                        )}
                        onClick={() => !isAdded && addPlayer(side, p)}
                        disabled={isAdded}
                        data-testid={`button-roster-player-${side}-${pid}`}
                      >
                        <Badge variant="outline" className={`text-[9px] w-6 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>
                          {p.pos}
                        </Badge>
                        <span className={cn("flex-1 truncate", isAdded && "line-through")}>{p.name}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{val > 0 ? val.toLocaleString() : "-"}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Trade Calculator" subtitle="Evaluate trades with dynasty values and diminishing returns" />

      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="outline" className="text-xs" data-testid="badge-format">
            {leagueFormat}
          </Badge>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Trade with:</span>
            <Select value={tradePartnerId || "none"} onValueChange={(v) => handleTradePartnerChange(v === "none" ? "" : v)}>
              <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-trade-partner">
                <SelectValue placeholder="Select team..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select team...</SelectItem>
                {league.teams
                  .filter((t) => t.id !== userTeam.id)
                  .sort((a, b) => (a.owner || a.name).localeCompare(b.owner || b.name))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.owner || t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={valueAdjustment}
              onCheckedChange={setValueAdjustment}
              data-testid="switch-value-adjustment"
            />
            <span className="text-sm font-medium">Value Adjustment</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" data-testid="icon-info-value-adjustment" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">Diminishing returns on extra pieces; emphasizes the key asset in the deal. Assets are sorted by value and weighted: 100%, 85%, 72%, 60%, 50%, 42%, 36%, 31%.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={overpayTax}
              onCheckedChange={setOverpayTax}
              data-testid="switch-overpay-tax"
            />
            <span className="text-sm font-medium">Overpay Tax</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" data-testid="icon-info-overpay-tax" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">Penalizes consolidation deals. If the top asset is more than 35% of that side's raw total, a 3% penalty is applied to the adjusted total.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              data-testid="button-clear-trade"
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {renderSide("a", sideA, rawA)}
        {renderSide("b", sideB, rawB)}
      </div>

      {(sideA.length > 0 || sideB.length > 0) && (
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              Trade Analysis
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Raw Total</p>
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground">Side A</p>
                  <p className="text-lg font-bold" data-testid="text-analysis-raw-a">{rawA.toLocaleString()}</p>
                </div>
                <span className="text-muted-foreground text-xs">vs</span>
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground">Side B</p>
                  <p className="text-lg font-bold" data-testid="text-analysis-raw-b">{rawB.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {valueAdjustment && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Adjusted Total</p>
                <div className="flex items-center justify-between">
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Side A</p>
                    <p className="text-lg font-bold" data-testid="text-analysis-adj-a">{Math.round(finalA).toLocaleString()}</p>
                  </div>
                  <span className="text-muted-foreground text-xs">vs</span>
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Side B</p>
                    <p className="text-lg font-bold" data-testid="text-analysis-adj-b">{Math.round(finalB).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Verdict</p>
              <div className="flex flex-col items-center gap-2">
                <Badge className={fairnessColor} data-testid="badge-fairness">
                  {fairnessLabel}
                </Badge>
                {diff > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-diff">
                    {Math.round(diff).toLocaleString()} ({diffPct.toFixed(1)}%) in favor of Side {winnerSide}
                  </p>
                )}
              </div>
              {diffPct > 12 && (
                <p className="text-xs text-muted-foreground mt-2" data-testid="text-counter-suggestion">
                  Add ~{Math.round(diff).toLocaleString()} value to Side {loserSide} to balance
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Target className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            Position Impact
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        {!league || !userTeam ? (
          <p className="text-xs text-muted-foreground py-4 text-center" data-testid="text-no-league-impact">
            Load a league to see position impact analysis
          </p>
        ) : positionImpact && (sideA.length > 0 || sideB.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([
              { key: "sideA", label: sideATeam?.owner || sideATeam?.name || "Side A", data: positionImpact.sideA, testId: "table-position-impact-a" },
              { key: "sideB", label: sideBTeam?.owner || sideBTeam?.name || "Side B", data: positionImpact.sideB, testId: "table-position-impact-b" },
            ] as const).map(({ key, label, data, testId }) => (
              <div key={key}>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider" data-testid={`text-impact-label-${key}`}>{label}</p>
                {data ? (
                  <table className="w-full text-sm" data-testid={testId}>
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Pos</th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Before</th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">After</th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row) => (
                        <tr key={row.pos} className="border-b border-border/20">
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(row.pos)}`}>{row.pos}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-xs">{row.before.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-medium text-xs">{row.after.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={cn(
                              "font-semibold text-xs",
                              row.change > 0 && "text-emerald-600 dark:text-emerald-400",
                              row.change < 0 && "text-red-600 dark:text-red-400",
                              row.change === 0 && "text-muted-foreground"
                            )}>
                              {row.change > 0 ? "+" : ""}{row.change.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground py-3 text-center">Select a trade partner to see impact</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center" data-testid="text-empty-impact">
            Add assets to both sides to see position impact
          </p>
        )}
      </Card>
    </div>
  );
}

export function TradeDatabase({ league }: { league: League }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Trade Database"
        subtitle="Dynasty trade intelligence powered by network analysis"
      />

      <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="trade-database-coming-soon">
        <div className="w-16 h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-6">
          <Database className="w-8 h-8 text-[#0b3a7a] dark:text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2" data-testid="text-coming-soon-title">Coming Soon</h2>
        <p className="text-3xl font-black text-[#d4af37] mb-3" data-testid="text-trade-count">1M+ trades analyzed</p>
        <p className="text-sm text-muted-foreground max-w-md">
          A massive dynasty trade database is being built. Search, filter, and analyze real trades across the Sleeper network.
        </p>
      </div>
    </div>
  );
}

function TradeCard({
  trade,
  getPlayerValue,
  formatDate,
}: {
  trade: TradeRecord;
  getPlayerValue: (sleeperId: string) => number;
  formatDate: (ts: number) => string;
}) {
  const sideValues = trade.sides.map((side) => {
    const playerValue = side.playersReceived.reduce((sum, p) => sum + getPlayerValue(p.sleeperId), 0);
    const pickValue = side.picksReceived.reduce((sum, p) => {
      return sum + getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid");
    }, 0);
    return playerValue + pickValue;
  });

  const maxValue = sideValues.length > 0 ? Math.max(...sideValues) : 0;

  return (
    <Card className="p-4 hover:border-[#d4af37]/30 transition-colors" data-testid={`trade-card-${trade.tradeId}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge variant="outline" className="text-[10px]">{trade.leagueFormat}</Badge>
        <Badge variant="outline" className="text-[10px]">{trade.leagueScoringFormat}</Badge>
        <Badge variant="outline" className="text-[10px]">{trade.leagueTotalRosters}-team</Badge>
        <Badge variant="secondary" className="text-[10px]">{trade.season} Wk {trade.week}</Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">{formatDate(trade.timestamp)}</span>
      </div>

      <div className={cn(
        "grid gap-4",
        trade.sides.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
      )}>
        {trade.sides.map((side, idx) => {
          const sideTotal = sideValues[idx];
          const isWinner = sideValues.length > 1 && sideTotal === maxValue && sideValues.filter(v => v === maxValue).length === 1;

          return (
            <div
              key={side.rosterId}
              className={cn(
                "p-3 rounded-lg border",
                isWinner ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10" : "border-border/30 bg-muted/10"
              )}
              data-testid={`trade-side-${side.rosterId}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold" data-testid={`text-team-name-${side.rosterId}`}>{side.teamName}</p>
                  <p className="text-[10px] text-muted-foreground">{side.ownerName} receives:</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" data-testid={`text-side-total-${side.rosterId}`}>{sideTotal.toLocaleString()}</p>
                  {isWinner && (
                    <Badge variant="outline" className="text-[9px] border-emerald-500 text-emerald-600">Value Winner</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {side.playersReceived.map((p, pi) => {
                  const val = getPlayerValue(p.sleeperId);
                  return (
                    <div key={pi} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(p.pos)}`}>
                          {p.pos}
                        </Badge>
                        <span className="text-xs font-medium" data-testid={`text-player-name-${p.sleeperId}`}>{p.name}</span>
                        {p.team && <span className="text-[10px] text-muted-foreground">{p.team}</span>}
                      </div>
                      {val > 0 && <span className="text-[10px] text-muted-foreground" data-testid={`text-player-value-${p.sleeperId}`}>{val.toLocaleString()}</span>}
                    </div>
                  );
                })}

                {side.picksReceived.map((p, pi) => {
                  const val = getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid");
                  return (
                    <div key={`pick-${pi}`} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] w-7 justify-center bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400">
                          PK
                        </Badge>
                        <span className="text-xs font-medium">
                          {p.season} Round {p.round}
                        </span>
                        {p.originalOwnerName && p.originalOwnerName !== "Unknown" && (
                          <span className="text-[10px] text-muted-foreground">({p.originalOwnerName}'s)</span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{val.toLocaleString()}</span>
                    </div>
                  );
                })}

                {side.playersReceived.length === 0 && side.picksReceived.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic">No assets recorded</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {trade.leagueName && (
        <p className="text-[10px] text-muted-foreground mt-2 truncate" data-testid={`trade-league-name-${trade.tradeId}`}>
          {trade.leagueName}
        </p>
      )}
    </Card>
  );
}
