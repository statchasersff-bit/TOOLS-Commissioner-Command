import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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

export function TradeTargets({ league, userTeam }: TradeProps) {
  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Targets" subtitle="Buy-low and sell-high opportunities based on value trends" />
      <Card className="p-8 text-center" data-testid="snapshot-notice">
        <Info className="w-6 h-6 text-[#0b3a7a] mx-auto mb-3" />
        <p className="text-sm font-semibold mb-1">Coming Soon</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Value trend tracking is being migrated to a new architecture. Buy-low and sell-high trade targets will return in a future update.
        </p>
      </Card>
    </div>
  );
}

function CrossLeagueTradeIntel({ league }: { league: League }) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [results, setResults] = useState<{ trades: import("@/lib/sleeperApi").CrossLeagueTradeResult[]; leaguesScanned: number } | null>(null);

  const selectedTeam = league.teams.find(t => t.id === selectedTeamId);

  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState("");

  const canAnalyze = !!selectedTeam?.ownerId;

  const handleAnalyze = async () => {
    if (!selectedTeamId || !canAnalyze || !selectedTeam?.ownerId) return;
    setResults(null);
    setIsScanning(true);
    setScanError(null);
    setScanProgress("Fetching leagues...");
    try {
      const { fetchCrossLeagueTrades } = await import("@/lib/sleeperApi");
      setScanProgress("Scanning trades across leagues...");
      const data = await fetchCrossLeagueTrades(selectedTeam.ownerId);
      setResults(data);
    } catch (err: any) {
      setScanError(err.message || "Failed to scan cross-league trades");
    } finally {
      setIsScanning(false);
      setScanProgress("");
    }
  };

  const formatDate = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
          Scan a user's recent trades across all their dynasty leagues (last 3 months)
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
          disabled={!selectedTeamId || !canAnalyze || isScanning}
          size="sm"
          variant="default"
          data-testid="button-analyze-cross-league"
        >
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
          Scan
        </Button>
      </div>

      {selectedTeam && !selectedTeam.ownerId && (
        <p className="text-xs text-muted-foreground mb-3">This team has no linked Sleeper account — cross-league analysis unavailable.</p>
      )}

      {isScanning && (
        <div className="text-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-[#0b3a7a] mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">{scanProgress || "Scanning..."}</p>
          <p className="text-[10px] text-muted-foreground mt-1">This may take a minute — scanning up to 15 leagues.</p>
        </div>
      )}

      {scanError && (
        <p className="text-xs text-red-500" data-testid="text-cross-league-error">{scanError}</p>
      )}

      {results && !isScanning && (
        <div data-testid="cross-league-results">
          <p className="text-[10px] text-muted-foreground mb-3">
            Scanned {results.leaguesScanned} dynasty league{results.leaguesScanned !== 1 ? "s" : ""} · {results.trades.length} trade{results.trades.length !== 1 ? "s" : ""} in the last 3 months
          </p>
          {results.trades.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No trades found for {selectedTeam?.owner} in the last 3 months.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.trades.map((trade, i) => (
                <div key={`${trade.leagueId}-${trade.timestamp}-${i}`} className="border border-border/30 rounded-lg p-4" data-testid={`cross-league-trade-${i}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{trade.leagueName}</p>
                      <p className="text-[10px] text-muted-foreground">with {trade.tradePartner} · {formatDate(trade.timestamp)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider mb-1.5">Sent</p>
                      <div className="space-y-1">
                        {trade.sent.map((p, j) => (
                          <div key={`sent-${p.playerId}-${j}`} className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 w-7 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                            <span className="text-xs truncate">{p.name}</span>
                          </div>
                        ))}
                        {trade.sentPicks.map((pick, j) => (
                          <div key={`sent-pick-${j}`} className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1 py-0 w-7 justify-center flex-shrink-0 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">PK</Badge>
                            <span className="text-xs truncate">{pick}</span>
                          </div>
                        ))}
                        {trade.sent.length === 0 && trade.sentPicks.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic">None</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1.5">Received</p>
                      <div className="space-y-1">
                        {trade.received.map((p, j) => (
                          <div key={`recv-${p.playerId}-${j}`} className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 w-7 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                            <span className="text-xs truncate">{p.name}</span>
                          </div>
                        ))}
                        {trade.receivedPicks.map((pick, j) => (
                          <div key={`recv-pick-${j}`} className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1 py-0 w-7 justify-center flex-shrink-0 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">PK</Badge>
                            <span className="text-xs truncate">{pick}</span>
                          </div>
                        ))}
                        {trade.received.length === 0 && trade.receivedPicks.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic">None</p>
                        )}
                      </div>
                    </div>
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

  const tradeBlockCandidates = sellers.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.age >= 27).map((p) => ({ ...p, teamName: t.name, ownerName: t.owner }))
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Intel" subtitle="Identify likely sellers and buyers in your league" />

      <CrossLeagueTradeIntel league={league} />

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
  const { getPlayerValue, getRedraftValue, optimizeLineup, valuesBySleeperId } = useValueModel();
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

  const signedDiff = finalA - finalB;
  const winnerSide = signedDiff >= 0 ? "A" : "B";
  const loserSide = signedDiff >= 0 ? "B" : "A";
  const winnerLabel = winnerSide === "a" ? (sideATeam?.owner || sideATeam?.name || "Side A") : (sideBTeam?.owner || sideBTeam?.name || "Side B");

  const meterPosition = useMemo(() => {
    if (finalA === 0 && finalB === 0) return 50;
    const total = finalA + finalB;
    const ratio = finalA / total;
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    return clamped * 100;
  }, [finalA, finalB]);

  const getVerdictLabel = (pct: number): string => {
    if (diffPct <= 4) return "Dead Even";
    if (diffPct <= 9) return `Slight Edge: Side ${winnerSide}`;
    if (diffPct <= 19) return `Clear Win for Side ${winnerSide}`;
    return `Major Win for Side ${winnerSide}`;
  };

  const getVerdictStyle = (pct: number): string => {
    if (pct <= 4) return "bg-[#0b3a7a]/10 dark:bg-blue-400/15 text-[#0b3a7a] dark:text-blue-300 border-[#0b3a7a]/20 dark:border-blue-400/30";
    if (pct <= 9) return "bg-[#d4af37]/10 dark:bg-[#d4af37]/15 text-[#d4af37] dark:text-[#e8c84a] border-[#d4af37]/30";
    if (pct <= 19) return "bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    return "bg-red-500/10 dark:bg-red-400/15 text-red-700 dark:text-red-400 border-red-500/30";
  };

  const positionImpact = useMemo(() => {
    if (!league || !userTeam) return null;
    const positions: ("QB" | "RB" | "WR" | "TE")[] = ["QB", "RB", "WR", "TE"];
    const rosterPositions = league.rosterPositions || [];

    const playersGivenBySideA = sideA.filter((a) => a.type === "player" && a.player).map((a) => a.player!);
    const playersGivenBySideB = sideB.filter((a) => a.type === "player" && a.player).map((a) => a.player!);

    const getTeamPosTotals = (teamId: string, pos: string, mode: "dynasty" | "redraft", deltaReceiving: Player[], deltaGiving: Player[]) => {
      const team = league.teams.find(t => t.id === teamId);
      if (!team) return 0;
      const roster = rosterPositions.length > 0 ? optimizeLineup(team.roster, rosterPositions) : team.roster;
      const base = mode === "redraft"
        ? roster.filter(p => p.starter && p.pos === pos).reduce((s, p) => s + getRedraftValue(p), 0)
        : team.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
      const added = deltaReceiving.filter(p => p.pos === pos).reduce((s, p) => mode === "redraft" ? s + getRedraftValue(p) : s + getPlayerValue(p), 0);
      const removed = deltaGiving.filter(p => p.pos === pos).reduce((s, p) => mode === "redraft" ? s + getRedraftValue(p) : s + getPlayerValue(p), 0);
      return base + added - removed;
    };

    const getRank = (teamId: string, pos: string, mode: "dynasty" | "redraft", receiving: Player[], giving: Player[]) => {
      const myTotal = getTeamPosTotals(teamId, pos, mode, receiving, giving);
      let rank = 1;
      for (const t of league.teams) {
        if (t.id === teamId) continue;
        const otherRoster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
        const otherTotal = mode === "redraft"
          ? otherRoster.filter(p => p.starter && p.pos === pos).reduce((s, p) => s + getRedraftValue(p), 0)
          : t.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
        if (otherTotal > myTotal) rank++;
      }
      return rank;
    };

    const calcImpact = (team: Team | undefined) => {
      if (!team) return null;
      const isUserSide = team.id === sideARosterId;
      const receiving = isUserSide ? playersGivenBySideB : playersGivenBySideA;
      const giving = isUserSide ? playersGivenBySideA : playersGivenBySideB;

      return positions.map((pos) => {
        const dynastyBefore = getRank(team.id, pos, "dynasty", [], []);
        const dynastyAfter = getRank(team.id, pos, "dynasty", receiving, giving);
        const redraftBefore = getRank(team.id, pos, "redraft", [], []);
        const redraftAfter = getRank(team.id, pos, "redraft", receiving, giving);
        return {
          pos,
          dynastyBefore, dynastyAfter, dynastyChange: dynastyBefore - dynastyAfter,
          redraftBefore, redraftAfter, redraftChange: redraftBefore - redraftAfter,
        };
      });
    };

    return {
      sideA: calcImpact(sideATeam),
      sideB: calcImpact(sideBTeam),
    };
  }, [league, userTeam, sideA, sideB, getPlayerValue, getRedraftValue, optimizeLineup, sideATeam, sideBTeam, sideARosterId]);

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

        {side === "b" && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground">Trade with:</span>
            <Select value={tradePartnerId || "none"} onValueChange={(v) => handleTradePartnerChange(v === "none" ? "" : v)}>
              <SelectTrigger className="flex-1 h-8 text-xs" data-testid="select-trade-partner">
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
        )}

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
              <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                  const posPlayers = [...rosterPlayers]
                    .filter((p) => p.pos === pos)
                    .sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
                  return (
                    <div key={pos} className="space-y-0.5">
                      <p className={`text-[10px] font-bold uppercase tracking-wider text-center pb-1 border-b border-border/30 ${getPositionColor(pos)}`}>
                        {pos}
                      </p>
                      {posPlayers.map((p) => {
                        const pid = p.sleeperId || p.id;
                        const isAdded = addedPlayerIds.has(pid);
                        return (
                          <button
                            key={pid}
                            className={cn(
                              "w-full flex flex-col px-1.5 py-1 rounded text-left text-xs transition-colors",
                              isAdded
                                ? "bg-[#d4af37]/10 opacity-50 cursor-default"
                                : "hover:bg-muted/40 cursor-pointer"
                            )}
                            onClick={() => !isAdded && addPlayer(side, p)}
                            disabled={isAdded}
                            data-testid={`button-roster-player-${side}-${pid}`}
                          >
                            <span className={cn("truncate text-[11px] font-medium", isAdded && "line-through")}>{p.name}</span>
                          </button>
                        );
                      })}
                      {posPlayers.length === 0 && (
                        <p className="text-[9px] text-muted-foreground/50 text-center py-2">—</p>
                      )}
                    </div>
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

      <Card className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={valueAdjustment}
                onCheckedChange={setValueAdjustment}
                data-testid="switch-value-adjustment"
              />
              <span className="text-xs sm:text-sm font-medium whitespace-nowrap">Value Adj.</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help flex-shrink-0" data-testid="icon-info-value-adjustment" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Diminishing returns on extra pieces; emphasizes the key asset in the deal. Assets are sorted by value and weighted: 100%, 85%, 72%, 60%, 50%, 42%, 36%, 31%.</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-1.5">
              <Switch
                checked={overpayTax}
                onCheckedChange={setOverpayTax}
                data-testid="switch-overpay-tax"
              />
              <span className="text-xs sm:text-sm font-medium whitespace-nowrap">Overpay Tax</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help flex-shrink-0" data-testid="icon-info-overpay-tax" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Penalizes consolidation deals. If the top asset is more than 35% of that side's raw total, a 3% penalty is applied to the adjusted total.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            className="flex-shrink-0 h-8 px-2.5 sm:px-3"
            data-testid="button-clear-trade"
          >
            <RotateCcw className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {renderSide("a", sideA, rawA)}
        {renderSide("b", sideB, rawB)}
      </div>

      {(sideA.length > 0 || sideB.length > 0) && (
        <Card className="p-5 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/10 dark:from-[#0c1929] dark:to-[#0a1628]">
          <div className="mb-5">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              Trade Verdict
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>

          <div className="space-y-5">
            <div className="relative px-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Side B Wins</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Side A Wins</span>
              </div>

              <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg, #dfe5ee 0%, #dfe5ee 100%)" }}>
                <div className="absolute inset-0 dark:hidden" style={{ background: "linear-gradient(90deg, #dfe5ee 0%, #e8ecf2 50%, #dfe5ee 100%)" }} />
                <div className="absolute inset-0 hidden dark:block" style={{ background: "linear-gradient(90deg, #12284a 0%, #1a3560 50%, #12284a 100%)" }} />

                {[25, 50, 75].map(pct => (
                  <div key={pct} className="absolute top-0 bottom-0 w-px bg-border/40 dark:bg-white/10" style={{ left: `${pct}%` }} />
                ))}

                <div className="absolute top-0 bottom-0 w-0.5 bg-[#d4af37]/60 z-10" style={{ left: "50%" }} />

                <div
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-[#d4af37] shadow-lg shadow-[#d4af37]/30 z-20 transition-all duration-700 ease-out"
                  style={{
                    left: `clamp(8px, ${meterPosition}% - 8px, calc(100% - 8px))`,
                    background: "linear-gradient(135deg, #0b3a7a 0%, #d4af37 100%)",
                  }}
                  data-testid="meter-indicator"
                />
              </div>

              <div className="flex items-center justify-center mt-1">
                <span className="text-[9px] text-muted-foreground/50 font-medium">Fair Value</span>
              </div>
            </div>

            <div className="flex items-center justify-center">
              <Badge className={`text-xs px-4 py-1.5 font-bold border ${getVerdictStyle(diffPct)}`} data-testid="badge-verdict">
                {getVerdictLabel(diffPct)}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-muted/20 dark:bg-muted/10 border border-border/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Side A</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-analysis-final-a">{Math.round(finalA).toLocaleString()}</p>
                {valueAdjustment && rawA !== finalA && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">raw {rawA.toLocaleString()}</p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/20 dark:bg-muted/10 border border-border/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Difference</p>
                <p className={`text-lg font-bold ${diff === 0 ? "text-muted-foreground" : "text-foreground"}`} data-testid="text-analysis-diff">
                  {diff === 0 ? "Even" : `${signedDiff > 0 ? "+" : ""}${Math.round(signedDiff).toLocaleString()}`}
                </p>
                {diff > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{diffPct.toFixed(1)}%</p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/20 dark:bg-muted/10 border border-border/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Side B</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-analysis-final-b">{Math.round(finalB).toLocaleString()}</p>
                {valueAdjustment && rawB !== finalB && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">raw {rawB.toLocaleString()}</p>
                )}
              </div>
            </div>

            {diffPct > 12 && (
              <p className="text-xs text-center text-muted-foreground" data-testid="text-counter-suggestion">
                Add ~{Math.round(diff).toLocaleString()} value to Side {loserSide} to balance this trade
              </p>
            )}
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
                        <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pos</th>
                        <th className="px-1 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" colSpan={2}>Redraft</th>
                        <th className="px-1 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-l border-border/30" colSpan={2}>Dynasty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row) => {
                        const renderRankChange = (before: number, after: number, change: number) => (
                          <div className="flex items-center gap-1 justify-center">
                            <span className="text-[11px] text-muted-foreground">#{before}</span>
                            <span className="text-[10px] text-muted-foreground/60">→</span>
                            <span className="text-[11px] font-semibold">{`#${after}`}</span>
                            {change !== 0 && (
                              <span className={cn(
                                "text-[10px] font-bold ml-0.5",
                                change > 0 && "text-emerald-600 dark:text-emerald-400",
                                change < 0 && "text-red-600 dark:text-red-400",
                              )}>
                                {change > 0 ? `↑${change}` : `↓${Math.abs(change)}`}
                              </span>
                            )}
                          </div>
                        );

                        return (
                          <tr key={row.pos} className="border-b border-border/20">
                            <td className="px-2 py-2">
                              <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(row.pos)}`}>{row.pos}</Badge>
                            </td>
                            <td className="px-1 py-2" colSpan={2}>
                              {renderRankChange(row.redraftBefore, row.redraftAfter, row.redraftChange)}
                            </td>
                            <td className="px-1 py-2 border-l border-border/20" colSpan={2}>
                              {renderRankChange(row.dynastyBefore, row.dynastyAfter, row.dynastyChange)}
                            </td>
                          </tr>
                        );
                      })}
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

      <div className="flex justify-center">
        <div className="p-5 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 max-w-md text-center">
          <p className="text-sm font-bold text-foreground mb-1" data-testid="text-hit-rates-cta">Curious How Often Rookie Picks Hit?</p>
          <p className="text-xs text-muted-foreground mb-4">See the data from 2017 — explore historical rookie hit rates by round and position.</p>
          <a
            href="https://statchasers.com/rookie-hit-rates/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-rookie-hit-rates"
          >
            <Button variant="default" size="sm" className="bg-[#d4af37] hover:bg-[#c5a033] text-black font-bold">
              View Rookie Hit Rates
            </Button>
          </a>
        </div>
      </div>
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

        <div className="mt-8 p-5 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 max-w-md">
          <p className="text-sm font-bold text-foreground mb-1" data-testid="text-rookie-cta">Need Help Determining 2026 Rookie Pick Values?</p>
          <p className="text-xs text-muted-foreground mb-4">See Free Draft Guide w/ Tiers</p>
          <a
            href="https://statchasers.com/rookie-guide/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-rookie-guide"
          >
            <Button variant="default" size="sm" className="bg-[#d4af37] hover:bg-[#c5a033] text-black font-bold">
              View Rookie Guide
            </Button>
          </a>
        </div>
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
