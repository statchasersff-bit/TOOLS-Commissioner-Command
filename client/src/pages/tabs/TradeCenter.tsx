import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getPositionColor, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { getStaticPickValue } from "@/data/pickValues";
import { API_BASE } from "@/lib/apiBase";
import type { League, Team, Tier, Player, Pick, TradeRecord, TradeSide, CrawlStatus } from "@/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ArrowRightLeft, TrendingUp, TrendingDown, Target, X, Plus, Search, Scale, RotateCcw, Database, Play, Pause, Loader2, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

interface TradeProps {
  league: League;
  userTeam: Team;
}

interface TradeProposal {
  partner: Team;
  gives: Player[];
  gets: Player[];
  giveVal: number;
  getVal: number;
  diff: number;
  needScore: number;
  type: "1v1" | "2v1" | "1v2";
  rationale: string;
}

function PlayerChip({ player, value }: { player: Player; value: number }) {
  const sid = player.sleeperId ?? player.id;
  return (
    <div className="flex items-center gap-1.5 py-1">
      <PlayerAvatar
        id={sid}
        name={player.name}
        pos={player.pos}
        team={player.team ?? ""}
        size="sm"
        sub={value.toLocaleString()}
      />
    </div>
  );
}

function TradeProposalCard({ proposal, mode }: { proposal: TradeProposal; mode: "dynasty" | "redraft" }) {
  const valueDiff = proposal.getVal - proposal.giveVal;
  const maxVal = Math.max(proposal.giveVal, proposal.getVal);
  const diffPct = maxVal > 0 ? Math.abs(valueDiff) / maxVal : 0;
  const isEven = diffPct < 0.05;
  const isFavorable = valueDiff > 0;
  const typeLabel = proposal.type === "1v1" ? "1-for-1" : proposal.type === "2v1" ? "2-for-1" : "1-for-2";

  return (
    <div className="rounded-xl border border-border/50 p-4 bg-muted/10 hover:bg-muted/25 transition-colors" data-testid={`proposal-card-${proposal.partner.id}`}>
      <div className="flex items-center gap-2 mb-3">
        <img
          src={proposal.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
          alt={proposal.partner.owner}
          className="w-7 h-7 rounded-full object-cover bg-muted flex-shrink-0"
          onError={(e) => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold">{proposal.partner.name}</span>
          <span className="text-xs text-muted-foreground ml-1.5">· {proposal.partner.owner}</span>
        </div>
        <Badge variant="outline" className="text-[10px] flex-shrink-0">{typeLabel}</Badge>
      </div>

      <div className="grid grid-cols-[1fr_28px_1fr] gap-2 items-start">
        <div>
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">You send</p>
          {proposal.gives.map((p, i) => <PlayerChip key={i} player={p} value={proposal.giveVal / proposal.gives.length} />)}
        </div>
        <div className="flex items-center justify-center pt-4">
          <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground/60" />
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">You receive</p>
          {proposal.gets.map((p, i) => <PlayerChip key={i} player={p} value={proposal.getVal / proposal.gets.length} />)}
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground italic truncate">{proposal.rationale}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">{proposal.giveVal.toLocaleString()} → {proposal.getVal.toLocaleString()}</span>
          <Badge
            variant={isEven ? "secondary" : isFavorable ? "default" : "outline"}
            className={cn("text-[10px]", isFavorable && !isEven && "bg-emerald-600 dark:bg-emerald-700 text-white border-0", !isFavorable && !isEven && "text-amber-600 dark:text-amber-400 border-amber-400")}
          >
            {isEven ? "Even" : isFavorable ? `+${Math.round(Math.abs(valueDiff)).toLocaleString()} for you` : `+${Math.round(Math.abs(valueDiff)).toLocaleString()} for them`}
          </Badge>
        </div>
      </div>
    </div>
  );
}

export function TradeFinder({ league, userTeam }: TradeProps) {
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();
  const tradeFinderTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const [proposalMode, setProposalMode] = useState<"dynasty" | "redraft">("dynasty");
  const [posFilter, setPosFilter] = useState<string>("all");
  const [showAllProposals, setShowAllProposals] = useState(false);

  const positions = ["QB", "RB", "WR", "TE"] as const;

  const { userNeeds, userSurplus, partnerNeedsMap, partnerSurplusMap } = useMemo(() => {
    const getValue = (p: Player) => proposalMode === "dynasty" ? getPlayerValue(p) : getRedraftValue(p);
    const leagueSize = league.teams.length;
    const topThird = Math.ceil(leagueSize / 3);
    const bottomThird = leagueSize - topThird;

    // Positional STARTER value for every team — use Sleeper's actual starter flag.
    // This correctly handles FLEX slots: a player in a FLEX spot is marked starter: true
    // by Sleeper, so they're counted here without needing to infer slot types.
    const teamPosTotals = new Map<string, Record<string, number>>();
    league.teams.forEach(t => {
      const totals: Record<string, number> = {};
      positions.forEach(pos => {
        totals[pos] = t.roster
          .filter(p => p.pos === pos && p.starter)
          .reduce((s, p) => s + getValue(p), 0);
      });
      teamPosTotals.set(t.id, totals);
    });

    // League-relative rank for each team at each position (1 = best)
    const teamPosRanks = new Map<string, Record<string, number>>();
    for (const pos of positions) {
      const sorted = [...league.teams].sort((a, b) =>
        (teamPosTotals.get(b.id)?.[pos] ?? 0) - (teamPosTotals.get(a.id)?.[pos] ?? 0)
      );
      sorted.forEach((t, i) => {
        if (!teamPosRanks.has(t.id)) teamPosRanks.set(t.id, {});
        teamPosRanks.get(t.id)![pos] = i + 1;
      });
    }

    // User surplus = top-33% league-wide AND has more quality depth than required starters
    // User need    = bottom-33% league-wide
    const MIN_SURPLUS_DEPTH = 1000;
    const userRanks = teamPosRanks.get(userTeam.id) ?? {};
    const userNeeds = new Set(positions.filter(pos =>
      (userRanks[pos] ?? leagueSize) > bottomThird
    ));
    const userSurplus = new Set(positions.filter(pos => {
      if ((userRanks[pos] ?? leagueSize) > topThird) return false; // must be top-33% in league
      // surplus = has at least one quality non-starter (bench depth) at this position
      const qualityBench = userTeam.roster.filter(p => p.pos === pos && !p.starter && getValue(p) >= MIN_SURPLUS_DEPTH).length;
      return qualityBench > 0;
    }));

    // Partners: league-relative ranks for both needs and surplus
    const partnerNeedsMap = new Map<string, Set<string>>();
    const partnerSurplusMap = new Map<string, Set<string>>();
    league.teams.forEach(t => {
      const ranks = teamPosRanks.get(t.id) ?? {};
      partnerNeedsMap.set(t.id, new Set(positions.filter(pos => (ranks[pos] ?? leagueSize) > bottomThird)));
      partnerSurplusMap.set(t.id, new Set(positions.filter(pos => (ranks[pos] ?? leagueSize) <= topThird)));
    });

    return { userNeeds, userSurplus, partnerNeedsMap, partnerSurplusMap };
  }, [league, userTeam, getPlayerValue, getRedraftValue, proposalMode]);

  const generatedTrades = useMemo<TradeProposal[]>(() => {
    const getValue = (p: Player) => proposalMode === "dynasty" ? getPlayerValue(p) : getRedraftValue(p);
    const FAIR_THRESHOLD = 0.22;
    const MIN_VALUE = 800;
    const MAX_POOL = 7;
    const MAX_PER_PARTNER = 4;

    // Core starters: use Sleeper's actual starter flag (includes FLEX slots).
    // This prevents offering any player who is actually starting, regardless of position slot type.
    const coreStarters = new Set<string>(
      userTeam.roster.filter(p => p.starter).map(p => p.id)
    );

    const buildRationale = (gives: Player[], gets: Player[], pNeeds: Set<string>, pSurplus: Set<string>): string => {
      const parts: string[] = [];
      const getPositions = [...new Set(gets.map(p => p.pos))];
      const givePositions = [...new Set(gives.map(p => p.pos))];
      if (getPositions.some(pos => userNeeds.has(pos))) parts.push(`fills your ${getPositions.filter(p => userNeeds.has(p)).join("/")} need`);
      if (givePositions.some(pos => userSurplus.has(pos))) parts.push(`uses your ${givePositions.filter(p => userSurplus.has(p)).join("/")} depth`);
      if (givePositions.some(pos => pNeeds.has(pos))) parts.push(`addresses their ${givePositions.filter(p => pNeeds.has(p)).join("/")} need`);
      if (getPositions.some(pos => pSurplus.has(pos))) parts.push(`targets their ${getPositions.filter(p => pSurplus.has(p)).join("/")} surplus`);
      return parts.length > 0 ? parts.slice(0, 2).join(" · ") : "Value-equivalent swap";
    };

    const allProposals: TradeProposal[] = [];

    for (const partner of league.teams.filter(t => t.id !== userTeam.id)) {
      const pNeeds = partnerNeedsMap.get(partner.id) ?? new Set();
      const pSurplus = partnerSurplusMap.get(partner.id) ?? new Set();

      const myOffers = userTeam.roster
        .filter(p => getValue(p) >= MIN_VALUE && !coreStarters.has(p.id))
        .sort((a, b) => getValue(b) - getValue(a))
        .slice(0, MAX_POOL);

      const theirTargets = partner.roster
        .filter(p => getValue(p) >= MIN_VALUE)
        .sort((a, b) => getValue(b) - getValue(a))
        .slice(0, MAX_POOL);

      if (!myOffers.length || !theirTargets.length) continue;

      const partnerProposals: TradeProposal[] = [];

      // 1v1
      for (const give of myOffers) {
        const gv = getValue(give);
        for (const get of theirTargets) {
          const rv = getValue(get);
          const maxV = Math.max(gv, rv);
          if (maxV < 1000) continue;
          const diff = Math.abs(gv - rv) / maxV;
          if (diff <= FAIR_THRESHOLD) {
            const needScore =
              (userNeeds.has(get.pos) ? 3 : 0) +
              (userSurplus.has(give.pos) ? 2 : 0) +
              (pNeeds.has(give.pos) ? 3 : 0) +
              (pSurplus.has(get.pos) ? 2 : 0);
            partnerProposals.push({
              partner, gives: [give], gets: [get],
              giveVal: gv, getVal: rv,
              diff, needScore, type: "1v1",
              rationale: buildRationale([give], [get], pNeeds, pSurplus),
            });
          }
        }
      }

      // 2v1 (user sends 2, gets 1 star)
      const top5Offers = myOffers.slice(0, 5);
      const top5Targets = theirTargets.slice(0, 5);
      for (let i = 0; i < top5Offers.length; i++) {
        for (let j = i + 1; j < top5Offers.length; j++) {
          const gv = getValue(top5Offers[i]) + getValue(top5Offers[j]);
          for (const get of top5Targets) {
            const rv = getValue(get);
            if (rv < 2500) continue;
            const maxV = Math.max(gv, rv);
            const diff = Math.abs(gv - rv) / maxV;
            if (diff <= FAIR_THRESHOLD) {
              const needScore =
                (userNeeds.has(get.pos) ? 4 : 0) +
                (userSurplus.has(top5Offers[i].pos) ? 1 : 0) +
                (userSurplus.has(top5Offers[j].pos) ? 1 : 0) +
                (pNeeds.has(top5Offers[i].pos) ? 2 : 0) +
                (pNeeds.has(top5Offers[j].pos) ? 2 : 0);
              partnerProposals.push({
                partner, gives: [top5Offers[i], top5Offers[j]], gets: [get],
                giveVal: gv, getVal: rv,
                diff, needScore, type: "2v1",
                rationale: buildRationale([top5Offers[i], top5Offers[j]], [get], pNeeds, pSurplus),
              });
            }
          }
        }
      }

      // 1v2 (user sends 1 star, gets 2)
      for (const give of top5Offers) {
        const gv = getValue(give);
        if (gv < 2500) continue;
        for (let i = 0; i < top5Targets.length; i++) {
          for (let j = i + 1; j < top5Targets.length; j++) {
            const rv = getValue(top5Targets[i]) + getValue(top5Targets[j]);
            const maxV = Math.max(gv, rv);
            const diff = Math.abs(gv - rv) / maxV;
            if (diff <= FAIR_THRESHOLD) {
              const needScore =
                (userNeeds.has(top5Targets[i].pos) ? 3 : 0) +
                (userNeeds.has(top5Targets[j].pos) ? 3 : 0) +
                (userSurplus.has(give.pos) ? 2 : 0) +
                (pNeeds.has(give.pos) ? 4 : 0);
              partnerProposals.push({
                partner, gives: [give], gets: [top5Targets[i], top5Targets[j]],
                giveVal: gv, getVal: rv,
                diff, needScore, type: "1v2",
                rationale: buildRationale([give], [top5Targets[i], top5Targets[j]], pNeeds, pSurplus),
              });
            }
          }
        }
      }

      partnerProposals.sort((a, b) => (b.needScore * 10 - b.diff * 100) - (a.needScore * 10 - a.diff * 100));
      allProposals.push(...partnerProposals.slice(0, MAX_PER_PARTNER));
    }

    return allProposals.sort((a, b) => (b.needScore * 10 - b.diff * 100) - (a.needScore * 10 - a.diff * 100));
  }, [league, userTeam, getPlayerValue, getRedraftValue, proposalMode, userNeeds, userSurplus, partnerNeedsMap, partnerSurplusMap]);

  const filteredProposals = useMemo(() => {
    if (posFilter === "all") return generatedTrades;
    return generatedTrades.filter(p =>
      p.gets.some(pl => pl.pos === posFilter) || p.gives.some(pl => pl.pos === posFilter)
    );
  }, [generatedTrades, posFilter]);

  const displayedProposals = showAllProposals ? filteredProposals : filteredProposals.slice(0, 12);

  const total = league.teams.length;

  const tradeBlockCandidates = useMemo(() => {
    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;
    const totalDynasty = [...league.teams].sort((a, b) =>
      b.roster.reduce((s, p) => s + getPlayerValue(p), 0) - a.roster.reduce((s, p) => s + getPlayerValue(p), 0)
    );
    const totalRedraft = [...league.teams].sort((a, b) =>
      b.roster.reduce((s, p) => s + getRedraftValue(p), 0) - a.roster.reduce((s, p) => s + getRedraftValue(p), 0)
    );
    const dynRank: Record<string, number> = {};
    const rdRank: Record<string, number> = {};
    totalDynasty.forEach((t, i) => { dynRank[t.id] = i + 1; });
    totalRedraft.forEach((t, i) => { rdRank[t.id] = i + 1; });

    return league.teams
      .filter(t => t.id !== userTeam.id)
      .flatMap(t => {
        const tier = tradeFinderTierMap.get(t.id)?.tier ?? "Balanced";
        const isRebuilder = isRebuilderTier(tier);
        const isDynastyStrong = (dynRank[t.id] ?? total) <= topThird && (rdRank[t.id] ?? total) >= bottomStart;
        if (!isRebuilder && !isDynastyStrong) return [];
        return t.roster
          .filter(p => p.age >= 27 && getRedraftValue(p) >= 1500)
          .map(p => ({
            ...p, teamName: t.name, ownerName: t.owner, tier,
            redraftVal: getRedraftValue(p),
            reason: isRebuilder ? "Rebuilder" as const : "Dynasty-heavy" as const,
          }));
      })
      .sort((a, b) => b.redraftVal - a.redraftVal);
  }, [league, userTeam, getRedraftValue, getPlayerValue, tradeFinderTierMap, total]);

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Finder" subtitle="AI-generated trade proposals based on roster needs, positional value, and fair market rates" />

      {/* Trade Proposals */}
      <Card className="p-6" data-testid="card-trade-proposals">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              Trade Proposals
              <Badge variant="secondary">{filteredProposals.length}</Badge>
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            <p className="text-[10px] text-muted-foreground mt-2">Fair 1v1, 2v1, and 1v2 packages ranked by positional need + value match</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setProposalMode("dynasty")}
                className={cn("px-2.5 py-1 text-xs font-medium transition-colors", proposalMode === "dynasty" ? "bg-[#0b3a7a] text-white" : "bg-transparent text-muted-foreground hover:text-foreground")}
                data-testid="btn-mode-dynasty"
              >Dynasty</button>
              <button
                onClick={() => setProposalMode("redraft")}
                className={cn("px-2.5 py-1 text-xs font-medium transition-colors border-l border-border", proposalMode === "redraft" ? "bg-[#0b3a7a] text-white" : "bg-transparent text-muted-foreground hover:text-foreground")}
                data-testid="btn-mode-redraft"
              >Redraft</button>
            </div>
            <select
              value={posFilter}
              onChange={e => { setPosFilter(e.target.value); setShowAllProposals(false); }}
              className="text-xs border border-border rounded-lg px-2 py-1 bg-background text-foreground"
              data-testid="select-pos-filter"
            >
              <option value="all">All positions</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
            </select>
          </div>
        </div>

        {filteredProposals.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No fair trade proposals found.</p>
            <p className="text-xs text-muted-foreground mt-1">This can happen when roster values are very uneven or player data hasn't loaded yet.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displayedProposals.map((proposal, i) => (
                <TradeProposalCard key={i} proposal={proposal} mode={proposalMode} />
              ))}
            </div>
            {!showAllProposals && filteredProposals.length > 12 && (
              <Button variant="outline" className="w-full mt-4" onClick={() => setShowAllProposals(true)} data-testid="btn-show-more-proposals">
                Show {filteredProposals.length - 12} more proposals
              </Button>
            )}
          </>
        )}
      </Card>

      {/* Partner Analysis */}
      <Card className="p-6" data-testid="card-partner-analysis">
        <div className="mb-5">
          <h3 className="text-base font-bold">Partner Analysis</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">All league teams ranked by trade compatibility: positional overlap, tier mismatch, and roster needs</p>
        </div>
        <div className="space-y-0">
          {league.teams.filter(t => t.id !== userTeam.id).map((t, i) => {
            const tier = tradeFinderTierMap.get(t.id)?.tier ?? "Balanced";
            const dynVal = t.roster.reduce((s, p) => s + getPlayerValue(p), 0);
            const rdVal = t.roster.reduce((s, p) => s + getRedraftValue(p), 0);
            const proposalCount = generatedTrades.filter(p => p.partner.id === t.id).length;
            return (
              <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`partner-row-${t.id}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={t.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                    alt={t.owner}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 bg-muted"
                    onError={(e) => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                    data-testid={`img-partner-avatar-${t.id}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{t.name}</p>
                    <span className="text-[10px] text-muted-foreground">{t.owner}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className={cn("text-[10px]", getTierColor(tier))}>{tier}</Badge>
                  {proposalCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]" data-testid={`badge-proposals-count-${t.id}`}>
                      {proposalCount} proposal{proposalCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  <div className="text-right hidden sm:block">
                    <p className="text-[10px] text-muted-foreground">Dyn <span className="font-semibold text-foreground">{(dynVal / 1000).toFixed(1)}k</span></p>
                    <p className="text-[10px] text-muted-foreground">RD <span className="font-semibold text-foreground">{(rdVal / 1000).toFixed(1)}k</span></p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Trade Block Candidates */}
      <Card className="p-6" data-testid="card-trade-block-candidates">
        <div className="mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            Trade Block Candidates
            <Badge variant="secondary">{tradeBlockCandidates.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">
            Veteran players (27+) on rebuilding or dynasty-heavy teams with strong redraft value. Likely available.
          </p>
        </div>
        <div className="space-y-0">
          {tradeBlockCandidates.length === 0 && <p className="text-xs text-muted-foreground">No trade block candidates found</p>}
          {tradeBlockCandidates.slice(0, 20).map((p, i) => (
            <div key={`${p.sleeperId || p.id}-${i}`} className="flex items-center gap-2 py-2.5 border-b border-border/20 last:border-0" data-testid={`trade-block-candidate-${p.sleeperId || p.id}`}>
              <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
              <PlayerAvatar
                id={p.sleeperId || p.id}
                name={p.name}
                pos={p.pos}
                team={p.team ?? ""}
                size="sm"
                sub={`${p.ownerName} · Age ${p.age}`}
              />
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums">{p.redraftVal.toLocaleString()}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", p.reason === "Rebuilder" ? getTierColor("Future Powerhouse") : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700")} data-testid={`trade-block-reason-${p.sleeperId || p.id}`}>
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


type UserScanState = { status: "loading" | "done" | "error"; trades: import("@/lib/sleeperApi").CrossLeagueTradeResult[]; leaguesScanned: number; error?: string };

function CrossLeagueTradeIntel({ league }: { league: League }) {
  const teamsWithOwner = useMemo(() => league.teams.filter(t => t.ownerId), [league.teams]);
  const [scanResults, setScanResults] = useState<Map<string, UserScanState>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const hasScannedRef = useRef(false);

  useEffect(() => {
    if (hasScannedRef.current || teamsWithOwner.length === 0) return;
    hasScannedRef.current = true;

    setScanResults(new Map(teamsWithOwner.map(t => [t.id, { status: "loading", trades: [], leaguesScanned: 0 }])));

    import("@/lib/sleeperApi").then(({ fetchCrossLeagueTrades }) => {
      teamsWithOwner.forEach(async (team) => {
        try {
          const data = await fetchCrossLeagueTrades(team.ownerId!);
          setScanResults(prev => {
            const next = new Map(prev);
            next.set(team.id, { status: "done", trades: data.trades, leaguesScanned: data.leaguesScanned });
            return next;
          });
        } catch (err: any) {
          setScanResults(prev => {
            const next = new Map(prev);
            next.set(team.id, { status: "error", trades: [], leaguesScanned: 0, error: err.message || "Failed" });
            return next;
          });
        }
      });
    });
  }, [teamsWithOwner]);

  const loadingCount = useMemo(() => [...scanResults.values()].filter(r => r.status === "loading").length, [scanResults]);
  const doneCount = useMemo(() => [...scanResults.values()].filter(r => r.status === "done").length, [scanResults]);

  const formatDate = (ts: number) => {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <Card className="p-6" data-testid="card-cross-league-intel">
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
          Cross-League Trade Intel
          {loadingCount > 0 && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-[10px] text-muted-foreground mt-2">
          {loadingCount > 0
            ? `Scanning ${loadingCount} remaining user${loadingCount !== 1 ? "s" : ""}...`
            : `Scanned all ${doneCount} user${doneCount !== 1 ? "s" : ""} · recent trades across their dynasty leagues`}
        </p>
      </div>

      {teamsWithOwner.length === 0 && (
        <p className="text-xs text-muted-foreground">No linked Sleeper accounts found in this league.</p>
      )}

      <div className="space-y-1" data-testid="cross-league-user-list">
        {teamsWithOwner.map(team => {
          const result = scanResults.get(team.id);
          const isExpanded = expandedId === team.id;
          const isLoading = result?.status === "loading" || !result;
          const isDone = result?.status === "done";
          const isError = result?.status === "error";

          return (
            <div key={team.id} className="rounded-lg border border-border/30 overflow-hidden" data-testid={`cross-league-user-${team.id}`}>
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left disabled:opacity-60 disabled:cursor-default"
                onClick={() => isDone && setExpandedId(isExpanded ? null : team.id)}
                disabled={isLoading || isError}
                data-testid={`button-expand-user-${team.id}`}
              >
                <img
                  src={team.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                  alt={team.owner}
                  className="w-8 h-8 rounded-full flex-shrink-0 object-cover bg-muted"
                  onError={(e) => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{team.owner}</p>
                  {team.owner !== team.name && (
                    <p className="text-[10px] text-muted-foreground truncate">{team.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  {isDone && (
                    <Badge variant="secondary" className="text-[10px]" data-testid={`badge-trade-count-${team.id}`}>
                      {result.trades.length} trade{result.trades.length !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {isError && (
                    <Badge variant="outline" className="text-[10px] text-red-500 border-red-300">Error</Badge>
                  )}
                  {isDone && (
                    <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", isExpanded && "rotate-180")} />
                  )}
                </div>
              </button>

              {isExpanded && isDone && (
                <div className="border-t border-border/20 bg-muted/10 px-3 py-3">
                  <p className="text-[10px] text-muted-foreground mb-3">
                    {result.leaguesScanned} league{result.leaguesScanned !== 1 ? "s" : ""} scanned · last 3 months
                  </p>
                  {result.trades.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No trades found for {team.owner} in the last 3 months.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {result.trades.map((trade, i) => (
                        <div key={`${trade.leagueId}-${trade.timestamp}-${i}`} className="border border-border/20 rounded-lg p-3 bg-background" data-testid={`cross-league-trade-${team.id}-${i}`}>
                          <div className="mb-2.5">
                            <p className="text-xs font-bold text-foreground truncate">{trade.leagueName}</p>
                            <p className="text-[10px] text-muted-foreground">with {trade.tradePartner} · {formatDate(trade.timestamp)}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <p className="text-[9px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider mb-1">Sent</p>
                              <div className="space-y-1">
                                {trade.sent.map((p, j) => (
                                  <div key={`sent-${p.playerId}-${j}`} className="flex items-center gap-1.5">
                                    <PlayerAvatar id={p.playerId} name={p.name} pos={p.pos} team={(p as any).team ?? ""} size="xs" compact />
                                    <span className="text-[11px] truncate flex-1">{p.name}</span>
                                    <Badge variant="outline" className={`text-[8px] px-0.5 py-0 h-3.5 flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                                  </div>
                                ))}
                                {trade.sentPicks.map((pick, j) => (
                                  <div key={`sent-pick-${j}`} className="flex items-center gap-1.5">
                                    <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3.5 w-6 justify-center flex-shrink-0 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">PK</Badge>
                                    <span className="text-[11px] truncate">{pick}</span>
                                  </div>
                                ))}
                                {trade.sent.length === 0 && trade.sentPicks.length === 0 && <p className="text-[10px] text-muted-foreground italic">None</p>}
                              </div>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Received</p>
                              <div className="space-y-1">
                                {trade.received.map((p, j) => (
                                  <div key={`recv-${p.playerId}-${j}`} className="flex items-center gap-1.5">
                                    <PlayerAvatar id={p.playerId} name={p.name} pos={p.pos} team={(p as any).team ?? ""} size="xs" compact />
                                    <span className="text-[11px] truncate flex-1">{p.name}</span>
                                    <Badge variant="outline" className={`text-[8px] px-0.5 py-0 h-3.5 flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                                  </div>
                                ))}
                                {trade.receivedPicks.map((pick, j) => (
                                  <div key={`recv-pick-${j}`} className="flex items-center gap-1.5">
                                    <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3.5 w-6 justify-center flex-shrink-0 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">PK</Badge>
                                    <span className="text-[11px] truncate">{pick}</span>
                                  </div>
                                ))}
                                {trade.received.length === 0 && trade.receivedPicks.length === 0 && <p className="text-[10px] text-muted-foreground italic">None</p>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function TradeBlockScanner({ league }: { league: League }) {
  const { getRedraftValue, getPlayerValue } = useValueModel();
  const scannerTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const tradeBlockCandidates = useMemo(() => {
    const total = league.teams.length;
    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;

    const totalDynasty = [...league.teams]
      .sort((a, b) => b.roster.reduce((s, p) => s + getPlayerValue(p), 0) - a.roster.reduce((s, p) => s + getPlayerValue(p), 0));
    const totalRedraft = [...league.teams]
      .sort((a, b) => b.roster.reduce((s, p) => s + getRedraftValue(p), 0) - a.roster.reduce((s, p) => s + getRedraftValue(p), 0));

    const dynastyRank: Record<string, number> = {};
    const redraftRank: Record<string, number> = {};
    totalDynasty.forEach((t, i) => { dynastyRank[t.id] = i + 1; });
    totalRedraft.forEach((t, i) => { redraftRank[t.id] = i + 1; });

    return league.teams
      .flatMap(t => {
        const tier = scannerTierMap.get(t.id)?.tier ?? "Balanced";
        const isRebuilder = isRebuilderTier(tier);
        const isDynastyHeavy = (dynastyRank[t.id] ?? total) <= topThird && (redraftRank[t.id] ?? total) >= bottomStart;
        if (!isRebuilder && !isDynastyHeavy) return [];
        return t.roster
          .filter(p => p.age >= 27 && getRedraftValue(p) >= 1500)
          .map(p => ({
            ...p,
            teamName: t.name,
            ownerName: t.owner,
            redraftVal: getRedraftValue(p),
            reason: isRebuilder ? "Rebuilder" as const : "Dynasty-heavy" as const,
          }));
      })
      .sort((a, b) => b.redraftVal - a.redraftVal);
  }, [league, scannerTierMap, getRedraftValue, getPlayerValue]);

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Intel" subtitle="Identify likely sellers and buyers in your league" />

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
  const [year, setYear] = useState("2026");
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
  const valueAdjustment = true;
  const overpayTax = true;
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

  // sideA = what sideA *sends* (= what sideB receives); sideB = what sideB *sends* (= what sideA receives)
  // Winner is whoever RECEIVES more, i.e. whose partner sent higher value
  const signedDiff = finalB - finalA; // positive when sideA receives more (finalB > finalA)
  const winnerSide = signedDiff >= 0 ? "A" : "B";
  const loserSide  = signedDiff >= 0 ? "B" : "A";
  const winnerLabel = winnerSide === "A" ? (sideATeam?.owner || sideATeam?.name || "Side A") : (sideBTeam?.owner || sideBTeam?.name || "Side B");

  const meterPosition = useMemo(() => {
    if (finalA === 0 && finalB === 0) return 50;
    const total = finalA + finalB;
    // finalB = what sideA receives; larger finalB → sideA is winning → indicator right (gold side)
    const ratio = finalB / total;
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    return clamped * 100;
  }, [finalA, finalB]);

  const getVerdictLabel = (_pct: number): string => {
    if (diffPct <= 4) return "Dead Even";
    if (diffPct <= 9) return "Slight Edge";
    if (diffPct <= 19) return "Clear Advantage";
    return "Major Overpay";
  };

  const getVerdictStyle = (pct: number): string => {
    if (pct <= 4) return "bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    if (pct <= 9) return "bg-[#d4af37]/10 dark:bg-[#d4af37]/15 text-amber-700 dark:text-[#e8c84a] border-[#d4af37]/30";
    if (pct <= 19) return "bg-[#0b3a7a]/10 dark:bg-blue-400/15 text-[#0b3a7a] dark:text-blue-300 border-[#0b3a7a]/20 dark:border-blue-400/30";
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

  const [rosterOpenA, setRosterOpenA] = useState(false);
  const [rosterOpenB, setRosterOpenB] = useState(false);

  const RosterCollapsible = ({ rosterTeam, rosterPlayers, addedPlayerIds, side, addPlayer, getPlayerValue }: {
    rosterTeam: Team;
    rosterPlayers: Player[];
    addedPlayerIds: Set<string>;
    side: "a" | "b";
    addPlayer: (side: "a" | "b", p: Player) => void;
    getPlayerValue: (p: Player) => number;
  }) => {
    const isOpen = side === "a" ? rosterOpenA : rosterOpenB;
    const setOpen = side === "a" ? setRosterOpenA : setRosterOpenB;

    return (
      <div className="mt-3 pt-3 border-t border-border/30">
        <button
          className="flex items-center gap-1.5 w-full text-left group"
          onClick={() => setOpen(!isOpen)}
          data-testid={`button-toggle-roster-${side}`}
        >
          <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
            {rosterTeam.owner || rosterTeam.name}'s Roster
          </p>
        </button>
        {isOpen && (
          <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto mt-2">
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
                    <p className="text-[9px] text-muted-foreground/50 text-center py-2">None</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSide = (side: "a" | "b", assets: TradeAsset[], rawTotal: number) => {
    const sideLabel = side === "a" ? "A" : "B";
    const rosterTeam = side === "a" ? sideATeam : sideBTeam;
    const rosterPlayers = side === "a" ? sideAPlayers : sideBPlayers;
    const addedPlayerIds = new Set(assets.filter((a) => a.type === "player" && a.player).map((a) => a.player!.sleeperId || a.player!.id));

    return (
      <Card className="p-5 flex-1">
        <div className="mb-4">
          <div className="flex items-center gap-2.5" data-testid={`text-side-${side}-header`}>
            {rosterTeam ? (
              <img
                src={rosterTeam.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                alt={rosterTeam.owner || rosterTeam.name}
                className="w-8 h-8 rounded-full object-cover border border-border/40 flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                data-testid={`img-side-${side}-avatar`}
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-muted/40 border border-border/40 flex items-center justify-center flex-shrink-0">
                <Scale className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <h3 className="text-sm font-bold">
              {rosterTeam ? `${rosterTeam.owner || rosterTeam.name} Sends...` : `Side ${sideLabel} Sends...`}
            </h3>
            {side === "b" && (
              <Select value={tradePartnerId || "none"} onValueChange={(v) => handleTradePartnerChange(v === "none" ? "" : v)}>
                <SelectTrigger className="ml-auto h-7 text-xs px-2 w-36" data-testid="select-trade-partner">
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
            <RosterCollapsible
              rosterTeam={rosterTeam}
              rosterPlayers={rosterPlayers}
              addedPlayerIds={addedPlayerIds}
              side={side}
              addPlayer={addPlayer}
              getPlayerValue={getPlayerValue}
            />
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Trade Calculator" subtitle="Evaluate trades with dynasty values and diminishing returns" />

      <div className="flex justify-end">
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

          <div className="space-y-6">

            {/* 1. VERDICT FRONT AND CENTER */}
            <div className="text-center space-y-2 py-1">
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground uppercase leading-tight" data-testid="text-verdict-headline">
                {diffPct <= 4 ? "Dead Even Trade" : `${winnerLabel} wins the trade`}
              </p>
              {diff > 0 && (
                <p className="text-sm font-bold text-[#d4af37]" data-testid="text-verdict-diff">
                  +{Math.round(diff).toLocaleString()} Trade Value
                </p>
              )}
              <div className="flex justify-center pt-1">
                <Badge className={`text-xs px-4 py-1.5 font-bold border ${getVerdictStyle(diffPct)}`} data-testid="badge-verdict">
                  {getVerdictLabel(diffPct)}
                </Badge>
              </div>
            </div>

            {/* 2. ADVANTAGE METER */}
            <div className="space-y-1.5 px-1">
              <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <span>{sideBTeam?.owner || "Side B"}</span>
                <span>{sideATeam?.owner || "Side A"}</span>
              </div>
              <div className="relative h-4 rounded-full overflow-hidden">
                <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #12284a 0%, #1a3560 50%, #12284a 100%)" }} />
                {diffPct > 4 && winnerSide === "B" && (
                  <div className="absolute inset-y-0 left-0 rounded-l-full transition-all duration-700" style={{ width: `${100 - meterPosition}%`, background: "linear-gradient(90deg, #0b3a7a 0%, #1a5aad 100%)" }} />
                )}
                {diffPct > 4 && winnerSide === "A" && (
                  <div className="absolute inset-y-0 right-0 rounded-r-full transition-all duration-700" style={{ width: `${meterPosition}%`, background: "linear-gradient(90deg, #b8932a 0%, #d4af37 100%)" }} />
                )}
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/20 z-10" style={{ left: "50%" }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-lg z-20 transition-all duration-700"
                  style={{ left: `clamp(10px, ${meterPosition}% - 10px, calc(100% - 10px))`, background: "linear-gradient(135deg, #0b3a7a 0%, #d4af37 100%)" }}
                  data-testid="meter-indicator"
                />
              </div>
              <div className="flex justify-center">
                <span className="text-[9px] text-muted-foreground/50 font-medium">Fair</span>
              </div>
            </div>

            {/* 3. PLAYER STACKS */}
            {(() => {
              const playersA = sideA.filter(a => a.type === "player" && a.player?.sleeperId);
              const playersB = sideB.filter(a => a.type === "player" && a.player?.sleeperId);
              const picksA = sideA.filter(a => a.type === "pick").length;
              const picksB = sideB.filter(a => a.type === "pick").length;
              const maxCount = Math.max(playersA.length + (picksA > 0 ? 1 : 0), playersB.length + (picksB > 0 ? 1 : 0));
              const compact = maxCount > 4;
              const imgSize = compact ? "w-9 h-9 sm:w-11 sm:h-11" : "w-11 h-11 sm:w-14 sm:h-14";
              const overlap = compact ? "-space-x-2.5" : "-space-x-3";
              const posBorder: Record<string, string> = {
                QB: "border-red-500",
                RB: "border-emerald-500",
                WR: "border-blue-500",
                TE: "border-yellow-500",
              };
              const renderStack = (players: typeof playersA, picks: number, team: typeof sideATeam, fallback: string) => (
                <div className="flex flex-col items-center gap-2">
                  <div className={`flex items-center ${overlap} flex-wrap justify-center`}>
                    {players.map((a, i) => (
                      <div
                        key={a.id}
                        className={`relative ${imgSize} rounded-full border-2 ${posBorder[a.player?.pos || ""] || "border-muted-foreground"} bg-muted/30 shadow-md`}
                        style={{ zIndex: 20 - i }}
                      >
                        <div className="w-full h-full rounded-full overflow-hidden">
                          <img
                            src={`https://sleepercdn.com/content/nfl/players/${a.player!.sleeperId}.jpg`}
                            alt={a.label}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                        {a.player?.team && a.player.team !== "FA" && (
                          <img
                            src={`https://sleepercdn.com/images/team_logos/nfl/${a.player.team.toLowerCase()}.jpg`}
                            alt={a.player.team}
                            className="absolute bottom-0 right-0 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border border-background bg-background object-contain shadow-sm"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                      </div>
                    ))}
                    {picks > 0 && (
                      <div className={`relative ${imgSize} rounded-full border-2 border-[#d4af37]/60 bg-[#0b3a7a]/10 dark:bg-[#d4af37]/10 shadow-md flex items-center justify-center`} style={{ zIndex: 5 }}>
                        <span className="text-[9px] sm:text-[10px] font-bold text-[#d4af37]">{picks} PK</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-muted-foreground truncate max-w-[120px]">{team?.owner || fallback}</p>
                </div>
              );
              return (
                <div className="flex items-center justify-around gap-4 px-2">
                  {renderStack(playersA, picksA, sideBTeam, "Side B")}
                  {renderStack(playersB, picksB, sideATeam, "Side A")}
                </div>
              );
            })()}

            {/* 4. VALUE CARDS */}
            <div className="grid grid-cols-2 gap-3 text-center">
              {/* sideA sends → sideBTeam receives finalA */}
              <div className={`p-3 rounded-lg border ${winnerSide === "B" && diffPct > 4 ? "bg-[#d4af37]/10 border-[#d4af37]/40" : "bg-muted/20 dark:bg-muted/10 border-border/20"}`}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{sideBTeam?.owner || "Side B"} receives</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-analysis-final-a">{Math.round(finalA).toLocaleString()}</p>
                {valueAdjustment && rawA !== finalA && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">raw {rawA.toLocaleString()}</p>
                )}
              </div>
              {/* sideB sends → sideATeam receives finalB */}
              <div className={`p-3 rounded-lg border ${winnerSide === "A" && diffPct > 4 ? "bg-[#d4af37]/10 border-[#d4af37]/40" : "bg-muted/20 dark:bg-muted/10 border-border/20"}`}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{sideATeam?.owner || "Side A"} receives</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-analysis-final-b">{Math.round(finalB).toLocaleString()}</p>
                {valueAdjustment && rawB !== finalB && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">raw {rawB.toLocaleString()}</p>
                )}
              </div>
            </div>

            {diff > 0 && (
              <p className="text-center text-xs text-muted-foreground" data-testid="text-analysis-diff">
                Trade Difference: <span className="font-bold text-foreground">+{Math.round(diff).toLocaleString()}</span>
                <span className="ml-1 opacity-60">({diffPct.toFixed(1)}%)</span>
              </p>
            )}

            {/* 5. HUMAN LANGUAGE */}
            {diffPct > 12 && (
              <p className="text-xs text-center text-muted-foreground" data-testid="text-counter-suggestion">
                {diffPct > 25
                  ? `${loserSide === "A" ? (sideATeam?.owner || "Side A") : (sideBTeam?.owner || "Side B")} would need significantly more value to even this out`
                  : `${loserSide === "A" ? (sideATeam?.owner || "Side A") : (sideBTeam?.owner || "Side B")} is getting the short end of this deal`}
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
          <p className="text-xs text-muted-foreground mb-4">See the data from 2017: explore historical rookie hit rates by round and position.</p>
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

const TRADE_DB_LIMIT = 50;

export function TradeDatabase({ league }: { league: League }) {
  const { valuesBySleeperId, dynastyPlayerList } = useValueModel();

  const [stats, setStats] = useState<{ totalTrades: number; totalLeagues: number } | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [format, setFormat] = useState("all");
  const [scoring, setScoring] = useState("all");
  const [teamSize, setTeamSize] = useState("all");
  const [tradeResults, setTradeResults] = useState<TradeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const playerSuggestions = useMemo(() => {
    if (!query.trim() || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return dynastyPlayerList
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, dynastyPlayerList]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    fetch(`${API_BASE}/api/trades/stats`)
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsSearching(true);
    setPage(1);

    const params = new URLSearchParams({ page: "1", limit: String(TRADE_DB_LIMIT) });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (format !== "all") params.set("format", format);
    if (scoring !== "all") params.set("scoring", scoring);
    if (teamSize !== "all") params.set("leagueSize", teamSize);

    fetch(`${API_BASE}/api/trades/search?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTradeResults(data.trades || []);
        setTotal(data.total || 0);
        setIsSearching(false);
      })
      .catch(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery, format, scoring, teamSize]);

  const loadMore = useCallback(() => {
    const nextPage = page + 1;
    setIsLoadingMore(true);

    const params = new URLSearchParams({ page: String(nextPage), limit: String(TRADE_DB_LIMIT) });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (format !== "all") params.set("format", format);
    if (scoring !== "all") params.set("scoring", scoring);
    if (teamSize !== "all") params.set("leagueSize", teamSize);

    fetch(`${API_BASE}/api/trades/search?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setTradeResults((prev) => [...prev, ...(data.trades || [])]);
        setTotal(data.total || 0);
        setPage(nextPage);
        setIsLoadingMore(false);
      })
      .catch(() => setIsLoadingMore(false));
  }, [page, debouncedQuery, format, scoring, teamSize]);

  const formatDate = useCallback((ts: number) => {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const getPlayerValueById = useCallback(
    (sleeperId: string) => valuesBySleeperId[sleeperId] || 0,
    [valuesBySleeperId]
  );

  const hasMore = tradeResults.length < total;
  const isEmpty = !isSearching && tradeResults.length === 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Trade Database"
        subtitle="Real dynasty trades contributed by the StatChasers community"
      />

      <div className="flex items-start gap-3 p-3 rounded-lg bg-[#0b3a7a]/5 dark:bg-blue-400/5 border border-[#0b3a7a]/10 dark:border-blue-400/10" data-testid="trade-db-stats-banner">
        <Database className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 mt-0.5" />
        {stats ? (
          <p className="text-sm leading-snug">
            <span className="font-bold text-foreground" data-testid="text-total-trades">{stats.totalTrades.toLocaleString()}</span>
            <span className="text-muted-foreground"> trades indexed from </span>
            <span className="font-bold text-foreground" data-testid="text-total-leagues">{stats.totalLeagues.toLocaleString()}</span>
            <span className="text-muted-foreground"> leagues, grows automatically as users analyze their leagues</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading database stats...</p>
        )}
      </div>

      <div className="space-y-3">
        <div className="relative" ref={searchContainerRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            className="pl-9 pr-9"
            placeholder="Search by player name..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true); }}
            onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
            data-testid="input-trade-search"
          />
          {query && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
              onClick={() => { setQuery(""); setShowSuggestions(false); }}
              data-testid="button-clear-search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {showSuggestions && playerSuggestions.length > 0 && (
            <div
              className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-background shadow-lg overflow-hidden"
              data-testid="player-suggestions-dropdown"
            >
              {playerSuggestions.map((p, i) => (
                <button
                  key={p.sleeperId}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left border-b border-border/30 last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setQuery(p.name);
                    setShowSuggestions(false);
                  }}
                  data-testid={`suggestion-player-${i}`}
                >
                  <PlayerAvatar
                    id={p.sleeperId}
                    name={p.name}
                    pos={p.pos}
                    team={p.team ?? ""}
                    size="sm"
                    sub={p.value.toLocaleString()}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["all", "SF", "1QB"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  format === f
                    ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
                )}
                data-testid={`button-format-${f}`}
              >
                {f === "all" ? "All Formats" : f}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[#d4af37]/50 flex-shrink-0" />

          <div className="flex gap-1">
            {(["all", "PPR", "Half", "Standard"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScoring(s)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  scoring === s
                    ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
                )}
                data-testid={`button-scoring-${s}`}
              >
                {s === "all" ? "All Scoring" : s}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[#d4af37]/50 flex-shrink-0" />

          <div className="flex gap-1">
            {(["all", "10", "12", "14"] as const).map((size) => (
              <button
                key={size}
                onClick={() => setTeamSize(size)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  teamSize === size
                    ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
                )}
                data-testid={`button-teamsize-${size}`}
              >
                {size === "all" ? "All Sizes" : `${size}-team`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isSearching && total > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-results-count">
          Showing {tradeResults.length.toLocaleString()} of {total.toLocaleString()} trades
        </p>
      )}

      {isSearching && tradeResults.length === 0 ? (
        <div className="flex items-center justify-center py-16" data-testid="trade-db-loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="trade-db-empty">
          <Database className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No trades found</p>
          <p className="text-xs text-muted-foreground mb-4">
            {debouncedQuery || format !== "all" || scoring !== "all" || teamSize !== "all"
              ? "Try adjusting your search or filters"
              : "The database grows as users analyze their leagues"}
          </p>
          {stats?.totalTrades === 0 && (
            <div className="mt-2 p-4 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 max-w-xs">
              <p className="text-xs font-semibold text-foreground mb-1">Database is warming up</p>
              <p className="text-xs text-muted-foreground">
                Trades populate automatically each time a user analyzes a league. Check back soon!
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4" data-testid="trade-db-results">
          {tradeResults.map((trade) => (
            <TradeCard
              key={trade.tradeId}
              trade={trade}
              getPlayerValue={getPlayerValueById}
              formatDate={formatDate}
            />
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
                data-testid="button-load-more-trades"
              >
                {isLoadingMore && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Load More
              </Button>
            </div>
          )}
        </div>
      )}
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
      if (p.round > 5) return sum;
      return sum + getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid", p.slot, trade.leagueTotalRosters);
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
                  <p className="text-sm font-semibold" data-testid={`text-team-name-${side.rosterId}`}>
                    {side.teamName || `Side ${String.fromCharCode(65 + idx)}`}
                  </p>
                  {side.ownerName ? (
                    <p className="text-[10px] text-muted-foreground">{side.ownerName} receives:</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">receives:</p>
                  )}
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
                        {p.sleeperId && (
                          <PlayerAvatar id={p.sleeperId} name={p.name} pos={p.pos} team={p.team ?? ""} size="xs" compact />
                        )}
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
                  // Use stored draftType when available; fall back to round > 5 for legacy picks
                  const isStartup = p.draftType === "startup" || (!p.draftType && p.round > 5);
                  // Exact slot confidence: only show slot-level label when slot is known
                  const exactSlot = !isStartup && p.slot != null && p.slot > 0;
                  const slotStr = exactSlot
                    ? `${p.round}.${String(p.slot).padStart(2, "0")}`
                    : null;
                  const val = isStartup ? 0 : getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid", p.slot, trade.leagueTotalRosters);
                  const ord = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
                  // Label rules per spec:
                  //   exact slot known  → "2026 Rookie 1.03"
                  //   startup pick      → "2026 Startup 1st"
                  //   fallback (no slot)→ "2026 1st"
                  const pickLabel = isStartup
                    ? `${p.season} Startup ${ord(p.round)}`
                    : slotStr
                      ? `${p.season} Rookie ${slotStr}`
                      : `${p.season} ${ord(p.round)}`;
                  return (
                    <div key={`pick-${pi}`} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] w-7 justify-center ${isStartup ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-300 dark:border-amber-700" : "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400"}`}>
                          {isStartup ? "SP" : "PK"}
                        </Badge>
                        <span className="text-xs font-medium">
                          {pickLabel}
                        </span>
                        {p.originalOwnerName && (
                          <span className="text-[10px] text-muted-foreground">({p.originalOwnerName}'s)</span>
                        )}
                      </div>
                      {!isStartup && val > 0 && <span className="text-[10px] text-muted-foreground">{val.toLocaleString()}</span>}
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
