import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getTeamTier, getTierColor, getPositionColor } from "@/data/mockData";
import { cn } from "@/lib/utils";
import type { League, Team, Player, Pick, Tier } from "@/types";
import {
  BarChart3, ArrowRightLeft, Target, Users, TrendingUp, TrendingDown,
  ChevronRight, Zap, Shield, Scale
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
  youGive: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick" }[];
  youGet: { label: string; value: number; pos?: string; age?: number; type: "player" | "pick" }[];
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
  const [activeSubTab, setActiveSubTab] = useState<"overview" | "surplus" | "opportunities" | "targets">("overview");

  const subTabs = [
    { id: "overview" as const, label: "Position Overview", icon: BarChart3 },
    { id: "surplus" as const, label: "Surplus & Needs", icon: Scale },
    { id: "opportunities" as const, label: "Trade Opportunities", icon: ArrowRightLeft },
    { id: "targets" as const, label: "Targets", icon: Target },
  ];

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

      <div className="flex items-center gap-1 border-b border-border/50 pb-0" data-testid="positional-sub-tabs">
        {subTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px]",
                activeSubTab === tab.id
                  ? "border-[#0b3a7a] text-[#0b3a7a] dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSubTab === "overview" && <PositionOverview league={league} userTeam={userTeam} />}
      {activeSubTab === "surplus" && <SurplusNeeds league={league} userTeam={userTeam} onSwitchTab={setActiveSubTab} />}
      {activeSubTab === "opportunities" && <TradeOpportunities league={league} userTeam={userTeam} />}
      {activeSubTab === "targets" && <PlayerTargets league={league} userTeam={userTeam} />}
    </div>
  );
}

function usePositionalProfiles(league: League, userTeam: Team) {
  const { getPlayerValue, getPickValue } = useValueModel();

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
      const tier = getTeamTier(team.metrics.overall);
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
  }, [league, userTeam, getPlayerValue, getPickValue]);
}

function PositionOverview({ league, userTeam }: { league: League; userTeam: Team }) {
  const { profiles, total } = usePositionalProfiles(league, userTeam);

  const sorted = useMemo(() =>
    [...profiles].sort((a, b) => b.team.metrics.overall - a.team.metrics.overall),
  [profiles]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="position-overview-table">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground sticky left-0 bg-muted/30 z-10">Team</th>
                  <th className="px-3 py-3 text-center font-semibold text-muted-foreground w-16">Tier</th>
                  {POSITIONS.map(pos => (
                    <th key={pos} className="px-3 py-3 text-center font-semibold text-muted-foreground w-24">{pos}</th>
                  ))}
                  <th className="px-3 py-3 text-center font-semibold text-muted-foreground w-20">Picks</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((profile) => {
                  const isUser = profile.teamId === userTeam.id;
                  return (
                    <tr
                      key={profile.teamId}
                      className={cn(
                        "border-b border-border/20 hover:bg-muted/20",
                        isUser && "bg-blue-50/50 dark:bg-blue-950/20"
                      )}
                      data-testid={`overview-row-${profile.teamId}`}
                    >
                      <td className={cn("px-4 py-2.5 sticky left-0 z-10", isUser ? "bg-blue-50/50 dark:bg-blue-950/20" : "bg-background")}>
                        <div className="flex items-center gap-2">
                          {isUser && <div className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />}
                          <span className={cn("font-semibold text-foreground", isUser && "text-[#0b3a7a] dark:text-blue-400")}>
                            {profile.team.owner}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={cn("text-[10px]", getTierColor(profile.tier))}>{profile.tier}</Badge>
                      </td>
                      {POSITIONS.map(pos => {
                        const p = profile.positions[pos];
                        return (
                          <td key={pos} className={cn("px-3 py-2.5 text-center", getStatusCellBg(p.status))}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-block">
                                  <Badge variant="outline" className={cn("text-[10px] font-semibold", getStatusColor(p.status))} data-testid={`status-${profile.teamId}-${pos}`}>
                                    {p.status}
                                  </Badge>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                <p className="font-semibold">{profile.team.owner} — {pos}</p>
                                <p>Rank: #{p.rank} / {total}</p>
                                <p>Strength: {Math.round(p.totalStrength).toLocaleString()}</p>
                                <p>vs Median: {p.surplusAmount > 0 ? "+" : ""}{p.surplusAmount.toLocaleString()}</p>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={cn("text-[10px] font-semibold",
                          profile.pickStrength === "High" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                          profile.pickStrength === "Low" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" :
                          "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
                        )} data-testid={`picks-${profile.teamId}`}>
                          {profile.pickStrength}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30" /> Surplus (top 25%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-slate-500/10 border border-slate-500/20" /> Neutral (middle 50%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/30" /> Need (bottom 25%)
        </span>
      </div>
    </div>
  );
}

function SurplusNeeds({ league, userTeam, onSwitchTab }: { league: League; userTeam: Team; onSwitchTab: (tab: "opportunities") => void }) {
  const [selectedPos, setSelectedPos] = useState<PosLabel>("RB");
  const { profiles, total } = usePositionalProfiles(league, userTeam);

  const { surplusTeams, needTeams } = useMemo(() => {
    const surplus = profiles
      .filter(p => p.positions[selectedPos].status === "Surplus")
      .sort((a, b) => a.positions[selectedPos].rank - b.positions[selectedPos].rank);
    const need = profiles
      .filter(p => p.positions[selectedPos].status === "Need")
      .sort((a, b) => a.positions[selectedPos].rank - b.positions[selectedPos].rank);
    return { surplusTeams: surplus, needTeams: need };
  }, [profiles, selectedPos]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2" data-testid="surplus-pos-chips">
        {POSITIONS.map(pos => (
          <button
            key={pos}
            onClick={() => setSelectedPos(pos)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors border",
              selectedPos === pos
                ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                : "bg-background text-muted-foreground border-border hover:bg-muted/50"
            )}
            data-testid={`chip-${pos.toLowerCase()}`}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-semibold text-foreground">{selectedPos} Surplus Teams</h3>
              <Badge variant="secondary" className="text-xs">{surplusTeams.length}</Badge>
            </div>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mb-4" />
            {surplusTeams.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No teams with {selectedPos} surplus</p>}
            {surplusTeams.map(profile => {
              const p = profile.positions[selectedPos];
              const isUser = profile.teamId === userTeam.id;
              return (
                <div
                  key={profile.teamId}
                  className={cn("flex items-center justify-between py-3 border-b border-border/20 last:border-0", isUser && "bg-blue-50/30 dark:bg-blue-950/10 -mx-2 px-2 rounded")}
                  data-testid={`surplus-team-${profile.teamId}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isUser && <div className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />}
                    <div>
                      <span className="text-sm font-semibold text-foreground">{profile.team.owner}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">#{p.rank}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">+{p.surplusAmount.toLocaleString()}</span>
                        <Badge variant="outline" className={cn("text-[9px]", getTierColor(profile.tier))}>{profile.tier}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right mr-2">
                      <p className="text-xs text-muted-foreground">Top players</p>
                      <p className="text-[10px] text-foreground font-medium truncate max-w-[140px]">
                        {p.starterPlayers.slice(0, 2).map(pl => pl.name.split(" ").pop()).join(", ")}
                      </p>
                    </div>
                    {!isUser && (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => onSwitchTab("opportunities")} data-testid={`btn-find-deals-${profile.teamId}`}>
                        Find Deals
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="w-4 h-4 text-red-500 dark:text-red-400" />
              <h3 className="font-semibold text-foreground">{selectedPos} Need Teams</h3>
              <Badge variant="secondary" className="text-xs">{needTeams.length}</Badge>
            </div>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mb-4" />
            {needTeams.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No teams with {selectedPos} need</p>}
            {needTeams.map(profile => {
              const p = profile.positions[selectedPos];
              const isUser = profile.teamId === userTeam.id;
              return (
                <div
                  key={profile.teamId}
                  className={cn("flex items-center justify-between py-3 border-b border-border/20 last:border-0", isUser && "bg-blue-50/30 dark:bg-blue-950/10 -mx-2 px-2 rounded")}
                  data-testid={`need-team-${profile.teamId}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isUser && <div className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />}
                    <div>
                      <span className="text-sm font-semibold text-foreground">{profile.team.owner}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">#{p.rank}</span>
                        <span className="text-xs text-red-500 dark:text-red-400 font-medium">{p.surplusAmount.toLocaleString()}</span>
                        <Badge variant="outline" className={cn("text-[9px]", getTierColor(profile.tier))}>{profile.tier}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right mr-2">
                      <p className="text-xs text-muted-foreground">Top players</p>
                      <p className="text-[10px] text-foreground font-medium truncate max-w-[140px]">
                        {p.starterPlayers.slice(0, 2).map(pl => pl.name.split(" ").pop()).join(", ")}
                      </p>
                    </div>
                    {!isUser && (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => onSwitchTab("opportunities")} data-testid={`btn-find-deals-need-${profile.teamId}`}>
                        Find Deals
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TradeOpportunities({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const { profiles } = usePositionalProfiles(league, userTeam);
  const [aggressiveness, setAggressiveness] = useState<"conservative" | "balanced" | "aggressive">("balanced");
  const [includeStuds, setIncludeStuds] = useState(false);
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);

  const fairnessThreshold = aggressiveness === "conservative" ? 0.08 : aggressiveness === "balanced" ? 0.12 : 0.18;

  const userProfile = useMemo(() => profiles.find(p => p.teamId === userTeam.id), [profiles, userTeam]);

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
          const userTier = getTeamTier(userTeam.metrics.overall);
          if (userTier === "Contender" || userTier === "Elite") {
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
          effectiveSells, effectiveBuys, getPlayerValue, getPickValue, includeStuds, fairnessThreshold, aggressiveness
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
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-muted-foreground" />
                    </div>
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
                                <div className="flex items-center gap-1.5">
                                  {a.pos && <Badge variant="outline" className={cn("text-[9px] px-1 py-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                  {a.type === "pick" && <Badge variant="outline" className="text-[9px] px-1 py-0">PICK</Badge>}
                                  <span className="text-xs font-medium text-foreground">{a.label}</span>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground">{a.value.toLocaleString()}</span>
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
                                <div className="flex items-center gap-1.5">
                                  {a.pos && <Badge variant="outline" className={cn("text-[9px] px-1 py-0", getPositionColor(a.pos))}>{a.pos}</Badge>}
                                  {a.type === "pick" && <Badge variant="outline" className="text-[9px] px-1 py-0">PICK</Badge>}
                                  <span className="text-xs font-medium text-foreground">{a.label}</span>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground">{a.value.toLocaleString()}</span>
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

  const userTier = getTeamTier(userTeam.metrics.overall);
  const partnerTier = getTeamTier(partnerTeam.metrics.overall);

  function checkFairness(side1Values: number[], side2Values: number[], applyTierPremium = false): { fair: boolean; fairness: "Fair" | "Reasonable" | "Aggressive"; rawS1: number; rawS2: number; adjS1: number; adjS2: number } {
    let rawS1 = side1Values.reduce((s, v) => s + v, 0);
    let rawS2 = side2Values.reduce((s, v) => s + v, 0);
    const adjS1 = adjustedTotal(side1Values);
    const adjS2 = adjustedTotal(side2Values);

    if (applyTierPremium && (partnerTier === "Rebuild")) {
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
          youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player" }],
          youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" }],
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
                { label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player" },
                { label: `${bestPick.year} Rd ${bestPick.round} (${bestPick.projectedRange || "Mid"})`, value: bestPick.val, type: "pick" },
              ],
              youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" }],
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

  if ((userTier === "Elite" || userTier === "Contender") && (partnerTier === "Rebuild" || partnerTier === "Competitive")) {
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
            youGive: twoSells.map(s => ({ label: s.name, value: s.val, pos: s.pos, age: s.age, type: "player" as const })),
            youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" }],
            rawSide1: check.rawS1, rawSide2: check.rawS2,
            adjustedSide1: check.adjS1, adjustedSide2: check.adjS2,
            fairness: check.fairness,
            reasons: [
              `They're ${partnerTier} — want depth`,
              `You consolidate for a starter`,
            ],
          });
        }
      }
    }
  }

  if ((userTier === "Rebuild" || userTier === "Competitive") && (partnerTier === "Contender" || partnerTier === "Elite")) {
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
          const getItems: TradeSuggestion["youGet"] = [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" }];
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
              youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player" }],
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
                        { label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player" },
                        { label: `${myBalancePick.year} Rd ${myBalancePick.round} (${myBalancePick.projectedRange || "Mid"})`, value: myBalancePick.val, type: "pick" },
                      ],
                      youGet: [{ label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" }],
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
                  youGive: [{ label: sell.name, value: sell.val, pos: sell.pos, age: sell.age, type: "player" }],
                  youGet: [
                    { label: buy.name, value: buy.val, pos: buy.pos, age: buy.age, type: "player" },
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

function PlayerTargets({ league, userTeam }: { league: League; userTeam: Team }) {
  const [selectedPos, setSelectedPos] = useState<PosLabel>("RB");
  const { profiles } = usePositionalProfiles(league, userTeam);
  const { getPlayerValue } = useValueModel();

  const userProfile = useMemo(() => profiles.find(p => p.teamId === userTeam.id), [profiles, userTeam]);
  const userTier = getTeamTier(userTeam.metrics.overall);

  const buyTargets = useMemo(() => {
    const surplusTeams = profiles.filter(p =>
      p.teamId !== userTeam.id && p.positions[selectedPos].status === "Surplus"
    );

    return surplusTeams
      .flatMap(profile => {
        const posPlayers = [...profile.team.roster]
          .filter(p => p.pos === selectedPos)
          .map(p => ({ ...p, val: getPlayerValue(p) }))
          .sort((a, b) => b.val - a.val);

        return posPlayers.slice(1, 5).filter(p => p.val > 200).map(p => ({
          ...p,
          ownerName: profile.team.owner,
          ownerTier: profile.tier,
          teamName: profile.team.name,
          posRank: profile.positions[selectedPos].rank,
        }));
      })
      .sort((a, b) => b.val - a.val)
      .slice(0, 15);
  }, [profiles, selectedPos, userTeam, getPlayerValue]);

  const sellCandidates = useMemo(() => {
    if (!userProfile || userProfile.positions[selectedPos].status !== "Surplus") return [];

    return [...userTeam.roster]
      .filter(p => p.pos === selectedPos)
      .map(p => ({ ...p, val: getPlayerValue(p) }))
      .sort((a, b) => b.val - a.val)
      .slice(2)
      .filter(p => p.val > 100);
  }, [userTeam, userProfile, selectedPos, getPlayerValue]);

  const buyStrategy = userTier === "Contender" || userTier === "Elite" ? "Buy production (high redraft value)" : "Buy youth & upside";
  const sellStrategy = userTier === "Rebuild" ? "Sell older players for picks & youth" : "Move depth for upgrades";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2" data-testid="targets-pos-chips">
        {POSITIONS.map(pos => (
          <button
            key={pos}
            onClick={() => setSelectedPos(pos)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors border",
              selectedPos === pos
                ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                : "bg-background text-muted-foreground border-border hover:bg-muted/50"
            )}
            data-testid={`targets-chip-${pos.toLowerCase()}`}
          >
            {pos}
          </button>
        ))}
      </div>

      {userProfile && (
        <Card className="bg-muted/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 text-xs">
              <Badge variant="outline" className={cn("text-xs", getStatusColor(userProfile.positions[selectedPos].status))}>
                Your {selectedPos}: {userProfile.positions[selectedPos].status} (#{userProfile.positions[selectedPos].rank})
              </Badge>
              <span className="text-muted-foreground">
                Strategy: <span className="font-medium text-foreground">{userProfile.positions[selectedPos].status === "Need" ? buyStrategy : sellStrategy}</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-semibold text-foreground">Buy Targets</h3>
              <Badge variant="secondary" className="text-xs">{buyTargets.length}</Badge>
            </div>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5 mb-4" />
            <p className="text-[10px] text-muted-foreground mb-3">Players on surplus teams you could acquire</p>

            {buyTargets.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No {selectedPos} buy targets found</p>}
            {buyTargets.map((p, i) => (
              <div key={`${p.sleeperId || p.id}-${i}`} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`buy-target-${p.sleeperId || p.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <Badge variant="outline" className={cn("text-[10px] px-1 py-0 w-8 justify-center", getPositionColor(p.pos))}>{p.pos}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{p.team}</span>
                      <span>·</span>
                      <span>Age {p.age}</span>
                      <span>·</span>
                      <span>{p.ownerName}</span>
                      <Badge variant="outline" className={cn("text-[8px] px-0.5 py-0", getTierColor(p.ownerTier))}>{p.ownerTier}</Badge>
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold font-mono text-[#0b3a7a] dark:text-blue-400">{p.val.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">dynasty</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-foreground">Sell Candidates</h3>
              <Badge variant="secondary" className="text-xs">{sellCandidates.length}</Badge>
            </div>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5 mb-4" />
            <p className="text-[10px] text-muted-foreground mb-3">
              {userProfile?.positions[selectedPos].status === "Surplus"
                ? `You have ${selectedPos} surplus — these are movable depth pieces`
                : `You don't have ${selectedPos} surplus — selling is not recommended`
              }
            </p>

            {sellCandidates.length === 0 && (
              <div className="text-center py-6">
                <Shield className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {userProfile?.positions[selectedPos].status === "Surplus"
                    ? "No movable sell candidates"
                    : `No ${selectedPos} surplus — hold your players`
                  }
                </p>
              </div>
            )}
            {sellCandidates.map((p, i) => (
              <div key={`${p.sleeperId || p.id}-${i}`} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`sell-candidate-${p.sleeperId || p.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <Badge variant="outline" className={cn("text-[10px] px-1 py-0 w-8 justify-center", getPositionColor(p.pos))}>{p.pos}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{p.team}</span>
                      <span>·</span>
                      <span>Age {p.age}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold font-mono text-[#0b3a7a] dark:text-blue-400">{p.val.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">dynasty</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
