import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, getPositionColor, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { cn } from "@/lib/utils";
import type { League, Team, Player, Pick, Tier } from "@/types";
import { formatPickLabel } from "@/types";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { getSleeperSession } from "@/services/sleeperAuth";
import { proposeTrade, getDmByMembers, getDmByMembersFull, markDmRead, sendTradeMessage, sendDmMessage, fetchDmMessages, firePostTradeLinkDm } from "@/services/sleeperAuthedApi";
import { FeatureDisabledError } from "@/components/FeatureDisabledDialog";
import { isGeneralMessagingEnabled } from "@/services/sleeperSafetyGate";
import type { ProposeTradeResult, SleeperTransactionPick, SleeperDmMessage } from "@/services/sleeperAuthedApi";
import { BulkTrades } from "@/pages/tabs/BulkTrades";
import {
  ArrowRightLeft, Target, TrendingUp, TrendingDown, Zap, ShieldCheck,
  ChevronRight, Send, Loader2, CheckCircle2, AlertTriangle, X, Pencil, Search, Layers
} from "lucide-react";

type FinderInnerTab = "finder" | "bulk-trades";

interface PositionalAnalysisProps {
  league: League;
  userTeam: Team;
  onNavigateToCalculator?: (side1: string[], side2: string[]) => void;
}

type PosLabel = "QB" | "RB" | "WR" | "TE";
type StatusLabel = "Surplus" | "Neutral" | "Need";

const POSITIONS: PosLabel[] = ["QB", "RB", "WR", "TE"];

const DEFAULT_STARTERS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };

/**
 * Builds the optimal redraft starting lineup for a team and returns
 * the total redraft value contributed by each position.
 * No player is used twice. Greedy by redraft value at each step.
 *
 * Step 1 — dedicated slots (QB×N, RB×N, WR×N, TE×N)
 * Step 2 — FLEX slots: pick highest remaining RB/WR/TE
 * Step 3 — SUPER_FLEX slots: pick highest remaining QB/RB/WR/TE
 */
function buildOptimalLineupValues(
  roster: import("@/types").Player[],
  rosterPositions: string[],
  getRedraftValue: (p: import("@/types").Player) => number
): Record<string, number> {
  const posValues: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const used = new Set<string>();

  // Pool: per-position list sorted best → worst by redraft value
  const pool: Record<string, import("@/types").Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of roster) {
    if (p.pos in pool) pool[p.pos].push(p);
  }
  for (const pos of Object.keys(pool)) {
    pool[pos].sort((a, b) => getRedraftValue(b) - getRedraftValue(a));
  }

  const uid = (p: import("@/types").Player) => p.sleeperId || p.id;

  // Best unused player for a given position
  const takeBestFromPos = (pos: string): import("@/types").Player | null => {
    for (const p of pool[pos] ?? []) {
      if (!used.has(uid(p))) { used.add(uid(p)); return p; }
    }
    return null;
  };

  // Best unused player across multiple eligible positions; returns [player, pos]
  const takeBestAcross = (eligiblePos: string[]): [import("@/types").Player, string] | null => {
    let best: import("@/types").Player | null = null;
    let bestPos = "";
    let bestVal = -1;
    for (const pos of eligiblePos) {
      for (const p of pool[pos] ?? []) {
        if (!used.has(uid(p))) {
          const v = getRedraftValue(p);
          if (v > bestVal) { bestVal = v; best = p; bestPos = pos; }
          break; // pool is sorted; first unused = best for this pos
        }
      }
    }
    if (!best) return null;
    used.add(uid(best));
    return [best, bestPos];
  };

  // Step 1 — dedicated position slots
  const dedicatedCounts: Record<string, number> = {};
  for (const slot of rosterPositions) {
    if (slot in pool) dedicatedCounts[slot] = (dedicatedCounts[slot] ?? 0) + 1;
  }
  // Fall back to DEFAULT_STARTERS if league has no explicit slots for a position
  for (const pos of POSITIONS) {
    const count = Math.max(dedicatedCounts[pos] ?? 0, DEFAULT_STARTERS[pos] ?? 1);
    for (let i = 0; i < count; i++) {
      const p = takeBestFromPos(pos);
      if (p) posValues[pos] += getRedraftValue(p);
    }
  }

  // Step 2 — FLEX slots (RB / WR / TE)
  const flexSlots = rosterPositions.filter(s => s === "FLEX" || s === "WR/RB/TE" || s === "REC_FLEX").length;
  for (let i = 0; i < flexSlots; i++) {
    const result = takeBestAcross(["RB", "WR", "TE"]);
    if (result) posValues[result[1]] += getRedraftValue(result[0]);
  }

  // Step 3 — SUPER_FLEX slots (QB / RB / WR / TE)
  const sfSlots = rosterPositions.filter(s => s === "SUPER_FLEX" || s === "QB/WR/RB/TE").length;
  for (let i = 0; i < sfSlots; i++) {
    const result = takeBestAcross(["QB", "RB", "WR", "TE"]);
    if (result) posValues[result[1]] += getRedraftValue(result[0]);
  }

  return posValues;
}
const DEPTH_COUNT = 3;

interface PosStrengthData {
  teamId: string;
  starterStrength: number;
  depthStrength: number;
  totalStrength: number;
  starterPlayers: Player[];
  depthPlayers: Player[];
}

interface TeamPosProfile {
  teamId: string;
  team: Team;
  tier: Tier;
  positions: Record<PosLabel, {
    rank: number;
    status: StatusLabel;
    totalStrength: number;
    surplusAmount: number;
    starterPlayers: Player[];
    depthPlayers: Player[];
  }>;
  pickStrength: "High" | "Avg" | "Low";
  totalPickValue: number;
}

function getStarterCountForPos(pos: PosLabel, rosterPositions?: string[]): number {
  if (!rosterPositions || rosterPositions.length === 0) return DEFAULT_STARTERS[pos] || 1;
  let count = rosterPositions.filter(s => s === pos).length;
  return Math.max(count, DEFAULT_STARTERS[pos] || 1);
}


const DIMINISHING_WEIGHTS = [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.36, 0.31];
function getWeight(i: number): number { return i < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[i] : 0.31; }
function adjustedTotal(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.reduce((s, v, i) => s + v * getWeight(i), 0);
}

export function PositionalAnalysis({ league, userTeam, onNavigateToCalculator }: PositionalAnalysisProps) {
  const [activeSubTab, setActiveSubTab] = useState<"opportunities">("opportunities");
  const [innerTab, setInnerTab] = useState<FinderInnerTab>("finder");
  const { getPlayerValue, getRedraftValue } = useValueModel();

  const positionalProfile = useMemo(() => {
    const leagueSize = league.teams.length;
    const topThird = Math.ceil(leagueSize / 3);
    const bottomThird = leagueSize - topThird;

    const dynRanks: Record<string, number> = {};
    const rdRanks: Record<string, number> = {};

    const rosterPositions = league.rosterPositions || [];

    // Pre-compute optimal lineup values per team (Win-Now) — done once, reused per position
    const teamOptimalValues = new Map(
      league.teams.map(t => [t.id, buildOptimalLineupValues(t.roster, rosterPositions, getRedraftValue)])
    );

    POSITIONS.forEach(pos => {
      // Dynasty: full roster depth — all players at this position, dynasty values
      const byDyn = [...league.teams].sort((a, b) =>
        b.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0) -
        a.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0)
      );

      // Win-Now: optimal lineup value attributed to this position (includes FLEX/SF contributions)
      const byRd = [...league.teams].sort((a, b) =>
        (teamOptimalValues.get(b.id)?.[pos] ?? 0) - (teamOptimalValues.get(a.id)?.[pos] ?? 0)
      );

      byDyn.forEach((t, i) => { if (t.id === userTeam.id) dynRanks[pos] = i + 1; });
      byRd.forEach((t, i)  => { if (t.id === userTeam.id) rdRanks[pos]  = i + 1; });
    });

    const rankTier = (rank: number) =>
      rank <= topThird ? "top" : rank > bottomThird ? "bottom" : "mid";

    return { dynRanks, rdRanks, leagueSize, rankTier };
  }, [league, userTeam, getPlayerValue, getRedraftValue]);

  const subTabs = [
    { id: "opportunities" as const, label: "Ideas", icon: ArrowRightLeft },
  ];

  const ordinal = (n: number) =>
    n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
  const rankColor = (rank: number) =>
    rank <= 4 ? "text-emerald-500 dark:text-emerald-400"
    : rank <= 8 ? "text-yellow-500 dark:text-yellow-400"
    : "text-red-500 dark:text-red-400";
  const barColor = (rank: number) =>
    rank <= 4 ? "bg-emerald-500" : rank <= 8 ? "bg-yellow-500" : "bg-red-500";
  const barPct = (rank: number) =>
    positionalProfile.leagueSize <= 1
      ? 100
      : Math.round((1 - (rank - 1) / (positionalProfile.leagueSize - 1)) * 100);

  const innerToggle = (
    <div
      className="grid flex-shrink-0 w-[90vw] md:w-[260px]"
      style={{
        gridTemplateColumns: "1fr 1fr",
        height: 48,
        borderRadius: 16,
        padding: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        gap: 4,
      }}
      data-testid="finder-inner-toggle"
    >
      {(["finder", "bulk-trades"] as const).map((tab) => {
        const isActive = innerTab === tab;
        const Icon = tab === "finder" ? Search : Layers;
        const label = tab === "finder" ? "Matched Trades" : "Bulk Trades";
        return (
          <button
            key={tab}
            onClick={() => setInnerTab(tab)}
            data-testid={`finder-inner-tab-${tab}`}
            className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
            style={{
              borderRadius: 12,
              fontSize: 13,
              letterSpacing: "0.01em",
              background: isActive
                ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)"
                : "transparent",
              color: isActive ? "#fff" : "rgba(203,213,225,0.45)",
              border: isActive
                ? "1px solid rgba(212,175,55,0.30)"
                : "1px solid transparent",
              boxShadow: isActive
                ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "none",
            }}
          >
            <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
            {label}
            {isActive && (
              <span
                className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full"
                style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );

  if (innerTab === "bulk-trades") {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="hidden md:block">
            <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-bulk-trades-title">
              Bulk Trades
            </h2>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            <p className="text-sm text-muted-foreground mt-2">
              Scan all connected leagues and build/send trade offers across your dynasty portfolio.
            </p>
          </div>
          <div className="w-full md:w-auto md:ml-auto flex justify-center">{innerToggle}</div>
        </div>
        <BulkTrades />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="hidden md:block">
          <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-positional-analysis-title">
            Matched Trades
          </h2>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-sm text-muted-foreground mt-2">
            Analyze positional strengths, identify trade partners, and discover AI-powered dynasty trade opportunities.
          </p>
        </div>
        <div className="w-full md:w-auto md:ml-auto flex justify-center">{innerToggle}</div>
      </div>

      {/* My Positional Profile */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="card-positional-profile">
        {POSITIONS.map(pos => {
            const dynRank = positionalProfile.dynRanks[pos] ?? positionalProfile.leagueSize;
            const rdRank  = positionalProfile.rdRanks[pos]  ?? positionalProfile.leagueSize;
            return (
              <div
                key={pos}
                className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-3"
                data-testid={`pos-profile-${pos.toLowerCase()}`}
              >
                <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{pos}</span>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Dynasty</span>
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(dynRank))}>
                      {ordinal(dynRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor(dynRank))} style={{ width: `${barPct(dynRank)}%` }} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Win-Now</span>
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(rdRank))}>
                      {ordinal(rdRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor(rdRank))} style={{ width: `${barPct(rdRank)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {subTabs.length > 1 && (
        <div className="flex items-center gap-0 border-b border-border/50 pb-0 overflow-x-auto scrollbar-hide" data-testid="positional-sub-tabs">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={cn(
                  "flex items-center gap-1 px-2 sm:px-3.5 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors -mb-[1px]",
                  activeSubTab === tab.id
                    ? "border-[#0b3a7a] text-[#0b3a7a] dark:text-blue-400 dark:border-blue-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                data-testid={`tab-${tab.id}`}
              >
                <Icon className="w-3.5 h-3.5 hidden sm:block" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {activeSubTab === "opportunities" && <TradeOpportunities league={league} userTeam={userTeam} />}
    </div>
  );
}

function usePositionalProfiles(league: League, userTeam: Team) {
  const { getPlayerValue, getPickValue } = useValueModel();
  const profileTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  return useMemo(() => {
    const total = league.teams.length;
    const rosterPositions = league.rosterPositions || [];

    const strengthByTeamPos: Record<string, Record<PosLabel, PosStrengthData>> = {};
    const pickTotals: Record<string, number> = {};

    for (const team of league.teams) {
      strengthByTeamPos[team.id] = {} as any;
      pickTotals[team.id] = team.picks.reduce((s, p) => s + getPickValue(p), 0);

      for (const pos of POSITIONS) {
        const starterCount = getStarterCountForPos(pos, rosterPositions);
        const posPlayers = [...team.roster]
          .filter(p => p.pos === pos)
          .map(p => ({ ...p, val: getPlayerValue(p) }))
          .sort((a, b) => b.val - a.val);

        const starters = posPlayers.slice(0, starterCount);
        const depthPlayers = posPlayers.slice(starterCount, starterCount + DEPTH_COUNT);
        const starterStrength = starters.reduce((s, p) => s + p.val, 0);
        const depthStrength = depthPlayers.reduce((s, p) => s + p.val, 0);

        strengthByTeamPos[team.id][pos] = {
          teamId: team.id,
          starterStrength,
          depthStrength,
          totalStrength: starterStrength + 0.5 * depthStrength,
          starterPlayers: starters,
          depthPlayers: depthPlayers,
        };
      }
    }

    const posRanks: Record<PosLabel, { teamId: string; totalStrength: number }[]> = {} as any;
    const posMedians: Record<PosLabel, number> = {} as any;

    for (const pos of POSITIONS) {
      const sorted = league.teams
        .map(t => ({ teamId: t.id, totalStrength: strengthByTeamPos[t.id][pos].totalStrength }))
        .sort((a, b) => b.totalStrength - a.totalStrength);
      posRanks[pos] = sorted;
      const mid = Math.floor(sorted.length / 2);
      posMedians[pos] = sorted.length % 2 === 0
        ? (sorted[mid - 1].totalStrength + sorted[mid].totalStrength) / 2
        : sorted[mid].totalStrength;
    }

    const pickSorted = [...league.teams].sort((a, b) => pickTotals[b.id] - pickTotals[a.id]);

    const profiles: TeamPosProfile[] = league.teams.map(team => {
      const tier = profileTierMap.get(team.id)?.tier ?? "Balanced";
      const positions: TeamPosProfile["positions"] = {} as any;

      for (const pos of POSITIONS) {
        const rankList = posRanks[pos];
        const rank = rankList.findIndex(r => r.teamId === team.id) + 1;
        const topCutoff = Math.ceil(total * 0.25);
        const bottomCutoff = Math.floor(total * 0.75) + 1;
        const status: StatusLabel = rank <= topCutoff ? "Surplus" : rank >= bottomCutoff ? "Need" : "Neutral";
        const strength = strengthByTeamPos[team.id][pos];

        positions[pos] = {
          rank,
          status,
          totalStrength: strength.totalStrength,
          surplusAmount: Math.round(strength.totalStrength - posMedians[pos]),
          starterPlayers: strength.starterPlayers,
          depthPlayers: strength.depthPlayers,
        };
      }

      const pickRank = pickSorted.findIndex(t => t.id === team.id) + 1;
      const pickStrength: "High" | "Avg" | "Low" = pickRank <= Math.ceil(total * 0.25) ? "High" : pickRank >= Math.floor(total * 0.75) + 1 ? "Low" : "Avg";

      return { teamId: team.id, team, tier, positions, pickStrength, totalPickValue: pickTotals[team.id] };
    });

    return { profiles, total };
  }, [league, userTeam, getPlayerValue, getPickValue, profileTierMap]);
}

function SurplusNeeds({ league, userTeam, onSwitchTab }: { league: League; userTeam: Team; onSwitchTab: (tab: "opportunities") => void }) {
  const { profiles } = usePositionalProfiles(league, userTeam);

  const userProfile = useMemo(() => profiles.find(p => p.teamId === userTeam.id), [profiles, userTeam]);

  const userSurplusPositions = useMemo(() =>
    POSITIONS.filter(pos => userProfile?.positions[pos].status === "Surplus"),
    [userProfile]
  );

  const userNeedPositions = useMemo(() =>
    POSITIONS.filter(pos => userProfile?.positions[pos].status === "Need"),
    [userProfile]
  );

  const matchedPartners = useMemo(() => {
    if (!userProfile) return [];
    return profiles
      .filter(p => p.teamId !== userTeam.id)
      .map(partner => {
        const theyHaveYourNeeds = userNeedPositions.filter(
          pos => partner.positions[pos].status === "Surplus"
        );
        const youHaveTheirNeeds = userSurplusPositions.filter(
          pos => partner.positions[pos].status === "Need"
        );
        const score = theyHaveYourNeeds.length + youHaveTheirNeeds.length;
        return { partner, theyHaveYourNeeds, youHaveTheirNeeds, score };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [profiles, userTeam, userProfile, userNeedPositions, userSurplusPositions]);

  if (!userProfile) return null;

  return (
    <div className="space-y-6">
      {/* My Positional Profile */}
      <Card data-testid="card-my-profile">
        <CardContent className="pt-5">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Surpluses */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {userSurplusPositions.length > 0 ? `Surplus: ${userSurplusPositions.join(", ")}` : "No clear surplus positions"}
                </span>
              </div>
              <div className="space-y-2">
                {userSurplusPositions.length === 0 && (
                  <p className="text-xs text-muted-foreground">You are not in the top 25% at any position</p>
                )}
                {userSurplusPositions.map(pos => {
                  const pd = userProfile.positions[pos];
                  const allPlayers = [...pd.starterPlayers, ...pd.depthPlayers].slice(0, 4);
                  return (
                    <div key={pos} className="rounded-md bg-emerald-500/8 border border-emerald-500/20 p-2.5" data-testid={`my-surplus-${pos}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${getPositionColor(pos)}`}>{pos}</Badge>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">#{pd.rank} league · +{pd.surplusAmount.toLocaleString()}</span>
                      </div>
                      <div className="space-y-0.5">
                        {allPlayers.map((pl, i) => (
                          <div key={pl.id} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-3">{i + 1}.</span>
                            <span className="text-[11px] font-medium text-foreground truncate">{pl.name}</span>
                            {i < pd.starterPlayers.length && <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">starter</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Needs */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <TrendingDown className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {userNeedPositions.length > 0 ? `Needs: ${userNeedPositions.join(", ")}` : "No critical needs"}
                </span>
              </div>
              <div className="space-y-2">
                {userNeedPositions.length === 0 && (
                  <p className="text-xs text-muted-foreground">You are not in the bottom 25% at any position</p>
                )}
                {userNeedPositions.map(pos => {
                  const pd = userProfile.positions[pos];
                  const allPlayers = [...pd.starterPlayers, ...pd.depthPlayers].slice(0, 4);
                  return (
                    <div key={pos} className="rounded-md bg-red-500/8 border border-red-500/20 p-2.5" data-testid={`my-need-${pos}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${getPositionColor(pos)}`}>{pos}</Badge>
                        <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">#{pd.rank} league · {pd.surplusAmount.toLocaleString()}</span>
                      </div>
                      {allPlayers.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No {pos}s on roster</p>
                      ) : (
                        <div className="space-y-0.5">
                          {allPlayers.map((pl, i) => (
                            <div key={pl.id} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground w-3">{i + 1}.</span>
                              <span className="text-[11px] font-medium text-foreground truncate">{pl.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade Partner Matches */}
      <div>
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            Matched Trade Partners
            <Badge variant="secondary">{matchedPartners.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">
            Teams whose strengths address your needs, and vice versa. Higher match score = better fit.
          </p>
        </div>

        {matchedPartners.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No strong positional matches found.</p>
              <p className="text-xs text-muted-foreground mt-1">This usually means your roster is well-balanced with no clear surpluses or needs.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="matched-partners-list">
            {matchedPartners.map(({ partner, theyHaveYourNeeds, youHaveTheirNeeds, score }) => (
              <Card key={partner.teamId} className="overflow-hidden" data-testid={`partner-match-${partner.teamId}`}>
                <CardContent className="p-0">
                  {/* Partner header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border/20 bg-muted/20">
                    <img
                      src={partner.team.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                      alt={partner.team.owner}
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-muted"
                      onError={(e) => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                      data-testid={`img-partner-avatar-${partner.teamId}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{partner.team.owner}</span>
                        {partner.team.owner !== partner.team.name && (
                          <span className="text-[10px] text-muted-foreground truncate">({partner.team.name})</span>
                        )}
                        <Badge variant="outline" className={cn("text-[9px] flex-shrink-0", getTierColor(partner.tier))}>{partner.tier}</Badge>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {Array.from({ length: score }).map((_, i) => (
                          <div key={i} className="w-2 h-2 rounded-full bg-[#d4af37]" />
                        ))}
                        {Array.from({ length: Math.max(0, 4 - score) }).map((_, i) => (
                          <div key={i} className="w-2 h-2 rounded-full bg-border" />
                        ))}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-0.5">match score</p>
                    </div>
                  </div>

                  {/* Position matches */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/20">
                    {/* They have your needs */}
                    <div className="p-3">
                      <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        They can address your needs
                      </p>
                      {theyHaveYourNeeds.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground italic">No direct positional coverage</p>
                      ) : (
                        <div className="space-y-2">
                          {theyHaveYourNeeds.map(pos => {
                            const pd = partner.positions[pos];
                            const players = [...pd.starterPlayers, ...pd.depthPlayers].slice(0, 3);
                            return (
                              <div key={pos} data-testid={`they-have-${partner.teamId}-${pos}`}>
                                <div className="flex items-center gap-1 mb-0.5">
                                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 ${getPositionColor(pos)}`}>{pos}</Badge>
                                  <span className="text-[9px] text-muted-foreground">surplus · #{pd.rank}</span>
                                </div>
                                {players.map(pl => (
                                  <p key={pl.id} className="text-[11px] text-foreground font-medium pl-1 truncate">{pl.name}</p>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* You have their needs */}
                    <div className="p-3">
                      <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                        <Target className="w-3 h-3" />
                        You can address their needs
                      </p>
                      {youHaveTheirNeeds.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground italic">No direct positional coverage</p>
                      ) : (
                        <div className="space-y-2">
                          {youHaveTheirNeeds.map(pos => {
                            const pd = userProfile.positions[pos];
                            const players = [...pd.starterPlayers, ...pd.depthPlayers].slice(0, 3);
                            return (
                              <div key={pos} data-testid={`you-have-${partner.teamId}-${pos}`}>
                                <div className="flex items-center gap-1 mb-0.5">
                                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 ${getPositionColor(pos)}`}>{pos}</Badge>
                                  <span className="text-[9px] text-muted-foreground">your surplus · #{pd.rank}</span>
                                </div>
                                {players.map(pl => (
                                  <p key={pl.id} className="text-[11px] text-foreground font-medium pl-1 truncate">{pl.name}</p>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Win-Now engine constants & types ────────────────────────────

const SCARCITY_MULT: Record<PosLabel, number> = { QB: 0.8, RB: 1.0, WR: 1.1, TE: 1.5 };

interface WinNowIdea {
  id: string;
  partnerId: string;
  partnerTeam: Team;
  partnerTier: Tier;
  headline: string;
  why: string;
  youGive: { label: string; value: number; pos?: string; team?: string; age?: number; type: "player" | "pick"; sleeperId?: string; pick?: Pick }[];
  youGet:  { label: string; value: number; pos?: string; team?: string; age?: number; type: "player" | "pick"; sleeperId?: string; pick?: Pick }[];
  gainPos: PosLabel;
  dynGive: number;
  dynGet:  number;
  rdGive:  number;
  rdGet:   number;
  userRdDelta:    number; // user's actual lineup win-now change (optimizeLineup-based)
  partnerRdDelta: number; // partner's actual lineup win-now change (optimizeLineup-based)
  score: number;
  scoreLabel: "Elite" | "Strong" | "Moderate";
}

// ─── TradeOpportunities — mode selector ──────────────────────────

function TradeOpportunities({ league, userTeam }: { league: League; userTeam: Team }) {
  const [mode, setMode] = useState<"win-now" | "rebuild">("win-now");

  const modeToggle = (
    <div className="grid flex-shrink-0" style={{ gridTemplateColumns: "1fr 1fr", height: 56, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4, width: 280 }}>
      {([
        { id: "win-now" as const, label: "Win-Now",       desc: "Maximize starters now",  Icon: Zap        },
        { id: "rebuild" as const, label: "Build Dynasty", desc: "Maximize dynasty value",  Icon: TrendingUp },
      ]).map(({ id, label, desc, Icon }) => {
        const isActive = mode === id;
        return (
          <button key={id} onClick={() => setMode(id)} data-testid={`btn-mode-${id}`}
            className="relative flex items-center justify-center gap-2 transition-all duration-200"
            style={{ borderRadius: 12, background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent", border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent", boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none" }}>
            <Icon style={{ width: 14, height: 14, flexShrink: 0, color: isActive ? "#fff" : "rgba(203,213,225,0.45)" }} />
            <div className="flex flex-col items-start">
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1.2, color: isActive ? "#fff" : "rgba(203,213,225,0.45)" }}>{label}</span>
              <span style={{ fontSize: 10, lineHeight: 1.2, color: isActive ? "rgba(255,255,255,0.55)" : "rgba(203,213,225,0.28)" }}>{desc}</span>
            </div>
            {isActive && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }} />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Desktop: title + toggle inline */}
      <div className="hidden md:flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground tracking-tight">Trade Ideas</h3>
          <span className="block h-[3px] w-16 bg-[#d4af37] mt-2.5 rounded-full" />
          <p className="text-sm text-muted-foreground mt-2.5">AI-generated trade proposals to maximize your team's potential</p>
        </div>
        {modeToggle}
      </div>
      {/* Mobile: toggle only */}
      <div className="md:hidden flex justify-center">
        <div className="grid w-[90vw]" style={{ gridTemplateColumns: "1fr 1fr", height: 56, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4 }}>
          {([
            { id: "win-now" as const, label: "Win-Now",       desc: "Maximize starters now",  Icon: Zap        },
            { id: "rebuild" as const, label: "Build Dynasty", desc: "Maximize dynasty value",  Icon: TrendingUp },
          ]).map(({ id, label, desc, Icon }) => {
            const isActive = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)} data-testid={`btn-mode-${id}-mobile`}
                className="relative flex items-center justify-center gap-2 transition-all duration-200"
                style={{ borderRadius: 12, background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent", border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent", boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none" }}>
                <Icon style={{ width: 14, height: 14, flexShrink: 0, color: isActive ? "#fff" : "rgba(203,213,225,0.45)" }} />
                <div className="flex flex-col items-start">
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1.2, color: isActive ? "#fff" : "rgba(203,213,225,0.45)" }}>{label}</span>
                  <span style={{ fontSize: 10, lineHeight: 1.2, color: isActive ? "rgba(255,255,255,0.55)" : "rgba(203,213,225,0.28)" }}>{desc}</span>
                </div>
                {isActive && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }} />}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "win-now" && <WinNowMode  league={league} userTeam={userTeam} />}
      {mode === "rebuild" && <RebuildMode league={league} userTeam={userTeam} />}
    </div>
  );
}

function posTextColor(pos: string): string {
  switch (pos) {
    case "QB":   return "text-red-600 dark:text-red-400";
    case "RB":   return "text-emerald-600 dark:text-emerald-400";
    case "WR":   return "text-blue-600 dark:text-blue-400";
    case "TE":   return "text-yellow-600 dark:text-yellow-400";
    case "PK":
    case "PICK": return "text-purple-600 dark:text-purple-400";
    default:     return "text-muted-foreground";
  }
}

// ─── Shared Win-Now card primitives ────────────────────────────────

function WinNowValStack({ dyn, now }: { dyn: number; now: number }) {
  return (
    <div className="flex flex-col gap-[1px] mt-1 mb-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-muted-foreground/60 w-[46px] flex-shrink-0">Dynasty</span>
        <span className={cn("text-[10px] font-semibold tabular-nums", dyn >= 0 ? "text-emerald-400" : "text-red-400")}>
          {dyn >= 0 ? "+" : "−"}{Math.abs(Math.round(dyn)).toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-muted-foreground/60 w-[46px] flex-shrink-0">Win-Now</span>
        <span className={cn("text-[10px] font-semibold tabular-nums", now >= 0 ? "text-emerald-400" : "text-red-400")}>
          {now >= 0 ? "+" : "−"}{Math.abs(Math.round(now)).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function WinNowAssetPill({ a }: { a: WinNowIdea["youGet"][number] }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[8px] bg-white/[0.04] border border-white/[0.07] px-2.5 py-1.5 mb-[5px] min-w-0">
      {a.type === "player" && a.sleeperId ? (
        <PlayerAvatar id={a.sleeperId} name={a.label} pos={a.pos ?? ""} team={a.team ?? ""} size="sm" compact />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-purple-500/10 border border-purple-500/25 flex items-center justify-center">
          <span className="text-[8px] font-bold text-purple-400 leading-none">PICK</span>
        </div>
      )}
      <div className="min-w-0 flex flex-col gap-[2px]">
        <span className="text-[12px] font-bold truncate leading-tight text-white">{a.label}</span>
        {(a.pos || a.team) && (
          <div className="flex items-center gap-1.5">
            {a.pos && <span className={cn("text-[10px] font-semibold leading-none", posTextColor(a.pos))}>{a.pos}</span>}
            {a.team && a.team !== "FA" && <span className="text-[10px] text-muted-foreground/70 leading-none">{a.team}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

interface WinNowIdeaCardProps {
  idea: WinNowIdea;
  userTeam: Team;
  isSleeperAuthed: boolean;
  onSend: () => void;
  testId?: string;
}

function WinNowIdeaCard({ idea, userTeam, isSleeperAuthed, onSend, testId }: WinNowIdeaCardProps) {
  const uDyn = idea.dynGet - idea.dynGive;
  const uNow = idea.userRdDelta;
  const outerBorder = uNow > 1200
    ? "border-emerald-500/35 shadow-[0_0_12px_rgba(52,211,153,0.08)]"
    : uDyn > 1200
    ? "border-[#d4af37]/35 shadow-[0_0_12px_rgba(212,175,55,0.08)]"
    : "border-border/40";
  const pDyn = idea.dynGive - idea.dynGet;
  const pNow = idea.partnerRdDelta;

  return (
    <div className={cn("relative rounded-lg border bg-[#080f1d] overflow-hidden", outerBorder)} data-testid={testId}>
      <div className="hidden md:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/50 z-0" />
      <div className="hidden md:block absolute inset-y-0 left-[calc(50%-10px)] w-5 bg-black/20 z-0" />
      <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-[#0b1e3d] border border-[#d4af37]/50 items-center justify-center shadow-[0_0_10px_rgba(212,175,55,0.35)]">
        <ArrowRightLeft className="w-3 h-3 text-[#d4af37]" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 divide-border/30">
        <div className="px-[18px] pt-[14px] pb-3 relative z-10">
          <div className="flex items-center gap-1.5">
            {userTeam.avatar ? (
              <img src={userTeam.avatar} alt={userTeam.owner} className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-border/30" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-5 h-5 rounded-full bg-[#0b3a7a] flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-bold text-white">{userTeam.owner.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="text-xs font-semibold truncate">{userTeam.owner}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">receives</span>
          </div>
          <WinNowValStack dyn={uDyn} now={uNow} />
          {idea.youGet.map((a, i) => <WinNowAssetPill key={i} a={a} />)}
        </div>
        <div className="flex md:hidden items-center gap-2 px-4 py-1 bg-black/20">
          <div className="flex-1 h-px bg-border/30" />
          <ArrowRightLeft className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <div className="px-[18px] pt-[14px] pb-3 relative z-10">
          <div className="flex items-center gap-1.5">
            {idea.partnerTeam.avatar ? (
              <img src={idea.partnerTeam.avatar} alt={idea.partnerTeam.owner} className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-border/30" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-bold text-muted-foreground">{idea.partnerTeam.owner.charAt(0)}</span>
              </div>
            )}
            <span className="text-xs font-semibold truncate">{idea.partnerTeam.owner}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">receives</span>
          </div>
          <WinNowValStack dyn={pDyn} now={pNow} />
          {idea.youGive.map((a, i) => <WinNowAssetPill key={i} a={a} />)}
        </div>
      </div>
      <div className="px-[18px] pb-[10px] flex justify-end items-center gap-2 relative z-10">
        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-[#d4af37] hover:text-[#d4af37] hover:bg-[#d4af37]/10 px-2 gap-1">
          <ArrowRightLeft className="w-2.5 h-2.5" />
          Build in Calculator
        </Button>
        {isSleeperAuthed ? (
          <Button size="sm" className="h-6 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-2 gap-1" onClick={onSend}>
            <Send className="w-2.5 h-2.5" />
            Send Trade
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button size="sm" className="h-6 text-[10px] bg-muted text-muted-foreground px-2 gap-1 cursor-not-allowed" disabled>
                  <Send className="w-2.5 h-2.5" />
                  Send Trade
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Connect Sleeper to send offers directly</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Send Trade Modal ──────────────────────────────────────────────

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
    case "today": {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return Math.floor(end.getTime() / 1000);
    }
    case "24h":   return now + 86400;
    case "2d":    return now + 172800;
    case "1w":    return now + 604800;
    case "2w":    return now + 1209600;
    default:      return now + 86400;
  }
}

// ─── Edit-trade state types & helpers ─────────────────────────────────────

interface EditSide { playerIds: Set<string>; picks: Set<string> }
interface EditTradeState { sending: EditSide; receiving: EditSide }

function pickKey(p: Pick): string {
  return `${p.year}-${p.round}-${p.originalRosterId ?? 0}`;
}
function findPickByKey(picks: Pick[], key: string): Pick | undefined {
  return picks.find(p => pickKey(p) === key);
}
function deepCopyEditState(s: EditTradeState): EditTradeState {
  return {
    sending:   { playerIds: new Set(s.sending.playerIds),   picks: new Set(s.sending.picks)   },
    receiving: { playerIds: new Set(s.receiving.playerIds), picks: new Set(s.receiving.picks) },
  };
}
function hydrateFromIdea(idea: WinNowIdea, resolvedPick: Pick | null): EditTradeState {
  const sending: EditSide   = { playerIds: new Set(), picks: new Set() };
  const receiving: EditSide = { playerIds: new Set(), picks: new Set() };
  for (const a of idea.youGive) {
    if (a.type === "player" && a.sleeperId) sending.playerIds.add(a.sleeperId);
    else if (a.type === "pick") { const pk = resolvedPick ?? a.pick; if (pk) sending.picks.add(pickKey(pk)); }
  }
  for (const a of idea.youGet) {
    if (a.type === "player" && a.sleeperId) receiving.playerIds.add(a.sleeperId);
    else if (a.type === "pick" && a.pick) receiving.picks.add(pickKey(a.pick));
  }
  return { sending, receiving };
}

type SendStatus = "idle" | "sending" | "success" | "error";
type DmStatus   = "idle" | "sending" | "sent" | "failed";

interface SendTradeModalProps {
  open: boolean;
  onClose: () => void;
  idea: WinNowIdea | null;
  league: League;
  userTeam: Team;
}

function WinNowSendModal({ open, onClose, idea, league, userTeam }: SendTradeModalProps) {
  const isMobile = useIsMobile();
  const [mobileEditSide, setMobileEditSide] = useState<"sending" | "receiving">("sending");
  const [status, setStatus]           = useState<SendStatus>("idle");
  const [errorMsg, setErrorMsg]       = useState<string>("");
  const [selectedPick, setSelectedPick] = useState<Pick | null>(null);

  const [dmStatus, setDmStatus]       = useState<DmStatus>("idle");
  const [dmError, setDmError]         = useState<string>("");
  const [pendingDm, setPendingDm]     = useState<{ trade: ProposeTradeResult; partnerUserId: string } | null>(null);

  // Per-transaction dedup flags — prevent duplicate sends across retries/rerenders
  const dmTradeCardSentMap = useState(() => new Map<string, boolean>())[0];

  const [expiry, setExpiry] = useState<string>("24h");

  const [activeTab, setActiveTab]           = useState<"review" | "edit" | "messages">("review");
  const [editState, setEditState]           = useState<EditTradeState>(() => ({
    sending:   { playerIds: new Set(), picks: new Set() },
    receiving: { playerIds: new Set(), picks: new Set() },
  }));
  const [savedSnapshot, setSavedSnapshot]   = useState<{ state: EditTradeState; hasCustomEdits: boolean } | null>(null);
  const [hasCustomEdits, setHasCustomEdits] = useState(false);
  const [mySearch, setMySearch]             = useState("");
  const [myPosFilter, setMyPosFilter]       = useState("All");
  const [partnerSearch, setPartnerSearch]   = useState("");
  const [partnerPosFilter, setPartnerPosFilter] = useState("All");

  const [dmId, setDmId]                     = useState<string | null>(null);
  const [dmMessages, setDmMessages]         = useState<SleeperDmMessage[]>([]);
  const [dmLoading, setDmLoading]           = useState(false);
  const [hasUnread, setHasUnread]           = useState(false);
  const [msgInput, setMsgInput]             = useState("");
  const [msgSending, setMsgSending]         = useState(false);
  const msgListRef                          = useRef<HTMLDivElement>(null);

  const hasPick = (idea?.youGive ?? []).some(a => a.type === "pick");

  useEffect(() => {
    if (idea) {
      const pickAsset = idea.youGive.find(a => a.type === "pick" && a.pick);
      let resolvedPick: Pick | null = null;
      if (pickAsset?.pick) {
        const ideaPick = pickAsset.pick;
        const rosterToWinNow = new Map<number, number>();
        for (const team of league.teams) {
          const rid = parseInt(team.id.replace("roster_", ""), 10);
          rosterToWinNow.set(rid, team.metrics.starters);
        }
        const sameRound = userTeam.picks.filter(p => p.round === ideaPick.round);
        const sorted = [...sameRound].sort((a, b) => {
          const aWN = rosterToWinNow.get(a.originalRosterId ?? 0) ?? 0;
          const bWN = rosterToWinNow.get(b.originalRosterId ?? 0) ?? 0;
          return bWN - aWN;
        });
        resolvedPick = sorted[0] ?? ideaPick;
        setSelectedPick(resolvedPick);
      } else {
        setSelectedPick(null);
      }
      setEditState(hydrateFromIdea(idea, resolvedPick));
    }
    setStatus("idle");
    setErrorMsg("");
    setDmStatus("idle");
    setDmError("");
    setPendingDm(null);
    setExpiry("24h");
    setActiveTab("review");
    setHasCustomEdits(false);
    setMobileEditSide("sending");
    setMySearch("");
    setMyPosFilter("All");
    setPartnerSearch("");
    setPartnerPosFilter("All");
    setDmId(null);
    setDmMessages([]);
    setHasUnread(false);
    setMsgInput("");
  }, [idea, league.teams, userTeam.picks]);

  const userRosterId    = parseInt(userTeam.id.replace("roster_", ""), 10);
  const partnerRosterId = idea ? parseInt(idea.partnerTeam.id.replace("roster_", ""), 10) : 0;

  async function sendTradeDm(trade: ProposeTradeResult, partnerUserId: string, isRetry = false) {
    const txId = trade.transaction_id;
    const tradeCardAlreadySent = dmTradeCardSentMap.has(txId);
    // On non-retry skip if trade card already sent
    if (!isRetry && tradeCardAlreadySent) return;

    setDmStatus("sending");
    setDmError("");

    // Use the controlled automatic Dynasty Command link DM helper. Replaces
    // the old free-text trade-card builder while general messaging is paused.
    const session = getSleeperSession();
    const result = await firePostTradeLinkDm({
      recipientUserId: partnerUserId,
      leagueId: trade.league_id,
      senderUserId: session?.user_id ?? null,
      queueType: "trade-finder",
    });
    if (result.status === "sent") {
      dmTradeCardSentMap.set(txId, true);
      setDmStatus("sent");
    } else if (result.status === "skipped") {
      setDmError("Link message skipped to stay within safe messaging limits.");
      setDmStatus("failed");
    } else {
      setDmError("Link message could not be delivered.");
      setDmStatus("failed");
    }
  }

  async function handleConfirm() {
    if (!idea) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      const draftPicks: SleeperTransactionPick[] = [];

      if (hasCustomEdits) {
        for (const id of editState.receiving.playerIds) { adds[id] = userRosterId;    drops[id] = partnerRosterId; }
        for (const id of editState.sending.playerIds)   { adds[id] = partnerRosterId; drops[id] = userRosterId; }
        for (const key of editState.sending.picks) {
          const pk = findPickByKey(userTeam.picks, key);
          if (pk) draftPicks.push({ season: String(pk.year), round: pk.round, roster_id: pk.originalRosterId ?? userRosterId, previous_owner_id: userRosterId, owner_id: partnerRosterId });
        }
        for (const key of editState.receiving.picks) {
          const pk = findPickByKey(idea.partnerTeam.picks, key);
          if (pk) draftPicks.push({ season: String(pk.year), round: pk.round, roster_id: pk.originalRosterId ?? partnerRosterId, previous_owner_id: partnerRosterId, owner_id: userRosterId });
        }
      } else {
        for (const a of idea.youGet) {
          if (a.type === "player" && a.sleeperId) { adds[a.sleeperId] = userRosterId;    drops[a.sleeperId] = partnerRosterId; }
        }
        for (const a of idea.youGive) {
          if (a.type === "player" && a.sleeperId) { adds[a.sleeperId] = partnerRosterId; drops[a.sleeperId] = userRosterId; }
        }
        if (selectedPick) draftPicks.push({
          season: String(selectedPick.year), round: selectedPick.round,
          roster_id: selectedPick.originalRosterId ?? userRosterId,
          previous_owner_id: userRosterId, owner_id: partnerRosterId,
        });
      }

      const expiresAt = computeExpiresAt(expiry);
      const tradeResult = await proposeTrade({ leagueId: league.id, adds, drops, draftPicks, expiresAt });
      setStatus("success");
      setActiveTab("review");

      // Kick off DM after trade succeeds — fire and forget, never blocks trade success
      const partnerUserId = idea.partnerTeam.ownerId;
      if (partnerUserId) {
        setPendingDm({ trade: tradeResult, partnerUserId });
        sendTradeDm(tradeResult, partnerUserId);
      } else {
        setDmStatus("failed");
        setDmError("Partner user ID not available. DM could not be sent.");
      }
    } catch (e: any) {
      if (e instanceof FeatureDisabledError) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setErrorMsg(e?.message || "Trade submission failed.");
    }
  }

  function handleClose() {
    if (status === "sending") return;
    setStatus("idle");
    setErrorMsg("");
    setDmStatus("idle");
    setDmError("");
    setPendingDm(null);
    setActiveTab("review");
    setHasCustomEdits(false);
    onClose();
  }

  async function handleTabChange(newTab: "review" | "edit" | "messages") {
    if (newTab === "edit" && activeTab !== "edit") {
      setSavedSnapshot({ state: deepCopyEditState(editState), hasCustomEdits });
    } else if (activeTab === "edit" && newTab !== "edit") {
      setHasCustomEdits(true);
    }
    setActiveTab(newTab);
    if (newTab === "messages") {
      await loadMessages();
    }
  }

  async function loadMessages() {
    if (!idea) return;
    const partnerUserId = idea.partnerTeam.ownerId;
    if (!partnerUserId) return;
    setDmLoading(true);
    try {
      const dmInfo = await getDmByMembersFull(partnerUserId);
      if (!dmInfo) return;
      setDmId(dmInfo.dm_id);
      const isUnread = !!dmInfo.last_message_id && dmInfo.last_message_id !== dmInfo.last_read_id;
      setHasUnread(isUnread);
      const msgs = await fetchDmMessages(dmInfo.dm_id);
      setDmMessages([...msgs].sort((a, b) => a.created - b.created));
      if (dmInfo.last_message_id) {
        markDmRead(dmInfo.dm_id, dmInfo.last_message_id).catch(() => {});
        setHasUnread(false);
      }
    } catch { /* silent */ } finally {
      setDmLoading(false);
    }
  }

  function cancelEdits() {
    if (savedSnapshot) {
      setEditState(savedSnapshot.state);
      setHasCustomEdits(savedSnapshot.hasCustomEdits);
    }
    setActiveTab("review");
  }

  async function handleSendMessage() {
    if (!dmId || !msgInput.trim() || msgSending) return;
    const text = msgInput.trim();
    const session = getSleeperSession();
    setMsgInput("");
    setMsgSending(true);
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: SleeperDmMessage = {
      message_id: optimisticId,
      parent_id: dmId,
      parent_type: "dm",
      author_id: session?.user_id ?? "",
      author_display_name: session?.display_name ?? "You",
      author_avatar: null,
      author_real_name: null,
      author_is_bot: false,
      author_role_id: null,
      text,
      text_map: null,
      attachment: null,
      created: Date.now(),
      edited: null,
      pinned: false,
      reactions: null,
      user_reactions: null,
      _optimistic: true,
    };
    setDmMessages(prev => [...prev, optimistic]);
    try {
      const sent = await sendDmMessage(dmId, text);
      setDmMessages(prev => prev.map(m => m.message_id === optimisticId ? { ...sent } : m));
    } catch {
      setDmMessages(prev => prev.filter(m => m.message_id !== optimisticId));
    } finally {
      setMsgSending(false);
    }
  }

  // ── Derived: resolved assets for review pane (may be overridden by edit) ──

  const resolvedYouGet = useMemo<WinNowIdea["youGet"]>(() => {
    if (!idea || !hasCustomEdits) return idea?.youGet ?? [];
    const result: WinNowIdea["youGet"] = [];
    for (const id of editState.receiving.playerIds) {
      const p = idea.partnerTeam.roster.find(pl => pl.sleeperId === id);
      if (p) result.push({ label: p.name, value: p.value, pos: p.pos, team: p.team, age: p.age, type: "player", sleeperId: p.sleeperId });
    }
    for (const key of editState.receiving.picks) {
      const pk = findPickByKey(idea.partnerTeam.picks, key);
      if (pk) result.push({ label: formatPickLabel(pk), value: pk.value, type: "pick", pick: pk });
    }
    return result;
  }, [idea, hasCustomEdits, editState]);

  const resolvedYouGive = useMemo<WinNowIdea["youGive"]>(() => {
    if (!idea || !hasCustomEdits) return idea?.youGive ?? [];
    const result: WinNowIdea["youGive"] = [];
    for (const id of editState.sending.playerIds) {
      const p = userTeam.roster.find(pl => pl.sleeperId === id);
      if (p) result.push({ label: p.name, value: p.value, pos: p.pos, team: p.team, age: p.age, type: "player", sleeperId: p.sleeperId });
    }
    for (const key of editState.sending.picks) {
      const pk = findPickByKey(userTeam.picks, key);
      if (pk) result.push({ label: formatPickLabel(pk), value: pk.value, type: "pick", pick: pk });
    }
    return result;
  }, [idea, hasCustomEdits, editState, userTeam]);

  // ── Edit-mode validation ──
  const editSendEmpty = editState.sending.playerIds.size === 0 && editState.sending.picks.size === 0;
  const editRecvEmpty = editState.receiving.playerIds.size === 0 && editState.receiving.picks.size === 0;
  const editBothEmpty = editSendEmpty && editRecvEmpty;

  // ── Computed mode helpers (after all state, before early return) ──
  const editMode   = activeTab === "edit";
  const reviewMode = activeTab === "review";

  // ── Auto-scroll message list to bottom when messages change ──
  useEffect(() => {
    if (activeTab === "messages" && msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
    }
  }, [dmMessages, activeTab]);

  if (!idea) return null;

  const uDyn = idea.dynGet - idea.dynGive;
  const uNow = idea.userRdDelta;
  const pDyn = idea.dynGive - idea.dynGet;
  const pNow = idea.partnerRdDelta;

  // ── sub-components (scoped to this render) ────────────────────────────────

  const ValPills = ({ dyn, now }: { dyn: number; now: number }) => (
    <div className="flex flex-wrap gap-1.5 mt-2">
      <span className={cn(
        "inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-bold border",
        dyn >= 0
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
          : "bg-red-500/15 text-red-400 border-red-500/25"
      )}>
        {dyn >= 0 ? "+" : "−"}{Math.abs(Math.round(dyn)).toLocaleString()} Dynasty
      </span>
      <span className={cn(
        "inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-bold border",
        now >= 0
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
          : "bg-red-500/15 text-red-400 border-red-500/25"
      )}>
        {now >= 0 ? "+" : "−"}{Math.abs(Math.round(now)).toLocaleString()} Win Now
      </span>
    </div>
  );

  const AssetCard = ({ a }: { a: WinNowIdea["youGet"][number] }) => (
    <div className="flex items-center gap-3 w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 mt-2">
      {a.type === "player" && a.sleeperId ? (
        <PlayerAvatar id={a.sleeperId} name={a.label} pos={a.pos ?? ""} team={a.team ?? ""} size="sm" compact />
      ) : (
        <div className="w-10 h-10 rounded-full flex-shrink-0 bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
          <span className="text-[8px] font-bold text-purple-400 leading-none">PICK</span>
        </div>
      )}
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-[13px] font-bold text-white leading-tight">
          {a.type === "pick"
            ? (() => { const pk = a.pick ?? selectedPick; return pk ? `${pk.year} Rd ${pk.round}${pk.projectedRange ? ` (${pk.projectedRange})` : ""}` : a.label; })()
            : a.label}
        </span>
        {(a.pos || a.team) && (
          <div className="flex items-center gap-2">
            {a.pos && <span className={cn("text-[11px] font-semibold leading-none", posTextColor(a.pos))}>{a.pos}</span>}
            {a.team && a.team !== "FA" && <span className="text-[11px] text-white/40 leading-none">{a.team}</span>}
          </div>
        )}
      </div>
    </div>
  );

  const ManagerAvatar = ({ team }: { team: typeof userTeam }) => (
    team.avatar ? (
      <img
        src={team.avatar}
        alt={team.owner}
        className="w-7 h-7 rounded-full object-cover flex-shrink-0 ring-1 ring-white/20"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    ) : (
      <div className="w-7 h-7 rounded-full bg-[#0b3a7a] border border-white/10 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white">{team.owner.charAt(0).toUpperCase()}</span>
      </div>
    )
  );

  const POS_FILTERS = ["All", "QB", "RB", "WR", "TE", "Picks"] as const;

  const RosterEditPanel = ({ teamData, isMyRoster, mobile = false }: { teamData: Team; isMyRoster: boolean; mobile?: boolean }) => {
    const search       = isMyRoster ? mySearch       : partnerSearch;
    const posFilter    = isMyRoster ? myPosFilter    : partnerPosFilter;
    const setSearch    = isMyRoster ? setMySearch    : setPartnerSearch;
    const setPosFilter = isMyRoster ? setMyPosFilter : setPartnerPosFilter;
    const selPlayers   = isMyRoster ? editState.sending.playerIds   : editState.receiving.playerIds;
    const selPicks     = isMyRoster ? editState.sending.picks       : editState.receiving.picks;
    const side         = isMyRoster ? "sending" : "receiving" as const;

    const togglePlayer = (id: string) =>
      setEditState(prev => {
        const ids = new Set(prev[side].playerIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        return { ...prev, [side]: { ...prev[side], playerIds: ids } };
      });

    const togglePick = (key: string) =>
      setEditState(prev => {
        const pks = new Set(prev[side].picks);
        pks.has(key) ? pks.delete(key) : pks.add(key);
        return { ...prev, [side]: { ...prev[side], picks: pks } };
      });

    const filteredPlayers = teamData.roster
      .filter(p => {
        if (!p.sleeperId) return false;
        if (posFilter === "Picks") return false;
        const matchPos    = posFilter === "All" || p.pos === posFilter;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
        return matchPos && matchSearch;
      })
      .sort((a, b) => b.value - a.value);

    const filteredPicks = teamData.picks.filter(p =>
      !search || `${p.year} Rd ${p.round}`.toLowerCase().includes(search.toLowerCase())
    );

    return (
      <div className={cn(
        "flex flex-col bg-white/[0.025] border border-white/[0.08] rounded-xl overflow-hidden",
        mobile && "flex-1 min-h-0"
      )}>
        {/* Panel header */}
        <div className={cn("border-b border-white/[0.06] flex-shrink-0", mobile ? "px-3 pt-3 pb-2.5" : "px-4 pt-4 pb-3")}>
          <div className={cn("flex items-center gap-2", mobile ? "mb-2.5" : "mb-3")}>
            <ManagerAvatar team={teamData} />
            <div className="min-w-0 flex-1">
              <p className={cn("font-bold text-white leading-tight truncate", mobile ? "text-[14px]" : "text-[13px]")}>{teamData.owner}</p>
              {!mobile && (
                <p className="text-[10px] text-white/35 uppercase tracking-widest font-semibold leading-tight mt-0.5">
                  {isMyRoster ? "Sending" : "Receiving"}
                </p>
              )}
            </div>
          </div>
          {/* Search */}
          <div className="relative mb-2">
            <Search className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none", mobile ? "w-4 h-4" : "w-3.5 h-3.5")} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players or picks…"
              data-testid={`search-${isMyRoster ? "my" : "partner"}-roster`}
              className={cn(
                "w-full bg-white/[0.05] border border-white/[0.08] rounded-lg pl-8 pr-3 text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors",
                mobile ? "py-2 text-[13px]" : "py-1.5 text-[12px]"
              )}
            />
          </div>
          {/* Pos filters */}
          <div className={cn("flex flex-wrap", mobile ? "gap-1.5" : "gap-1")}>
            {POS_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                data-testid={`filter-${isMyRoster ? "my" : "partner"}-${f.toLowerCase()}`}
                className={cn(
                  "rounded-full font-semibold border transition-all",
                  mobile ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]",
                  posFilter === f
                    ? "bg-[#0b3a7a]/60 border-blue-500/40 text-blue-300"
                    : "bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/75 hover:border-white/20"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable list */}
        <div
          className={cn("overflow-y-auto px-3 py-2 space-y-0.5", mobile ? "flex-1 min-h-0" : "")}
          style={mobile ? undefined : { maxHeight: 272 }}
        >
          {/* Players */}
          {posFilter !== "Picks" && filteredPlayers.map(p => {
            const isSel = selPlayers.has(p.sleeperId!);
            return (
              <button
                key={p.sleeperId}
                data-testid={`toggle-player-${p.sleeperId}`}
                onClick={() => togglePlayer(p.sleeperId!)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg border transition-all text-left",
                  mobile ? "px-2.5 py-2.5" : "px-2.5 py-2",
                  isSel
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/[0.08]"
                )}
              >
                <PlayerAvatar id={p.sleeperId!} name={p.name} pos={p.pos} team={p.team} size="sm" compact />
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "font-semibold text-white leading-tight",
                    mobile ? "text-[13px] break-words" : "text-[12px] truncate"
                  )}>{p.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={cn(mobile ? "text-[11px]" : "text-[10px]", "font-bold", posTextColor(p.pos))}>{p.pos}</span>
                    {p.team && p.team !== "FA" && <span className={cn(mobile ? "text-[11px]" : "text-[10px]", "text-white/40")}>{p.team}</span>}
                    {p.age > 0 && <span className={cn(mobile ? "text-[11px]" : "text-[10px]", "text-white/30")}>Age {p.age}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={cn(mobile ? "text-[11px]" : "text-[10px]", "text-white/45 tabular-nums font-semibold")}>{Math.round(p.value).toLocaleString()}</span>
                  {isSel && (
                    <span className={cn(
                      "font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 rounded-full whitespace-nowrap",
                      mobile ? "text-[10px] px-2 py-0.5" : "text-[9px] px-1.5 py-px"
                    )}>
                      Included
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {posFilter !== "Picks" && filteredPlayers.length === 0 && (
            <p className="text-[11px] text-white/25 text-center py-5">No players match</p>
          )}

          {/* Picks */}
          {(posFilter === "All" || posFilter === "Picks") && filteredPicks.length > 0 && (
            <div className="pt-1">
              {posFilter === "All" && (
                <p className="text-[9px] text-white/25 uppercase tracking-widest font-semibold px-2 pt-2 pb-1.5">Draft Picks</p>
              )}
              <div className={cn(mobile ? "flex flex-col gap-1.5 px-0.5 pb-1" : "flex flex-wrap gap-1.5 px-1 pb-1")}>
                {filteredPicks.map((p, i) => {
                  const key   = pickKey(p);
                  const isSel = selPicks.has(key);
                  const orig  = league.teams.find(t => parseInt(t.id.replace("roster_", ""), 10) === p.originalRosterId);
                  return (
                    <button
                      key={i}
                      data-testid={`toggle-pick-${key}`}
                      onClick={() => togglePick(key)}
                      className={cn(
                        "rounded-lg border transition-all text-left",
                        mobile
                          ? "flex items-center justify-between gap-2 px-3 py-2.5 w-full"
                          : "flex flex-col items-start px-2.5 py-1.5",
                        isSel
                          ? "bg-emerald-500/10 border-emerald-500/30"
                          : "bg-white/[0.04] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06]"
                      )}
                    >
                      <div className={cn("flex min-w-0", mobile ? "flex-col" : "flex-col items-start")}>
                        <span className={cn(
                          "font-bold leading-tight",
                          mobile ? "text-[13px]" : "text-[11px]",
                          isSel ? "text-emerald-300" : "text-white/85"
                        )}>
                          {p.year} Rd {p.round}
                        </span>
                        {orig && (
                          <span className={cn(
                            "leading-tight mt-0.5",
                            mobile ? "text-[11px]" : "text-[9px]",
                            isSel ? "text-emerald-400/70" : "text-white/35"
                          )}>
                            via {orig.owner}
                          </span>
                        )}
                      </div>
                      {isSel && (
                        <span className={cn(
                          "font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 rounded-full whitespace-nowrap flex-shrink-0",
                          mobile ? "text-[10px] px-2 py-0.5" : "text-[9px] mt-0.5"
                        )}>
                          Included
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {posFilter === "Picks" && filteredPicks.length === 0 && (
            <p className="text-[11px] text-white/25 text-center py-5">No picks available</p>
          )}
        </div>
      </div>
    );
  };

  const TradeDmCard = ({ attachment }: { attachment: Record<string, unknown> }) => {
    let txCount = 0;
    try {
      const data = attachment.data as Record<string, string> | undefined;
      if (data?.transactions_by_roster) {
        txCount = Object.keys(JSON.parse(data.transactions_by_roster)).length;
      }
    } catch { /* show fallback */ }
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.10] text-[12px] text-white/50 italic">
        <ArrowRightLeft className="w-3.5 h-3.5 text-[#d4af37]/60 flex-shrink-0" />
        <span>{txCount > 0 ? `Trade · ${txCount} teams` : "Trade attachment"}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[820px] w-full bg-[#07111f] border border-white/[0.10] p-0 overflow-hidden max-h-[calc(90dvh-72px)] sm:max-h-[90vh] flex flex-col"
        style={isMobile ? {
          position: "fixed",
          top: "env(safe-area-inset-top, 0px)",
          left: 0,
          right: 0,
          bottom: 0,
          width: "100vw",
          maxWidth: "100vw",
          height: "auto",
          maxHeight: "none",
          transform: "none",
          borderRadius: 0,
          borderWidth: 0,
        } : undefined}
      >

        {/* ── Header ── */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Send className="w-4 h-4 text-[#d4af37] flex-shrink-0" />
            <DialogTitle className="text-[15px] font-bold text-white leading-none">
              Confirm Trade Offer
            </DialogTitle>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
            <span className="text-[12px] text-white/50 font-medium">{league.name}</span>
            <span className="text-white/20 text-xs">·</span>
            <span className="text-[12px] text-white/50">
              Partner: <span className="text-white/75 font-semibold">{idea.partnerTeam.owner}</span>
            </span>
          </div>
        </div>

        {/* ── Tab bar ── */}
        {status !== "success" && (
          <div className="flex px-4 sm:px-6 border-b border-white/[0.08] flex-shrink-0 overflow-x-auto scrollbar-hide">
            {([
              { id: "review"   as const, label: "Review Trade" },
              { id: "edit"     as const, label: "Edit Trade"   },
              // Messages tab removed — replies still arrive in Sleeper itself.
              // Tab content paths below remain dead-code-gated in case the
              // tab is reintroduced.
            ]).map(({ id, label, badge }) => (
              <button
                key={id}
                data-testid={`tab-${id}`}
                onClick={() => handleTabChange(id)}
                className={cn(
                  "relative px-3 sm:px-5 py-3 text-[12px] font-semibold border-b-2 transition-all whitespace-nowrap",
                  activeTab === id
                    ? "border-[#d4af37] text-white"
                    : "border-transparent text-white/40 hover:text-white/70"
                )}
              >
                {label}
                {badge && (
                  <span className="absolute top-2.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Edit mode on mobile: segmented switch + single side panel (no outer scroll) ── */}
        {activeTab !== "messages" && editMode && isMobile && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-3 pt-3 pb-3">
            {/* Segmented side switch */}
            <div className="flex-shrink-0 grid grid-cols-2 gap-1.5 p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl mb-3">
              {([
                { id: "sending"   as const, label: "Sending",   count: editState.sending.playerIds.size + editState.sending.picks.size },
                { id: "receiving" as const, label: "Receiving", count: editState.receiving.playerIds.size + editState.receiving.picks.size },
              ]).map(({ id, label, count }) => (
                <button
                  key={id}
                  onClick={() => setMobileEditSide(id)}
                  data-testid={`mobile-side-${id}`}
                  className={cn(
                    "relative flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all",
                    mobileEditSide === id
                      ? "bg-[#0b3a7a] text-white shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
                      : "bg-transparent text-white/55"
                  )}
                >
                  {label}
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums",
                    mobileEditSide === id
                      ? "bg-white/20 text-white"
                      : "bg-white/10 text-white/70"
                  )}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Active side's panel — only this scrolls */}
            {mobileEditSide === "sending" ? (
              <RosterEditPanel teamData={userTeam}         isMyRoster={true}  mobile />
            ) : (
              <RosterEditPanel teamData={idea.partnerTeam} isMyRoster={false} mobile />
            )}
          </div>
        )}

        {/* ── Review / Edit content (unified scrollable body — desktop edit + all review) ── */}
        {activeTab !== "messages" && !(editMode && isMobile) && (
          <div className="flex-1 overflow-y-auto min-h-0">

            {/* Trade columns / Edit panel */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-5">
              {editMode ? (
                <>
                  <RosterEditPanel teamData={userTeam}         isMyRoster={true}  />
                  <RosterEditPanel teamData={idea.partnerTeam} isMyRoster={false} />
                </>
              ) : (
                <>
                  {/* You receive */}
                  <div className="bg-white/[0.025] border border-white/[0.08] rounded-xl p-4">
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <ManagerAvatar team={userTeam} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-white leading-tight break-words">{userTeam.owner}</p>
                        <p className="text-[10px] text-white/35 uppercase tracking-widest font-semibold leading-tight mt-0.5">Receives</p>
                      </div>
                    </div>
                    {!hasCustomEdits && <ValPills dyn={uDyn} now={uNow} />}
                    <div className="mt-1">
                      {resolvedYouGet.map((a, i) => <AssetCard key={i} a={a} />)}
                    </div>
                  </div>

                  {/* Partner receives */}
                  <div className="bg-white/[0.025] border border-white/[0.08] rounded-xl p-4">
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <ManagerAvatar team={idea.partnerTeam} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-white leading-tight break-words">{idea.partnerTeam.owner}</p>
                        <p className="text-[10px] text-white/35 uppercase tracking-widest font-semibold leading-tight mt-0.5">Receives</p>
                      </div>
                    </div>
                    {!hasCustomEdits && <ValPills dyn={pDyn} now={pNow} />}
                    <div className="mt-1">
                      {resolvedYouGive.map((a, i) => <AssetCard key={i} a={a} />)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Pick selector */}
            {reviewMode && hasPick && status === "idle" && (
              <div className="px-3 sm:px-6 pb-4 sm:pb-5 border-t border-white/[0.06] pt-4">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mb-3">Choose pick to include</p>
                <div className="flex flex-wrap gap-2">
                  {userTeam.picks.filter(p => {
                    const ideaPick = idea.youGive.find(a => a.type === "pick" && a.pick)?.pick;
                    return ideaPick ? p.round === ideaPick.round : true;
                  }).map((p, i) => {
                    const origTeam = league.teams.find(t => parseInt(t.id.replace("roster_", ""), 10) === p.originalRosterId);
                    const isSelected =
                      selectedPick?.year === p.year &&
                      selectedPick?.round === p.round &&
                      selectedPick?.originalRosterId === p.originalRosterId;
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedPick(p)}
                        className={cn(
                          "flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left",
                          isSelected
                            ? "bg-purple-500/20 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                            : "bg-white/[0.04] border-white/[0.09] hover:border-purple-500/40 hover:bg-white/[0.06]"
                        )}
                      >
                        <span className={cn("text-[11px] font-bold leading-tight", isSelected ? "text-purple-300" : "text-white/85")}>
                          {p.year} Rd {p.round}
                        </span>
                        {origTeam && (
                          <span className={cn("text-[10px] leading-tight mt-0.5", isSelected ? "text-purple-400/70" : "text-white/35")}>
                            via {origTeam.owner}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Status banners */}
            <div className={cn("px-3 sm:px-6 space-y-2 empty:hidden", !reviewMode && "hidden")}>
              {status === "success" && dmStatus === "idle" && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="text-[12px] text-emerald-300 font-medium">Trade sent.</span>
                </div>
              )}
              {status === "success" && dmStatus === "sending" && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
                  <Loader2 className="w-4 h-4 text-emerald-400 flex-shrink-0 animate-spin" />
                  <span className="text-[12px] text-emerald-300 font-medium">Trade sent. Sending DM…</span>
                </div>
              )}
              {status === "success" && dmStatus === "sent" && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="text-[12px] text-emerald-300 font-medium">Trade sent and DM delivered.</span>
                </div>
              )}
              {status === "success" && dmStatus === "failed" && (
                <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/25 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-px" />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[12px] text-yellow-300 font-medium leading-snug">Trade sent, but DM could not be sent.</span>
                    {dmError && <span className="text-[11px] text-yellow-400/70 leading-snug">{dmError}</span>}
                    {pendingDm && (
                      <button data-testid="btn-retry-trade-dm"
                        onClick={() => sendTradeDm(pendingDm.trade, pendingDm.partnerUserId, true)}
                        className="mt-0.5 self-start text-[11px] font-semibold text-yellow-300 hover:text-yellow-100 underline underline-offset-2 transition-colors">
                        Send DM again
                      </button>
                    )}
                  </div>
                </div>
              )}
              {status === "error" && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/25 px-4 py-3">
                  <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-px" />
                  <span className="text-[12px] text-red-300 leading-snug">{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Expiry selector */}
            {reviewMode && status !== "success" && (
              <div className="px-3 sm:px-6 pb-4 sm:pb-5 border-t border-white/[0.06] pt-4">
                <div className="flex items-center justify-between mb-2.5 flex-wrap gap-1">
                  <p className="text-[11px] text-white/40 uppercase tracking-widest font-semibold">Offer Expires In</p>
                  <p className="text-[10px] text-white/25 italic hidden sm:block">
                    Sleeper will automatically expire the offer after this time.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_OPTIONS.map(opt => {
                    const isActive = expiry === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setExpiry(opt.value)}
                        data-testid={`expiry-opt-${opt.value}`}
                        disabled={status === "sending"}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all",
                          isActive
                            ? "bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37]"
                            : "bg-white/[0.04] border-white/[0.09] text-white/50 hover:border-white/25 hover:text-white/75"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── Messages view ── */}
        {activeTab === "messages" && !isGeneralMessagingEnabled() && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0 px-3 sm:px-6 pt-4">
            <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-6 text-center mt-4">
              <div className="text-[12px] font-semibold text-white/75 mb-1">Messaging temporarily disabled</div>
              <div className="text-[11px] text-white/45 leading-relaxed">
                Dynasty Command's messaging UI is paused right now. Your trade was sent through Sleeper normally — replies are still visible in the Sleeper app.
              </div>
            </div>
          </div>
        )}
        {activeTab === "messages" && isGeneralMessagingEnabled() && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0 px-3 sm:px-6 pt-4">
            {dmLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-white/30" />
              </div>
            ) : !dmId ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[13px] text-white/30">
                  {idea.partnerTeam.ownerId ? "No message history with this partner yet." : "Partner user ID unavailable."}
                </p>
              </div>
            ) : dmMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[13px] text-white/30 italic">No messages yet. Say something!</p>
              </div>
            ) : (
              <div ref={msgListRef} className="flex-1 overflow-y-auto space-y-2.5 pb-2 pr-1">
                {dmMessages.map(msg => {
                  const myUserId = getSleeperSession()?.user_id ?? "";
                  const isMe = msg.author_id === myUserId;
                  const att = msg.attachment as Record<string, unknown> | null;
                  const isTradeCard = att?.type === "trade_dm";
                  return (
                    <div key={msg.message_id} className={cn("flex items-end gap-2", isMe && "flex-row-reverse")}>
                      {msg.author_avatar ? (
                        <img src={`https://sleepercdn.com/avatars/thumbs/${msg.author_avatar}`} alt=""
                          className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className={cn(
                          "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white/60",
                          isMe ? "bg-[#0b3a7a]" : "bg-white/[0.10]"
                        )}>
                          {(msg.author_display_name ?? "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={cn("max-w-[68%] flex flex-col gap-0.5", isMe && "items-end")}>
                        {isTradeCard ? (
                          <TradeDmCard attachment={att!} />
                        ) : (
                          <div className={cn(
                            "px-3 py-2 rounded-2xl text-[13px] leading-relaxed break-words",
                            isMe
                              ? "bg-[#0b3a7a] text-white rounded-br-sm"
                              : "bg-white/[0.07] text-white/85 rounded-bl-sm",
                            msg._optimistic && "opacity-60"
                          )}>
                            {msg.text || <span className="text-white/30 italic">attachment</span>}
                          </div>
                        )}
                        <span className="text-[10px] text-white/20 px-1 tabular-nums">
                          {msg.created
                            ? new Date(msg.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Compose bar */}
            <div className="flex gap-2 flex-shrink-0 py-4 border-t border-white/[0.06] mt-2">
              <input
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                }}
                placeholder={dmId ? "Message partner…" : "Loading…"}
                disabled={!dmId || msgSending}
                data-testid="input-message"
                className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/20 disabled:opacity-40 transition-colors"
              />
              <Button
                data-testid="btn-send-message"
                onClick={handleSendMessage}
                disabled={!msgInput.trim() || !dmId || msgSending}
                className="h-10 px-4 bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white"
              >
                {msgSending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}

        {/* ── Footer (sticky on mobile via flex-col, safe-area aware) ── */}
        <div
          className={cn(
            "flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-5 border-t border-white/[0.08] flex-shrink-0 mt-auto flex-wrap bg-[#07111f]",
            editMode ? "justify-between" : "justify-end"
          )}
          style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" } : undefined}
        >
          {editMode ? (
            <>
              {(editBothEmpty || editSendEmpty || editRecvEmpty) && (
                <span className={cn(
                  "text-[11px] text-yellow-400/70 px-2 text-center",
                  isMobile ? "basis-full order-first pb-1" : "flex-1"
                )}>
                  {editBothEmpty ? "Add at least one asset to each side." : "One side has no assets. Continue?"}
                </span>
              )}
              <Button
                variant="ghost"
                data-testid="btn-cancel-edits"
                className={cn(
                  "font-semibold text-white/55 hover:text-white/85 border border-white/[0.10] hover:border-white/25 bg-white/[0.03]",
                  isMobile ? "flex-1 h-11 text-[14px]" : "h-10 px-5 text-[13px]"
                )}
                onClick={cancelEdits}
              >
                {isMobile ? "Cancel" : "Cancel Edits"}
              </Button>
              <Button
                data-testid="btn-apply-edits"
                className={cn(
                  "font-bold bg-[#0b3a7a] hover:bg-[#0d4499] text-white border border-[#0b3a7a]/80 transition-all disabled:opacity-40 shadow-[0_0_18px_rgba(11,58,122,0.35)]",
                  isMobile ? "flex-[2] h-11 text-[14px]" : "h-10 px-6 text-[13px]"
                )}
                onClick={() => handleTabChange("review")}
                disabled={editBothEmpty}
              >
                Apply Changes ›
              </Button>
            </>
          ) : status === "success" ? (
            <Button
              variant="outline"
              className={cn(
                "font-semibold border-white/20 text-white/70 hover:text-white hover:border-white/40 bg-transparent",
                isMobile ? "w-full h-11 text-[14px]" : "h-10 px-5 text-[13px]"
              )}
              onClick={handleClose}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                className={cn(
                  "font-semibold text-white/55 hover:text-white/85 border border-white/[0.10] hover:border-white/25 bg-white/[0.03]",
                  isMobile ? "flex-1 h-11 text-[14px]" : "h-10 px-5 text-[13px]"
                )}
                onClick={handleClose}
                disabled={status === "sending"}
              >
                Cancel
              </Button>
              <Button
                className={cn(
                  "font-bold bg-emerald-600 hover:bg-emerald-500 text-white gap-2 shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:shadow-[0_0_24px_rgba(16,185,129,0.35)] transition-all",
                  isMobile ? "flex-[2] h-11 text-[14px]" : "h-10 px-6 text-[13px]"
                )}
                onClick={handleConfirm}
                disabled={status === "sending"}
                data-testid="btn-confirm-send-trade"
              >
                {status === "sending" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                ) : (
                  <><Send className="w-4 h-4" />{isMobile ? "Confirm Trade" : "Confirm Send Trade"}</>
                )}
              </Button>
            </>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

// ─── Win-Now Mode ─────────────────────────────────────────────────

function WinNowMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());
  const [sendModal, setSendModal] = useState<{ open: boolean; idea: WinNowIdea | null }>({ open: false, idea: null });
  const sleeperSession = getSleeperSession();
  const isSleeperAuthed = !!sleeperSession?.token;

  const togglePos = (pos: string) => setExpandedPositions(prev => {
    const next = new Set(prev);
    next.has(pos) ? next.delete(pos) : next.add(pos);
    return next;
  });

  // Step 1 — Positional urgency: gap vs league avg × scarcity multiplier
  const { leagueAvgRd, myStarterRd, urgency, sortedNeeds } = useMemo(() => {
    const n = league.teams.length;
    const leagueAvgRd: Record<string, number> = {};
    const myStarterRd: Record<string, number> = {};
    POSITIONS.forEach(pos => {
      const vals = league.teams.map(t =>
        t.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0)
      );
      leagueAvgRd[pos]  = vals.reduce((s, v) => s + v, 0) / Math.max(n, 1);
      myStarterRd[pos]  = userTeam.roster
        .filter(p => p.pos === pos && p.starter)
        .reduce((s, p) => s + getRedraftValue(p), 0);
    });
    const urgency: Record<string, number> = {};
    POSITIONS.forEach(pos => {
      urgency[pos] = Math.max(0, leagueAvgRd[pos] - myStarterRd[pos]) * SCARCITY_MULT[pos];
    });
    const sortedNeeds = [...POSITIONS]
      .filter(p => urgency[p] > 0)
      .sort((a, b) => urgency[b] - urgency[a]);
    return { leagueAvgRd, myStarterRd, urgency, sortedNeeds };
  }, [league, userTeam, getRedraftValue]);

  // Step 2 — Dynasty Efficiency Scores: dynasty value ÷ starter impact loss
  const sellCandidates = useMemo(() => {
    return userTeam.roster
      .map(player => {
        const dynVal = getPlayerValue(player);
        const rdVal  = getRedraftValue(player);
        const posRoster = [...userTeam.roster]
          .filter(p => p.pos === player.pos)
          .map(p => ({ id: p.sleeperId ?? p.id, rdv: getRedraftValue(p) }))
          .sort((a, b) => b.rdv - a.rdv);
        const idx         = posRoster.findIndex(p => p.id === (player.sleeperId ?? player.id));
        const replacement = posRoster[idx + 1];
        const starterCost = player.starter
          ? Math.max(0, rdVal - (replacement ? replacement.rdv : 0))
          : 0;
        const effScore = dynVal / Math.max(starterCost, 60);
        return { player, dynVal, rdVal, starterCost, effScore };
      })
      .filter(c => c.dynVal > 600 && !sortedNeeds.includes(c.player.pos as PosLabel))
      .sort((a, b) => b.effScore - a.effScore)
      .slice(0, 6);
  }, [userTeam, getPlayerValue, getRedraftValue, sortedNeeds]);

  // Step 3 — Per-team redraft positional ranks
  const posRdRanks = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    POSITIONS.forEach(pos => {
      [...league.teams]
        .sort((a, b) =>
          b.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0) -
          a.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0)
        )
        .forEach((t, i) => {
          if (!map.has(t.id)) map.set(t.id, {});
          map.get(t.id)![pos] = i + 1;
        });
    });
    return map;
  }, [league, getRedraftValue]);

  // Step 4 — Generate Win-Now trade ideas (max 18% dynasty delta)
  const tradeIdeas = useMemo<WinNowIdea[]>(() => {
    if (sortedNeeds.length === 0 || sellCandidates.length === 0) return [];
    const leagueSize = league.teams.length;
    const ideas: WinNowIdea[] = [];
    const myPicks = userTeam.picks
      .map(p => ({ ...p, val: getPickValue(p) }))
      .sort((a, b) => b.val - a.val);

    const rosterPositions = league.rosterPositions ?? [];
    const userPreRd = optimizeLineup(userTeam.roster, rosterPositions)
      .filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);

    for (const partner of league.teams) {
      if (partner.id === userTeam.id) continue;
      const pRanks = posRdRanks.get(partner.id) ?? {};

      for (const needPos of sortedNeeds.slice(0, 3)) {
        // Partner must be strong at my need position (top 40%)
        if ((pRanks[needPos] ?? leagueSize) > Math.ceil(leagueSize * 0.4)) continue;

        const targets = [...partner.roster]
          .filter(p => p.pos === needPos)
          .map(p => ({ ...p, rdv: getRedraftValue(p), dynv: getPlayerValue(p) }))
          .sort((a, b) => b.rdv - a.rdv)
          .slice(0, 3);

        for (const target of targets) {
          if (target.rdv < 600) continue;

          // 1-for-1 player swap
          for (const chip of sellCandidates.slice(0, 4)) {
            if (chip.player.pos === needPos) continue;
            // Redraft balance filter (same logic as trade calculator)
            const rdDiff = Math.abs(chip.rdVal - target.rdv) / Math.max(chip.rdVal, target.rdv, 1);
            if (rdDiff > 0.28) continue;
            // Dynasty fairness: user overpays by at most 18% (trade calculator formula)
            const dynGive = chip.dynVal;
            const dynGet  = target.dynv;
            const dynOverpay = (dynGive - dynGet) / Math.max(dynGive, dynGet, 1);
            if (dynOverpay > 0.18) continue;

            const rdGive = chip.rdVal;
            const rdGet  = target.rdv;
            const rdDelta    = rdGet - rdGive;
            const score      = (Math.max(rdDelta, 1) * urgency[needPos]) / Math.max(dynOverpay * 600 + 1, 1);
            const scoreLabel = score > 1800 ? "Elite" : score > 600 ? "Strong" : "Moderate";

            // User's actual lineup win-now change: they lose chip, gain target
            const userPost1   = [...userTeam.roster.filter(p => (p.sleeperId ?? p.id) !== (chip.player.sleeperId ?? chip.player.id)), target];
            const userPostRd1 = optimizeLineup(userPost1, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const userRdDelta1 = userPostRd1 - userPreRd;

            // Partner's actual lineup win-now change: they lose target, gain chip
            const partnerPreRd  = optimizeLineup(partner.roster, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerPost1  = [...partner.roster.filter(p => (p.sleeperId ?? p.id) !== (target.sleeperId ?? target.id)), chip.player];
            const partnerPostRd = optimizeLineup(partnerPost1, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerRdDelta = partnerPostRd - partnerPreRd;
            // Filter out trades where partner loses on both axes and the combined loss is severe
            const _pDyn1 = dynGive - dynGet;
            if (_pDyn1 < 0 && partnerRdDelta < 0 && _pDyn1 + partnerRdDelta <= -3000) continue;

            ideas.push({
              id:          `wn-${partner.id}-${needPos}-${chip.player.sleeperId ?? chip.player.id}`,
              partnerId:   partner.id,
              partnerTeam: partner,
              partnerTier: tierMap.get(partner.id)?.tier ?? "Balanced",
              headline:    `Upgrade ${needPos} using ${chip.player.pos} surplus`,
              why:         `${chip.player.name} is an ideal chip: strong dynasty value with low lineup impact. Directly addresses your ${needPos} gap.`,
              youGive: [{ label: chip.player.name, value: chip.dynVal, pos: chip.player.pos, team: chip.player.team, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age }],
              youGet:  [{ label: target.name,      value: target.dynv, pos: target.pos,      team: target.team,       type: "player", sleeperId: target.sleeperId,      age: target.age      }],
              gainPos: needPos as PosLabel, dynGive, dynGet, rdGive, rdGet, userRdDelta: userRdDelta1, partnerRdDelta, score, scoreLabel: scoreLabel as WinNowIdea["scoreLabel"],
            });
          }

          // Player + pick to balance value gap
          for (const chip of sellCandidates.slice(0, 3)) {
            if (chip.player.pos === needPos || !myPicks[0]) continue;
            const pickVal = myPicks[0].val;
            // Dynasty fairness using trade calculator formula
            const dynGive    = chip.dynVal + pickVal;
            const dynGet     = target.dynv;
            const dynOverpay = (dynGive - dynGet) / Math.max(dynGive, dynGet, 1);
            if (dynOverpay > 0.18 || dynOverpay < -0.25) continue;

            const rdGive  = chip.rdVal; // picks have no current-season redraft value
            const rdGet   = target.rdv;
            const rdDelta    = rdGet - rdGive;
            const score      = (Math.max(rdDelta, 1) * urgency[needPos]) / Math.max(dynOverpay * 600 + 1, 1);
            const scoreLabel = score > 1800 ? "Elite" : score > 600 ? "Strong" : "Moderate";
            const pickLabel  = `${myPicks[0].year} Rd ${myPicks[0].round} (${myPicks[0].projectedRange ?? "Mid"})`;

            // User's actual lineup win-now change: they lose chip, gain target
            const userPost2   = [...userTeam.roster.filter(p => (p.sleeperId ?? p.id) !== (chip.player.sleeperId ?? chip.player.id)), target];
            const userPostRd2 = optimizeLineup(userPost2, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const userRdDelta2 = userPostRd2 - userPreRd;

            // Partner's actual lineup win-now change: they lose target, gain chip (pick adds no current rdv)
            const partnerPreRd2  = optimizeLineup(partner.roster, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerPost2   = [...partner.roster.filter(p => (p.sleeperId ?? p.id) !== (target.sleeperId ?? target.id)), chip.player];
            const partnerPostRd2 = optimizeLineup(partnerPost2, rosterPositions).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerRdDelta2 = partnerPostRd2 - partnerPreRd2;
            // Filter out trades where partner loses on both axes and the combined loss is severe
            const _pDyn2 = dynGive - dynGet;
            if (_pDyn2 < 0 && partnerRdDelta2 < 0 && _pDyn2 + partnerRdDelta2 <= -3000) continue;

            ideas.push({
              id:          `wn-pick-${partner.id}-${needPos}-${chip.player.sleeperId ?? chip.player.id}`,
              partnerId:   partner.id,
              partnerTeam: partner,
              partnerTier: tierMap.get(partner.id)?.tier ?? "Balanced",
              headline:    `Upgrade ${needPos} via ${chip.player.pos} + pick`,
              why:         `${chip.player.name} + a pick bridges the value gap while keeping dynasty cost low. Your ${needPos} weakness is your biggest weekly liability.`,
              youGive: [
                { label: chip.player.name, value: chip.dynVal, pos: chip.player.pos, team: chip.player.team, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age },
                { label: pickLabel,        value: pickVal,                                                    type: "pick", pick: myPicks[0]                                       },
              ],
              youGet: [{ label: target.name, value: target.dynv, pos: target.pos, team: target.team, type: "player", sleeperId: target.sleeperId, age: target.age }],
              gainPos: needPos as PosLabel, dynGive, dynGet, rdGive, rdGet, userRdDelta: userRdDelta2, partnerRdDelta: partnerRdDelta2, score, scoreLabel: scoreLabel as WinNowIdea["scoreLabel"],
            });
          }
        }
      }
    }

    const seen = new Set<string>();
    return ideas
      .filter(t => {
        const key = t.youGive.map(a => a.label).join(",") + "→" + t.youGet.map(a => a.label).join(",");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }, [league, userTeam, sortedNeeds, sellCandidates, urgency, posRdRanks, tierMap, getPlayerValue, getRedraftValue, getPickValue]);

  // Group ideas by upgrade position, ordered by positional urgency
  const byPosition = useMemo(() => {
    const map = new Map<string, WinNowIdea[]>();
    tradeIdeas.forEach(idea => {
      if (!map.has(idea.gainPos)) map.set(idea.gainPos, []);
      map.get(idea.gainPos)!.push(idea);
    });
    // Order groups by sortedNeeds priority (most urgent first), then any extras
    const ordered: string[] = [];
    sortedNeeds.forEach(pos => { if (map.has(pos)) ordered.push(pos); });
    map.forEach((_, pos) => { if (!ordered.includes(pos)) ordered.push(pos); });
    return ordered.map(pos => ({
      pos,
      ideas: map.get(pos)!,
      needRank: sortedNeeds.indexOf(pos),
    }));
  }, [tradeIdeas, sortedNeeds]);

  const noNeeds = sortedNeeds.length === 0;

  return (
    <div className="space-y-5">

      {/* ── Best Chips to Move ── */}
      {sellCandidates.length > 0 && (
        <Card className="p-5" data-testid="card-wn-chips">
          <div className="mb-4">
            <h4 className="text-sm font-bold">Best Chips to Move</h4>
            <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              High dynasty value ÷ low starter impact (ideal trade currency for win-now moves)
            </p>
          </div>
          <div className="space-y-0">
            {sellCandidates.map((c, i) => {
              const sid = c.player.sleeperId ?? c.player.id;
              return (
                <div key={sid} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0" data-testid={`chip-row-${sid}`}>
                  <span className="text-xs text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <PlayerAvatar id={sid} name={c.player.name} pos={c.player.pos} team={c.player.team ?? ""} size="sm" />
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] flex-shrink-0",
                      c.player.starter
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    )}
                  >
                    {c.player.starter ? "Starter" : "Bench"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Win-Now Trade Ideas ── */}
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            Win-Now Trade Ideas
            <Badge variant="secondary">{tradeIdeas.length}</Badge>
          </h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Ranked by Win-Now Score = (starter gain × urgency) ÷ dynasty cost. Max 18% dynasty delta.
          </p>
        </div>

        {tradeIdeas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {noNeeds
                  ? "Your starters are balanced. No urgent win-now moves detected."
                  : "No win-now trades found within the 18% dynasty delta constraint."}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Try loading a different league or checking back after roster moves.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="wn-position-groups">
            {byPosition.map(({ pos, ideas, needRank }) => {
              const isOpen = expandedPositions.has(pos);
              return (
              <Card key={pos} className="overflow-hidden" data-testid={`wn-pos-group-${pos.toLowerCase()}`}>
                <CardContent className="p-0">
                {/* Position group header — clickable toggle */}
                <button
                  className="w-full flex items-center gap-2 px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => togglePos(pos)}
                  data-testid={`btn-wn-pos-${pos.toLowerCase()}`}
                >
                  <Badge variant="outline" className={cn("text-[10px] font-bold px-1.5 flex-shrink-0", getPositionColor(pos))}>{pos}</Badge>
                  <span className="text-sm font-semibold">{pos} Upgrades</span>
                  <span className={cn("text-[10px] font-medium",
                    needRank === 0 ? "text-red-500 dark:text-red-400" :
                    needRank === 1 ? "text-amber-500 dark:text-amber-400" :
                    "text-muted-foreground"
                  )}>
                    · {needRank === 0 ? "Primary Need" : needRank === 1 ? "Secondary Need" : "Tertiary Need"}
                  </span>
                  <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{ideas.length} idea{ideas.length !== 1 ? "s" : ""}</Badge>
                    <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  </div>
                </button>

                {isOpen && (
                <div className="border-t border-border/30 px-5 py-4 space-y-3">
                  {ideas.map((idea: WinNowIdea, idx: number) => {
                      const uDyn = idea.dynGet - idea.dynGive;
                      const uNow = idea.userRdDelta;
                      const outerBorder = uNow > 1200
                        ? "border-emerald-500/35 shadow-[0_0_12px_rgba(52,211,153,0.08)]"
                        : uDyn > 1200
                        ? "border-[#d4af37]/35 shadow-[0_0_12px_rgba(212,175,55,0.08)]"
                        : "border-border/40";
                      const pDyn = idea.dynGive - idea.dynGet;
                      const pNow = idea.partnerRdDelta;

                      const ValStack = ({ dyn, now }: { dyn: number; now: number }) => (
                        <div className="flex flex-col gap-[1px] mt-1 mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-muted-foreground/60 w-[46px] flex-shrink-0">Dynasty</span>
                            <span className={cn("text-[10px] font-semibold tabular-nums", dyn >= 0 ? "text-emerald-400" : "text-red-400")}>
                              {dyn >= 0 ? "+" : "−"}{Math.abs(Math.round(dyn)).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-muted-foreground/60 w-[46px] flex-shrink-0">Win-Now</span>
                            <span className={cn("text-[10px] font-semibold tabular-nums", now >= 0 ? "text-emerald-400" : "text-red-400")}>
                              {now >= 0 ? "+" : "−"}{Math.abs(Math.round(now)).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );

                      const AssetPill = ({ a }: { a: WinNowIdea["youGet"][number] }) => (
                        <div className="flex items-center gap-2.5 rounded-[8px] bg-white/[0.04] border border-white/[0.07] px-2.5 py-1.5 mb-[5px] min-w-0">
                          {a.type === "player" && a.sleeperId ? (
                            <PlayerAvatar id={a.sleeperId} name={a.label} pos={a.pos ?? ""} team={a.team ?? ""} size="sm" compact />
                          ) : (
                            <div className="w-9 h-9 rounded-full flex-shrink-0 bg-purple-500/10 border border-purple-500/25 flex items-center justify-center">
                              <span className="text-[8px] font-bold text-purple-400 leading-none">PICK</span>
                            </div>
                          )}
                          <div className="min-w-0 flex flex-col gap-[2px]">
                            <span className="text-[12px] font-bold truncate leading-tight text-white">{a.label}</span>
                            {(a.pos || a.team) && (
                              <div className="flex items-center gap-1.5">
                                {a.pos && <span className={cn("text-[10px] font-semibold leading-none", posTextColor(a.pos))}>{a.pos}</span>}
                                {a.team && a.team !== "FA" && <span className="text-[10px] text-muted-foreground/70 leading-none">{a.team}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );

                      return (
                        <div key={idea.id} className={cn("relative rounded-lg border bg-[#080f1d] overflow-hidden", outerBorder)} data-testid={`wn-idea-${pos.toLowerCase()}-${idx}`}>

                          {/* Center divider: vertical line + darker strip + glowing icon */}
                          <div className="hidden md:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/50 z-0" />
                          <div className="hidden md:block absolute inset-y-0 left-[calc(50%-10px)] w-5 bg-black/20 z-0" />
                          <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-[#0b1e3d] border border-[#d4af37]/50 items-center justify-center shadow-[0_0_10px_rgba(212,175,55,0.35)]">
                            <ArrowRightLeft className="w-3 h-3 text-[#d4af37]" />
                          </div>

                          {/* Two-column grid — no divide-x, center handled above */}
                          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 divide-border/30">

                            {/* ── You receive ── */}
                            <div className="px-[18px] pt-[14px] pb-3 relative z-10">
                              <div className="flex items-center gap-1.5">
                                {userTeam.avatar ? (
                                  <img
                                    src={userTeam.avatar}
                                    alt={userTeam.owner}
                                    className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-border/30"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-[#0b3a7a] flex items-center justify-center flex-shrink-0">
                                    <span className="text-[9px] font-bold text-white">{userTeam.owner.charAt(0).toUpperCase()}</span>
                                  </div>
                                )}
                                <span className="text-xs font-semibold truncate">{userTeam.owner}</span>
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">receives</span>
                              </div>
                              <ValStack dyn={uDyn} now={uNow} />
                              {idea.youGet.map((a: WinNowIdea["youGet"][number], i: number) => <AssetPill key={i} a={a} />)}
                            </div>

                            {/* Mobile trade divider */}
                            <div className="flex md:hidden items-center gap-2 px-4 py-1 bg-black/20">
                              <div className="flex-1 h-px bg-border/30" />
                              <ArrowRightLeft className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 h-px bg-border/30" />
                            </div>

                            {/* ── Partner receives ── */}
                            <div className="px-[18px] pt-[14px] pb-3 relative z-10">
                              <div className="flex items-center gap-1.5">
                                {idea.partnerTeam.avatar ? (
                                  <img src={idea.partnerTeam.avatar} alt={idea.partnerTeam.owner} className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-border/30" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <span className="text-[9px] font-bold text-muted-foreground">{idea.partnerTeam.owner.charAt(0)}</span>
                                  </div>
                                )}
                                <span className="text-xs font-semibold truncate">{idea.partnerTeam.owner}</span>
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">receives</span>
                              </div>
                              <ValStack dyn={pDyn} now={pNow} />
                              {idea.youGive.map((a: WinNowIdea["youGive"][number], i: number) => <AssetPill key={i} a={a} />)}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="px-[18px] pb-[10px] flex justify-end items-center gap-2 relative z-10">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] text-[#d4af37] hover:text-[#d4af37] hover:bg-[#d4af37]/10 px-2 gap-1"
                              data-testid={`btn-wn-build-${pos.toLowerCase()}-${idx}`}
                            >
                              <ArrowRightLeft className="w-2.5 h-2.5" />
                              Build in Calculator
                            </Button>
                            {isSleeperAuthed ? (
                              <Button
                                size="sm"
                                className="h-6 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-2 gap-1"
                                data-testid={`btn-wn-send-${pos.toLowerCase()}-${idx}`}
                                onClick={() => setSendModal({ open: true, idea })}
                              >
                                <Send className="w-2.5 h-2.5" />
                                Send Trade
                              </Button>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={0}>
                                    <Button
                                      size="sm"
                                      className="h-6 text-[10px] bg-muted text-muted-foreground px-2 gap-1 cursor-not-allowed"
                                      disabled
                                      data-testid={`btn-wn-send-disabled-${pos.toLowerCase()}-${idx}`}
                                    >
                                      <Send className="w-2.5 h-2.5" />
                                      Send Trade
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">Connect Sleeper to send offers directly</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      );
                  })}
                </div>
                )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      <WinNowSendModal
        open={sendModal.open}
        onClose={() => setSendModal({ open: false, idea: null })}
        idea={sendModal.idea}
        league={league}
        userTeam={userTeam}
      />
    </div>
  );
}

// ─── Rebuild Mode constants & types ──────────────────────────────
// Age curves based on EPA research: QB peaks 28-33, RB peaks 25-27, WR peaks 26-30, TE peaks 27-30

const SELL_AGE: Record<string, number> = { RB: 27, WR: 30, TE: 30, QB: 33 };
const EXIT_AGE: Record<string, number> = { RB: 29, WR: 32, TE: 32, QB: 36 };

const DECAY_AGE_PENALTY = (pos: string, age: number): number => {
  const sell = SELL_AGE[pos] ?? 30;
  const exit = EXIT_AGE[pos] ?? 34;
  if (age >= exit + 1)    return 4.0; // past exit age
  if (age >= exit)        return 3.0; // at exit age
  if (age >= sell + 1)    return 2.0; // past sell age
  if (age >= sell)        return 1.5; // at sell age
  return 1.0;
};
// RB = highest positional injury risk + shortest peak → highest sell urgency
const DECAY_POS_VOLATILITY: Record<string, number> = { RB: 1.6, WR: 1.0, TE: 1.1, QB: 0.7 };

type AssetTier = "Cornerstone" | "Hold" | "Liquid" | "Sell High" | "Emergency Exit";

interface RebuildPlayerData {
  player: Player;
  dynVal: number;
  rdVal: number;
  decayScore: number;
  tier: AssetTier;
}

interface RebuildIdea {
  id: string;
  partnerId: string;
  partnerTeam: Team;
  partnerTier: Tier;
  headline: string;
  why: string;
  youGive: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  youGet:  { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  dynGive: number;
  dynGet:  number;
  rdGive:  number;
  rdGet:   number;
  partnerRdDelta: number; // partner's actual lineup win-now change (optimizeLineup-based)
  ageDelta: number;
  score: number;
  scoreLabel: "Elite" | "Strong" | "Moderate";
}

function getAssetTier(pos: string, age: number, dynVal: number, rdVal: number): AssetTier {
  const isYoung  = pos === "RB" ? age <= 24 : pos === "QB" ? age <= 26 : age <= 25;
  const exitAge  = EXIT_AGE[pos] ?? 34;
  const sellAge  = SELL_AGE[pos] ?? 30;
  if (isYoung && dynVal >= 5000)                          return "Cornerstone";
  if (age >= exitAge && rdVal >= 1500)                    return "Emergency Exit";
  if (age >= exitAge)                                     return "Sell High";
  if (age >= sellAge && rdVal >= 1800)                    return "Sell High";
  if (rdVal > dynVal * 1.3 && rdVal >= 2500)              return "Sell High"; // redraft premium asset
  if (isYoung && dynVal > 1500)                           return "Hold";
  if (dynVal > 700)                                       return "Liquid";
  return "Hold";
}

type RebuildProfile = "Full Rebuild" | "Soft Rebuild" | "Retool" | "Hold / Contend" | "Productive Struggle";

// ─── Rebuild Mode adapter ─────────────────────────────────────────

function rebuildIdeaToWinNow(idea: RebuildIdea): WinNowIdea {
  return {
    id: idea.id, partnerId: idea.partnerId, partnerTeam: idea.partnerTeam, partnerTier: idea.partnerTier,
    headline: idea.headline, why: idea.why,
    youGive: idea.youGive.map(a => ({ label: a.label, value: a.value, pos: a.pos, age: a.age, type: a.type, sleeperId: a.sleeperId })),
    youGet:  idea.youGet.map(a  => ({ label: a.label, value: a.value, pos: a.pos, age: a.age, type: a.type, sleeperId: a.sleeperId })),
    gainPos: ((idea.youGet.find(a => a.type === "player")?.pos) ?? "QB") as PosLabel,
    dynGive: idea.dynGive, dynGet: idea.dynGet,
    rdGive: idea.rdGive, rdGet: idea.rdGet,
    userRdDelta: idea.rdGet - idea.rdGive,
    partnerRdDelta: idea.partnerRdDelta,
    score: idea.score,
    scoreLabel: idea.scoreLabel,
  };
}

// ─── Rebuild Mode ─────────────────────────────────────────────────

function RebuildMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
  const [sendModal, setSendModal] = useState<{ open: boolean; idea: WinNowIdea | null }>({ open: false, idea: null });
  const [partnerFilter, setPartnerFilter] = useState<"all" | "contender" | "middle" | "rebuilder">("all");
  const isSleeperAuthed = !!getSleeperSession()?.token;
  const togglePartner = (pid: string) => setExpandedPartners(prev => {
    const next = new Set(prev);
    next.has(pid) ? next.delete(pid) : next.add(pid);
    return next;
  });
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  // ── Classify every player on the user's roster ──────────────────
  // Sell score: raw rdVal × rd/dyn premium × position-aware age decay × injury volatility
  // Prioritises: high redraft value · low dynasty value · aging · RB position
  const rosterData = useMemo<RebuildPlayerData[]>(() => {
    return userTeam.roster.map(player => {
      const dynVal    = getPlayerValue(player);
      const rdVal     = getRedraftValue(player);
      const rdToDyn   = Math.max(1, rdVal / Math.max(dynVal, 100)); // >1 = overvalued in redraft
      const decayScore = rdVal * rdToDyn
        * DECAY_AGE_PENALTY(player.pos, player.age)
        * (DECAY_POS_VOLATILITY[player.pos] ?? 1.0);
      const tier = getAssetTier(player.pos, player.age, dynVal, rdVal);
      return { player, dynVal, rdVal, decayScore, tier };
    }).sort((a, b) => b.decayScore - a.decayScore);
  }, [userTeam, getPlayerValue, getRedraftValue]);

  // ── Sell candidates: Sell High + Emergency Exit ──────────────────
  const sellCandidates = useMemo(
    () => rosterData.filter(d => d.tier === "Sell High" || d.tier === "Emergency Exit").slice(0, 6),
    [rosterData]
  );

  // ── Generate rebuild trade ideas ────────────────────────────────
  const tradeIdeas = useMemo<RebuildIdea[]>(() => {
    if (sellCandidates.length === 0) return [];
    const ideas: RebuildIdea[] = [];

    for (const partner of league.teams) {
      if (partner.id === userTeam.id) continue;

      const partnerTier = tierMap.get(partner.id)?.tier ?? "Balanced";

      // Partner's young players (potential get targets for us)
      const partnerYoung = [...partner.roster]
        .map(p => ({ ...p, rdv: getRedraftValue(p), dynv: getPlayerValue(p) }))
        .filter(p => (p.pos === "RB" ? p.age <= 25 : p.age <= 26) && p.dynv > 800)
        .sort((a, b) => b.dynv - a.dynv)
        .slice(0, 4);

      // Partner's picks
      const partnerPicks = partner.picks
        .map(p => ({ ...p, val: getPickValue(p) }))
        .sort((a, b) => b.val - a.val);

      for (const chip of sellCandidates.slice(0, 4)) {
        const dynGive = chip.dynVal;
        const rdGive  = chip.rdVal;

        // Option A: player for young player
        for (const youngTarget of partnerYoung.slice(0, 3)) {
          const dynGet = youngTarget.dynv;
          const rdGet  = youngTarget.rdv;
          // User must gain dynasty value (strict: dynGet > dynGive)
          if (dynGet <= dynGive) continue;
          // Redraft balance: partner must give up at least 75% of what they receive
          if (rdGive < rdGet * 0.75) continue;

          const ageDelta     = youngTarget.age - chip.player.age; // negative = we got younger
          const ageCurveGain = Math.max(0, -ageDelta) * 120;
          const youngBonus   = Math.max(0, 27 - youngTarget.age) * 100;
          const score = ((dynGet - dynGive) + ageCurveGain + youngBonus) / Math.max(chip.decayScore / 1000, 0.2);
          const scoreLabel = score > 6 ? "Elite" : score > 2.5 ? "Strong" : "Moderate";

          // Partner's actual lineup win-now change: they lose youngTarget, gain chip
          const rp = league.rosterPositions ?? [];
          const pPreRd  = optimizeLineup(partner.roster, rp).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
          const pPost   = [...partner.roster.filter(p => (p.sleeperId ?? p.id) !== (youngTarget.sleeperId ?? youngTarget.id)), chip.player];
          const pPostRd = optimizeLineup(pPost, rp).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
          const partnerRdDelta = pPostRd - pPreRd;
          // Partner's win-now must increase
          if (partnerRdDelta <= 0) continue;

          ideas.push({
            id:          `rb-${partner.id}-${chip.player.sleeperId ?? chip.player.id}-${youngTarget.sleeperId ?? youngTarget.id}`,
            partnerId:   partner.id,
            partnerTeam: partner,
            partnerTier,
            headline:    `Sell ${chip.player.pos} decay → acquire ${youngTarget.pos} youth`,
            why:         `${chip.player.name} (age ${chip.player.age}) carries ${chip.tier === "Emergency Exit" ? "extreme" : "significant"} decay risk. ${youngTarget.name} (age ${youngTarget.age}) gives you insulated dynasty value and a longer competitive window.`,
            youGive: [{ label: chip.player.name, value: dynGive, pos: chip.player.pos, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age }],
            youGet:  [{ label: youngTarget.name,  value: dynGet, pos: youngTarget.pos, type: "player", sleeperId: youngTarget.sleeperId, age: youngTarget.age }],
            dynGive, dynGet, rdGive, rdGet, partnerRdDelta, ageDelta, score,
            scoreLabel: scoreLabel as RebuildIdea["scoreLabel"],
          });
        }

        // Option B: player for pick(s)
        if (partnerPicks.length > 0) {
          const topPick     = partnerPicks[0];
          const secondPick  = partnerPicks[1];
          const pickDynGet  = topPick.val + (secondPick ? secondPick.val : 0);
          const useTwo      = !!secondPick && pickDynGet <= dynGive * 1.15;
          const dynGet      = useTwo ? pickDynGet : topPick.val;
          // User must gain dynasty value (strict: dynGet > dynGive)
          if (dynGet <= dynGive) continue;

          const picksArr = useTwo ? [topPick, secondPick!] : [topPick];
          const rdGet    = 0; // picks have no current-season redraft value
          const score    = Math.max((dynGet - dynGive + rdGive * 0.15) / Math.max(rdGive, 500), 0);
          const scoreLabel = score > 1.5 ? "Elite" : score > 0.5 ? "Strong" : "Moderate";

          const youGet: RebuildIdea["youGet"] = picksArr.map(pk => ({
            label: `${pk.year} Rd ${pk.round} (${pk.projectedRange ?? "Mid"})`,
            value: pk.val,
            type: "pick" as const,
          }));

          // Partner's actual lineup win-now change: they gain chip, no player leaves their roster
          const rp2 = league.rosterPositions ?? [];
          const pPreRd2  = optimizeLineup(partner.roster, rp2).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
          const pPost2   = [...partner.roster, chip.player];
          const pPostRd2 = optimizeLineup(pPost2, rp2).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
          const partnerRdDelta2 = pPostRd2 - pPreRd2;

          // Partner's win-now must increase (they receive chip player)
          if (partnerRdDelta2 <= 0) continue;

          ideas.push({
            id:          `rb-pick-${partner.id}-${chip.player.sleeperId ?? chip.player.id}`,
            partnerId:   partner.id,
            partnerTeam: partner,
            partnerTier,
            headline:    `Convert ${chip.player.pos} peak value → draft capital`,
            why:         `${chip.player.name} is at or near peak redraft value. Converting now locks in dynasty capital and resets your age curve. Picks compound value into the next window.`,
            youGive: [{ label: chip.player.name, value: dynGive, pos: chip.player.pos, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age }],
            youGet,
            dynGive, dynGet, rdGive, rdGet, partnerRdDelta: partnerRdDelta2,
            ageDelta: -5, // picks = instant age reset
            score,
            scoreLabel: scoreLabel as RebuildIdea["scoreLabel"],
          });
        }
      }
    }

    const seen = new Set<string>();
    return ideas
      .filter(t => {
        const key = t.youGive.map(a => a.label).join(",") + "→" + t.youGet.map(a => a.label).join(",");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }, [league, userTeam, sellCandidates, tierMap, getPlayerValue, getRedraftValue, getPickValue]);

  // Group by partner
  const byPartner = useMemo(() => {
    const map = new Map<string, RebuildIdea[]>();
    tradeIdeas.forEach(t => {
      if (!map.has(t.partnerId)) map.set(t.partnerId, []);
      map.get(t.partnerId)!.push(t);
    });
    return Array.from(map.entries())
      .map(([pid, ideas]) => ({ pid, partnerTeam: ideas[0].partnerTeam, partnerTier: ideas[0].partnerTier, ideas }))
      .sort((a, b) => b.ideas[0].score - a.ideas[0].score);
  }, [tradeIdeas]);

  const filteredByPartner = useMemo(() => {
    if (partnerFilter === "all") return byPartner;
    return byPartner.filter(({ partnerTier }) => {
      if (partnerFilter === "contender") return isContenderTier(partnerTier);
      if (partnerFilter === "rebuilder") return isRebuilderTier(partnerTier);
      return !isContenderTier(partnerTier) && !isRebuilderTier(partnerTier);
    });
  }, [byPartner, partnerFilter]);

  return (
    <div className="space-y-5">

      {/* ── Assets to Move ── */}
      {rosterData.filter(d => d.tier === "Liquid" || d.tier === "Sell High" || d.tier === "Emergency Exit").length > 0 && (
        <Card className="p-5" data-testid="card-assets-to-move">
          <div className="mb-4">
            <h4 className="text-sm font-bold">Assets to Move</h4>
            <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Trade currency for rebuild deals (from liquid assets to priority sells)
            </p>
          </div>
          <div className="space-y-0">
            {rosterData
              .filter(d => d.tier === "Liquid" || d.tier === "Sell High" || d.tier === "Emergency Exit")
              .sort((a, b) => (a.tier === "Liquid" ? 1 : 0) - (b.tier === "Liquid" ? 1 : 0))
              .map((d, i) => {
              const sid = d.player.sleeperId ?? d.player.id;
              return (
                <div key={sid} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0" data-testid={`asset-move-row-${sid}`}>
                  <span className="text-xs text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <PlayerAvatar id={sid} name={d.player.name} pos={d.player.pos} team={d.player.team ?? ""} size="sm" />
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] flex-shrink-0",
                      d.tier === "Emergency Exit" ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" :
                      d.tier === "Sell High"      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                    )}
                  >
                    {d.tier}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Rebuild Trade Ideas ── */}
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            Rebuild Trade Ideas
            <Badge variant="secondary">{tradeIdeas.length}</Badge>
          </h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Find league-wide opportunities to convert aging or short-term production into younger players, picks, and long-term dynasty value.
          </p>
        </div>

        {/* ── Partner type filter ── */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-[10px] text-muted-foreground font-medium">Partner Type:</span>
          {(["all", "contender", "middle", "rebuilder"] as const).map(f => (
            <button
              key={f}
              onClick={() => setPartnerFilter(f)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                partnerFilter === f
                  ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              )}
            >
              {f === "all" ? "All Teams" : f === "contender" ? "Contenders" : f === "middle" ? "Middle" : "Rebuilders"}
            </button>
          ))}
        </div>

        {tradeIdeas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {sellCandidates.length === 0
                  ? "No high-decay assets detected. Your roster is already well-insulated."
                  : "No rebuild trades found. No partners currently have the young assets or picks to offer a fair return."}
              </p>
            </CardContent>
          </Card>
        ) : filteredByPartner.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No trade ideas for this partner type. Try a different filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="rebuild-partner-list">
            {filteredByPartner.map(({ pid, partnerTeam, partnerTier, ideas }) => {
              const isExpanded = expandedPartners.has(pid);
              return (
                <Card key={pid} className="overflow-hidden" data-testid={`rebuild-partner-${pid}`}>
                  <CardContent className="p-0">
                    <button
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                      onClick={() => togglePartner(pid)}
                      data-testid={`btn-rebuild-expand-${pid}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {partnerTeam.avatar ? (
                          <img src={partnerTeam.avatar} alt={partnerTeam.owner} className="w-9 h-9 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-bold text-muted-foreground">{partnerTeam.owner.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{partnerTeam.owner}</span>
                            <Badge variant="outline" className={cn("text-[10px]", getTierColor(partnerTier))}>{partnerTier}</Badge>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge variant="outline" className={cn("text-[9px] py-0",
                              ideas[0].scoreLabel === "Elite"  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                              ideas[0].scoreLabel === "Strong" ? "bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20" :
                              "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            )}>
                              Best: {ideas[0].scoreLabel}
                            </Badge>
                            <span className="text-[9px] text-muted-foreground">{ideas.length} idea{ideas.length !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={cn("w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform", isExpanded && "rotate-90")} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/30 px-5 py-4 space-y-3">
                        {ideas.map((idea: RebuildIdea, idx: number) => (
                          <WinNowIdeaCard
                            key={idea.id}
                            idea={rebuildIdeaToWinNow(idea)}
                            userTeam={userTeam}
                            isSleeperAuthed={isSleeperAuthed}
                            onSend={() => setSendModal({ open: true, idea: rebuildIdeaToWinNow(idea) })}
                            testId={`rebuild-idea-${pid}-${idx}`}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <WinNowSendModal
        open={sendModal.open}
        onClose={() => setSendModal({ open: false, idea: null })}
        idea={sendModal.idea}
        league={league}
        userTeam={userTeam}
      />
    </div>
  );
}

