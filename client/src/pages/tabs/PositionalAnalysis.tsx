import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, getPositionColor, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { cn } from "@/lib/utils";
import type { League, Team, Player, Pick, Tier } from "@/types";
import {
  ArrowRightLeft, Target, TrendingUp, TrendingDown, Zap, RotateCcw, ShieldCheck,
  ChevronRight, Scale
} from "lucide-react";

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

interface TradeSuggestion {
  id: string;
  template: string;
  headline: string;
  youGive: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  youGet: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  rawSide1: number;
  rawSide2: number;
  adjustedSide1: number;
  adjustedSide2: number;
  fairness: "Fair" | "Reasonable" | "Aggressive";
  reasons: string[];
}

function getStarterCountForPos(pos: PosLabel, rosterPositions?: string[]): number {
  if (!rosterPositions || rosterPositions.length === 0) return DEFAULT_STARTERS[pos] || 1;
  let count = rosterPositions.filter(s => s === pos).length;
  return Math.max(count, DEFAULT_STARTERS[pos] || 1);
}

function getStatusColor(status: StatusLabel): string {
  switch (status) {
    case "Surplus": return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "Need": return "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30";
    case "Neutral": return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  }
}

function getStatusCellBg(status: StatusLabel): string {
  switch (status) {
    case "Surplus": return "bg-emerald-500/10";
    case "Need": return "bg-red-500/10";
    case "Neutral": return "bg-background";
  }
}

const DIMINISHING_WEIGHTS = [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.36, 0.31];
function getWeight(i: number): number { return i < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[i] : 0.31; }
function adjustedTotal(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.reduce((s, v, i) => s + v * getWeight(i), 0);
}

export function PositionalAnalysis({ league, userTeam, onNavigateToCalculator }: PositionalAnalysisProps) {
  const [activeSubTab, setActiveSubTab] = useState<"opportunities">("opportunities");
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
  const rankColor = (t: "top" | "mid" | "bottom") =>
    t === "top" ? "text-emerald-500 dark:text-emerald-400"
    : t === "bottom" ? "text-red-500 dark:text-red-400"
    : "text-foreground";
  const barColor = (t: "top" | "mid" | "bottom") =>
    t === "top" ? "bg-emerald-500" : t === "bottom" ? "bg-red-500" : "bg-[#0b3a7a]";
  const barPct = (rank: number) =>
    positionalProfile.leagueSize <= 1
      ? 100
      : Math.round((1 - (rank - 1) / (positionalProfile.leagueSize - 1)) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-positional-analysis-title">
          Positional Analysis
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2">
          Analyze positional surplus and need across your league. Find trade partners driven by supply and demand.
        </p>
      </div>

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
          {POSITIONS.map(pos => {
            const dynRank = positionalProfile.dynRanks[pos] ?? positionalProfile.leagueSize;
            const rdRank  = positionalProfile.rdRanks[pos]  ?? positionalProfile.leagueSize;
            const dynTier = positionalProfile.rankTier(dynRank);
            const rdTier  = positionalProfile.rankTier(rdRank);
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
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(dynTier))}>
                      {ordinal(dynRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor(dynTier))} style={{ width: `${barPct(dynRank)}%` }} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Win-Now</span>
                    <span className={cn("text-sm font-bold tabular-nums", rankColor(rdTier))}>
                      {ordinal(rdRank)}
                      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">/{positionalProfile.leagueSize}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor(rdTier))} style={{ width: `${barPct(rdRank)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {subTabs.length > 1 && (
        <div className="flex items-center gap-0 border-b border-border/50 pb-0" data-testid="positional-sub-tabs">
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
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground">My Positional Profile</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>

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
  youGive: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  youGet:  { label: string; value: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string }[];
  gainPos: PosLabel;
  dynGive: number;
  dynGet:  number;
  rdGive:  number;
  rdGet:   number;
  partnerRdDelta: number; // partner's actual lineup win-now change (optimizeLineup-based)
  score: number;
  scoreLabel: "Elite" | "Strong" | "Moderate";
}

// ─── TradeOpportunities — mode selector ──────────────────────────

function TradeOpportunities({ league, userTeam }: { league: League; userTeam: Team }) {
  const [mode, setMode] = useState<"win-now" | "smart-gm" | "rebuild" | "build-dynasty">("win-now");
  return (
    <div className="space-y-5">
      <div className="flex w-fit rounded-lg border border-border overflow-hidden">
        {([
          { id: "win-now"       as const, label: "Win-Now",      desc: "Maximize starters now",       Icon: Zap        },
          { id: "smart-gm"      as const, label: "Smart GM",     desc: "Balance both timelines",      Icon: Scale      },
          { id: "rebuild"       as const, label: "Rebuild",      desc: "Convert to long-term assets", Icon: RotateCcw  },
          { id: "build-dynasty" as const, label: "Build Dynasty",desc: "Maximize dynasty value",      Icon: TrendingUp },
        ]).map(({ id, label, desc, Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-left transition-colors border-r border-border last:border-r-0",
              mode === id ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
            )}
            data-testid={`btn-mode-${id}`}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <div className="flex flex-col items-start">
              <span className="text-xs font-semibold leading-tight">{label}</span>
              <span className={cn("text-[10px] leading-tight", mode === id ? "text-white/70" : "text-muted-foreground/70")}>{desc}</span>
            </div>
          </button>
        ))}
      </div>

      {mode === "win-now"       && <WinNowMode       league={league} userTeam={userTeam} />}
      {mode === "smart-gm"      && <SmartGMMode      league={league} userTeam={userTeam} />}
      {mode === "rebuild"       && <RebuildMode       league={league} userTeam={userTeam} />}
      {mode === "build-dynasty" && <BuildDynastyMode league={league} userTeam={userTeam} />}
    </div>
  );
}

// ─── Win-Now Mode ─────────────────────────────────────────────────

function WinNowMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());
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

            // Partner's actual lineup win-now change: they lose target, gain chip
            const rp = league.rosterPositions ?? [];
            const partnerPreRd  = optimizeLineup(partner.roster, rp).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerPost1  = [...partner.roster.filter(p => (p.sleeperId ?? p.id) !== (target.sleeperId ?? target.id)), chip.player];
            const partnerPostRd = optimizeLineup(partnerPost1, rp).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerRdDelta = partnerPostRd - partnerPreRd;
            // Partner must gain in at least one dimension — no rational manager accepts losing both
            if ((dynGive - dynGet) < -1000 && partnerRdDelta < -1000) continue;

            ideas.push({
              id:          `wn-${partner.id}-${needPos}-${chip.player.sleeperId ?? chip.player.id}`,
              partnerId:   partner.id,
              partnerTeam: partner,
              partnerTier: tierMap.get(partner.id)?.tier ?? "Balanced",
              headline:    `Upgrade ${needPos} using ${chip.player.pos} surplus`,
              why:         `${chip.player.name} is an ideal chip — strong dynasty value with low lineup impact. Directly addresses your ${needPos} gap.`,
              youGive: [{ label: chip.player.name, value: chip.dynVal, pos: chip.player.pos, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age }],
              youGet:  [{ label: target.name,      value: target.dynv, pos: target.pos,      type: "player", sleeperId: target.sleeperId,      age: target.age      }],
              gainPos: needPos as PosLabel, dynGive, dynGet, rdGive, rdGet, partnerRdDelta, score, scoreLabel: scoreLabel as WinNowIdea["scoreLabel"],
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

            // Partner's actual lineup win-now change: they lose target, gain chip (pick adds no rdv)
            const rp2 = league.rosterPositions ?? [];
            const partnerPreRd2  = optimizeLineup(partner.roster, rp2).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerPost2   = [...partner.roster.filter(p => (p.sleeperId ?? p.id) !== (target.sleeperId ?? target.id)), chip.player];
            const partnerPostRd2 = optimizeLineup(partnerPost2, rp2).filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
            const partnerRdDelta2 = partnerPostRd2 - partnerPreRd2;
            // Partner must gain in at least one dimension — no rational manager accepts losing both
            if ((dynGive - dynGet) < -1000 && partnerRdDelta2 < -1000) continue;

            ideas.push({
              id:          `wn-pick-${partner.id}-${needPos}-${chip.player.sleeperId ?? chip.player.id}`,
              partnerId:   partner.id,
              partnerTeam: partner,
              partnerTier: tierMap.get(partner.id)?.tier ?? "Balanced",
              headline:    `Upgrade ${needPos} via ${chip.player.pos} + pick`,
              why:         `${chip.player.name} + a pick bridges the value gap while keeping dynasty cost low. Your ${needPos} weakness is your biggest weekly liability.`,
              youGive: [
                { label: chip.player.name, value: chip.dynVal, pos: chip.player.pos, type: "player", sleeperId: chip.player.sleeperId, age: chip.player.age },
                { label: pickLabel,        value: pickVal,                            type: "pick"                                                             },
              ],
              youGet: [{ label: target.name, value: target.dynv, pos: target.pos, type: "player", sleeperId: target.sleeperId, age: target.age }],
              gainPos: needPos as PosLabel, dynGive, dynGet, rdGive, rdGet, partnerRdDelta: partnerRdDelta2, score, scoreLabel: scoreLabel as WinNowIdea["scoreLabel"],
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
              High dynasty value ÷ low starter impact — ideal trade currency for win-now moves
            </p>
          </div>
          <div className="space-y-0">
            {sellCandidates.map((c, i) => {
              const sid = c.player.sleeperId ?? c.player.id;
              return (
                <div key={sid} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0" data-testid={`chip-row-${sid}`}>
                  <span className="text-xs text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}.</span>
                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/30">
                    <img
                      src={`https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`}
                      alt={c.player.name}
                      className="w-full h-full object-cover object-top"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{c.player.name}</span>
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-3.5 flex-shrink-0", getPositionColor(c.player.pos))}>{c.player.pos}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">Dyn: {c.dynVal.toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.starterCost < 100 ? "Bench player" : `−${Math.round(c.starterCost)} starter cost`}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] flex-shrink-0",
                      c.effScore > 60
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    )}
                  >
                    {c.effScore > 60 ? "Ideal Chip" : "Good Chip"}
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
                  ? "Your starters are balanced — no urgent win-now moves detected."
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
                    — {needRank === 0 ? "Primary Need" : needRank === 1 ? "Secondary Need" : "Tertiary Need"}
                  </span>
                  <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{ideas.length} idea{ideas.length !== 1 ? "s" : ""}</Badge>
                    <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  </div>
                </button>

                {isOpen && (
                <div className="border-t border-border/30 px-5 py-4 space-y-3">
                  {ideas.map((idea: WinNowIdea, idx: number) => (
                    <div key={idea.id} className="rounded-xl border border-border/40 overflow-hidden" data-testid={`wn-idea-${pos.toLowerCase()}-${idx}`}>
                      {/* Partner row */}
                      <div className="px-4 py-2 bg-muted/30 border-b border-border/20 flex items-center gap-2">
                        {idea.partnerTeam.avatar ? (
                          <img
                            src={idea.partnerTeam.avatar}
                            alt={idea.partnerTeam.owner}
                            className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-border/30"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-muted-foreground">{idea.partnerTeam.owner.charAt(0)}</span>
                          </div>
                        )}
                        <span className="text-xs font-medium">{idea.partnerTeam.owner}</span>
                        <Badge variant="outline" className={cn("text-[9px]", getTierColor(idea.partnerTier))}>{idea.partnerTier}</Badge>
                      </div>

                      {/* Header */}
                      <div className="px-4 py-2.5 bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] flex-shrink-0",
                              idea.scoreLabel === "Elite"  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                              idea.scoreLabel === "Strong" ? "bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20" :
                                                             "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                            )}
                          >
                            {idea.scoreLabel}
                          </Badge>
                          <span className="text-xs font-medium text-foreground">{idea.headline}</span>
                        </div>
                      </div>

                      {/* You Give / You Get */}
                      <div className="grid grid-cols-2 divide-x divide-border/30">
                        {(["youGive", "youGet"] as const).map(side => (
                          <div key={side} className="px-4 py-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                              {side === "youGive" ? "You Give" : "You Get"}
                            </p>
                            {idea[side].map((a: WinNowIdea["youGive"][number], i: number) => (
                              <div key={i} className="flex items-center gap-1.5 py-1 min-w-0">
                                {a.type === "player" && a.sleeperId ? (
                                  <div className="w-5 h-5 rounded-full flex-shrink-0 overflow-hidden bg-muted">
                                    <img
                                      src={`https://sleepercdn.com/content/nfl/players/thumb/${a.sleeperId}.jpg`}
                                      alt={a.label}
                                      className="w-full h-full object-cover object-top"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                  </div>
                                ) : a.type === "pick" ? (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">PICK</Badge>
                                ) : null}
                                {a.pos && (
                                  <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getPositionColor(a.pos))}>{a.pos}</Badge>
                                )}
                                <span className="text-xs font-medium truncate">{a.label}</span>
                                <span className="text-[10px] font-mono text-muted-foreground ml-auto flex-shrink-0">{a.value.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      {/* Footer — trade value breakdown for both sides */}
                      <div className="px-4 py-3 bg-muted/10 border-t border-border/20 space-y-2.5">
                        {/* Value table: Dynasty + Win-Now for each party */}
                        <div className="grid grid-cols-3 gap-x-2 text-[10px]">
                          <div />
                          <span className="text-muted-foreground font-semibold uppercase tracking-wide text-center">Dynasty</span>
                          <span className="text-muted-foreground font-semibold uppercase tracking-wide text-center">Win-Now</span>

                          {/* You row */}
                          <span className="text-muted-foreground font-medium self-center">You</span>
                          {(() => {
                            const d = idea.dynGet - idea.dynGive;
                            return (
                              <span className={cn("text-center font-semibold", d >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400 dark:text-red-400")}>
                                {d >= 0 ? "+" : "−"}{Math.abs(Math.round(d)).toLocaleString()}
                              </span>
                            );
                          })()}
                          {(() => {
                            const r = idea.rdGet - idea.rdGive;
                            return (
                              <span className={cn("text-center font-semibold", r >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400 dark:text-red-400")}>
                                {r >= 0 ? "+" : "−"}{Math.abs(Math.round(r)).toLocaleString()}
                              </span>
                            );
                          })()}

                          {/* Partner row */}
                          <span className="text-muted-foreground font-medium self-center truncate">{idea.partnerTeam.owner}</span>
                          {(() => {
                            const d = idea.dynGive - idea.dynGet;
                            return (
                              <span className={cn("text-center font-semibold", d >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400 dark:text-red-400")}>
                                {d >= 0 ? "+" : "−"}{Math.abs(Math.round(d)).toLocaleString()}
                              </span>
                            );
                          })()}
                          {(() => {
                            const r = idea.partnerRdDelta;
                            return (
                              <span className={cn("text-center font-semibold", r >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400 dark:text-red-400")}>
                                {r >= 0 ? "+" : "−"}{Math.abs(Math.round(r)).toLocaleString()}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="default"
                            size="sm"
                            className="text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90"
                            data-testid={`btn-wn-build-${pos.toLowerCase()}-${idx}`}
                          >
                            <ArrowRightLeft className="w-3 h-3 mr-1" />
                            Build in Calculator
                          </Button>
                        </div>
                      </div>
                    </div>
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
    </div>
  );
}

// ─── Smart GM Mode types ──────────────────────────────────────────

type SmartGMArchetype = "Age Swap" | "Positional Redistribution" | "Depth Consolidation" | "Sell Peak" | "Buy Depressed";
type SmartGMTeamType  = "Deep Contender" | "Aging Contender" | "Fragile Contender" | "Unbalanced" | "Young Weak" | "Balanced";

interface SmartGMAsset { label: string; dynVal: number; rdVal: number; pos?: string; age?: number; type: "player" | "pick"; sleeperId?: string; }
interface SmartGMIdea {
  id: string;
  partnerId: string;
  partnerTeam: Team;
  partnerTier: Tier;
  archetype: SmartGMArchetype;
  headline: string;
  why: string;
  youGive: SmartGMAsset[];
  youGet:  SmartGMAsset[];
  dynastyDelta: number;
  redraftDelta: number;
  ageDelta: number;
  score: number;
  scoreLabel: "Premium" | "Recommended" | "Solid";
}

// ─── Smart GM Mode ────────────────────────────────────────────────

function SmartGMMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
  type Pos = typeof POSITIONS[number];

  // ── Positional balance: rank each position vs league ─────────────
  const posBalance = useMemo(() => {
    const n = league.teams.length;
    const result = {} as Record<Pos, { myVal: number; rank: number; leagueAvg: number; surplus: boolean; deficit: boolean }>;
    for (const pos of POSITIONS) {
      const teamVals = league.teams
        .map(t => ({ id: t.id, val: t.roster.filter(p => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0) }))
        .sort((a, b) => b.val - a.val);
      const myVal    = teamVals.find(t => t.id === userTeam.id)?.val ?? 0;
      const rank     = teamVals.findIndex(t => t.id === userTeam.id) + 1;
      const leagueAvg = teamVals.reduce((s, t) => s + t.val, 0) / n;
      result[pos] = { myVal, rank, leagueAvg, surplus: rank <= Math.ceil(n * 0.3), deficit: rank > Math.floor(n * 0.65) };
    }
    return result;
  }, [league, userTeam, getPlayerValue]);

  // ── Overall win-now & dynasty ranks ──────────────────────────────
  const ranks = useMemo(() => {
    const n = league.teams.length;
    const byRD = [...league.teams].sort((a, b) =>
      b.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0) -
      a.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0));
    const byDyn = [...league.teams].sort((a, b) =>
      b.roster.reduce((s, p) => s + getPlayerValue(p), 0) -
      a.roster.reduce((s, p) => s + getPlayerValue(p), 0));
    const winNowRank  = byRD.findIndex(t => t.id === userTeam.id) + 1;
    const dynastyRank = byDyn.findIndex(t => t.id === userTeam.id) + 1;
    const starters    = userTeam.roster.filter(p => p.starter && p.age > 0);
    const avgStarterAge = starters.length ? starters.reduce((s, p) => s + p.age, 0) / starters.length : 0;
    const topThird   = Math.ceil(n / 3);
    const bottomHalf = Math.floor(n * 0.5);
    return { winNowRank, dynastyRank, avgStarterAge, n, topThird, bottomHalf };
  }, [league, userTeam, getPlayerValue, getRedraftValue]);

  // ── Fragility score (0-100) ───────────────────────────────────────
  const fragility = useMemo(() => {
    let score = 0;
    for (const pos of POSITIONS) {
      const starters = userTeam.roster.filter(p => p.pos === pos && p.starter).sort((a, b) => getRedraftValue(b) - getRedraftValue(a));
      if (starters.length >= 2) {
        const dropoff = (getRedraftValue(starters[0]) - getRedraftValue(starters[1])) / Math.max(getRedraftValue(starters[0]), 1);
        if (dropoff > 0.6) score += 18;
        else if (dropoff > 0.4) score += 10;
      } else if (starters.length === 1) {
        score += 20;
      } else if (starters.length === 0) {
        score += 5;
      }
      const ageRisk = starters.filter(p => p.age >= 29).length;
      score += ageRisk * 6;
    }
    const imbalancedPositions = POSITIONS.filter(p => posBalance[p]?.surplus || posBalance[p]?.deficit).length;
    score += imbalancedPositions * 4;
    return Math.min(score, 100);
  }, [userTeam, posBalance, getRedraftValue]);

  // ── Team type ─────────────────────────────────────────────────────
  const teamType = useMemo<{ type: SmartGMTeamType; summary: string }>(() => {
    const { winNowRank, dynastyRank, avgStarterAge, topThird } = ranks;
    const surplusPositions = POSITIONS.filter(p => posBalance[p]?.surplus);
    const deficitPositions = POSITIONS.filter(p => posBalance[p]?.deficit);
    const isContending = winNowRank <= topThird;
    const hasDynasty   = dynastyRank <= topThird;
    const isAging      = avgStarterAge >= 28;
    const isFragile    = fragility >= 50;
    const isImbalanced = surplusPositions.length > 0 && deficitPositions.length > 0;
    const isYoung      = avgStarterAge <= 25 && !isContending;

    if (isContending && hasDynasty)   return { type: "Deep Contender",    summary: "Elite on both axes. Focus on insulation — don't break what's working." };
    if (isContending && isAging)      return { type: "Aging Contender",   summary: "Competing now but aging fast. Smart age swaps preserve your window." };
    if (isContending && isFragile)    return { type: "Fragile Contender", summary: "Strong lineup, thin depth. One injury away from disaster — shore up fragile spots." };
    if (isImbalanced)                 return { type: "Unbalanced",        summary: `${surplusPositions.join("/")} surplus and ${deficitPositions.join("/")} deficit. Redistribution trades unlock hidden value.` };
    if (isYoung)                      return { type: "Young Weak",        summary: "Youth on your side. Seek young producers who score now — don't sacrifice points for picks." };
    return                                   { type: "Balanced",          summary: "No glaring weaknesses. Focus on upgrading starter quality and reducing position fragility." };
  }, [ranks, posBalance, fragility]);

  // ── Trade idea generation ─────────────────────────────────────────
  const tradeIdeas = useMemo<SmartGMIdea[]>(() => {
    const ideas: SmartGMIdea[] = [];

    const myPlayers = [...userTeam.roster]
      .map(p => ({ ...p, dynV: getPlayerValue(p), rdV: getRedraftValue(p) }))
      .filter(p => p.dynV > 300 || p.rdV > 400)
      .sort((a, b) => b.rdV - a.rdV);

    const surplusPos = POSITIONS.filter(p => posBalance[p]?.surplus);
    const deficitPos = POSITIONS.filter(p => posBalance[p]?.deficit);

    for (const partner of league.teams) {
      if (partner.id === userTeam.id) continue;

      const partnerPlayers = [...partner.roster]
        .map(p => ({ ...p, dynV: getPlayerValue(p), rdV: getRedraftValue(p) }))
        .filter(p => p.dynV > 300 || p.rdV > 400)
        .sort((a, b) => b.dynV - a.dynV);

      const partnerTier = tierMap.get(partner.id)?.tier ?? "Balanced";

      for (const give of myPlayers.slice(0, 8)) {

        // ── Age Swap: same position, get younger/more insulated ─────
        if (give.age >= 27) {
          const youngSame = partnerPlayers
            .filter(p => p.pos === give.pos && p.age <= give.age - 2 && p.dynV > give.dynV * 0.78 && p.dynV < give.dynV * 1.22);
          for (const g of youngSame.slice(0, 2)) {
            const dynD  = (g.dynV - give.dynV) / Math.max(give.dynV + g.dynV, 1) * 2;
            const rdD   = (g.rdV  - give.rdV)  / Math.max(give.rdV  + g.rdV,  1) * 2;
            if (dynD < -0.09 || rdD < -0.10) continue;
            const ageDelta = g.age - give.age;
            const score = (dynD * 80 + rdD * 60 + Math.max(0, -ageDelta) * 10 + 15)
              - Math.max(0, -dynD) * 140 - Math.max(0, -rdD) * 110;
            if (score < -20) continue;
            ideas.push({
              id: `sgm-ageswap-${partner.id}-${give.sleeperId}-${g.sleeperId}`,
              partnerId: partner.id, partnerTeam: partner, partnerTier,
              archetype: "Age Swap",
              headline: `Age swap at ${give.pos}: shed ${give.age}-yr volatility`,
              why: `${give.name} (${give.age}) carries growing age-curve risk. ${g.name} (${g.age}) provides similar production with ${give.age - g.age} more years of runway, improving your roster's long-term insulation.`,
              youGive: [{ label: give.name, dynVal: give.dynV, rdVal: give.rdV, pos: give.pos, age: give.age, type: "player", sleeperId: give.sleeperId }],
              youGet:  [{ label: g.name,    dynVal: g.dynV,    rdVal: g.rdV,    pos: g.pos,   age: g.age,   type: "player", sleeperId: g.sleeperId }],
              dynastyDelta: dynD, redraftDelta: rdD, ageDelta, score: Math.max(score, 0),
              scoreLabel: score > 30 ? "Premium" : score > 10 ? "Recommended" : "Solid",
            });
          }
        }

        // ── Positional Redistribution: surplus → deficit ─────────────
        if (surplusPos.includes(give.pos as Pos) && deficitPos.length > 0) {
          for (const wantPos of deficitPos) {
            const targets = partnerPlayers
              .filter(p => p.pos === wantPos && p.dynV > give.dynV * 0.82 && p.dynV < give.dynV * 1.18);
            for (const g of targets.slice(0, 2)) {
              const dynD = (g.dynV - give.dynV) / Math.max(give.dynV + g.dynV, 1) * 2;
              const rdD  = (g.rdV  - give.rdV)  / Math.max(give.rdV  + g.rdV,  1) * 2;
              if (dynD < -0.09 || rdD < -0.12) continue;
              const ageDelta = g.age - give.age;
              const balanceBonus = 20;
              const score = (dynD * 80 + rdD * 60 + Math.max(0, -ageDelta) * 8 + balanceBonus)
                - Math.max(0, -dynD) * 140 - Math.max(0, -rdD) * 110;
              if (score < -15) continue;
              ideas.push({
                id: `sgm-posredist-${partner.id}-${give.sleeperId}-${g.sleeperId}`,
                partnerId: partner.id, partnerTeam: partner, partnerTier,
                archetype: "Positional Redistribution",
                headline: `${give.pos} surplus → ${g.pos} stability`,
                why: `You're top-heavy at ${give.pos} while ${g.pos} is a structural gap. ${give.name} fills their need; ${g.name} fills yours — improving both positional balance and roster flexibility.`,
                youGive: [{ label: give.name, dynVal: give.dynV, rdVal: give.rdV, pos: give.pos, age: give.age, type: "player", sleeperId: give.sleeperId }],
                youGet:  [{ label: g.name,    dynVal: g.dynV,    rdVal: g.rdV,    pos: g.pos,   age: g.age,   type: "player", sleeperId: g.sleeperId }],
                dynastyDelta: dynD, redraftDelta: rdD, ageDelta, score: Math.max(score, 0),
                scoreLabel: score > 30 ? "Premium" : score > 10 ? "Recommended" : "Solid",
              });
            }
          }
        }

        // ── Sell Peak Volatility: rdVal >> dynVal (career year player) ─
        const rdPremium = give.rdV / Math.max(give.dynV, 1);
        if (rdPremium > 1.35 && give.age >= 26) {
          const stableTargets = partnerPlayers
            .filter(p => p.dynV >= give.dynV * 0.85 && p.rdV >= give.rdV * 0.72 && p.age <= give.age - 1);
          for (const g of stableTargets.slice(0, 2)) {
            const dynD = (g.dynV - give.dynV) / Math.max(give.dynV + g.dynV, 1) * 2;
            const rdD  = (g.rdV  - give.rdV)  / Math.max(give.rdV  + g.rdV,  1) * 2;
            if (dynD < -0.08 || rdD < -0.14) continue;
            const ageDelta = g.age - give.age;
            const peakBonus = (rdPremium - 1.0) * 30;
            const score = (dynD * 80 + rdD * 55 + Math.max(0, -ageDelta) * 10 + peakBonus)
              - Math.max(0, -dynD) * 140 - Math.max(0, -rdD) * 100;
            if (score < -10) continue;
            ideas.push({
              id: `sgm-sellpeak-${partner.id}-${give.sleeperId}-${g.sleeperId}`,
              partnerId: partner.id, partnerTeam: partner, partnerTier,
              archetype: "Sell Peak",
              headline: `Lock in ${give.name}'s peak value before decline`,
              why: `${give.name} is producing at a level that may not be sustainable — redraft value is elevated relative to dynasty. Converting now for ${g.name} locks in value and improves long-term roster stability.`,
              youGive: [{ label: give.name, dynVal: give.dynV, rdVal: give.rdV, pos: give.pos, age: give.age, type: "player", sleeperId: give.sleeperId }],
              youGet:  [{ label: g.name,    dynVal: g.dynV,    rdVal: g.rdV,    pos: g.pos,   age: g.age,   type: "player", sleeperId: g.sleeperId }],
              dynastyDelta: dynD, redraftDelta: rdD, ageDelta, score: Math.max(score, 0),
              scoreLabel: score > 30 ? "Premium" : score > 10 ? "Recommended" : "Solid",
            });
          }
        }

        // ── Buy Depressed: young player with high dynasty, low redraft ─
        const depressed = partnerPlayers.filter(p =>
          p.dynV >= give.dynV * 0.88 &&
          p.rdV  <= give.rdV  * 0.82 &&
          p.age  <= give.age - 1 &&
          p.dynV >= 2000
        );
        for (const g of depressed.slice(0, 2)) {
          const dynD = (g.dynV - give.dynV) / Math.max(give.dynV + g.dynV, 1) * 2;
          const rdD  = (g.rdV  - give.rdV)  / Math.max(give.rdV  + g.rdV,  1) * 2;
          if (dynD < -0.08) continue; // can tolerate moderate redraft loss here
          const ageDelta = g.age - give.age;
          const score = (dynD * 90 + rdD * 40 + Math.max(0, -ageDelta) * 12 + 10)
            - Math.max(0, -dynD) * 150 - Math.max(0, -rdD) * 70;
          if (score < 0) continue;
          ideas.push({
            id: `sgm-buydep-${partner.id}-${give.sleeperId}-${g.sleeperId}`,
            partnerId: partner.id, partnerTeam: partner, partnerTier,
            archetype: "Buy Depressed",
            headline: `Buy ${g.name}'s discounted dynasty value`,
            why: `${g.name}'s redraft value is suppressed — likely due to injury, role competition, or a developmental phase — but dynasty value remains strong. Acquiring discounted insulation is a hallmark of savvy GM play.`,
            youGive: [{ label: give.name, dynVal: give.dynV, rdVal: give.rdV, pos: give.pos, age: give.age, type: "player", sleeperId: give.sleeperId }],
            youGet:  [{ label: g.name,    dynVal: g.dynV,    rdVal: g.rdV,    pos: g.pos,   age: g.age,   type: "player", sleeperId: g.sleeperId }],
            dynastyDelta: dynD, redraftDelta: rdD, ageDelta, score: Math.max(score, 0),
            scoreLabel: score > 30 ? "Premium" : score > 10 ? "Recommended" : "Solid",
          });
        }
      }

      // ── Depth Consolidation: 2 bench players → 1 starter ──────────
      const myBench = myPlayers.filter(p => !p.starter && p.dynV > 400).slice(0, 6);
      for (let i = 0; i < myBench.length - 1; i++) {
        for (let j = i + 1; j < Math.min(myBench.length, i + 4); j++) {
          const a = myBench[i], b = myBench[j];
          const combinedDyn = a.dynV + b.dynV;
          const combinedRd  = a.rdV  + b.rdV;
          const starterTargets = partnerPlayers.filter(p =>
            p.starter && p.dynV >= combinedDyn * 0.82 && p.dynV <= combinedDyn * 1.18
          );
          for (const g of starterTargets.slice(0, 2)) {
            const dynD = (g.dynV - combinedDyn) / Math.max(combinedDyn + g.dynV, 1) * 2;
            const rdD  = (g.rdV  - combinedRd)  / Math.max(combinedRd  + g.rdV,  1) * 2;
            if (dynD < -0.10 || rdD < -0.08) continue;
            const score = (dynD * 75 + rdD * 75 + 25)
              - Math.max(0, -dynD) * 130 - Math.max(0, -rdD) * 130;
            if (score < 0) continue;
            const ageDelta = g.age - (a.age + b.age) / 2;
            ideas.push({
              id: `sgm-consol-${partner.id}-${a.sleeperId}-${b.sleeperId}-${g.sleeperId}`,
              partnerId: partner.id, partnerTeam: partner, partnerTier,
              archetype: "Depth Consolidation",
              headline: `Consolidate bench depth into a starter`,
              why: `${a.name} and ${b.name} together represent consolidatable bench value. Upgrading to ${g.name} reduces roster clutter, improves lineup strength, and keeps dynasty value intact.`,
              youGive: [
                { label: a.name, dynVal: a.dynV, rdVal: a.rdV, pos: a.pos, age: a.age, type: "player", sleeperId: a.sleeperId },
                { label: b.name, dynVal: b.dynV, rdVal: b.rdV, pos: b.pos, age: b.age, type: "player", sleeperId: b.sleeperId },
              ],
              youGet: [{ label: g.name, dynVal: g.dynV, rdVal: g.rdV, pos: g.pos, age: g.age, type: "player", sleeperId: g.sleeperId }],
              dynastyDelta: dynD, redraftDelta: rdD, ageDelta, score: Math.max(score, 0),
              scoreLabel: score > 30 ? "Premium" : score > 10 ? "Recommended" : "Solid",
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
        return t.score > 0;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 18);
  }, [league, userTeam, posBalance, getPlayerValue, getRedraftValue, tierMap]);

  const byPartner = useMemo(() => {
    const map = new Map<string, SmartGMIdea[]>();
    tradeIdeas.forEach(t => { if (!map.has(t.partnerId)) map.set(t.partnerId, []); map.get(t.partnerId)!.push(t); });
    return Array.from(map.entries())
      .map(([pid, ideas]) => ({ pid, partnerTeam: ideas[0].partnerTeam, partnerTier: ideas[0].partnerTier, ideas }))
      .sort((a, b) => b.ideas[0].score - a.ideas[0].score);
  }, [tradeIdeas]);

  const teamTypeColor: Record<SmartGMTeamType, string> = {
    "Deep Contender":    "text-emerald-500 dark:text-emerald-400",
    "Aging Contender":   "text-amber-500 dark:text-amber-400",
    "Fragile Contender": "text-orange-500 dark:text-orange-400",
    "Unbalanced":        "text-blue-500 dark:text-blue-400",
    "Young Weak":        "text-purple-500 dark:text-purple-400",
    "Balanced":          "text-slate-400",
  };

  const archetypeColor: Record<SmartGMArchetype, string> = {
    "Age Swap":                  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    "Positional Redistribution": "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    "Depth Consolidation":       "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    "Sell Peak":                 "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    "Buy Depressed":             "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  };

  const posBarWidth = (rank: number, n: number) => Math.round((1 - (rank - 1) / Math.max(n - 1, 1)) * 100);

  return (
    <div className="space-y-5">

      {/* ── Team Ecosystem Card ── */}
      <Card className="p-5" data-testid="card-smart-gm-profile">
        <div className="mb-4">
          <h4 className="text-sm font-bold">Team Ecosystem</h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
        </div>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <p className={cn("text-xl font-bold", teamTypeColor[teamType.type])}>{teamType.type}</p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{teamType.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 flex-shrink-0 text-right">
            <div>
              <p className="text-[10px] text-muted-foreground">Win-Now Rank</p>
              <p className="text-sm font-bold">#{ranks.winNowRank}<span className="text-[10px] text-muted-foreground font-normal">/{ranks.n}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Dynasty Rank</p>
              <p className="text-sm font-bold">#{ranks.dynastyRank}<span className="text-[10px] text-muted-foreground font-normal">/{ranks.n}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Avg Starter Age</p>
              <p className={cn("text-sm font-bold",
                ranks.avgStarterAge >= 29 ? "text-red-500 dark:text-red-400" :
                ranks.avgStarterAge >= 27 ? "text-amber-500 dark:text-amber-400" : "text-emerald-500 dark:text-emerald-400"
              )}>{ranks.avgStarterAge.toFixed(1)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Fragility</p>
              <p className={cn("text-sm font-bold",
                fragility >= 60 ? "text-red-500 dark:text-red-400" :
                fragility >= 35 ? "text-amber-500 dark:text-amber-400" : "text-emerald-500 dark:text-emerald-400"
              )}>{fragility < 30 ? "Low" : fragility < 55 ? "Moderate" : "High"}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Smart GM Trade Ideas ── */}
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            Smart GM Trade Ideas
            <Badge variant="secondary">{tradeIdeas.length}</Badge>
          </h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Net-positive trades — improve roster ecosystem without sacrificing competitiveness.
            Max <span className="font-semibold">−8% dynasty</span> or <span className="font-semibold">−5% redraft</span> allowed.
          </p>
        </div>

        {tradeIdeas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Scale className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No net-positive trades found. Your roster may already be well-balanced — or no partner has a complementary imbalance to exploit.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="smart-gm-partner-list">
            {byPartner.map(({ pid, partnerTeam, partnerTier, ideas }) => {
              const isExpanded = expandedPartner === pid;
              return (
                <Card key={pid} className="overflow-hidden" data-testid={`smart-gm-partner-${pid}`}>
                  <CardContent className="p-0">
                    <button
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                      onClick={() => setExpandedPartner(isExpanded ? null : pid)}
                      data-testid={`btn-sgm-expand-${pid}`}
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
                              ideas[0].scoreLabel === "Premium"     ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                              ideas[0].scoreLabel === "Recommended" ? "bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20" :
                              "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            )}>
                              Best: {ideas[0].scoreLabel}
                            </Badge>
                            <Badge variant="outline" className={cn("text-[9px] py-0", archetypeColor[ideas[0].archetype])}>
                              {ideas[0].archetype}
                            </Badge>
                            <span className="text-[9px] text-muted-foreground">{ideas.length} idea{ideas.length !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={cn("w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform", isExpanded && "rotate-90")} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/30 px-5 py-4 space-y-4">
                        {ideas.map((idea, idx) => (
                          <div key={idea.id} className="rounded-xl border border-border/40 overflow-hidden" data-testid={`sgm-idea-${pid}-${idx}`}>
                            {/* Header */}
                            <div className="px-4 py-2.5 bg-muted/20 flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={cn("text-[10px] flex-shrink-0",
                                idea.scoreLabel === "Premium"     ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                                idea.scoreLabel === "Recommended" ? "bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20" :
                                "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                              )}>{idea.scoreLabel}</Badge>
                              <Badge variant="outline" className={cn("text-[9px] py-0 flex-shrink-0", archetypeColor[idea.archetype])}>{idea.archetype}</Badge>
                              <span className="text-xs font-medium text-foreground">{idea.headline}</span>
                            </div>

                            {/* You Give / You Get */}
                            <div className="grid grid-cols-2 divide-x divide-border/30">
                              {(["youGive", "youGet"] as const).map(side => (
                                <div key={side} className="px-4 py-3">
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                                    {side === "youGive" ? "You Give" : "You Get"}
                                  </p>
                                  {idea[side].map((a: SmartGMAsset, i: number) => (
                                    <div key={i} className="flex items-center gap-1.5 py-1 min-w-0">
                                      {a.type === "player" && a.sleeperId ? (
                                        <div className="w-5 h-5 rounded-full flex-shrink-0 overflow-hidden bg-muted">
                                          <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.sleeperId}.jpg`} alt={a.label} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                        </div>
                                      ) : null}
                                      {a.pos && <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                      <span className="text-xs font-medium truncate">{a.label}</span>
                                      {a.age && <span className="text-[9px] text-muted-foreground flex-shrink-0">({a.age})</span>}
                                      <div className="ml-auto flex flex-col items-end flex-shrink-0">
                                        <span className="text-[10px] font-mono text-foreground">{a.dynVal.toLocaleString()}</span>
                                        <span className="text-[9px] font-mono text-muted-foreground">{a.rdVal.toLocaleString()} rd</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>

                            {/* Footer */}
                            <div className="px-4 py-2.5 bg-muted/10 border-t border-border/20 space-y-2">
                              <p className="text-[10px] text-muted-foreground italic">{idea.why}</p>
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className={cn("text-[10px] font-semibold",
                                    idea.dynastyDelta >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"
                                  )}>
                                    {idea.dynastyDelta >= 0 ? "+" : ""}{Math.round(idea.dynastyDelta * 100)}% dynasty
                                  </span>
                                  <span className={cn("text-[10px] font-semibold",
                                    idea.redraftDelta >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"
                                  )}>
                                    {idea.redraftDelta >= 0 ? "+" : ""}{Math.round(idea.redraftDelta * 100)}% redraft
                                  </span>
                                  {idea.ageDelta < -0.5 && (
                                    <span className="text-[10px] text-blue-400">
                                      −{Math.abs(Math.round(idea.ageDelta))} yr{Math.abs(Math.round(idea.ageDelta)) !== 1 ? "s" : ""} avg age
                                    </span>
                                  )}
                                </div>
                                <Button variant="default" size="sm" className="text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90" data-testid={`btn-sgm-build-${pid}-${idx}`}>
                                  <ArrowRightLeft className="w-3 h-3 mr-1" />
                                  Build in Calculator
                                </Button>
                              </div>
                            </div>
                          </div>
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
  if (age >= exit)        return 4.0; // well past cliff — emergency sell
  if (age >= exit - 1)    return 3.0;
  if (age >= sell + 1)    return 2.0; // clearly past peak window
  if (age >= sell)        return 1.5; // entering decline
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

// ─── Rebuild Mode ─────────────────────────────────────────────────

function RebuildMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
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

  // ── Rebuild profile classification ──────────────────────────────
  const rebuildProfile = useMemo<{
    type: RebuildProfile;
    winNowRank: number;
    dynastyRank: number;
    avgStarterAge: number;
    pickCapital: number;
    summary: string;
  }>(() => {
    const n = league.teams.length;

    const byWinNow = [...league.teams].sort((a, b) =>
      b.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0) -
      a.roster.filter(p => p.starter).reduce((s, p) => s + getRedraftValue(p), 0)
    );
    const byDynasty = [...league.teams].sort((a, b) =>
      b.roster.reduce((s, p) => s + getPlayerValue(p), 0) -
      a.roster.reduce((s, p) => s + getPlayerValue(p), 0)
    );

    const winNowRank   = byWinNow.findIndex(t => t.id === userTeam.id) + 1;
    const dynastyRank  = byDynasty.findIndex(t => t.id === userTeam.id) + 1;
    const topThird     = Math.ceil(n / 3);
    const bottomThird  = Math.floor(n * 0.66);

    const starters     = userTeam.roster.filter(p => p.starter && p.age > 0);
    const avgStarterAge = starters.length > 0
      ? starters.reduce((s, p) => s + p.age, 0) / starters.length : 0;
    const pickCapital  = userTeam.picks.reduce((s, p) => s + getPickValue(p), 0);

    const lowWinNow    = winNowRank > bottomThird;
    const lowDynasty   = dynastyRank > bottomThird;
    const highWinNow   = winNowRank <= topThird;
    const highDynasty  = dynastyRank <= topThird;
    const agingRoster  = avgStarterAge >= 28.5;

    let type: RebuildProfile;
    let summary: string;

    if (highWinNow && highDynasty) {
      type = "Hold / Contend"; summary = "Your roster is strong on both axes — protect your assets and push for a title.";
    } else if (lowWinNow && lowDynasty) {
      type = "Full Rebuild"; summary = "Low win-now and dynasty value signal a full rebuild. Convert aging production into young assets and picks.";
    } else if (lowWinNow && !lowDynasty) {
      type = "Soft Rebuild"; summary = "Strong dynasty value but weak starters. Sell peak redraft assets to accelerate contention.";
    } else if (agingRoster && !lowDynasty) {
      type = "Retool"; summary = "Your roster is aging. Lock in peak value on aging players before decline hits.";
    } else {
      type = "Productive Struggle"; summary = "Young but uncompetitive — prioritize young scorers over aging producers. The window is coming.";
    }

    return { type, winNowRank, dynastyRank, avgStarterAge, pickCapital, summary };
  }, [league, userTeam, getPlayerValue, getRedraftValue, getPickValue]);

  // ── Sell candidates: Sell High + Emergency Exit ──────────────────
  const sellCandidates = useMemo(
    () => rosterData.filter(d => d.tier === "Sell High" || d.tier === "Emergency Exit").slice(0, 6),
    [rosterData]
  );

  // ── League-wide redraft starter ranks (to identify contenders) ──
  const isContender = useCallback((teamId: string) => {
    const tier = tierMap.get(teamId)?.tier;
    return tier ? isContenderTier(tier) : false;
  }, [tierMap]);

  // ── Generate rebuild trade ideas ────────────────────────────────
  const tradeIdeas = useMemo<RebuildIdea[]>(() => {
    if (sellCandidates.length === 0) return [];
    const leagueSize = league.teams.length;
    const ideas: RebuildIdea[] = [];

    const myPicks = userTeam.picks
      .map(p => ({ ...p, val: getPickValue(p) }))
      .sort((a, b) => b.val - a.val);

    for (const partner of league.teams) {
      if (partner.id === userTeam.id) continue;
      if (!isContender(partner.id)) continue; // only sell to contenders

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
          // Dynasty fairness: we shouldn't give away more than 22% net dynasty value
          const dynOverpay = (dynGive - dynGet) / Math.max(dynGive, dynGet, 1);
          if (dynOverpay > 0.22) continue;
          // Rough redraft balance check so partner has reason to accept
          const rdDiff = Math.abs(rdGive - rdGet) / Math.max(rdGive, rdGet, 1);
          if (rdDiff > 0.35) continue;

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
          // Dynasty fairness
          const dynOverpay  = (dynGive - dynGet) / Math.max(dynGive, dynGet, 1);
          if (dynOverpay > 0.18) continue;

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
  }, [league, userTeam, sellCandidates, isContender, tierMap, getPlayerValue, getRedraftValue, getPickValue]);

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

  const profileColors: Record<RebuildProfile, string> = {
    "Full Rebuild":       "text-red-500 dark:text-red-400",
    "Soft Rebuild":       "text-amber-500 dark:text-amber-400",
    "Retool":             "text-orange-500 dark:text-orange-400",
    "Hold / Contend":     "text-emerald-500 dark:text-emerald-400",
    "Productive Struggle":"text-blue-500 dark:text-blue-400",
  };

  const tierColors: Record<AssetTier, string> = {
    "Cornerstone":    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    "Hold":           "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
    "Liquid":         "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    "Sell High":      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    "Emergency Exit": "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  };

  const ordinalAge = (n: number) => `${n}`;

  return (
    <div className="space-y-5">

      {/* ── Rebuild Profile card ── */}
      <Card className="p-5" data-testid="card-rebuild-profile">
        <div className="mb-4">
          <h4 className="text-sm font-bold">Team Rebuild Profile</h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
        </div>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <p className={cn("text-xl font-bold", profileColors[rebuildProfile.type])}>{rebuildProfile.type}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{rebuildProfile.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 flex-shrink-0 text-right">
            <div>
              <p className="text-[10px] text-muted-foreground">Win-Now Rank</p>
              <p className="text-sm font-bold">#{rebuildProfile.winNowRank}<span className="text-[10px] text-muted-foreground font-normal">/{league.teams.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Dynasty Rank</p>
              <p className="text-sm font-bold">#{rebuildProfile.dynastyRank}<span className="text-[10px] text-muted-foreground font-normal">/{league.teams.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Avg Starter Age</p>
              <p className={cn("text-sm font-bold", rebuildProfile.avgStarterAge >= 29 ? "text-red-500 dark:text-red-400" : rebuildProfile.avgStarterAge >= 27 ? "text-amber-500 dark:text-amber-400" : "text-emerald-500 dark:text-emerald-400")}>
                {rebuildProfile.avgStarterAge.toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Pick Capital</p>
              <p className="text-sm font-bold">{rebuildProfile.pickCapital.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Asset Classification ── */}
      <Card className="p-5" data-testid="card-asset-tiers">
        <div className="mb-4">
          <h4 className="text-sm font-bold">Asset Classification</h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Every player tiered by decay risk vs. dynasty insulation
          </p>
        </div>
        <div className="space-y-0">
          {rosterData.filter(d => d.dynVal > 200 || d.rdVal > 500).slice(0, 20).map((d, i) => {
            const sid = d.player.sleeperId ?? d.player.id;
            return (
              <div key={sid} className="flex items-center gap-2.5 py-2 border-b border-border/20 last:border-0" data-testid={`asset-row-${sid}`}>
                <div className="w-6 h-6 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/20">
                  <img src={`https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`} alt={d.player.name} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold truncate">{d.player.name}</span>
                    <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-3.5 flex-shrink-0", getPositionColor(d.player.pos))}>{d.player.pos}</Badge>
                    <span className="text-[9px] text-muted-foreground flex-shrink-0">Age {d.player.age}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground">{d.dynVal.toLocaleString()}</span>
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", tierColors[d.tier])}>{d.tier}</Badge>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-border/20 flex items-center gap-3 flex-wrap">
          {(["Cornerstone", "Hold", "Liquid", "Sell High", "Emergency Exit"] as AssetTier[]).map(tier => (
            <div key={tier} className="flex items-center gap-1">
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", tierColors[tier])}>{tier}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Rebuild Trade Ideas ── */}
      <div>
        <div className="mb-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            Rebuild Trade Ideas
            <Badge variant="secondary">{tradeIdeas.length}</Badge>
          </h4>
          <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Sell decay assets to contenders. Score = (dynasty gain + age curve + youth bonus) ÷ decay cost.
          </p>
        </div>

        {tradeIdeas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {sellCandidates.length === 0
                  ? "No high-decay assets detected — your roster is already well-insulated."
                  : "No rebuild trades found. Contenders may lack the young assets or picks to offer a fair return."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="rebuild-partner-list">
            {byPartner.map(({ pid, partnerTeam, partnerTier, ideas }) => {
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
                      <div className="border-t border-border/30 px-5 py-4 space-y-4">
                        {ideas.map((idea: RebuildIdea, idx: number) => (
                          <div key={idea.id} className="rounded-xl border border-border/40 overflow-hidden" data-testid={`rebuild-idea-${pid}-${idx}`}>
                            {/* Header */}
                            <div className="px-4 py-2.5 bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge
                                  variant="outline"
                                  className={cn("text-[10px] flex-shrink-0",
                                    idea.scoreLabel === "Elite"  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                                    idea.scoreLabel === "Strong" ? "bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20" :
                                                                   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                  )}
                                >
                                  {idea.scoreLabel}
                                </Badge>
                                <span className="text-xs font-medium text-foreground">{idea.headline}</span>
                              </div>
                            </div>

                            {/* You Give / You Get */}
                            <div className="grid grid-cols-2 divide-x divide-border/30">
                              {(["youGive", "youGet"] as const).map(side => (
                                <div key={side} className="px-4 py-3">
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                                    {side === "youGive" ? "You Give" : "You Get"}
                                  </p>
                                  {idea[side].map((a: RebuildIdea["youGive"][number], i: number) => (
                                    <div key={i} className="flex items-center gap-1.5 py-1 min-w-0">
                                      {a.type === "player" && a.sleeperId ? (
                                        <div className="w-5 h-5 rounded-full flex-shrink-0 overflow-hidden bg-muted">
                                          <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.sleeperId}.jpg`} alt={a.label} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                        </div>
                                      ) : a.type === "pick" ? (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">PICK</Badge>
                                      ) : null}
                                      {a.pos && <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                      <span className="text-xs font-medium truncate">{a.label}</span>
                                      {a.age && a.type === "player" && <span className="text-[9px] text-muted-foreground flex-shrink-0 ml-0.5">({a.age})</span>}
                                      <span className="text-[10px] font-mono text-muted-foreground ml-auto flex-shrink-0">{a.value.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>

                            {/* Footer — trade value breakdown for both sides */}
                            <div className="px-4 py-3 bg-muted/10 border-t border-border/20 space-y-2.5">
                              <div className="grid grid-cols-3 gap-x-2 text-[10px]">
                                <div />
                                <span className="text-muted-foreground font-semibold uppercase tracking-wide text-center">Dynasty</span>
                                <span className="text-muted-foreground font-semibold uppercase tracking-wide text-center">Win-Now</span>

                                <span className="text-muted-foreground font-medium self-center">You</span>
                                {(() => { const d = idea.dynGet - idea.dynGive; return (
                                  <span className={cn("text-center font-semibold", d >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400")}>
                                    {d >= 0 ? "+" : "−"}{Math.abs(Math.round(d)).toLocaleString()}
                                  </span>
                                ); })()}
                                {(() => { const r = idea.rdGet - idea.rdGive; return (
                                  <span className={cn("text-center font-semibold", r >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400")}>
                                    {r >= 0 ? "+" : "−"}{Math.abs(Math.round(r)).toLocaleString()}
                                  </span>
                                ); })()}

                                <span className="text-muted-foreground font-medium self-center truncate">{idea.partnerTeam.owner}</span>
                                {(() => { const d = idea.dynGive - idea.dynGet; return (
                                  <span className={cn("text-center font-semibold", d >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400")}>
                                    {d >= 0 ? "+" : "−"}{Math.abs(Math.round(d)).toLocaleString()}
                                  </span>
                                ); })()}
                                {(() => { const r = idea.partnerRdDelta; return (
                                  <span className={cn("text-center font-semibold", r >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-400")}>
                                    {r >= 0 ? "+" : "−"}{Math.abs(Math.round(r)).toLocaleString()}
                                  </span>
                                ); })()}
                              </div>
                              {idea.ageDelta < -1 && (
                                <p className="text-[10px] text-blue-400">−{Math.abs(Math.round(idea.ageDelta))} yrs avg age</p>
                              )}
                              <div className="flex justify-end">
                                <Button variant="default" size="sm" className="text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90" data-testid={`btn-rebuild-build-${pid}-${idx}`}>
                                  <ArrowRightLeft className="w-3 h-3 mr-1" />
                                  Build in Calculator
                                </Button>
                              </div>
                            </div>
                          </div>
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
    </div>
  );
}

// ─── Build Dynasty Mode (existing logic) ─────────────────────────

function BuildDynastyMode({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const { profiles } = usePositionalProfiles(league, userTeam);
  const includeStuds = true;
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);
  const tradeBlockTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const fairnessThreshold = 0.12;

  const userProfile = useMemo(() => profiles.find(p => p.teamId === userTeam.id), [profiles, userTeam]);

  const tradeBlockCandidates = useMemo(() => {
    const total = league.teams.length;
    const topThird = Math.ceil(total / 3);
    const bottomStart = total - topThird + 1;
    const rankedTeams = [...league.teams].sort((a, b) => (b.metrics?.overall ?? 0) - (a.metrics?.overall ?? 0));
    return league.teams
      .filter(t => t.id !== userTeam.id)
      .flatMap(t => {
        const dynastyRank = rankedTeams.findIndex(rt => rt.id === t.id) + 1;
        const redraftRank = [...league.teams].sort((a, b) => (b.metrics?.starters ?? 0) - (a.metrics?.starters ?? 0)).findIndex(rt => rt.id === t.id) + 1;
        const tier = tradeBlockTierMap.get(t.id)?.tier ?? "Balanced";
        const isRebuilder = isRebuilderTier(tier);
        const isDynastyStrong = dynastyRank <= topThird && redraftRank >= bottomStart;
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
  }, [league, userTeam, getRedraftValue, getPlayerValue]);

  const partnerOpportunities = useMemo(() => {
    if (!userProfile) return [];

    return profiles
      .filter(p => p.teamId !== userTeam.id)
      .map(partner => {
        const uSells = POSITIONS.filter(pos =>
          userProfile.positions[pos].status === "Surplus" && partner.positions[pos].status === "Need"
        );
        const uBuys = POSITIONS.filter(pos =>
          partner.positions[pos].status === "Surplus" && userProfile.positions[pos].status === "Need"
        );

        const tierMatch = partner.tier !== userProfile.tier;
        let matchScore = uSells.length * 2 + uBuys.length * 2 + (tierMatch ? 1 : 0);

        let fallbackSells: PosLabel[] = [];
        let fallbackBuys: PosLabel[] = [];
        if (uSells.length === 0 && uBuys.length === 0 && tierMatch) {
          const userTier = tradeBlockTierMap.get(userTeam.id)?.tier ?? "Balanced";
          if (isContenderTier(userTier)) {
            fallbackBuys = POSITIONS.filter(pos => partner.positions[pos].rank <= Math.ceil(league.teams.length * 0.4));
          } else {
            fallbackSells = POSITIONS.filter(pos => userProfile.positions[pos].rank <= Math.ceil(league.teams.length * 0.4));
          }
          if (fallbackSells.length > 0 || fallbackBuys.length > 0) matchScore = 1;
        }

        const effectiveSells = uSells.length > 0 ? uSells : fallbackSells;
        const effectiveBuys  = uBuys.length  > 0 ? uBuys  : fallbackBuys;

        const whyBadges: { label: string; type: "surplus" | "need" | "info" }[] = [];
        uSells.forEach(pos => whyBadges.push({ label: `${pos} Need (#${partner.positions[pos].rank})`, type: "need" }));
        uBuys.forEach(pos  => whyBadges.push({ label: `${pos} Surplus (#${partner.positions[pos].rank})`, type: "surplus" }));
        if (uSells.length === 0 && uBuys.length === 0 && tierMatch) {
          whyBadges.push({ label: "Tier Match", type: "info" });
        }
        if (partner.pickStrength === "High") whyBadges.push({ label: "Picks Rich", type: "info" });
        if (tierMatch) whyBadges.push({ label: partner.tier, type: "info" });

        const suggestions = generateSuggestions(
          userTeam, partner.team, userProfile, partner,
          effectiveSells, effectiveBuys, getPlayerValue, getPickValue, includeStuds, fairnessThreshold,
          tradeBlockTierMap.get(userTeam.id)?.tier ?? "Balanced",
          tradeBlockTierMap.get(partner.teamId)?.tier ?? "Balanced"
        );

        return { partner, uSells: effectiveSells, uBuys: effectiveBuys, matchScore, whyBadges, suggestions };
      })
      .filter(o => o.matchScore > 0 && o.suggestions.length > 0)
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [profiles, userTeam, userProfile, getPlayerValue, getPickValue, league]);

  return (
    <div className="space-y-5">
      {userProfile && (
        <Card className="bg-muted/20">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-2">Your positional profile:</p>
            <div className="flex items-center gap-3 flex-wrap">
              {POSITIONS.map(pos => {
                const p = userProfile.positions[pos];
                return (
                  <Badge key={pos} variant="outline" className={cn("text-xs", getStatusColor(p.status))} data-testid={`my-status-${pos}`}>
                    {pos}: {p.status} (#{p.rank})
                  </Badge>
                );
              })}
              <Badge variant="outline" className={cn("text-xs",
                userProfile.pickStrength === "High" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                userProfile.pickStrength === "Low"  ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" :
                "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
              )}>
                Picks: {userProfile.pickStrength}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {partnerOpportunities.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No clear market matches found based on current surplus/need profiles.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3" data-testid="partner-opportunities">
        {partnerOpportunities.map(opp => {
          const isExpanded = expandedPartner === opp.partner.teamId;
          return (
            <Card key={opp.partner.teamId} className="overflow-hidden" data-testid={`partner-card-${opp.partner.teamId}`}>
              <CardContent className="p-0">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => setExpandedPartner(isExpanded ? null : opp.partner.teamId)}
                  data-testid={`btn-expand-${opp.partner.teamId}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {opp.partner.team.avatar ? (
                      <img
                        src={opp.partner.team.avatar}
                        alt={opp.partner.team.owner}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 ring-1 ring-border/30">
                        <span className="text-sm font-bold text-muted-foreground">{opp.partner.team.owner.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{opp.partner.team.owner}</span>
                        <Badge variant="outline" className={cn("text-[10px]", getTierColor(opp.partner.tier))}>{opp.partner.tier}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {opp.whyBadges.map((b, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className={cn("text-[9px] py-0",
                              b.type === "need"    ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" :
                              b.type === "surplus" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                              "bg-slate-500/10 text-slate-500 border-slate-500/20"
                            )}
                          >
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{opp.suggestions.length} idea{opp.suggestions.length !== 1 ? "s" : ""}</span>
                    <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/30 px-5 py-4 space-y-4">
                    {opp.suggestions.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No trade ideas could be generated for this partner. Try selecting a different league or check back after roster changes.
                      </p>
                    )}
                    {opp.suggestions.map((sug, idx) => (
                      <div key={sug.id} className="rounded-xl border border-border/40 overflow-hidden" data-testid={`suggestion-${opp.partner.teamId}-${idx}`}>
                        <div className="px-4 py-2.5 bg-muted/20 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] bg-[#0b3a7a]/10 text-[#0b3a7a] dark:text-blue-400 border-[#0b3a7a]/20">{sug.template}</Badge>
                            <span className="text-xs text-foreground font-medium">{sug.headline}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]",
                              sug.fairness === "Fair"       ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                              sug.fairness === "Reasonable" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" :
                              "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
                            )}
                            data-testid={`fairness-${opp.partner.teamId}-${idx}`}
                          >
                            {sug.fairness}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-border/30">
                          <div className="px-4 py-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">You Give</p>
                            {sug.youGive.map((a, i) => (
                              <div key={i} className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {a.type === "player" && a.sleeperId ? (
                                    <div className="w-6 h-6 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/30">
                                      <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.sleeperId}.jpg`} alt={a.label} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                    </div>
                                  ) : a.type === "pick" ? (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">PICK</Badge>
                                  ) : null}
                                  {a.pos && a.type === "player" && <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                  <span className="text-xs font-medium text-foreground truncate">{a.label}</span>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0 ml-1">{a.value.toLocaleString()}</span>
                              </div>
                            ))}
                            <div className="mt-2 pt-2 border-t border-border/20 flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">Raw</span>
                              <span className="text-xs font-mono font-semibold">{sug.rawSide1.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">Adjusted</span>
                              <span className="text-xs font-mono font-semibold">{Math.round(sug.adjustedSide1).toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">You Get</p>
                            {sug.youGet.map((a, i) => (
                              <div key={i} className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {a.type === "player" && a.sleeperId ? (
                                    <div className="w-6 h-6 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/30">
                                      <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.sleeperId}.jpg`} alt={a.label} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                    </div>
                                  ) : a.type === "pick" ? (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">PICK</Badge>
                                  ) : null}
                                  {a.pos && a.type === "player" && <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                  <span className="text-xs font-medium text-foreground truncate">{a.label}</span>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0 ml-1">{a.value.toLocaleString()}</span>
                              </div>
                            ))}
                            <div className="mt-2 pt-2 border-t border-border/20 flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">Raw</span>
                              <span className="text-xs font-mono font-semibold">{sug.rawSide2.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">Adjusted</span>
                              <span className="text-xs font-mono font-semibold">{Math.round(sug.adjustedSide2).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="px-4 py-2.5 bg-muted/10 flex items-center justify-between flex-wrap gap-2 border-t border-border/20">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {sug.reasons.map((r, i) => (
                              <span key={i} className="text-[10px] text-muted-foreground">{r}</span>
                            ))}
                          </div>
                          <Button variant="default" size="sm" className="text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90" data-testid={`btn-build-trade-${opp.partner.teamId}-${idx}`}>
                            <ArrowRightLeft className="w-3 h-3 mr-1" />
                            Build in Calculator
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="p-6" data-testid="card-trade-block-candidates">
        <div className="mb-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            Trade Block Candidates
            <Badge variant="secondary">{tradeBlockCandidates.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-2">
            Veteran players (27+) on rebuilding or dynasty-heavy teams with strong redraft value. Likely trade targets.
          </p>
        </div>
        <div className="space-y-0">
          {tradeBlockCandidates.length === 0 && <p className="text-xs text-muted-foreground">No trade block candidates found</p>}
          {tradeBlockCandidates.slice(0, 20).map((p, i) => {
            const sleeperId = p.sleeperId ?? p.id;
            return (
            <div key={`${sleeperId}-${i}`} className="flex items-center gap-2 py-2.5 border-b border-border/20 last:border-0" data-testid={`trade-block-candidate-${sleeperId}`}>
              <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
              <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/30">
                <img src={`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`} alt={p.name} className="w-full h-full object-cover object-top" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold leading-tight">{p.name}</p>
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 flex-shrink-0 ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {p.ownerName} · Age {p.age}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums">{p.redraftVal.toLocaleString()}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", p.reason === "Rebuilder" ? getTierColor("Future Powerhouse") : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700")}>
                  {p.reason}
                </Badge>
              </div>
            </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}


function generateSuggestions(
  userTeam: Team,
  partnerTeam: Team,
  userProfile: TeamPosProfile,
  partnerProfile: TeamPosProfile,
  uSells: PosLabel[],
  uBuys: PosLabel[],
  getPlayerValue: (p: Player) => number,
  getPickValue: (p: Pick) => number,
  includeStuds: boolean,
  fairnessThreshold: number,
  userTier: Tier,
  partnerTier: Tier,
): TradeSuggestion[] {
  const suggestions: TradeSuggestion[] = [];

  const fairBand = 0.05;
  const reasonableBand = 0.10;

  const mySellCandidates = uSells.flatMap(pos => {
    const players = [...userTeam.roster]
      .filter(p => p.pos === pos)
      .map(p => ({ ...p, val: getPlayerValue(p) }))
      .sort((a, b) => b.val - a.val);
    const startIdx = includeStuds ? 1 : 2;
    return players.slice(startIdx, 6).filter(p => p.val > 100);
  });

  const theirBuyCandidates = uBuys.flatMap(pos => {
    const players = [...partnerTeam.roster]
      .filter(p => p.pos === pos)
      .map(p => ({ ...p, val: getPlayerValue(p) }))
      .sort((a, b) => b.val - a.val);
    const startIdx = includeStuds ? 0 : 1;
    return players.slice(startIdx, 5).filter(p => p.val > 100);
  });

  const myPicks = userTeam.picks.map(p => ({ ...p, val: getPickValue(p) })).sort((a, b) => b.val - a.val);
  const theirPicks = partnerTeam.picks.map(p => ({ ...p, val: getPickValue(p) })).sort((a, b) => b.val - a.val);

  function checkFairness(side1Values: number[], side2Values: number[], applyTierPremium = false): { fair: boolean; fairness: "Fair" | "Reasonable" | "Aggressive"; rawS1: number; rawS2: number; adjS1: number; adjS2: number } {
    let rawS1 = side1Values.reduce((s, v) => s + v, 0);
    let rawS2 = side2Values.reduce((s, v) => s + v, 0);
    const adjS1 = adjustedTotal(side1Values);
    const adjS2 = adjustedTotal(side2Values);

    if (applyTierPremium && isRebuilderTier(partnerTier)) {
      const premiumNeeded = rawS2 * 0.05;
      if (rawS1 < rawS2 + premiumNeeded) {
        return { fair: false, fairness: "Aggressive", rawS1, rawS2, adjS1, adjS2 };
      }
    }

    const maxRaw = Math.max(rawS1, rawS2, 1);
    const rawDiff = Math.abs(rawS1 - rawS2) / maxRaw;
    const maxAdj = Math.max(adjS1, adjS2, 1);
    const adjDiff = Math.abs(adjS1 - adjS2) / maxAdj;
    const diff = Math.max(rawDiff, adjDiff);

    if (diff <= fairBand) return { fair: true, fairness: "Fair", rawS1, rawS2, adjS1, adjS2 };
    if (diff <= reasonableBand) return { fair: true, fairness: "Reasonable", rawS1, rawS2, adjS1, adjS2 };
    if (diff <= fairnessThreshold) return { fair: true, fairness: "Aggressive", rawS1, rawS2, adjS1, adjS2 };
    return { fair: false, fairness: "Aggressive", rawS1, rawS2, adjS1, adjS2 };
  }

  for (const sell of mySellCandidates.slice(0, 4)) {
    for (const buy of theirBuyCandidates.slice(0, 4)) {
      const isBestPlayer = buy.val >= Math.max(...partnerTeam.roster.map(p => getPlayerValue(p))) * 0.9;
      const check = checkFairness([sell.val], [buy.val], isBestPlayer);
      if (check.fair && suggestions.length < 6) {
        suggestions.push({
          id: `1for1-${sell.id}-${buy.id}`,
          template: "1-for-1",
          headline: `${sell.pos} → ${buy.pos} swap`,
          youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player", sleeperId: sell.sleeperId }],
          youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId }],
          rawSide1: check.rawS1, rawSide2: check.rawS2,
          adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
          fairness: check.fairness,
          reasons: [
            `They need ${sell.pos} (#${partnerProfile.positions[sell.pos as PosLabel]?.rank || "?"})`,
            `You need ${buy.pos} (#${userProfile.positions[buy.pos as PosLabel]?.rank || "?"})`,
          ],
        });
      }
    }
  }

  for (const sell of mySellCandidates.slice(0, 3)) {
    for (const buy of theirBuyCandidates.slice(0, 3)) {
      if (buy.val > sell.val) {
        const gap = buy.val - sell.val;
        const bestPick = myPicks.find(p => p.val >= gap * 0.5 && p.val <= gap * 1.5);
        if (bestPick) {
          const check = checkFairness([sell.val, bestPick.val], [buy.val]);
          if (check.fair && suggestions.length < 8) {
            suggestions.push({
              id: `pickbal-${sell.id}-${buy.id}`,
              template: "Player + Pick",
              headline: `${sell.pos} + Pick → ${buy.pos} upgrade`,
              youGive: [
                { label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player", sleeperId: sell.sleeperId },
                { label: `${bestPick.year} Rd ${bestPick.round} (${bestPick.projectedRange || "Mid"})`, value: bestPick.val, type: "pick" },
              ],
              youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId }],
              rawSide1: check.rawS1, rawSide2: check.rawS2,
              adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
              fairness: check.fairness,
              reasons: [
                `Upgrade at ${buy.pos}`,
                `They need ${sell.pos} + capital`,
              ],
            });
          }
        }
      }
    }
  }

  if (isContenderTier(userTier) && (isRebuilderTier(partnerTier) || partnerTier === "Balanced")) {
    for (const buy of theirBuyCandidates.slice(0, 2)) {
      const twoSells = mySellCandidates
        .filter(s => s.val < buy.val * 0.8)
        .slice(0, 2);
      if (twoSells.length === 2) {
        const check = checkFairness(twoSells.map(s => s.val), [buy.val], true);
        if (check.fair && suggestions.length < 10) {
          suggestions.push({
            id: `consolidation-${buy.id}`,
            template: "2-for-1",
            headline: `Consolidate depth → ${buy.pos} stud`,
            youGive: twoSells.map(s => ({ label: s.name, value: s.val, pos: s.pos, age: s.age, type: "player" as const, sleeperId: s.sleeperId })),
            youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId }],
            rawSide1: check.rawS1, rawSide2: check.rawS2,
            adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
            fairness: check.fairness,
            reasons: [
              `They're ${partnerTier}, want depth`,
              `You consolidate for a starter`,
            ],
          });
        }
      }
    }
  }

  if ((isRebuilderTier(userTier) || userTier === "Balanced") && isContenderTier(partnerTier)) {
    const oldSells = mySellCandidates
      .filter(s => (s.pos === "RB" && s.age >= 26) || (s.pos !== "RB" && s.age >= 27))
      .slice(0, 3);
    const youngBuys = theirBuyCandidates
      .filter(b => (b.pos === "RB" && b.age <= 24) || (b.pos !== "RB" && b.age <= 25))
      .slice(0, 3);

    for (const sell of oldSells) {
      for (const buy of youngBuys) {
        if (sell.val > buy.val * 0.6) {
          const gap = sell.val - buy.val;
          const balancePick = gap > 200 ? theirPicks.find(p => p.val >= gap * 0.3 && p.val <= gap * 1.5) : null;
          const side2: number[] = [buy.val];
          const getItems: TradeSuggestion["youGet"] = [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId }];
          if (balancePick) {
            side2.push(balancePick.val);
            getItems.push({ label: `${balancePick.year} Rd ${balancePick.round} (${balancePick.projectedRange || "Mid"})`, value: balancePick.val, type: "pick" });
          }
          const check = checkFairness([sell.val], side2);
          if (check.fair && suggestions.length < 10) {
            suggestions.push({
              id: `rebuild-${sell.id}-${buy.id}`,
              template: "Rebuild Flip",
              headline: `Sell ${sell.name} → youth + capital`,
              youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player", sleeperId: sell.sleeperId }],
              youGet: getItems,
              rawSide1: check.rawS1, rawSide2: check.rawS2,
              adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
              fairness: check.fairness,
              reasons: [
                `Sell aging ${sell.pos} (${sell.age})`,
                `Get younger at ${buy.pos} (${buy.age})`,
              ],
            });
          }
        }
      }
    }
  }

  if (myPicks.length > 0 && theirPicks.length > 0) {
    for (const sell of mySellCandidates.slice(0, 3)) {
      for (const buy of theirBuyCandidates.slice(0, 3)) {
        const playerDiff = buy.val - sell.val;
        if (Math.abs(playerDiff) > buy.val * 0.15) {
          if (playerDiff > 0) {
            const balancePick = theirPicks.find(p => p.val >= playerDiff * 0.3 && p.val <= playerDiff * 2);
            if (balancePick) {
              const check = checkFairness([sell.val], [buy.val, balancePick.val]);
              if (!check.fair) {
                const myBalancePick = myPicks.find(p => p.val >= playerDiff * 0.3 && p.val <= playerDiff * 1.5);
                if (myBalancePick) {
                  const check2 = checkFairness([sell.val, myBalancePick.val], [buy.val]);
                  if (check2.fair && suggestions.length < 10) {
                    suggestions.push({
                      id: `pickswap-${sell.id}-${buy.id}`,
                      template: "Pick Swap",
                      headline: `${sell.pos} + pick → ${buy.pos}`,
                      youGive: [
                        { label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player", sleeperId: sell.sleeperId },
                        { label: `${myBalancePick.year} Rd ${myBalancePick.round} (${myBalancePick.projectedRange || "Mid"})`, value: myBalancePick.val, type: "pick" },
                      ],
                      youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId }],
                      rawSide1: check2.rawS1, rawSide2: check2.rawS2,
                      adjustedSide1: check2.adjS1, adjustedSide2: check2.adjS2,
                      fairness: check2.fairness,
                      reasons: [`Picks balance the value gap`, `${buy.pos} upgrade`],
                    });
                  }
                }
              }
            }
          } else {
            const balancePick = theirPicks.find(p => p.val >= Math.abs(playerDiff) * 0.3 && p.val <= Math.abs(playerDiff) * 1.5);
            if (balancePick) {
              const check = checkFairness([sell.val], [buy.val, balancePick.val]);
              if (check.fair && suggestions.length < 10) {
                suggestions.push({
                  id: `pickswap-${sell.id}-${buy.id}`,
                  template: "Pick Swap",
                  headline: `${sell.pos} → ${buy.pos} + pick`,
                  youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player", sleeperId: sell.sleeperId }],
                  youGet: [
                    { label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player", sleeperId: buy.sleeperId },
                    { label: `${balancePick.year} Rd ${balancePick.round} (${balancePick.projectedRange || "Mid"})`, value: balancePick.val, type: "pick" },
                  ],
                  rawSide1: check.rawS1, rawSide2: check.rawS2,
                  adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
                  fairness: check.fairness,
                  reasons: [`Pick balances value gap`, `${buy.pos} need filled`],
                });
              }
            }
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  return suggestions.filter(s => {
    const key = [...s.youGive.map(a => a.label), "→", ...s.youGet.map(a => a.label)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

