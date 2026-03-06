import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, isContenderTier, isRebuilderTier } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team, Tier } from "@/types";
import { formatPickLabel } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TrendingUp, TrendingDown, Crosshair,
  Crown, Rocket, Skull, HelpCircle, Package, BarChart3,
  Activity, Users, Zap, AlertTriangle
} from "lucide-react";

type EconomySection = "overview" | "picks" | "liquidity";

const SECTION_TABS: { id: EconomySection; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Economy Overview", icon: BarChart3 },
  { id: "picks", label: "Pick Concentration", icon: Package },
  { id: "liquidity", label: "Trade Liquidity", icon: Activity },
];

function computePercentile(values: number[], val: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = sorted.findIndex(v => v >= val);
  if (idx === -1) return 100;
  return Math.round((idx / sorted.length) * 100);
}

function computeNowScore(teams: Team[], team: Team): number {
  const allStarters = teams.map(t => t.metrics.starters);
  return computePercentile(allStarters, team.metrics.starters);
}

function computeFutureScore(teams: Team[], team: Team): number {
  const allDynasty = teams.map(t => t.metrics.depth);
  const allDraft = teams.map(t => t.metrics.picks);
  const dynastyPct = computePercentile(allDynasty, team.metrics.depth);
  const draftPct = computePercentile(allDraft, team.metrics.picks);
  return Math.round(0.6 * dynastyPct + 0.4 * draftPct);
}

function computeParityScore(teams: Team[]): { score: number; label: string; description: string } {
  const scores = teams.map(t => t.metrics.overall);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const maxStd = 30;
  const minStd = 2;
  const clamped = Math.max(minStd, Math.min(maxStd, stdDev));
  const score = Math.round(100 - ((clamped - minStd) / (maxStd - minStd)) * 100);
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  const maxDiff = Math.round(Math.max(...scores.map(s => Math.abs(s - median))));
  const description = score >= 70
    ? `Most teams are within ${maxDiff} points of the median.`
    : score >= 40
      ? `There's moderate spread between the top and bottom teams.`
      : `Significant talent gap between the haves and have-nots.`;
  return { score, label, description };
}

interface QuadrantTeam {
  team: Team;
  now: number;
  future: number;
  tier: Tier;
}

function getQuadrantLabel(now: number, future: number): { label: string; icon: typeof Crown; color: string } {
  if (now >= 50 && future >= 50) return { label: "Dynasty Death Star", icon: Crown, color: "text-yellow-500" };
  if (now >= 50 && future < 50) return { label: "Win-Now Kings", icon: Zap, color: "text-red-500" };
  if (now < 50 && future >= 50) return { label: "Rebuild With Ammo", icon: Rocket, color: "text-emerald-500" };
  return { label: "Rebuild Hell", icon: Skull, color: "text-muted-foreground" };
}

function EconomyOverview({ league }: { league: League }) {
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const quadrantTeams: QuadrantTeam[] = useMemo(() =>
    league.teams.map(team => ({
      team,
      now: computeNowScore(league.teams, team),
      future: computeFutureScore(league.teams, team),
      tier: tierMap.get(team.id)?.tier ?? "Competitive",
    })),
    [league.teams, tierMap]
  );

  const parity = useMemo(() => computeParityScore(league.teams), [league.teams]);

  const pickMonopoly = useMemo(() => {
    const teamPickValues = league.teams.map(t => ({
      team: t,
      value: t.picks.reduce((sum, p) => sum + p.value, 0),
    }));
    const totalValue = teamPickValues.reduce((s, t) => s + t.value, 0);
    if (totalValue === 0) return { top3: [], top3Pct: 0, total: 0 };
    const sorted = [...teamPickValues].sort((a, b) => b.value - a.value);
    const top3 = sorted.slice(0, 3).map(t => ({
      owner: t.team.owner,
      pct: Math.round((t.value / totalValue) * 100),
    }));
    const top3Pct = top3.reduce((s, t) => s + t.pct, 0);
    return { top3, top3Pct, total: totalValue };
  }, [league.teams]);

  const quadrants = useMemo(() => {
    const deathStar = quadrantTeams.filter(t => t.now >= 50 && t.future >= 50);
    const winNow = quadrantTeams.filter(t => t.now >= 50 && t.future < 50);
    const rebuildAmmo = quadrantTeams.filter(t => t.now < 50 && t.future >= 50);
    const rebuildHell = quadrantTeams.filter(t => t.now < 50 && t.future < 50);
    return { deathStar, winNow, rebuildAmmo, rebuildHell };
  }, [quadrantTeams]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-foreground">Power vs Future Quadrant</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Where each team sits in the win-now vs future value spectrum</p>
      </div>

      <div className="grid grid-cols-2 gap-3" data-testid="economy-quadrant">
        {[
          { key: "deathStar", label: "Dynasty Death Star", teams: quadrants.deathStar, icon: Crown, color: "border-yellow-500/50 bg-yellow-500/5", textColor: "text-yellow-600 dark:text-yellow-400", desc: "High Now + High Future" },
          { key: "winNow", label: "Win-Now Kings", teams: quadrants.winNow, icon: Zap, color: "border-red-500/50 bg-red-500/5", textColor: "text-red-600 dark:text-red-400", desc: "High Now + Low Future" },
          { key: "rebuildAmmo", label: "Rebuild With Ammo", teams: quadrants.rebuildAmmo, icon: Rocket, color: "border-emerald-500/50 bg-emerald-500/5", textColor: "text-emerald-600 dark:text-emerald-400", desc: "Low Now + High Future" },
          { key: "rebuildHell", label: "Rebuild Hell", teams: quadrants.rebuildHell, icon: Skull, color: "border-muted bg-muted/20", textColor: "text-muted-foreground", desc: "Low Now + Low Future" },
        ].map(({ key, label, teams, icon: Icon, color, textColor, desc }) => (
          <Card key={key} className={`p-4 border-2 ${color} rounded-2xl min-h-[140px]`} data-testid={`quadrant-${key}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${textColor}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${textColor}`}>{label}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-3">{desc}</p>
            <div className="flex flex-wrap gap-1.5">
              <TooltipProvider>
                {teams.map(qt => (
                  <Tooltip key={qt.team.id}>
                    <TooltipTrigger asChild>
                      <div className="px-2 py-1 rounded-lg bg-background border border-border text-xs font-medium cursor-default hover:border-[#d4af37]/50 transition-colors" data-testid={`chip-${qt.team.id}`}>
                        {qt.team.owner}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p className="font-bold">{qt.team.name}</p>
                      <p>Now Score: {qt.now} · Future Score: {qt.future}</p>
                      <p>{getTierEmoji(qt.tier)} {qt.tier}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TooltipProvider>
              {teams.length === 0 && (
                <span className="text-[10px] text-muted-foreground italic">No teams</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 rounded-2xl" data-testid="parity-score">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">League Parity</p>
              <p className="text-xs text-muted-foreground mt-0.5">{parity.description}</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black">{parity.score}</span>
              <span className="text-lg text-muted-foreground">/100</span>
            </div>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${parity.score >= 70 ? "bg-emerald-500" : parity.score >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
              style={{ width: `${parity.score}%` }}
            />
          </div>
          <Badge variant="outline" className={`mt-2 ${parity.score >= 70 ? "text-emerald-600 border-emerald-300" : parity.score >= 40 ? "text-yellow-600 border-yellow-300" : "text-red-600 border-red-300"}`}>
            {parity.label} Parity
          </Badge>
        </Card>

        <Card className="p-5 rounded-2xl" data-testid="pick-monopoly">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Picks Monopoly</p>
          <div className="space-y-2">
            {pickMonopoly.top3.map((t, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm font-medium">{t.owner}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-[#d4af37] rounded-full" style={{ width: `${t.pct * 3}%` }} />
                  </div>
                  <span className="text-xs font-bold text-[#d4af37] w-8 text-right">{t.pct}%</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
            Top 3 control <span className="font-bold text-foreground">{pickMonopoly.top3Pct}%</span> of all pick value
          </p>
        </Card>
      </div>
    </div>
  );
}

function PickConcentration({ league }: { league: League }) {
  const { getPickValue } = useValueModel();

  const pickData = useMemo(() => {
    const data = league.teams.map(team => {
      const firstRounds = team.picks.filter(p => p.round === 1);
      const totalValue = team.picks.reduce((sum, p) => sum + (getPickValue(p) || p.value), 0);
      const bestPick = [...team.picks].sort((a, b) => (getPickValue(b) || b.value) - (getPickValue(a) || a.value))[0];
      return { team, firstCount: firstRounds.length, totalValue, bestPick, pickCount: team.picks.length };
    });

    const sorted = [...data].sort((a, b) => b.totalValue - a.totalValue);
    const q75 = sorted[Math.floor(sorted.length * 0.25)]?.totalValue ?? 0;
    const q25 = sorted[Math.floor(sorted.length * 0.75)]?.totalValue ?? 0;

    return sorted.map(d => ({
      ...d,
      ammo: d.totalValue >= q75 ? "Loaded" as const : d.totalValue <= q25 ? "Dry" as const : "Average" as const,
    }));
  }, [league.teams, getPickValue]);

  const ammoColor = (ammo: "Loaded" | "Average" | "Dry") => {
    switch (ammo) {
      case "Loaded": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700";
      case "Average": return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700";
      case "Dry": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700";
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-foreground">Pick Inventory</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Draft capital distribution across the league</p>
      </div>

      <Card className="rounded-2xl overflow-hidden" data-testid="pick-concentration-table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Team</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">1sts (3yr)</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Picks</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Pick Value</th>
                <th className="text-left p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Best Pick</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Ammo</th>
              </tr>
            </thead>
            <tbody>
              {pickData.map((d, i) => (
                <tr key={d.team.id} className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/10"}`} data-testid={`pick-row-${d.team.id}`}>
                  <td className="p-3">
                    <div className="font-bold text-sm leading-tight">{d.team.name}</div>
                    <div className="text-[11px] text-muted-foreground leading-tight">{d.team.owner}</div>
                  </td>
                  <td className="p-3 text-center font-bold">{d.firstCount}</td>
                  <td className="p-3 text-center">{d.pickCount}</td>
                  <td className="p-3 text-center font-mono text-xs">{d.totalValue.toLocaleString()}</td>
                  <td className="p-3 text-xs">
                    {d.bestPick ? formatPickLabel(d.bestPick) : "—"}
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant="outline" className={`text-[10px] ${ammoColor(d.ammo)}`}>{d.ammo}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

type PosKey = "QB" | "RB" | "WR" | "TE";
const POSITIONS: PosKey[] = ["QB", "RB", "WR", "TE"];

function TradeLiquidity({ league }: { league: League }) {
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const liquidityData = useMemo(() => {
    const totalTeams = league.teams.length;
    const contenders = league.teams.filter(t => isContenderTier(tierMap.get(t.id)?.tier ?? "Competitive")).length;
    const rebuilders = league.teams.filter(t => isRebuilderTier(tierMap.get(t.id)?.tier ?? "Competitive")).length;
    const midTeams = totalTeams - contenders - rebuilders;

    const hasBuyers = contenders >= 2;
    const hasSellers = rebuilders >= 2;
    const hasMiddle = midTeams >= 2;
    const diversityScore = (hasBuyers ? 30 : 0) + (hasSellers ? 30 : 0) + (hasMiddle ? 20 : 10);

    const pickActivity = league.teams.reduce((sum, t) => sum + t.picks.length, 0);
    const avgPicks = pickActivity / totalTeams;
    const pickMovement = Math.min(20, Math.round((avgPicks / 8) * 20));

    const score = Math.min(100, diversityScore + pickMovement);
    const label = score >= 70 ? "Active" : score >= 40 ? "Moderate" : "Stagnant";

    return { score, label, contenders, rebuilders, midTeams, totalTeams };
  }, [league.teams, tierMap]);

  const buyerSeller = useMemo(() => {
    return league.teams.map(team => {
      const tier = tierMap.get(team.id)?.tier ?? "Competitive";
      const role = isContenderTier(tier) ? "Buyer" as const : isRebuilderTier(tier) ? "Seller" as const : "Neutral" as const;
      return { team, tier, role };
    }).sort((a, b) => {
      const order = { Buyer: 0, Neutral: 1, Seller: 2 };
      return order[a.role] - order[b.role];
    });
  }, [league.teams, tierMap]);

  const roleColor = (role: "Buyer" | "Seller" | "Neutral") => {
    switch (role) {
      case "Buyer": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700";
      case "Seller": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700";
      case "Neutral": return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-foreground">Trade Liquidity</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">How active and balanced the trade market is</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 rounded-2xl" data-testid="liquidity-score">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Liquidity Score</p>
              <p className="text-xs text-muted-foreground mt-1">Based on team role diversity and market balance</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black">{liquidityData.score}</span>
              <span className="text-lg text-muted-foreground">/100</span>
            </div>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${liquidityData.score >= 70 ? "bg-emerald-500" : liquidityData.score >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
              style={{ width: `${liquidityData.score}%` }}
            />
          </div>
          <Badge variant="outline" className={`mt-2 ${liquidityData.score >= 70 ? "text-emerald-600 border-emerald-300" : liquidityData.score >= 40 ? "text-yellow-600 border-yellow-300" : "text-red-600 border-red-300"}`}>
            {liquidityData.label}
          </Badge>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-border">
            <div className="text-center">
              <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">{liquidityData.contenders}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Buyers</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-black text-muted-foreground">{liquidityData.midTeams}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Neutral</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-black text-red-600 dark:text-red-400">{liquidityData.rebuilders}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Sellers</p>
            </div>
          </div>
        </Card>

        <Card className="p-5 rounded-2xl" data-testid="buyer-seller-list">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Buyers vs Sellers</p>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {buyerSeller.map(({ team, tier, role }) => (
              <div key={team.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors" data-testid={`bs-${team.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{team.owner}</span>
                  <Badge variant="outline" className={`text-[9px] ${getTierColor(tier)}`}>{getTierEmoji(tier)} {tier}</Badge>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${roleColor(role)}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${role === "Buyer" ? "bg-emerald-500" : role === "Seller" ? "bg-red-500" : "bg-gray-400"}`} />
                  {role}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function LeagueEconomy({ league }: { league: League }) {
  const [activeSection, setActiveSection] = useState<EconomySection>("overview");

  return (
    <div className="space-y-8">
      <SectionHeader title="League Economy" subtitle="League-wide economic dynamics — power distribution, draft capital, and trade market health" />

      <div className="flex items-center gap-2 flex-wrap" data-testid="economy-section-tabs">
        {SECTION_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeSection === tab.id
                  ? "bg-[#0b3a7a] text-white shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`tab-economy-${tab.id}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSection === "overview" && <EconomyOverview league={league} />}
      {activeSection === "picks" && <PickConcentration league={league} />}
      {activeSection === "liquidity" && <TradeLiquidity league={league} />}
    </div>
  );
}
