/**
 * PlayerProfileDrawer — side-drawer / bottom-sheet that opens off the ADP
 * Explorer (List/Box/Hex/Round Board) for a single player.
 *
 * Filter-aware: every analytic tab below (Overview, ADP, Availability) takes
 * the active DraftCommand filter state as a prop and forwards it to the
 * backend so the figures match whatever the user is looking at. Without the
 * filter pass-through the modal silently fell back to startup-only data and
 * "Rookie Drafts → Direct Rookies" looked identical to "Startup ADP".
 */

import { useEffect, useState, useMemo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import type { ADPResult, Position, DraftFilters } from "@/types/draft";
import {
  Loader2, AlertCircle, TrendingUp, TrendingDown, BarChart3,
  Activity, History, Layers, Newspaper, Sparkles,
} from "lucide-react";

interface AdpHistoryPoint {
  window: "7d" | "30d" | "90d";
  draftCount: number;
  avgPick: number | null;
  minPick: number | null;
  maxPick: number | null;
  asOf: string;
}

interface AdpHistoryResponse {
  playerId: string;
  buckets: AdpHistoryPoint[];
  /** One bucket per calendar month the player was drafted in, last 36 months.
   *  Months with zero picks are omitted, so recent rookies naturally return
   *  fewer than 36 entries — the chart range is the player's NFL career or
   *  3 years, whichever is shorter. Optional so older cached responses
   *  (pre-monthly rollout) don't crash the client. */
  monthly?: Array<{ month: string; avgPick: number; count: number }>;
  // Legacy field — pre-monthly server returned a daily series capped at 90
  // days. New server returns this empty; we leave the type here so a stale
  // cached response stays type-compatible.
  daily?: Array<{ date: string; avgPick: number; count: number }>;
  // Optional — older cached responses may omit. UI hides the per-round
  // distribution row when absent.
  pickHistogram?: Array<{ pickNo: number; count: number }>;
}

interface AvailabilityCell {
  pickNo: number;
  round: number;
  pickInRound: number;
  availabilityPct: number;
}

interface AvailabilityResponse {
  playerId: string;
  teams: number;
  rounds: number;
  totalDrafts: number;
  draftsWithPlayer: number;
  expectedPick: number | null;
  biggestDropAt: { fromPick: number; toPick: number; delta: number } | null;
  cells: AvailabilityCell[];
  // Optional — older cached responses may omit. The UI hides the histogram
  // when absent rather than rendering an empty axis.
  pickHistogram?: Array<{ pickNo: number; count: number }>;
}

interface PlayerMetadata {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  injury_status: string | null;
  fantasy_positions: string[] | null;
  active: boolean;
  college: string | null;
  height: string | null;
  weight: string | null;
  birth_date: string | null;
  number: number | null;
  status: string | null;
  rookie_year: number | null;
}

interface ProductionSeason {
  season: number;
  team: string | null;
  games: number;
  fantasy_points: number;
  ppg: number;
  positional_finish: string | null;
}

interface ProductionResponse {
  playerId: string;
  scoring: "ppr" | "half_ppr" | "std";
  seasons: ProductionSeason[];
}

const POS_TINT: Record<Position, { bg: string; ring: string; text: string }> = {
  QB:   { bg: "bg-red-500/15",     ring: "ring-red-500/40",     text: "text-red-300" },
  RB:   { bg: "bg-emerald-500/15", ring: "ring-emerald-500/40", text: "text-emerald-300" },
  WR:   { bg: "bg-blue-500/15",    ring: "ring-blue-500/40",    text: "text-blue-300" },
  TE:   { bg: "bg-amber-500/15",   ring: "ring-amber-500/40",   text: "text-amber-300" },
  K:    { bg: "bg-purple-500/15",  ring: "ring-purple-500/40",  text: "text-purple-300" },
  PICK: { bg: "bg-[#d4af37]/15",   ring: "ring-[#d4af37]/40",   text: "text-[#fde68a]" },
};

interface PlayerProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  adp: ADPResult | null;
  /** Number of teams in the user's currently-selected draft size, used to
   *  build the Pick Availability grid. Defaults to 12. */
  teams?: number;
  rounds?: number;
  /** Active DraftCommand filter state — forwarded into the player-specific
   *  history / availability endpoints so the modal reflects the dataset the
   *  user is looking at. Optional so the drawer can still be used from
   *  contexts (tests, dev tools) that don't have a filter set. */
  filters?: DraftFilters;
}

// Stringify the DraftFilters into the same query string /api/adp expects.
// Subset only — date range, scoring, SF, TEP, draftType, rookieMode, teams.
function filtersToQuery(filters?: DraftFilters): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.season === "all") p.set("season", "all");
  else if (Array.isArray(filters.season)) p.set("season", filters.season.join(","));
  else if (filters.season) p.set("season", filters.season);
  // Mirror the same Rookie-Picks override the main /api/adp URL builder
  // applies so the modal can't drift from the table.
  const effectiveDraftType = filters.rookieMode === "picks" ? "rookie" : filters.draftType;
  p.set("draftType", effectiveDraftType);
  p.set("draftFormat", filters.draftFormat);
  p.set("rookieMode", filters.rookieMode);
  p.set("leagueMode", filters.leagueMode);
  if (filters.scoring !== "all") p.set("scoring", filters.scoring);
  if (filters.superflex !== "all") p.set("superflex", filters.superflex);
  if (filters.tePremium !== "all") p.set("tePremium", filters.tePremium);
  if (filters.bestBall !== "all") p.set("bestBall", filters.bestBall);
  if (filters.teams !== "all") p.set("teams", String(filters.teams));
  if (filters.passTd !== "all") p.set("passTd", String(filters.passTd));
  if (filters.dateRange.start) p.set("startDate", filters.dateRange.start);
  if (filters.dateRange.end) p.set("endDate", filters.dateRange.end);
  return p.toString();
}

// Human-readable summary of the active filter context. Shown near each tab's
// title so the user always knows which dataset the figures came from.
function filterContextLabel(filters?: DraftFilters): string {
  if (!filters) return "";
  const parts: string[] = [];
  if (typeof filters.teams === "number") parts.push(`${filters.teams}T`);
  if (filters.superflex === "yes") parts.push("SF");
  else if (filters.superflex === "no") parts.push("1QB");
  if (filters.tePremium === "yes") parts.push("TEP");
  if (filters.scoring !== "all") parts.push(filters.scoring.toUpperCase());
  if (filters.rookieMode === "picks") parts.push("Rookie · Placeholders");
  else if (filters.draftType === "rookie") parts.push("Rookie · Direct");
  else if (filters.draftType === "startup") parts.push("Startup");
  else parts.push("All Drafts");
  const days = daysBetweenIso(filters.dateRange.start, filters.dateRange.end);
  if (days > 0) parts.push(`${days}D`);
  return parts.join(" · ");
}

function daysBetweenIso(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.round((e - s) / 86_400_000);
}

export function PlayerProfileDrawer({ open, onClose, adp, teams = 12, rounds = 5, filters }: PlayerProfileDrawerProps) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("overview");

  // Reset to overview every time a new player is opened.
  useEffect(() => { if (open) setTab("overview"); }, [open, adp?.player_id]);

  const ctxLabel = useMemo(() => filterContextLabel(filters), [filters]);
  const filterQuery = useMemo(() => filtersToQuery(filters), [filters]);

  // Real Sleeper metadata for the open player. Fetched once per player_id;
  // the API caches the underlying /players/nfl payload so this is cheap.
  // Only request when the id looks like a real Sleeper numeric id —
  // rookie-pick placeholder rows have non-numeric ids and would 404.
  const [meta, setMeta] = useState<PlayerMetadata | null>(null);
  useEffect(() => {
    setMeta(null);
    if (!open || !adp) return;
    if (!/^\d+$/.test(adp.player_id)) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/sleeper/player/${encodeURIComponent(adp.player_id)}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return null;
        return r.json() as Promise<PlayerMetadata>;
      })
      .then((j) => { if (!cancelled) setMeta(j); })
      .catch(() => { /* non-fatal — header just falls back to ADP fields */ });
    return () => { cancelled = true; };
  }, [open, adp?.player_id]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 border-l border-border/60 bg-[#0a1628] text-foreground overflow-hidden flex flex-col",
          isMobile
            ? "h-[92vh] sm:max-w-full rounded-t-2xl"
            : "w-full sm:max-w-[540px]",
        )}
        data-testid="player-profile-drawer"
      >
        <SheetTitle className="sr-only">
          {adp ? `${adp.player_name} profile` : "Player profile"}
        </SheetTitle>

        {adp ? (
          <>
            <ProfileHeader adp={adp} ctxLabel={ctxLabel} meta={meta} />
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-3 mt-1.5 grid grid-cols-6 h-7 bg-white/[0.04] p-0.5">
                <TabsTrigger value="overview"     className="text-[10px] flex items-center gap-1 h-6 px-1.5"><BarChart3 className="w-3 h-3"/>Overview</TabsTrigger>
                <TabsTrigger value="production"   className="text-[10px] flex items-center gap-1 h-6 px-1.5"><Activity className="w-3 h-3"/>Production</TabsTrigger>
                <TabsTrigger value="advanced"     className="text-[10px] flex items-center gap-1 h-6 px-1.5"><Layers className="w-3 h-3"/>Advanced</TabsTrigger>
                <TabsTrigger value="history"      className="text-[10px] flex items-center gap-1 h-6 px-1.5"><History className="w-3 h-3"/>ADP</TabsTrigger>
                <TabsTrigger value="availability" className="text-[10px] flex items-center gap-1 h-6 px-1.5">Avail.</TabsTrigger>
                <TabsTrigger value="news"         className="text-[10px] flex items-center gap-1 h-6 px-1.5"><Newspaper className="w-3 h-3"/>News</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <TabsContent value="overview"><OverviewTab adp={adp} ctxLabel={ctxLabel} teams={teams} /></TabsContent>
                <TabsContent value="production"><ProductionTab adp={adp} active={tab === "production"} /></TabsContent>
                <TabsContent value="advanced"><AdvancedShell /></TabsContent>
                <TabsContent value="history"><AdpHistoryTab playerId={adp.player_id} active={tab === "history"} ctxLabel={ctxLabel} filterQuery={filterQuery} teams={teams} /></TabsContent>
                <TabsContent value="availability">
                  <AvailabilityTab
                    playerId={adp.player_id}
                    playerName={adp.player_name}
                    teams={teams}
                    rounds={rounds}
                    expectedAdp={adp.avg_pick}
                    active={tab === "availability"}
                    ctxLabel={ctxLabel}
                    filterQuery={filterQuery}
                  />
                </TabsContent>
                <TabsContent value="news"><NewsShell /></TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">No player selected.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ adp, ctxLabel, meta }: { adp: ADPResult; ctxLabel: string; meta: PlayerMetadata | null }) {
  const tint = POS_TINT[adp.position] ?? POS_TINT.WR;
  const looksLikeSleeperId = /^\d+$/.test(adp.player_id);
  const rising = adp.trend_30d < -2;
  const falling = adp.trend_30d > 2;
  // Prefer Sleeper-canonical team when we have it — ADPResult.team can lag
  // behind a mid-week trade by a full re-aggregation cycle.
  const team = meta?.team ?? adp.team ?? null;
  const isRookie = meta?.years_exp === 0;
  // Surface a meaningful injury chip only when Sleeper actually reports
  // status text — "Healthy" rows come back as null/empty and would render
  // a noisy "—" badge otherwise.
  const injury = meta?.injury_status && meta.injury_status.trim().length > 0
    ? meta.injury_status
    : null;
  return (
    <div className="px-4 pt-4 pb-3 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className={cn(
            "w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center ring-1",
            tint.bg, tint.ring,
          )}>
            {looksLikeSleeperId ? (
              <img
                src={`https://sleepercdn.com/content/nfl/players/thumb/${adp.player_id}.jpg`}
                alt={adp.player_name}
                className="w-full h-full object-cover object-top"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <span className={cn("font-bold text-base", tint.text)}>
                {adp.player_name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </span>
            )}
          </div>
          {/* Team logo overlay, bottom-right of the headshot. Hidden for FAs
              and rookie-pick placeholders. Uses the same sleepercdn pattern
              the rest of the app (PlayerAvatar, CompareRBs, …) uses. */}
          {team && (
            <img
              src={`https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`}
              alt={team}
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full ring-1 ring-[#0a1628] bg-[#0a1628] object-contain p-px"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h2 className="text-[15px] font-bold truncate" data-testid="profile-name">{adp.player_name}</h2>
            {rising && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
            {falling && <TrendingDown className="w-3.5 h-3.5 text-rose-400" />}
            {isRookie && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-[#d4af37] border-[#d4af37]/40 font-semibold" data-testid="profile-rookie-badge">
                Rookie
              </Badge>
            )}
            {injury && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-rose-300 border-rose-500/40 font-semibold" data-testid="profile-injury-badge">
                {injury}
              </Badge>
            )}
          </div>
          {/* Inline metrics row — compact, no giant standalone ADP block. */}
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", tint.text)}>
              {adp.position}{adp.positional_rank}
            </Badge>
            <span>{team || (adp.is_rookie_placeholder ? "Rookie Pick" : "FA")}</span>
            <span className="text-white/20">·</span>
            <span>Overall #{adp.overall_rank}</span>
            <span className="text-white/20">·</span>
            <span><span className="text-[#d4af37] font-semibold tabular-nums">ADP {adp.avg_pick.toFixed(1)}</span></span>
            <span className="text-white/20">·</span>
            <span className="tabular-nums">{adp.min_pick}–{adp.max_pick}</span>
            <span className="text-white/20">·</span>
            <span className="tabular-nums">{adp.draft_count} drafts</span>
          </div>
          {/* Sleeper-derived secondary row — age, NFL experience, college.
              Only renders when we actually have data so the header doesn't
              spawn a half-empty line for placeholder rows. */}
          {meta && (meta.age != null || meta.years_exp != null || meta.college) && (
            <div className="text-[10.5px] text-white/55 mt-1 flex items-center gap-1.5 flex-wrap" data-testid="profile-bio-row">
              {meta.age != null && <span className="tabular-nums">Age {meta.age}</span>}
              {meta.age != null && meta.years_exp != null && <span className="text-white/20">·</span>}
              {meta.years_exp != null && (
                <span className="tabular-nums">
                  {meta.years_exp === 0 ? "Rookie" : `${meta.years_exp} yr${meta.years_exp === 1 ? "" : "s"} exp`}
                </span>
              )}
              {meta.college && (meta.age != null || meta.years_exp != null) && <span className="text-white/20">·</span>}
              {meta.college && <span className="truncate">{meta.college}</span>}
            </div>
          )}
          {ctxLabel && (
            <div className="text-[10px] text-white/40 mt-1 truncate" title={ctxLabel}>
              {ctxLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ adp, ctxLabel, teams }: { adp: ADPResult; ctxLabel: string; teams: number }) {
  const range = Math.max(1, adp.max_pick - adp.min_pick);
  const medianPct = ((adp.median_pick - adp.min_pick) / range) * 100;
  const currentPct = ((adp.avg_pick - adp.min_pick) / range) * 100;

  const tier = playerTier(adp);
  const marketBadge = marketStatus(adp);
  const insights = buildOverviewInsights(adp);
  const trendChips = buildTrendChips(adp);
  const summary = buildPlayerSummary(adp, ctxLabel);
  const distributionLine = buildDistributionLine(adp, teams);

  return (
    <div className="space-y-4 text-[12px]">
      {/* Prose narrative — the "fantasy stock profile" lead-in. */}
      {summary && (
        <p className="text-[12.5px] leading-snug text-white/85" data-testid="overview-summary">
          {summary}
        </p>
      )}

      {/* Tier + market status */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="overview-tier-row">
        <Badge variant="outline" className="text-[10px] text-[#d4af37] border-[#d4af37]/40 font-semibold">
          {tier}
        </Badge>
        {marketBadge && (
          <Badge variant="outline" className={cn("text-[10px]", marketBadge.className)}>
            {marketBadge.label}
          </Badge>
        )}
        {adp.sample_size_warning && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">
            Small sample
          </Badge>
        )}
      </div>

      {/* Compact stat strip — single horizontal row, no boxed cards. */}
      <div className="flex items-baseline gap-3 flex-wrap text-[11px] text-muted-foreground" data-testid="overview-stat-strip">
        <StripStat label="Min" value={adp.min_pick} />
        <StripStat label="Median" value={adp.median_pick} />
        <StripStat label="Max" value={adp.max_pick} />
        <StripStat label="Drafts" value={adp.draft_count.toLocaleString()} />
        {trendChips.map((c) => (
          <StripStat key={c.label} label={c.label} value={c.value} accent={c.accent} />
        ))}
      </div>

      {/* Distribution rail — min … median … current … max with markers and shading. */}
      <div data-testid="overview-distribution">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          <span>Draft Position Distribution</span>
          <span className="text-white/50 normal-case tracking-normal">{ctxLabel || ""}</span>
        </div>
        <div className="relative h-2 rounded-full bg-white/5 border border-white/10 overflow-hidden">
          {/* Median to max — softer band. */}
          <div className="absolute inset-y-0 bg-blue-500/25" style={{ left: `${medianPct}%`, right: 0 }} />
          {/* Min to median — denser band (the bulk of the range). */}
          <div className="absolute inset-y-0 bg-blue-500/40" style={{ left: 0, width: `${medianPct}%` }} />
          {/* Median marker. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-white/70"
            style={{ left: `calc(${medianPct}% - 0.5px)` }}
            title={`Median ${adp.median_pick}`}
          />
          {/* Current ADP marker — gold dot. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#d4af37] ring-1 ring-[#d4af37]/60 shadow-[0_0_6px_rgba(212,175,55,0.9)]"
            style={{ left: `calc(${currentPct}% - 5px)` }}
            title={`ADP ${adp.avg_pick.toFixed(1)}`}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span title="Earliest observed pick">Min {adp.min_pick}</span>
          <span className="text-white/70">Median {adp.median_pick}</span>
          <span className="text-[#d4af37] font-semibold">ADP {adp.avg_pick.toFixed(1)}</span>
          <span title="Latest observed pick">Max {adp.max_pick}</span>
        </div>
        {distributionLine && (
          <p className="text-[11px] text-white/70 mt-2" data-testid="overview-distribution-context">
            {distributionLine}
          </p>
        )}
      </div>

      {insights.length > 0 && (
        <div className="space-y-1.5" data-testid="overview-insights">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3 h-3 text-[#d4af37]" /> Draft Insights
          </div>
          <ul className="space-y-1 text-[11px] text-white/85">
            {insights.map((i, idx) => (
              <li key={idx} className="flex gap-1.5">
                <span className="text-[#d4af37] mt-px">•</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StripStat({ label, value, accent }: { label: string; value: string | number; accent?: "emerald" | "rose" }) {
  const accentClass = accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-bold tabular-nums text-[12px]", accentClass)}>{value}</span>
    </span>
  );
}

function playerTier(adp: ADPResult): string {
  if (adp.is_rookie_placeholder) return "Rookie Pick Asset";
  if (adp.overall_rank <= 6)  return "Tier 1 · Foundation Asset";
  if (adp.overall_rank <= 12) return "Elite Startup Cornerstone";
  if (adp.overall_rank <= 24) return "Early-Round Anchor";
  if (adp.overall_rank <= 48) return "Mid-Round Starter";
  if (adp.overall_rank <= 96) return "Roster Builder";
  return "Late-Round Upside";
}

function marketStatus(adp: ADPResult): { label: string; className: string } | null {
  const mag30 = Math.abs(adp.trend_30d);
  const mag7 = Math.abs(adp.trend_7d);
  if (mag30 >= 5 || mag7 >= 6)  return { label: "Volatile",       className: "text-amber-300 border-amber-500/40" };
  if (adp.trend_30d <= -3)      return { label: "Rising Fast",    className: "text-emerald-300 border-emerald-500/40" };
  if (adp.trend_30d < 0)        return { label: "Trending Up",    className: "text-emerald-300 border-emerald-500/40" };
  if (adp.trend_30d >= 3)       return { label: "Trending Down",  className: "text-rose-300 border-rose-500/40" };
  return { label: "Market Stable", className: "text-white/60 border-white/20" };
}

function buildTrendChips(adp: ADPResult): Array<{ label: string; value: string; accent?: "emerald" | "rose" }> {
  // Only surface a chip when the trend is meaningful (≥ 0.3 pick movement).
  // Suppresses the dead "—" cards the old layout left behind.
  const chips: Array<{ label: string; value: string; accent?: "emerald" | "rose" }> = [];
  if (Math.abs(adp.trend_7d) >= 0.3) {
    chips.push({
      label: "7D",
      value: trendArrow(adp.trend_7d),
      accent: adp.trend_7d < 0 ? "emerald" : "rose",
    });
  }
  if (Math.abs(adp.trend_30d) >= 0.3) {
    chips.push({
      label: "30D",
      value: trendArrow(adp.trend_30d),
      accent: adp.trend_30d < 0 ? "emerald" : "rose",
    });
  }
  return chips;
}

function trendArrow(n: number): string {
  if (n === 0) return "Stable";
  const sign = n > 0 ? "↓" : "↑";
  return `${sign} ${Math.abs(n).toFixed(1)}`;
}

/** Premium-card lead-in sentence. Stitches position rank, overall rank,
 *  filter context, draft volume, ADP, and 30-day trend into a single,
 *  human-readable paragraph. Returns null if there's nothing meaningful to
 *  say (no sample, rookie placeholder with no ADP, etc.). */
function buildPlayerSummary(adp: ADPResult, ctxLabel: string): string | null {
  if (adp.draft_count <= 0) return null;
  const pron = guessPronoun(adp.player_name);
  const posPhrase = adp.is_rookie_placeholder
    ? "a tracked rookie pick"
    : `the ${adp.position}${adp.positional_rank}`;
  const overallPhrase = adp.is_rookie_placeholder
    ? ""
    : ` and overall #${adp.overall_rank}`;
  const ctx = ctxLabel ? ` in ${ctxLabel}` : "";
  const draftWord = adp.draft_count === 1 ? "draft" : "drafts";

  let trendNote = "";
  if (adp.draft_count >= 20) {
    if (adp.trend_30d <= -1.5) {
      trendNote = ` Value is rising — ADP has tightened about ${Math.abs(adp.trend_30d).toFixed(1)} spots in the last 30 days.`;
    } else if (adp.trend_30d >= 1.5) {
      trendNote = ` Value is softening — ADP has slipped about ${Math.abs(adp.trend_30d).toFixed(1)} spots in the last 30 days.`;
    } else {
      trendNote = " Market position has held steady through the last month.";
    }
  }

  return `${adp.player_name} is currently ${posPhrase}${overallPhrase}${ctx}. ${pron} has been selected in ${adp.draft_count.toLocaleString()} tracked ${draftWord} at ADP ${adp.avg_pick.toFixed(1)}.${trendNote}`;
}

/** "X% of drafts selected [Player] between picks A.BB and C.DD" — uses the
 *  p10/p90 percentile band (middle 80% of the sample). Returns null when the
 *  sample is too small or the band collapses to a single pick. */
function buildDistributionLine(adp: ADPResult, teams: number): string | null {
  if (adp.p10_pick == null || adp.p90_pick == null) return null;
  if (adp.draft_count < 15) return null; // band isn't meaningful below this
  const lo = adp.p10_pick;
  const hi = adp.p90_pick;
  if (lo === hi) return null;
  const loStr = formatPick(lo, teams);
  const hiStr = formatPick(hi, teams);
  return `80% of drafts selected ${shortName(adp.player_name)} between picks ${loStr} and ${hiStr}.`;
}

function formatPick(pickNo: number, teams: number): string {
  // Round.pick form when we actually know the league size; otherwise the
  // raw pick number so we don't fabricate a structure that doesn't exist.
  if (!teams || teams <= 0) return String(pickNo);
  const round = Math.ceil(pickNo / teams);
  const slot = ((pickNo - 1) % teams) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

function shortName(full: string): string {
  // "Bijan Robinson" → "Bijan Robinson" stays as-is here; the helper is in
  // place so future tightening (e.g. "B. Robinson" on mobile) is one edit.
  return full;
}

function guessPronoun(name: string): string {
  // Defensive default — every fantasy player in this dataset is currently
  // male, but we don't want to bake a hard assumption into the codebase.
  // If the dataset ever broadens, switch this to a name → pronoun lookup.
  void name;
  return "He";
}

function buildOverviewInsights(adp: ADPResult): string[] {
  const out: string[] = [];
  const range = adp.max_pick - adp.min_pick;
  // Tight ADP range.
  if (adp.draft_count >= 25 && range <= 6) {
    out.push(`Rarely falls outside the ${adp.min_pick}–${adp.max_pick} range across the filtered sample.`);
  }
  // Positional anchor.
  if (adp.positional_rank === 1) {
    out.push(`Currently the consensus ${adp.position}1 in this view.`);
  } else if (adp.positional_rank <= 6) {
    out.push(`Sits inside the top ${adp.positional_rank === 1 ? "1" : adp.positional_rank} at ${adp.position} in this filter context.`);
  }
  // Trend interpretation.
  if (adp.trend_30d <= -1.5) {
    out.push(`Market value rising — ADP has improved about ${Math.abs(adp.trend_30d).toFixed(1)} spots over the last 30 days.`);
  } else if (adp.trend_30d >= 1.5) {
    out.push(`Market cooling — ADP has slipped about ${Math.abs(adp.trend_30d).toFixed(1)} spots over the last 30 days.`);
  } else if (adp.draft_count >= 25) {
    out.push("Market position has held steady over the last 30 days.");
  }
  return out;
}

// ── Production ──────────────────────────────────────────────────────────────

function ProductionTab({ adp, active }: { adp: ADPResult; active: boolean }) {
  const [data, setData] = useState<ProductionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setData(null);
    setError(null);
    // Sleeper player IDs are numeric; rookie-pick placeholders aren't and
    // have no production to fetch. Skip the round-trip entirely.
    if (!/^\d+$/.test(adp.player_id)) {
      setData({ playerId: adp.player_id, scoring: "ppr", seasons: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/players/${encodeURIComponent(adp.player_id)}/production?scoring=ppr`, { credentials: "include" })
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) {
          throw new Error(`Production request failed (${r.status})`);
        }
        return r.json() as Promise<ProductionResponse>;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load production"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, adp.player_id]);

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading production…</div>;
  }
  if (error) {
    return <div className="flex items-center gap-2 text-rose-400 text-sm"><AlertCircle className="w-4 h-4"/>{error}</div>;
  }
  const seasons = data?.seasons ?? [];
  const isPlaceholder = !/^\d+$/.test(adp.player_id);

  return (
    <div className="space-y-3 text-[12px]" data-testid="production-tab">
      {/* PPG trend chips — newest first, with delta vs. prior season. Hidden
          when there's <2 seasons since a single bar isn't a trend. */}
      {seasons.length >= 2 && <PpgTrend seasons={seasons} />}

      <div className="rounded-md border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/[0.04] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Season</th>
              <th className="px-2 py-1.5 text-left">Team</th>
              <th className="px-2 py-1.5 text-right">G</th>
              <th className="px-2 py-1.5 text-right">Pts</th>
              <th className="px-2 py-1.5 text-right">PPG</th>
              <th className="px-2 py-1.5 text-right">Finish</th>
            </tr>
          </thead>
          <tbody>
            {seasons.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                  {isPlaceholder
                    ? "Rookie-pick placeholder — no NFL production yet."
                    : "No production data available yet."}
                  {adp.team && <span className="block text-[10px] mt-0.5 text-white/40">Current team: {adp.team}</span>}
                </td>
              </tr>
            ) : (
              seasons.map((s) => (
                <tr key={s.season} className="border-t border-white/5">
                  <td className="px-2 py-1.5 font-semibold tabular-nums">{s.season}</td>
                  <td className="px-2 py-1.5 text-white/80">{s.team ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.games || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-white/85">{s.fantasy_points.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#d4af37] font-semibold">{s.ppg.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.positional_finish ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-white/40">PPR scoring, Sleeper season totals.</p>
    </div>
  );
}

/** Tiny per-season PPG bar chart. Newest season is gold so it pops out of
 *  the trend at a glance. Skipped when fewer than two seasons exist (a
 *  single bar isn't a trend, just a number). */
function PpgTrend({ seasons }: { seasons: ProductionSeason[] }) {
  // The table renders newest-first; the chart reads better oldest → newest
  // so the eye sees time moving left → right.
  const ordered = [...seasons].sort((a, b) => a.season - b.season);
  const maxPpg = Math.max(0.1, ...ordered.map((s) => s.ppg));
  const latest = ordered[ordered.length - 1];
  const prior = ordered[ordered.length - 2];
  const delta = latest && prior ? latest.ppg - prior.ppg : 0;
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-2" data-testid="production-trend">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        <span>PPG by season</span>
        {prior && (
          <span className={cn(
            "tabular-nums normal-case tracking-normal font-semibold",
            delta > 0.2 ? "text-emerald-300" : delta < -0.2 ? "text-rose-300" : "text-white/55",
          )}>
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta).toFixed(1)} vs {prior.season}
          </span>
        )}
      </div>
      {/* items-stretch (the default) — `items-end` previously collapsed each
           column to its intrinsic height, which broke the bar's percentage-
           height cascade (flex-1 → 0px → bar at 0px). Stretching gives the
           inner flex-1 a definite parent so the bar percentages render. */}
      <div className="flex items-stretch gap-2 h-14">
        {ordered.map((s, i) => {
          const isLatest = i === ordered.length - 1;
          const heightPct = (s.ppg / maxPpg) * 100;
          return (
            <div key={s.season} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full">
              <div className="flex-1 w-full flex items-end min-h-0">
                <div
                  className={cn("w-full rounded-t-sm", isLatest ? "bg-[#d4af37]" : "bg-[#d4af37]/40")}
                  style={{ height: `${Math.max(6, heightPct)}%` }}
                  title={`${s.season}: ${s.ppg.toFixed(1)} PPG`}
                />
              </div>
              <div className="text-[9px] text-white/55 tabular-nums">{s.season}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Advanced shell ──────────────────────────────────────────────────────────

function AdvancedShell() {
  // Placeholder cards reserved for the future advanced-metrics endpoint
  // (target share, YPRR, EPA, etc.). No fake values — empty cells stay empty.
  const placeholders = [
    "Target Share", "Yards / Route Run", "Air Yards",
    "Red Zone Usage", "Route Participation", "Snap Share",
  ];
  return (
    <div className="space-y-3" data-testid="advanced-tab">
      <p className="text-[11px] text-muted-foreground">
        Advanced metrics will populate once the stat provider integration ships.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {placeholders.map((p) => (
          <div key={p} className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{p}</div>
            <div className="text-[15px] font-bold tabular-nums text-white/35">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ADP History ─────────────────────────────────────────────────────────────

function AdpHistoryTab({ playerId, active, ctxLabel, filterQuery, teams }: { playerId: string; active: boolean; ctxLabel: string; filterQuery: string; teams: number }) {
  const [data, setData] = useState<AdpHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = filterQuery ? `?${filterQuery}` : "";
    fetch(`${API_BASE}/api/adp/player/${encodeURIComponent(playerId)}/history${qs}`, { credentials: "include" })
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) {
          throw new Error(`History request failed (${r.status})`);
        }
        return r.json() as Promise<AdpHistoryResponse>;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load ADP history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerId, active, filterQuery]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading ADP history…</div>;
  if (error)   return <div className="flex items-center gap-2 text-rose-400 text-sm"><AlertCircle className="w-4 h-4"/>{error}</div>;
  if (!data)   return <div className="text-sm text-muted-foreground">No history yet.</div>;

  const monthly = data.monthly ?? [];
  const hasMonthly = monthly.length >= 2;
  const summary = buildAdpSummary(data);
  const trendBadge = buildTrendBadge(data);
  const roundBars = buildRoundBars(data.pickHistogram ?? [], teams);

  return (
    <div className="space-y-3 text-[12px]" data-testid="adp-history-tab">
      {/* Summary stat chips — windowed averages from the buckets payload.
          No longer drive the chart; the chart is always the monthly series. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {(["7d", "30d", "90d"] as const).map((r) => {
            const b = data.buckets.find((x) => x.window === r);
            const adp = b?.avgPick != null ? b.avgPick.toFixed(1) : "—";
            return (
              <span
                key={r}
                className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-full border border-white/8 bg-white/[0.02] text-white/65"
                data-testid={`adp-range-${r}`}
              >
                <span className="uppercase tracking-wider">{r.toUpperCase()}</span>
                <span className="font-bold tabular-nums text-[11px] text-white/85">{adp}</span>
              </span>
            );
          })}
        </div>
        {ctxLabel && <span className="text-[10px] text-white/40 truncate ml-2" title={ctxLabel}>{ctxLabel}</span>}
      </div>

      {summary && (
        <p className="text-[11px] text-white/75 leading-snug" data-testid="adp-trend-summary">
          {summary}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          <span className="flex items-center gap-1.5">
            ADP over time
            <span className="text-white/35 normal-case tracking-normal">· monthly · 3y</span>
            {trendBadge && (
              <span
                className={cn("inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] normal-case tracking-normal", trendBadge.className)}
                data-testid="adp-trend-badge"
              >
                {trendBadge.arrow}{trendBadge.label}
              </span>
            )}
          </span>
          <span className="text-white/40 normal-case tracking-normal">Lower = earlier drafted</span>
        </div>
        {hasMonthly ? <MonthlyAdpLine series={monthly} /> : (
          <div className="rounded-md border border-white/8 bg-white/[0.02] py-6 text-center text-[11px] text-muted-foreground italic">
            Not enough monthly data yet — this player needs picks in at least two different months.
          </div>
        )}
      </div>

      {roundBars.length > 0 && (
        <div data-testid="adp-round-distribution">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            <span>Pick distribution by round</span>
            <span className="text-white/40 normal-case tracking-normal tabular-nums">{roundBars.reduce((s, r) => s + r.count, 0).toLocaleString()} picks</span>
          </div>
          <div className="space-y-1">
            {roundBars.map((b) => (
              <div key={b.round} className="flex items-center gap-2 text-[10.5px]">
                <span className="w-8 text-muted-foreground tabular-nums">R{b.round}</span>
                <div className="flex-1 h-2.5 rounded-sm bg-white/[0.04] overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-sm",
                      b.isModal ? "bg-[#d4af37]" : "bg-[#d4af37]/45",
                    )}
                    style={{ width: `${b.widthPct}%` }}
                  />
                </div>
                <span className="w-12 text-right text-white/65 tabular-nums">{b.count.toLocaleString()}</span>
                <span className="w-10 text-right text-white/40 tabular-nums">{b.sharePct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildTrendBadge(data: AdpHistoryResponse): { arrow: string; label: string; className: string } | null {
  const b30 = data.buckets.find((b) => b.window === "30d");
  const b90 = data.buckets.find((b) => b.window === "90d");
  if (!b30 || b30.avgPick == null || !b90 || b90.avgPick == null) return null;
  const delta = b30.avgPick - b90.avgPick;
  if (Math.abs(delta) < 0.4) {
    return { arrow: "→ ", label: "Stable", className: "bg-white/5 text-white/60 border border-white/10" };
  }
  if (delta < 0) {
    return { arrow: "↑ ", label: `Rising ${Math.abs(delta).toFixed(1)}`, className: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" };
  }
  return { arrow: "↓ ", label: `Falling ${delta.toFixed(1)}`, className: "bg-rose-500/10 text-rose-300 border border-rose-500/30" };
}

function buildRoundBars(
  hist: Array<{ pickNo: number; count: number }>,
  teams: number,
): Array<{ round: number; count: number; widthPct: number; sharePct: number; isModal: boolean }> {
  if (!hist.length || !teams || teams <= 0) return [];
  const byRound = new Map<number, number>();
  let total = 0;
  for (const p of hist) {
    if (p.count <= 0) continue;
    const round = Math.ceil(p.pickNo / teams);
    byRound.set(round, (byRound.get(round) ?? 0) + p.count);
    total += p.count;
  }
  if (total === 0) return [];
  const rows = Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  const max = Math.max(...rows.map(([, c]) => c));
  const modalRound = rows.reduce((acc, r) => (r[1] > acc[1] ? r : acc), rows[0])[0];
  return rows.map(([round, count]) => ({
    round,
    count,
    widthPct: (count / max) * 100,
    sharePct: (count / total) * 100,
    isModal: round === modalRound,
  }));
}

function buildAdpSummary(data: AdpHistoryResponse): string | null {
  const b30 = data.buckets.find((b) => b.window === "30d");
  const b90 = data.buckets.find((b) => b.window === "90d");
  if (!b30 || b30.avgPick == null) return null;
  if (!b90 || b90.avgPick == null) {
    return `Tracking at ADP ${b30.avgPick.toFixed(1)} across ${b30.draftCount} drafts in the last 30 days.`;
  }
  const delta = b30.avgPick - b90.avgPick;
  if (Math.abs(delta) < 0.4) {
    return `ADP has held within half a pick of ${b30.avgPick.toFixed(1)} across the last 90 days — market position is stable.`;
  }
  if (delta < 0) {
    return `ADP has tightened roughly ${Math.abs(delta).toFixed(1)} spots over the last 30 days — value is rising.`;
  }
  return `ADP has slipped about ${delta.toFixed(1)} spots over the last 30 days — value is softening.`;
}

/** "2025-08" → "Aug 2025". Used for tooltip + axis labels in MonthlyAdpLine.
 *  Returns the input unchanged if the format doesn't match. */
function formatMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${NAMES[monthIdx] ?? m[2]} ${year}`;
}

function MonthlyAdpLine({ series }: { series: Array<{ month: string; avgPick: number; count: number }> }) {
  const W = 480, H = 150, PAD_X = 24, PAD_Y = 16;
  const xs = series.map((_, i) => i);
  const ys = series.map((s) => s.avgPick);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ySpan = Math.max(1, maxY - minY);
  const xSpan = Math.max(1, xs[xs.length - 1] - xs[0]);

  const xAt = (i: number) => PAD_X + ((i - xs[0]) / xSpan) * (W - PAD_X * 2);
  const yAt = (v: number) => PAD_Y + ((v - minY) / ySpan) * (H - PAD_Y * 2);

  // Smooth cubic-bezier path so the chart reads as a market curve, not a
  // jagged scatter. Catmull–Rom → bezier conversion with low tension so
  // the line still respects each data point.
  const pathD = useMemo(() => buildBezierPath(series.map((s, i) => [xAt(i), yAt(s.avgPick)])), [series]);
  const avgY = yAt(series.reduce((s, p) => s + p.avgPick, 0) / series.length);

  const hi = series.reduce((acc, s, i) => s.avgPick > acc.v ? { v: s.avgPick, i } : acc, { v: -Infinity, i: 0 });
  const lo = series.reduce((acc, s, i) => s.avgPick < acc.v ? { v: s.avgPick, i } : acc, { v: Infinity, i: 0 });

  // Hover tracking. We store the index of the nearest data point to keep the
  // tooltip locked to real observations rather than interpolated y-values
  // (would otherwise display a fake "ADP 2.34" between two monthly points).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const onMove = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Map cursor x → viewBox x → data index.
    const localX = ((clientX - rect.left) / rect.width) * W;
    const t = (localX - PAD_X) / (W - PAD_X * 2);
    const targetIdx = Math.round(t * xSpan + xs[0]);
    const clamped = Math.max(0, Math.min(series.length - 1, targetIdx));
    setHoverIdx(clamped);
  };

  const hoverPoint = hoverIdx != null ? series[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xAt(hoverIdx) : null;
  const hoverY = hoverPoint != null ? yAt(hoverPoint.avgPick) : null;
  // Side-flip the tooltip so it doesn't run off the right edge of the chart.
  const tooltipLeftPct = hoverX != null ? (hoverX / W) * 100 : 0;
  const tooltipOnRight = tooltipLeftPct < 60;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-x-auto border border-white/8 rounded-md bg-gradient-to-b from-white/[0.025] to-transparent p-2"
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchStart={(e) => onMove(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHoverIdx(null)}
      data-testid="adp-history-chart"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="adpFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Muted grid baseline. */}
        <line x1={PAD_X} y1={H - PAD_Y} x2={W - PAD_X} y2={H - PAD_Y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        {/* Average ADP reference line. */}
        <line x1={PAD_X} y1={avgY} x2={W - PAD_X} y2={avgY} stroke="rgba(255,255,255,0.18)" strokeWidth={0.7} strokeDasharray="2 3" />
        {/* Soft area under the line. */}
        <path d={`${pathD} L ${W - PAD_X} ${H - PAD_Y} L ${PAD_X} ${H - PAD_Y} Z`} fill="url(#adpFade)" />
        {/* The line itself — thin gold bezier. Monthly dots get a marker so
             sparse series (recent rookies) don't render as a single segment. */}
        <path d={pathD} fill="none" stroke="#d4af37" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        {series.map((s, i) => (
          <circle key={s.month} cx={xAt(i)} cy={yAt(s.avgPick)} r={1.8} fill="#d4af37" opacity={0.55} />
        ))}
        {/* High / low markers — the two points worth annotating. */}
        <circle cx={xAt(lo.i)} cy={yAt(lo.v)} r={2.6} fill="#22d3ee" />
        <circle cx={xAt(hi.i)} cy={yAt(hi.v)} r={2.6} fill="#fb7185" />
        {/* Vertical tracking line + hover marker. */}
        {hoverX != null && hoverY != null && (
          <>
            <line x1={hoverX} y1={PAD_Y} x2={hoverX} y2={H - PAD_Y} stroke="rgba(255,255,255,0.35)" strokeWidth={0.7} strokeDasharray="2 2" />
            <circle cx={hoverX} cy={hoverY} r={3.2} fill="#0a1628" stroke="#d4af37" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {hoverPoint && hoverX != null && (
        <div
          className={cn(
            "absolute top-2 z-10 pointer-events-none rounded-md border border-white/15 bg-[#0a1628]/95 backdrop-blur px-2 py-1 shadow-lg text-[10px] leading-tight",
            tooltipOnRight ? "left-[55%]" : "right-[55%]",
          )}
          data-testid="adp-history-tooltip"
        >
          <div className="text-white/55">{formatMonthLabel(hoverPoint.month)}</div>
          <div className="text-[#d4af37] tabular-nums font-bold text-[11px]">ADP {hoverPoint.avgPick.toFixed(1)}</div>
          <div className="text-white/55 tabular-nums">{hoverPoint.count.toLocaleString()} {hoverPoint.count === 1 ? "draft" : "drafts"}</div>
        </div>
      )}
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{series[0] ? formatMonthLabel(series[0].month) : ""}</span>
        <span className="text-[#d4af37] tabular-nums">avg ADP {(ys.reduce((s, n) => s + n, 0) / ys.length).toFixed(1)}</span>
        <span>{series[series.length - 1] ? formatMonthLabel(series[series.length - 1].month) : ""}</span>
      </div>
    </div>
  );
}

/** Catmull–Rom → Bezier path builder. Returns a path string starting with M. */
function buildBezierPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  const d: string[] = [`M ${pts[0][0]} ${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  return d.join(" ");
}

// ── Availability ────────────────────────────────────────────────────────────

function AvailabilityTab({
  playerId, playerName, teams, rounds, expectedAdp, active, ctxLabel, filterQuery,
}: {
  playerId: string;
  playerName: string;
  teams: number;
  rounds: number;
  expectedAdp: number;
  active: boolean;
  ctxLabel: string;
  filterQuery: string;
}) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active cell for the hover popover. Tracked by pickNo (unique within the
  // grid) rather than coordinates so keyboard focus could surface the same
  // popover later without ref juggling.
  const [hoverPickNo, setHoverPickNo] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(filterQuery);
    params.set("teams", String(teams));
    params.set("rounds", String(rounds));
    fetch(
      `${API_BASE}/api/adp/player/${encodeURIComponent(playerId)}/availability?${params.toString()}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) {
          throw new Error(`Availability request failed (${r.status})`);
        }
        return r.json() as Promise<AvailabilityResponse>;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load availability"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerId, teams, rounds, active, filterQuery]);

  const expectedSlot = useMemo(() => {
    const pickNo = Math.round(expectedAdp);
    const round = Math.ceil(pickNo / teams);
    const pickInRound = ((pickNo - 1) % teams) + 1;
    return { pickNo, round, pickInRound, label: `${round}.${String(pickInRound).padStart(2, "0")}` };
  }, [expectedAdp, teams]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading availability…</div>;
  if (error)   return <div className="flex items-center gap-2 text-rose-400 text-sm"><AlertCircle className="w-4 h-4"/>{error}</div>;
  if (!data || data.totalDrafts === 0) {
    return <div className="text-sm text-muted-foreground">No draft data matches the current filters for this player.</div>;
  }

  const expectedCell = data.cells.find((c) => c.pickNo === expectedSlot.pickNo);
  const minPickInPool = data.cells.length > 0 ? data.cells[0].pickNo : 1;
  const maxPickInPool = data.cells.length > 0 ? data.cells[data.cells.length - 1].pickNo : 1;
  const cellsByRound = new Map<number, AvailabilityCell[]>();
  for (const c of data.cells) {
    if (!cellsByRound.has(c.round)) cellsByRound.set(c.round, []);
    cellsByRound.get(c.round)!.push(c);
  }
  const drop = data.biggestDropAt;
  const insights = buildAvailInsights(data, playerName, teams, expectedSlot);
  const cliffLabel = drop
    ? `${Math.ceil(drop.fromPick / teams)}.${String(((drop.fromPick - 1) % teams) + 1).padStart(2, "0")} → ${Math.ceil(drop.toPick / teams)}.${String(((drop.toPick - 1) % teams) + 1).padStart(2, "0")}`
    : null;

  const hist = (data.pickHistogram ?? []).filter((p) => p.pickNo >= minPickInPool && p.pickNo <= maxPickInPool);
  const histMax = hist.reduce((m, p) => (p.count > m ? p.count : m), 0);
  const histDraftedTotal = hist.reduce((s, p) => s + p.count, 0);

  return (
    <div className="space-y-3 text-[12px]" data-testid="availability-tab">
      {/* Filter context banner — explains why the values look the way they do. */}
      {ctxLabel && (
        <div className="text-[10px] text-white/45 truncate" title={ctxLabel}>
          Dataset · {ctxLabel}
        </div>
      )}

      {/* Compact summary strip — replaces the two big boxes. */}
      <div className="flex items-baseline gap-3 flex-wrap text-[11px] text-muted-foreground" data-testid="availability-summary">
        <StripStat label="Expected Pick" value={expectedSlot.label} />
        <StripStat label="At ADP" value={expectedCell ? `${expectedCell.availabilityPct.toFixed(0)}%` : "—"} />
        <StripStat label="Drafts" value={`${data.draftsWithPlayer.toLocaleString()} / ${data.totalDrafts.toLocaleString()}`} />
        <StripStat label="Range" value={`${minPickInPool}–${maxPickInPool}`} />
        {cliffLabel && (
          <StripStat label="Biggest Drop" value={`${cliffLabel} (-${drop!.delta.toFixed(0)}%)`} accent="rose" />
        )}
      </div>

      {/* Heatmap — rich hover popover, expected pick highlighted. `relative`
          wrapper anchors the absolute-positioned popover. */}
      <div className="overflow-x-auto rounded-md border border-white/8 bg-white/[0.02] p-2 relative" onMouseLeave={() => setHoverPickNo(null)}>
        <table className="text-[10px] border-separate" style={{ borderSpacing: "2px" }}>
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-1 py-1 text-left font-semibold sticky left-0 bg-[#0a1628] z-10">Rd</th>
              {Array.from({ length: teams }, (_, i) => (
                <th key={i} className="px-1 py-1 text-center font-semibold w-7 tabular-nums">{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, rIdx) => {
              const round = rIdx + 1;
              const row = cellsByRound.get(round) ?? [];
              return (
                <tr key={round}>
                  <td className="px-1 py-0.5 font-semibold text-muted-foreground sticky left-0 bg-[#0a1628] z-10">Rd {round}</td>
                  {Array.from({ length: teams }, (_, i) => {
                    const cell = row.find((c) => c.pickInRound === i + 1);
                    if (!cell) return <td key={i} className="px-0.5 py-0.5" />;
                    const isExpected = cell.pickNo === expectedSlot.pickNo;
                    return (
                      <td key={i} className="p-0">
                        <div
                          className={cn(
                            "rounded-[3px] h-7 flex items-center justify-center text-[10px] font-bold tabular-nums cursor-default transition-shadow",
                            availabilityClass(cell.availabilityPct),
                            isExpected && "ring-2 ring-[#d4af37] z-10 relative",
                            hoverPickNo === cell.pickNo && "ring-2 ring-white/70",
                          )}
                          onMouseEnter={() => setHoverPickNo(cell.pickNo)}
                          onFocus={() => setHoverPickNo(cell.pickNo)}
                          onBlur={() => setHoverPickNo(null)}
                          tabIndex={0}
                          data-testid={`avail-cell-${cell.round}-${cell.pickInRound}`}
                        >
                          {Math.round(cell.availabilityPct)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {hoverPickNo != null && (() => {
          const c = data.cells.find((x) => x.pickNo === hoverPickNo);
          if (!c) return null;
          const draftsAvail = Math.round((c.availabilityPct / 100) * data.totalDrafts);
          const histCount = data.pickHistogram?.find((p) => p.pickNo === c.pickNo)?.count ?? 0;
          return (
            <div
              className="absolute top-2 right-2 z-20 pointer-events-none rounded-md border border-white/15 bg-[#0a1628]/95 backdrop-blur px-2.5 py-1.5 shadow-lg text-[10.5px] leading-tight"
              data-testid="avail-tooltip"
            >
              <div className="text-[#d4af37] font-bold tabular-nums">
                Pick {c.round}.{String(c.pickInRound).padStart(2, "0")}
              </div>
              <div className="text-white/85 mt-0.5">
                <span className="tabular-nums font-semibold">{c.availabilityPct.toFixed(1)}%</span> available
              </div>
              <div className="text-white/55 tabular-nums">
                {draftsAvail.toLocaleString()} / {data.totalDrafts.toLocaleString()} drafts
              </div>
              {histCount > 0 && (
                <div className="text-white/45 tabular-nums mt-0.5">
                  Drafted here in {histCount.toLocaleString()} {histCount === 1 ? "draft" : "drafts"}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Color legend — same scale order as the cells. */}
      <div className="flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
        <span>Color:</span>
        <LegendDot className="bg-rose-500/55 border-rose-500/70" label="<10%" />
        <LegendDot className="bg-orange-500/55 border-orange-500/70" label="10–30%" />
        <LegendDot className="bg-[#d4af37]/55 border-[#d4af37]/70" label="30–60%" />
        <LegendDot className="bg-teal-500/55 border-teal-500/70" label="60–85%" />
        <LegendDot className="bg-emerald-500/55 border-emerald-500/70" label=">85%" />
      </div>

      {hist.length > 0 && histMax > 0 && (
        <PickDistributionHistogram
          hist={hist}
          histMax={histMax}
          totalDrafted={histDraftedTotal}
          teams={teams}
          expectedPickNo={expectedSlot.pickNo}
          hoverPickNo={hoverPickNo}
          onHoverPickNo={setHoverPickNo}
        />
      )}

      {insights.length > 0 && (
        <div className="space-y-1.5" data-testid="availability-insights">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3 h-3 text-[#d4af37]" /> Draft Insights
          </div>
          <ul className="space-y-1 text-[11px] text-white/85">
            {insights.map((i, idx) => (
              <li key={idx} className="flex gap-1.5">
                <span className="text-[#d4af37] mt-px">•</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PickDistributionHistogram({
  hist, histMax, totalDrafted, teams, expectedPickNo, hoverPickNo, onHoverPickNo,
}: {
  hist: Array<{ pickNo: number; count: number }>;
  histMax: number;
  totalDrafted: number;
  teams: number;
  expectedPickNo: number;
  hoverPickNo: number | null;
  onHoverPickNo: (n: number | null) => void;
}) {
  // Modal pick is the column users will gravitate to — annotate it so the
  // chart reads independently of the heatmap above.
  const modal = hist.reduce((acc, p) => (p.count > acc.count ? p : acc), { pickNo: 0, count: 0 });
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-2" data-testid="availability-histogram" onMouseLeave={() => onHoverPickNo(null)}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        <span>Where He's Actually Drafted</span>
        <span className="text-white/40 normal-case tracking-normal tabular-nums">{totalDrafted.toLocaleString()} picks</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-[2px] h-16 min-w-full">
          {hist.map((p) => {
            const isExpected = p.pickNo === expectedPickNo;
            const isHover = p.pickNo === hoverPickNo;
            const isModal = p.pickNo === modal.pickNo && modal.count > 0;
            const heightPct = (p.count / histMax) * 100;
            return (
              <button
                key={p.pickNo}
                type="button"
                onMouseEnter={() => onHoverPickNo(p.pickNo)}
                onFocus={() => onHoverPickNo(p.pickNo)}
                onBlur={() => onHoverPickNo(null)}
                className={cn(
                  "relative flex-1 min-w-[6px] rounded-t-sm transition-all",
                  p.count === 0
                    ? "bg-white/[0.04]"
                    : isHover
                      ? "bg-white/85"
                      : isExpected
                        ? "bg-[#d4af37]"
                        : isModal
                          ? "bg-[#d4af37]/80"
                          : "bg-[#d4af37]/40 hover:bg-[#d4af37]/60",
                )}
                style={{ height: p.count > 0 ? `${Math.max(4, heightPct)}%` : "2px" }}
                data-testid={`avail-hist-${p.pickNo}`}
                aria-label={`Pick ${p.pickNo}: drafted in ${p.count} drafts`}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-1">
        <span>Pick {hist[0]?.pickNo}</span>
        {modal.count > 0 && (
          <span className="text-[#d4af37]">
            Most common: {Math.ceil(modal.pickNo / teams)}.{String(((modal.pickNo - 1) % teams) + 1).padStart(2, "0")}
            <span className="text-white/50"> · {modal.count.toLocaleString()} drafts</span>
          </span>
        )}
        <span>Pick {hist[hist.length - 1]?.pickNo}</span>
      </div>
    </div>
  );
}

function buildAvailInsights(
  data: AvailabilityResponse,
  playerName: string,
  teams: number,
  expectedSlot: { pickNo: number; label: string },
): string[] {
  const out: string[] = [];
  // Where does availability cross 50%? That's the "rarely available past X" line.
  const cross50 = data.cells.find((c) => c.availabilityPct < 50);
  if (cross50) {
    const r = cross50.round;
    const pir = cross50.pickInRound;
    out.push(`${firstName(playerName)} is gone in over half of drafts past pick ${r}.${String(pir).padStart(2, "0")}.`);
  }
  // Available at the 2/3 turn? Only meaningful when the user is in a 12T view.
  const turnPickNo = teams * 2;
  const cell23 = data.cells.find((c) => c.pickNo === turnPickNo);
  if (cell23) {
    out.push(`Only ${cell23.availabilityPct.toFixed(0)}% of drafts see ${firstName(playerName)} available at the ${cell23.round}/${cell23.round + 1} turn.`);
  }
  // Biggest drop summary.
  if (data.biggestDropAt) {
    const d = data.biggestDropAt;
    const fromLabel = `${Math.ceil(d.fromPick / teams)}.${String(((d.fromPick - 1) % teams) + 1).padStart(2, "0")}`;
    const toLabel = `${Math.ceil(d.toPick / teams)}.${String(((d.toPick - 1) % teams) + 1).padStart(2, "0")}`;
    out.push(`Biggest availability drop: ${fromLabel} → ${toLabel} (-${d.delta.toFixed(0)}%).`);
  }
  // Sample size disclaimer when low.
  if (data.totalDrafts > 0 && data.totalDrafts < 25) {
    out.push(`Sample size is small (${data.totalDrafts} drafts) — values may swing as more drafts come in.`);
  }
  return out;
}

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

function availabilityClass(pct: number): string {
  if (pct < 10) return "bg-rose-500/55 border-rose-500/70 text-rose-50";
  if (pct < 30) return "bg-orange-500/50 border-orange-500/65 text-orange-50";
  if (pct < 60) return "bg-[#d4af37]/50 border-[#d4af37]/70 text-[#1f1300]";
  if (pct < 85) return "bg-teal-500/50 border-teal-500/65 text-teal-50";
  return "bg-emerald-500/55 border-emerald-500/70 text-emerald-50";
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block w-3 h-3 rounded-[3px] border", className)} />
      <span>{label}</span>
    </span>
  );
}

// ── News shell ──────────────────────────────────────────────────────────────

function NewsShell() {
  // Backend shape: server/playerNews (future) returns
  //   [{ headline, source, url, publishedAt, summary }, …]
  // Until that endpoint exists we render the article-card skeleton + an
  // explicit empty state so the swap-in is incremental.
  return (
    <div className="space-y-2 text-[12px]" data-testid="news-tab">
      <p className="text-[11px] text-muted-foreground">News will populate once the news provider integration ships.</p>
      <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] py-6 text-center text-[11px] text-muted-foreground">
        No articles available yet.
      </div>
    </div>
  );
}
