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
  ArrowRightLeft, Target, TrendingUp, TrendingDown,
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
  const [activeSubTab, setActiveSubTab] = useState<"surplus" | "opportunities">("surplus");
  const { getPlayerValue, getRedraftValue } = useValueModel();

  const positionalProfile = useMemo(() => {
    const leagueSize = league.teams.length;
    const topThird = Math.ceil(leagueSize / 3);
    const bottomThird = leagueSize - topThird;

    const dynRanks: Record<string, number> = {};
    const rdRanks: Record<string, number> = {};

    POSITIONS.forEach(pos => {
      const byDyn = [...league.teams].sort((a, b) =>
        b.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getPlayerValue(p), 0) -
        a.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getPlayerValue(p), 0)
      );
      const byRd = [...league.teams].sort((a, b) =>
        b.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0) -
        a.roster.filter(p => p.pos === pos && p.starter).reduce((s, p) => s + getRedraftValue(p), 0)
      );
      byDyn.forEach((t, i) => { if (t.id === userTeam.id) dynRanks[pos] = i + 1; });
      byRd.forEach((t, i)  => { if (t.id === userTeam.id) rdRanks[pos]  = i + 1; });
    });

    const rankTier = (rank: number) =>
      rank <= topThird ? "top" : rank > bottomThird ? "bottom" : "mid";

    return { dynRanks, rdRanks, leagueSize, rankTier };
  }, [league, userTeam, getPlayerValue, getRedraftValue]);

  const subTabs = [
    { id: "surplus" as const, label: "Analysis", icon: Scale },
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

      {activeSubTab === "surplus" && <SurplusNeeds league={league} userTeam={userTeam} onSwitchTab={setActiveSubTab} />}
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

function TradeOpportunities({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const { profiles } = usePositionalProfiles(league, userTeam);
  const [aggressiveness, setAggressiveness] = useState<"conservative" | "balanced" | "aggressive">("balanced");
  const [includeStuds, setIncludeStuds] = useState(true);
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);
  const tradeBlockTierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const fairnessThreshold = aggressiveness === "conservative" ? 0.08 : aggressiveness === "balanced" ? 0.12 : 0.18;

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
        const effectiveBuys = uBuys.length > 0 ? uBuys : fallbackBuys;

        const whyBadges: { label: string; type: "surplus" | "need" | "info" }[] = [];
        uSells.forEach(pos => whyBadges.push({ label: `${pos} Need (#${partner.positions[pos].rank})`, type: "need" }));
        uBuys.forEach(pos => whyBadges.push({ label: `${pos} Surplus (#${partner.positions[pos].rank})`, type: "surplus" }));
        if (uSells.length === 0 && uBuys.length === 0 && tierMatch) {
          whyBadges.push({ label: "Tier Match", type: "info" });
        }
        if (partner.pickStrength === "High") whyBadges.push({ label: "Picks Rich", type: "info" });
        if (tierMatch) whyBadges.push({ label: partner.tier, type: "info" });

        const suggestions = generateSuggestions(
          userTeam, partner.team, userProfile, partner,
          effectiveSells, effectiveBuys, getPlayerValue, getPickValue, includeStuds, fairnessThreshold, aggressiveness,
          tradeBlockTierMap.get(userTeam.id)?.tier ?? "Balanced",
          tradeBlockTierMap.get(partner.teamId)?.tier ?? "Balanced"
        );

        return {
          partner,
          uSells: effectiveSells,
          uBuys: effectiveBuys,
          matchScore,
          whyBadges,
          suggestions,
        };
      })
      .filter(o => o.matchScore > 0 && o.suggestions.length > 0)
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [profiles, userTeam, userProfile, getPlayerValue, getPickValue, includeStuds, fairnessThreshold, aggressiveness, league]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            {(["conservative", "balanced", "aggressive"] as const).map(level => (
              <button
                key={level}
                onClick={() => setAggressiveness(level)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  aggressiveness === level
                    ? "bg-[#0b3a7a] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                )}
                data-testid={`btn-aggr-${level}`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Include Studs</label>
          <Switch checked={includeStuds} onCheckedChange={setIncludeStuds} data-testid="switch-include-studs" />
        </div>
      </div>

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
                userProfile.pickStrength === "Low" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" :
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
                              b.type === "need" ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" :
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
                        No trade ideas could be generated within the {aggressiveness} fairness band. Try adjusting settings.
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
                              sug.fairness === "Fair" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
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
                <img
                  src={`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`}
                  alt={p.name}
                  className="w-full h-full object-cover object-top"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
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
  aggressiveness: "conservative" | "balanced" | "aggressive",
  userTier: Tier,
  partnerTier: Tier,
): TradeSuggestion[] {
  const suggestions: TradeSuggestion[] = [];

  const fairBand = aggressiveness === "conservative" ? 0.04 : aggressiveness === "balanced" ? 0.05 : 0.07;
  const reasonableBand = aggressiveness === "conservative" ? 0.08 : aggressiveness === "balanced" ? 0.10 : 0.13;

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

