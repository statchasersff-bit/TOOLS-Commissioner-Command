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
  ChevronDown,
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
  Swords,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/apiBase";
import { useSleeper } from "@/contexts/SleeperContext";
import { usePlayoffOddsSummary } from "@/hooks/usePlayoffOddsSummary";
import { useManagerLeagueStats } from "@/hooks/useManagerLeagueStats";
import { useManagerWeeklyMatchups } from "@/hooks/useManagerWeeklyMatchups";
import { fetchLeagueTransactions } from "@/lib/sleeperApi";
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
  pickValue?: number;
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
    tradeHistory?: Array<{ date: string; league: string; added: string[]; dropped: string[]; partner: string }>;
    waiverHistory?: Array<{ date: string; league: string; kind: "waiver" | "free_agent"; added: string[]; dropped: string[] }>;
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
  const [basicUser, setBasicUser] = useState<{ username: string; displayName: string; avatar: string | null } | null>(null);
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
    setBasicUser(null);
    setTab("overview");
    void fetchIntel(false);

    // Fetch the lightweight Sleeper identity (name + avatar) in parallel so the
    // header shows the manager immediately instead of the raw user id while the
    // heavier intel payload loads. Sleeper's /user/:id endpoint accepts an id.
    let cancelled = false;
    import("@/lib/sleeperApi")
      .then(({ fetchSleeperUser }) => fetchSleeperUser(userId))
      .then((u) => {
        if (!cancelled) setBasicUser({ username: u.username, displayName: u.displayName, avatar: u.avatar });
      })
      .catch(() => { /* fall back to the intel payload's user once it arrives */ });
    return () => { cancelled = true; };
  }, [userId, fetchIntel]);

  const handleRefresh = () => {
    if (refreshing) return;
    void fetchIntel(true);
  };

  return (
    <div className={cn("manager-intel", !embedded && "min-h-screen bg-background", "text-foreground")}>
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
          basicUser={basicUser}
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
              className={cn("grid grid-cols-4 h-10 bg-white/[0.04]", !embedded && "sticky top-12 z-20")}
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
  basicUser,
  loading,
  onRefresh,
  refreshing,
}: {
  data: ManagerIntelPayload | null;
  basicUser: { username: string; displayName: string; avatar: string | null } | null;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const name =
    data?.user.display_name || data?.user.username ||
    basicUser?.displayName || basicUser?.username ||
    "Manager";
  const rawAvatar = data?.user.avatar || basicUser?.avatar || null;
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
            {archetype?.label ? (
              <Badge variant="outline" className="text-[10px] font-bold text-[#d4af37] border-[#d4af37]/40">
                {archetype.label}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] font-medium text-white/40 border-white/15">
                {loading ? "Analyzing manager…" : "Manager Intel"}
              </Badge>
            )}
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

      <LeagueStandingSection
        leagueId={selected.leagueId}
        ownerId={targetId}
        rosterId={targetRow?.rosterId ?? null}
      />

      <ValueByPosition
        dynasty={selected.dynastyStrengths}
        winNow={selected.winNowStrengths}
        pickValue={selected.pickValue ?? 0}
      />

      {viewerRow && targetRow && (
        <YouVsThem viewer={viewerRow} target={targetRow} />
      )}

      {viewerRow && targetRow && (
        <TradeAnalysisSection
          viewer={viewerRow}
          target={targetRow}
          total={selected.totalRosters}
          tradeOpportunity={selected.tradeOpportunity}
          relativeWeakness={selected.relativeWeakness}
        />
      )}

      <ManagerMatchupsSection
        leagueId={selected.leagueId}
        rosterId={targetRow?.rosterId ?? null}
      />

      <ManagerActivitySection
        leagueId={selected.leagueId}
        rosterId={targetRow?.rosterId ?? null}
      />
    </div>
  );
}

// Ordinal suffix for standings, e.g. 1 → "1st", 3 → "3rd".
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function LeagueStandingSection({
  leagueId, ownerId, rosterId,
}: {
  leagueId: string;
  ownerId: string;
  rosterId: number | null;
}) {
  const { standing, pfRank, maxPfRank, totalTeams, loading } = useManagerLeagueStats(leagueId, ownerId);
  const { odds } = usePlayoffOddsSummary(leagueId);
  const teamOdds = rosterId != null ? odds?.[rosterId] : null;

  const rankValue = (rank: number | null) =>
    rank != null ? `${ordinal(rank)}${totalTeams ? ` of ${totalTeams}` : ""}` : (loading ? "…" : "—");

  return (
    <SectionCard title="League standing" icon={<Gauge className="w-3.5 h-3.5" />}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Standing" value={rankValue(standing)} />
        <Stat label="PF Rank" value={rankValue(pfRank)} />
        <Stat label="Max PF Rank" value={rankValue(maxPfRank)} />
        <Stat
          label="Playoff Odds"
          value={teamOdds ? `${teamOdds.makePlayoffsPct.toFixed(1)}%` : "—"}
        />
      </div>
    </SectionCard>
  );
}

// Color the win-probability number: green when favored, rose when an underdog.
function winProbClass(pct: number): string {
  if (pct >= 55) return "text-emerald-300";
  if (pct <= 45) return "text-rose-300";
  return "text-white/80";
}

function ManagerMatchupsSection({ leagueId, rosterId }: { leagueId: string; rosterId: number | null }) {
  const { weeks, currentWeek, loading, error } = useManagerWeeklyMatchups(leagueId, rosterId);

  return (
    <SectionCard title="Week-by-week matchups" icon={<Swords className="w-3.5 h-3.5" />} collapsible>
      {loading && <p className="text-[13px] text-white/45">Loading matchups…</p>}
      {!loading && error && <p className="text-[13px] text-white/45">Matchups unavailable.</p>}
      {!loading && !error && weeks.length === 0 && (
        <p className="text-[13px] text-white/45">No matchups found for this manager.</p>
      )}
      {!loading && weeks.length > 0 && (
        <div className="space-y-1">
          {weeks.map((w) => {
            const isCurrent = currentWeek != null && w.week === currentWeek;
            return (
              <div
                key={w.week}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5",
                  isCurrent && "border-[#d4af37]/40 bg-[#d4af37]/[0.06]",
                )}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 w-9 flex-shrink-0">Wk {w.week}</span>
                {w.isBye ? (
                  <span className="text-[13px] text-white/55 flex-1">Bye week</span>
                ) : (
                  <>
                    {w.opponentAvatar ? (
                      <img src={w.opponentAvatar} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-white/10 flex-shrink-0" />
                    )}
                    <span className="text-[13px] text-white/80 truncate flex-1">
                      <span className="text-white/40">vs </span>{w.opponentName ?? "TBD"}
                    </span>
                    {w.status === "final" ? (
                      <span className="text-[12px] tabular-nums text-white/55 flex-shrink-0">
                        {w.pointsFor.toFixed(1)}–{w.opponentPointsFor.toFixed(1)}
                      </span>
                    ) : (
                      <span className={cn("text-[13px] font-bold tabular-nums flex-shrink-0", winProbClass(w.winProbability))}>
                        {w.winProbability.toFixed(0)}%
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

interface ManagerTxn {
  type: string;
  timestamp: number;
  week: number;
  adds: { name: string; pos: string; rosterId: number }[];
  drops: { name: string; pos: string; rosterId: number }[];
  involvedTeams: { rosterId: number }[];
}

function txnLabel(type: string): string {
  switch (type) {
    case "trade": return "Trade";
    case "waiver": return "Waiver";
    case "free_agent": return "Free agent";
    default: return type.replace(/_/g, " ");
  }
}

function ManagerActivitySection({ leagueId, rosterId }: { leagueId: string; rosterId: number | null }) {
  const [allTxns, setAllTxns] = useState<ManagerTxn[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!leagueId) { setAllTxns(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchLeagueTransactions(leagueId)
      .then((data) => {
        if (cancelled) return;
        setAllTxns(data.transactions as ManagerTxn[]);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [leagueId]);

  // This manager's own transactions, newest first.
  const txns = useMemo(() => {
    if (!allTxns || rosterId == null) return null;
    return allTxns
      .filter((t) =>
        t.involvedTeams.some((x) => x.rosterId === rosterId) ||
        t.adds.some((p) => p.rosterId === rosterId) ||
        t.drops.some((p) => p.rosterId === rosterId))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [allTxns, rosterId]);

  const counts = useMemo(() => {
    const c = { trade: 0, waiver: 0, free_agent: 0 };
    for (const t of txns ?? []) {
      if (t.type === "trade") c.trade++;
      else if (t.type === "waiver") c.waiver++;
      else if (t.type === "free_agent") c.free_agent++;
    }
    return c;
  }, [txns]);

  // Rank this manager within the league for each activity type. We tally
  // per-roster counts across every transaction (a roster "participates" if it
  // appears in involvedTeams/adds/drops), then rank by count descending using
  // standard competition ranking (ties share the best rank).
  const ranks = useMemo(() => {
    if (!allTxns || rosterId == null) return null;
    const byRoster = new Map<number, { trade: number; waiver: number; free_agent: number }>();
    const bump = (rid: number, type: ManagerTxn["type"]) => {
      let rec = byRoster.get(rid);
      if (!rec) { rec = { trade: 0, waiver: 0, free_agent: 0 }; byRoster.set(rid, rec); }
      if (type === "trade") rec.trade++;
      else if (type === "waiver") rec.waiver++;
      else if (type === "free_agent") rec.free_agent++;
    };
    for (const t of allTxns) {
      const rids = new Set<number>();
      t.involvedTeams.forEach((x) => rids.add(x.rosterId));
      t.adds.forEach((p) => rids.add(p.rosterId));
      t.drops.forEach((p) => rids.add(p.rosterId));
      rids.forEach((rid) => bump(rid, t.type));
    }
    const totalTeams = byRoster.size;
    const rankFor = (key: "trade" | "waiver" | "free_agent", mine: number) => {
      let better = 0;
      byRoster.forEach((rec) => { if (rec[key] > mine) better++; });
      return better + 1;
    };
    return {
      totalTeams,
      trade: rankFor("trade", counts.trade),
      waiver: rankFor("waiver", counts.waiver),
      free_agent: rankFor("free_agent", counts.free_agent),
    };
  }, [allTxns, rosterId, counts]);

  const rankLabel = (rank: number | undefined) =>
    rank != null && ranks ? `${ordinal(rank)} of ${ranks.totalTeams}` : undefined;

  // Color the rank by how active the manager is relative to the league:
  // top third green, bottom third rose, middle neutral.
  const rankClass = (rank: number | undefined) => {
    if (rank == null || !ranks || ranks.totalTeams <= 1) return "text-white/45";
    const pct = (rank - 1) / (ranks.totalTeams - 1);
    if (pct <= 1 / 3) return "text-emerald-300";
    if (pct >= 2 / 3) return "text-rose-300";
    return "text-white/45";
  };

  return (
    <SectionCard title="League activity" icon={<ArrowRightLeft className="w-3.5 h-3.5" />} collapsible>
      {loading && <p className="text-[13px] text-white/45">Loading activity…</p>}
      {!loading && error && <p className="text-[13px] text-white/45">Activity unavailable.</p>}
      {!loading && !error && txns && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Trades" value={counts.trade} sub={rankLabel(ranks?.trade)} subClass={rankClass(ranks?.trade)} />
            <Stat label="Waivers" value={counts.waiver} sub={rankLabel(ranks?.waiver)} subClass={rankClass(ranks?.waiver)} />
            <Stat label="Free agents" value={counts.free_agent} sub={rankLabel(ranks?.free_agent)} subClass={rankClass(ranks?.free_agent)} />
          </div>
          {txns.length === 0 ? (
            <p className="text-[13px] text-white/45">No transactions for this manager yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {txns.slice(0, 40).map((t, i) => {
                const adds = t.adds.filter((p) => p.rosterId === rosterId);
                const drops = t.drops.filter((p) => p.rosterId === rosterId);
                return (
                  <div key={i} className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
                      <span className="font-bold text-white/55">{txnLabel(t.type)}</span>
                      <span>· Wk {t.week}</span>
                    </div>
                    {adds.length > 0 && (
                      <p className="text-[12px] text-emerald-300 truncate">
                        + {adds.map((p) => `${p.name}${p.pos ? ` (${p.pos})` : ""}`).join(", ")}
                      </p>
                    )}
                    {drops.length > 0 && (
                      <p className="text-[12px] text-rose-300 truncate">
                        − {drops.map((p) => `${p.name}${p.pos ? ` (${p.pos})` : ""}`).join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </SectionCard>
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
  const sleeper = useSleeper();
  // League photos come from the viewer's own Sleeper leagues (which carry an
  // avatar) — i.e. exactly the shared leagues. Other leagues fall back to an icon.
  const avatarById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of sleeper.leagues) {
      if (l.avatar) m.set(l.leagueId, l.avatar.startsWith("http") ? l.avatar : `https://sleepercdn.com/avatars/thumbs/${l.avatar}`);
    }
    return m;
  }, [sleeper.leagues]);

  const rankFor = (lg: LeagueReport, owner: string | null) =>
    owner ? lg.rosters.find((r) => r.ownerId === owner)?.dynastyRank ?? null : null;
  const isSharedLeague = (lg: LeagueReport) => !!(viewerId && lg.rosters.some((r) => r.ownerId === viewerId));
  const shared = isSharedLeague(selected);

  const byName = (a: LeagueReport, b: LeagueReport) => a.name.localeCompare(b.name);
  const sharedLeagues = leagues.filter(isSharedLeague).sort(byName);
  const otherLeagues = leagues.filter((lg) => !isSharedLeague(lg)).sort(byName);

  const metaFor = (lg: LeagueReport) => {
    const their = rankFor(lg, targetId);
    const yours = rankFor(lg, viewerId);
    const bits = [`${lg.totalRosters}-team ${lg.scoringFormat} ${lg.format}`];
    if (their) bits.push(`Them #${their}`);
    if (yours) bits.push(`You #${yours}`);
    return bits.join(" · ");
  };

  const LeagueAvatar = ({ lg, size }: { lg: LeagueReport; size: number }) => {
    const src = avatarById.get(lg.leagueId) ?? null;
    return (
      <div
        className="rounded-md overflow-hidden flex-shrink-0 bg-white/10 ring-1 ring-white/10 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <Trophy className="w-3.5 h-3.5 text-white/40" />
        )}
      </div>
    );
  };

  const renderItem = (lg: LeagueReport) => {
    const isActive = lg.leagueId === selected.leagueId;
    return (
      <DropdownMenuItem
        key={lg.leagueId}
        onSelect={() => onSelect(lg.leagueId)}
        data-testid={`league-option-${lg.leagueId}`}
        className="gap-2.5 px-2.5 py-2 cursor-pointer text-white focus:bg-white/10 focus:text-white data-[highlighted]:bg-white/10"
      >
        <LeagueAvatar lg={lg} size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white truncate leading-tight">{lg.name}</div>
          <div className="text-[11px] text-white/45 truncate leading-tight mt-0.5">{metaFor(lg)}</div>
        </div>
        {isActive && <Check className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />}
      </DropdownMenuItem>
    );
  };

  const groupLabel = "text-[11px] font-extrabold uppercase tracking-wider text-[#d4af37] px-2.5 pt-1.5 pb-1";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">Viewing league</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="league-selector"
            className="w-full flex items-center gap-2.5 bg-[#0a1628] border border-white/15 rounded-md px-3 py-2 text-left hover:border-white/25 focus:outline-none focus:border-[#d4af37]/50 transition-colors"
          >
            <LeagueAvatar lg={selected} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-white truncate leading-tight">{selected.name}</div>
              <div className="text-[11px] text-white/45 truncate leading-tight mt-0.5">{metaFor(selected)}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[280px] max-h-[360px] bg-[#0a1628] border-white/15 text-white p-1.5"
        >
          {sharedLeagues.length > 0 && (
            <>
              <DropdownMenuLabel className={groupLabel}>Shared leagues</DropdownMenuLabel>
              {sharedLeagues.map(renderItem)}
            </>
          )}
          {otherLeagues.length > 0 && (
            <>
              {sharedLeagues.length > 0 && <DropdownMenuSeparator className="bg-white/10" />}
              <DropdownMenuLabel className={groupLabel}>Other leagues</DropdownMenuLabel>
              {otherLeagues.map(renderItem)}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Chip>{`${selected.totalRosters} Team ${selected.format}`}</Chip>
        <Chip>{selected.scoringFormat}</Chip>
        {selected.startersCount ? <Chip>{`Start ${selected.startersCount}`}</Chip> : null}
        <Chip tone={shared ? "good" : "muted"}>{shared ? "You share this league" : "Not your league"}</Chip>
      </div>
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "muted" | "gold" | "positive" | "negative" }) {
  const cls =
    tone === "gold"
      ? "text-[#d4af37] border-[#d4af37]/35 bg-[#d4af37]/[0.06]"
      : tone === "positive" || tone === "good"
      ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/[0.06]"
      : tone === "negative"
      ? "text-rose-300 border-rose-500/40 bg-rose-500/[0.06]"
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

const TRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type TradePos = (typeof TRADE_POSITIONS)[number];

// Dynasty league rank for a position (lower = stronger).
function dynRankFor(row: LeagueRosterRank, pos: TradePos): number {
  switch (pos) {
    case "QB": return row.qbRank;
    case "RB": return row.rbRank;
    case "WR": return row.wrRank;
    case "TE": return row.teRank;
  }
}

interface PositionFit {
  pos: TradePos;
  you: number;
  them: number;
  diff: number; // them - you; positive = you hold the edge at this position
}

// ── Competitive window ────────────────────────────────────────────────────
// We classify both rosters off their in-league ranks (lower = stronger) rather
// than the server's tier+age direction, because the viewer's roster only comes
// through as a LeagueRosterRank. Using one rank-based model for both keeps the
// head-to-head symmetric and explainable: win-now standing is the primary axis,
// since trade posture hinges on whether you're buying or selling for this year.
type Window = "Contender" | "Bubble" | "Rebuilding";

interface WindowVerdict {
  window: Window;
  winNowPct: number;  // 0 = strongest win-now in league, 1 = weakest
  dynastyPct: number; // 0 = strongest dynasty value, 1 = weakest
  youthPct: number;   // 0 = youngest, 1 = oldest
}

function classifyWindow(row: LeagueRosterRank, total: number): WindowVerdict {
  const pct = (rank: number) => (total > 1 ? (rank - 1) / (total - 1) : 0);
  const winNowPct = pct(row.winNowRank);
  const dynastyPct = pct(row.dynastyRank);
  const youthPct = pct(row.youthRank);
  const window: Window =
    winNowPct <= 1 / 3 ? "Contender" : winNowPct >= 2 / 3 ? "Rebuilding" : "Bubble";
  return { window, winNowPct, dynastyPct, youthPct };
}

const WINDOW_META: Record<Window, { icon: LucideIcon; cls: string; label: string }> = {
  Contender:   { icon: Crown,  cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/[0.08]", label: "Contender" },
  Bubble:      { icon: Scale,  cls: "text-amber-300 border-amber-500/40 bg-amber-500/[0.08]",        label: "Bubble" },
  Rebuilding:  { icon: Sprout, cls: "text-sky-300 border-sky-500/40 bg-sky-500/[0.08]",              label: "Rebuilding" },
};

function WindowBadge({ who, window }: { who: string; window: Window }) {
  const meta = WINDOW_META[window];
  const Icon = meta.icon;
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", meta.cls)}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wider text-white/45">{who}</div>
        <div className="text-[13px] font-bold">{meta.label}</div>
      </div>
    </div>
  );
}

// Strategy is driven by the (viewer window × target window) pairing, then made
// concrete with the strongest positional edge on each side.
function tradeStrategy(
  you: Window,
  them: Window,
  yourEdge: PositionFit[],
  theirEdge: PositionFit[],
): { headline: string; detail: string } {
  const sendPos = yourEdge[0]?.pos;
  const getPos = theirEdge[0]?.pos;
  const posClause =
    sendPos && getPos
      ? ` Make it concrete: package your ${sendPos} depth to land their ${getPos}.`
      : sendPos
        ? ` Your ${sendPos} surplus is the asset to move.`
        : getPos
          ? ` Their ${getPos} strength is your most realistic target.`
          : "";

  const key = `${you}|${them}`;
  const base: Record<string, { headline: string; detail: string }> = {
    "Contender|Rebuilding": {
      headline: "Buy now — they're selling.",
      detail: "You're chasing a title and they're stocking the future. Offer picks and younger upside for their proven win-now production.",
    },
    "Contender|Contender": {
      headline: "Pry value through need, not window.",
      detail: "You're both buying, so neither will sell a star cheap. Trade from a positional surplus to fix a mutual gap rather than chasing their best players.",
    },
    "Contender|Bubble": {
      headline: "Push them off the fence.",
      detail: "They're undecided. Offer to consolidate their depth into one of your win-now upgrades, or buy a productive veteran with a pick before they commit to a push.",
    },
    "Rebuilding|Contender": {
      headline: "Sell the present for the future.",
      detail: "They want to win now and you're building. Move your aging, productive starters to them for picks and young assets.",
    },
    "Rebuilding|Rebuilding": {
      headline: "Swap for fit, not urgency.",
      detail: "Neither of you is in a hurry. Trade overlapping young pieces or picks to round out positional needs — there's no leverage on either side.",
    },
    "Rebuilding|Bubble": {
      headline: "Fuel their push, bank the future.",
      detail: "Sell your veterans to a team chasing the playoffs in exchange for picks and youth that fit your timeline.",
    },
    "Bubble|Contender": {
      headline: "Decide if you're buying or selling.",
      detail: "If you're fading, cash win-now pieces in for their picks and youth. If you're pushing, swap a surplus for the one piece that closes the gap.",
    },
    "Bubble|Rebuilding": {
      headline: "Consolidate for a push.",
      detail: "Buy their veterans with depth or picks to tip a fence-sitting roster toward contention.",
    },
    "Bubble|Bubble": {
      headline: "Edge out a coin-flip rival.",
      detail: "Marginal moves decide it. Exploit the positional mismatch to gain a small but real weekly edge over a team at your level.",
    },
  };
  const chosen = base[key] ?? {
    headline: "Trade off the positional mismatch.",
    detail: "Lean on where your rosters differ most.",
  };
  return { headline: chosen.headline, detail: chosen.detail + posClause };
}

// Trade Analysis: classifies both teams' competitive windows, recommends a
// strategy off that pairing, then grounds it in the You-vs-Them dynasty rank
// gaps — which positions you can sell from, which to target, and the cleanest
// angle — alongside the league's precomputed trade-opportunity note.
function TradeAnalysisSection({
  viewer,
  target,
  total,
  tradeOpportunity,
  relativeWeakness,
}: {
  viewer: LeagueRosterRank;
  target: LeagueRosterRank;
  total: number;
  tradeOpportunity: string;
  relativeWeakness: string | null;
}) {
  const yourWindow = classifyWindow(viewer, total).window;
  const theirWindow = classifyWindow(target, total).window;
  // A lower rank is stronger, so diff = theirRank - yourRank. A position only
  // counts as a real mismatch once the two sides are at least EDGE_GAP apart.
  const EDGE_GAP = 2;
  const fits: PositionFit[] = TRADE_POSITIONS.map((pos) => {
    const you = dynRankFor(viewer, pos);
    const them = dynRankFor(target, pos);
    return { pos, you, them, diff: them - you };
  });
  const yourEdge = fits.filter((f) => f.diff >= EDGE_GAP).sort((a, b) => b.diff - a.diff);
  const theirEdge = fits.filter((f) => f.diff <= -EDGE_GAP).sort((a, b) => a.diff - b.diff);

  const sendPos = yourEdge[0]?.pos;
  const getPos = theirEdge[0]?.pos;
  const angle =
    sendPos && getPos
      ? `Sell from your ${sendPos} surplus to target their ${getPos} — the clearest mismatch between your rosters.`
      : sendPos
        ? `You hold the edge at ${yourEdge.map((f) => f.pos).join(", ")}. Shop that surplus to fill gaps elsewhere.`
        : getPos
          ? `They're stronger at ${theirEdge.map((f) => f.pos).join(", ")} — your most realistic acquisition targets.`
          : "Rosters are evenly matched by position — no obvious mismatch to exploit.";

  const strategy = tradeStrategy(yourWindow, theirWindow, yourEdge, theirEdge);

  return (
    <SectionCard title="Trade Analysis" icon={<Handshake className="w-3.5 h-3.5" />}>
      {/* Competitive windows — the lens for everything below. */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <WindowBadge who="You" window={yourWindow} />
        <WindowBadge who="Them" window={theirWindow} />
      </div>

      {/* Strategy driven by the window pairing + positional edges. */}
      <div className="mb-3 rounded-md border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#d4af37] mb-1">
          <Target className="w-3 h-3" />
          <span>Strategy</span>
        </div>
        <p className="text-[13.5px] font-bold text-white leading-snug">{strategy.headline}</p>
        <p className="text-[13px] text-white/75 mt-1 leading-relaxed">{strategy.detail}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EdgeColumn title="Your edge — assets to send" tone="you" fits={yourEdge} />
        <EdgeColumn title="Their edge — assets to target" tone="them" fits={theirEdge} />
      </div>

      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/45 mb-1">
          <ArrowRightLeft className="w-3 h-3" />
          <span>Suggested angle</span>
        </div>
        <p className="text-[13px] text-white/80 leading-relaxed">{angle}</p>
      </div>

      {tradeOpportunity && (
        <p className="text-[12.5px] text-white/60 mt-2 leading-relaxed">{tradeOpportunity}</p>
      )}
      {relativeWeakness && (
        <p className="text-[12px] text-white/45 mt-1 leading-relaxed">
          <span className="text-white/55 font-semibold">What they're light on: </span>
          {relativeWeakness}
        </p>
      )}
    </SectionCard>
  );
}

function EdgeColumn({ title, tone, fits }: { title: string; tone: "you" | "them"; fits: PositionFit[] }) {
  const accent = tone === "you" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2",
          tone === "you" ? "text-emerald-300/70" : "text-rose-300/70",
        )}
      >
        <span>{title}</span>
      </div>
      {fits.length === 0 ? (
        <p className="text-[12px] text-white/40 py-1">No clear edge.</p>
      ) : (
        <div className="text-[12.5px]">
          {fits.map((f) => (
            <div
              key={f.pos}
              className="flex items-center justify-between py-1 border-t border-white/[0.05] first:border-t-0"
            >
              <span className="font-semibold text-white/80">{f.pos}</span>
              <span className="text-white/55 tabular-nums">
                #{f.you} <span className="text-white/30">vs</span> #{f.them}
              </span>
              <span className={cn("font-bold tabular-nums", accent)}>{Math.abs(f.diff)} ranks</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Donut color per position (+ picks for the dynasty view).
const POS_COLORS: Record<string, string> = {
  QB: "#f87171",
  RB: "#34d399",
  WR: "#38bdf8",
  TE: "#fbbf24",
  Picks: "#a855f7",
};

function ValueByPosition({
  dynasty,
  winNow,
  pickValue,
}: {
  dynasty: PositionScore[];
  winNow: PositionScore[];
  pickValue: number;
}) {
  const dynastyData = [
    ...dynasty.map((p) => ({ name: p.position, value: p.value })),
    ...(pickValue > 0 ? [{ name: "Picks", value: pickValue }] : []),
  ].filter((d) => d.value > 0);
  const winNowData = winNow.map((p) => ({ name: p.position, value: p.value })).filter((d) => d.value > 0);

  return (
    <SectionCard title="Value by position" icon={<TrendingUp className="w-3.5 h-3.5" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ValueDonut title="Dynasty (incl. picks)" data={dynastyData} />
        <ValueDonut title="Win-Now" data={winNowData} />
      </div>
    </SectionCard>
  );
}

function ValueDonut({ title, data }: { title: string; data: Array<{ name: string; value: number }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-1 text-center">{title}</div>
      {data.length === 0 ? (
        <p className="text-[12px] text-white/45 py-8 text-center">No value data.</p>
      ) : (
        <div className="h-[230px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 18, right: 18, bottom: 0, left: 18 }}>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={60}
                paddingAngle={2}
                stroke="none"
                label={(e: any) => `${e.name} ${Math.round((e.value / total) * 100)}%`}
                labelLine={false}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={POS_COLORS[d.name] ?? "#94a3b8"} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={{ background: "rgba(8,16,32,0.96)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, n: any) => [`${Math.round(Number(v)).toLocaleString()} (${Math.round((Number(v) / total) * 100)}%)`, n]}
              />
              <Legend verticalAlign="bottom" height={20} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
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

  // Activity breakdown + transaction history (moved here from the Activity tab),
  // covering all visible dynasty leagues.
  const act = data.activity;
  const actTotal = act?.totalTransactions ?? 0;
  const tradeShare = actTotal > 0 ? Math.round(((act?.tradeCount ?? 0) / actTotal) * 100) : 0;
  const waiverShare = actTotal > 0 ? 100 - tradeShare : 0;

  const [identityOpen, setIdentityOpen] = useState(false);

  // Portfolio Snapshot — core metrics as a scannable table; leans + the most
  // notable positional biases become quick-read pills below it.
  const snapshotRows: Array<{ label: string; value: string }> = [
    { label: "Leagues", value: String(cl.dynastyLeagueCount) },
    { label: "Avg age", value: cl.averageTeamAge != null ? String(cl.averageTeamAge) : "—" },
    ...(cl.portfolioType ? [{ label: "Build type", value: cl.portfolioType }] : []),
    { label: "Trade style", value: cl.tradeActivityRating },
    { label: "Waiver style", value: cl.waiverActivityRating },
  ];
  // Skip Balanced/Light signals so we don't list every position — that reads as
  // noise. Only surface the biases that actually say something.
  const biasPills = positionBias
    .filter((p) => p.signal && p.signal !== "Balanced" && p.signal !== "Light")
    .slice(0, 3)
    .map((p) => `${p.position} ${p.signal}`);
  const snapshotPills = [`${youthLean} Youth Lean`, `${vetLean} Veteran Lean`, ...biasPills];

  // Portfolio Identity — show the first sentence by default, full text on expand.
  const identityFull = cl.portfolioIdentity ?? "";
  const identitySummary = identityFull.match(/^[^.!?]*[.!?]/)?.[0]?.trim() ?? identityFull;
  const identityHasMore = identityFull.length > identitySummary.length + 1;
  const favTypes = cl.favoritePlayerTypes ?? [];

  return (
    <div className="space-y-4">
      {/* 1. Portfolio Snapshot — metric table + quick-read pills */}
      <SectionCard title="Portfolio snapshot" icon={<Gauge className="w-3.5 h-3.5" />}>
        <div className="divide-y divide-white/[0.06]">
          {snapshotRows.map((s) => (
            <div key={s.label} className="flex items-center justify-between py-1.5">
              <span className="text-[11px] uppercase tracking-wider text-white/45">{s.label}</span>
              <span className="text-[13px] font-bold text-white">{s.value}</span>
            </div>
          ))}
        </div>
        {snapshotPills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {snapshotPills.map((p) => (
              <Chip key={p} tone="gold">{p}</Chip>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 2. Portfolio Identity — headline + short summary (expandable) + tendency pills */}
      {(cl.portfolioType || cl.portfolioIdentity) && (
        <div className="rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/[0.08] to-transparent p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-2">
            <Users className="w-3.5 h-3.5" />
            <span>Portfolio Identity</span>
          </div>
          {cl.portfolioType && <div className="text-[18px] font-extrabold text-white mb-1.5">{cl.portfolioType}</div>}
          {identityFull && (
            <>
              <p className="text-[13.5px] text-white/85 leading-relaxed">
                {identityOpen ? identityFull : identitySummary}
              </p>
              {identityHasMore && (
                <button
                  type="button"
                  onClick={() => setIdentityOpen((o) => !o)}
                  className="mt-1.5 text-[11px] font-semibold text-[#d4af37] hover:underline"
                >
                  {identityOpen ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
          {favTypes.length > 0 && (
            <div className="mt-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/45 mb-1.5">Primary tendencies</div>
              <div className="flex flex-wrap gap-1.5">
                {favTypes.map((t) => (
                  <Chip key={t.type} tone="gold">{t.type}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. What They Value — merges Favorite Player Types + Likely Values into one card */}
      {cl.tradeImplications &&
        (cl.tradeImplications.likelyValues.length > 0 || cl.tradeImplications.unlikelyValues.length > 0) && (
          <SectionCard title="What they value" icon={<Sparkles className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cl.tradeImplications.likelyValues.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-1.5">Highest interest</div>
                  <div className="flex flex-wrap gap-1.5">
                    {cl.tradeImplications.likelyValues.map((v, i) => (
                      <Chip key={i} tone="positive">{v}</Chip>
                    ))}
                  </div>
                </div>
              )}
              {cl.tradeImplications.unlikelyValues.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300 mb-1.5">Lower interest</div>
                  <div className="flex flex-wrap gap-1.5">
                    {cl.tradeImplications.unlikelyValues.map((v, i) => (
                      <Chip key={i} tone="negative">{v}</Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        )}

      {/* 4. Most Rostered Players — the main data visual: 4 cards, % only (counts on hover) */}
      {byPos && (
        <SectionCard title="Most rostered players" icon={<Users className="w-3.5 h-3.5" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
              const bias = positionBias.find((b) => b.position === pos);
              return (
                <div key={pos} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-white/70">{pos}</span>
                    {bias && bias.signal !== "Balanced" && (
                      <span className="text-[9px] font-semibold text-[#d4af37]" title={bias.interpretation}>
                        {bias.signal}
                      </span>
                    )}
                  </div>
                  {byPos[pos].length === 0 ? (
                    <p className="text-[12px] text-white/35">—</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {byPos[pos].map((p) => (
                        <li
                          key={p.playerId}
                          className="flex items-center justify-between text-[12.5px] gap-2"
                          title={`${p.leagueCount} of ${cl.dynastyLeagueCount} leagues`}
                        >
                          <span className="text-white/80 truncate">{p.name}</span>
                          <span className={cn("tabular-nums whitespace-nowrap font-semibold", exposureColor(p.exposure))}>
                            {p.exposure}%
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

      {/* 5. Position Bias — collapsed; the "why" behind the signals shown on the cards above */}
      {positionBias.length > 0 && (
        <SectionCard title="Position bias — why" icon={<Compass className="w-3.5 h-3.5" />} collapsible>
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

      {/* 6. Manager Tendencies — scannable two-column table (Tendency | Read) */}
      {cl.managerTendencies && cl.managerTendencies.length > 0 && (
        <SectionCard title="Manager tendencies" icon={<Target className="w-3.5 h-3.5" />}>
          <div className="divide-y divide-white/[0.06]">
            {cl.managerTendencies.map((t, i) => {
              const idx = t.indexOf(": ");
              const label = idx > 0 ? t.slice(0, idx) : t;
              const read = idx > 0 ? t.slice(idx + 2) : null;
              return (
                <div key={i} className="grid grid-cols-[38%_62%] gap-3 py-2">
                  <span className="text-[12.5px] font-bold text-white">{label}</span>
                  {read && <span className="text-[12px] text-white/65 leading-snug">{read}</span>}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* 7. Trade Strategy — the action section: lead with the angle, then who to send / avoid */}
      {cl.tradeImplications && (
        <div className="rounded-xl border border-[#d4af37]/25 bg-gradient-to-br from-[#d4af37]/[0.06] to-transparent p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
            <Handshake className="w-3.5 h-3.5" />
            <span>Trade strategy</span>
          </div>
          {cl.tradeImplications.bestAngle && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#d4af37] mb-1">Best offer angle</div>
              <p className="text-[13px] text-white/85 leading-relaxed">{cl.tradeImplications.bestAngle}</p>
            </div>
          )}
          {cl.tradeImplications.likelyValues.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 mb-1.5">Send them</div>
              <div className="flex flex-wrap gap-1.5">
                {cl.tradeImplications.likelyValues.map((v, i) => (
                  <Chip key={i} tone="positive">{v}</Chip>
                ))}
              </div>
            </div>
          )}
          {cl.tradeImplications.unlikelyValues.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300 mb-1.5">Avoid leading with</div>
              <div className="flex flex-wrap gap-1.5">
                {cl.tradeImplications.unlikelyValues.map((v, i) => (
                  <Chip key={i} tone="negative">{v}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 8. Common build — compact footer */}
      {(cl.commonRosterBuild || cl.positionStrengthProfile) && (
        <SectionCard title="Common build" icon={<Layers className="w-3.5 h-3.5" />}>
          <p className="text-[12.5px] text-white/75">
            {cl.commonRosterBuild}
            {cl.commonRosterBuild && cl.positionStrengthProfile ? " · " : ""}
            <span className="text-white/45">{cl.positionStrengthProfile}</span>
          </p>
        </SectionCard>
      )}

      {/* Activity Breakdown — trade vs waiver share. */}
      {act && actTotal > 0 && (
        <SectionCard title="Activity breakdown" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
          <ShareBar label="Trades" count={act.tradeCount} pct={tradeShare} tone="bg-[#d4af37]" />
          <ShareBar label="Waivers" count={act.waiverCount} pct={waiverShare} tone="bg-sky-400" />
        </SectionCard>
      )}

      {/* Trade history across all dynasty leagues. */}
      {act && (
        <SectionCard title={`Trade history (${act.tradeHistory?.length ?? 0})`} icon={<ArrowRightLeft className="w-3.5 h-3.5" />} collapsible>
          {act.tradeHistory && act.tradeHistory.length > 0 ? (
            <div className="space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
              {act.tradeHistory.map((t, i) => (
                <TxnRow
                  key={i}
                  date={t.date}
                  league={t.league}
                  added={t.added}
                  dropped={t.dropped}
                  subtitle={t.partner ? `with ${t.partner}` : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45 py-2">No trades found in visible dynasty leagues this season.</p>
          )}
        </SectionCard>
      )}

      {/* Waiver / FA history across all dynasty leagues. */}
      {act && (
        <SectionCard title={`Waiver history (${act.waiverHistory?.length ?? 0})`} icon={<Activity className="w-3.5 h-3.5" />} collapsible>
          {act.waiverHistory && act.waiverHistory.length > 0 ? (
            <div className="space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
              {act.waiverHistory.map((w, i) => (
                <TxnRow
                  key={i}
                  date={w.date}
                  league={w.league}
                  added={w.added}
                  dropped={w.dropped}
                  subtitle={w.kind === "free_agent" ? "free agent" : "waiver"}
                />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45 py-2">No waiver / FA moves found in visible dynasty leagues this season.</p>
          )}
        </SectionCard>
      )}

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

function TxnRow({
  date,
  league,
  added,
  dropped,
  subtitle,
}: {
  date: string;
  league: string;
  added: string[];
  dropped: string[];
  subtitle?: string;
}) {
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "—";
    }
  };
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/40">
        <span className="truncate">{league}{subtitle ? ` · ${subtitle}` : ""}</span>
        <span className="tabular-nums flex-shrink-0">{fmtDate(date)}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-[12.5px]">
        {added.length > 0 && (
          <div className="flex gap-1.5">
            <span className="text-emerald-300/80 font-semibold flex-shrink-0">+</span>
            <span className="text-white/85">{added.join(", ")}</span>
          </div>
        )}
        {dropped.length > 0 && (
          <div className="flex gap-1.5">
            <span className="text-rose-300/80 font-semibold flex-shrink-0">−</span>
            <span className="text-white/55">{dropped.join(", ")}</span>
          </div>
        )}
      </div>
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

function SectionCard({ title, icon, children, collapsible = false }: { title: string; icon?: React.ReactNode; children: React.ReactNode; collapsible?: boolean }) {
  // Collapsible sections start closed so long history lists don't dominate the tab.
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:text-white/70 transition-colors"
        >
          {icon}
          <span>{title}</span>
          <ChevronDown className={cn("w-3.5 h-3.5 ml-auto transition-transform", open && "rotate-180")} />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
          {icon}
          <span>{title}</span>
        </div>
      )}
      {open && <div className={collapsible ? "mt-2" : undefined}>{children}</div>}
    </div>
  );
}

function Stat({ label, value, sub, subClass }: { label: string; value: React.ReactNode; sub?: string; subClass?: string }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-base font-bold tabular-nums text-white">{value}</div>
      {sub && <div className={cn("text-[9px] tabular-nums mt-0.5", subClass ?? "text-white/45")}>{sub}</div>}
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
