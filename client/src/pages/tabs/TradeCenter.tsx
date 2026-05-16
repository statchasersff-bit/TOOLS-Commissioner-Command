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
import { useToast } from "@/hooks/use-toast";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getPositionColor, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { getStaticPickValue } from "@/data/pickValues";
import { API_BASE } from "@/lib/apiBase";
import { fetchRosterDraftPicks, fetchLeaguePlayerSettings } from "@/lib/sleeperApi";
import { getSleeperToken, getSleeperSession } from "@/services/sleeperAuth";
import { proposeTrade as proposeTradeAuthed, rejectTrade, getDmByMembersFull, sendTradeMessage, sendPlainDm, type ProposeTradeResult } from "@/services/sleeperAuthedApi";
import type { League, Team, Tier, Player, Pick, TradeRecord, TradeSide, CrawlStatus } from "@/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { TradeBlockCandidates } from "@/components/trade/TradeBlockCandidates";
import { ArrowRightLeft, TrendingUp, TrendingDown, Target, X, Plus, Search, Scale, RotateCcw, Database, Play, Pause, Loader2, ChevronLeft, ChevronRight, ChevronDown, Download, Tag, Clock, ArrowRight, Send, CheckCircle2, DollarSign, Undo2 } from "lucide-react";

const SLEEPER_JWT_KEY = "dc-sleeper-draft-jwt";
const SLEEPER_API_BASE = "https://api.sleeper.app/v1";

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never"        },
  { value: "1h",    label: "1 Hour"       },
  { value: "today", label: "End of Today" },
  { value: "24h",   label: "24 Hours"     },
  { value: "2d",    label: "2 Days"       },
  { value: "1w",    label: "1 Week"       },
  { value: "2w",    label: "2 Weeks"      },
] as const;

function computeExpiresAt(option: string): number | null {
  const now = Math.floor(Date.now() / 1000);
  switch (option) {
    case "never": return null;
    case "1h":    return now + 3600;
    case "today": { const end = new Date(); end.setHours(23, 59, 59, 999); return Math.floor(end.getTime() / 1000); }
    case "24h":   return now + 86400;
    case "2d":    return now + 172800;
    case "1w":    return now + 604800;
    case "2w":    return now + 1209600;
    default:      return now + 86400;
  }
}

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

function TradeProposalCard({ proposal, mode, userTeam }: { proposal: TradeProposal; mode: "dynasty" | "redraft"; userTeam: Team }) {
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
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">{userTeam.owner} sends</p>
          {proposal.gives.map((p, i) => <PlayerChip key={i} player={p} value={proposal.giveVal / proposal.gives.length} />)}
        </div>
        <div className="flex items-center justify-center pt-4">
          <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground/60" />
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">{proposal.partner.owner} sends</p>
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

  const optimalRosterMap = useMemo(() => {
    const rp = league.rosterPositions || [];
    const m = new Map<string, ReturnType<typeof optimizeLineup>>();
    league.teams.forEach(t => m.set(t.id, optimizeLineup(t.roster, rp)));
    return m;
  }, [league.teams, league.rosterPositions, optimizeLineup]);

  const positions = ["QB", "RB", "WR", "TE"] as const;

  const positionalProfile = useMemo(() => {
    const leagueSize = league.teams.length;
    const topThird = Math.ceil(leagueSize / 3);
    const bottomThird = leagueSize - topThird;

    const dynTotals = new Map<string, Record<string, number>>();
    const rdTotals  = new Map<string, Record<string, number>>();
    league.teams.forEach(t => {
      const d: Record<string, number> = {};
      const r: Record<string, number> = {};
      const optRoster = optimalRosterMap.get(t.id) || t.roster;
      positions.forEach(pos => {
        d[pos] = t.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getPlayerValue(p), 0);
        r[pos] = optRoster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
      });
      dynTotals.set(t.id, d);
      rdTotals.set(t.id, r);
    });

    const dynRanks: Record<string, number> = {};
    const rdRanks:  Record<string, number> = {};
    positions.forEach(pos => {
      [...league.teams]
        .sort((a, b) => (dynTotals.get(b.id)?.[pos] ?? 0) - (dynTotals.get(a.id)?.[pos] ?? 0))
        .forEach((t, i) => { if (t.id === userTeam.id) dynRanks[pos] = i + 1; });
      [...league.teams]
        .sort((a, b) => (rdTotals.get(b.id)?.[pos] ?? 0) - (rdTotals.get(a.id)?.[pos] ?? 0))
        .forEach((t, i) => { if (t.id === userTeam.id) rdRanks[pos] = i + 1; });
    });

    const tier = (rank: number) =>
      rank <= topThird ? "top" : rank > bottomThird ? "bottom" : "mid";

    return { dynRanks, rdRanks, leagueSize, tier };
  }, [league, userTeam, getPlayerValue, getRedraftValue, optimalRosterMap]);

  const { userNeeds, userSurplus, partnerNeedsMap, partnerSurplusMap } = useMemo(() => {
    const getValue = (p: Player) => proposalMode === "dynasty" ? getPlayerValue(p) : getRedraftValue(p);
    const leagueSize = league.teams.length;
    const topThird = Math.ceil(leagueSize / 3);
    const bottomThird = leagueSize - topThird;

    // Positional STARTER value for every team.
    // Redraft mode: use greedy-optimal lineup (same algorithm as buildOptimalLineupValues).
    // Dynasty mode: use Sleeper's actual starter flag.
    const teamPosTotals = new Map<string, Record<string, number>>();
    league.teams.forEach(t => {
      const rosterToUse = proposalMode === "redraft"
        ? (optimalRosterMap.get(t.id) || t.roster)
        : t.roster;
      const totals: Record<string, number> = {};
      positions.forEach(pos => {
        totals[pos] = rosterToUse
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
    const userOptimalStarterIds = new Set(
      (optimalRosterMap.get(userTeam.id) || userTeam.roster).filter(p => p.starter).map(p => p.id)
    );
    const userSurplus = new Set(positions.filter(pos => {
      if ((userRanks[pos] ?? leagueSize) > topThird) return false; // must be top-33% in league
      // surplus = has at least one quality non-starter (bench depth) at this position
      const qualityBench = userTeam.roster.filter(p =>
        p.pos === pos &&
        (proposalMode === "redraft" ? !userOptimalStarterIds.has(p.id) : !p.starter) &&
        getValue(p) >= MIN_SURPLUS_DEPTH
      ).length;
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
  }, [league, userTeam, getPlayerValue, getRedraftValue, proposalMode, optimalRosterMap]);

  const generatedTrades = useMemo<TradeProposal[]>(() => {
    const getValue = (p: Player) => proposalMode === "dynasty" ? getPlayerValue(p) : getRedraftValue(p);
    const FAIR_THRESHOLD = 0.22;
    const MIN_VALUE = 800;
    const MAX_POOL = 7;
    const MAX_PER_PARTNER = 4;

    // Core starters: in redraft mode, protect the greedy-optimal lineup starters so the
    // algorithm never gives away a lineup-critical player.
    // In dynasty mode we leave this empty — dynasty trades routinely involve starter-for-starter
    // swaps (e.g. ageing WR1 for a young ascending talent), so every player with sufficient
    // dynasty value should be available to offer. Fairness is still enforced by FAIR_THRESHOLD.
    const coreStarters = proposalMode === "redraft"
      ? new Set<string>((optimalRosterMap.get(userTeam.id) || userTeam.roster).filter(p => p.starter).map(p => p.id))
      : new Set<string>();

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
  }, [league, userTeam, getPlayerValue, getRedraftValue, proposalMode, userNeeds, userSurplus, partnerNeedsMap, partnerSurplusMap, optimalRosterMap]);

  const filteredProposals = useMemo(() => {
    if (posFilter === "all") return generatedTrades;
    return generatedTrades.filter(p =>
      p.gets.some(pl => pl.pos === posFilter) || p.gives.some(pl => pl.pos === posFilter)
    );
  }, [generatedTrades, posFilter]);

  const displayedProposals = showAllProposals ? filteredProposals : filteredProposals.slice(0, 12);

  const PER_GROUP = 4;

  const groupedProposals = useMemo(() => {
    const getValue = (p: Player) =>
      proposalMode === "dynasty" ? getPlayerValue(p) : getRedraftValue(p);

    const getUpgradePos = (proposal: TradeProposal): string => {
      if (proposal.gets.length === 0) return "Other";
      return [...proposal.gets].sort((a, b) => getValue(b) - getValue(a))[0].pos;
    };

    const groups = new Map<string, TradeProposal[]>();
    for (const proposal of filteredProposals) {
      const pos = getUpgradePos(proposal);
      if (!groups.has(pos)) groups.set(pos, []);
      groups.get(pos)!.push(proposal);
    }

    const getRank = (pos: string): number => {
      if (!["QB", "RB", "WR", "TE"].includes(pos)) return 0;
      return proposalMode === "dynasty"
        ? (positionalProfile.dynRanks[pos as "QB" | "RB" | "WR" | "TE"] ?? 0)
        : (positionalProfile.rdRanks[pos as "QB" | "RB" | "WR" | "TE"] ?? 0);
    };

    return [...groups.entries()]
      .sort(([posA], [posB]) => getRank(posB) - getRank(posA))
      .map(([pos, proposals]) => ({ pos, proposals, rank: getRank(pos) }));
  }, [filteredProposals, positionalProfile, proposalMode, getPlayerValue, getRedraftValue]);

  const total = league.teams.length;

  const tradeBlockCandidates = useMemo(() => {
    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;
    const totalDynasty = [...league.teams].sort((a, b) =>
      b.roster.reduce((s, p) => s + getPlayerValue(p), 0) - a.roster.reduce((s, p) => s + getPlayerValue(p), 0)
    );
    const totalRedraft = [...league.teams].sort((a, b) => {
      const getOptVal = (t: Team) => (optimalRosterMap.get(t.id) || t.roster)
        .filter(p => p.starter)
        .reduce((s, p) => s + getRedraftValue(p), 0);
      return getOptVal(b) - getOptVal(a);
    });
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
  }, [league, userTeam, getRedraftValue, getPlayerValue, tradeFinderTierMap, total, optimalRosterMap]);

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Finder" subtitle="AI-generated trade proposals based on roster needs, positional value, and fair market rates" />

      {/* My Positional Profile */}
      <Card className="p-6" data-testid="card-positional-profile">
        <div className="mb-5">
          <h3 className="text-base font-bold">My Positional Profile</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">
            Your starter rankings vs. all {positionalProfile.leagueSize} teams — by dynasty and win-now value
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {positions.map(pos => {
            const dynRank = positionalProfile.dynRanks[pos] ?? positionalProfile.leagueSize;
            const rdRank  = positionalProfile.rdRanks[pos]  ?? positionalProfile.leagueSize;
            const dynTier = positionalProfile.tier(dynRank);
            const rdTier  = positionalProfile.tier(rdRank);
            const ordinal = (n: number) =>
              n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
            const rankColor = (t: "top" | "mid" | "bottom") =>
              t === "top"    ? "text-emerald-500 dark:text-emerald-400"
            : t === "bottom" ? "text-red-500 dark:text-red-400"
            :                  "text-foreground";
            const barPct = (rank: number) =>
              Math.round((1 - (rank - 1) / (positionalProfile.leagueSize - 1)) * 100);
            const barColor = (t: "top" | "mid" | "bottom") =>
              t === "top" ? "bg-emerald-500" : t === "bottom" ? "bg-red-500" : "bg-[#0b3a7a]";
            return (
              <div
                key={pos}
                className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-3"
                data-testid={`pos-profile-${pos.toLowerCase()}`}
              >
                <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{pos}</span>
                {/* Dynasty */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Dynasty</span>
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(dynTier))}>
                      {ordinal(dynRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", barColor(dynTier))}
                      style={{ width: `${barPct(dynRank)}%` }}
                    />
                  </div>
                </div>
                {/* Win-Now */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Win-Now</span>
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(rdTier))}>
                      {ordinal(rdRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", barColor(rdTier))}
                      style={{ width: `${barPct(rdRank)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

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
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6">
              <button
                onClick={() => setProposalMode("dynasty")}
                className={cn("relative px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200", proposalMode === "dynasty" ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/35 hover:text-white/60")}
                data-testid="btn-mode-dynasty"
              >
                Build Dynasty
                {proposalMode === "dynasty" && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-full bg-[#d4af37]" />
                )}
              </button>
              <button
                onClick={() => setProposalMode("redraft")}
                className={cn("relative px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200", proposalMode === "redraft" ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25" : "text-white/35 hover:text-white/60")}
                data-testid="btn-mode-redraft"
              >
                Win-Now
                {proposalMode === "redraft" && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-full bg-[#d4af37]" />
                )}
              </button>
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
        ) : posFilter !== "all" ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displayedProposals.map((proposal, i) => (
                <TradeProposalCard key={i} proposal={proposal} mode={proposalMode} userTeam={userTeam} />
              ))}
            </div>
            {!showAllProposals && filteredProposals.length > 12 && (
              <Button variant="outline" className="w-full mt-4" onClick={() => setShowAllProposals(true)} data-testid="btn-show-more-proposals">
                Show {filteredProposals.length - 12} more proposals
              </Button>
            )}
          </>
        ) : (
          <div className="space-y-7">
            {groupedProposals.map(({ pos, proposals, rank }) => {
              const shown = showAllProposals ? proposals : proposals.slice(0, PER_GROUP);
              const ordinal = (n: number) =>
                n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
              return (
                <div key={pos} data-testid={`proposal-group-${pos.toLowerCase()}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className={cn("text-[10px] font-bold px-1.5", getPositionColor(pos))}>{pos}</Badge>
                    <span className="text-sm font-semibold">{pos} Upgrades</span>
                    {rank > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        — currently {ordinal(rank)}/{positionalProfile.leagueSize} {proposalMode === "dynasty" ? "dynasty" : "win-now"}
                      </span>
                    )}
                    <Badge variant="secondary" className="text-[10px] ml-auto">{proposals.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {shown.map((proposal, i) => (
                      <TradeProposalCard key={i} proposal={proposal} mode={proposalMode} userTeam={userTeam} />
                    ))}
                  </div>
                </div>
              );
            })}
            {(() => {
              const totalShown = groupedProposals.reduce((s, g) => s + Math.min(g.proposals.length, PER_GROUP), 0);
              const remaining = filteredProposals.length - totalShown;
              return !showAllProposals && remaining > 0 ? (
                <Button variant="outline" className="w-full" onClick={() => setShowAllProposals(true)} data-testid="btn-show-more-proposals">
                  Show {remaining} more proposals
                </Button>
              ) : null;
            })()}
          </div>
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
                                    <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3.5 w-6 justify-center flex-shrink-0 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">PK</Badge>
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
                                    <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3.5 w-6 justify-center flex-shrink-0 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">PK</Badge>
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
  const { getPlayerValue } = useValueModel();

  const [sleeperJwt, setSleeperJwt] = useState<string | null>(() => getSleeperToken() ?? localStorage.getItem(SLEEPER_JWT_KEY));
  useEffect(() => {
    const refresh = () => setSleeperJwt(getSleeperToken() ?? localStorage.getItem(SLEEPER_JWT_KEY));
    const onStorage = (e: StorageEvent) => { if (e.key === SLEEPER_JWT_KEY || e.key === "statchasers_sleeper_auth") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sleeper-jwt-changed", refresh);
    window.addEventListener("sleeper-session-changed", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sleeper-jwt-changed", refresh);
      window.removeEventListener("sleeper-session-changed", refresh);
    };
  }, []);

  const [lpsData, setLpsData] = useState<any[]>([]);
  const [lpsLoading, setLpsLoading] = useState(false);
  useEffect(() => {
    if (!sleeperJwt || !league.id) { setLpsData([]); return; }
    setLpsLoading(true);
    fetchLeaguePlayerSettings(league.id, sleeperJwt)
      .then(data => { setLpsData(data); setLpsLoading(false); })
      .catch(() => setLpsLoading(false));
  }, [sleeperJwt, league.id]);

  const playerById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const team of league.teams) for (const p of team.roster) if (p.sleeperId) map.set(p.sleeperId, p);
    return map;
  }, [league.teams]);

  const teamByRosterId = useMemo(() => {
    const map = new Map<number, Team>();
    for (const team of league.teams) {
      const numId = Number(team.id.replace(/^roster_/, ""));
      if (!isNaN(numId)) map.set(numId, team);
    }
    return map;
  }, [league.teams]);

  const actualTradeBlock = useMemo(() => {
    const isPickId = (id: string) => /^\d+,\d{4},\d+$/.test(id);
    return lpsData
      .filter(lp => lp.settings?.otb != null && !isPickId(String(lp.player_id)))
      .map(lp => {
        const sid = String(lp.player_id);
        const player = playerById.get(sid);
        const ownerRosterId = Number(lp.settings.otb);
        const ownerTeam = teamByRosterId.get(ownerRosterId);
        const addedAt = lp.settings.otb_added_at ? Number(lp.settings.otb_added_at) : undefined;
        return {
          id: sid,
          sleeperId: sid,
          name: player?.name || `Player ${sid}`,
          pos: player?.pos || "?",
          age: player?.age ?? 0,
          team: player?.team,
          ownerName: ownerTeam?.owner || ownerTeam?.name || `Roster ${ownerRosterId}`,
          redraftVal: player ? getPlayerValue(player) : 0,
          addedAt,
        };
      })
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  }, [lpsData, playerById, teamByRosterId, getPlayerValue]);

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Intel" subtitle="Identify likely sellers and buyers in your league" />

      <TradeBlockCandidates
        candidates={actualTradeBlock}
        mode="actualTradeBlock"
        title="On Trade Block"
        isLoading={lpsLoading}
        noJwt={!sleeperJwt}
      />

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
  pickOriginalRosterId?: number;
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
  const { user } = useSleeper();
  const { toast } = useToast();
  const [sideA, setSideA] = useState<TradeAsset[]>([]);
  const [sideB, setSideB] = useState<TradeAsset[]>([]);
  const valueAdjustment = true;
  const overpayTax = true;
  const [tradePartnerId, setTradePartnerId] = useState<string>("");
  const [sideARosterId, setSideARosterId] = useState<string>(userTeam.id);
  const [sideBRosterId, setSideBRosterId] = useState<string>("");
  const [savingPng, setSavingPng] = useState(false);

  // JWT — prefer the full Sleeper session token, fall back to manual Live Draft key
  const [sleeperJwt, setSleeperJwt] = useState<string | null>(() => getSleeperToken() ?? localStorage.getItem(SLEEPER_JWT_KEY));
  const [jwtInput, setJwtInput] = useState("");
  const handleSaveJwt = () => {
    const val = jwtInput.trim();
    if (!val) return;
    localStorage.setItem(SLEEPER_JWT_KEY, val);
    setSleeperJwt(val);
    setJwtInput("");
    window.dispatchEvent(new CustomEvent("sleeper-jwt-changed", { detail: val }));
  };
  const handleClearJwt = () => {
    localStorage.removeItem(SLEEPER_JWT_KEY);
    setSleeperJwt(getSleeperToken());
    window.dispatchEvent(new CustomEvent("sleeper-jwt-changed", { detail: null }));
  };
  useEffect(() => {
    const refresh = () => setSleeperJwt(getSleeperToken() ?? localStorage.getItem(SLEEPER_JWT_KEY));
    const onStorage = (e: StorageEvent) => { if (e.key === SLEEPER_JWT_KEY || e.key === "statchasers_sleeper_auth") refresh(); };
    const onJwtChanged = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("sleeper-jwt-changed", onJwtChanged);
    window.addEventListener("sleeper-session-changed", onJwtChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sleeper-jwt-changed", onJwtChanged);
      window.removeEventListener("sleeper-session-changed", onJwtChanged);
    };
  }, []);

  // Live roster draft picks from Sleeper GraphQL
  type LivePick = { roster_id: number; owner_id: number; season: string; round: number };
  const [rosterPicks, setRosterPicks] = useState<LivePick[]>([]);
  useEffect(() => {
    if (!sleeperJwt || !league.id) { setRosterPicks([]); return; }
    fetchRosterDraftPicks(league.id, sleeperJwt)
      .then(setRosterPicks)
      .catch(() => setRosterPicks([]));
  }, [sleeperJwt, league.id]);

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

  const playerToTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of league.teams) {
      for (const p of team.roster) {
        map.set(p.sleeperId || p.id, team.id);
      }
    }
    return map;
  }, [league]);

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

  const addPick = useCallback((side: "a" | "b", year: number, round: number, range: "Early" | "Mid" | "Late", originalRosterId?: number) => {
    const setter = side === "a" ? setSideA : setSideB;
    const rangeKey = range.toLowerCase() as "early" | "mid" | "late";
    const val = getStaticPickValue(year, round, rangeKey);
    const asset: TradeAsset = {
      id: `pick-${year}-${round}-${range}-${originalRosterId ?? ""}-${Date.now()}`,
      type: "pick",
      pickYear: year,
      pickRound: round,
      pickRange: range,
      pickOriginalRosterId: originalRosterId,
      value: val,
      label: `${year} ${range} ${round}${round === 1 ? "st" : round === 2 ? "nd" : round === 3 ? "rd" : "th"}`,
    };
    setter((prev) => [...prev, asset]);
  }, []);

  const sideATeam = useMemo(() => league.teams.find((t) => t.id === sideARosterId), [league, sideARosterId]);
  const sideBTeam = useMemo(() => league.teams.find((t) => t.id === sideBRosterId), [league, sideBRosterId]);

  const sideAPlayers = useMemo(() => sideATeam?.roster || [], [sideATeam]);
  const sideBPlayers = useMemo(() => sideBTeam?.roster || [], [sideBTeam]);

  const handleTradePartnerChange = useCallback((teamId: string) => {
    setTradePartnerId(teamId);
    setSideBRosterId(teamId);
    setSideB([]);
  }, []);

  const handleSideATeamChange = useCallback((teamId: string) => {
    setSideARosterId(teamId);
    setSideA([]);
  }, []);

  // Prefill from Trade Block "Add to Trade Calc" — on mount (localStorage) and live (CustomEvent)
  useEffect(() => {
    const raw = localStorage.getItem("tc-prefill");
    if (!raw) return;
    localStorage.removeItem("tc-prefill");
    try {
      const asset = JSON.parse(raw);
      if (asset.type === "player" && asset.sleeperId) {
        const player = allPlayers.find(p => (p.sleeperId || p.id) === asset.sleeperId);
        if (player) addPlayer("a", player);
      } else if (asset.type === "pick" && asset.year && asset.round) {
        addPick("a", asset.year, asset.round, "Mid", asset.originalRosterId);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const asset = (e as CustomEvent).detail;
      if (!asset) return;
      if (asset.type === "player" && asset.sleeperId) {
        const player = allPlayers.find(p => (p.sleeperId || p.id) === asset.sleeperId);
        if (player) addPlayer("a", player);
      } else if (asset.type === "pick" && asset.year && asset.round) {
        addPick("a", asset.year, asset.round, "Mid", asset.originalRosterId);
      }
    };
    window.addEventListener("tc-prefill", handler);
    return () => window.removeEventListener("tc-prefill", handler);
  }, [allPlayers, addPlayer, addPick]);

  // Propose trade state
  const [expiry, setExpiry] = useState("24h");
  const [faabOpen, setFaabOpen] = useState(false);
  const [faabASends, setFaabASends] = useState("");
  const [faabBSends, setFaabBSends] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposedTrade, setProposedTrade] = useState<ProposeTradeResult | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [dmStatus, setDmStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [dmError, setDmError] = useState<string | null>(null);

  const handleProposeTrade = async () => {
    if (!sideBRosterId) return;
    const aRosterId = parseInt(sideARosterId);
    const bRosterId = parseInt(sideBRosterId);

    const adds: Record<string, number> = {};
    const drops: Record<string, number> = {};
    const draftPicks: Array<{ season: string; round: number; roster_id: number; owner_id: number; previous_owner_id: number }> = [];

    for (const asset of sideA) {
      if (asset.type === "player" && asset.player?.sleeperId) {
        adds[asset.player.sleeperId] = bRosterId;
        drops[asset.player.sleeperId] = aRosterId;
      } else if (asset.type === "pick" && asset.pickYear && asset.pickRound) {
        draftPicks.push({ season: String(asset.pickYear), round: asset.pickRound, roster_id: asset.pickOriginalRosterId ?? aRosterId, owner_id: aRosterId, previous_owner_id: aRosterId });
      }
    }
    for (const asset of sideB) {
      if (asset.type === "player" && asset.player?.sleeperId) {
        adds[asset.player.sleeperId] = aRosterId;
        drops[asset.player.sleeperId] = bRosterId;
      } else if (asset.type === "pick" && asset.pickYear && asset.pickRound) {
        draftPicks.push({ season: String(asset.pickYear), round: asset.pickRound, roster_id: asset.pickOriginalRosterId ?? bRosterId, owner_id: bRosterId, previous_owner_id: bRosterId });
      }
    }

    const waiverBudget: Array<{ sender: number; receiver: number; amount: number }> = [];
    const aAmt = parseInt(faabASends) || 0;
    const bAmt = parseInt(faabBSends) || 0;
    if (aAmt > 0) waiverBudget.push({ sender: aRosterId, receiver: bRosterId, amount: aAmt });
    if (bAmt > 0) waiverBudget.push({ sender: bRosterId, receiver: aRosterId, amount: bAmt });

    const expiresAt = computeExpiresAt(expiry);

    setProposing(true);
    setProposeError(null);
    setProposedTrade(null);
    setDmStatus("idle");
    setDmError(null);
    try {
      const result = await proposeTradeAuthed({ leagueId: league.id, adds, drops, draftPicks, expiresAt, waiverBudget });
      setProposedTrade(result);
      toast({ title: "Trade sent!" });
      const optimisticTrade = {
        transactionId: result.transaction_id,
        leg: result.leg ?? 1,
        status: "pending",
        creator: result.creator ?? (user?.userId ?? ""),
        consenterIds: result.consenter_ids ?? [],
        waiverBudget: (result.waiver_budget ?? []).map((wb: any) => ({ senderId: wb.sender, receiverId: wb.receiver, amount: wb.amount })),
        week: 0,
        created: result.created ?? Date.now(),
        adds: [
          ...sideA.filter(a => a.type === "player" && a.player?.sleeperId).map(a => ({ playerId: a.player!.sleeperId!, name: a.player!.name, pos: a.player!.pos || "?", team: a.player!.team || "", rosterId: bRosterId, teamName: sideBTeam?.owner || sideBTeam?.name || "Side B" })),
          ...sideB.filter(a => a.type === "player" && a.player?.sleeperId).map(a => ({ playerId: a.player!.sleeperId!, name: a.player!.name, pos: a.player!.pos || "?", team: a.player!.team || "", rosterId: aRosterId, teamName: sideATeam?.owner || sideATeam?.name || "Side A" })),
        ],
        drops: [
          ...sideA.filter(a => a.type === "player" && a.player?.sleeperId).map(a => ({ playerId: a.player!.sleeperId!, name: a.player!.name, pos: a.player!.pos || "?", team: a.player!.team || "", rosterId: aRosterId, teamName: sideATeam?.owner || sideATeam?.name || "Side A" })),
          ...sideB.filter(a => a.type === "player" && a.player?.sleeperId).map(a => ({ playerId: a.player!.sleeperId!, name: a.player!.name, pos: a.player!.pos || "?", team: a.player!.team || "", rosterId: bRosterId, teamName: sideBTeam?.owner || sideBTeam?.name || "Side B" })),
        ],
        draftPicks: [
          ...sideA.filter(a => a.type === "pick" && a.pickYear && a.pickRound).map(a => ({ season: String(a.pickYear), round: a.pickRound!, fromTeam: sideATeam?.owner || sideATeam?.name || "Side A", toTeam: sideBTeam?.owner || sideBTeam?.name || "Side B", originalRosterId: a.pickOriginalRosterId })),
          ...sideB.filter(a => a.type === "pick" && a.pickYear && a.pickRound).map(a => ({ season: String(a.pickYear), round: a.pickRound!, fromTeam: sideBTeam?.owner || sideBTeam?.name || "Side B", toTeam: sideATeam?.owner || sideATeam?.name || "Side A", originalRosterId: a.pickOriginalRosterId })),
        ],
        involvedTeams: [
          { rosterId: aRosterId, teamName: sideATeam?.owner || sideATeam?.name || "Side A", avatar: (sideATeam as any)?.avatar ?? null },
          ...(sideBRosterId ? [{ rosterId: bRosterId, teamName: sideBTeam?.owner || sideBTeam?.name || "Side B", avatar: (sideBTeam as any)?.avatar ?? null }] : []),
        ],
      };
      window.dispatchEvent(new CustomEvent("sleeper-txn-created", { detail: optimisticTrade }));
      window.dispatchEvent(new CustomEvent("sleeper-txn-refresh"));
      const partnerUserId = sideBTeam?.ownerId;
      if (partnerUserId) sendCalcTradeDm(result, partnerUserId);
    } catch (e: any) {
      setProposeError(e.message || "Failed to propose trade");
    } finally {
      setProposing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!proposedTrade) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await rejectTrade(league.id, proposedTrade.transaction_id, proposedTrade.leg ?? 1);
      setProposedTrade(null);
      setDmStatus("idle");
      window.dispatchEvent(new CustomEvent("sleeper-txn-refresh"));
      toast({ title: "Trade withdrawn." });
    } catch (e: any) {
      setWithdrawError(e.message || "Failed to withdraw trade");
    } finally {
      setWithdrawing(false);
    }
  };

  const sendCalcTradeDm = async (trade: ProposeTradeResult, partnerUserId: string) => {
    setDmStatus("sending");
    setDmError(null);
    try {
      const usersRaw: any[] = await fetch(`https://api.sleeper.app/v1/league/${trade.league_id}/users`).then(r => r.json());
      const usersInLeagueMap: Record<string, unknown> = {};
      const userIdToInfo = new Map<string, any>();
      for (const u of usersRaw) {
        const info = { avatar: u.avatar ?? null, display_name: u.display_name || u.username || u.user_id, is_bot: false, is_owner: false, league_id: trade.league_id, metadata: u.metadata || {}, settings: u.settings || {}, user_id: u.user_id };
        usersInLeagueMap[u.user_id] = info;
        userIdToInfo.set(u.user_id, info);
      }
      const rosterUserMap = new Map<number, unknown>();
      for (const team of league.teams) {
        const rid = parseInt(team.id.replace("roster_", ""), 10);
        if (team.ownerId && userIdToInfo.has(team.ownerId)) rosterUserMap.set(rid, userIdToInfo.get(team.ownerId));
      }
      const transactionsByRoster: Record<string, unknown> = {};
      for (const rosterId of (trade.roster_ids || [])) {
        const rosterAdds: unknown[] = [];
        if (trade.adds) {
          for (const [pid, receivingRid] of Object.entries(trade.adds)) {
            if (receivingRid === rosterId) {
              const playerObj = (trade.player_map as Record<string, unknown>)?.[pid] || { player_id: pid };
              rosterAdds.push(playerObj);
            }
          }
        }
        const rosterPicks: unknown[] = [];
        if (Array.isArray(trade.draft_picks)) {
          for (const pick of trade.draft_picks) {
            if (typeof pick === "string") {
              const parts = pick.split(",");
              if (Number(parts[3]) === rosterId) rosterPicks.push({ roster_id: Number(parts[0]), season: parts[1], round: Number(parts[2]) });
            } else if (pick && typeof pick === "object" && (pick as any).owner_id === rosterId) {
              rosterPicks.push(pick);
            }
          }
        }
        transactionsByRoster[String(rosterId)] = { adds: rosterAdds, drops: [], added_picks: rosterPicks, dropped_picks: [], added_budget: [], dropped_budget: [], status: trade.status || "proposed", user: rosterUserMap.get(rosterId) ?? null };
      }
      const dmInfo = await getDmByMembersFull(partnerUserId);
      if (!dmInfo) throw new Error("No DM thread found with this manager.");
      const session = getSleeperSession();
      const myName = session?.display_name || userTeam.owner;
      await sendTradeMessage({ dmId: dmInfo.dm_id, text: `@${myName} has proposed a trade in ${league.name} via Dynasty Command`, transactionId: trade.transaction_id, leagueId: trade.league_id, status: trade.status || "proposed", transactionsByRoster, usersInLeagueMap, attachTradeCard: true });
      await sendPlainDm(dmInfo.dm_id, "https://statchasers.com/dynasty-command-tool/");
      setDmStatus("sent");
    } catch (e: any) {
      setDmStatus("failed");
      setDmError(e?.message || "DM could not be sent.");
    }
  };

  const verdictCardRef = useRef<HTMLDivElement>(null);

  const saveVerdictPng = async () => {
    if (!verdictCardRef.current) return;
    setSavingPng(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(verdictCardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = "trade-verdict.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setSavingPng(false);
    }
  };

  const leagueFormat = useMemo(() => {
    const sf = league.scoringFormat?.toLowerCase() || "";
    return sf.includes("sf") || sf.includes("superflex") ? "SF" : "1QB";
  }, [league]);

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
  const loserLabel  = winnerSide === "A" ? (sideBTeam?.owner || sideBTeam?.name || "Side B") : (sideATeam?.owner || sideATeam?.name || "Side A");

  const userIsSideA = sideARosterId === userTeam.id;
  const userIsSideB = sideBRosterId === userTeam.id;
  const userIsInTrade = userIsSideA || userIsSideB;
  // From the user's perspective: are they winning?
  const userIsWinning = (userIsSideA && winnerSide === "A") || (userIsSideB && winnerSide === "B");

  const meterPosition = useMemo(() => {
    if (finalA === 0 && finalB === 0) return 50;
    const total = finalA + finalB;
    // finalB = what sideA receives; larger finalB → sideA is winning → indicator right (gold side)
    const ratio = finalB / total;
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    return clamped * 100;
  }, [finalA, finalB]);

  const getVerdictLabel = (): string => {
    if (diffPct <= 6) return "Fair Deal";
    if (userIsInTrade) {
      if (userIsWinning) return diffPct <= 20 ? "You Are Slightly Winning" : "You Are Robbing Them";
      return diffPct <= 20 ? "You Are Overpaying" : "You Are Getting Robbed";
    }
    // Neither side is the logged-in user
    const winner = winnerLabel;
    const loser  = loserLabel;
    return diffPct <= 20 ? `${winner} Is Winning` : `${winner} Is Robbing ${loser}`;
  };

  const getVerdictStyle = (): string => {
    if (diffPct <= 6) return "bg-[#d4af37]/10 dark:bg-[#d4af37]/15 text-amber-700 dark:text-[#e8c84a] border-[#d4af37]/30";
    if (winnerSide === "B") return diffPct <= 20
      ? "bg-orange-500/10 dark:bg-orange-400/15 text-orange-700 dark:text-orange-400 border-orange-500/30"
      : "bg-red-500/10 dark:bg-red-400/15 text-red-700 dark:text-red-400 border-red-500/30";
    return diffPct <= 20
      ? "bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : "bg-blue-500/10 dark:bg-blue-400/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  };

  const positionImpact = useMemo(() => {
    if (!league || !userTeam) return null;
    const positions: ("QB" | "RB" | "WR" | "TE")[] = ["QB", "RB", "WR", "TE"];
    const rosterPositions = league.rosterPositions || [];

    const playersGivenBySideA = sideA.filter((a) => a.type === "player" && a.player).map((a) => a.player!);
    const playersGivenBySideB = sideB.filter((a) => a.type === "player" && a.player).map((a) => a.player!);

    // Build actual post-trade roster: remove traded-away players, add incoming players
    const buildPostTradeRoster = (roster: Player[], giving: Player[], receiving: Player[]): Player[] => {
      const givenIds = new Set(giving.map(p => p.sleeperId ?? p.id));
      return [...roster.filter(p => !givenIds.has(p.sleeperId ?? p.id)), ...receiving];
    };

    // Sum positional value after trade — redraft always re-runs optimizeLineup on the full post-trade roster
    const getTeamPosTotals = (team: Team, pos: string, mode: "dynasty" | "redraft", giving: Player[], receiving: Player[]) => {
      const postRoster = buildPostTradeRoster(team.roster, giving, receiving);
      if (mode === "redraft") {
        const withStarters = rosterPositions.length > 0 ? optimizeLineup(postRoster, rosterPositions) : postRoster;
        return withStarters.filter(p => p.starter && p.pos === pos).reduce((s, p) => s + getRedraftValue(p), 0);
      }
      return postRoster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
    };

    // Rank a team vs the full league — partner's post-trade roster is also simulated
    const getRank = (
      team: Team,
      pos: string,
      mode: "dynasty" | "redraft",
      giving: Player[],
      receiving: Player[],
      partnerId: string,
      partnerGiving: Player[],
      partnerReceiving: Player[],
    ) => {
      const myTotal = getTeamPosTotals(team, pos, mode, giving, receiving);
      let rank = 1;
      for (const t of league.teams) {
        if (t.id === team.id) continue;
        const isPartner = t.id === partnerId;
        const otherTotal = getTeamPosTotals(
          t, pos, mode,
          isPartner ? partnerGiving   : [],
          isPartner ? partnerReceiving : [],
        );
        if (otherTotal > myTotal) rank++;
      }
      return rank;
    };

    const calcImpact = (team: Team | undefined) => {
      if (!team) return null;
      const isUserSide = team.id === sideARosterId;
      const giving     = isUserSide ? playersGivenBySideA : playersGivenBySideB;
      const receiving  = isUserSide ? playersGivenBySideB : playersGivenBySideA;
      const partner    = isUserSide ? sideBTeam : sideATeam;
      const partnerId  = partner?.id ?? "";
      // From the partner's perspective they give what this side receives and vice-versa
      const partnerGiving    = receiving;
      const partnerReceiving = giving;

      return positions.map((pos) => {
        const dynastyBefore = getRank(team, pos, "dynasty", [], [], partnerId, [], []);
        const dynastyAfter  = getRank(team, pos, "dynasty", giving, receiving, partnerId, partnerGiving, partnerReceiving);
        const redraftBefore = getRank(team, pos, "redraft", [], [], partnerId, [], []);
        const redraftAfter  = getRank(team, pos, "redraft", giving, receiving, partnerId, partnerGiving, partnerReceiving);
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


  // Live picks grouped by current owner roster ID
  const ownerPicksMap = useMemo(() => {
    const map = new Map<string, Array<{ season: string; round: number; originalRosterId: number; originalTeamName: string }>>();
    for (const p of rosterPicks) {
      const key = String(p.owner_id);
      if (!map.has(key)) map.set(key, []);
      const origTeam = league.teams.find((t) => t.id === String(p.roster_id));
      map.get(key)!.push({
        season: p.season,
        round: p.round,
        originalRosterId: p.roster_id,
        originalTeamName: origTeam?.owner || origTeam?.name || `Roster ${p.roster_id}`,
      });
    }
    return map;
  }, [rosterPicks, league.teams]);

  const [rosterOpenA, setRosterOpenA] = useState(true);
  const [rosterOpenB, setRosterOpenB] = useState(true);

  const RosterCollapsible = ({ rosterTeam, rosterPlayers, addedPlayerIds, addedPickKeys, side, onTogglePlayer, onTogglePick, getPlayerValue, ownerPicks }: {
    rosterTeam: Team;
    rosterPlayers: Player[];
    addedPlayerIds: Set<string>;
    addedPickKeys: Set<string>;
    side: "a" | "b";
    onTogglePlayer: (p: Player, isAdded: boolean) => void;
    onTogglePick: (pick: { year: number; round: number; projectedRange?: string; originalRosterId?: number }, isAdded: boolean, assetId: string | undefined) => void;
    getPlayerValue: (p: Player) => number;
    ownerPicks: Array<{ season: string; round: number; originalRosterId: number; originalTeamName: string }> | null;
  }) => {
    const isOpen = side === "a" ? rosterOpenA : rosterOpenB;
    const setOpen = side === "a" ? setRosterOpenA : setRosterOpenB;

    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileTab, setMobileTab] = useState<"QB" | "RB" | "WR" | "TE" | "Picks">("QB");
    const [mobileSearch, setMobileSearch] = useState("");

    useEffect(() => {
      if (mobileOpen) { document.body.style.overflow = "hidden"; }
      else { document.body.style.overflow = ""; }
      return () => { document.body.style.overflow = ""; };
    }, [mobileOpen]);

    const rdLabel = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;

    const selectedPlayers = rosterPlayers.filter(p => addedPlayerIds.has(p.sleeperId || p.id));
    const selectedPicksDisplay: Array<{ label: string; sub?: string; onRemove: () => void }> = ownerPicks
      ? ownerPicks.filter(p => addedPickKeys.has(`${p.season}-${p.round}-${p.originalRosterId}`)).map(p => ({
          label: `${p.season} ${rdLabel(p.round)}`,
          sub: p.originalRosterId !== Number(rosterTeam.id) ? `via ${p.originalTeamName}` : undefined,
          onRemove: () => onTogglePick({ year: Number(p.season), round: p.round, originalRosterId: p.originalRosterId }, true, undefined),
        }))
      : rosterTeam.picks.filter(p => addedPickKeys.has(`${p.year}-${p.round}`)).map(p => ({
          label: `${p.year} ${rdLabel(p.round)}`,
          onRemove: () => onTogglePick(p, true, undefined),
        }));

    const POS_TABS = ["QB", "RB", "WR", "TE", "Picks"] as const;
    const posTabColor: Record<string, string> = { QB: "#f87171", RB: "#34d399", WR: "#60a5fa", TE: "#fbbf24", Picks: "#c084fc" };

    const filteredTabPlayers = mobileTab !== "Picks"
      ? rosterPlayers.filter(p => p.pos === mobileTab && (!mobileSearch || p.name.toLowerCase().includes(mobileSearch.toLowerCase()))).sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
      : [];

    const filteredTabPicks = mobileTab === "Picks"
      ? (ownerPicks
          ? [...ownerPicks].sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round).filter(p => !mobileSearch || `${p.season} ${rdLabel(p.round)}`.toLowerCase().includes(mobileSearch.toLowerCase()))
          : [...rosterTeam.picks].sort((a, b) => String(a.year).localeCompare(String(b.year)) || a.round - b.round).filter(p => !mobileSearch || `${p.year} ${rdLabel(p.round)}`.toLowerCase().includes(mobileSearch.toLowerCase())))
      : [];

    return (
      <div className="mt-3 pt-3 border-t border-border/30">

        {/* ── Desktop: existing collapsible grid ─────────────────── */}
        <div className="hidden md:block">
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
            <div className="overflow-x-auto mt-2"><div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto min-w-[300px]">
              {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                const posPlayers = [...rosterPlayers].filter((p) => p.pos === pos).sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
                return (
                  <div key={pos} className="space-y-0.5">
                    <p className={`text-[10px] font-bold uppercase tracking-wider text-center pb-1 border-b border-border/30 ${getPositionColor(pos)}`}>{pos}</p>
                    {posPlayers.map((p) => {
                      const pid = p.sleeperId || p.id;
                      const isAdded = addedPlayerIds.has(pid);
                      return (
                        <button key={pid} className={cn("w-full flex flex-col px-1.5 py-1 rounded text-left text-xs transition-colors", isAdded ? "bg-[#d4af37]/15 border border-[#d4af37]/40 cursor-pointer hover:bg-red-500/10 hover:border-red-500/40" : "hover:bg-muted/40 cursor-pointer")} onClick={() => onTogglePlayer(p, isAdded)} data-testid={`button-roster-player-${side}-${pid}`}>
                          <span className={cn("truncate text-[11px] font-medium", isAdded && "text-[#d4af37]")}>{p.name}</span>
                        </button>
                      );
                    })}
                    {posPlayers.length === 0 && <p className="text-[9px] text-muted-foreground/50 text-center py-2">None</p>}
                  </div>
                );
              })}
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-center pb-1 border-b border-border/30 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400">Picks</p>
                {ownerPicks
                  ? [...ownerPicks].sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round).map((pick, i) => {
                      const pickKey = `${pick.season}-${pick.round}-${pick.originalRosterId}`;
                      const isPickAdded = addedPickKeys.has(pickKey);
                      return (
                        <button key={`live-${i}`} className={cn("w-full flex flex-col px-1.5 py-1 rounded text-left transition-colors", isPickAdded ? "bg-[#d4af37]/15 border border-[#d4af37]/40 cursor-pointer hover:bg-red-500/10 hover:border-red-500/40" : "hover:bg-muted/40 cursor-pointer")} onClick={() => onTogglePick({ year: Number(pick.season), round: pick.round, originalRosterId: pick.originalRosterId }, isPickAdded, undefined)} data-testid={`button-roster-pick-${side}-${i}`}>
                          <span className={cn("truncate text-[11px] font-medium", isPickAdded && "text-[#d4af37]")}>{pick.season} {rdLabel(pick.round)}</span>
                          {pick.originalRosterId !== Number(rosterTeam.id) && <span className="text-[9px] text-purple-400 truncate leading-tight">via {pick.originalTeamName}</span>}
                        </button>
                      );
                    })
                  : [...rosterTeam.picks].sort((a, b) => String(a.year).localeCompare(String(b.year)) || a.round - b.round).map((pick, i) => {
                      const pickKey = `${pick.year}-${pick.round}`;
                      const isPickAdded = addedPickKeys.has(pickKey);
                      return (
                        <button key={i} className={cn("w-full flex flex-col px-1.5 py-1 rounded text-left transition-colors", isPickAdded ? "bg-[#d4af37]/15 border border-[#d4af37]/40 cursor-pointer hover:bg-red-500/10 hover:border-red-500/40" : "hover:bg-muted/40 cursor-pointer")} onClick={() => onTogglePick(pick, isPickAdded, undefined)} data-testid={`button-roster-pick-${side}-${i}`}>
                          <span className={cn("truncate text-[11px] font-medium", isPickAdded && "text-[#d4af37]")}>{pick.year} {rdLabel(pick.round)}</span>
                        </button>
                      );
                    })}
                {(ownerPicks ? ownerPicks.length === 0 : rosterTeam.picks.length === 0) && <p className="text-[9px] text-muted-foreground/50 text-center py-2">None</p>}
              </div>
            </div></div>
          )}
        </div>

        {/* ── Mobile: + Add Asset button + chips ─────────────────── */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            data-testid={`button-mobile-add-asset-${side}`}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed transition-all duration-200 text-sm font-semibold"
            style={{ borderColor: "rgba(212,175,55,0.35)", color: "rgba(212,175,55,0.75)", background: "rgba(212,175,55,0.04)" }}
          >
            <Plus className="w-4 h-4" />
            Add Asset
          </button>

          {(selectedPlayers.length > 0 || selectedPicksDisplay.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {selectedPlayers.map(p => (
                <button
                  key={p.sleeperId || p.id}
                  onClick={() => onTogglePlayer(p, true)}
                  data-testid={`chip-player-${side}-${p.sleeperId || p.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={{ background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.35)", color: "#d4af37" }}
                >
                  {p.name}
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
              {selectedPicksDisplay.map((pick, i) => (
                <button
                  key={i}
                  onClick={pick.onRemove}
                  data-testid={`chip-pick-${side}-${i}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={{ background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.35)", color: "#c084fc" }}
                >
                  {pick.label}{pick.sub ? ` (${pick.sub})` : ""}
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
            </div>
          )}

          {/* Bottom sheet */}
          {mobileOpen && (
            <>
              <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
              <div className="fixed inset-x-0 bottom-0 z-[61] flex flex-col" style={{ height: "88vh", borderRadius: "20px 20px 0 0", background: "rgba(5,10,24,0.98)", border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none" }}>

                {/* Sheet header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <div>
                    <p className="text-sm font-bold text-white">{rosterTeam.owner || rosterTeam.name}</p>
                    <p className="text-[11px] text-white/40 mt-0.5">Tap assets to add · tap again to remove</p>
                  </div>
                  <button onClick={() => setMobileOpen(false)} data-testid={`button-mobile-picker-close-${side}`} className="flex items-center justify-center w-8 h-8 rounded-full transition-colors" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>

                {/* Position tabs — sticky */}
                <div className="flex gap-1.5 px-4 py-3 flex-shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {POS_TABS.map(tab => {
                    const isActive = mobileTab === tab;
                    const color = posTabColor[tab];
                    return (
                      <button
                        key={tab}
                        onClick={() => { setMobileTab(tab); setMobileSearch(""); }}
                        data-testid={`button-mobile-tab-${side}-${tab}`}
                        className="flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-150"
                        style={{ background: isActive ? `${color}22` : "rgba(255,255,255,0.04)", color: isActive ? color : "rgba(203,213,225,0.45)", border: isActive ? `1px solid ${color}55` : "1px solid rgba(255,255,255,0.07)" }}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>

                {/* Search bar */}
                <div className="px-4 py-2.5 flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input
                      value={mobileSearch}
                      onChange={e => setMobileSearch(e.target.value)}
                      placeholder={mobileTab === "Picks" ? "Search picks…" : `Search ${mobileTab}s…`}
                      className="w-full pl-9 pr-4 py-2 rounded-xl text-sm text-white placeholder:text-white/25 outline-none transition-colors"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                      data-testid={`input-mobile-search-${side}`}
                    />
                  </div>
                </div>

                {/* Scrollable asset list */}
                <div className="flex-1 overflow-y-auto px-4 pb-24">
                  {mobileTab !== "Picks" && filteredTabPlayers.map(p => {
                    const pid = p.sleeperId || p.id;
                    const isAdded = addedPlayerIds.has(pid);
                    const val = getPlayerValue(p);
                    return (
                      <button
                        key={pid}
                        onClick={() => onTogglePlayer(p, isAdded)}
                        data-testid={`button-mobile-player-${side}-${pid}`}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-left transition-all duration-150"
                        style={{ background: isAdded ? "rgba(212,175,55,0.08)" : "rgba(255,255,255,0.02)", border: isAdded ? "1px solid rgba(212,175,55,0.35)" : "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <PlayerAvatar
                          id={pid}
                          name={p.name}
                          pos={p.pos}
                          team={p.team ?? ""}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0" />
                        {val > 0 && (
                          <span className="text-[11px] font-bold tabular-nums flex-shrink-0" style={{ color: isAdded ? "#d4af37" : "rgba(203,213,225,0.35)" }}>
                            {val.toLocaleString()}
                          </span>
                        )}
                        <div className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-all" style={{ background: isAdded ? "rgba(212,175,55,0.20)" : "rgba(255,255,255,0.05)", border: isAdded ? "1.5px solid rgba(212,175,55,0.55)" : "1.5px solid rgba(255,255,255,0.08)" }}>
                          {isAdded
                            ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#d4af37" }} />
                            : <Plus className="w-3 h-3 text-white/25" />}
                        </div>
                      </button>
                    );
                  })}
                  {mobileTab !== "Picks" && filteredTabPlayers.length === 0 && (
                    <p className="text-center text-sm text-white/25 py-10">No {mobileTab}s found</p>
                  )}
                  {mobileTab === "Picks" && (ownerPicks
                    ? (filteredTabPicks as typeof ownerPicks).map((pick, i) => {
                        const pickKey = `${pick.season}-${pick.round}-${pick.originalRosterId}`;
                        const isAdded = addedPickKeys.has(pickKey);
                        const isSameOwner = pick.originalRosterId === Number(rosterTeam.id);
                        return (
                          <button
                            key={i}
                            onClick={() => onTogglePick({ year: Number(pick.season), round: pick.round, originalRosterId: pick.originalRosterId }, isAdded, undefined)}
                            data-testid={`button-mobile-pick-${side}-${i}`}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl mb-1.5 text-left transition-all duration-150"
                            style={{ background: isAdded ? "rgba(192,132,252,0.10)" : "rgba(255,255,255,0.025)", border: isAdded ? "1px solid rgba(192,132,252,0.40)" : "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0" style={{ background: isAdded ? "rgba(192,132,252,0.20)" : "rgba(255,255,255,0.05)", border: isAdded ? "1.5px solid rgba(192,132,252,0.60)" : "1.5px solid rgba(255,255,255,0.10)" }}>
                              {isAdded ? <CheckCircle2 className="w-4 h-4" style={{ color: "#c084fc" }} /> : <Plus className="w-3.5 h-3.5 text-white/30" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold" style={{ color: isAdded ? "#c084fc" : "#e2e8f0" }}>{pick.season} {rdLabel(pick.round)}</p>
                              {!isSameOwner && <p className="text-[11px] text-purple-400/60 mt-0.5">via {pick.originalTeamName}</p>}
                            </div>
                          </button>
                        );
                      })
                    : (filteredTabPicks as typeof rosterTeam.picks).map((pick, i) => {
                        const pickKey = `${pick.year}-${pick.round}`;
                        const isAdded = addedPickKeys.has(pickKey);
                        return (
                          <button
                            key={i}
                            onClick={() => onTogglePick(pick, isAdded, undefined)}
                            data-testid={`button-mobile-pick-${side}-${i}`}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl mb-1.5 text-left transition-all duration-150"
                            style={{ background: isAdded ? "rgba(192,132,252,0.10)" : "rgba(255,255,255,0.025)", border: isAdded ? "1px solid rgba(192,132,252,0.40)" : "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0" style={{ background: isAdded ? "rgba(192,132,252,0.20)" : "rgba(255,255,255,0.05)", border: isAdded ? "1.5px solid rgba(192,132,252,0.60)" : "1.5px solid rgba(255,255,255,0.10)" }}>
                              {isAdded ? <CheckCircle2 className="w-4 h-4" style={{ color: "#c084fc" }} /> : <Plus className="w-3.5 h-3.5 text-white/30" />}
                            </div>
                            <p className="text-sm font-semibold" style={{ color: isAdded ? "#c084fc" : "#e2e8f0" }}>{pick.year} {rdLabel(pick.round)}</p>
                          </button>
                        );
                      })
                  )}
                  {mobileTab === "Picks" && filteredTabPicks.length === 0 && (
                    <p className="text-center text-sm text-white/25 py-10">No picks found</p>
                  )}
                </div>

                {/* Done button — fixed at bottom of sheet */}
                <div className="absolute bottom-0 inset-x-0 px-4 py-4 flex-shrink-0" style={{ background: "linear-gradient(to top, rgba(5,10,24,1) 70%, transparent)", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <button
                    onClick={() => setMobileOpen(false)}
                    data-testid={`button-mobile-picker-done-${side}`}
                    className="w-full py-3.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: "linear-gradient(135deg, rgba(11,58,122,0.90) 0%, rgba(11,58,122,0.70) 100%)", border: "1px solid rgba(212,175,55,0.30)", color: "#fff", boxShadow: "0 2px 16px rgba(11,58,122,0.50)" }}
                  >
                    Done{(addedPlayerIds.size + addedPickKeys.size) > 0 ? ` · ${addedPlayerIds.size + addedPickKeys.size} selected` : ""}
                  </button>
                </div>

              </div>
            </>
          )}
        </div>

      </div>
    );
  };

  const renderSide = (side: "a" | "b", assets: TradeAsset[], rawTotal: number) => {
    const sideLabel = side === "a" ? "A" : "B";
    const rosterTeam = side === "a" ? sideATeam : sideBTeam;
    const rosterPlayers = side === "a" ? sideAPlayers : sideBPlayers;
    const addedPlayerIds = new Set(assets.filter((a) => a.type === "player" && a.player).map((a) => a.player!.sleeperId || a.player!.id));
    const addedPickKeys = new Set(assets.filter((a) => a.type === "pick").map((a) =>
      a.pickOriginalRosterId != null ? `${a.pickYear}-${a.pickRound}-${a.pickOriginalRosterId}` : `${a.pickYear}-${a.pickRound}`
    ));

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
            {side === "a" && (
              <Select value={sideARosterId} onValueChange={handleSideATeamChange}>
                <SelectTrigger className="ml-auto h-7 text-xs px-2 w-36" data-testid="select-side-a-team">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {league.teams
                    .filter((t) => t.id !== tradePartnerId)
                    .sort((a, b) => (a.owner || a.name).localeCompare(b.owner || b.name))
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.owner || t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            {side === "b" && (
              <Select value={tradePartnerId || "none"} onValueChange={(v) => handleTradePartnerChange(v === "none" ? "" : v)}>
                <SelectTrigger className="ml-auto h-7 text-xs px-2 w-36" data-testid="select-trade-partner">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select team...</SelectItem>
                  {league.teams
                    .filter((t) => t.id !== sideARosterId)
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
          {side === "b" && !tradePartnerId && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <Scale className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm font-semibold text-muted-foreground/60">No trade partner selected</p>
              <p className="text-xs text-muted-foreground/40">Use the dropdown above to choose a team</p>
            </div>
          )}

          {rosterTeam && rosterPlayers.length > 0 && (
            <RosterCollapsible
              rosterTeam={rosterTeam}
              rosterPlayers={rosterPlayers}
              addedPlayerIds={addedPlayerIds}
              addedPickKeys={addedPickKeys}
              side={side}
              onTogglePlayer={(p, isAdded) => {
                if (isAdded) {
                  const currentAssets = side === "a" ? sideA : sideB;
                  const pid = p.sleeperId || p.id;
                  const asset = currentAssets.find(a => a.type === "player" && a.player && (a.player.sleeperId === pid || a.player.id === pid));
                  if (asset) removeAsset(side, asset.id);
                } else {
                  addPlayer(side, p);
                }
              }}
              onTogglePick={(pick, isAdded) => {
                if (isAdded) {
                  const currentAssets = side === "a" ? sideA : sideB;
                  const asset = currentAssets.find(a =>
                    a.type === "pick" &&
                    Number(a.pickYear) === Number(pick.year) &&
                    a.pickRound === pick.round &&
                    (pick.originalRosterId == null || a.pickOriginalRosterId == null || a.pickOriginalRosterId === pick.originalRosterId)
                  );
                  if (asset) removeAsset(side, asset.id);
                } else {
                  addPick(side, pick.year, pick.round, (pick.projectedRange as "Early" | "Mid" | "Late") || "Mid", pick.originalRosterId);
                }
              }}
              getPlayerValue={getPlayerValue}
              ownerPicks={ownerPicksMap.get(rosterTeam?.id ?? "") ?? null}
            />
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Trade Calculator" subtitle="Evaluate trades with dynasty values and diminishing returns" />


      <Card className="p-5" ref={verdictCardRef}>
        {(sideA.length > 0 && sideB.length > 0) && (
          <>
          <div className="mb-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                Trade Verdict
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={saveVerdictPng}
                disabled={savingPng}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                data-testid="button-save-verdict-png"
              >
                {savingPng
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                Save PNG
              </Button>
            </div>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>

          <div className="space-y-3">

            {/* 1. VERDICT FRONT AND CENTER */}
            <div className="text-center space-y-1.5 py-0">
              <p className="text-sm sm:text-base font-extrabold tracking-tight text-foreground uppercase leading-tight" data-testid="text-verdict-headline">
                {diffPct <= 6 ? "Dead Even Trade" : userIsInTrade
                  ? (userIsWinning ? "You Win The Trade" : `${winnerLabel} Wins The Trade`)
                  : `${winnerLabel} Wins The Trade`}
              </p>
              <div className="flex justify-center pt-1">
                <Badge className={`text-xs px-4 py-1.5 font-bold border ${getVerdictStyle()}`} data-testid="badge-verdict">
                  {getVerdictLabel()}
                </Badge>
              </div>
            </div>

            {/* 2. ADVANTAGE METER */}
            {(() => {
              const fillPct = finalA === 0 && finalB === 0 ? 50 : finalB === 0 ? 100 : finalA === 0 ? 0 : Math.max(5, Math.min(95, 100 - meterPosition));
              const iLose = fillPct > 50;
              const barColor = diffPct <= 6
                ? "linear-gradient(90deg, #b8932a 0%, #d4af37 100%)"
                : iLose
                  ? diffPct <= 20
                    ? "linear-gradient(90deg, #c2410c 0%, #f97316 100%)"
                    : "linear-gradient(90deg, #dc2626 0%, #ef4444 100%)"
                  : diffPct <= 20
                    ? "linear-gradient(90deg, #059669 0%, #10b981 100%)"
                    : "linear-gradient(90deg, #1d4ed8 0%, #3b82f6 100%)";
              return (
                <div className="space-y-1.5 px-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    <span>{sideATeam?.owner || "Side A"}</span>
                    <span>{sideBTeam?.owner || "Side B"}</span>
                  </div>
                  <div className="relative h-4 rounded-full overflow-hidden" style={{ background: "#12284a" }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-l-full transition-all duration-700"
                      style={{ width: `${fillPct}%`, background: barColor }}
                    />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10" style={{ left: "50%" }} />
                  </div>
                  <div className="flex justify-center">
                    <span className="text-[9px] text-muted-foreground/50 font-medium">Fair</span>
                  </div>
                </div>
              );
            })()}

            {/* 3. PLAYER CARDS */}
            {(() => {
              const posBorder: Record<string, string> = {
                QB: "border-rose-500",
                RB: "border-emerald-500",
                WR: "border-sky-500",
                TE: "border-yellow-500",
              };
              const renderCards = (assets: TradeAsset[], side: "a" | "b") => (
                <div className="flex flex-wrap gap-2 justify-center">
                  {assets.map((asset) => {
                    const lastName = asset.type === "player" && asset.player
                      ? asset.player.name.split(" ").slice(1).join(" ") || asset.player.name
                      : asset.label;
                    const team = (asset.player as any)?.team ?? "";
                    const borderColor = asset.type === "pick"
                      ? "border-purple-500"
                      : posBorder[asset.pos || ""] || "border-border/30";
                    return (
                      <div
                        key={asset.id}
                        className={`relative flex flex-col items-center gap-1 pt-2 pb-2 px-2 rounded-xl bg-muted/20 border min-w-[68px] cursor-pointer hover:bg-red-500/10 hover:border-red-500/40 transition-colors ${borderColor}`}
                        onClick={() => removeAsset(side, asset.id)}
                      >
                        {asset.type === "player" && asset.player ? (
                          <PlayerAvatar
                            id={asset.player.sleeperId || asset.player.id}
                            name={asset.player.name}
                            pos={asset.player.pos}
                            team={team}
                            size="md"
                            compact
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-purple-900/40 border border-purple-700/40 flex items-center justify-center flex-shrink-0">
                            <span className="text-[11px] font-bold text-purple-400">
                              {asset.pickRound === 1 ? "1st" : asset.pickRound === 2 ? "2nd" : asset.pickRound === 3 ? "3rd" : `${asset.pickRound}th`}
                            </span>
                          </div>
                        )}
                        <p className="text-[11px] font-bold text-foreground text-center leading-tight max-w-[68px] truncate">{lastName}</p>
                        {team && <p className="text-[10px] text-muted-foreground text-center leading-none">{team}</p>}
                        {!team && asset.type === "pick" && <p className="text-[10px] text-muted-foreground text-center leading-none">{asset.value.toLocaleString()}</p>}
                      </div>
                    );
                  })}
                </div>
              );
              return (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    {sideA.length > 0 ? renderCards(sideA, "a") : <p className="text-[10px] text-muted-foreground text-center py-2">Nothing yet</p>}
                  </div>
                  <div>
                    {sideB.length > 0 ? renderCards(sideB, "b") : <p className="text-[10px] text-muted-foreground text-center py-2">Nothing yet</p>}
                  </div>
                </div>
              );
            })()}


          </div>
          <hr className="border-border/40 my-5" />
          </>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {renderSide("a", sideA, rawA)}
          {renderSide("b", sideB, rawB)}
        </div>
      </Card>

      {/* ── Propose Trade Panel ─────────────────────────────── */}
      {(sideA.length > 0 || sideB.length > 0) && (() => {
        const ordRound = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
        const posColor = (pos?: string) =>
          pos === "QB" ? "text-rose-400" : pos === "RB" ? "text-emerald-400" :
          pos === "WR" ? "text-sky-400"  : pos === "TE" ? "text-yellow-400" : "text-muted-foreground";
        const posBg = (pos?: string) =>
          pos === "QB" ? "bg-rose-500/15 border-rose-500/25" :
          pos === "RB" ? "bg-emerald-500/15 border-emerald-500/25" :
          pos === "WR" ? "bg-sky-500/15 border-sky-500/25" :
          pos === "TE" ? "bg-yellow-500/15 border-yellow-500/25" :
          "bg-muted/30 border-border/40";
        const missingIds = [...sideA, ...sideB].some(a => a.type === "player" && !a.player?.sleeperId);
        const canSubmit = !!sleeperJwt && !!sideBRosterId && !missingIds && (sideA.length > 0 || sideB.length > 0) && !proposing && !proposedTrade;
        const issues: string[] = [];
        if (!proposedTrade && !!sleeperJwt && !sideBRosterId) issues.push("Select a trade partner (Side B) to enable submit");
        if (!proposedTrade && !!sleeperJwt && missingIds) issues.push("Some players are missing Sleeper IDs — add them via the roster picker");
        return (
          <Card className="p-5" data-testid="card-propose-trade">
            <div className="mb-4">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Send className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                Propose Trade on Sleeper
              </h3>
              <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
            </div>

            <div className="space-y-4">
              {!sleeperJwt ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Connect your Sleeper account to propose trades directly from Dynasty Command.</p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="eyJhbGci…"
                      value={jwtInput}
                      onChange={e => setJwtInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSaveJwt()}
                      className="font-mono text-xs flex-1"
                      data-testid="input-trade-calc-jwt"
                    />
                    <Button size="sm" onClick={handleSaveJwt} disabled={!jwtInput.trim()} data-testid="button-trade-calc-jwt-save">Connect</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Two-column trade preview */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["a", "b"] as const).map(side => {
                      const assets = side === "a" ? sideA : sideB;
                      const team   = side === "a" ? sideATeam : sideBTeam;
                      const label  = side === "a"
                        ? `${sideATeam?.owner || "You"} Sends`
                        : `${sideBTeam?.owner || "Partner"} Sends`;
                      return (
                        <div key={side} className="rounded-lg border border-border overflow-hidden">
                          <div className="px-3 py-2 bg-muted/30 border-b border-border/50 flex items-center gap-2">
                            {team?.avatar ? (
                              <img src={team.avatar} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-muted flex-shrink-0" />
                            )}
                            <span className={cn("text-[11px] font-bold tracking-wide", side === "a" ? "text-rose-500 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{label}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[80px]">{team?.owner || team?.name || (side === "a" ? "Side A" : "Side B")}</span>
                          </div>
                          <div className="px-3 py-2.5 space-y-2 min-h-[60px]">
                            {assets.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground/50 italic py-1">Nothing added yet</p>
                            ) : assets.map(a => (
                              <div key={a.id} className="flex items-center gap-2 min-w-0">
                                {a.type === "player" ? (
                                  <>
                                    <div className="w-7 h-7 rounded-full overflow-hidden bg-muted flex-shrink-0 ring-1 ring-border/30">
                                      {a.player?.sleeperId && (
                                        <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.player.sleeperId}.jpg`} alt={a.player.name} className="w-full h-full object-cover object-top" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] font-semibold text-foreground truncate leading-tight">{a.player?.name}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className={cn("text-[9px] font-bold px-1 py-px rounded border", posColor(a.player?.pos), posBg(a.player?.pos))}>{a.player?.pos}</span>
                                        {a.player?.team && <span className="text-[10px] text-muted-foreground">{a.player.team}</span>}
                                      </div>
                                    </div>
                                    {a.value > 0 && <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">{a.value.toLocaleString()}</span>}
                                  </>
                                ) : (
                                  <>
                                    <div className="w-7 h-7 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-purple-400">R{a.pickRound}</div>
                                    <span className="text-[12px] text-foreground flex-1 truncate">{a.pickYear} {ordRound(a.pickRound!)}<span className="text-muted-foreground"> ({a.pickRange})</span></span>
                                    {a.value > 0 && <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">{a.value.toLocaleString()}</span>}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {!proposedTrade ? (
                    <>
                      {/* Controls row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground font-medium">Expires</span>
                          <Select value={expiry} onValueChange={setExpiry}>
                            <SelectTrigger className="h-7 w-36 text-[11px] rounded-full border-border/50 bg-background/60" data-testid="select-trade-expiry">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXPIRY_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFaabOpen(v => !v)}
                          data-testid="button-toggle-faab"
                          className={cn("flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border transition-colors", faabOpen ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:border-border")}
                        >
                          <DollarSign className="w-3 h-3" />
                          FAAB
                          <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", faabOpen && "rotate-180")} />
                        </button>
                      </div>

                      {/* FAAB panel */}
                      {faabOpen && (
                        <div className="rounded-lg bg-muted/20 border border-border/40 p-3 space-y-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Include FAAB</p>
                          <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground shrink-0">{sideATeam?.owner || "Side A"}</span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">$</span>
                                <Input type="number" min={0} className="w-20 h-7 text-xs pl-5" value={faabASends} onChange={e => setFaabASends(e.target.value)} placeholder="0" data-testid="input-faab-a" />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground shrink-0">{sideBTeam?.owner || "Side B"}</span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">$</span>
                                <Input type="number" min={0} className="w-20 h-7 text-xs pl-5" value={faabBSends} onChange={e => setFaabBSends(e.target.value)} placeholder="0" data-testid="input-faab-b" />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Validation warnings */}
                      {issues.length > 0 && (
                        <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 space-y-1">
                          {issues.map((msg, i) => (
                            <p key={i} className="text-[11px] text-amber-400 flex items-start gap-1.5"><span className="shrink-0 mt-px">⚠</span>{msg}</p>
                          ))}
                        </div>
                      )}

                      {/* Error */}
                      {proposeError && (
                        <div className="rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2 text-[11px] text-red-400" data-testid="text-propose-error">{proposeError}</div>
                      )}

                      {/* Send button */}
                      <div className="flex justify-end pt-1">
                        <Button
                          onClick={handleProposeTrade}
                          disabled={!canSubmit}
                          className="h-10 px-6 bg-gradient-to-r from-[#0b3a7a] to-[#1151a8] hover:from-[#0d4a9e] hover:to-[#1362c8] text-white font-semibold gap-2.5 rounded-full shadow-lg shadow-[#0b3a7a]/25 disabled:opacity-40 disabled:shadow-none transition-all duration-200 text-sm"
                          data-testid="button-propose-trade"
                        >
                          {proposing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          {proposing ? "Sending…" : "Send Trade Offer"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    /* Success state */
                    <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/20 p-4 space-y-3" data-testid="card-propose-success">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-emerald-400">Trade offer sent!</p>
                            <p className="text-[10px] text-emerald-400/50 font-mono mt-0.5">ID: {proposedTrade.transaction_id}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10 gap-1.5 shrink-0 rounded-full" onClick={handleWithdraw} disabled={withdrawing} data-testid="button-withdraw-trade">
                          {withdrawing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                          Withdraw
                        </Button>
                      </div>
                      {withdrawError && <p className="text-[11px] text-red-400">{withdrawError}</p>}
                      {dmStatus !== "idle" && (
                        <div className="border-t border-emerald-500/15 pt-2.5">
                          {dmStatus === "sending" && <div className="flex items-center gap-2 text-[11px] text-emerald-400/60"><Loader2 className="w-3 h-3 animate-spin" />Sending trade card to partner…</div>}
                          {dmStatus === "sent" && <div className="flex items-center gap-1.5 text-[11px] text-emerald-400"><CheckCircle2 className="w-3 h-3" />Trade card + tool link sent via Sleeper DM</div>}
                          {dmStatus === "failed" && (
                            <div className="space-y-1">
                              <p className="text-[11px] text-amber-400">DM could not be delivered automatically.</p>
                              {dmError && <p className="text-[10px] text-red-400/70">{dmError}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })()}

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
                        <th className="px-1 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" colSpan={2}>Win-Now</th>
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

          <div className="hidden sm:block w-px h-5 bg-[#d4af37]/50 flex-shrink-0" />

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

          <div className="hidden sm:block w-px h-5 bg-[#d4af37]/50 flex-shrink-0" />

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
                      <PlayerAvatar id={p.sleeperId ?? ""} name={p.name} pos={p.pos} team={p.team ?? ""} size="sm" />
                      {val > 0 && <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0" data-testid={`text-player-value-${p.sleeperId}`}>{val.toLocaleString()}</span>}
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
                  // Label rules:
                  //   exact slot known  → "2026 Rookie 1.03"
                  //   startup pick      → "2026 Startup 1st"
                  //   rookie (no slot)  → "2026 Rookie 1st"
                  const pickLabel = isStartup
                    ? `${p.season} Startup ${ord(p.round)}`
                    : slotStr
                      ? `${p.season} Rookie ${slotStr}`
                      : `${p.season} Rookie ${ord(p.round)}`;
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
