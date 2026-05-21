/**
 * Global Manager Intel drawer.
 *
 * Opened from anywhere in the app via `useManagerIntel().openManagerIntel({...})`.
 * Mounted once near the app root (App.tsx) alongside other global drawers.
 *
 * Data source: GET /api/manager-intel/:userId?leagueId=... — cached server-
 * side for 6h per (userId, leagueId, season). The refresh button bypasses
 * the cache via &refresh=1.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Compass,
  History,
  RefreshCw,
  Trophy,
  User,
  Users,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useManagerIntel, type ManagerIntelTarget } from "@/contexts/ManagerIntelContext";
import { API_BASE } from "@/lib/apiBase";

// ── Types — mirrors server/managerIntel.ts ──────────────────────────────────

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
  leagueCount: number;
  exposure: number;
}

interface ManagerIntelPayload {
  user: {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
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
  } | null;
  crossLeague: {
    dynastyLeagueCount: number;
    oldestLeagueSeason: string | null;
    estimatedYearsActive: number | null;
    tradeCount: number;
    waiverCount: number;
    tradeActivityRating: string;
    waiverActivityRating: string;
    mostRosteredPlayers: PlayerExposure[];
    mostDraftedPlayers: PlayerExposure[] | null;
    commonRosterBuild: string;
    averageTeamAge: number | null;
    positionStrengthProfile: string;
  };
  performance: {
    playoffAppearances: number | null;
    championshipWins: number | null;
    finalsAppearances: number | null;
    avgRegularSeasonFinish: number | null;
    avgPointsFor: number | null;
    notes: string;
  };
  tradeApproach: {
    summary: string;
    suggestedAngle: string;
    likelyNeeds: string[];
    assetsTheyMayValue: string[];
    cautionNotes: string;
  };
  meta: {
    season: string;
    leaguesScanned: number;
    computedAt: string;
    dataSourceNote: string;
  };
}

// ── Component ───────────────────────────────────────────────────────────────

export function GlobalManagerIntelDrawer() {
  const isMobile = useIsMobile();
  const { target, isOpen, closeManagerIntel } = useManagerIntel();
  const [tab, setTab] = useState<string>("overview");
  const [data, setData] = useState<ManagerIntelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIntel = useCallback(
    async (t: ManagerIntelTarget, refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (t.leagueId) params.set("leagueId", t.leagueId);
        if (refresh) params.set("refresh", "1");
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/api/manager-intel/${t.userId}${qs}`, {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`Request failed: HTTP ${res.status}`);
        }
        const json = (await res.json()) as ManagerIntelPayload;
        setData(json);
      } catch (err: any) {
        setError(err?.message || "Failed to load manager intel");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Reset + fetch whenever the target changes.
  useEffect(() => {
    if (!isOpen || !target) return;
    setData(null);
    setTab("overview");
    void fetchIntel(target, false);
  }, [isOpen, target, fetchIntel]);

  const handleRefresh = () => {
    if (!target || refreshing) return;
    void fetchIntel(target, true);
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) closeManagerIntel();
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 border-l border-white/10 bg-[#0a1628] text-foreground overflow-hidden flex flex-col",
          isMobile ? "h-[95vh] sm:max-w-full rounded-t-2xl" : "w-full sm:max-w-[560px]",
        )}
        data-testid="manager-intel-drawer"
      >
        <SheetTitle className="sr-only">
          {data ? `${data.user.display_name || data.user.username} manager intel` : "Manager Intel"}
        </SheetTitle>

        <IntelHeader
          target={target}
          data={data}
          loading={loading}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => target && fetchIntel(target, false)} />
        ) : data ? (
          <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
            <TabsList className="mx-3 mt-2 grid grid-cols-5 h-9 bg-white/[0.04] flex-shrink-0">
              <TabsTrigger value="overview" className="text-[10px] flex items-center gap-1">
                <User className="w-3 h-3" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="current" className="text-[10px] flex items-center gap-1">
                <Compass className="w-3 h-3" />
                <span className="hidden sm:inline">League</span>
              </TabsTrigger>
              <TabsTrigger value="cross" className="text-[10px] flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span className="hidden sm:inline">Cross</span>
              </TabsTrigger>
              <TabsTrigger value="trade" className="text-[10px] flex items-center gap-1">
                <ArrowRightLeft className="w-3 h-3" />
                <span className="hidden sm:inline">Trade</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="text-[10px] flex items-center gap-1">
                <History className="w-3 h-3" />
                <span className="hidden sm:inline">History</span>
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-4 py-4">
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
                <TradeApproachTab data={data} />
              </TabsContent>
              <TabsContent value="history">
                <HistoryTab data={data} />
              </TabsContent>
            </div>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function IntelHeader({
  target,
  data,
  loading,
  onRefresh,
  refreshing,
}: {
  target: ManagerIntelTarget | null;
  data: ManagerIntelPayload | null;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const name = data?.user.display_name || data?.user.username || target?.username || "Manager";
  const rawAvatar = data?.user.avatar || target?.avatar || null;
  // Some call sites pass a full Sleeper CDN URL (e.g. team.avatar from the
  // League object); others pass a bare hash (the API response). Accept either.
  const avatarSrc = rawAvatar
    ? rawAvatar.startsWith("http")
      ? rawAvatar
      : `https://sleepercdn.com/avatars/thumbs/${rawAvatar}`
    : null;
  const initial = (name || "?").charAt(0).toUpperCase();
  const teamName = data?.currentLeague?.teamName;
  return (
    <div className="px-4 pt-5 pb-3 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent sticky top-0 z-10">
      <div className="flex items-center gap-3">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="w-10 h-10 rounded-full bg-[#d4af37]/15 flex items-center justify-center font-bold text-[#d4af37] flex-shrink-0">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div
            className="text-[15px] font-bold text-white truncate"
            data-testid="manager-intel-name"
          >
            {name}
          </div>
          <div className="text-[11px] text-white/55 mt-0.5 flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] font-bold text-[#d4af37] border-[#d4af37]/40">
              Manager Intel
            </Badge>
            {teamName && <span className="truncate">· {teamName}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="flex-shrink-0 p-2 rounded-md border border-white/10 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Refresh — bypass cache"
          data-testid="manager-intel-refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-white/70", refreshing && "animate-spin")} />
        </button>
      </div>
    </div>
  );
}

// ── State views ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center px-6">
      <div>
        <div className="inline-block w-6 h-6 border-2 border-[#d4af37]/40 border-t-[#d4af37] rounded-full animate-spin mb-3" />
        <div className="text-sm text-white/70">Scanning visible leagues…</div>
        <div className="text-[11px] text-white/40 mt-1">
          This can take a few seconds the first time.
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center text-center px-6">
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

// ── Tabs ────────────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: ManagerIntelPayload }) {
  const cl = data.crossLeague;
  const cur = data.currentLeague;
  const direction = cur?.teamDirection ?? "Unknown";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatBadge label="Dynasty leagues" value={String(cl.dynastyLeagueCount)} />
        <RatingBadge label="Trade activity" value={cl.tradeActivityRating} />
        <RatingBadge label="Waiver activity" value={cl.waiverActivityRating} />
        <DirectionBadge value={direction} />
      </div>

      <SectionCard title="Summary" icon={<User className="w-3.5 h-3.5" />}>
        <p className="text-[12px] text-white/75 leading-relaxed">{data.tradeApproach.summary}</p>
      </SectionCard>

      <SectionCard title="Position profile" icon={<Activity className="w-3.5 h-3.5" />}>
        <p className="text-[12px] text-white/70">{cl.positionStrengthProfile}</p>
        <p className="text-[11px] text-white/45 mt-1">{cl.commonRosterBuild}</p>
      </SectionCard>

      <SourceNote text={data.meta.dataSourceNote} />
    </div>
  );
}

function CurrentLeagueTab({ data }: { data: ManagerIntelPayload }) {
  const cur = data.currentLeague;
  if (!cur) {
    return (
      <EmptyNotice text="No current league context. Open this drawer from a league view to populate this tab." />
    );
  }
  return (
    <div className="space-y-4">
      <SectionCard title="Dynasty strengths" icon={<Trophy className="w-3.5 h-3.5" />}>
        <PositionGrid scores={cur.dynastyStrengths} />
      </SectionCard>

      <SectionCard title="Win-now strengths" icon={<Activity className="w-3.5 h-3.5" />}>
        <PositionGrid scores={cur.winNowStrengths} />
      </SectionCard>

      <SectionCard title="Team needs" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        {cur.teamNeeds.length === 0 ? (
          <p className="text-[12px] text-white/55">No glaring positional holes vs league average.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cur.teamNeeds.map((n) => (
              <Badge
                key={n}
                variant="outline"
                className="text-[10px] font-bold text-rose-300 border-rose-500/40"
              >
                {n}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SectionCard title="Roster age" icon={<User className="w-3.5 h-3.5" />}>
          <p className="text-[12px] text-white/70">{cur.ageSummary}</p>
        </SectionCard>

        <SectionCard title="Pick capital" icon={<Trophy className="w-3.5 h-3.5" />}>
          <p className="text-[12px] text-white/70">{cur.pickCapitalSummary}</p>
        </SectionCard>
      </div>
    </div>
  );
}

function CrossLeagueTab({ data }: { data: ManagerIntelPayload }) {
  const cl = data.crossLeague;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Dynasty leagues" value={cl.dynastyLeagueCount} />
        <Stat label="Avg team age" value={cl.averageTeamAge ?? "—"} />
        <Stat label="Trades (visible)" value={cl.tradeCount} />
        <Stat label="Waivers (visible)" value={cl.waiverCount} />
      </div>

      <SectionCard title="Most rostered players" icon={<Users className="w-3.5 h-3.5" />}>
        {cl.mostRosteredPlayers.length === 0 ? (
          <p className="text-[12px] text-white/55">No rostered-player overlap detected.</p>
        ) : (
          <ul className="space-y-1.5">
            {cl.mostRosteredPlayers.map((p) => (
              <li key={p.playerId} className="flex items-center justify-between text-[12px]">
                <span className="text-white/80 truncate mr-2">
                  {p.name}
                  <span className="text-white/40"> · {p.pos} · {p.team}</span>
                </span>
                <span className="text-[#d4af37] tabular-nums whitespace-nowrap">
                  {p.leagueCount} lg · {p.exposure}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Most drafted players" icon={<Trophy className="w-3.5 h-3.5" />}>
        {cl.mostDraftedPlayers && cl.mostDraftedPlayers.length > 0 ? (
          <ul className="space-y-1.5">
            {cl.mostDraftedPlayers.map((p) => (
              <li key={p.playerId} className="flex items-center justify-between text-[12px]">
                <span className="text-white/80 truncate mr-2">{p.name}</span>
                <span className="text-[#d4af37] tabular-nums whitespace-nowrap">
                  {p.leagueCount}×
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-white/45">
            Draft attribution isn't available in v1. We're showing roster exposure above instead.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Common roster construction" icon={<Compass className="w-3.5 h-3.5" />}>
        <p className="text-[12px] text-white/75">{cl.commonRosterBuild}</p>
        <p className="text-[11px] text-white/45 mt-1">{cl.positionStrengthProfile}</p>
      </SectionCard>

      <SourceNote text="Counts are visible Sleeper leagues only." />
    </div>
  );
}

function TradeApproachTab({ data }: { data: ManagerIntelPayload }) {
  const ta = data.tradeApproach;
  return (
    <div className="space-y-4">
      <SectionCard title="Suggested angle" icon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
        <p className="text-[12px] text-white/80 leading-relaxed">{ta.suggestedAngle}</p>
      </SectionCard>

      <SectionCard title="Likely needs" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        {ta.likelyNeeds.length === 0 ? (
          <p className="text-[12px] text-white/55">No clear positional needs in this league.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ta.likelyNeeds.map((n) => (
              <Badge
                key={n}
                variant="outline"
                className="text-[10px] font-bold text-rose-300 border-rose-500/40"
              >
                {n}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="What they appear to value" icon={<Trophy className="w-3.5 h-3.5" />}>
        <ul className="space-y-1.5">
          {ta.assetsTheyMayValue.map((a, i) => (
            <li key={i} className="text-[12px] text-white/75 leading-relaxed">
              • {a}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Caution" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        <p className="text-[11px] text-amber-300/90 leading-relaxed">{ta.cautionNotes}</p>
      </SectionCard>
    </div>
  );
}

function HistoryTab({ data }: { data: ManagerIntelPayload }) {
  const perf = data.performance;
  const cl = data.crossLeague;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Visible leagues" value={cl.dynastyLeagueCount} />
        <Stat label="Years active (est.)" value={cl.estimatedYearsActive ?? "—"} />
        <Stat label="Playoff appearances" value={perf.playoffAppearances ?? "—"} />
        <Stat label="Championships" value={perf.championshipWins ?? "—"} />
        <Stat label="Finals appearances" value={perf.finalsAppearances ?? "—"} />
        <Stat label="Avg regular finish" value={perf.avgRegularSeasonFinish ?? "—"} />
        <Stat label="Avg points for" value={perf.avgPointsFor ?? "—"} />
        <Stat label="Oldest visible season" value={cl.oldestLeagueSeason ?? "—"} />
      </div>

      <SectionCard title="Note" icon={<History className="w-3.5 h-3.5" />}>
        <p className="text-[11px] text-white/55 leading-relaxed">{perf.notes}</p>
      </SectionCard>

      <SourceNote text={data.meta.dataSourceNote} />
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
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
      <div className="text-sm font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="outline" className="text-[10px] font-bold border-white/15 text-white/80">
      <span className="text-white/45 mr-1">{label}:</span>
      {value}
    </Badge>
  );
}

function RatingBadge({ label, value }: { label: string; value: string }) {
  const tone =
    value === "Aggressive" || value === "Very Active"
      ? "text-rose-300 border-rose-500/40"
      : value === "Active"
      ? "text-amber-300 border-amber-500/40"
      : value === "Moderate"
      ? "text-sky-300 border-sky-500/40"
      : "text-white/60 border-white/15";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-bold", tone)}>
      <span className="text-white/45 mr-1">{label}:</span>
      {value}
    </Badge>
  );
}

function DirectionBadge({ value }: { value: string }) {
  const tone =
    value === "Contender"
      ? "text-emerald-300 border-emerald-500/40"
      : value === "Rebuild"
      ? "text-sky-300 border-sky-500/40"
      : value === "Middle"
      ? "text-amber-300 border-amber-500/40"
      : "text-white/60 border-white/15";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-bold", tone)}>
      <span className="text-white/45 mr-1">Direction:</span>
      {value}
    </Badge>
  );
}

function PositionGrid({ scores }: { scores: PositionScore[] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {scores.map((s) => (
        <div
          key={s.position}
          className="rounded-md border border-white/8 bg-white/[0.02] px-2 py-2 text-center"
        >
          <div className="text-[9px] uppercase tracking-wider text-white/40">{s.position}</div>
          <div className={cn("text-[11px] font-bold mt-0.5", tierColor(s.tier))}>{s.tier}</div>
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
    <div className="rounded-md border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-white/55">
      {text}
    </div>
  );
}

function SourceNote({ text }: { text: string }) {
  return (
    <p className="text-[10px] text-white/35 italic leading-relaxed pt-1">{text}</p>
  );
}
