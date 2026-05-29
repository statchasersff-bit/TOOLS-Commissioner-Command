import { useState, useMemo, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollEdges } from "@/hooks/useResponsive";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ManagerNameButton } from "@/components/ManagerNameButton";
import { getLeagueTeamTiers, getTierColor, getTierBg, getTierEmoji, getTierTooltip } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { formatPickLabel } from "@/types";
import type { League, Team, Tier, Player, Pick } from "@/types";
import { cn } from "@/lib/utils";
import { Info, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Plus, X, Sparkles, Crown } from "lucide-react";

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
        <ManagerNameButton
          userId={row.ownerId}
          username={row.owner}
          avatar={row.avatar}
          leagueId={league.id}
          className="font-semibold"
        >
          {row.owner}
        </ManagerNameButton>
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
                        <ManagerNameButton
                          userId={team.ownerId}
                          username={team.owner}
                          avatar={team.avatar}
                          leagueId={league.id}
                          className="text-xs text-muted-foreground truncate block"
                        >
                          {team.owner}
                        </ManagerNameButton>
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

// ── Compare Teams ──────────────────────────────────────────────────────────
// Side-by-side comparison of 2–3 managers from the active Sleeper league.
//
// Spec highlights:
//   - 2 to 3 columns; user picks managers via a per-column select.
//   - Each column shows: header (name/owner/totals/avgAge/league rank),
//     position cards (QB/RB/WR/TE sorted by dynasty value), Picks, optional
//     Taxi/IR sections (only when the league has those slots).
//   - "Edge" highlighting: the strongest position group across the selected
//     subset gets a gold border + "EDGE" badge.
//   - Summary metric strip + automated insight bullets at the top.
//   - Dynasty / Win-Now / Both value toggle.

const COMPARE_MAX = 3;
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type PositionKey = (typeof POSITIONS)[number];

type ValueMode = "dynasty" | "redraft" | "both";

const POS_THEME: Record<
  PositionKey,
  { chip: string; text: string; accent: string }
> = {
  QB: { chip: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",     text: "text-rose-600 dark:text-rose-400",       accent: "border-rose-500/40" },
  RB: { chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", text: "text-emerald-600 dark:text-emerald-400", accent: "border-emerald-500/40" },
  WR: { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",         text: "text-sky-600 dark:text-sky-400",         accent: "border-sky-500/40" },
  TE: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", text: "text-amber-600 dark:text-amber-400",     accent: "border-amber-500/40" },
};

const POS_COLORS: Record<string, string> = {
  QB: POS_THEME.QB.chip,
  RB: POS_THEME.RB.chip,
  WR: POS_THEME.WR.chip,
  TE: POS_THEME.TE.chip,
};

function compactValue(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

interface TeamBreakdown {
  team: Team;
  byPos: Record<PositionKey, Player[]>;
  posDyn: Record<PositionKey, number>;
  posRed: Record<PositionKey, number>;
  taxi: Player[];
  ir: Player[];
  picks: Pick[];
  picksValue: number;
  totalDyn: number;
  totalRed: number;
  starterValue: number;
  avgAge: number;
  leagueDynRank: number;
  leagueDynTotal: number;
}

export function RosterComparison({ league }: AnalyzerProps) {
  const initialIds = useMemo(() => {
    const ids: string[] = [];
    if (league.teams[0]) ids.push(league.teams[0].id);
    if (league.teams[1]) ids.push(league.teams[1].id);
    return ids;
  }, [league.id]); // re-seed when the league changes
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  // Cap the comparison at 2 managers on non-desktop so the columns stay legible
  // (3-up is too cramped on phones); desktop keeps the full COMPARE_MAX.
  const isMobile = useIsMobile();
  const compareMax = isMobile ? 2 : COMPARE_MAX;
  const [valueMode, setValueMode] = useState<ValueMode>("dynasty");
  const [includePicks, setIncludePicks] = useState(true);
  const [includeBench, setIncludeBench] = useState(true);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const { getPlayerValue, getRedraftValue, getPickValue, optimizeLineup } = useValueModel();

  // Re-seed selected teams whenever the active league changes; otherwise
  // stale team IDs would silently hide all columns.
  useMemo(() => {
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => league.teams.some((t) => t.id === id));
      if (valid.length >= 2) return valid;
      // Fill up to 2 with the first available teams that aren't already in.
      const fillers = league.teams
        .map((t) => t.id)
        .filter((id) => !valid.includes(id))
        .slice(0, 2 - valid.length);
      return [...valid, ...fillers];
    });
  }, [league.id, league.teams]);

  // If the cap drops (e.g. desktop → mobile resize) while more managers are
  // selected than now allowed, trim the extras so the view honors the limit.
  useEffect(() => {
    setSelectedIds((prev) => (prev.length > compareMax ? prev.slice(0, compareMax) : prev));
  }, [compareMax]);

  const selectedTeams = selectedIds
    .map((id) => league.teams.find((t) => t.id === id))
    .filter((t): t is Team => Boolean(t));

  // ── Per-team breakdown (positions / picks / totals / averages) ────────────
  const breakdowns: TeamBreakdown[] = useMemo(() => {
    const out: TeamBreakdown[] = [];
    for (const team of selectedTeams) {
      const active = team.roster.filter((p) => !p.onTaxi && !p.onReserve);
      const taxi = team.roster.filter((p) => p.onTaxi);
      const ir = team.roster.filter((p) => p.onReserve);

      const byPos: Record<PositionKey, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
      for (const p of active) {
        if (p.pos === "QB" || p.pos === "RB" || p.pos === "WR" || p.pos === "TE") {
          byPos[p.pos].push(p);
        }
      }
      for (const pos of POSITIONS) {
        byPos[pos].sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
      }

      const posDyn = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<PositionKey, number>;
      const posRed = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<PositionKey, number>;
      for (const pos of POSITIONS) {
        for (const p of byPos[pos]) {
          posDyn[pos] += getPlayerValue(p);
          posRed[pos] += getRedraftValue(p);
        }
      }

      const totalDyn = active.reduce((s, p) => s + getPlayerValue(p), 0);
      const totalRed = active.reduce((s, p) => s + getRedraftValue(p), 0);

      const starters = optimizeLineup(team.roster, league.rosterPositions || []);
      const starterValue = starters.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);

      const ages = active.map((p) => p.age).filter((a) => a > 0);
      const avgAge = ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 0;

      const picks = [...team.picks].sort((a, b) => a.year - b.year || a.round - b.round);
      const picksValue = picks.reduce((s, p) => s + getPickValue(p), 0);

      out.push({
        team,
        byPos,
        posDyn,
        posRed,
        taxi,
        ir,
        picks,
        picksValue,
        totalDyn,
        totalRed,
        starterValue,
        avgAge,
        leagueDynRank: 0, // filled in below
        leagueDynTotal: 0,
      });
    }
    return out;
  }, [selectedTeams, getPlayerValue, getRedraftValue, getPickValue, optimizeLineup, league.rosterPositions]);

  // League-wide dynasty rank (1 = highest total active dynasty value).
  const leagueRanks = useMemo(() => {
    const totals = league.teams.map((t) => {
      const total = t.roster
        .filter((p) => !p.onTaxi && !p.onReserve)
        .reduce((s, p) => s + getPlayerValue(p), 0);
      return { id: t.id, total };
    });
    totals.sort((a, b) => b.total - a.total);
    const map = new Map<string, { rank: number; total: number }>();
    totals.forEach((t, i) => map.set(t.id, { rank: i + 1, total: t.total }));
    return map;
  }, [league.teams, getPlayerValue]);
  for (const b of breakdowns) {
    const r = leagueRanks.get(b.team.id);
    if (r) {
      b.leagueDynRank = r.rank;
      b.leagueDynTotal = r.total;
    }
  }

  // Position edges within the selected subset (highest dyn value wins).
  const posEdge = useMemo(() => {
    const edge: Record<PositionKey, { teamId: string | null; value: number }> = {
      QB: { teamId: null, value: -Infinity },
      RB: { teamId: null, value: -Infinity },
      WR: { teamId: null, value: -Infinity },
      TE: { teamId: null, value: -Infinity },
    };
    for (const pos of POSITIONS) {
      for (const b of breakdowns) {
        const v = valueMode === "redraft" ? b.posRed[pos] : b.posDyn[pos];
        if (v > edge[pos].value) edge[pos] = { teamId: b.team.id, value: v };
      }
    }
    return edge;
  }, [breakdowns, valueMode]);

  // Position-rank within the selected subset (1 = best).
  const posRankWithin = useMemo(() => {
    const ranks: Record<PositionKey, Map<string, number>> = {
      QB: new Map(), RB: new Map(), WR: new Map(), TE: new Map(),
    };
    for (const pos of POSITIONS) {
      const ordered = [...breakdowns].sort((a, b) => {
        const av = valueMode === "redraft" ? a.posRed[pos] : a.posDyn[pos];
        const bv = valueMode === "redraft" ? b.posRed[pos] : b.posDyn[pos];
        return bv - av;
      });
      ordered.forEach((b, i) => ranks[pos].set(b.team.id, i + 1));
    }
    return ranks;
  }, [breakdowns, valueMode]);

  // Auto-generated insights — one line per noteworthy fact.
  const insights = useMemo(() => {
    if (breakdowns.length < 2) return [] as string[];
    const lines: string[] = [];

    const strongest = (pos: PositionKey) => {
      const sorted = [...breakdowns].sort((a, b) => b.posDyn[pos] - a.posDyn[pos]);
      if (sorted.length === 0) return;
      const top = sorted[0];
      lines.push(`${top.team.owner || top.team.name} has the strongest ${pos} room.`);
    };
    for (const pos of POSITIONS) strongest(pos);

    const youngest = [...breakdowns].sort((a, b) => a.avgAge - b.avgAge)[0];
    if (youngest && youngest.avgAge > 0) {
      lines.push(`${youngest.team.owner || youngest.team.name} has the youngest roster (avg age ${youngest.avgAge.toFixed(1)}).`);
    }

    const mostPicks = [...breakdowns].sort((a, b) => b.picksValue - a.picksValue)[0];
    if (mostPicks && mostPicks.picksValue > 0) {
      lines.push(`${mostPicks.team.owner || mostPicks.team.name} has the most future pick value (${compactValue(mostPicks.picksValue)}).`);
    }

    const winNow = [...breakdowns].sort((a, b) => b.starterValue - a.starterValue)[0];
    if (winNow && winNow.starterValue > 0) {
      lines.push(`${winNow.team.owner || winNow.team.name} has the best win-now starter profile.`);
    }

    return lines;
  }, [breakdowns]);

  // ── Control handlers ──────────────────────────────────────────────────────
  const updateSlot = (slotIndex: number, newId: string) => {
    setLimitMsg(null);
    setSelectedIds((prev) => {
      // Don't allow the same team in two slots
      if (prev.some((id, i) => id === newId && i !== slotIndex)) return prev;
      const next = [...prev];
      next[slotIndex] = newId;
      return next;
    });
  };
  const removeSlot = (slotIndex: number) => {
    setLimitMsg(null);
    setSelectedIds((prev) => prev.filter((_, i) => i !== slotIndex));
  };
  const addSlot = () => {
    if (selectedIds.length >= compareMax) {
      setLimitMsg(`You can compare up to ${compareMax} teams at once.`);
      return;
    }
    const next = league.teams.find((t) => !selectedIds.includes(t.id));
    if (next) setSelectedIds((prev) => [...prev, next.id]);
  };

  const showTaxi = includeBench && (league.taxiSlots ?? 0) > 0 && breakdowns.some((b) => b.taxi.length > 0);
  const showIR = includeBench && (league.irSlots ?? 0) > 0 && breakdowns.some((b) => b.ir.length > 0);

  // ── Empty states ──────────────────────────────────────────────────────────
  if (!league.teams || league.teams.length === 0) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Compare Teams" subtitle="Side-by-side roster, value, and pick comparison" />
        <Card className="p-8 text-center text-muted-foreground">Roster data could not be loaded.</Card>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="compare-teams">
      <SectionHeader
        title="Compare Teams"
        subtitle="Stack up to 3 rosters in this league side-by-side: position values, picks, taxi, and IR."
      />

      {/* ── Controls strip ───────────────────────────────────────────────── */}
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Team selectors — all slots share one row (flex-1 on mobile, fixed
              width on desktop). The remove "X" sits above each dropdown, and
              "Add manager" only shows below the max. */}
          <div className="flex items-end gap-1.5 w-full md:w-auto">
            {selectedIds.map((id, idx) => (
              <div key={`slot-${idx}`} className="flex flex-col gap-0.5 flex-1 md:flex-none md:w-[170px] min-w-0">
                {selectedIds.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(idx)}
                    className="self-end -mb-0.5 text-muted-foreground hover:text-foreground p-0.5 rounded-md hover:bg-muted/40"
                    aria-label={`Remove team ${idx + 1}`}
                    data-testid={`compare-team-remove-${idx}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <Select value={id} onValueChange={(v) => updateSlot(idx, v)}>
                  <SelectTrigger className="h-8 w-full min-w-0 text-xs" data-testid={`compare-team-select-${idx}`}>
                    <SelectValue placeholder="Pick a manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {league.teams.map((t) => (
                      <SelectItem key={t.id} value={t.id} disabled={selectedIds.includes(t.id) && selectedIds[idx] !== t.id}>
                        {t.owner || t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {selectedIds.length < compareMax && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 shrink-0"
                onClick={addSlot}
                data-testid="compare-add-team"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add manager</span>
                <span className="sm:hidden">Add</span>
              </Button>
            )}
          </div>

          {/* Value mode + include toggles — centered on non-desktop, right-aligned on desktop */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto md:ml-auto">
            <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
              {(["dynasty", "redraft", "both"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setValueMode(mode)}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-sm font-semibold transition-colors",
                    valueMode === mode
                      ? "bg-[#d4af37] text-[#060d1a]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`compare-value-mode-${mode}`}
                >
                  {mode === "dynasty" ? "Dynasty" : mode === "redraft" ? "Win-Now" : "Both"}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={includePicks}
                onChange={(e) => setIncludePicks(e.target.checked)}
                className="w-3.5 h-3.5"
                data-testid="compare-include-picks"
              />
              <span>Picks</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={includeBench}
                onChange={(e) => setIncludeBench(e.target.checked)}
                className="w-3.5 h-3.5"
                data-testid="compare-include-bench"
              />
              <span>Taxi / IR</span>
            </label>
          </div>
        </div>

        {limitMsg && (
          <div className="mt-2 text-[11px] text-amber-500" data-testid="compare-limit-msg">{limitMsg}</div>
        )}
      </Card>

      {/* ── Empty-state messages once controls are visible ───────────────── */}
      {selectedTeams.length < 2 && (
        <Card className="p-6 text-center text-muted-foreground" data-testid="compare-need-more">
          Add at least 2 managers to start comparing.
        </Card>
      )}

      {selectedTeams.length >= 2 && (
        <>
          {/* ── Summary metric strip ───────────────────────────────────────── */}
          <SummaryStrip
            breakdowns={breakdowns}
            valueMode={valueMode}
            includePicks={includePicks}
          />

          {/* ── Insights ───────────────────────────────────────────────────── */}
          {insights.length > 0 && (
            <Card className="p-3 md:p-4 border-[#d4af37]/30 bg-[#d4af37]/5" data-testid="compare-insights">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#d4af37] mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                Quick insights
              </div>
              <ul className="space-y-1 text-[12px] text-foreground/90">
                {insights.map((line, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-[#d4af37] mt-0.5">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── Team columns ───────────────────────────────────────────────── */}
          {/* Equal columns that shrink to fit the viewport (no horizontal scroll);
              columns get a comfortable min width only from md up. */}
          <div className="-mx-2 px-2 pb-2">
            <div
              className="grid gap-2 sm:gap-3 md:gap-4"
              style={{
                gridTemplateColumns: `repeat(${breakdowns.length}, minmax(0, 1fr))`,
              }}
            >
              {breakdowns.map((b) => (
                <TeamColumn
                  key={b.team.id}
                  breakdown={b}
                  valueMode={valueMode}
                  includePicks={includePicks}
                  showTaxi={showTaxi}
                  showIR={showIR}
                  posEdge={posEdge}
                  posRankWithin={posRankWithin}
                  comparedCount={breakdowns.length}
                  totalLeagueTeams={league.teams.length}
                  getPlayerValue={getPlayerValue}
                  getRedraftValue={getRedraftValue}
                  getPickValue={getPickValue}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SummaryStrip({
  breakdowns,
  valueMode,
  includePicks,
}: {
  breakdowns: TeamBreakdown[];
  valueMode: ValueMode;
  includePicks: boolean;
}) {
  const showDyn = valueMode === "dynasty" || valueMode === "both";
  const showRed = valueMode === "redraft" || valueMode === "both";

  const rows: Array<{ key: string; label: string; value: (b: TeamBreakdown) => string; higherIsBetter: boolean; numeric: (b: TeamBreakdown) => number }> = [];
  if (showDyn) rows.push({ key: "totalDyn", label: "Total Dynasty", value: (b) => compactValue(b.totalDyn), higherIsBetter: true, numeric: (b) => b.totalDyn });
  if (showRed) rows.push({ key: "starter",  label: "Starter Value", value: (b) => compactValue(b.starterValue), higherIsBetter: true, numeric: (b) => b.starterValue });
  rows.push({ key: "age", label: "Avg Age", value: (b) => b.avgAge > 0 ? b.avgAge.toFixed(1) : "—", higherIsBetter: false, numeric: (b) => b.avgAge || 99 });
  for (const pos of POSITIONS) {
    rows.push({
      key: `pos-${pos}`,
      label: `${pos} Value`,
      value: (b) => compactValue(valueMode === "redraft" ? b.posRed[pos] : b.posDyn[pos]),
      higherIsBetter: true,
      numeric: (b) => valueMode === "redraft" ? b.posRed[pos] : b.posDyn[pos],
    });
  }
  if (includePicks) {
    rows.push({ key: "picks", label: "Picks Value", value: (b) => compactValue(b.picksValue), higherIsBetter: true, numeric: (b) => b.picksValue });
  }

  const { ref: scrollRef } = useScrollEdges<HTMLDivElement>();

  return (
    <Card className="p-3 md:p-4" data-testid="compare-summary">
      <div ref={scrollRef} className="dc-scroll-x">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/40">
            <th className="dc-sticky-col text-left font-semibold uppercase tracking-wide text-[10px] text-muted-foreground py-1.5 pr-3">Metric</th>
            {breakdowns.map((b) => (
              <th key={b.team.id} className="text-right font-semibold py-1.5 pl-3 min-w-[90px]">
                <div className="truncate max-w-[160px]" title={b.team.owner || b.team.name}>
                  {b.team.owner || b.team.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Highlight the best value in the row.
            const winnerIdx = breakdowns.reduce(
              (best, b, i) => {
                const v = row.numeric(b);
                if (best.idx === -1) return { idx: i, v };
                if (row.higherIsBetter ? v > best.v : v < best.v) return { idx: i, v };
                return best;
              },
              { idx: -1, v: 0 }
            ).idx;
            return (
              <tr key={row.key} className="border-b border-border/20 last:border-0">
                <td className="dc-sticky-col py-1.5 pr-3 text-muted-foreground">{row.label}</td>
                {breakdowns.map((b, i) => (
                  <td
                    key={b.team.id}
                    className={cn(
                      "text-right py-1.5 pl-3 tabular-nums font-mono",
                      i === winnerIdx ? "text-[#d4af37] font-bold" : "text-foreground"
                    )}
                  >
                    {row.value(b)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

function TeamColumn({
  breakdown,
  valueMode,
  includePicks,
  showTaxi,
  showIR,
  posEdge,
  posRankWithin,
  comparedCount,
  totalLeagueTeams,
  getPlayerValue,
  getRedraftValue,
  getPickValue,
}: {
  breakdown: TeamBreakdown;
  valueMode: ValueMode;
  includePicks: boolean;
  showTaxi: boolean;
  showIR: boolean;
  posEdge: Record<PositionKey, { teamId: string | null; value: number }>;
  posRankWithin: Record<PositionKey, Map<string, number>>;
  comparedCount: number;
  totalLeagueTeams: number;
  getPlayerValue: (p: Player) => number;
  getRedraftValue: (p: Player) => number;
  getPickValue: (p: Pick) => number;
}) {
  const { team, byPos, posDyn, posRed, taxi, ir, picks, picksValue, totalDyn, totalRed, avgAge, leagueDynRank } = breakdown;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Sticky header (desktop) so the team identity stays visible as the
          user scrolls long position lists. */}
      <Card className="p-3 sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          {team.avatar ? (
            <img
              src={team.avatar}
              alt={team.name}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-sm font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0">
              {(team.owner || team.name || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate" data-testid={`compare-team-name-${team.id}`}>{team.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{team.owner}</p>
          </div>
          {leagueDynRank > 0 && (
            <Badge variant="outline" className="text-[9px] font-semibold flex items-center gap-0.5">
              {leagueDynRank === 1 && <Crown className="w-2.5 h-2.5 text-[#d4af37]" />}
              #{leagueDynRank}/{totalLeagueTeams}
            </Badge>
          )}
        </div>
        {/* Labels in row 1, values in row 2 — so the three values always align
            on the same row even when a label wraps to two lines. */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 mt-2 text-[10px]">
          <span className="text-muted-foreground uppercase tracking-wider self-end">DYN</span>
          <span className="text-muted-foreground uppercase tracking-wider self-end">Win-Now</span>
          <span className="text-muted-foreground uppercase tracking-wider self-end">Avg Age</span>
          <span className="font-bold tabular-nums">{compactValue(totalDyn)}</span>
          <span className="font-bold tabular-nums">{compactValue(totalRed)}</span>
          <span className="font-bold tabular-nums">{avgAge > 0 ? avgAge.toFixed(1) : "—"}</span>
        </div>
      </Card>

      {/* Position cards */}
      {POSITIONS.map((pos) => {
        const players = byPos[pos];
        const rank = posRankWithin[pos].get(team.id) ?? 0;
        const isEdge = posEdge[pos].teamId === team.id && comparedCount > 1 && players.length > 0;
        const posVal = valueMode === "redraft" ? posRed[pos] : posDyn[pos];

        return (
          <Card
            key={pos}
            className={cn(
              "p-2.5",
              isEdge && "border-[#d4af37]/60 ring-1 ring-[#d4af37]/30"
            )}
            data-testid={`compare-pos-${team.id}-${pos}`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge variant="outline" className={cn("text-[10px] w-7 justify-center", POS_THEME[pos].chip)}>
                  {pos}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {compactValue(posVal)} · {rank > 0 ? `${ordinal(rank)} of ${comparedCount}` : "—"}
                </span>
              </div>
              {isEdge && (
                <Badge variant="outline" className="text-[9px] bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40 font-bold tracking-wider">
                  EDGE
                </Badge>
              )}
            </div>

            {players.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70 italic px-1 py-1">No {pos}s.</div>
            ) : (
              <div className="space-y-0.5">
                {players.map((p, i) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    index={i + 1}
                    valueMode={valueMode}
                    dyn={getPlayerValue(p)}
                    red={getRedraftValue(p)}
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {/* Picks */}
      {includePicks && (
        <Card className="p-2.5" data-testid={`compare-picks-${team.id}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <Badge variant="outline" className="text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30">
              PICKS
            </Badge>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {compactValue(picksValue)} · {picks.length} {picks.length === 1 ? "pick" : "picks"}
            </span>
          </div>
          {picks.length === 0 ? (
            <div className="text-[11px] text-muted-foreground/70 italic px-1 py-1">No future picks.</div>
          ) : (
            <div className="space-y-0.5">
              {picks.map((pk, i) => (
                <div
                  key={`${pk.year}-${pk.round}-${i}`}
                  className="flex items-center justify-between py-1 px-1 rounded-md hover:bg-muted/30"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] text-muted-foreground w-4 tabular-nums">{i + 1}.</span>
                    <span className="text-[11px] font-medium truncate">{formatPickLabel(pk)}</span>
                    {pk.projectedRange && (
                      <span className="text-[9px] text-muted-foreground/70">({pk.projectedRange})</span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-muted-foreground tabular-nums">
                    {compactValue(getPickValue(pk))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Taxi */}
      {showTaxi && (
        <Card className="p-2.5" data-testid={`compare-taxi-${team.id}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <Badge variant="outline" className="text-[10px] bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30">
              TAXI
            </Badge>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {taxi.length} {taxi.length === 1 ? "player" : "players"}
            </span>
          </div>
          {taxi.length === 0 ? (
            <div className="text-[11px] text-muted-foreground/70 italic px-1 py-1">Empty.</div>
          ) : (
            <div className="space-y-0.5">
              {[...taxi].sort((a, b) => getPlayerValue(b) - getPlayerValue(a)).map((p, i) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  index={i + 1}
                  valueMode={valueMode}
                  dyn={getPlayerValue(p)}
                  red={getRedraftValue(p)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* IR */}
      {showIR && (
        <Card className="p-2.5" data-testid={`compare-ir-${team.id}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <Badge variant="outline" className="text-[10px] bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">
              IR
            </Badge>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {ir.length} {ir.length === 1 ? "player" : "players"}
            </span>
          </div>
          {ir.length === 0 ? (
            <div className="text-[11px] text-muted-foreground/70 italic px-1 py-1">Empty.</div>
          ) : (
            <div className="space-y-0.5">
              {[...ir].sort((a, b) => getPlayerValue(b) - getPlayerValue(a)).map((p, i) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  index={i + 1}
                  valueMode={valueMode}
                  dyn={getPlayerValue(p)}
                  red={getRedraftValue(p)}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  index,
  valueMode,
  dyn,
  red,
}: {
  player: Player;
  index: number;
  valueMode: ValueMode;
  dyn: number;
  red: number;
}) {
  const showDyn = valueMode === "dynasty" || valueMode === "both";
  const showRed = valueMode === "redraft" || valueMode === "both";
  const { openPlayerProfile } = usePlayerProfile();
  // Non-desktop shows "F. Last" (first initial + last name) to save horizontal
  // space; falls back to the raw name when it isn't a simple two-part name.
  const nameParts = player.name.trim().split(/\s+/);
  const shortName = nameParts.length >= 2
    ? `${nameParts[0][0]}. ${nameParts.slice(1).join(" ")}`
    : player.name;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openPlayerProfile(player.sleeperId || player.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlayerProfile(player.sleeperId || player.id); } }}
      className="flex items-center gap-2 py-1 px-1 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
      data-testid={`compare-player-${player.id}`}
    >
      <span className="hidden md:block text-[10px] text-muted-foreground w-4 tabular-nums flex-shrink-0">{index}.</span>
      <PlayerAvatar id={player.sleeperId || player.id} name={player.name} pos={player.pos} team={player.team} size="xs" compact />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold truncate leading-tight">
          <span className="hidden md:inline">{player.name}</span>
          <span className="md:hidden">{shortName}</span>
        </p>
        <p className="text-[9px] text-muted-foreground leading-tight">
          {player.pos}{player.team ? ` · ${player.team}` : ""}{player.age > 0 ? ` · ${player.age}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0 flex-shrink-0">
        {showDyn && (
          <span className="text-[11px] font-mono font-semibold tabular-nums">{compactValue(dyn)}</span>
        )}
        {showRed && (
          <span className={cn("text-[9px] font-mono tabular-nums text-muted-foreground", showDyn && "leading-tight")}>{compactValue(red)}</span>
        )}
      </div>
    </div>
  );
}

