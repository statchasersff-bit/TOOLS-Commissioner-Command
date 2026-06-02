/**
 * ManagerPage — full-page Sleeper manager profile at /managers/:userId.
 *
 * The premium, command-center counterpart to the old quick-preview drawer.
 * Reuses the same data source (GET /api/manager-intel/:userId?leagueId=…,
 * cached server-side for 6h) reframed into five tabs:
 *   Overview  — roster identity, scorecard, snapshot.
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

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Layers,
  Shield,
  Star,
  Swords,
  TrendingUp,
  Trophy,
  Users,
  Zap,
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
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { DraftProfileContent, type DraftProfile } from "@/components/manager/DraftProfileCard";
import { API_BASE } from "@/lib/apiBase";
import { useSleeper } from "@/contexts/SleeperContext";
import { usePlayoffOddsSummary } from "@/hooks/usePlayoffOddsSummary";
import { useManagerLeagueStats } from "@/hooks/useManagerLeagueStats";
import { useManagerWeeklyMatchups } from "@/hooks/useManagerWeeklyMatchups";
import { useManagerRoster } from "@/hooks/useManagerRoster";
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
  // Raw values for the Roster Strength Profile (You/Avg/Best bars). Optional for
  // back-compat with cached payloads computed before they were added.
  contenderValue?: number;
  benchValue?: number;
  dynastyTotalValue?: number;
  pickCapitalValue?: number;
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

// Completed-season finish distribution across standing quartiles.
interface CareerFinishes {
  top25: number;
  upperMid: number;   // 26–50%
  lowerMid: number;   // 51–75%
  bottom25: number;
  total: number;
}

// All-time career history aggregated across the manager's visible league chains.
// Mirrors the server CareerHistory shape (only the fields the UI reads).
interface CareerHistory {
  available: boolean;
  seasonsActive: number;
  firstSeason: string | null;
  latestSeason: string | null;
  leagueSeasonsPlayed: number;
  record: { wins: number; losses: number; ties: number } | null;
  winPct: number | null;
  championships: number | null;
  playoffAppearances: number | null;
  finishes: CareerFinishes | null;
  truncated: boolean;
}

interface ManagerIntelPayload {
  user: { user_id: string; username: string; display_name: string; avatar: string | null };
  careerHistory?: CareerHistory;
  rosterIdentity?: string;
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
    valueByPosition?: {
      leagueCount: number;
      dynasty: Array<{ position: "QB" | "RB" | "WR" | "TE"; value: number }>;
      redraft: Array<{ position: "QB" | "RB" | "WR" | "TE"; value: number }>;
    } | null;
    topLeaguemates?: Array<{ ownerId: string; displayName: string; avatar: string | null; sharedLeagues: number }>;
    commonRosterBuild: string;
    averageTeamAge: number | null;
    positionStrengthProfile: string;
    favoritePlayerTypes?: Array<{ type: string; confidence: Rating3 }>;
    portfolioType?: string;
    portfolioIdentity?: string;
    positionBias?: Array<{ position: "QB" | "RB" | "WR" | "TE"; signal: string; interpretation: string }>;
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
  draftProfile?: DraftProfile;
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
    tradeHistory?: Array<{ date: string; league: string; leagueType?: string; week?: number | null; added: string[]; dropped: string[]; partner: string }>;
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
  const [tab, setTab] = useState<string>("current");
  const [data, setData] = useState<ManagerIntelPayload | null>(null);
  const [basicUser, setBasicUser] = useState<{ username: string; displayName: string; avatar: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIntel = useCallback(
    async (refresh: boolean) => {
      if (!refresh) setLoading(true);
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
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;
    setData(null);
    setBasicUser(null);
    setTab("current");
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
        <IntelHero data={data} basicUser={basicUser} />

        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchIntel(false)} />
        ) : data ? (
          <Tabs value={tab} onValueChange={setTab} className="mt-5">
            <TabsList
              className={cn("grid grid-cols-2 h-10 bg-white/[0.04]", !embedded && "sticky top-12 z-20")}
            >
              <TabsTrigger value="current" className="text-[11px] flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">League</span>
              </TabsTrigger>
              <TabsTrigger value="cross" className="text-[11px] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cross-League</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-5">
              <TabsContent value="current">
                <CurrentLeagueTab data={data} />
              </TabsContent>
              <TabsContent value="cross">
                <CrossLeagueTab data={data} />
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
}: {
  data: ManagerIntelPayload | null;
  basicUser: { username: string; displayName: string; avatar: string | null } | null;
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

  // Compact "Manager Snapshot" — fills the header's right side with the most
  // decision-relevant facts at a glance.
  const career = data?.careerHistory;
  const careerSpan =
    career?.available && career.firstSeason
      ? career.latestSeason && career.latestSeason !== career.firstSeason
        ? `${career.firstSeason}–${career.latestSeason}`
        : career.firstSeason
      : null;
  const snapshot = data
    ? [
        { label: "Leagues", value: String(data.crossLeague.dynastyLeagueCount) },
        ...(career?.available
          ? [{ label: "Career Leagues", value: String(career.leagueSeasonsPlayed) }]
          : []),
        ...(careerSpan ? [{ label: "Active", value: careerSpan }] : []),
      ]
    : [];

  return (
    <div className="rounded-xl border border-white/8 bg-gradient-to-b from-white/[0.05] to-transparent pl-px pr-5 h-[104px]">
      <div className="flex items-center gap-4 h-full">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name}
            className="h-[99%] aspect-square rounded-l-[11px] rounded-r-md object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="h-[99%] aspect-square rounded-l-[11px] rounded-r-md bg-[#d4af37]/15 flex items-center justify-center text-2xl font-bold text-[#d4af37] flex-shrink-0">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-bold text-white truncate tracking-tight" data-testid="manager-page-name">
            {name}
          </div>
        </div>

        {snapshot.length > 0 && (
          <div className="hidden md:flex items-stretch gap-4">
            {snapshot.map((s) => (
              <div key={s.label} className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-white/40">{s.label}</div>
                <div className="text-[13px] font-bold text-white truncate max-w-[140px]">{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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

      <LeagueStandingSection
        leagueId={selected.leagueId}
        ownerId={targetId}
        rosterId={targetRow?.rosterId ?? null}
      />

      <RosterStrengthProfile
        rosters={selected.rosters}
        targetOwnerId={targetId}
        targetName={data.user.username || data.user.display_name || "Them"}
        viewer={viewerRow}
      />

      <ValueByPosition
        dynasty={selected.dynastyStrengths}
        winNow={selected.winNowStrengths}
        pickValue={selected.pickValue ?? 0}
        target={targetRow}
        viewer={viewerRow}
        totalTeams={selected.totalRosters}
      />

      <ManagerRosterSection
        leagueId={selected.leagueId}
        rosterId={targetRow?.rosterId ?? null}
      />

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

// The selected team's roster for the chosen league: the players they own,
// grouped by position and sorted by dynasty value, with starters flagged.
function ManagerRosterSection({
  leagueId, rosterId,
}: {
  leagueId: string;
  rosterId: number | null;
}) {
  const { players, loading, error } = useManagerRoster(leagueId, rosterId);
  const POS_ORDER = ["QB", "RB", "WR", "TE"] as const;

  return (
    <SectionCard
      title="Roster"
      icon={<Users className="w-3.5 h-3.5" />}
      subtitle={players.length ? `${players.length} players` : undefined}
    >
      {loading ? (
        <p className="text-[12px] text-white/40">Loading roster…</p>
      ) : error ? (
        <p className="text-[12px] text-white/40">Roster unavailable.</p>
      ) : players.length === 0 ? (
        <p className="text-[12px] text-white/35">No players found for this roster.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {POS_ORDER.map((pos) => {
              const group = players.filter((p) => p.position === pos);
              return (
                <div key={pos} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-white/70">{pos}</span>
                    <span className="text-[10px] text-white/35">{group.length}</span>
                  </div>
                  {group.length === 0 ? (
                    <p className="text-[12px] text-white/35">—</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {group.map((p) => (
                        <li key={p.playerId} className="flex items-center justify-between text-[12.5px] gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            {p.isStarter && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0" title="Starter" />
                            )}
                            <span className="text-white/80 truncate">{p.name}</span>
                            <span className="text-white/30 text-[10.5px] whitespace-nowrap flex-shrink-0">
                              {p.team}{p.age != null ? ` · ${p.age}` : ""}
                            </span>
                          </span>
                          <span className="tabular-nums whitespace-nowrap font-semibold text-white/70">
                            {p.dynastyValue > 0 ? p.dynastyValue.toLocaleString() : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-white/30 mt-2.5">
            Gold dot = starter · values are FantasyCalc dynasty values
          </p>
        </>
      )}
    </SectionCard>
  );
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

// Win-now (redraft) league rank for a position (lower = stronger). Falls back
// to the dynasty rank for payloads cached before win-now ranks were added.
function winNowRankFor(row: LeagueRosterRank, pos: TradePos): number {
  switch (pos) {
    case "QB": return row.qbWinNowRank ?? row.qbRank;
    case "RB": return row.rbWinNowRank ?? row.rbRank;
    case "WR": return row.wrWinNowRank ?? row.wrRank;
    case "TE": return row.teWinNowRank ?? row.teRank;
  }
}

// Donut color per position (+ picks for the dynasty view).
// Canonical position-identity colors, matched to the My Team "Dynasty Value by
// Position" chart (QB rose, RB emerald, WR sky, TE orange, Picks violet).
const POS_COLORS: Record<string, string> = {
  QB: "#f43f5e",   // rose-500
  RB: "#10b981",   // emerald-500
  WR: "#0ea5e9",   // sky-500
  TE: "#f97316",   // orange-500
  Picks: "#8b5cf6", // violet-500
};

// ── Roster Strength Profile ─────────────────────────────────────────────────
// Mirrors the My Team Overview section: four cards (Contender Strength, Bench
// Depth, Dynasty Rank, Rookie Pick Strength), each showing the manager's
// league rank, a coarse tier label, and a You / Avg / Best comparison. Rank,
// average and best are derived client-side from the per-roster raw values the
// server attaches to every LeagueRosterRank.

function strengthTier(rank: number, total: number): { label: string; cls: string } {
  if (total <= 1) return { label: "—", cls: "text-white/50" };
  if (rank === 1) return { label: "Best", cls: "text-emerald-300" };
  const pct = rank / total;
  if (pct <= 0.34) return { label: "Top tier", cls: "text-emerald-300" };
  if (pct <= 0.66) return { label: "Mid pack", cls: "text-amber-300" };
  return { label: "Bottom tier", cls: "text-rose-300" };
}

function StrengthBar({
  themLabel,
  them,
  you,
  avg,
  best,
}: {
  themLabel: string;
  them: number;
  /** Viewer's value — present only when they share this league. */
  you: number | null;
  avg: number;
  best: number;
}) {
  const max = Math.max(1, them, you ?? 0, avg, best);
  const w = (v: number) => `${Math.max(1, Math.round((v / max) * 100))}%`;
  const row = (label: string, value: number, width: string, barCls: string) => (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[9px] uppercase tracking-wider text-white/40 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width }} />
      </div>
      <span className="w-12 text-right text-[10px] tabular-nums text-white/55">{value.toLocaleString()}</span>
    </div>
  );
  return (
    <div className="mt-2 space-y-1">
      {row(themLabel, them, w(them), "bg-[#d4af37]")}
      {you != null && row("You", you, w(you), "bg-sky-400/70")}
      {row("Avg", avg, w(avg), "bg-white/30")}
      {row("Best", best, w(best), "bg-emerald-400/60")}
    </div>
  );
}

function StrengthCard({
  icon,
  label,
  rank,
  total,
  themLabel,
  them,
  you,
  avg,
  best,
}: {
  icon: React.ReactNode;
  label: string;
  rank: number;
  total: number;
  themLabel: string;
  them: number;
  you: number | null;
  avg: number;
  best: number;
}) {
  const tier = strengthTier(rank, total);
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 flex flex-col">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold text-white leading-none">#{rank}</p>
      <p className={cn("mt-1 text-[11px] font-medium", tier.cls)}>{tier.label}</p>
      <StrengthBar themLabel={themLabel} them={them} you={you} avg={avg} best={best} />
    </div>
  );
}

function RosterStrengthProfile({
  rosters,
  targetOwnerId,
  targetName,
  viewer,
}: {
  rosters: LeagueRosterRank[];
  targetOwnerId: string;
  /** Display name of the profiled manager — labels their bar (was "You"). */
  targetName: string;
  /** Viewer's row, present only when they share this league. */
  viewer?: LeagueRosterRank | null;
}) {
  const target = rosters.find((r) => r.ownerId === targetOwnerId);
  // Back-compat: older cached payloads predate these raw value fields. Render
  // nothing rather than a grid of zeros.
  if (!target || target.contenderValue == null) return null;

  // Only show the "You" bar when the viewer is a *different* roster in this league.
  const viewerRow = viewer && viewer.ownerId !== targetOwnerId ? viewer : null;

  const total = rosters.length;
  const metric = (pick: (r: LeagueRosterRank) => number) => {
    const vals = rosters.map((r) => pick(r) || 0);
    const mine = pick(target) || 0;
    const rank = vals.filter((v) => v > mine).length + 1;
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length));
    const best = Math.max(0, ...vals);
    const you = viewerRow ? Math.round(pick(viewerRow) || 0) : null;
    return { them: Math.round(mine), rank, avg, best, you };
  };
  const contender = metric((r) => r.contenderValue ?? 0);
  const bench = metric((r) => r.benchValue ?? 0);
  const dynasty = metric((r) => r.dynastyTotalValue ?? 0);
  const picks = metric((r) => r.pickCapitalValue ?? 0);

  return (
    <SectionCard
      title="Roster Strength Profile"
      icon={<Zap className="w-3.5 h-3.5" />}
      subtitle="Starters, depth, dynasty value & draft capital"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StrengthCard
          icon={<Zap className="w-3.5 h-3.5 text-[#d4af37]" />}
          label="Contender Strength"
          rank={contender.rank}
          total={total}
          themLabel={targetName}
          them={contender.them}
          you={contender.you}
          avg={contender.avg}
          best={contender.best}
        />
        <StrengthCard
          icon={<Shield className="w-3.5 h-3.5 text-sky-400" />}
          label="Bench Depth"
          rank={bench.rank}
          total={total}
          themLabel={targetName}
          them={bench.them}
          you={bench.you}
          avg={bench.avg}
          best={bench.best}
        />
        <StrengthCard
          icon={<TrendingUp className="w-3.5 h-3.5 text-sky-400" />}
          label="Dynasty Rank"
          rank={dynasty.rank}
          total={total}
          themLabel={targetName}
          them={dynasty.them}
          you={dynasty.you}
          avg={dynasty.avg}
          best={dynasty.best}
        />
        <StrengthCard
          icon={<Star className="w-3.5 h-3.5 text-violet-400" />}
          label="Rookie Pick Strength"
          rank={picks.rank}
          total={total}
          themLabel={targetName}
          them={picks.them}
          you={picks.you}
          avg={picks.avg}
          best={picks.best}
        />
      </div>
    </SectionCard>
  );
}

function ValueByPosition({
  dynasty,
  winNow,
  pickValue,
  target,
  viewer,
  totalTeams,
}: {
  dynasty: PositionScore[];
  winNow: PositionScore[];
  pickValue: number;
  /** The profiled manager's per-roster ranks (for the "Them" rank column). */
  target?: LeagueRosterRank | null;
  /** The viewer's ranks, present only when they're in this same league. */
  viewer?: LeagueRosterRank | null;
  totalTeams?: number;
}) {
  const dynastyData = [
    ...dynasty.map((p) => ({
      name: p.position,
      value: p.value,
      rank: target ? dynRankFor(target, p.position) : p.leagueRank ?? null,
      viewerRank: viewer ? dynRankFor(viewer, p.position) : null,
    })),
    ...(pickValue > 0
      ? [{ name: "Picks", value: pickValue, rank: target?.pickRank ?? null, viewerRank: viewer?.pickRank ?? null }]
      : []),
  ].filter((d) => d.value > 0);
  const winNowData = winNow
    .map((p) => ({
      name: p.position,
      value: p.value,
      rank: target ? winNowRankFor(target, p.position) : p.leagueRank ?? null,
      viewerRank: viewer ? winNowRankFor(viewer, p.position) : null,
    }))
    .filter((d) => d.value > 0);

  return (
    <SectionCard title="Value by position" icon={<TrendingUp className="w-3.5 h-3.5" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ValueDonut title="Dynasty (incl. picks)" data={dynastyData} totalTeams={totalTeams} />
        <ValueDonut title="Win-Now" data={winNowData} totalTeams={totalTeams} />
      </div>
    </SectionCard>
  );
}

// League rank → tier color, matched to the strength-profile tiers above.
function donutRankColor(rank: number | null | undefined, total: number): string {
  if (rank == null || total <= 1) return "text-white/50";
  const pct = rank / total;
  if (rank === 1 || pct <= 0.34) return "text-emerald-300";
  if (pct <= 0.66) return "text-amber-300";
  return "text-rose-300";
}

interface DonutDatum {
  name: string;
  value: number;
  /** Profiled manager's league rank at this category (1 = best). */
  rank?: number | null;
  /** Viewer's league rank — present only when they share this league. */
  viewerRank?: number | null;
}

// Styled to match the My Team "Dynasty Value by Position" chart: a thick donut
// with the total in the center, followed by a per-position breakdown (color
// swatch → share bar → share % → raw value → league rank). When the viewer is
// in the same league, the rank column splits into Them vs You.
function ValueDonut({ title, data, totalTeams }: { title: string; data: DonutDatum[]; totalTeams?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const teams = totalTeams ?? 0;
  const showRank = teams > 0 && data.some((d) => d.rank != null);
  const showViewer = showRank && data.some((d) => d.viewerRank != null);
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-1 text-center">{title}</div>
      {data.length === 0 || total === 0 ? (
        <p className="text-[12px] text-white/45 py-8 text-center">No value data.</p>
      ) : (
        <div className="space-y-3">
          <div className="relative h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={POS_COLORS[d.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* center total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold tabular-nums text-white leading-none">
                {total.toLocaleString()}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">Total value</span>
            </div>
          </div>

          {/* breakdown: share + raw value (+ league rank) per category */}
          <div className="space-y-1.5">
            {showRank && (
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-white/35 font-semibold">
                <span className="w-2.5 flex-shrink-0" />
                <span className="w-9">Pos</span>
                <span className="flex-1" />
                <span className="w-9 text-right">Share</span>
                <span className="w-12 text-right">Value</span>
                {showViewer ? (
                  <>
                    <span className="w-11 text-right">Them</span>
                    <span className="w-11 text-right">You</span>
                  </>
                ) : (
                  <span className="w-14 text-right">Lg rank</span>
                )}
              </div>
            )}
            {data
              .slice()
              .sort((a, b) => b.value - a.value)
              .map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: POS_COLORS[d.name] ?? "#94a3b8" }}
                  />
                  <span className="w-9 font-semibold text-white/80">{d.name}</span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(d.value / total) * 100}%`, background: POS_COLORS[d.name] ?? "#94a3b8" }}
                    />
                  </div>
                  <span className="w-9 text-right tabular-nums text-white/45">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                  <span className="w-12 text-right tabular-nums font-medium text-white/80">
                    {d.value.toLocaleString()}
                  </span>
                  {showRank &&
                    (showViewer ? (
                      <>
                        <span className={cn("w-11 text-right tabular-nums font-bold", donutRankColor(d.rank, teams))}>
                          {d.rank != null ? `#${d.rank}` : "—"}
                        </span>
                        <span className={cn("w-11 text-right tabular-nums font-medium", donutRankColor(d.viewerRank, teams))}>
                          {d.viewerRank != null ? `#${d.viewerRank}` : "—"}
                        </span>
                      </>
                    ) : (
                      <span className={cn("w-14 text-right tabular-nums font-bold", donutRankColor(d.rank, teams))}>
                        {d.rank != null ? (
                          <>
                            #{d.rank}
                            <span className="text-white/35 font-normal">/{teams}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Cross-league variant: two donuts (dynasty + redraft) showing the manager's
// average per-position value across all of their visible leagues this season.
function CrossLeagueValueByPosition({
  vbp,
}: {
  vbp: NonNullable<ManagerIntelPayload["crossLeague"]["valueByPosition"]>;
}) {
  const dynastyData = vbp.dynasty.map((p) => ({ name: p.position, value: p.value })).filter((d) => d.value > 0);
  const redraftData = vbp.redraft.map((p) => ({ name: p.position, value: p.value })).filter((d) => d.value > 0);
  if (dynastyData.length === 0 && redraftData.length === 0) return null;
  return (
    <SectionCard
      title="Value by position"
      icon={<TrendingUp className="w-3.5 h-3.5" />}
      subtitle={`Avg per roster across ${vbp.leagueCount} ${vbp.leagueCount === 1 ? "league" : "leagues"}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ValueDonut title="Dynasty" data={dynastyData} />
        <ValueDonut title="Win-Now" data={redraftData} />
      </div>
    </SectionCard>
  );
}

// Managers who share the most of this user's active leagues, with avatar +
// shared-league count.
function TopLeaguemates({
  mates,
}: {
  mates: NonNullable<ManagerIntelPayload["crossLeague"]["topLeaguemates"]>;
}) {
  return (
    <SectionCard
      title="Top leaguemates"
      icon={<Users className="w-3.5 h-3.5" />}
      subtitle="Most-shared managers across their active leagues"
    >
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {mates.map((m) => {
          const src = m.avatar
            ? m.avatar.startsWith("http")
              ? m.avatar
              : `https://sleepercdn.com/avatars/thumbs/${m.avatar}`
            : null;
          const initial = (m.displayName || "?").charAt(0).toUpperCase();
          return (
            <li
              key={m.ownerId}
              className="flex items-center gap-2.5 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2"
            >
              {src ? (
                <img
                  src={src}
                  alt={m.displayName}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-[#d4af37]/15 flex items-center justify-center text-[12px] font-bold text-[#d4af37] flex-shrink-0">
                  {initial}
                </span>
              )}
              <span className="text-[12.5px] font-semibold text-white truncate flex-1 min-w-0">{m.displayName}</span>
              <span className="text-[11px] font-bold text-[#d4af37] tabular-nums flex-shrink-0">
                {m.sharedLeagues} {m.sharedLeagues === 1 ? "league" : "leagues"}
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
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

// Featured all-time stat cards shown at the top of the Cross-league tab:
// career win rate, finish distribution by standing quartile, and championships.
function CareerFeatureCards({ career }: { career: CareerHistory }) {
  const { winPct, championships, finishes, playoffAppearances, record } = career;

  const finishBuckets = finishes
    ? ([
        { label: "Top 25%", n: finishes.top25, cls: "bg-emerald-400/70" },
        { label: "26–50%", n: finishes.upperMid, cls: "bg-sky-400/60" },
        { label: "51–75%", n: finishes.lowerMid, cls: "bg-amber-400/60" },
        { label: "Bottom 25%", n: finishes.bottom25, cls: "bg-rose-400/60" },
      ] as const)
    : [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Career win rate */}
      <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
          <Gauge className="w-3.5 h-3.5" />
          <span>Career win rate</span>
        </div>
        <div className="text-[26px] font-black tabular-nums text-white leading-none">
          {winPct != null ? `${winPct}%` : "—"}
        </div>
        <div className="text-[11px] text-white/45 mt-1.5 tabular-nums">
          {record
            ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""} · ${career.leagueSeasonsPlayed} league-season${career.leagueSeasonsPlayed === 1 ? "" : "s"}`
            : "—"}
        </div>
      </div>

      {/* Career finishes */}
      <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
          <Layers className="w-3.5 h-3.5" />
          <span>Career finishes</span>
        </div>
        {finishes ? (
          <div className="space-y-1.5">
            {finishBuckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[10.5px] text-white/55 w-[60px] flex-shrink-0">{b.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", b.cls)}
                    style={{ width: `${finishes.total ? (b.n / finishes.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-white/70 w-4 text-right">{b.n}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-white/35 mt-1">No completed seasons yet.</div>
        )}
      </div>

      {/* Career championships */}
      <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-2">
          <Crown className="w-3.5 h-3.5" />
          <span>Championships</span>
        </div>
        <div className="text-[26px] font-black tabular-nums text-[#d4af37] leading-none">
          {championships != null ? championships : "—"}
        </div>
        <div className="text-[11px] text-white/45 mt-1.5 tabular-nums">
          {playoffAppearances != null
            ? `${playoffAppearances} playoff appearance${playoffAppearances === 1 ? "" : "s"}`
            : "—"}
        </div>
      </div>
    </div>
  );
}

function CrossLeagueTab({ data }: { data: ManagerIntelPayload }) {
  const cl = data.crossLeague;
  const byPos = cl.mostRosteredByPosition;
  const vbp = cl.valueByPosition;
  const leaguemates = cl.topLeaguemates ?? [];
  const positionBias = cl.positionBias ?? [];

  // Activity breakdown + transaction history (moved here from the Activity tab),
  // covering all visible dynasty leagues.
  const act = data.activity;
  const actTotal = act?.totalTransactions ?? 0;
  const tradeShare = actTotal > 0 ? Math.round(((act?.tradeCount ?? 0) / actTotal) * 100) : 0;
  const waiverShare = actTotal > 0 ? 100 - tradeShare : 0;

  return (
    <div className="space-y-4">
      {/* Featured all-time career stats */}
      {data.careerHistory?.available && <CareerFeatureCards career={data.careerHistory} />}

      {data.draftProfile?.available && (
        <SectionCard
          title="Draft tendencies"
          icon={<Layers className="w-3.5 h-3.5" />}
          subtitle="Startup drafts, current + last season"
        >
          <DraftProfileContent profile={data.draftProfile} />
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

      {/* Value by position — avg dynasty + redraft value per roster across leagues */}
      {vbp && <CrossLeagueValueByPosition vbp={vbp} />}

      {leaguemates.length > 0 && <TopLeaguemates mates={leaguemates} />}

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
            <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
              {act.tradeHistory.map((t, i) => (
                <TradeRow
                  key={i}
                  date={t.date}
                  league={t.league}
                  leagueType={t.leagueType}
                  week={t.week}
                  partner={t.partner}
                  sent={t.dropped}
                  received={t.added}
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

      {data.confidence && <DataCoverageCard confidence={data.confidence} meta={data.meta} />}

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

// Expanded trade card for the Cross-League "Trade history" section: league +
// type tag, week + partner, date, then Sent / Received columns with arrows.
function TradeRow({
  date,
  league,
  leagueType,
  week,
  partner,
  sent,
  received,
}: {
  date: string;
  league: string;
  leagueType?: string;
  week?: number | null;
  partner?: string;
  sent: string[];
  received: string[];
}) {
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    } catch {
      return "—";
    }
  };
  const meta = [week != null ? `Week ${week}` : null, partner ? `with ${partner}` : null].filter(Boolean).join(" • ");
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[13px] font-semibold text-white truncate">{league}</span>
        {leagueType && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#d4af37]/80 flex-shrink-0">
            [{leagueType}]
          </span>
        )}
      </div>
      {meta && <div className="text-[11px] text-white/50 mt-0.5">{meta}</div>}
      <div className="text-[10px] text-white/35 tabular-nums mt-0.5">{fmtDate(date)}</div>

      {sent.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/70 mb-0.5">Sent</div>
          <ul className="space-y-0.5">
            {sent.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12.5px] text-white/60">
                <span className="text-rose-300/70 flex-shrink-0">→</span>
                <span className="truncate">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {received.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70 mb-0.5">Received</div>
          <ul className="space-y-0.5">
            {received.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12.5px] text-white/85">
                <span className="text-emerald-300/70 flex-shrink-0">←</span>
                <span className="truncate">{p}</span>
              </li>
            ))}
          </ul>
        </div>
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

function SectionCard({ title, icon, children, collapsible = false, subtitle }: { title: string; icon?: React.ReactNode; children: React.ReactNode; collapsible?: boolean; subtitle?: string }) {
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
        <div className={cn("flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45", subtitle ? "mb-0.5" : "mb-2")}>
          {icon}
          <span>{title}</span>
          {subtitle && <span className="ml-1.5 normal-case tracking-normal text-white/30 font-normal">{subtitle}</span>}
        </div>
      )}
      {open && <div className={collapsible ? "mt-2" : subtitle ? "mt-2" : undefined}>{children}</div>}
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
