/**
 * ManagerPage — full-page Sleeper manager profile at /managers/:userId.
 *
 * The premium, command-center counterpart to the old quick-preview drawer.
 * Reuses the same data source (GET /api/manager-intel/:userId?leagueId=…,
 * cached server-side for 6h) reframed into five tabs:
 *   Overview  — Manager Read hero, archetype, scorecard, key tendencies.
 *   League    — strengths/needs + rank snapshot + team identity for this league.
 *   Cross     — per-position exposure, favorite player types, portfolio identity.
 *   Trade     — how to deal with them + opening offers + (if you have an active
 *               league) which of YOUR players match their tendencies.
 *   Activity  — visible-season track record.
 *
 * Renders inside the Command Center shell when `embedded`, standalone (with a
 * back bar) otherwise. The current-league context arrives via the ?leagueId=
 * query param that ManagerIntelNavigator carries over from the click site.
 *
 * Defensive note: the server payload is cached and versioned, but this page
 * treats all the newer "intel" fields as optional so an older cached row can
 * never crash the render.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Check,
  Compass,
  Crown,
  Gauge,
  Ghost,
  Handshake,
  Info,
  Layers,
  Repeat,
  RefreshCw,
  Scale,
  Sparkles,
  Sprout,
  Target,
  TrendingUp,
  Trophy,
  User,
  Users,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/apiBase";
import { useSleeper } from "@/contexts/SleeperContext";
import type { Team } from "@/types";

// ── Types — mirrors server/managerIntel.ts (new fields optional for safety) ──

type Rating3 = "Low" | "Medium" | "High";

interface PositionScore {
  position: "QB" | "RB" | "WR" | "TE";
  value: number;
  leagueRank: number | null;
  vsLeagueAvg: number;
  tier: "Elite" | "Strong" | "Average" | "Weak" | "Thin";
}

interface PlayerExposure {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  age?: number | null;
  leagueCount: number;
  exposure: number;
}

interface ScorecardRow {
  category: string;
  rating: string;
  tone: "positive" | "neutral" | "caution" | "info";
}

interface RankSnapshotRow {
  label: string;
  rank: number | null;
  total: number;
}

interface NeedRow {
  position: "QB" | "RB" | "WR" | "TE";
  level: "Low" | "Medium" | "High";
  reason: string;
}

interface LeagueRosterRank {
  ownerId: string;
  rosterId: number;
  dynastyRank: number;
  winNowRank: number;
  youthRank: number;
  pickRank: number | null;
  qbRank: number;
  rbRank: number;
  wrRank: number;
  teRank: number;
  // Win-now (redraft) per-position ranks. Optional for back-compat with cached
  // payloads computed before these were added.
  qbWinNowRank?: number;
  rbWinNowRank?: number;
  wrWinNowRank?: number;
  teWinNowRank?: number;
}

interface LeagueReport {
  leagueId: string;
  name: string;
  season: string;
  format: "SF" | "1QB";
  scoringFormat: string;
  totalRosters: number;
  startersCount: number | null;
  isRequested: boolean;
  ownerId: string;
  rosterId: number;
  teamName: string;
  teamDirection: "Contender" | "Middle" | "Rebuild" | "Unknown";
  teamIdentity: { label: string; blurb: string };
  contextSummary: string;
  dynastyStrengths: PositionScore[];
  winNowStrengths: PositionScore[];
  needs: NeedRow[];
  rankSnapshot: RankSnapshotRow[];
  relativeWeakness: string | null;
  tradeOpportunity: string;
  pickCapitalSummary: string;
  ageSummary: string;
  rosters: LeagueRosterRank[];
}

interface ManagerIntelPayload {
  user: { user_id: string; username: string; display_name: string; avatar: string | null };
  archetype?: { key: string; label: string; blurb: string; why?: string };
  managerRead?: string;
  rosterIdentity?: string;
  keyTendencies?: string[];
  headerBadges?: string[];
  confidence?: { level: Rating3; basis: string };
  scorecard?: ScorecardRow[];
  preferences?: {
    youthPreference: Rating3;
    veteranPreference: Rating3;
    pickValue: Rating3;
    aggressiveness: Rating3;
  };
  currentLeague: {
    league_id: string;
    teamName: string;
    rosterId: number;
    dynastyStrengths: PositionScore[];
    winNowStrengths: PositionScore[];
    teamNeeds: string[];
    teamDirection: "Contender" | "Middle" | "Rebuild" | "Unknown";
    pickCapitalSummary: string;
    ageSummary: string;
    rankSnapshot?: RankSnapshotRow[];
    teamIdentity?: { label: string; blurb: string };
    relativeWeakness?: string | null;
  } | null;
  leagues?: LeagueReport[];
  crossLeague: {
    dynastyLeagueCount: number;
    oldestLeagueSeason: string | null;
    estimatedYearsActive: number | null;
    tradeCount: number;
    waiverCount: number;
    tradeActivityRating: string;
    waiverActivityRating: string;
    mostRosteredPlayers: PlayerExposure[];
    mostRosteredByPosition?: { QB: PlayerExposure[]; RB: PlayerExposure[]; WR: PlayerExposure[]; TE: PlayerExposure[] };
    mostDraftedPlayers: PlayerExposure[] | null;
    commonRosterBuild: string;
    averageTeamAge: number | null;
    positionStrengthProfile: string;
    favoritePlayerTypes?: Array<{ type: string; confidence: Rating3 }>;
    portfolioType?: string;
    portfolioIdentity?: string;
    positionBias?: Array<{ position: "QB" | "RB" | "WR" | "TE"; signal: string; interpretation: string }>;
    managerTendencies?: string[];
    tradeImplications?: { likelyValues: string[]; unlikelyValues: string[]; bestAngle: string };
  };
  performance: {
    playoffAppearances: number | null;
    championshipWins: number | null;
    finalsAppearances: number | null;
    avgRegularSeasonFinish: number | null;
    avgPointsFor: number | null;
    notes: string;
  };
  activity?: {
    visibleLeagues: number;
    oldestVisibleSeason: string | null;
    estimatedYearsActive: number | null;
    currentPointsFor: number | null;
    tradeCount: number;
    waiverCount: number;
    totalTransactions: number;
    activitySignal: string;
    signalNote: string;
    activityArchetype?: { key: string; label: string; blurb: string };
    tradeability?: { level: Rating3; note: string };
    lastActivity?: string | null;
    last30Days?: number;
    last90Days?: number;
    activityTrend?: "Increasing" | "Stable" | "Declining" | "Unknown";
    recent?: Array<{ date: string; league: string; type: string }>;
  };
  tradeApproach: {
    summary: string;
    suggestedAngle: string;
    actionableTakeaway?: string;
    doList?: string[];
    dontList?: string[];
    likelyNeeds: string[];
    assetsTheyMayValue: string[];
    cautionNotes: string;
    tradeProfile?: {
      tradeActivity: string;
      tradeStyle: string;
      bestOfferType: string;
      avoidOffering: string;
      likelyTargets: string[];
      sellCandidates: string[];
    };
    openingOffers?: string[];
    targetPositions?: Array<"QB" | "RB" | "WR" | "TE">;
    preferYouth?: boolean;
    tradeDifficulty?: { level: Rating3; reason: string };
    playbook?: {
      bestApproach: string;
      likelyStyle: string;
      bestDealType: string;
      likelyMotivation: string;
      negotiationStyle: string;
      avoid: string;
    };
    dealTypes?: Array<{ dealType: string; fit: Rating3; why: string }>;
    negotiationNotes?: string[];
    targetableAssets?: Array<{ name: string; pos: string; age: number | null; value: number; reason: string; difficulty: Rating3 }>;
    protectedAssets?: Array<{ name: string; pos: string; value: number; reason: string }>;
    likelyTargetsGrouped?: { high: string[]; conditional: string[] };
    sellCandidatesGrouped?: { mostLikely: string[]; leastLikely: string[] };
  };
  meta: { season: string; leaguesScanned: number; computedAt: string; dataSourceNote: string; version?: number };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ManagerPage({
  userId,
  embedded = false,
  viewerTeam = null,
}: {
  userId: string;
  embedded?: boolean;
  /** The logged-in user's team in their active league — powers roster-match. */
  viewerTeam?: Team | null;
}) {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<string>("overview");
  const [data, setData] = useState<ManagerIntelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIntel = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const leagueId = new URLSearchParams(window.location.search).get("leagueId");
        const params = new URLSearchParams();
        if (leagueId) params.set("leagueId", leagueId);
        if (refresh) params.set("refresh", "1");
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/api/manager-intel/${userId}${qs}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`);
        const json = (await res.json()) as ManagerIntelPayload;
        setData(json);
      } catch (err: any) {
        setError(err?.message || "Failed to load manager intel");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;
    setData(null);
    setTab("overview");
    void fetchIntel(false);
  }, [userId, fetchIntel]);

  const handleRefresh = () => {
    if (refreshing) return;
    void fetchIntel(true);
  };

  return (
    <div className={cn(!embedded && "min-h-screen bg-background", "text-foreground")}>
      <div
        className={cn(
          "flex items-center px-4 py-2.5",
          !embedded &&
            "sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-white/5",
        )}
      >
        <button
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/");
          }}
          className="inline-flex items-center gap-1.5 text-[13px] text-white/70 hover:text-[#d4af37] transition-colors"
          data-testid="manager-page-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-12">
        <IntelHero
          data={data}
          fallbackName={userId}
          loading={loading}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchIntel(false)} />
        ) : data ? (
          <Tabs value={tab} onValueChange={setTab} className="mt-5">
            <TabsList
              className={cn("grid grid-cols-5 h-10 bg-white/[0.04]", !embedded && "sticky top-12 z-20")}
            >
              <TabsTrigger value="overview" className="text-[11px] flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="current" className="text-[11px] flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">League</span>
              </TabsTrigger>
              <TabsTrigger value="cross" className="text-[11px] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cross-League</span>
              </TabsTrigger>
              <TabsTrigger value="trade" className="text-[11px] flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Trade</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-[11px] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Activity</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-5">
              <TabsContent value="overview">
                <OverviewTab data={data} />
              </TabsContent>
              <TabsContent value="current">
                <CurrentLeagueTab data={data} />
              </TabsContent>
              <TabsContent value="cross">
                <CrossLeagueTab data={data} />
              </TabsContent>
              <TabsContent value="trade">
                <TradeApproachTab data={data} viewerTeam={viewerTeam} />
              </TabsContent>
              <TabsContent value="activity">
                <ActivityTab data={data} />
              </TabsContent>
            </div>
          </Tabs>
        ) : null}
      </div>
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────

function IntelHero({
  data,
  fallbackName,
  loading,
  onRefresh,
  refreshing,
}: {
  data: ManagerIntelPayload | null;
  fallbackName: string;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const name = data?.user.display_name || data?.user.username || fallbackName || "Manager";
  const rawAvatar = data?.user.avatar || null;
  const avatarSrc = rawAvatar
    ? rawAvatar.startsWith("http")
      ? rawAvatar
      : `https://sleepercdn.com/avatars/thumbs/${rawAvatar}`
    : null;
  const initial = (name || "?").charAt(0).toUpperCase();
  const archetype = data?.archetype;
  const badges = data?.headerBadges ?? [];
  const confidence = data?.confidence;

  // Compact "Manager Snapshot" — fills the header's right side with the most
  // decision-relevant facts at a glance.
  const snapshot = data
    ? [
        { label: "Leagues", value: String(data.crossLeague.dynastyLeagueCount) },
        { label: "Direction", value: data.currentLeague?.teamDirection ?? "Unknown" },
        {
          label: "Trade style",
          value: data.tradeApproach.tradeProfile?.tradeStyle ?? data.crossLeague.tradeActivityRating,
        },
      ]
    : [];

  return (
    <div className="rounded-xl border border-white/8 bg-gradient-to-b from-white/[0.05] to-transparent px-5 py-5">
      <div className="flex items-center gap-4">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name}
            className="w-16 h-16 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="w-16 h-16 rounded-full bg-[#d4af37]/15 flex items-center justify-center text-2xl font-bold text-[#d4af37] flex-shrink-0">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-bold text-white truncate tracking-tight" data-testid="manager-page-name">
            {name}
          </div>
          <div className="text-[12px] text-white/55 mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-bold text-[#d4af37] border-[#d4af37]/40">
              {archetype?.label ?? "Manager Intel"}
            </Badge>
            {confidence && <ConfidenceBadge level={confidence.level} basis={confidence.basis} />}
          </div>
        </div>

        {snapshot.length > 0 && (
          <div className="hidden md:flex items-stretch gap-4 pr-4 mr-1 border-r border-white/10">
            {snapshot.map((s) => (
              <div key={s.label} className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-white/40">{s.label}</div>
                <div className="text-[13px] font-bold text-white truncate max-w-[140px]">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/10 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[12px] text-white/70"
          title="Refresh: bypass cache"
          data-testid="manager-page-refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Header chips — kept subtle since the snapshot above carries the key facts. */}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {badges.map((b, i) => (
            <Badge
              key={`${b}-${i}`}
              variant="outline"
              className="text-[10px] font-medium border-white/10 text-white/55"
            >
              {b}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ level, basis }: { level: Rating3; basis: string }) {
  const tone =
    level === "High"
      ? "text-emerald-300 border-emerald-500/40"
      : level === "Medium"
      ? "text-amber-300 border-amber-500/40"
      : "text-white/55 border-white/15";
  return (
    <span className="inline-flex items-center gap-1" title={basis}>
      <Badge variant="outline" className={cn("text-[10px] font-bold", tone)}>
        Confidence: {level}
      </Badge>
    </span>
  );
}

// ── State views ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center text-center px-6 py-20">
      <div>
        <div className="inline-block w-6 h-6 border-2 border-[#d4af37]/40 border-t-[#d4af37] rounded-full animate-spin mb-3" />
        <div className="text-sm text-white/70">Scanning visible leagues…</div>
        <div className="text-[11px] text-white/40 mt-1">This can take a few seconds the first time.</div>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center text-center px-6 py-20">
      <div>
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <div className="text-sm text-white/80 font-semibold mb-1">Couldn't load manager intel</div>
        <div className="text-[11px] text-white/50 mb-3">{message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/40 hover:bg-[#d4af37]/25"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: ManagerIntelPayload }) {
  const cl = data.crossLeague;
  const ta = data.tradeApproach;
  const managerRead = data.managerRead || ta.summary;
  const hasDoDont = (ta.doList?.length ?? 0) > 0 || (ta.dontList?.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      <ManagerReadCard archetype={data.archetype} managerRead={managerRead} takeaway={ta.actionableTakeaway} />

      {data.scorecard && data.scorecard.length > 0 ? (
        // Scorecard at half width with the Do / Don't cards stacked to its right,
        // splitting the scorecard's height.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <SectionCard title="Manager Intel Scorecard" icon={<Gauge className="w-3.5 h-3.5" />}>
            <Scorecard rows={data.scorecard} />
          </SectionCard>
          {hasDoDont && (
            <div className="flex flex-col gap-3">
              <DoBox items={ta.doList ?? []} className="flex-1" />
              <DontBox items={ta.dontList ?? []} className="flex-1" />
            </div>
          )}
        </div>
      ) : (
        hasDoDont && <DoDontCard doList={ta.doList ?? []} dontList={ta.dontList ?? []} />
      )}

      {data.keyTendencies && data.keyTendencies.length > 0 && (
        <SectionCard title="Key tendencies" icon={<Target className="w-3.5 h-3.5" />}>
          <KeyTendencies items={data.keyTendencies} />
        </SectionCard>
      )}

      {data.confidence && <DataCoverageCard confidence={data.confidence} meta={data.meta} />}
    </div>
  );
}

const ARCHETYPE_ICONS: Record<string, LucideIcon> = {
  rebuilder: Sprout,
  contender: Trophy,
  trader: Repeat,
  "waiver-grinder": Waves,
  "qb-collector": Crown,
  "prospect-chaser": Sparkles,
  hoarder: Layers,
  "value-shark": TrendingUp,
  ghost: Ghost,
  balanced: Scale,
};

function ManagerReadCard({
  archetype,
  managerRead,
  takeaway,
}: {
  archetype?: { key: string; label: string; blurb: string; why?: string };
  managerRead: string;
  takeaway?: string;
}) {
  const Icon = (archetype && ARCHETYPE_ICONS[archetype.key]) || Sparkles;
  return (
    <div className="rounded-xl border border-[#d4af37]/35 bg-gradient-to-br from-[#d4af37]/[0.10] to-transparent p-5 sm:p-6">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-3">
        <Sparkles className="w-3.5 h-3.5" />
        <span>Manager Read</span>
      </div>

      {archetype && (
        <div className="flex items-start gap-3 mb-3">
          <span className="w-11 h-11 rounded-lg bg-[#d4af37]/15 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-[#d4af37]" />
          </span>
          <div className="min-w-0">
            <div className="text-[22px] font-extrabold text-white leading-tight tracking-tight">
              {archetype.label}
            </div>
            <div className="text-[12.5px] text-white/55 leading-snug">{archetype.blurb}</div>
            {archetype.why && <ArchetypeWhy why={archetype.why} />}
          </div>
        </div>
      )}

      <p className="text-[14px] text-white/85 leading-relaxed">{managerRead}</p>

      {takeaway && (
        <div className="mt-4 pt-3 border-t border-[#d4af37]/20">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-1">
            <Target className="w-3.5 h-3.5" />
            <span>Actionable takeaway</span>
          </div>
          <p className="text-[13px] text-white/85 leading-relaxed">{takeaway}</p>
        </div>
      )}
    </div>
  );
}

function ArchetypeWhy({ why }: { why: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#d4af37]/80 hover:text-[#d4af37] transition-colors"
        data-testid="archetype-why-toggle"
      >
        <Info className="w-3 h-3" /> Why this archetype?
      </button>
      {open && <p className="text-[11.5px] text-white/60 mt-1 leading-relaxed">{why}</p>}
    </div>
  );
}

function DoBox({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-2">
        <Check className="w-3.5 h-3.5" />
        <span>Do</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((d, i) => (
          <li key={i} className="text-[12.5px] text-white/80 leading-snug flex gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400/70 mt-0.5 flex-shrink-0" />
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DontBox({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 mb-2">
        <X className="w-3.5 h-3.5" />
        <span>Don't</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((d, i) => (
          <li key={i} className="text-[12.5px] text-white/80 leading-snug flex gap-1.5">
            <X className="w-3.5 h-3.5 text-rose-400/70 mt-0.5 flex-shrink-0" />
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoDontCard({ doList, dontList }: { doList: string[]; dontList: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <DoBox items={doList} />
      <DontBox items={dontList} />
    </div>
  );
}

/** Maps a rating word to a 1–3 meter level, or null if it isn't a scale. */
function ratingLevel(rating: string): number | null {
  const m: Record<string, number> = {
    Low: 1,
    Medium: 2,
    High: 3,
    Moderate: 2,
    Active: 3,
    Aggressive: 3,
    "Very Active": 3,
  };
  return m[rating] ?? null;
}

function Scorecard({ rows }: { rows: ScorecardRow[] }) {
  const toneClass = (tone: ScorecardRow["tone"]) =>
    tone === "positive"
      ? "text-emerald-300"
      : tone === "caution"
      ? "text-rose-300"
      : tone === "info"
      ? "text-sky-300"
      : "text-white/85";
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const level = ratingLevel(r.rating);
        return (
          <div
            key={r.category}
            className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.05] last:border-0"
          >
            <span className="text-[12px] text-white/55 flex-shrink-0">{r.category}</span>
            <div className="flex items-center gap-2 min-w-0 justify-end">
              {level != null && <Meter level={level} />}
              <span className={cn("text-[12px] font-bold text-right", toneClass(r.tone))}>{r.rating}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <div className="hidden sm:flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("h-1.5 w-5 rounded-full", i <= level ? "bg-[#d4af37]" : "bg-white/10")}
        />
      ))}
    </div>
  );
}

function KeyTendencies({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t, i) => {
        const idx = t.indexOf(": ");
        const label = idx > 0 ? t.slice(0, idx) : null;
        const detail = idx > 0 ? t.slice(idx + 2) : t;
        return (
          <li key={i} className="text-[13px] text-white/75 leading-relaxed">
            {label && <span className="font-bold text-white">{label}: </span>}
            {detail}
          </li>
        );
      })}
    </ul>
  );
}

function DataCoverageCard({
  confidence,
  meta,
}: {
  confidence: { level: Rating3; basis: string };
  meta: ManagerIntelPayload["meta"];
}) {
  const tone =
    confidence.level === "High"
      ? "text-emerald-300 border-emerald-500/40"
      : confidence.level === "Medium"
      ? "text-amber-300 border-amber-500/40"
      : "text-white/55 border-white/15";
  let computed = "";
  try {
    computed = new Date(meta.computedAt).toLocaleString();
  } catch {
    /* ignore */
  }
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45 mb-1.5">
          <Gauge className="w-3.5 h-3.5" />
          <span>Confidence &amp; data coverage</span>
        </div>
        <p className="text-[12.5px] text-white/65 leading-relaxed">{confidence.basis}</p>
        <p className="text-[10px] text-white/35 mt-1.5">
          {meta.leaguesScanned} league{meta.leaguesScanned === 1 ? "" : "s"} scanned
          {computed ? ` · computed ${computed}` : ""}
        </p>
      </div>
      <Badge variant="outline" className={cn("text-[11px] font-bold flex-shrink-0", tone)}>
        {confidence.level}
      </Badge>
    </div>
  );
}

// ── League ────────────────────────────────────────────────────────────────

function CurrentLeagueTab({ data }: { data: ManagerIntelPayload }) {
  const sleeper = useSleeper();
  const viewerId = sleeper.user?.userId ?? null;
  const targetId = data.user.user_id;
  const leagues = data.leagues ?? [];

  const defaultId = leagues.find((l) => l.isRequested)?.leagueId ?? leagues[0]?.leagueId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  useEffect(() => {
    setSelectedId(defaultId);
  }, [defaultId]);

  // Fallback for older cached payloads that predate per-league reports.
  if (leagues.length === 0) {
    return (
      <EmptyNotice text="No league reports available. Open this page from a league view, or refresh to recompute." />
    );
  }

  const selected = leagues.find((l) => l.leagueId === selectedId) ?? leagues[0];
  const targetRow = selected.rosters.find((r) => r.ownerId === targetId) ?? null;
  const viewerRow = viewerId ? selected.rosters.find((r) => r.ownerId === viewerId) ?? null : null;

  return (
    <div className="space-y-4">
      <LeagueSelector
        leagues={leagues}
        selected={selected}
        onSelect={setSelectedId}
        viewerId={viewerId}
        targetId={targetId}
      />

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-1.5">
          <Trophy className="w-3.5 h-3.5" />
          <span>Team Identity</span>
        </div>
        <div className="text-[16px] font-bold text-white">{selected.teamIdentity.label}</div>
        <p className="text-[13px] text-white/70 mt-1 leading-relaxed">{selected.contextSummary}</p>
        {selected.teamIdentity.blurb && (
          <p className="text-[13px] text-white/70 mt-2 leading-relaxed">{selected.teamIdentity.blurb}</p>
        )}
      </div>

      {viewerRow && targetRow && (
        <YouVsThem viewer={viewerRow} target={targetRow} />
      )}

      <NeedsTable needs={selected.needs} relativeWeakness={selected.relativeWeakness} />

      <div className="rounded-xl border border-[#d4af37]/25 bg-gradient-to-br from-[#d4af37]/[0.06] to-transparent p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-1.5">
          <Handshake className="w-3.5 h-3.5" />
          <span>Trade opportunity in this league</span>
        </div>
        <p className="text-[13px] text-white/80 leading-relaxed">{selected.tradeOpportunity}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SectionCard title="Roster age" icon={<User className="w-3.5 h-3.5" />}>
          <p className="text-[13px] text-white/70">{selected.ageSummary}</p>
        </SectionCard>
        <SectionCard title="Pick capital" icon={<Trophy className="w-3.5 h-3.5" />}>
          <p className="text-[13px] text-white/70">{selected.pickCapitalSummary}</p>
        </SectionCard>
      </div>
    </div>
  );
}

function LeagueSelector({
  leagues,
  selected,
  onSelect,
  viewerId,
  targetId,
}: {
  leagues: LeagueReport[];
  selected: LeagueReport;
  onSelect: (id: string) => void;
  viewerId: string | null;
  targetId: string;
}) {
  const rankFor = (lg: LeagueReport, owner: string | null) =>
    owner ? lg.rosters.find((r) => r.ownerId === owner)?.dynastyRank ?? null : null;
  const isSharedLeague = (lg: LeagueReport) => !!(viewerId && lg.rosters.some((r) => r.ownerId === viewerId));
  const shared = isSharedLeague(selected);

  const byName = (a: LeagueReport, b: LeagueReport) => a.name.localeCompare(b.name);
  const sharedLeagues = leagues.filter(isSharedLeague).sort(byName);
  const otherLeagues = leagues.filter((lg) => !isSharedLeague(lg)).sort(byName);

  const renderOption = (lg: LeagueReport) => {
    const their = rankFor(lg, targetId);
    const yours = rankFor(lg, viewerId);
    return (
      <option key={lg.leagueId} value={lg.leagueId}>
        {lg.name} — {lg.totalRosters}tm {lg.format}
        {their ? ` · Them #${their}` : ""}
        {yours ? ` · You #${yours}` : ""}
      </option>
    );
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">Viewing league</div>
      <select
        value={selected.leagueId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full bg-[#0a1628] border border-white/15 rounded-md text-[13px] font-semibold text-white px-3 py-2 focus:outline-none focus:border-[#d4af37]/50"
        data-testid="league-selector"
      >
        {sharedLeagues.length > 0 && (
          <optgroup label="Shared leagues">{sharedLeagues.map(renderOption)}</optgroup>
        )}
        {otherLeagues.length > 0 && (
          <optgroup label="Other leagues">{otherLeagues.map(renderOption)}</optgroup>
        )}
      </select>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Chip>{`${selected.totalRosters} Team ${selected.format}`}</Chip>
        <Chip>{selected.scoringFormat}</Chip>
        {selected.startersCount ? <Chip>{`Start ${selected.startersCount}`}</Chip> : null}
        <Chip tone={shared ? "good" : "muted"}>{shared ? "You share this league" : "Not your league"}</Chip>
      </div>
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "muted" }) {
  const cls =
    tone === "good"
      ? "text-emerald-300 border-emerald-500/40"
      : tone === "muted"
      ? "text-white/40 border-white/10"
      : "text-white/70 border-white/15";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold", cls)}>
      {children}
    </Badge>
  );
}

function YouVsThem({ viewer, target }: { viewer: LeagueRosterRank; target: LeagueRosterRank }) {
  // Win-now positional ranks fall back to the dynasty ranks for older cached
  // payloads that predate the per-position win-now fields.
  const winNowRows: ComparisonRow[] = [
    { label: "Team value", you: viewer.winNowRank, them: target.winNowRank },
    { label: "QB", you: viewer.qbWinNowRank ?? viewer.qbRank, them: target.qbWinNowRank ?? target.qbRank },
    { label: "RB", you: viewer.rbWinNowRank ?? viewer.rbRank, them: target.rbWinNowRank ?? target.rbRank },
    { label: "WR", you: viewer.wrWinNowRank ?? viewer.wrRank, them: target.wrWinNowRank ?? target.wrRank },
    { label: "TE", you: viewer.teWinNowRank ?? viewer.teRank, them: target.teWinNowRank ?? target.teRank },
  ];
  const dynastyRows: ComparisonRow[] = [
    { label: "Team value", you: viewer.dynastyRank, them: target.dynastyRank },
    { label: "QB", you: viewer.qbRank, them: target.qbRank },
    { label: "RB", you: viewer.rbRank, them: target.rbRank },
    { label: "WR", you: viewer.wrRank, them: target.wrRank },
    { label: "TE", you: viewer.teRank, them: target.teRank },
  ];
  return (
    <SectionCard title="You vs Them" icon={<Users className="w-3.5 h-3.5" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ComparisonColumn title="Win-Now Value" icon={<Activity className="w-3.5 h-3.5" />} rows={winNowRows} />
        <ComparisonColumn title="Dynasty Value" icon={<Trophy className="w-3.5 h-3.5" />} rows={dynastyRows} />
      </div>
    </SectionCard>
  );
}

interface ComparisonRow {
  label: string;
  you: number | null;
  them: number | null;
}

function ComparisonColumn({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: ComparisonRow[] }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
        {icon}
        <span>{title}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-0.5 text-[12.5px]">
        <span className="text-[9px] uppercase tracking-wider text-white/40" />
        <span className="text-[9px] uppercase tracking-wider text-white/40 text-right">You</span>
        <span className="text-[9px] uppercase tracking-wider text-white/40 text-right">Them</span>
        <span className="text-[9px] uppercase tracking-wider text-white/40 text-right">Edge</span>
        {rows.map((r) => {
          const edge =
            r.you == null || r.them == null ? "—" : r.you < r.them ? "You" : r.them < r.you ? "Them" : "Even";
          const edgeCls =
            edge === "You" ? "text-emerald-300" : edge === "Them" ? "text-rose-300" : "text-white/50";
          return (
            <Fragment key={r.label}>
              <span className="text-white/70 py-1 border-t border-white/[0.05]">{r.label}</span>
              <span className="text-white/80 tabular-nums text-right py-1 border-t border-white/[0.05]">
                {r.you ? `#${r.you}` : "—"}
              </span>
              <span className="text-white/80 tabular-nums text-right py-1 border-t border-white/[0.05]">
                {r.them ? `#${r.them}` : "—"}
              </span>
              <span className={cn("font-bold text-right py-1 border-t border-white/[0.05]", edgeCls)}>{edge}</span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function StrengthsCard({
  title,
  subtitle,
  icon,
  scores,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  scores: PositionScore[];
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-[11px] text-white/40 mb-2.5 mt-0.5">{subtitle}</p>
      <PositionGrid scores={scores} />
    </div>
  );
}

function NeedsTable({ needs, relativeWeakness }: { needs: NeedRow[]; relativeWeakness: string | null }) {
  const levelCls = (l: NeedRow["level"]) =>
    l === "High" ? "text-rose-300 border-rose-500/40" : l === "Medium" ? "text-amber-300 border-amber-500/40" : "text-white/50 border-white/15";
  return (
    <SectionCard title="Needs by position" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
      <div className="space-y-1">
        {needs.map((n) => (
          <div key={n.position} className="flex items-center gap-3 py-1.5 border-b border-white/[0.05] last:border-0">
            <span className="text-[12.5px] font-bold text-white w-8">{n.position}</span>
            <Badge variant="outline" className={cn("text-[9px] font-bold", levelCls(n.level))}>
              {n.level}
            </Badge>
            <span className="text-[11.5px] text-white/55 ml-auto text-right">{n.reason}</span>
          </div>
        ))}
      </div>
      {relativeWeakness && <p className="text-[11px] text-white/45 mt-2 leading-relaxed">{relativeWeakness}</p>}
    </SectionCard>
  );
}

function LeaguesInCommon({
  leagues,
  viewerId,
  targetId,
  selectedId,
  onSelect,
}: {
  leagues: LeagueReport[];
  viewerId: string | null;
  targetId: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const shared = viewerId ? leagues.filter((l) => l.rosters.some((r) => r.ownerId === viewerId)) : [];
  const list = shared.length > 0 ? shared : leagues;
  const title = shared.length > 0 ? `Leagues in common (${shared.length})` : "Their visible leagues";
  const rankFor = (lg: LeagueReport, owner: string | null) =>
    owner ? lg.rosters.find((r) => r.ownerId === owner)?.dynastyRank ?? null : null;
  return (
    <SectionCard title={title} icon={<Users className="w-3.5 h-3.5" />}>
      <ul className="space-y-1.5">
        {list.map((lg) => {
          const their = rankFor(lg, targetId);
          const yours = rankFor(lg, viewerId);
          const active = lg.leagueId === selectedId;
          return (
            <li key={lg.leagueId}>
              <button
                type="button"
                onClick={() => onSelect(lg.leagueId)}
                className={cn(
                  "w-full text-left rounded-md border px-3 py-2 transition-colors",
                  active ? "border-[#d4af37]/40 bg-[#d4af37]/[0.06]" : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-white truncate">{lg.name}</span>
                  <span className="text-[10px] text-white/40 whitespace-nowrap">
                    {lg.totalRosters}tm {lg.format}
                  </span>
                </div>
                <div className="text-[11px] text-white/50 mt-0.5 flex items-center gap-2 flex-wrap">
                  {their ? <span>Them #{their} dynasty</span> : null}
                  {yours ? <span>· You #{yours} dynasty</span> : null}
                  <span className="text-white/35">· {lg.teamDirection}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

// ── Cross-League ────────────────────────────────────────────────────────────

function CrossLeagueTab({ data }: { data: ManagerIntelPayload }) {
  const cl = data.crossLeague;
  const byPos = cl.mostRosteredByPosition;
  const positionBias = cl.positionBias ?? [];
  const youthLean = data.preferences?.youthPreference ?? "Medium";
  const vetLean = data.preferences?.veteranPreference ?? "Medium";

  // Portfolio Snapshot — derived from existing leans for a quick read.
  const posLean = positionBias
    .filter((p) => p.signal !== "Light" && p.signal !== "Veteran-leaning" && p.signal !== "Balanced")
    .map((p) => p.position);
  const snapshot: Array<{ label: string; value: string }> = [
    { label: "Leagues", value: String(cl.dynastyLeagueCount) },
    { label: "Avg age", value: cl.averageTeamAge != null ? String(cl.averageTeamAge) : "—" },
    { label: "Trade style", value: cl.tradeActivityRating },
    { label: "Waiver style", value: cl.waiverActivityRating },
    { label: "Youth lean", value: youthLean },
    { label: "Veteran lean", value: vetLean },
    ...(posLean.length ? [{ label: "Position lean", value: posLean.join("/") }] : []),
    ...(cl.portfolioType ? [{ label: "Portfolio", value: cl.portfolioType }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Portfolio Snapshot */}
      <SectionCard title="Portfolio snapshot" icon={<Gauge className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {snapshot.map((s) => (
            <div key={s.label} className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-white/40">{s.label}</div>
              <div className="text-[13px] font-bold text-white truncate">{s.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Portfolio Identity */}
      {(cl.portfolioType || cl.portfolioIdentity) && (
        <div className="rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/[0.08] to-transparent p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-2">
            <Users className="w-3.5 h-3.5" />
            <span>Portfolio Identity</span>
          </div>
          {cl.portfolioType && <div className="text-[18px] font-extrabold text-white mb-1.5">{cl.portfolioType}</div>}
          {cl.portfolioIdentity && <p className="text-[13.5px] text-white/85 leading-relaxed">{cl.portfolioIdentity}</p>}
        </div>
      )}

      {/* Favorite Player Types — with confidence */}
      {cl.favoritePlayerTypes && cl.favoritePlayerTypes.length > 0 && (
        <SectionCard title="Favorite player types" icon={<Sparkles className="w-3.5 h-3.5" />}>
          <div className="flex flex-wrap gap-2">
            {cl.favoritePlayerTypes.map((t) => (
              <div
                key={t.type}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/35 bg-[#d4af37]/[0.06] px-2.5 py-1"
              >
                <span className="text-[11px] font-bold text-[#d4af37]">{t.type}</span>
                <span className={cn("text-[9px] font-semibold", confidenceColor(t.confidence))}>
                  {t.confidence} confidence
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Most Rostered by Position — mini-cards w/ signal headers */}
      {byPos && (
        <SectionCard title="Most rostered by position" icon={<Users className="w-3.5 h-3.5" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
              const bias = positionBias.find((b) => b.position === pos);
              return (
                <div key={pos} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white/55">{pos}</span>
                    {bias && (
                      <span className="text-[9px] font-semibold text-[#d4af37]">{bias.signal}</span>
                    )}
                  </div>
                  {byPos[pos].length === 0 ? (
                    <p className="text-[12px] text-white/35">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {byPos[pos].map((p) => (
                        <li key={p.playerId} className="flex items-center justify-between text-[12.5px]">
                          <span className="text-white/80 truncate mr-2">{p.name}</span>
                          <span className={cn("tabular-nums whitespace-nowrap", exposureColor(p.exposure))}>
                            {p.leagueCount}/{cl.dynastyLeagueCount} · {p.exposure}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Position Bias */}
      {positionBias.length > 0 && (
        <SectionCard title="Position bias" icon={<Compass className="w-3.5 h-3.5" />}>
          <div className="space-y-1">
            {positionBias.map((b) => (
              <div key={b.position} className="flex items-center gap-3 py-1.5 border-b border-white/[0.05] last:border-0">
                <span className="text-[12.5px] font-bold text-white w-8">{b.position}</span>
                <Badge variant="outline" className="text-[9px] font-bold text-[#d4af37] border-[#d4af37]/35">
                  {b.signal}
                </Badge>
                <span className="text-[11.5px] text-white/55 ml-auto text-right">{b.interpretation}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Manager Tendencies */}
      {cl.managerTendencies && cl.managerTendencies.length > 0 && (
        <SectionCard title="Manager tendencies" icon={<Target className="w-3.5 h-3.5" />}>
          <KeyTendencies items={cl.managerTendencies} />
        </SectionCard>
      )}

      {/* Trade Implications */}
      {cl.tradeImplications && (
        <div className="rounded-xl border border-[#d4af37]/25 bg-gradient-to-br from-[#d4af37]/[0.06] to-transparent p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
            <Handshake className="w-3.5 h-3.5" />
            <span>Trade implications</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-1.5">Likely values</div>
              <ul className="space-y-1">
                {cl.tradeImplications.likelyValues.map((v, i) => (
                  <li key={i} className="text-[12.5px] text-white/80 flex gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400/70 mt-0.5 flex-shrink-0" />
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300 mb-1.5">Less likely to value</div>
              <ul className="space-y-1">
                {cl.tradeImplications.unlikelyValues.map((v, i) => (
                  <li key={i} className="text-[12.5px] text-white/80 flex gap-1.5">
                    <X className="w-3.5 h-3.5 text-rose-400/70 mt-0.5 flex-shrink-0" />
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="pt-1 border-t border-white/[0.06]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">Best angle</span>
            <p className="text-[13px] text-white/85 mt-1 leading-relaxed">{cl.tradeImplications.bestAngle}</p>
          </div>
        </div>
      )}

      <SectionCard title="Common roster construction" icon={<Compass className="w-3.5 h-3.5" />}>
        <p className="text-[13px] text-white/75">{cl.commonRosterBuild}</p>
        <p className="text-[12px] text-white/45 mt-1">{cl.positionStrengthProfile}</p>
      </SectionCard>

      <SourceNote text="Counts are visible Sleeper leagues only." />
    </div>
  );
}

/** Exposure strength label from the % of visible leagues a player appears in. */
function exposureStrength(pct: number): { label: string; cls: string } {
  if (pct >= 50) return { label: "Heavy", cls: "text-[#d4af37]" };
  if (pct >= 35) return { label: "Strong", cls: "text-emerald-300" };
  if (pct >= 20) return { label: "Moderate", cls: "text-sky-300" };
  return { label: "Light", cls: "text-white/45" };
}

function exposureColor(pct: number): string {
  return exposureStrength(pct).cls;
}

function confidenceColor(c: Rating3): string {
  return c === "High" ? "text-emerald-300" : c === "Medium" ? "text-amber-300" : "text-white/45";
}

/** Interpret a single exposure entry into a one-line "signal". */
function exposureSignal(p: PlayerExposure): string {
  const young = p.age != null && p.age <= 24;
  if (p.exposure >= 50) return "Strong conviction";
  if (p.exposure >= 35) {
    if (young && (p.pos === "TE" || p.pos === "RB")) return `${p.pos} prospect lean`;
    if (young) return `Young ${p.pos} target`;
    return "Core target";
  }
  if (young) return `${p.pos} prospect lean`;
  return `${p.pos} value lean`;
}

function ExposureLeaders({ players }: { players: PlayerExposure[] }) {
  const [filter, setFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const filtered = filter === "ALL" ? players : players.filter((p) => p.pos === filter);
  return (
    <SectionCard title="Exposure leaders" icon={<TrendingUp className="w-3.5 h-3.5" />}>
      <div className="flex flex-wrap gap-1 mb-2.5">
        {(["ALL", "QB", "RB", "WR", "TE"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors",
              filter === f
                ? "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#d4af37]"
                : "border-white/10 text-white/50 hover:text-white/80",
            )}
          >
            {f === "ALL" ? "All" : f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-[12.5px] text-white/45">No {filter} exposure detected.</p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((p) => {
            const strength = exposureStrength(p.exposure);
            return (
              <li
                key={p.playerId}
                className="flex items-center gap-2 py-1.5 border-b border-white/[0.05] last:border-0"
              >
                <span className="text-white/85 text-[13px] truncate min-w-0 flex-1">
                  {p.name}
                  <span className="text-white/40 text-[11px]">
                    {" "}
                    · {p.pos} · {p.team}
                  </span>
                </span>
                <span className={cn("text-[12px] font-bold tabular-nums whitespace-nowrap", strength.cls)}>
                  {p.exposure}%
                </span>
                <span className="text-[10px] text-white/40 w-[120px] text-right hidden sm:block">
                  {strength.label} · {exposureSignal(p)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ── Trade ─────────────────────────────────────────────────────────────────

function TradeApproachTab({ data, viewerTeam }: { data: ManagerIntelPayload; viewerTeam: Team | null }) {
  const ta = data.tradeApproach;
  const diff = ta.tradeDifficulty;
  const pb = ta.playbook;
  const lt = ta.likelyTargetsGrouped;
  const sc = ta.sellCandidatesGrouped;
  // Reconcile "Likely needs" with the rest of the tab: when there are no hard
  // holes, surface the softest group instead of a flat "no needs".
  const needsText =
    ta.likelyNeeds.length > 0
      ? null
      : data.currentLeague?.relativeWeakness ??
        "No severe positional holes — they don't need to force a trade unless the value fits their plan.";

  return (
    <div className="space-y-4">
      {/* Suggested angle — the loudest card on this tab. */}
      <div className="rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/[0.08] to-transparent p-5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-2">
          <Handshake className="w-3.5 h-3.5" />
          <span>Suggested Angle</span>
        </div>
        <p className="text-[14px] text-white/90 leading-relaxed">{ta.suggestedAngle}</p>
      </div>

      {diff && diff.reason && <TradeDifficultyCard difficulty={diff} />}

      {pb && (
        <SectionCard title="Trade playbook" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
          <div className="space-y-1">
            <ProfileRow label="Best approach" value={pb.bestApproach} tone="positive" />
            <ProfileRow label="Best deal type" value={pb.bestDealType} tone="positive" />
            <ProfileRow label="Likely motivation" value={pb.likelyMotivation} />
            <ProfileRow label="Likely style" value={pb.likelyStyle} />
            <ProfileRow label="Negotiation style" value={pb.negotiationStyle} />
            <ProfileRow label="Avoid" value={pb.avoid} tone="caution" />
          </div>
        </SectionCard>
      )}

      <RosterMatch data={data} viewerTeam={viewerTeam} />

      {((ta.targetableAssets?.length ?? 0) > 0 || (ta.protectedAssets?.length ?? 0) > 0) && (
        <TheirAssets targetable={ta.targetableAssets ?? []} protectedAssets={ta.protectedAssets ?? []} />
      )}

      {ta.dealTypes && ta.dealTypes.length > 0 && (
        <SectionCard title="Deal types that fit" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
          <div className="space-y-1">
            {ta.dealTypes.map((d, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-white/[0.05] last:border-0">
                <span className="text-[12.5px] text-white/80 flex-1">{d.dealType}</span>
                <FitBadge fit={d.fit} />
                <span className="text-[11px] text-white/45 w-[44%] text-right hidden sm:block">{d.why}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {((ta.openingOffers?.length ?? 0) > 0 || viewerTeam) && (
        <OfferIdeas data={data} viewerTeam={viewerTeam} />
      )}

      {(lt || sc) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SectionCard title="Likely targets" icon={<Target className="w-3.5 h-3.5" />}>
            <GroupedList primaryLabel="High-fit" primary={lt?.high ?? []} secondaryLabel="Conditional" secondary={lt?.conditional ?? []} />
          </SectionCard>
          <SectionCard title="Possible sell candidates" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
            <GroupedList primaryLabel="Most likely" primary={sc?.mostLikely ?? []} secondaryLabel="Least likely" secondary={sc?.leastLikely ?? []} secondaryTone="muted" />
          </SectionCard>
        </div>
      )}

      <SectionCard title="Likely needs" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        {ta.likelyNeeds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {ta.likelyNeeds.map((n) => (
              <Badge key={n} variant="outline" className="text-[10px] font-bold text-rose-300 border-rose-500/40">
                {n}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-white/65 leading-relaxed">{needsText}</p>
        )}
      </SectionCard>

      {(ta.doList?.length || ta.dontList?.length) && (
        <DoDontCard doList={ta.doList ?? []} dontList={ta.dontList ?? []} />
      )}

      {ta.negotiationNotes && ta.negotiationNotes.length > 0 && (
        <SectionCard title="Negotiation notes" icon={<Target className="w-3.5 h-3.5" />}>
          <ul className="space-y-1.5">
            {ta.negotiationNotes.map((n, i) => (
              <li key={i} className="text-[12.5px] text-white/75 leading-relaxed flex gap-1.5">
                <span className="text-[#d4af37]/70">•</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Caution" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        <p className="text-[12px] text-amber-300/90 leading-relaxed">{ta.cautionNotes}</p>
      </SectionCard>
    </div>
  );
}

function ProfileRow({ label, value, tone }: { label: string; value: string; tone?: "positive" | "caution" }) {
  const toneClass = tone === "positive" ? "text-emerald-300" : tone === "caution" ? "text-rose-300" : "text-white/85";
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-white/[0.05] last:border-0">
      <span className="text-[12px] text-white/55 flex-shrink-0">{label}</span>
      <span className={cn("text-[12px] font-semibold text-right", toneClass)}>{value}</span>
    </div>
  );
}

function FitBadge({ fit }: { fit: Rating3 }) {
  const cls =
    fit === "High" ? "text-emerald-300 border-emerald-500/40" : fit === "Medium" ? "text-amber-300 border-amber-500/40" : "text-white/45 border-white/15";
  return (
    <Badge variant="outline" className={cn("text-[9px] font-bold flex-shrink-0", cls)}>
      {fit} fit
    </Badge>
  );
}

function GroupedList({
  primaryLabel,
  primary,
  secondaryLabel,
  secondary,
  secondaryTone = "neutral",
}: {
  primaryLabel: string;
  primary: string[];
  secondaryLabel: string;
  secondary: string[];
  secondaryTone?: "neutral" | "muted";
}) {
  return (
    <div className="space-y-2.5">
      {primary.length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-300/80 mb-1">{primaryLabel}</div>
          <ul className="space-y-1">
            {primary.map((t, i) => (
              <li key={i} className="text-[12.5px] text-white/80 leading-snug">• {t}</li>
            ))}
          </ul>
        </div>
      )}
      {secondary.length > 0 && (
        <div>
          <div className={cn("text-[9px] font-bold uppercase tracking-wider mb-1", secondaryTone === "muted" ? "text-white/35" : "text-white/45")}>
            {secondaryLabel}
          </div>
          <ul className="space-y-1">
            {secondary.map((t, i) => (
              <li key={i} className="text-[12.5px] text-white/55 leading-snug">• {t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TradeDifficultyCard({ difficulty }: { difficulty: { level: Rating3; reason: string } }) {
  // For trade difficulty, High = harder (caution), Low = easier (good).
  const tone =
    difficulty.level === "High"
      ? "text-rose-300 border-rose-500/40"
      : difficulty.level === "Medium"
      ? "text-amber-300 border-amber-500/40"
      : "text-emerald-300 border-emerald-500/40";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45 mb-1.5">
          <Gauge className="w-3.5 h-3.5" />
          <span>Trade difficulty</span>
        </div>
        <p className="text-[12.5px] text-white/70 leading-relaxed">{difficulty.reason}</p>
      </div>
      <Badge variant="outline" className={cn("text-[11px] font-bold flex-shrink-0", tone)}>
        {difficulty.level}
      </Badge>
    </div>
  );
}

function TheirAssets({
  targetable,
  protectedAssets,
}: {
  targetable: Array<{ name: string; pos: string; age: number | null; value: number; reason: string; difficulty: Rating3 }>;
  protectedAssets: Array<{ name: string; pos: string; value: number; reason: string }>;
}) {
  return (
    <SectionCard title="Assets of theirs to target" icon={<Target className="w-3.5 h-3.5" />}>
      {targetable.length > 0 ? (
        <ul className="space-y-1.5">
          {targetable.map((a, i) => (
            <li key={i} className="flex items-center gap-2 py-1 border-b border-white/[0.05] last:border-0">
              <span className="text-white/85 text-[13px] truncate min-w-0 flex-1">
                {a.name}
                <span className="text-white/40 text-[11px]">
                  {" "}
                  · {a.pos}
                  {a.age ? ` · ${a.age}y` : ""}
                </span>
              </span>
              <span className="text-white/60 tabular-nums text-[11px] whitespace-nowrap">{fmtValue(a.value)}</span>
              <FitBadge fit={a.difficulty} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-white/45">No obvious targetable veterans on their current-league roster.</p>
      )}
      {targetable[0] && <p className="text-[11px] text-white/40 mt-2">{targetable[0].reason}.</p>}

      {protectedAssets.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80 mb-1.5">Likely protected — avoid asking</div>
          <div className="flex flex-wrap gap-1.5">
            {protectedAssets.map((a, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-semibold text-white/60 border-white/15">
                {a.name} <span className="text-white/35 ml-1">{a.pos}</span>
              </Badge>
            ))}
          </div>
          <p className="text-[11px] text-white/40 mt-1.5">
            Also off-limits: premium rookie picks and their highest-exposure players across leagues.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Fit score for one of the viewer's players against this manager's tendencies.
 * Considers position need, age vs their youth lean, and dynasty value.
 */
function playerFit(
  player: { pos: string; age: number; value: number },
  targetPositions: string[],
  preferYouth: boolean,
): { score: number; tag: "Strong" | "Moderate" | "Low"; why: string } {
  let score = 45;
  const posMatch = targetPositions.includes(player.pos);
  if (posMatch) score += 25;
  const age = player.age || 27;
  if (preferYouth) {
    if (age <= 23) score += 22;
    else if (age <= 25) score += 14;
    else if (age >= 29) score -= 24;
    else score -= 4;
  } else if (age >= 26 && age <= 30) {
    score += 12;
  } else if (age <= 22) {
    score -= 6;
  }
  if (player.value >= 3000) score += 8;
  else if (player.value >= 1500) score += 4;
  score = Math.max(0, Math.min(100, score));
  const tag = score >= 75 ? "Strong" : score >= 50 ? "Moderate" : "Low";

  let why: string;
  if (preferYouth && age >= 29) why = "Veteran add-on only";
  else if (preferYouth && age <= 25 && posMatch) why = `Young ${player.pos} upside`;
  else if (posMatch && age <= 27) why = `${player.pos} help that fits`;
  else if (posMatch) why = `${player.pos} help`;
  else if (age <= 25) why = "Young upside piece";
  else why = "Depth / add-on";
  return { score, tag, why };
}

/**
 * "Players on your roster they may want" — fit-scored against the target's
 * tendencies. Computed client-side so it never pollutes the cached payload.
 */
function RosterMatch({ data, viewerTeam }: { data: ManagerIntelPayload; viewerTeam: Team | null }) {
  const targetPositions = data.tradeApproach.targetPositions ?? [];
  const preferYouth = data.tradeApproach.preferYouth ?? false;
  const pickValueHigh = data.preferences?.pickValue === "High";

  const matches = useMemo(() => {
    if (!viewerTeam || targetPositions.length === 0) return [];
    return viewerTeam.roster
      .filter((p) => targetPositions.includes(p.pos) && p.value > 0)
      .map((p) => ({ player: p, ...playerFit({ pos: p.pos, age: p.age, value: p.value }, targetPositions, preferYouth) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [viewerTeam, targetPositions, preferYouth]);

  if (!viewerTeam) {
    return (
      <div className="rounded-lg border border-dashed border-white/12 bg-white/[0.02] px-4 py-4 text-center">
        <div className="text-[12px] text-white/55">
          Connect Sleeper and select an active league to see which of{" "}
          <span className="text-white/75 font-semibold">your</span> players match this manager's tendencies.
        </div>
      </div>
    );
  }

  const fitCls = (tag: string) =>
    tag === "Strong" ? "text-emerald-300" : tag === "Moderate" ? "text-amber-300" : "text-white/45";

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.07] to-transparent p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-2">
        <Handshake className="w-3.5 h-3.5" />
        <span>Players on your roster they may want</span>
      </div>
      {matches.length === 0 ? (
        <p className="text-[12.5px] text-white/55">
          Nothing on your roster lines up cleanly with their{" "}
          {targetPositions.length ? targetPositions.join("/") + " " : ""}targets right now.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {matches.map(({ player: p, score, tag, why }) => (
              <li key={p.id} className="flex items-center gap-2 text-[13px]">
                <span className="text-white/85 truncate min-w-0 flex-1">
                  {p.name}
                  <span className="text-white/40 text-[11px]">
                    {" "}
                    · {p.pos}
                    {p.age ? ` · ${p.age}y` : ""}
                  </span>
                </span>
                <span className="text-emerald-300/90 tabular-nums text-[11px] whitespace-nowrap">{fmtValue(p.value)}</span>
                <span className={cn("text-[11px] font-bold tabular-nums w-9 text-right", fitCls(tag))}>{score}%</span>
                <span className="text-[10px] text-white/45 w-[120px] text-right hidden sm:block truncate">{why}</span>
              </li>
            ))}
          </ul>
          {pickValueHigh && (
            <p className="text-[11px] text-white/50 mt-2.5 leading-relaxed">
              They place a high value on draft capital — your future 1st and 2nd-round rookie picks are likely in
              play too.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Opening offer ideas + concrete package starters built from the viewer's roster. */
function OfferIdeas({ data, viewerTeam }: { data: ManagerIntelPayload; viewerTeam: Team | null }) {
  const targetPositions = data.tradeApproach.targetPositions ?? [];
  const preferYouth = data.tradeApproach.preferYouth ?? false;
  const openingOffers = data.tradeApproach.openingOffers ?? [];
  const nextYr = (() => {
    const s = parseInt(data.meta.season, 10);
    return Number.isFinite(s) ? s + 1 : null;
  })();

  const packages = useMemo(() => {
    if (!viewerTeam || targetPositions.length === 0 || nextYr == null) return [];
    const top = viewerTeam.roster
      .filter((p) => targetPositions.includes(p.pos) && p.value > 0)
      .map((p) => ({ player: p, ...playerFit({ pos: p.pos, age: p.age, value: p.value }, targetPositions, preferYouth) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const tails = [`${nextYr} 2nd`, `${nextYr} 3rd`, `a future 2nd`];
    return top.map((m, i) => `${m.player.name} + ${tails[i] ?? "a future pick"}`);
  }, [viewerTeam, targetPositions, preferYouth, nextYr]);

  return (
    <SectionCard title="Offer ideas" icon={<Sparkles className="w-3.5 h-3.5" />}>
      {openingOffers.length > 0 && (
        <ul className="space-y-1.5">
          {openingOffers.map((o, i) => (
            <li key={i} className="text-[12.5px] text-white/75 leading-relaxed">• {o}</li>
          ))}
        </ul>
      )}
      {packages.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80 mb-1.5">Package starters from your roster</div>
          <ul className="space-y-1">
            {packages.map((p, i) => (
              <li key={i} className="text-[12.5px] text-white/80 leading-snug">• {p}</li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ── Activity (reframed History) ──────────────────────────────────────────────

function ActivityTab({ data }: { data: ManagerIntelPayload }) {
  const act = data.activity;
  if (!act) return <EmptyNotice text="No activity data available." />;

  const signal = act.activitySignal;
  const signalTone =
    signal === "Active"
      ? "text-emerald-300 border-emerald-500/40"
      : signal === "Moderate"
      ? "text-amber-300 border-amber-500/40"
      : signal === "Quiet"
      ? "text-sky-300 border-sky-500/40"
      : "text-white/55 border-white/15";

  const leagues = act.visibleLeagues || 0;
  const per = (n: number) => (leagues > 0 ? (n / leagues).toFixed(1) : "—");
  const total = act.totalTransactions;
  const tradeShare = total > 0 ? Math.round((act.tradeCount / total) * 100) : 0;
  const waiverShare = total > 0 ? 100 - tradeShare : 0;
  const arch = act.activityArchetype;

  return (
    <div className="space-y-4">
      {/* Activity Signal — persona + meaning. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-1.5">
              <Gauge className="w-3.5 h-3.5" />
              <span>Activity Signal</span>
            </div>
            {arch && <div className="text-[16px] font-bold text-white">{arch.label}</div>}
            <p className="text-[13px] text-white/70 leading-relaxed mt-1">{act.signalNote}</p>
          </div>
          <Badge variant="outline" className={cn("text-[11px] font-bold flex-shrink-0", signalTone)}>
            {signal}
          </Badge>
        </div>
      </div>

      {/* Activity Snapshot — counts + per-league rates. */}
      <SectionCard title="Activity snapshot" icon={<Gauge className="w-3.5 h-3.5" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Visible leagues" value={leagues} />
          <Stat label="Oldest visible season" value={act.oldestVisibleSeason ?? "—"} />
          <Stat label="Years active (est.)" value={act.estimatedYearsActive ?? "—"} />
          <Stat label="Transactions" value={total} />
          <Stat label="Transactions / league" value={per(total)} />
          <Stat label="Trades / league" value={per(act.tradeCount)} />
          <Stat label="Waivers / league" value={per(act.waiverCount)} />
          {act.currentPointsFor != null && <Stat label="Current points for" value={act.currentPointsFor} />}
        </div>
      </SectionCard>

      {/* Activity Breakdown — trade vs waiver share. */}
      {total > 0 && (
        <SectionCard title="Activity breakdown" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
          <ShareBar label="Trades" count={act.tradeCount} pct={tradeShare} tone="bg-[#d4af37]" />
          <ShareBar label="Waivers" count={act.waiverCount} pct={waiverShare} tone="bg-sky-400" />
        </SectionCard>
      )}

    </div>
  );
}

function ShareBar({ label, count, pct, tone }: { label: string; count: number; pct: number; tone: string }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-white/70">{label}</span>
        <span className="text-white/55 tabular-nums">{count} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-base font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function PositionGrid({ scores }: { scores: PositionScore[] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {scores.map((s) => (
        <div key={s.position} className="rounded-md border border-white/8 bg-white/[0.02] px-2 py-2 text-center">
          <div className="text-[9px] uppercase tracking-wider text-white/40">{s.position}</div>
          <div className={cn("text-[12px] font-bold mt-0.5", tierColor(s.tier))}>{s.tier}</div>
          <div className="text-[9px] text-white/45 mt-0.5 tabular-nums">
            {s.leagueRank ? `#${s.leagueRank}` : "—"}
            {s.vsLeagueAvg !== 0 ? (
              <span className={cn("ml-1", s.vsLeagueAvg > 0 ? "text-emerald-300" : "text-rose-300")}>
                {s.vsLeagueAvg > 0 ? "+" : ""}
                {s.vsLeagueAvg}%
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function tierColor(tier: PositionScore["tier"]): string {
  switch (tier) {
    case "Elite":
      return "text-emerald-300";
    case "Strong":
      return "text-sky-300";
    case "Average":
      return "text-white/70";
    case "Weak":
      return "text-amber-300";
    case "Thin":
      return "text-rose-300";
  }
}

function EmptyNotice({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[13px] text-white/55">
      {text}
    </div>
  );
}

function SourceNote({ text }: { text: string }) {
  return <p className="text-[10px] text-white/35 italic leading-relaxed pt-1">{text}</p>;
}

function fmtValue(v: number): string {
  if (!v || v <= 0) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}
