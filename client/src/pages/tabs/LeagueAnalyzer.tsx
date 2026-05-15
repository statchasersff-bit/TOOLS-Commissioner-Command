import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getTierTooltip } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import { formatPickLabel } from "@/types";
import type { League, Team, Tier } from "@/types";
import { cn } from "@/lib/utils";
import { Info, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";

interface AnalyzerProps {
  league: League;
}

const TIER_ORDER: Tier[] = ["Juggernaut", "Win-Now", "Contender", "Future Powerhouse", "Pick Hoarder", "Rebuilder", "Weak / Directionless", "Taco", "Balanced"];
const TIER_BAR_COLOR: Record<Tier, string> = {
  "Juggernaut": "bg-[#d4af37]",
  "Win-Now": "bg-blue-500",
  "Contender": "bg-amber-500",
  "Future Powerhouse": "bg-emerald-500",
  "Pick Hoarder": "bg-purple-500",
  "Rebuilder": "bg-orange-500",
  "Weak / Directionless": "bg-rose-500",
  "Taco": "bg-red-500",
  "Balanced": "bg-slate-500",
};

function getStrengths(team: Team, leagueTeams: Team[]): string[] {
  const strengths: string[] = [];
  const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
    Math.round(leagueTeams.reduce((s, t) => s + t.metrics[key], 0) / leagueTeams.length);
  if (team.metrics.qb >= leagueAvg("qb") + 10) strengths.push("Elite QB room");
  if (team.metrics.rb >= leagueAvg("rb") + 10) strengths.push("Strong RB room");
  if (team.metrics.wr >= leagueAvg("wr") + 10) strengths.push("Elite WR corps");
  if (team.metrics.te >= leagueAvg("te") + 10) strengths.push("Strong TE room");
  if (team.metrics.youth >= 70) strengths.push("Strong youth profile");
  if (team.metrics.depth >= 70) strengths.push("Deep roster");
  if (team.picks.filter(p => p.round === 1).length >= 3) strengths.push("Loaded with 1st round picks");
  return strengths;
}

function getWeaknesses(team: Team, leagueTeams: Team[]): string[] {
  const weaknesses: string[] = [];
  const leagueAvg = (key: "qb" | "rb" | "wr" | "te") =>
    Math.round(leagueTeams.reduce((s, t) => s + t.metrics[key], 0) / leagueTeams.length);
  if (team.metrics.qb < leagueAvg("qb") - 10) weaknesses.push("QB depth");
  if (team.metrics.rb < leagueAvg("rb") - 10) weaknesses.push("RB depth");
  if (team.metrics.wr < leagueAvg("wr") - 10) weaknesses.push("WR depth");
  if (team.metrics.te < leagueAvg("te") - 10) weaknesses.push("TE depth");
  if (team.metrics.youth < 40) weaknesses.push("Aging roster");
  if (team.picks.length <= 4) weaknesses.push("Limited draft capital");
  return weaknesses;
}

function getOutlook(team: Team, tierMap: Map<string, { tier: Tier }>): string {
  const tier = tierMap.get(team.id)?.tier ?? "Balanced";
  switch (tier) {
    case "Juggernaut": return "Championship contender, league problem";
    case "Win-Now": return "Built to win this year";
    case "Future Powerhouse": return "The future is bright. Loaded with assets.";
    case "Pick Hoarder": return "Stockpiling picks but roster needs work";
    case "Taco": return "Bottom of the barrel across the board";
    case "Contender": return "Strong team with enough dynasty value to stay competitive";
    case "Rebuilder": return "Not built to win now, but positioned to improve";
    case "Weak / Directionless": return "Lacking current strength and a clear long-term plan";
    case "Balanced": return "Middle-of-the-pack without an extreme archetype";
  }
}

export function PowerRankings({ league }: AnalyzerProps) {
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  };

  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const tiers = useMemo(() => {
    const groups: Record<Tier, Team[]> = { "Juggernaut": [], "Win-Now": [], "Contender": [], "Future Powerhouse": [], "Pick Hoarder": [], "Rebuilder": [], "Weak / Directionless": [], "Taco": [], "Balanced": [] };
    sorted.forEach((t) => { const ti = tierMap.get(t.id); if (ti) groups[ti.tier].push(t); });
    return groups;
  }, [sorted, tierMap]);

  const columns = [
    { key: "rank", header: "Rank", sticky: true, render: (_: any, i: number) => <span className="font-bold">{i + 1}</span> },
    { key: "name", header: "Team", sortable: true, sortAccessor: (row: any) => row.owner, render: (row: any) => (
      <div className="flex items-center gap-2">
        {row.avatar ? (
          <img src={row.avatar} alt={row.owner} className="w-6 h-6 rounded-full object-cover flex-shrink-0" data-testid={`img-avatar-table-${row.id}`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-6 h-6 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0" data-testid={`img-avatar-table-${row.id}`}>
            {(row.owner || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <span className="font-semibold">{row.owner}</span>
      </div>
    )},
    { key: "tier", header: "Tier", sortable: true, sortAccessor: (row: any) => { const ti = tierMap.get(row.id); return ti ? TIER_ORDER.indexOf(ti.tier) : 99; }, render: (row: any) => {
      const ti = tierMap.get(row.id);
      if (!ti) return null;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={cn(getTierColor(ti.tier), "cursor-default")} data-testid={`tier-badge-${row.id}`}>
              {getTierEmoji(ti.tier)} {ti.tier}
            </Badge>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs max-w-[220px]">{ti.tooltip}</p></TooltipContent>
        </Tooltip>
      );
    }},
    { key: "starters", header: "Win-Now", sortable: true, sortAccessor: (row: any) => row.metrics.starters, render: (row: any) => row.metrics.starters },
    { key: "depth", header: "Dynasty", sortable: true, sortAccessor: (row: any) => row.metrics.depth, render: (row: any) => row.metrics.depth },
    { key: "youth", header: "Youth", sortable: true, sortAccessor: (row: any) => row.metrics.youth, render: (row: any) => row.metrics.youth },
  ];

  // ── League info pills ──────────────────────────────────────────────────────
  const numTeams   = league.totalRosters ?? league.teams.length;
  const starters   = league.rosterPositions?.length ?? 0;
  const bench      = league.benchSlots ?? 0;
  const taxi       = league.taxiSlots  ?? 0;
  const ir         = league.irSlots    ?? 0;
  const tep        = league.tePremium  ?? 0;
  const isSf       = league.format === "SF";
  const rosterSize = starters + bench;

  const scoringLabel = (() => {
    const s = league.scoringFormat ?? "";
    if (s.toLowerCase().includes("half")) return "Half PPR";
    if (s.toLowerCase().includes("ppr"))  return "PPR";
    return "Standard";
  })();

  const infoPills: Array<{ label: string; title?: string }> = [
    { label: "Dynasty" },
    { label: `${numTeams} Teams` },
    ...(starters > 0 ? [{ label: `Start ${starters}`, title: "Starting roster slots" }] : []),
    ...(rosterSize > 0 ? [{ label: `${rosterSize} Roster (${bench} Bench)`, title: "Total roster size including bench" }] : []),
    ...(taxi > 0        ? [{ label: `${taxi} Taxi` }] : []),
    ...(ir   > 0        ? [{ label: `${ir} IR` }]   : []),
    ...(isSf            ? [{ label: "Superflex" }]   : []),
    { label: scoringLabel },
    ...(tep  > 0        ? [{ label: `${tep} TEP`, title: `+${tep} per TE reception` }] : []),
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Power Rankings" subtitle="Teams ranked and grouped by archetype" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TIER_ORDER.filter(tier => tiers[tier].length > 0).map((tier) => (
          <div key={tier} className={cn("rounded-md p-4 border border-border/40", getTierBg(tier))}>
            <Tooltip>
              <TooltipTrigger asChild>
                <h4 className={cn("text-sm font-bold mb-3 cursor-default flex items-center gap-1.5", getTierColor(tier))}>
                  <span>{getTierEmoji(tier)}</span> {tier}
                </h4>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[220px]">{getTierTooltip(tier)}</p></TooltipContent>
            </Tooltip>
            <div className="space-y-2.5">
              {tiers[tier].map((team) => (
                <Card key={team.id} className="p-3 hover-elevate" data-testid={`tier-card-${team.id}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-shrink-0">
                      {team.avatar ? (
                        <img src={team.avatar} alt={team.owner} className="w-8 h-8 rounded-full object-cover" data-testid={`img-avatar-tier-${team.id}`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-xs font-bold text-[#0b3a7a] dark:text-blue-400" data-testid={`img-avatar-tier-${team.id}`}>
                          {(team.owner || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{team.name}</p>
                      {team.owner && team.owner !== team.name && (
                        <p className="text-xs text-muted-foreground truncate">{team.owner}</p>
                      )}
                    </div>
                    <span className="text-lg font-bold text-foreground flex-shrink-0">{team.metrics.overall}</span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={sorted} defaultSortKey="overall" defaultSortDir="desc" />

      {/* League Scoring Settings */}
      {league.scoringSettings && Object.keys(league.scoringSettings).length > 0 && (() => {
        const s = league.scoringSettings!;
        const SCORING_LABELS: Array<{ key: string; label: string; format?: (v: number) => string }> = [
          { key: "pass_yd",      label: "Pass Yds",       format: v => `${v} / yd` },
          { key: "pass_td",      label: "Pass TD",        format: v => `+${v}` },
          { key: "pass_int",     label: "Interception",   format: v => `${v}` },
          { key: "pass_2pt",     label: "Pass 2PT",       format: v => `+${v}` },
          { key: "rush_yd",      label: "Rush Yds",       format: v => `${v} / yd` },
          { key: "rush_td",      label: "Rush TD",        format: v => `+${v}` },
          { key: "rush_2pt",     label: "Rush 2PT",       format: v => `+${v}` },
          { key: "rec",          label: "Reception",      format: v => `+${v}` },
          { key: "rec_yd",       label: "Rec Yds",        format: v => `${v} / yd` },
          { key: "rec_td",       label: "Rec TD",         format: v => `+${v}` },
          { key: "rec_2pt",      label: "Rec 2PT",        format: v => `+${v}` },
          { key: "bonus_rec_te", label: "TE Premium",     format: v => `+${v}` },
          { key: "bonus_rec_wr", label: "WR Premium",     format: v => `+${v}` },
          { key: "bonus_rec_rb", label: "RB Premium",     format: v => `+${v}` },
          { key: "fum_lost",     label: "Fumble Lost",    format: v => `${v}` },
          { key: "st_td",        label: "ST TD",          format: v => `+${v}` },
          { key: "sack",         label: "Sack",           format: v => `+${v}` },
          { key: "safe",         label: "Safety",         format: v => `+${v}` },
          { key: "blk_kick",     label: "Block Kick",     format: v => `+${v}` },
        ];
        const rows = SCORING_LABELS.filter(({ key }) => s[key] !== undefined && s[key] !== 0);
        if (rows.length === 0) return null;
        return (
          <div>
            <h3 className="text-base font-bold text-foreground">League Scoring Settings</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5 mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1">
              {rows.map(({ key, label, format }) => {
                const val = s[key];
                const display = format ? format(val) : `${val}`;
                const isNegative = val < 0;
                return (
                  <div key={key} className="flex items-center justify-between py-1 border-b border-border/20">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className={cn("text-[11px] font-semibold tabular-nums", isNegative ? "text-rose-400" : "text-foreground")}>
                      {display}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* League format pills */}
      <div className="flex flex-wrap gap-1.5" data-testid="league-info-pills">
        {infoPills.map((pill) => (
          <span
            key={pill.label}
            title={pill.title}
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#0b3a7a]/10 dark:bg-blue-500/10 border border-[#0b3a7a]/20 dark:border-blue-400/20 text-[#0b3a7a] dark:text-blue-300 select-none"
            data-testid={`pill-${pill.label.replace(/\s+/g, "-").toLowerCase()}`}
          >
            {pill.label}
          </span>
        ))}
      </div>

      <div>
        <h3 className="text-base font-bold text-foreground">Scouting Report</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2 mb-4">Expandable per-team scouting report</p>

        <div className="space-y-3" data-testid="team-narratives">
          {sorted.map((team) => {
            const tierInfo = tierMap.get(team.id);
            const tier = tierInfo?.tier ?? "Balanced";
            const isExpanded = expandedTeams.has(team.id);
            const strengths = getStrengths(team, league.teams);
            const weaknesses = getWeaknesses(team, league.teams);
            const outlook = getOutlook(team, tierMap);

            return (
              <Card key={team.id} className="overflow-hidden" data-testid={`narrative-${team.id}`}>
                <button
                  onClick={() => toggleTeam(team.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors text-left"
                  data-testid={`button-expand-${team.id}`}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                    {team.avatar ? (
                      <img src={team.avatar} alt={team.owner} className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 ring-1 ring-border/40 flex items-center justify-center">
                        <span className="text-xs font-bold text-muted-foreground">{team.owner.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <span className="text-sm font-bold">{team.owner}</span>
                    <Badge variant="outline" className={getTierColor(tier)}>{getTierEmoji(tier)} {tier}</Badge>
                  </div>
                  <span className="text-xl font-bold">{team.metrics.overall}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-5 pt-1 border-t border-border/30 space-y-4">
                    {strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3" /> Strengths
                        </p>
                        <ul className="space-y-1 pl-5">
                          {strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-red-500 dark:text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <TrendingDown className="w-3 h-3" /> Weaknesses
                        </p>
                        <ul className="space-y-1 pl-5">
                          {weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 uppercase tracking-wider mb-1.5">Outlook</p>
                      <p className="text-sm text-muted-foreground">{outlook}</p>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TierBreakdown({ league }: AnalyzerProps) {
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const tierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { "Juggernaut": 0, "Win-Now": 0, "Contender": 0, "Future Powerhouse": 0, "Pick Hoarder": 0, "Rebuilder": 0, "Weak / Directionless": 0, "Taco": 0, "Balanced": 0 };
    league.teams.forEach((t) => { const ti = tierMap.get(t.id); if (ti) counts[ti.tier]++; });
    return counts;
  }, [league.teams, tierMap]);
  const total = league.teams.length;

  return (
    <div className="space-y-8">
      <SectionHeader title="Tier Breakdown" subtitle="Distribution of teams across competitive archetypes" />

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <h3 className="text-base font-bold">Tier Distribution</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-[200px]">Archetypes based on Power, Dynasty, Redraft, and Draft capital rankings.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-5">
          {TIER_ORDER.map((tier) => (
            <div key={tier} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn("text-sm font-semibold cursor-default flex items-center gap-1", getTierColor(tier))}>
                      {getTierEmoji(tier)} {tier}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs max-w-[220px]">{getTierTooltip(tier)}</p></TooltipContent>
                </Tooltip>
                <span className="text-sm text-muted-foreground">{tierCounts[tier]} team{tierCounts[tier] !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", TIER_BAR_COLOR[tier])}
                  style={{ width: `${(tierCounts[tier] / total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {TIER_ORDER.filter(tier => tierCounts[tier] > 0).map((tier) => (
          <Card key={tier} className={cn("p-5 text-center", getTierBg(tier))}>
            <p className="text-4xl font-bold">{tierCounts[tier]}</p>
            <p className={cn("text-sm font-semibold mt-1.5 flex items-center justify-center gap-1", getTierColor(tier))}>
              {getTierEmoji(tier)} {tier}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{Math.round((tierCounts[tier] / total) * 100)}% of league</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function RosterComparison({ league }: AnalyzerProps) {
  const [teamAId, setTeamAId] = useState(league.teams[0]?.id || "");
  const [teamBId, setTeamBId] = useState(league.teams[1]?.id || "");
  const { getPlayerValue, getRedraftValue, optimizeLineup } = useValueModel();

  const teamA = league.teams.find((t) => t.id === teamAId);
  const teamB = league.teams.find((t) => t.id === teamBId);

  const teamTiers = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const posStats = useMemo(() => {
    const positions = ["QB", "RB", "WR", "TE"] as const;
    const rp = league.rosterPositions || [];
    const optRosters = new Map(league.teams.map(t => [t.id, optimizeLineup(t.roster, rp)]));
    const result: Record<string, {
      dynTotals: Record<string, number>;
      redTotals: Record<string, number>;
      dynRanks: Record<string, number>;
      redRanks: Record<string, number>;
    }> = {};
    positions.forEach(pos => {
      const dynTotals: Record<string, number> = {};
      const redTotals: Record<string, number> = {};
      league.teams.forEach(team => {
        dynTotals[team.id] = team.roster
          .filter(p => p.pos === pos)
          .reduce((s, p) => s + getPlayerValue(p), 0);
        redTotals[team.id] = (optRosters.get(team.id) || team.roster)
          .filter(p => p.pos === pos && p.starter)
          .reduce((s, p) => s + getRedraftValue(p), 0);
      });
      const dynSorted = [...league.teams].sort((a, b) => (dynTotals[b.id] ?? 0) - (dynTotals[a.id] ?? 0));
      const redSorted = [...league.teams].sort((a, b) => (redTotals[b.id] ?? 0) - (redTotals[a.id] ?? 0));
      const dynRanks: Record<string, number> = {};
      const redRanks: Record<string, number> = {};
      dynSorted.forEach((t, i) => { dynRanks[t.id] = i + 1; });
      redSorted.forEach((t, i) => { redRanks[t.id] = i + 1; });
      result[pos] = { dynTotals, redTotals, dynRanks, redRanks };
    });
    return result;
  }, [league.teams, league.rosterPositions, getPlayerValue, getRedraftValue, optimizeLineup]);
  const getTeamTier = (teamId: string): Tier | null => {
    return teamTiers.get(teamId)?.tier ?? null;
  };

  const tierA = teamA ? getTeamTier(teamA.id) : null;
  const tierB = teamB ? getTeamTier(teamB.id) : null;

  const categories = [
    { key: "overall", label: "Overall" },
    { key: "starters", label: "Win-Now" },
    { key: "depth", label: "Dynasty" },
    { key: "youth", label: "Youth" },
    { key: "qb", label: "QB" },
    { key: "rb", label: "RB" },
    { key: "wr", label: "WR" },
    { key: "te", label: "TE" },
    { key: "picks", label: "Picks" },
  ];

  const TeamCard = ({
    team,
    tier,
    selectId,
    onSelect,
    side,
  }: {
    team: Team | undefined;
    tier: Tier | null;
    selectId: string;
    onSelect: (id: string) => void;
    side: "A" | "B";
  }) => {
    const isA = side === "A";
    const ringColor = isA ? "ring-[#0b3a7a]/70 dark:ring-blue-400/70" : "ring-[#d4af37]/70";
    const nameColor = isA ? "text-[#0b3a7a] dark:text-blue-400" : "text-[#d4af37]";
    const scoreColor = isA ? "text-[#0b3a7a] dark:text-blue-400" : "text-[#d4af37]";
    const glowBg = isA
      ? "bg-[#0b3a7a]/10 dark:bg-blue-400/5"
      : "bg-[#d4af37]/10 dark:bg-[#d4af37]/5";

    return (
      <div className={cn("flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl", glowBg)}>
        <div className={cn("w-12 h-12 rounded-full ring-2 overflow-hidden flex-shrink-0", ringColor, "bg-muted shadow-md")}>
          {team?.avatar ? (
            <img src={team.avatar} alt={team.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className={cn("w-full h-full flex items-center justify-center text-lg font-black", nameColor)}>
              {(team?.owner || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="text-center min-w-0 w-full">
          <p className={cn("text-sm font-bold truncate leading-tight", nameColor)} data-testid={`text-matchup-name-${side}`}>
            {team?.name || `Team ${side}`}
          </p>
          {team?.owner && team.owner !== team.name && (
            <p className="text-[10px] text-muted-foreground truncate">{team.owner}</p>
          )}
          {tier && (
            <Badge variant="outline" className={cn("text-[9px] border-current mt-0.5", getTierColor(tier))}>
              {tier}
            </Badge>
          )}
          <div className="flex items-baseline justify-center gap-1 mt-1">
            <p className={cn("text-2xl font-black tabular-nums", scoreColor)} data-testid={`text-matchup-score-${side}`}>
              {team?.metrics.overall ?? 0}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-widest">pts</p>
          </div>
        </div>

        <Select value={selectId} onValueChange={onSelect}>
          <SelectTrigger className="w-full max-w-[150px] text-[11px] h-6" data-testid={`select-team-${side}`}>
            <SelectValue placeholder={`Team ${side}`} />
          </SelectTrigger>
          <SelectContent>
            {league.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <SectionHeader title="Roster Comparison" subtitle="Compare two teams head-to-head" />

      <div className="relative rounded-2xl overflow-hidden border border-border/30 bg-card shadow-md">
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b3a7a]/10 via-transparent to-[#d4af37]/10 dark:from-[#0b3a7a]/20 dark:to-[#d4af37]/15 pointer-events-none" />
        <div className="relative grid grid-cols-[1fr_auto_1fr]">
          <TeamCard team={teamA} tier={tierA} selectId={teamAId} onSelect={setTeamAId} side="A" />

          <div className="flex flex-col items-center justify-center px-2 sm:px-4 py-6 relative">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border/60 to-transparent" />
            <div className="relative z-10 flex flex-col items-center gap-1.5">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-background border-2 border-[#d4af37] shadow-lg flex items-center justify-center">
                <span className="text-[10px] sm:text-xs font-black text-[#d4af37] tracking-tighter">VS</span>
              </div>
            </div>
          </div>

          <TeamCard team={teamB} tier={tierB} selectId={teamBId} onSelect={setTeamBId} side="B" />
        </div>
      </div>

      {teamA && teamB && (
        <Card className="p-6">
          <div className="space-y-5">
            {categories.map((cat) => {
              const valA = teamA.metrics[cat.key as keyof typeof teamA.metrics] as number;
              const valB = teamB.metrics[cat.key as keyof typeof teamB.metrics] as number;
              const maxVal = 100;
              return (
                <div key={cat.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-bold", valA >= valB ? "text-[#0b3a7a] dark:text-blue-400" : "text-muted-foreground")}>{valA}</span>
                    <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">{cat.label}</span>
                    <span className={cn("font-bold", valB >= valA ? "text-[#d4af37]" : "text-muted-foreground")}>{valB}</span>
                  </div>
                  <div className="flex gap-1 h-3.5">
                    <div className="flex-1 flex justify-end">
                      <div
                        className="h-full rounded-l-full bg-[#0b3a7a] dark:bg-blue-500 transition-all"
                        style={{ width: `${(valA / maxVal) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1">
                      <div
                        className="h-full rounded-r-full bg-[#d4af37] transition-all"
                        style={{ width: `${(valB / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {teamA && teamB && (() => {
        const positions = ["QB", "RB", "WR", "TE"] as const;
        const getPlayers = (team: typeof teamA, pos: string) =>
          [...team.roster].filter(p => p.pos === pos).sort((a, b) => b.value - a.value);
        const teamConfig = [
          { team: teamA, color: "text-[#0b3a7a] dark:text-blue-400", accent: "border-[#0b3a7a]/20 dark:border-blue-400/20" },
          { team: teamB, color: "text-[#d4af37]", accent: "border-[#d4af37]/20" },
        ];

        return (
          <div className="space-y-4 sm:space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-5">
              {teamConfig.map(({ team, color }) => (
                <div key={team.id} className="px-1 sm:px-2">
                  <h3 className={`text-xs sm:text-sm font-bold ${color} truncate`}>{team.name}</h3>
                  {team.owner && team.owner !== team.name && (
                    <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{team.owner}</p>
                  )}
                  <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
                </div>
              ))}
            </div>

            {positions.map(pos => {
              const playersA = getPlayers(teamA, pos);
              const playersB = getPlayers(teamB, pos);
              const maxRows = Math.max(playersA.length, playersB.length, 1);
              const ps = posStats[pos];
              const teamsForPos = [teamA, teamB] as const;
              const posColors = ["text-[#0b3a7a] dark:text-blue-400", "text-[#d4af37]"] as const;

              return (
                <Card key={pos} className="p-2.5 sm:p-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2">
                    <Badge variant="outline" className={`text-[9px] sm:text-[10px] w-6 sm:w-7 justify-center ${POS_COLORS[pos]}`}>{pos}</Badge>
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                      {playersA.length} vs {playersB.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:gap-5">
                    {[playersA, playersB].map((players, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {Array.from({ length: maxRows }).map((_, rowIdx) => {
                          const p = players[rowIdx];
                          if (!p) return <div key={rowIdx} className="py-0.5 sm:py-1 px-1 sm:px-2 h-[22px] sm:h-[28px]" />;
                          return (
                            <div key={p.id} className="flex items-center justify-between py-0.5 sm:py-1 px-1 sm:px-2 rounded-md hover:bg-muted/30 transition-colors" data-testid={`roster-player-${p.id}`}>
                              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                                <span className="text-[10px] sm:text-xs truncate text-foreground">{p.name}</span>
                              </div>
                              <span className="text-[10px] sm:text-xs font-mono font-semibold text-muted-foreground ml-1 flex-shrink-0">{p.value > 0 ? p.value.toLocaleString() : "0"}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {ps && (
                    <div className="grid grid-cols-2 gap-2 sm:gap-5 mt-2 sm:mt-3 pt-2 border-t border-border/25">
                      {teamsForPos.map((team, ci) => {
                        const dynVal = ps.dynTotals[team.id] ?? 0;
                        const redVal = ps.redTotals[team.id] ?? 0;
                        const dynRank = ps.dynRanks[team.id] ?? league.teams.length;
                        const redRank = ps.redRanks[team.id] ?? league.teams.length;
                        const col = posColors[ci];
                        return (
                          <div key={team.id} className="space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-muted-foreground">Dynasty</span>
                              <span className={`text-[10px] font-bold tabular-nums ${col}`}>
                                {Math.round(dynVal).toLocaleString()}
                                <span className="text-muted-foreground font-normal ml-1">#{dynRank}</span>
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-muted-foreground">Win-Now</span>
                              <span className={`text-[10px] font-bold tabular-nums ${col}`}>
                                {Math.round(redVal).toLocaleString()}
                                <span className="text-muted-foreground font-normal ml-1">#{redRank}</span>
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}

            {(() => {
              const getPicks = (team: typeof teamA) =>
                [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round);
              const picksA = getPicks(teamA);
              const picksB = getPicks(teamB);
              const maxPickRows = Math.max(picksA.length, picksB.length, 1);
              const totalValueA = picksA.reduce((s, p) => s + p.value, 0);
              const totalValueB = picksB.reduce((s, p) => s + p.value, 0);

              return (
                <Card className="p-2.5 sm:p-4" data-testid="draft-capital-comparison">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    <Badge variant="outline" className="text-[9px] sm:text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30 justify-center">PICKS</Badge>
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                      {picksA.length} vs {picksB.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:gap-5">
                    {[picksA, picksB].map((picks, colIdx) => (
                      <div key={colIdx} className="space-y-0.5">
                        {Array.from({ length: maxPickRows }).map((_, rowIdx) => {
                          const pk = picks[rowIdx];
                          if (!pk) return <div key={rowIdx} className="py-0.5 sm:py-1 px-1 sm:px-2 h-[22px] sm:h-[28px]" />;
                          return (
                            <div key={`${pk.year}-${pk.round}-${rowIdx}`} className="flex items-center justify-between py-0.5 sm:py-1 px-1 sm:px-2 rounded-md hover:bg-muted/30 transition-colors">
                              <span className="text-[10px] sm:text-xs font-semibold text-foreground">{formatPickLabel(pk)}</span>
                              <span className="text-[10px] sm:text-xs font-mono font-semibold text-muted-foreground ml-1 flex-shrink-0">{pk.value > 0 ? pk.value.toLocaleString() : "0"}</span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between py-1 px-1 sm:px-2 border-t border-border/40 mt-1">
                          <span className="text-[10px] sm:text-xs font-bold text-muted-foreground">Total</span>
                          <span className="text-[10px] sm:text-xs font-mono font-bold text-foreground">{(colIdx === 0 ? totalValueA : totalValueB).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
}

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  RB: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  WR: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  TE: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
};
