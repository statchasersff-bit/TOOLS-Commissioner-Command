/**
 * PlayerPage — full-page player profile at /players/:playerId (Sleeper id).
 *
 * The premium, command-center counterpart to the quick-preview drawer. Reuses
 * the same data resolver (getPlayerProfile) plus advanced-stats JSON and
 * deterministic insight templates. Theme-aware (light / dark / x-mode) via
 * semantic tokens + the StatChasers gold accent.
 *
 * Phase 1 (this file): route, hero, metric cards, sticky tabs, Overview,
 * Production (incl. weekly game logs), Advanced Stats, basic Availability,
 * sidebar. Later phases fill the Dynasty Value, Trades, News, and Compare tabs
 * (professional empty states render until then).
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  ChevronDown,
  CircleUserRound,
  Layers,
  LineChart,
  Loader2,
  Minus,
  ExternalLink,
  Newspaper,
  Repeat2,
  ScrollText,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ResponsivePlayerName } from "@/components/ResponsivePlayerName";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperPlayers, fetchSleeperLeagueFull, fetchPlayerExposure, fetchTradesForPlayer, fetchTradeLeaguesScanned, fetchPlayerGameLogs, fetchPlayerProduction, fetchPlayerAdpHistory, fetchPlayerAdpAvailability, type PlayerLeagueExposure, type PlayerTradeRecord, type PlayerTradeAsset, type PlayerGameLogRow, type PlayerAdpHistory, type PlayerAdpAvailability, type PlayerAdpAvailabilityCell, type AdpProfileFilters, fetchPlayerNews, type PlayerNewsItem, fetchCuratedPlayerNews, type CuratedNewsItem } from "@/lib/sleeperApi";

// Default ADP-tab filter: the dominant dynasty-startup configuration in the
// crawled dataset (Superflex · PPR · TE Premium · 12-team), so the tab opens
// on a well-populated slice rather than a sparse one.
const DEFAULT_ADP_FILTERS: AdpProfileFilters = { superflex: "yes", scoring: "ppr", tePremium: "yes", teams: 12 };
import { resolvePlayerId, toPlayerSlug } from "@/lib/playerSlug";
import { getPlayerProfile, type PlayerProfile } from "@/lib/playerProfile";
import {
  loadPlayerAdvancedStats,
  type PlayerAdvancedResult,
  type ProductionRow,
  type AdvStatColumn,
  type PlayerSeasonStats,
  type StatRank,
  type RankCard as RankCardData,
  type RankCategory,
  type RankTier,
  type SeasonFinish,
} from "@/lib/playerAdvancedStats";
import { groupColumns, type ColDef, type StatPosition } from "@/lib/advancedStatsMeta";
import {
  dynastySnapshot,
  strengthsAndConcerns,
  similarPlayers,
  overallDynastyRank,
  valueTier,
  type SimilarPlayer,
} from "@/lib/playerPageInsights";
import type { League, Player } from "@/types";

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtValue(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}
function fmtStat(v: unknown, type: AdvStatColumn["type"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (type === "decimal") return v.toFixed(2);
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(2);
  }
  return String(v);
}

// ── Data hook ──────────────────────────────────────────────────────────────────
function usePlayerPageData(param: string) {
  const sleeper = useSleeper();
  const valueModel = useValueModel();

  const [playerDb, setPlayerDb] = useState<Record<string, any> | null>(null);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [adv, setAdv] = useState<PlayerAdvancedResult | null>(null);
  const [advLoading, setAdvLoading] = useState(false);
  const [exposure, setExposure] = useState<PlayerLeagueExposure[] | null>(null);
  const [exposureLoading, setExposureLoading] = useState(false);

  // Resolve a slug or raw Sleeper id from the URL to the canonical Sleeper id.
  const playerId = useMemo(() => resolvePlayerId(param, playerDb), [param, playerDb]);

  useEffect(() => {
    let cancelled = false;
    getSleeperPlayers()
      .then((db) => { if (!cancelled) setPlayerDb(db); })
      .catch(() => { if (!cancelled) setPlayerDb({}); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sleeper.activeLeagueId || !sleeper.user?.userId) {
      setActiveLeague(null);
      setUserTeamId(null);
      return;
    }
    let cancelled = false;
    (fetchSleeperLeagueFull(sleeper.activeLeagueId, sleeper.user.userId) as Promise<{ league: League; userTeamId: string | null }>)
      .then((data) => { if (!cancelled) { setActiveLeague(data.league); setUserTeamId(data.userTeamId); } })
      .catch(() => { if (!cancelled) setActiveLeague(null); });
    return () => { cancelled = true; };
  }, [sleeper.activeLeagueId, sleeper.user?.userId]);

  const profile: PlayerProfile | null = useMemo(() => {
    if (!playerId) return null;
    return getPlayerProfile({
      playerId,
      sleeperPlayerDb: playerDb,
      activeLeague,
      currentUserTeamId: userTeamId,
      getPlayerValue: valueModel.getPlayerValue,
      getRedraftValue: valueModel.getRedraftValue,
      dynastyPlayerList: valueModel.dynastyPlayerList,
      valuesBySleeperId: valueModel.valuesBySleeperId,
      redraftValuesBySleeperId: valueModel.redraftValuesBySleeperId,
    });
  }, [playerId, playerDb, activeLeague, userTeamId, valueModel.getPlayerValue, valueModel.getRedraftValue, valueModel.dynastyPlayerList, valueModel.valuesBySleeperId, valueModel.redraftValuesBySleeperId]);

  useEffect(() => {
    if (!profile) { setAdv(null); return; }
    let cancelled = false;
    setAdvLoading(true);
    loadPlayerAdvancedStats(profile.player.pos, profile.player.name)
      .then((r) => { if (!cancelled) setAdv(r); })
      .catch(() => { if (!cancelled) setAdv(null); })
      .finally(() => { if (!cancelled) setAdvLoading(false); });
    return () => { cancelled = true; };
  }, [profile?.player.pos, profile?.player.name]);

  // Cross-league exposure — owned / opponent / available across all leagues.
  const userId = sleeper.user?.userId ?? null;
  const leagueKey = sleeper.leagues.map((l) => l.leagueId).join(",");
  useEffect(() => {
    if (!playerId || !userId || !sleeper.leagues.length) { setExposure(null); return; }
    let cancelled = false;
    setExposureLoading(true);
    fetchPlayerExposure(userId, sleeper.leagues.map((l) => ({ leagueId: l.leagueId, name: l.name, avatar: l.avatar })), playerId)
      .then((rows) => { if (!cancelled) setExposure(rows); })
      .catch(() => { if (!cancelled) setExposure(null); })
      .finally(() => { if (!cancelled) setExposureLoading(false); });
    return () => { cancelled = true; };
  }, [playerId, userId, leagueKey]);

  return {
    profile,
    adv,
    advLoading,
    exposure,
    exposureLoading,
    resolvedId: playerId,
    dbLoading: playerDb === null,
    raw: playerId ? (playerDb?.[playerId] ?? null) : null,
    valueModel,
    sleeper,
  };
}

const TABS = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "production", label: "Game Log", icon: BarChart3 },
  { id: "advanced", label: "Advanced Stats", icon: Layers },
  { id: "adp", label: "ADP", icon: Target },
  { id: "trades", label: "Trades", icon: Repeat2 },
  { id: "availability", label: "Availability", icon: Users },
  { id: "news", label: "News", icon: Newspaper },
] as const;

// ── Page ───────────────────────────────────────────────────────────────────────
export default function PlayerPage({ params, embedded = false }: { params?: { playerId?: string }; embedded?: boolean }) {
  const param = params?.playerId ?? "";
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<string>("overview");
  const { profile, adv, advLoading, exposure, exposureLoading, resolvedId, dbLoading, raw, valueModel, sleeper } = usePlayerPageData(param);

  // Trades are heavy to compute (per-league transaction scans) so they lazy-load
  // only when the Trades tab is first opened, and reset when the player changes.
  // Full-career production for the Game Log tab — lazy-loaded from the server
  // (the bundled advanced-stats files only cover the last few seasons).
  const [production, setProduction] = useState<ProductionRow[] | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const productionLoadedRef = useRef<string | null>(null);

  const [trades, setTrades] = useState<PlayerTradeRecord[] | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
  // Total leagues crawled into the trade DB (the corpus scanned for any
  // player's trades). Global + cached, so fetched once and reused.
  const [tradeLeaguesScanned, setTradeLeaguesScanned] = useState<number | null>(null);
  // Tracks which player we've already kicked off a trades fetch for, so the
  // effect doesn't refetch (or cancel itself) on unrelated re-renders.
  const tradesLoadedRef = useRef<string | null>(null);

  // ADP analytics — same lazy-load-on-first-open pattern as trades. Two
  // endpoints (3-year history + per-pick availability) fetched in parallel.
  const [adpHistory, setAdpHistory] = useState<PlayerAdpHistory | null>(null);
  const [adpAvail, setAdpAvail] = useState<PlayerAdpAvailability | null>(null);
  const [adpLoading, setAdpLoading] = useState(false);
  const [adpError, setAdpError] = useState(false);
  const [adpFilters, setAdpFilters] = useState<AdpProfileFilters>(DEFAULT_ADP_FILTERS);
  // Keyed by player + filter combo so changing a filter (or the player) triggers
  // a refetch, but re-renders / tab toggles within the same combo don't.
  const adpLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    setTab("overview");
    window.scrollTo(0, 0);
    setTrades(null);
    tradesLoadedRef.current = null;
    setProduction(null);
    productionLoadedRef.current = null;
    setAdpHistory(null);
    setAdpAvail(null);
    setAdpError(false);
    adpLoadedRef.current = null;
  }, [param]);

  // Lazy-load full-career production when the Game Log tab is first opened.
  useEffect(() => {
    if (tab !== "production" || !resolvedId) return;
    if (productionLoadedRef.current === resolvedId) return;
    productionLoadedRef.current = resolvedId;
    setProductionLoading(true);
    fetchPlayerProduction(resolvedId)
      .then((seasons) => setProduction(seasons.map((s) => ({
        season: String(s.season),
        team: s.team ?? "—",
        games: s.games,
        ppgStd: s.ppgStd, ppgHalf: s.ppgHalf, ppgPpr: s.ppgPpr,
        finishStd: s.finishStd, finishHalf: s.finishHalf, finishPpr: s.finishPpr,
      }))))
      .catch(() => setProduction([]))
      .finally(() => setProductionLoading(false));
  }, [tab, resolvedId]);

  useEffect(() => {
    if (tab !== "trades") return;
    if (!resolvedId || !profile) return;
    if (tradesLoadedRef.current === resolvedId) return; // already fetched for this player
    tradesLoadedRef.current = resolvedId;
    setTradesLoading(true);
    fetchTradesForPlayer(profile.player.name, resolvedId)
      .then((r) => setTrades(r))
      .catch(() => setTrades([]))
      .finally(() => setTradesLoading(false));
    // Global trade-corpus size — fetch once, reuse across players.
    if (tradeLeaguesScanned == null) {
      fetchTradeLeaguesScanned().then((n) => { if (n != null) setTradeLeaguesScanned(n); });
    }
  }, [tab, resolvedId, profile?.player.name]);

  useEffect(() => {
    if (tab !== "adp") return;
    if (!resolvedId) return;
    const key = `${resolvedId}|${adpFilters.superflex}|${adpFilters.scoring}|${adpFilters.tePremium}|${adpFilters.teams}`;
    if (adpLoadedRef.current === key) return;
    adpLoadedRef.current = key;
    setAdpLoading(true);
    setAdpError(false);
    Promise.all([fetchPlayerAdpHistory(resolvedId, adpFilters), fetchPlayerAdpAvailability(resolvedId, adpFilters)])
      .then(([h, a]) => { setAdpHistory(h); setAdpAvail(a); })
      .catch(() => setAdpError(true))
      .finally(() => setAdpLoading(false));
  }, [tab, resolvedId, adpFilters]);

  // Derived dynasty intelligence (Overview).
  const dynRank = useMemo(
    () => (profile ? overallDynastyRank(valueModel.dynastyPlayerList, { id: profile.player.id, name: profile.player.name }) : null),
    [profile, valueModel.dynastyPlayerList],
  );
  const similar = useMemo<SimilarPlayer[]>(
    // Return up to 7 candidates so the auto-fill grid below can add columns to
    // fill wide desktop rows instead of stretching a few cards oversized.
    () => (profile ? similarPlayers(valueModel.dynastyPlayerList, { id: profile.player.id, name: profile.player.name, pos: profile.player.pos, value: profile.values.dynasty }, 7) : []),
    [profile, valueModel.dynastyPlayerList],
  );

  return (
    <div className={cn(!embedded && "min-h-screen bg-background", "text-foreground")}>
      {/* Breadcrumb bar. Sticky as a standalone page; non-sticky when embedded
          inside the app shell (the shell header is the sticky chrome there). */}
      <div className={cn(
        "h-12 flex items-center gap-3 px-4 border-b border-border/60",
        !embedded && "sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75",
      )}>
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation("/"); }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          data-testid="player-page-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {profile && (
          <span className="text-xs font-semibold text-foreground/80 truncate">{profile.player.name}</span>
        )}
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">Player Profile</span>
      </div>

      {dbLoading && !profile ? (
        <HeroSkeleton />
      ) : !profile ? (
        <NotFound playerId={param} onBack={() => setLocation("/")} />
      ) : (
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 space-y-5">
          <Hero profile={profile} raw={raw} dynRank={dynRank} />

          {/* Tab bar — sticky as a standalone page; static when embedded. */}
          <div className={cn(
            "-mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-border/50",
            !embedded && "sticky top-12 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75",
          )}>
            <div className="flex flex-nowrap gap-1 overflow-x-auto scrollbar-hide">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    data-testid={`player-tab-${t.id}`}
                    className={cn(
                      "relative flex flex-shrink-0 items-center gap-1.5 px-3 py-2.5 min-h-[40px] text-xs font-semibold whitespace-nowrap transition-colors",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                    {active && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-[#d4af37]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="space-y-5 min-w-0">
              {tab === "overview" && (
                <OverviewTab profile={profile} adv={adv} advLoading={advLoading} similar={similar} dynRank={dynRank} onOpenPlayer={(id) => setLocation(`/players/${id}`)} />
              )}
              {tab === "production" && <ProductionTab playerId={resolvedId} production={production} loading={productionLoading} pos={profile.player.pos} />}
              {tab === "advanced" && <AdvancedTab adv={adv} advLoading={advLoading} pos={profile.player.pos} />}
              {tab === "adp" && <AdpTab history={adpHistory} avail={adpAvail} loading={adpLoading} error={adpError} pos={profile.player.pos} filters={adpFilters} onFiltersChange={setAdpFilters} />}
              {tab === "trades" && <TradesTab trades={trades} loading={tradesLoading} valuesBySleeperId={valueModel.valuesBySleeperId} playerName={profile.player.name} leaguesScanned={tradeLeaguesScanned} />}
              {tab === "availability" && (
                <AvailabilityTab
                  connected={sleeper.isConnected}
                  exposure={exposure}
                  loading={exposureLoading}
                />
              )}
              {tab === "news" && <NewsTab playerId={resolvedId} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ profile, raw, dynRank }: { profile: PlayerProfile; raw: any; dynRank: number | null }) {
  const p = profile.player;
  const dyn = profile.values.dynasty;
  const tier = valueTier(dyn);
  const yearsExp = p.yearsExp ?? (typeof raw?.years_exp === "number" ? raw.years_exp : undefined);
  const jersey = raw?.number ?? null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-row items-stretch">
        {/* Responsive full-bleed image column: 96px on mobile → 180px on desktop,
            height follows the card so headshots never distort or dominate. */}
        <HeroImage id={p.id} name={p.name} pos={p.pos} team={p.team} className="w-24 sm:w-[180px] self-stretch min-h-[128px]" />
        <div className="flex-1 p-4 sm:p-5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* Wrap to two lines before truncating so "Bijan Robinson" never
                  becomes "Bijan …" on narrow screens. */}
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground leading-[1.1] [overflow-wrap:anywhere] line-clamp-2" data-testid="player-page-name">{p.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-bold text-foreground">{p.pos}</span>
                <span>·</span>
                <span>{p.team || "Free Agent"}</span>
                {p.age != null && (<><span>·</span><span>Age {p.age}</span></>)}
                {yearsExp != null && (<><span>·</span><span>{yearsExp === 0 ? "Rookie" : `Year ${yearsExp + 1}`}</span></>)}
                {jersey && (<><span>·</span><span>#{jersey}</span></>)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dynasty Value</div>
              <div className="text-2xl font-black tabular-nums text-[#d4af37]">{fmtValue(dyn)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">SF · PPR</div>
            </div>
          </div>

          <span className="block h-[2.5px] w-12 bg-[#d4af37] rounded-full my-3" />

          <div className="flex flex-wrap gap-2">
            <HeroBadge label="Position Rank" value={profile.ranks.dynastyPositional ? `${p.pos}${profile.ranks.dynastyPositional}` : "—"} />
            <HeroBadge label="Value Tier" value={tier} accent />
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroImage({ id, name, pos, team, className, initialsClassName, logoClassName }: { id: string; name: string; pos: string; team?: string; className?: string; initialsClassName?: string; logoClassName?: string }) {
  const [err, setErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const synthetic = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  const initials = (name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");
  const showLogo = !!team && team !== "FA" && !logoErr;
  return (
    <div className={cn("relative flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#0b3a7a]/25 to-transparent", className)}>
      {/* Faint team logo watermark — sits behind the player photo (visible in
          the gradient margins / behind the initials fallback). */}
      {showLogo && (
        <img
          src={`https://sleepercdn.com/images/team_logos/nfl/${team!.toLowerCase()}.png`}
          alt=""
          aria-hidden="true"
          className={cn("absolute inset-0 m-auto w-[85%] h-[85%] object-contain opacity-20 pointer-events-none select-none", logoClassName)}
          onError={() => setLogoErr(true)}
        />
      )}
      {err || synthetic ? (
        <div className={cn("relative w-full h-full flex items-center justify-center text-4xl font-black text-muted-foreground/50", initialsClassName)}>{initials}</div>
      ) : (
        <img
          src={`https://sleepercdn.com/content/nfl/players/${id}.jpg`}
          alt={name}
          className="relative w-full h-full object-cover object-top"
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}

function HeroBadge({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className={cn(
      "inline-flex flex-col rounded-lg border px-2.5 py-1 leading-tight",
      accent ? "border-[#d4af37]/40 bg-[#d4af37]/10" : "border-border bg-muted/30",
    )}>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-bold", accent ? "text-[#d4af37]" : "text-foreground")}>{value}</span>
    </span>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({
  profile, adv, advLoading, similar, dynRank, onOpenPlayer,
}: {
  profile: PlayerProfile;
  adv: PlayerAdvancedResult | null;
  advLoading: boolean;
  similar: SimilarPlayer[];
  dynRank: number | null;
  onOpenPlayer: (id: string) => void;
}) {
  const snapshot = dynastySnapshot({
    name: profile.player.name,
    pos: profile.player.pos,
    age: profile.player.age,
    dynastyValue: profile.values.dynasty,
    posRank: profile.ranks.dynastyPositional,
  });
  const { strengths, concerns } = strengthsAndConcerns({
    pos: profile.player.pos,
    age: profile.player.age,
    injuryStatus: profile.player.injuryStatus,
    composites: adv?.composites ?? [],
  });

  return (
    <div className="space-y-5">
      {/* Dynasty snapshot */}
      <Card className="p-5">
        <SectionTitle icon={Sparkles} title="Dynasty Snapshot" />
        <p className="text-sm leading-relaxed text-foreground/85">{snapshot}</p>
      </Card>

      {/* Strengths / concerns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <SectionTitle icon={TrendingUp} title="Strengths" />
          {advLoading ? <SkeletonLines n={3} /> : strengths.length ? (
            <ul className="space-y-1.5">
              {strengths.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-foreground/85">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />{s}
                </li>
              ))}
            </ul>
          ) : <EmptyLine text="No standout strengths from available metrics." />}
        </Card>
        <Card className="p-5">
          <SectionTitle icon={Activity} title="Concerns" />
          {advLoading ? <SkeletonLines n={3} /> : concerns.length ? (
            <ul className="space-y-1.5">
              {concerns.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-foreground/85">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />{c}
                </li>
              ))}
            </ul>
          ) : <EmptyLine text="No notable concerns from available metrics." />}
        </Card>
      </div>

      {/* Value trend (empty state — no history yet) */}
      <Card className="p-5">
        <SectionTitle icon={LineChart} title="Value Trend" />
        <EmptyBlock icon={LineChart} text="Value history will appear once historical ranking snapshots are available." />
      </Card>

      {/* Similar players */}
      <Card className="p-5">
        <SectionTitle icon={Users} title="Similar Dynasty Assets" noMargin />
        <div className="h-3" />
        {similar.length ? (
          // Auto-FILL (not auto-fit): tracks are created to fill the row, so
          // cards stay near the 132px min and the grid adds more columns as the
          // viewport widens — rather than stretching a few cards larger than the
          // player hero. Cards wrap to 2–3 per row on narrow viewports.
          <div
            className="grid gap-2 sm:gap-3 mt-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}
          >
            {similar.map((s) => (
              <button
                key={s.sleeperId}
                onClick={() => onOpenPlayer(toPlayerSlug(s.name, s.team, s.pos))}
                className="group text-left rounded-xl border border-border bg-muted/20 hover:border-[#d4af37]/40 hover:bg-muted/40 transition-colors overflow-hidden min-w-0"
                data-testid={`similar-player-${s.sleeperId}`}
              >
                <HeroImage
                  id={s.sleeperId}
                  name={s.name}
                  pos={s.pos}
                  team={s.team}
                  className="w-full aspect-[4/3]"
                  initialsClassName="text-3xl"
                  logoClassName="w-[120%] h-[120%] opacity-30"
                />
                <div className="p-2 sm:p-3 min-w-0">
                  <ResponsivePlayerName name={s.name} className="text-sm font-bold text-foreground" />
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.pos} · {s.team || "FA"} · Age {s.age}</div>
                  <div className="text-xs font-bold text-[#d4af37] mt-1 tabular-nums">{fmtValue(s.value)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : <EmptyLine text="Similar players will appear once values are loaded." />}
      </Card>
    </div>
  );
}

// ── Production ──────────────────────────────────────────────────────────────
// ── Season-End Finishes ─────────────────────────────────────────────────────
// Horizontal timeline of PPR positional finishes by season. Reusable for QB/RB/
// WR/TE. Ranks come from playerAdvancedStats (PPG-gated + total); this is pure
// presentation, including the per-position finish tiers used for card color.
type FinishTier = "elite" | "starter" | "usable" | "depth" | "poor";

function finishTier(pos: string, rank: number): FinishTier {
  const p = pos.toUpperCase();
  if (p === "QB") return rank <= 6 ? "elite" : rank <= 12 ? "starter" : rank <= 18 ? "usable" : rank <= 24 ? "depth" : "poor";
  if (p === "TE") return rank <= 3 ? "elite" : rank <= 6 ? "starter" : rank <= 12 ? "usable" : rank <= 18 ? "depth" : "poor";
  return rank <= 12 ? "elite" : rank <= 24 ? "starter" : rank <= 36 ? "usable" : rank <= 48 ? "depth" : "poor"; // RB/WR
}

// Same tool gradient as the rank snapshot: emerald → white → gold → orange → rose.
const FINISH_TIER_STYLE: Record<FinishTier, { text: string; chip: string; label: string }> = {
  elite:   { text: "text-emerald-600 dark-any:text-emerald-400", chip: "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400", label: "Elite" },
  starter: { text: "text-foreground",                            chip: "bg-foreground/10 text-foreground",                              label: "Starter" },
  usable:  { text: "text-[#d4af37]",                             chip: "bg-[#d4af37]/15 text-[#d4af37]",                                label: "Usable" },
  depth:   { text: "text-orange-600 dark-any:text-orange-400",   chip: "bg-orange-500/10 text-orange-600 dark-any:text-orange-400",    label: "Depth" },
  poor:    { text: "text-rose-600 dark-any:text-rose-400",       chip: "bg-rose-500/10 text-rose-600 dark-any:text-rose-400",          label: "Poor" },
};

function SeasonFinishesTimeline({ finishes, pos }: { finishes: SeasonFinish[]; pos: string }) {
  const [mode, setMode] = useState<"ppg" | "total">("ppg");
  if (!finishes.length) return null;

  const rankOf = (f: SeasonFinish) => (mode === "ppg" ? f.ppgRank : f.totalRank);
  const ordered = finishes; // already chronological ascending

  // Summary: best finish (lowest rank) + season-over-season movement.
  const best = ordered.reduce((b, f) => (rankOf(f) < rankOf(b) ? f : b), ordered[0]);
  const last = ordered[ordered.length - 1];
  const prev = ordered.length >= 2 ? ordered[ordered.length - 2] : null;
  let movement: { dir: "up" | "down" | "flat"; text: string } | null = null;
  if (prev) {
    const a = rankOf(prev), z = rankOf(last);
    const verb = z < a ? "Improved" : z > a ? "Declined" : "Held steady";
    const dir = z < a ? "up" : z > a ? "down" : "flat";
    movement = dir === "flat"
      ? { dir, text: `Held steady at ${pos}${z} from ${prev.season} to ${last.season}` }
      : { dir, text: `${verb} from ${pos}${a} (${prev.season}) to ${pos}${z} (${last.season})` };
  }

  return (
    <Card className="p-4 sm:p-5">
      {/* Header + mode toggle */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-black text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#d4af37]" /> Season-End Finishes
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">PPR positional finishes by season.</p>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-muted/30 flex-shrink-0">
          {(["ppg", "total"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-testid={`finish-mode-${m}`}
              className={cn(
                "text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full transition-colors",
                mode === m ? "bg-[var(--sc-blue)] text-white dark-any:bg-[#d4af37]/20 dark-any:text-[#d4af37]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "ppg" ? "PPG Finish" : "Total Finish"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-1 mb-4 text-[11px]">
        <div className="font-semibold text-foreground">
          Best finish: <span className={FINISH_TIER_STYLE[finishTier(pos, rankOf(best))].text}>{pos}{rankOf(best)}</span> in {best.season} · {best.pprPpg} PPG
        </div>
        {movement && (
          <div className="flex items-center gap-1 text-muted-foreground">
            {movement.dir === "up" ? <TrendingUp className="w-3 h-3 text-emerald-500" />
              : movement.dir === "down" ? <TrendingDown className="w-3 h-3 text-rose-500" />
              : <ArrowRight className="w-3 h-3" />}
            {movement.text}
          </div>
        )}
      </div>

      {/* Timeline (horizontally scrollable) */}
      <div className="overflow-x-auto -mx-1 px-1" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="flex items-stretch gap-1.5 w-fit mx-auto py-1">
          {ordered.map((f, i) => {
            const rank = rankOf(f);
            const tier = finishTier(pos, rank);
            const style = FINISH_TIER_STYLE[tier];
            const next = ordered[i + 1];
            // Arrow direction reflects progression into the NEXT season.
            const arrowDir = next ? (rankOf(next) < rank ? "up" : rankOf(next) > rank ? "down" : "flat") : null;
            return (
              <Fragment key={f.season}>
                <div
                  data-testid={`finish-card-${f.season}`}
                  className={cn(
                    "flex-shrink-0 rounded-2xl border flex flex-col items-center text-center transition-all",
                    f.isCurrentSeason
                      ? "w-[124px] p-3.5 border-[#d4af37] bg-[#d4af37]/[0.06] ring-1 ring-[#d4af37]/40 shadow-[0_6px_20px_rgba(212,175,55,0.18)] -translate-y-0.5"
                      : "w-[108px] p-3 border-border bg-card",
                  )}
                >
                  <div className="flex items-center gap-1 h-4">
                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{f.season}</span>
                    {f.isCurrentSeason && (
                      <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-[#d4af37] text-[#0b1f3a]">Now</span>
                    )}
                  </div>
                  <div className={cn("font-black tabular-nums leading-none mt-1.5", f.isCurrentSeason ? "text-[26px]" : "text-[22px]", style.text)}>
                    {pos}{rank}
                  </div>
                  <div className="text-[11px] font-bold tabular-nums text-foreground mt-1">{f.pprPpg} <span className="text-[9px] font-medium text-muted-foreground">PPG</span></div>
                  <div className={cn("mt-1.5 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full", style.chip)}>{style.label}</div>
                </div>
                {next && (
                  <div className="flex items-center flex-shrink-0">
                    <ArrowRight className={cn(
                      "w-4 h-4",
                      arrowDir === "up" ? "text-emerald-500" : arrowDir === "down" ? "text-rose-500" : "text-muted-foreground/50",
                    )} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ProductionTab({ playerId, production, loading, pos }: { playerId: string | null; production: ProductionRow[] | null; loading: boolean; pos: string }) {
  const rows = production ?? [];
  const ppg = (v: number | null) => (v != null ? v.toFixed(1) : "—");
  const fin = (v: number | null) => (v != null ? `${pos}${v}` : "—");

  // Season-End Finishes timeline — built from the full-career production data so
  // EVERY ranked season shows, not just the last three. PPG mode uses the
  // server's ppgFinishPpr; rows lacking it fall back to the total finish.
  const seasonFinishes = useMemo<SeasonFinish[]>(() => {
    const r = production ?? [];
    const ranked = r.filter((x) => x.finishPpr != null && x.ppgPpr != null && (x.games ?? 0) > 0);
    if (!ranked.length) return [];
    const currentSeason = Math.max(...ranked.map((x) => Number(x.season)));
    return ranked
      .map((x) => {
        const season = Number(x.season);
        const games = x.games ?? 0;
        const ppgPpr = x.ppgPpr as number;
        return {
          season,
          position: pos as SeasonFinish["position"],
          pprPoints: Math.round(ppgPpr * games * 10) / 10,
          games,
          pprPpg: ppgPpr,
          totalRank: x.finishPpr as number,
          ppgRank: (x.ppgFinishPpr ?? x.finishPpr) as number,
          isCurrentSeason: season === currentSeason,
        };
      })
      .sort((a, b) => a.season - b.season);
  }, [production, pos]);

  return (
    <div className="space-y-6">
      {/* Season-End Finishes timeline — all ranked seasons. */}
      {loading && !production ? (
        <Card className="p-4 sm:p-5"><SkeletonLines n={3} /></Card>
      ) : seasonFinishes.length > 0 ? (
        <SeasonFinishesTimeline finishes={seasonFinishes} pos={pos} />
      ) : null}

      {loading && !production ? (
        <Card className="p-5"><SkeletonLines n={6} /></Card>
      ) : !rows.length ? (
        <ComingSoon icon={BarChart3} title="No production history" body={`Season production for this ${pos} will appear once it has qualifying NFL usage in our dataset.`} />
      ) : (
        <div className="space-y-4">
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left" rowSpan={2}>Season</th>
                    <th className="px-3 py-2 text-left" rowSpan={2}>Team</th>
                    <th className="px-3 py-2 text-right" rowSpan={2}>Games</th>
                    <th className="px-3 py-2 text-center border-l border-border/40" colSpan={2}>Standard</th>
                    <th className="px-3 py-2 text-center border-l border-border/40" colSpan={2}>Half-PPR</th>
                    <th className="px-3 py-2 text-center border-l border-border/40" colSpan={2}>PPR</th>
                  </tr>
                  <tr className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-1.5 text-right border-l border-border/40">PPG</th>
                    <th className="px-3 py-1.5 text-right">Finish</th>
                    <th className="px-3 py-1.5 text-right border-l border-border/40">PPG</th>
                    <th className="px-3 py-1.5 text-right">Finish</th>
                    <th className="px-3 py-1.5 text-right border-l border-border/40">PPG</th>
                    <th className="px-3 py-1.5 text-right">Finish</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <ProductionSeasonRow key={r.season} row={r} pos={pos} playerId={playerId} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border/40">Click a season to expand its weekly game log.</div>
          </Card>
        </div>
      )}
    </div>
  );
}

// Number of columns in the Production table — used for the expanded log row's colSpan.
const PRODUCTION_COLSPAN = 9;

// A single Production-table season row. Clicking it expands an inline row that
// lazily fetches and shows that season's weekly game log (regular + playoffs).
function ProductionSeasonRow({ row, pos, playerId }: { row: ProductionRow; pos: string; playerId: string | null }) {
  const season = Number(row.season);
  const canExpand = !!playerId && Number.isFinite(season);
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<GLRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || !canExpand || fetched.current) return;
    fetched.current = true;
    let cancelled = false;
    setLoading(true); setError(false);
    Promise.allSettled([
      fetchPlayerGameLogs(playerId!, season, "regular"),
      fetchPlayerGameLogs(playerId!, season, "post"),
    ])
      .then(([reg, post]) => {
        if (cancelled) return;
        if (reg.status === "rejected" && post.status === "rejected") {
          setError(true); setLogs(null); return;
        }
        const regRows: GLRow[] = reg.status === "fulfilled" ? reg.value.map((r) => ({ ...r, seasonType: "regular" })) : [];
        const postRows: GLRow[] = post.status === "fulfilled" ? post.value.map((r) => ({ ...r, seasonType: "post" })) : [];
        setLogs([...regRows, ...postRows]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, canExpand, playerId, season]);

  const ppg = (v: number | null) => (v != null ? v.toFixed(1) : "—");
  const fin = (v: number | null) => (v != null ? `${pos}${v}` : "—");

  return (
    <>
      <tr
        className={cn("border-b border-border/30", canExpand && "cursor-pointer hover:bg-muted/20")}
        onClick={() => canExpand && setOpen((o) => !o)}
        aria-expanded={canExpand ? open : undefined}
      >
        <td className="px-3 py-2.5 font-semibold text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !canExpand && "invisible", open ? "rotate-0" : "-rotate-90")} />
            {row.season}
          </span>
        </td>
        <td className="px-3 py-2.5 text-muted-foreground">{row.team}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{row.games ?? "—"}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(row.ppgStd)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(row.finishStd)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(row.ppgHalf)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(row.finishHalf)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(row.ppgPpr)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(row.finishPpr)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={PRODUCTION_COLSPAN} className="p-0 bg-muted/10 border-b border-border/30">
            <div className="px-3 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{row.season} Weekly Game Log</div>
              {loading && !logs ? (
                <SkeletonLines n={4} />
              ) : error ? (
                <EmptyBlock icon={ScrollText} text="Game logs are temporarily unavailable from Sleeper. Try again later." />
              ) : !logs || !logs.length ? (
                <EmptyBlock icon={ScrollText} text={`No weekly game logs for ${row.season}.`} />
              ) : (
                <WeeklyGameLogTable logs={logs} pos={pos} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── 2025 Player Rank Snapshot ──────────────────────────────────────────────────
// Per-stat positional rankings (2025 only) shown as color-coded cards with a
// percentile bar and the players ranked just better/worse. Data + ranking come
// from playerAdvancedStats (buildRankCards); this is pure presentation.
// Tiers use the tool's established quality gradient (same as the ADP
// availability legend): emerald → white → gold → orange → rose.
const RANK_TIER_STYLE: Record<RankTier, { text: string; bar: string; hover: string }> = {
  elite:   { text: "text-emerald-600 dark-any:text-emerald-400", bar: "bg-emerald-500", hover: "hover:border-emerald-500/40" },
  great:   { text: "text-foreground",                            bar: "bg-foreground",  hover: "hover:border-foreground/30" },
  solid:   { text: "text-[#d4af37]",                             bar: "bg-[#d4af37]",   hover: "hover:border-[#d4af37]/45" },
  average: { text: "text-orange-600 dark-any:text-orange-400",   bar: "bg-orange-500",  hover: "hover:border-orange-500/40" },
  poor:    { text: "text-rose-600 dark-any:text-rose-400",       bar: "bg-rose-500",    hover: "hover:border-rose-500/40" },
};

// Map a "Top X%" value (lower = better) to a tier — inverse of the rank
// snapshot's percentile thresholds (90/75/55/35), kept in sync.
function metricTier(topPct: number): RankTier {
  if (topPct <= 10) return "elite";
  if (topPct <= 25) return "great";
  if (topPct <= 45) return "solid";
  if (topPct <= 65) return "average";
  return "poor";
}

const RANK_CATEGORY_LABEL: Record<"overview" | RankCategory, string> = {
  overview: "Overview", production: "Production", usage: "Usage", efficiency: "Efficiency", advanced: "Advanced",
};

function RankSnapshotCard({ card }: { card: RankCardData }) {
  const s = RANK_TIER_STYLE[card.tier];
  // "Top X%" = where the player's rank falls within the position field.
  const topPct = Math.max(1, Math.round((card.rank / card.total) * 100));
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3.5 flex flex-col transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.10)] dark-any:hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
        s.hover,
      )}
      data-testid={`rank-card-${card.key}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className={cn("text-[26px] font-black leading-none tabular-nums", s.text)}>#{card.rank}</span>
        <span className="text-[15px] font-black tabular-nums text-foreground">{card.value}</span>
      </div>
      <div className="text-[10px] mt-1">
        <span className={cn("font-bold", s.text)}>Top {topPct}%</span>
        <span className="text-muted-foreground"> · of {card.total} {card.position}s</span>
      </div>
      <div className="text-[11px] font-bold text-foreground mt-2.5 leading-tight">{card.label}</div>
      <div className="mt-2 h-1.5 rounded-full bg-muted/50 dark-any:bg-white/8 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", s.bar)} style={{ width: `${card.percentile}%` }} />
      </div>
      <div className="mt-2.5 space-y-0.5 text-[10px] text-muted-foreground leading-snug">
        {card.behindPlayer && <div className="truncate"><span className="text-muted-foreground/60">Behind:</span> {card.behindPlayer}</div>}
        {card.aheadPlayer && <div className="truncate"><span className="text-muted-foreground/60">Ahead of:</span> {card.aheadPlayer}</div>}
      </div>
    </div>
  );
}

function PlayerRankSnapshot({ cards, pos }: { cards: RankCardData[]; pos: string }) {
  const categories = useMemo(() => {
    const present = new Set(cards.map((c) => c.category));
    return (["production", "usage", "efficiency", "advanced"] as RankCategory[]).filter((c) => present.has(c));
  }, [cards]);
  const [active, setActive] = useState<"overview" | RankCategory>("overview");
  const tabs: ("overview" | RankCategory)[] = ["overview", ...categories];
  const visible = active === "overview" ? cards.filter((c) => c.overview) : cards.filter((c) => c.category === active);

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-base font-black text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#d4af37]" /> 2025 Player Rank Snapshot
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          How this {pos} ranks among qualifying {pos}s in 2025.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {tabs.map((t) => {
          const isActive = active === t;
          return (
            <button
              key={t}
              onClick={() => setActive(t)}
              data-testid={`rank-tab-${t}`}
              className={cn(
                "text-[11px] font-bold px-3 py-1 rounded-full border transition-colors",
                isActive
                  ? "bg-[var(--sc-blue)] text-white border-[var(--sc-blue)] dark-any:bg-[#d4af37]/15 dark-any:text-[#d4af37] dark-any:border-[#d4af37]/35"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
              )}
            >
              {RANK_CATEGORY_LABEL[t]}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {visible.map((c) => <RankSnapshotCard key={c.key} card={c} />)}
      </div>
    </Card>
  );
}

// ── Grouped advanced-stat sections (QB / RB / WR / TE) ────────────────────────
// Section grouping comes straight from the research module's single source of
// truth (advancedStatsMeta.groupColumns), so headers + which stats fall under
// them stay in lockstep with the Position Stats tab. Rendered as labeled value
// cards (same visual family as the rank-snapshot cards below).

// Section icon by group label. Sections never overlap within a single position,
// so a few icons are reused across positions; the colour is the research
// module's per-section accent.
const SECTION_ICONS: Record<string, LucideIcon> = {
  "Usage / Workload": Activity,
  "Usage/Role": Activity,
  "Volume / Usage": Activity,
  Production: TrendingUp,
  Efficiency: Target,
  Hands: Target,
  Aggressiveness: Sparkles,
  Elusiveness: Sparkles,
  "Explosive Play Ability": Zap,
  Explosiveness: Zap,
  "Contact & Tackle Breaking": Shield,
  "Pressure & Pocket": Shield,
  "Ball Security / Negative Plays": AlertTriangle,
};

// Groups surfaced elsewhere (composites → the Metric Scores card) or that aren't
// real stats (identity columns) — skipped here to avoid duplication.
const SKIP_SECTIONS = new Set(["Composite Grades", "Player Info", "Other"]);

// Fuller labels than the research module's terse column headers (e.g. "RZ Opp"),
// shared across positions. Falls back to the column's own label when unmapped.
const STAT_LABELS: Record<string, string> = {
  // shared / RB
  snapPct: "Snap %", routes: "Routes", rushAttempts: "Rush Att",
  redZoneOpportunities: "Redzone Opportunities", goalLineCarries: "Goal Line Carries",
  targets: "Targets", targetSharePct: "Target Share %", receptions: "Receptions",
  redZoneTargets: "Redzone Targets", endZoneTargets: "Endzone Targets",
  rushYards: "Rush Yards", yardsPerCarry: "Yards / Carry", rushTouchdowns: "Rush TDs",
  receivingYards: "Receiving Yards", yardsPerReception: "Yards / Reception",
  receivingYardsAfterCatch: "Receiving YAC", yardsPerRouteRun: "Yards / Route Run",
  receivingTouchdowns: "Receiving TDs", epaPerPlay: "EPA / Play", successRate: "Success %",
  rushes10Plus: "Rushes 10+ Yds", rushes20Plus: "Rushes 20+ Yds", rushes30Plus: "Rushes 30+ Yds",
  rushes40Plus: "Rushes 40+ Yds", rushes50Plus: "Rushes 50+ Yds",
  explosiveRunPct: "Explosive Run %", breakawayRunPct: "Breakaway Run %",
  longestRush: "Longest Rush", longestRushTouchdown: "Longest Rush TD",
  brokenTackles: "Broken Tackles", rushAttemptsPerBrokenTackle: "Rush Att / Broken Tackle",
  yardsBeforeContactPerAttempt: "Yards Before Contact / Att",
  yardsAfterContactPerAttempt: "Yards After Contact / Att", tackleEludedRate: "Tackles Eluded %",
  fumbles: "Fumbles", tacklesForLoss: "Tackles For Loss", tacklesForLossYards: "Tackles For Loss Yards",
  rushAttForNegativeYards: "Rush Att for Negative Yards",
  // WR / TE
  routePct: "Route %", targetsPerRouteRun: "Targets / Route Run",
  airYardsPerTarget: "Air Yards / Target", airYardsPerReception: "Air Yards / Reception",
  airYardsSharePct: "Air Yards Share %", wopr: "WOPR",
  yardsBeforeCatchPerReception: "Yards Before Catch / Rec",
  yardsAfterCatchPerReception: "Yards After Catch / Rec",
  catchPct: "Catch %", catchableTargets: "Catchable Targets", drops: "Drops", dropPct: "Drop %",
  interceptionsWhenTargeted: "INTs When Targeted", avoidedTackleRate: "Avoided Tackle %",
  receptions10Plus: "Receptions 10+ Yds", receptions20Plus: "Receptions 20+ Yds",
  receptions30Plus: "Receptions 30+ Yds", receptions40Plus: "Receptions 40+ Yds",
  receptions50Plus: "Receptions 50+ Yds", longestReception: "Longest Reception",
  // QB
  attempts: "Attempts", completions: "Completions", passingYards: "Passing Yards",
  airYards: "Air Yards", completedAirYards: "Completed Air Yards", redZoneAttempts: "Redzone Attempts",
  passingTouchdowns: "Passing TDs", airYardsPerAttempt: "Air Yards / Attempt",
  completedAirYardsPerCompletion: "Comp. Air Yards / Comp", yardsPerCatch: "Yards / Completion",
  completionPct: "Completion %", onTargetPct: "On-Target %", poorThrows: "Poor Throws",
  badThrowPct: "Bad Throw %", interceptions: "Interceptions", cpoe: "CPOE",
  passes10Plus: "Passes 10+ Yds", passes20Plus: "Passes 20+ Yds", passes30Plus: "Passes 30+ Yds",
  passes40Plus: "Passes 40+ Yds", passes50Plus: "Passes 50+ Yds", longestPass: "Longest Pass",
  deepAttemptPct: "Deep Attempt %", pocketTime: "Pocket Time", timeToThrow: "Time to Throw",
  throwaways: "Throwaways", battedPasses: "Batted Passes", scrambleRate: "Scramble %",
  yardsPerScramble: "Yards / Scramble", hurries: "Hurries", blitzes: "Blitzes",
  knockdowns: "Knockdowns", sacks: "Sacks", sackYardsLost: "Sack Yards Lost", pressurePct: "Pressure %",
};

// One grouped advanced-stat section — collapsed by default, expands on click.
function AdvancedStatSection({ section, latest, pos, statRanks }: {
  section: { label: string; accent: string; cols: ColDef[] };
  latest: PlayerSeasonStats;
  pos: string;
  statRanks: Record<string, StatRank>;
}) {
  const [open, setOpen] = useState(false);
  const Icon = SECTION_ICONS[section.label] ?? BarChart3;
  return (
    <Card className="p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`adv-section-toggle-${section.label}`}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <h3 className="text-base font-black text-foreground flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: section.accent }} /> {section.label}
        </h3>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 mt-3">
          {section.cols.map((c) => {
            const value = fmtStat(latest.row[c.key], c.type);
            const label = STAT_LABELS[c.key] ?? c.label;
            const r = statRanks[c.key];
            // Rank-snapshot styling (rank + Top %), minus the bar and the
            // behind/ahead neighbor lines. Falls back to value-only when the
            // player isn't ranked for this stat (unqualified / sparse pool).
            if (!r) {
              return (
                <div key={c.key} className="rounded-xl border border-border bg-card p-3.5 flex flex-col">
                  <div className="text-[22px] font-black leading-none tabular-nums text-foreground">{value}</div>
                  <div className="text-[11px] font-bold text-muted-foreground mt-2.5 leading-tight uppercase tracking-wider">{label}</div>
                </div>
              );
            }
            const s = RANK_TIER_STYLE[r.tier];
            const topPct = Math.max(1, Math.round((r.rank / r.total) * 100));
            return (
              <div key={c.key} className="rounded-xl border border-border bg-card p-3.5 flex flex-col">
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn("text-[26px] font-black leading-none tabular-nums", s.text)}>#{r.rank}</span>
                  <span className="text-[15px] font-black tabular-nums text-foreground">{value}</span>
                </div>
                <div className="text-[10px] mt-1">
                  <span className={cn("font-bold", s.text)}>Top {topPct}%</span>
                  <span className="text-muted-foreground"> · of {r.total} {pos}s</span>
                </div>
                <div className="text-[11px] font-bold text-foreground mt-2.5 leading-tight">{label}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AdvancedStatSections({ latest, pos, statRanks }: { latest: PlayerSeasonStats; pos: string; statRanks: Record<string, StatRank> }) {
  const sp = pos.toLowerCase();
  const sections = useMemo(() => {
    if (!["qb", "rb", "wr", "te"].includes(sp)) return [];
    return groupColumns(sp as StatPosition, latest.columns as unknown as ColDef[]).filter(
      (g) => !SKIP_SECTIONS.has(g.label) && g.cols.length > 0,
    );
  }, [sp, latest]);
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((sec) => (
        <AdvancedStatSection key={sec.label} section={sec} latest={latest} pos={pos} statRanks={statRanks} />
      ))}
    </>
  );
}

// ── Advanced Stats ────────────────────────────────────────────────────────────
function AdvancedTab({ adv, advLoading, pos }: { adv: PlayerAdvancedResult | null; advLoading: boolean; pos: string }) {
  if (advLoading) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!adv?.latest) {
    return <ComingSoon icon={Layers} title="No advanced stats available" body={`Advanced metrics for this ${pos} will appear once it has qualifying NFL usage in our dataset.`} />;
  }
  const composites = adv.composites;
  const latest = adv.latest;
  return (
    <div className="space-y-4">
      {adv.rankCards.length > 0 && <PlayerRankSnapshot cards={adv.rankCards} pos={pos} />}

      {/* StatChasers 2025 Metric Scores — role metrics shown as positional ranks. */}
      <Card className="p-4 sm:p-5">
        <div className="mb-3">
          <h3 className="text-base font-black text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#d4af37]" /> StatChasers 2025 Metric Scores
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Where this {pos} ranks among qualifying {pos}s on each role-based metric.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
          {composites.map((c) => {
            const tierText = c.percentile != null ? RANK_TIER_STYLE[metricTier(c.percentile)].text : "text-muted-foreground";
            return (
              <div key={c.label} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{c.label}</div>
                  <div className={cn("text-2xl font-black tabular-nums leading-none", tierText)}>
                    {c.rank != null ? `${pos}${c.rank}` : "—"}
                  </div>
                </div>
                {c.percentile != null && c.rank != null && c.total != null ? (
                  <div className="mt-1.5 text-[11px] font-semibold">
                    <span className={cn("font-bold", tierText)}>Top {c.percentile}%</span>
                    <span className="text-foreground/55"> · of {c.total} {pos}s</span>
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11px] text-muted-foreground/60">Not enough data</div>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground leading-snug">{c.explanation}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Grouped advanced-stat sections (Usage, Production, Explosive, etc.),
          driven by the research module's column grouping for this position. */}
      <AdvancedStatSections latest={latest} pos={pos} statRanks={adv.statRanks} />
    </div>
  );
}

// ── ADP (draft cost over the last 3 years + P(available) by pick) ────────────
// "2025-08" → "Q3 '25"; returns the input unchanged on a format mismatch.
function fmtAdpQuarter(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const q = Math.floor((parseInt(m[2], 10) - 1) / 3) + 1;
  return `Q${q} '${m[1].slice(2)}`;
}

// Collapse the monthly ADP series into 3-month (calendar quarter) buckets so
// the 36-month trend reads as ~12 points instead of up to 36. Each bucket's
// avgPick is weighted by that month's pick count; counts are summed. The
// representative `month` is the first month of the quarter so existing
// "YYYY-MM" formatting keeps working.
function toQuarterlyAdp(monthly: { month: string; avgPick: number; count: number }[]): { month: string; avgPick: number; count: number }[] {
  const buckets = new Map<string, { firstMonth: string; weighted: number; count: number }>();
  for (const m of monthly) {
    const parsed = /^(\d{4})-(\d{2})$/.exec(m.month);
    if (!parsed) continue;
    const year = parsed[1];
    const monthNo = parseInt(parsed[2], 10);
    const q = Math.floor((monthNo - 1) / 3); // 0..3
    const key = `${year}-Q${q}`;
    const firstMonth = `${year}-${String(q * 3 + 1).padStart(2, "0")}`;
    const w = m.count > 0 ? m.count : 1;
    const cur = buckets.get(key);
    if (cur) {
      cur.weighted += m.avgPick * w;
      cur.count += w;
    } else {
      buckets.set(key, { firstMonth, weighted: m.avgPick * w, count: w });
    }
  }
  return Array.from(buckets.values())
    .sort((a, z) => a.firstMonth.localeCompare(z.firstMonth))
    .map((b) => ({ month: b.firstMonth, avgPick: b.weighted / b.count, count: b.count }));
}

// Tailwind classes for an availability cell, keyed by P(available) bucket.
function availabilityClass(pct: number): string {
  if (pct < 10) return "bg-rose-500/20 text-rose-600 dark-any:text-rose-300";
  if (pct < 30) return "bg-orange-500/20 text-orange-600 dark-any:text-orange-300";
  if (pct < 60) return "bg-[#d4af37]/20 text-[#d4af37]";
  if (pct < 85) return "bg-teal-500/20 text-teal-600 dark-any:text-teal-300";
  return "bg-emerald-500/20 text-emerald-600 dark-any:text-emerald-300";
}

// A compact segmented toggle used by the ADP filter bar.
function Segmented<T extends string | number>({ label, value, options, onChange, testid }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testid: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={testid}>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-lg border border-border bg-muted/20 p-0.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={cn(
              "px-2.5 py-1 text-xs font-bold rounded-md transition-colors",
              value === o.value ? "bg-[#d4af37] text-black" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`${testid}-${o.value}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Shared filter bar for the ADP tab — drives both the ADP Over Time trend and
// the per-pick availability grid (league shape: SF/1QB, scoring, TEP, teams).
function AdpFilterBar({ filters, onChange }: { filters: AdpProfileFilters; onChange: (f: AdpProfileFilters) => void }) {
  const set = (patch: Partial<AdpProfileFilters>) => onChange({ ...filters, ...patch });
  return (
    <Card className="p-3" data-testid="adp-filter-bar">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Segmented label="QB" value={filters.superflex} testid="adp-filter-sf"
          options={[{ value: "no", label: "1QB" }, { value: "yes", label: "SF" }]}
          onChange={(v) => set({ superflex: v })} />
        <Segmented label="Scoring" value={filters.scoring} testid="adp-filter-scoring"
          options={[{ value: "ppr", label: "PPR" }, { value: "half", label: "Half" }, { value: "standard", label: "Std" }]}
          onChange={(v) => set({ scoring: v })} />
        <Segmented label="TE Premium" value={filters.tePremium} testid="adp-filter-tep"
          options={[{ value: "no", label: "No TEP" }, { value: "yes", label: "TEP" }]}
          onChange={(v) => set({ tePremium: v })} />
        <Segmented label="Teams" value={filters.teams} testid="adp-filter-teams"
          options={[{ value: 10, label: "10" }, { value: 12, label: "12" }]}
          onChange={(v) => set({ teams: v })} />
      </div>
    </Card>
  );
}

function AdpTab({ history, avail, loading, error, pos, filters, onFiltersChange }: {
  history: PlayerAdpHistory | null;
  avail: PlayerAdpAvailability | null;
  loading: boolean;
  error: boolean;
  pos: string;
  filters: AdpProfileFilters;
  onFiltersChange: (f: AdpProfileFilters) => void;
}) {
  const quarterly = history ? toQuarterlyAdp(history.monthly) : [];
  const hasHistory = quarterly.length >= 2;
  const hasAvail = !!avail && avail.totalDrafts > 0;

  const b = (w: "7d" | "30d" | "90d") => history?.buckets.find((x) => x.window === w)?.avgPick ?? null;

  // Trend summary chips (only meaningful when hasHistory). "Current" prefers the
  // freshest windowed average, falling back to the latest quarter; the 3-year
  // change compares the oldest quarter to now (positive = drafted earlier now).
  const firstQ = quarterly[0];
  const lastQ = quarterly[quarterly.length - 1];
  const currentAdp = b("7d") ?? b("30d") ?? b("90d") ?? lastQ?.avgPick ?? null;
  const bestQ = hasHistory ? quarterly.reduce((bq, q) => (q.avgPick < bq.avgPick ? q : bq), quarterly[0]) : null;
  const totalSamples = quarterly.reduce((s, q) => s + q.count, 0);
  const threeYrChange = hasHistory && currentAdp != null ? firstQ.avgPick - currentAdp : null; // + ⇒ earlier now
  const changeUp = threeYrChange != null && threeYrChange > 0.5;
  const changeDown = threeYrChange != null && threeYrChange < -0.5;
  const changeSpots = threeYrChange != null ? Math.round(Math.abs(threeYrChange)) : 0;
  const changeChip = threeYrChange == null ? "—" : !changeUp && !changeDown ? "Flat" : `${changeUp ? "▲" : "▼"} ${changeSpots} ${changeUp ? "earlier" : "later"}`;

  const teams = avail?.teams ?? filters.teams;
  const cellsByRound = new Map<number, PlayerAdpAvailabilityCell[]>();
  if (avail) for (const c of avail.cells) {
    if (!cellsByRound.has(c.round)) cellsByRound.set(c.round, []);
    cellsByRound.get(c.round)!.push(c);
  }
  const expectedPickNo = avail?.expectedPick != null ? Math.round(avail.expectedPick) : null;
  const fmtSlot = (pickNo: number) => `${Math.ceil(pickNo / teams)}.${String(((pickNo - 1) % teams) + 1).padStart(2, "0")}`;

  // Trim trailing all-zero rounds so an early-round player shows one tidy round
  // instead of R2–R6 full of 0%. Columns (picks 1..teams) are always kept.
  const allRounds = Array.from(cellsByRound.keys()).sort((a, z) => a - z);
  let lastNonZeroIdx = -1;
  allRounds.forEach((round, idx) => {
    if ((cellsByRound.get(round) ?? []).some((c) => c.availabilityPct > 0)) lastNonZeroIdx = idx;
  });
  const shownRounds = lastNonZeroIdx === -1 ? [] : allRounds.slice(0, lastNonZeroIdx + 1);

  // Summary context: availability at the expected pick + last pick with a
  // meaningful (≥10%) chance the player is still on the board.
  const expectedAvailability = expectedPickNo != null && avail
    ? (avail.cells.find((c) => c.pickNo === expectedPickNo)?.availabilityPct ?? null)
    : null;
  let lastMeaningful: PlayerAdpAvailabilityCell | null = null;
  if (avail) for (const c of avail.cells) {
    if (c.availabilityPct >= 10 && (!lastMeaningful || c.pickNo > lastMeaningful.pickNo)) lastMeaningful = c;
  }
  const showHeatmap = hasAvail && shownRounds.length > 0;

  return (
    <div className="space-y-5">
      {/* Filters apply to both the ADP Over Time trend and the per-pick grid. */}
      <AdpFilterBar filters={filters} onChange={onFiltersChange} />

      {loading && !history && !avail ? (
        <Card className="p-5"><SkeletonLines n={6} /></Card>
      ) : error ? (
        <EmptyBlock icon={Target} text="ADP data is temporarily unavailable. Try again later." />
      ) : (!hasHistory && !hasAvail) ? (
        <ComingSoon icon={Target} title="No ADP data for these filters" body={`No crawled startup drafts match this filter combo for this ${pos}. Try a more common setup, e.g. SF · PPR · TEP · 12-team.`} />
      ) : (
      <div className="space-y-5">
      <div className="text-[11px] text-muted-foreground">
        Based on crawled startup drafts · current season for averages, last 3 years for the trend.
      </div>

      {/* 3-year ADP trend */}
      <Card className="p-5">
        <SectionTitle icon={LineChart} title="ADP Over Time" />
        <div className="text-[11px] text-muted-foreground mb-3">
          Quarterly average · last 3 years · lower ADP = earlier drafted
        </div>
        {hasHistory ? (
          <>
            {/* Trend banner — instant read on the 3-year direction. */}
            {threeYrChange != null && (
              <div className="mb-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
                  changeUp ? "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400"
                    : changeDown ? "bg-rose-500/15 text-rose-600 dark-any:text-rose-400"
                    : "bg-muted text-muted-foreground",
                )}>
                  {changeUp ? <TrendingUp className="w-3.5 h-3.5" /> : changeDown ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                  {changeUp ? `Trending up · drafted ${changeSpots} spot${changeSpots === 1 ? "" : "s"} earlier over 3 yrs`
                    : changeDown ? `Trending down · drafted ${changeSpots} spot${changeSpots === 1 ? "" : "s"} later over 3 yrs`
                    : "Flat over the last 3 years"}
                </span>
              </div>
            )}

            {/* Summary chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
              <AdpChip label="Current ADP" value={currentAdp != null ? currentAdp.toFixed(1) : "—"} tone="gold" />
              <AdpChip label="3-Year Change" value={changeChip} tone={changeUp ? "up" : changeDown ? "down" : "default"} />
              <AdpChip label="Best Quarter" value={bestQ ? fmtAdpQuarter(bestQ.month) : "—"} />
              <AdpChip label="Draft Samples" value={totalSamples.toLocaleString()} />
            </div>

            <AdpHistoryChart series={quarterly} />
            <div className="text-[10px] text-muted-foreground mt-2">
              Reversed axis. Higher on the chart means drafted earlier. Hover any point for its ADP, draft count, and change from the prior quarter.
            </div>
          </>
        ) : (
          <EmptyLine text="Not enough data yet, needs picks in at least two different quarters." />
        )}
      </Card>

      {/* Draft Availability Heatmap — only render when there's a non-zero round. */}
      {showHeatmap && (
      <Card className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-[#d4af37]" /> Draft Availability Heatmap
            </h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              Percent chance this player is still available when each pick is on the clock.
            </p>
          </div>
          <div className="text-[10px] text-muted-foreground text-right whitespace-nowrap flex-shrink-0 pt-0.5">
            {teams}-team · Seen in{" "}
            <span className="font-bold text-foreground tabular-nums">{avail!.draftsWithPlayer.toLocaleString()}</span>
            {" "}/ {avail!.totalDrafts.toLocaleString()} drafts
          </div>
        </div>

        {/* Two-column: summary pills (left) · heatmap (right) */}
        <div className="grid gap-5 mt-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-7 items-start">
          <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-1">
            <MetricCard label="Expected Pick" value={expectedPickNo != null ? fmtSlot(expectedPickNo) : "—"} accent />
            {expectedAvailability != null && (
              <MetricCard label={`Available at ${expectedPickNo != null ? fmtSlot(expectedPickNo) : "—"}`} value={`${Math.round(expectedAvailability)}%`} />
            )}
            {lastMeaningful && (
              <MetricCard label="10%+ Chance Until" value={fmtSlot(lastMeaningful.pickNo)} />
            )}
          </div>

          {/* Heatmap — fills the column on desktop, scrolls horizontally on mobile. */}
          <div className="overflow-x-auto pb-1.5" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="min-w-[560px] space-y-2">
              {/* Heading row */}
              <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `2.25rem repeat(${teams}, minmax(0, 1fr))` }}>
                <div className="text-[10px] font-bold text-muted-foreground text-center">Rd</div>
                {Array.from({ length: teams }, (_, i) => (
                  <div key={i} className="text-[10px] font-bold text-muted-foreground text-center tabular-nums">{i + 1}</div>
                ))}
              </div>
              {/* Round rows */}
              {shownRounds.map((round) => {
                const row = cellsByRound.get(round) ?? [];
                return (
                  <div key={round} className="grid gap-2 items-center" style={{ gridTemplateColumns: `2.25rem repeat(${teams}, minmax(0, 1fr))` }}>
                    <div className="text-[10px] font-bold text-muted-foreground text-center">R{round}</div>
                    {Array.from({ length: teams }, (_, i) => {
                      const cell = row.find((c) => c.pickInRound === i + 1);
                      if (!cell) return <div key={i} className="h-9 md:h-11" />;
                      const isExpected = expectedPickNo != null && cell.pickNo === expectedPickNo;
                      return (
                        <div
                          key={i}
                          className={cn(
                            "h-9 md:h-11 rounded-lg flex items-center justify-center text-[12px] md:text-[13px] font-extrabold tabular-nums",
                            availabilityClass(cell.availabilityPct),
                            isExpected && "ring-2 ring-[#d4af37] ring-offset-1 ring-offset-card !text-[#d4af37]",
                          )}
                          title={`Pick ${fmtSlot(cell.pickNo)} · ${cell.availabilityPct.toFixed(1)}% available`}
                        >
                          {Math.round(cell.availabilityPct)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-4 text-[10px] text-muted-foreground">
          <span>Likelihood still on the board:</span>
          {[["<10%", "bg-rose-500/40"], ["10–30%", "bg-orange-500/40"], ["30–60%", "bg-[#d4af37]/50"], ["60–85%", "bg-teal-500/40"], ["85%+", "bg-emerald-500/40"]].map(([label, cls]) => (
            <span key={label} className="flex items-center gap-1"><span className={cn("w-2.5 h-2.5 rounded-sm", cls)} />{label}</span>
          ))}
        </div>
      </Card>
      )}
      </div>
      )}
    </div>
  );
}

// A compact summary chip for the ADP trend (Current ADP, 3-Year Change, etc.).
function AdpChip({ label, value, tone = "default" }: { label: string; value: string; tone?: "gold" | "up" | "down" | "default" }) {
  const toneCls =
    tone === "gold" ? "text-[#d4af37]"
      : tone === "up" ? "text-emerald-600 dark-any:text-emerald-400"
      : tone === "down" ? "text-rose-600 dark-any:text-rose-400"
      : "text-foreground";
  return (
    <Card className={cn("p-3", tone === "gold" && "border-[#d4af37]/30 bg-[#d4af37]/5")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={cn("font-black tabular-nums mt-0.5 text-base sm:text-lg truncate", toneCls)}>{value}</div>
    </Card>
  );
}

// Catmull-Rom → cubic-bezier smoothing (mild tension, so the line is smooth but
// not balloon-y / overshooting). Returns an SVG path "d" string.
function smoothPath(p: [number, number][]): string {
  if (p.length === 0) return "";
  if (p.length === 1) return `M ${p[0][0]},${p[0][1]}`;
  let d = `M ${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const t = 1 / 6;
    d += ` C ${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t}` +
      ` ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t}` +
      ` ${p2[0]},${p2[1]}`;
  }
  return d;
}

// "Nice" round gridline values across a numeric domain.
function niceTicks(min: number, max: number, target = 4): number[] {
  const span = Math.max(1e-6, max - min);
  const step0 = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Theme-aware ADP line chart. Reversed Y-axis — a *lower* pick number is better,
// so earlier picks render toward the top. Rendered as an SVG sized to the
// measured container width (1:1 viewBox, no aspect-ratio distortion) so strokes
// and text stay crisp at any width.
function AdpHistoryChart({ series }: { series: { month: string; avgPick: number; count: number }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(680);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(Math.max(280, Math.round(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (series.length < 2) return null;

  const H = 240;
  const PAD_L = 38, PAD_R = 16, PAD_T = 16, PAD_B = 50;
  const plotW = w - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const baseY = PAD_T + plotH;

  const vals = series.map((p) => p.avgPick);
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const padV = Math.max(0.5, (rawMax - rawMin) * 0.15);
  const domMin = Math.max(1, rawMin - padV);
  const domMax = rawMax + padV;
  const dom = Math.max(0.5, domMax - domMin);

  const xAt = (i: number) => PAD_L + (i / (series.length - 1)) * plotW;
  const yAt = (v: number) => PAD_T + ((v - domMin) / dom) * plotH; // reversed: smaller v → higher
  const coords = series.map((p, i) => ({ ...p, i, x: xAt(i), y: yAt(p.avgPick) }));

  const linePath = smoothPath(coords.map((c) => [c.x, c.y] as [number, number]));
  const areaPath = `${linePath} L ${coords[coords.length - 1].x},${baseY} L ${coords[0].x},${baseY} Z`;
  const yTicks = niceTicks(domMin, domMax, 4);
  const maxCount = Math.max(...series.map((p) => p.count), 1);

  // Annotate only the meaningful points: first, last, best (min ADP), worst (max).
  const labelIdx = new Set([0, series.length - 1, vals.indexOf(rawMin), vals.indexOf(rawMax)]);

  const active = hover != null ? coords[hover] : null;
  const prev = hover != null && hover > 0 ? coords[hover - 1] : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block w-full select-none" role="img" aria-label="ADP over time">
        <defs>
          <linearGradient id="adpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d4af37" stopOpacity="0.22" />
            <stop offset="1" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines + Y ticks (reversed: low ADP at top) */}
        {yTicks.map((t) => {
          const y = yAt(t);
          return (
            <g key={t}>
              <line x1={PAD_L} y1={y} x2={w - PAD_R} y2={y} className="stroke-border" strokeOpacity={0.4} strokeWidth={1} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground tabular-nums" fontSize={10}>{t}</text>
            </g>
          );
        })}

        {/* Y-axis caption */}
        <text transform={`translate(11 ${PAD_T + plotH / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>ADP (lower = earlier)</text>

        {/* Per-quarter draft-volume bars (trust context) */}
        {coords.map((c) => {
          const bh = (c.count / maxCount) * 14;
          return <rect key={`v${c.i}`} x={c.x - 3} y={baseY + 9 - bh} width={6} height={bh} rx={1} fill="#d4af37" opacity={0.18} />;
        })}

        {/* Area + smooth line */}
        <path d={areaPath} fill="url(#adpFill)" />
        <path d={linePath} fill="none" stroke="#d4af37" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Points, sparse value labels, sparse x labels, hover hit-targets */}
        {coords.map((c) => {
          const isActive = hover === c.i;
          const showLabel = labelIdx.has(c.i);
          return (
            <g key={c.month}>
              {showLabel && (
                <text x={c.x} y={c.y - 9} textAnchor="middle" className="fill-foreground tabular-nums" fontSize={10} fontWeight={700}>{c.avgPick.toFixed(1)}</text>
              )}
              <circle cx={c.x} cy={c.y} r={isActive ? 5 : 3.2} fill="#d4af37" className="stroke-card" strokeWidth={isActive ? 2 : 0} />
              {showLabel && (
                <text x={c.x} y={H - 28} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{fmtAdpQuarter(c.month)}</text>
              )}
              <circle cx={c.x} cy={c.y} r={16} fill="transparent"
                onMouseEnter={() => setHover(c.i)}
                onMouseLeave={() => setHover((h) => (h === c.i ? null : h))} />
            </g>
          );
        })}
      </svg>

      {active && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{ left: `${(active.x / w) * 100}%`, top: `calc(${(active.y / H) * 100}% - 8px)` }}
        >
          <div className="rounded-md border border-border bg-popover text-popover-foreground px-2.5 py-1.5 shadow-md whitespace-nowrap">
            <div className="text-[11px] font-bold">{fmtAdpQuarter(active.month)}</div>
            <div className="text-[10px] text-muted-foreground">ADP <span className="font-semibold text-foreground tabular-nums">{active.avgPick.toFixed(1)}</span> · <span className="font-semibold text-foreground tabular-nums">{active.count.toLocaleString()}</span> draft{active.count === 1 ? "" : "s"}</div>
            {prev && (
              <div className="text-[10px] text-muted-foreground">
                Δ prior Q{" "}
                <span className={cn("font-semibold tabular-nums", active.avgPick < prev.avgPick ? "text-emerald-500" : active.avgPick > prev.avgPick ? "text-rose-500" : "text-foreground")}>
                  {active.avgPick - prev.avgPick >= 0 ? "+" : ""}{(active.avgPick - prev.avgPick).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Availability (Phase 3: cross-league exposure) ───────────────────────────
function AvailabilityTab({
  connected, exposure, loading,
}: {
  connected: boolean;
  exposure: PlayerLeagueExposure[] | null;
  loading: boolean;
}) {
  if (!connected) {
    return <ComingSoon icon={Users} title="Connect Sleeper" body="Connect your Sleeper username to see where this player is owned, available, or tradeable across your dynasty leagues." />;
  }
  if (loading && !exposure) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!exposure || !exposure.length) {
    return <EmptyBlock icon={Users} text="No leagues found for your account, or this player couldn't be located across them." />;
  }

  const owned = exposure.filter((e) => e.status === "owned");
  const opponent = exposure.filter((e) => e.status === "opponent");
  const available = exposure.filter((e) => e.status === "available");
  const order = { owned: 0, opponent: 1, available: 2 } as const;
  const rows = [...exposure].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Owned" value={`${owned.length}`} accent />
        <MetricCard label="Opponent" value={`${opponent.length}`} />
        <MetricCard label="Available" value={`${available.length}`} />
      </div>

      {/* Responsive league grid: 2 columns by default, 4 on large screens. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {rows.map((e) => (
          <div
            key={e.leagueId}
            data-testid={`availability-card-${e.leagueId}`}
            className="rounded-xl border border-border/50 bg-card p-3 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AvatarThumb src={e.leagueAvatar} alt={e.leagueName} fallback={e.leagueName} shape="rounded" />
              <span className="font-semibold text-foreground truncate text-sm">{e.leagueName}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0 pt-2 border-t border-border/30">
              {e.status === "available" ? (
                <span className="text-xs text-muted-foreground italic">Available</span>
              ) : (
                <>
                  <AvatarThumb src={e.managerAvatar} alt={e.status === "owned" ? "You" : e.manager || ""} fallback={e.status === "owned" ? "You" : e.manager || "?"} shape="circle" />
                  <span className="text-xs text-muted-foreground truncate">{e.status === "owned" ? "You" : e.manager || "—"}</span>
                  {e.status === "owned" && e.starter && (
                    <span className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground flex-shrink-0">Starter</span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Small image thumbnail (league crest / manager avatar) with an initials
// fallback when the source is missing or the CDN 404s.
function AvatarThumb({ src, alt, fallback, shape }: { src: string | null; alt: string; fallback: string; shape: "circle" | "rounded" }) {
  const [err, setErr] = useState(false);
  const initials = (fallback || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const radius = shape === "circle" ? "rounded-full" : "rounded-md";
  return (
    <span className={cn("flex-shrink-0 w-7 h-7 overflow-hidden ring-1 ring-border/50 bg-muted/40", radius)}>
      {src && !err ? (
        <img src={src} alt={alt} className="w-full h-full object-cover" onError={() => setErr(true)} />
      ) : (
        <span className="w-full h-full flex items-center justify-center text-[10px] font-bold text-muted-foreground">{initials}</span>
      )}
    </span>
  );
}

// ── Trades (Phase 4: trades involving this player across your leagues) ───────
function fmtTradeDate(ms: number): string {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "—"; }
}

function TradesTab({ trades, loading, valuesBySleeperId, playerName, leaguesScanned }: { trades: PlayerTradeRecord[] | null; loading: boolean; valuesBySleeperId: Record<string, number>; playerName: string; leaguesScanned: number | null }) {
  if (loading && !trades) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!trades || !trades.length) {
    return <EmptyBlock icon={Repeat2} text="No trades involving this player were found in the scanned leagues yet." />;
  }

  // "Most commonly traded for" = what the giver got back, aggregated.
  const freq = new Map<string, number>();
  for (const t of trades) for (const a of t.giverGot) freq.set(a.label, (freq.get(a.label) || 0) + 1);
  const common = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Stats banner — mirrors the Trade Database header */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-[#0b3a7a]/5 dark:bg-blue-400/5 border border-[#0b3a7a]/10 dark:border-blue-400/10">
        <Repeat2 className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm leading-snug">
          <span className="font-bold text-[#d4af37]">{trades.length.toLocaleString()}</span>
          <span className="text-muted-foreground"> trade{trades.length !== 1 ? "s" : ""} involving {playerName}{leaguesScanned != null ? ` across ${leaguesScanned.toLocaleString()} leagues scanned` : ""}</span>
        </p>
      </div>

      {common.length > 0 && (
        <Card className="p-4">
          <SectionTitle icon={Repeat2} title="Most Commonly Traded For" />
          <div className="flex flex-wrap gap-1.5">
            {common.map(([label, count]) => (
              <span key={label} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                {label}{count > 1 && <span className="text-muted-foreground">×{count}</span>}
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="mx-auto w-full max-w-[1100px] space-y-3">
        {trades.map((t, i) => (
          <PlayerTradeCard key={`${t.leagueId}-${t.timestamp}-${i}`} trade={t} valuesBySleeperId={valuesBySleeperId} />
        ))}
      </div>
    </div>
  );
}

// Trade card styled after the Trade Database tab: compact metadata header, a
// two-column body split by a centered swap-icon divider, photo avatars for
// players, and the league name in the footer. The profiled player's asset is
// highlighted in gold. Managers are intentionally omitted — the focus is on
// what this player was traded for.
function PlayerTradeCard({ trade: t, valuesBySleeperId }: { trade: PlayerTradeRecord; valuesBySleeperId: Record<string, number> }) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden bg-card/40 border-border/40",
        "transition-[border-color,background-color,transform] duration-200 ease-out",
        "hover:border-[#d4af37]/30 hover:-translate-y-px",
      )}
    >
      {/* Header: badge + date */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30 flex-wrap">
        <Badge variant="outline" className="h-[18px] px-1 text-[9px] font-bold uppercase tracking-wider leading-none">Trade</Badge>
        <span className="ml-auto text-[10px] text-muted-foreground/80 tabular-nums">{fmtTradeDate(t.timestamp)}</span>
      </div>

      {/* Body: two sides split by a centered swap icon */}
      <div className="relative px-3 py-2">
        <div
          className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 items-center justify-center w-[26px] h-[26px] rounded-full bg-card border border-[#d4af37]/25 shadow-[0_0_0_3px_rgba(212,175,55,0.03)]"
          aria-hidden="true"
        >
          <ArrowRightLeft className="w-3 h-3 text-[#d4af37]/80" />
        </div>
        <div className="grid gap-2 grid-cols-1 md:grid-cols-2 md:gap-x-8 md:divide-x md:divide-border/20">
          <TradeSide title="Acquired this player" assets={t.receiverGot} valuesBySleeperId={valuesBySleeperId} />
          <TradeSide title="Received in return" assets={t.giverGot} valuesBySleeperId={valuesBySleeperId} />
        </div>
      </div>

      {t.leagueName && (
        <p className="px-3 pb-1.5 text-[10px] text-muted-foreground/60 truncate">{t.leagueName}</p>
      )}
    </Card>
  );
}

function TradeSide({ title, assets, valuesBySleeperId }: { title: string; assets: PlayerTradeAsset[]; valuesBySleeperId: Record<string, number> }) {
  return (
    <div className="relative px-1 md:px-2">
      <div className="mb-1.5 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 truncate leading-tight">{title}</p>
      </div>
      <div className="space-y-px">
        {assets.length ? assets.map((a, i) =>
          a.kind === "player" ? (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 py-0.5 px-1 rounded-md",
                a.isThisPlayer && "bg-[#d4af37]/10 ring-1 ring-[#d4af37]/30",
              )}
            >
              <div className="min-w-0 flex-1">
                <PlayerAvatar id={a.sleeperId ?? ""} name={a.label} pos={a.pos ?? ""} team={a.team ?? ""} size="sm" />
              </div>
              <span className="text-[12px] font-bold tabular-nums text-[#d4af37] shrink-0">
                {fmtValue(a.sleeperId ? valuesBySleeperId[a.sleeperId] ?? null : null)}
              </span>
            </div>
          ) : (
            <div key={i} className="flex items-center gap-1.5 py-0.5 px-1">
              <span className="inline-flex items-center justify-center h-[18px] px-1 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border leading-none bg-purple-500/8 text-purple-400/90 border-purple-500/25">PK</span>
              <span className="text-[12px] font-medium text-foreground truncate">{a.label}</span>
            </div>
          ),
        ) : (
          <p className="text-[10px] text-muted-foreground italic">No assets recorded</p>
        )}
      </div>
    </div>
  );
}

// ── Game Log (Phase 5: weekly logs via cached backend) ───────────────────────

// Combined regular-season + playoff row. Sleeper returns playoff games as
// weeks 1–4 (Wild Card → Super Bowl), so we tag each row's seasonType to keep
// them distinct once merged into one list.
type GLRow = PlayerGameLogRow & { seasonType: "regular" | "post" };
const PLAYOFF_ROUND_LABELS: Record<number, string> = { 1: "WC", 2: "DIV", 3: "CONF", 4: "SB" };
function weekLabel(r: GLRow): string {
  if (r.seasonType === "post") return PLAYOFF_ROUND_LABELS[r.week] ?? `PO${r.week}`;
  return `${r.week}`;
}

interface GLCol { key: string; label: string; get: (r: GLRow) => string; gold?: boolean }
function gameLogColumns(pos: string): GLCol[] {
  const base: GLCol[] = [
    { key: "wk", label: "Wk", get: weekLabel },
    { key: "opp", label: "Opp", get: (r) => r.opponent ?? "—" },
    { key: "snap", label: "Snap%", get: (r) => (r.snapPct != null ? `${r.snapPct}%` : "—") },
  ];
  // Standard (non-PPR) scoring, to match the Production season table above.
  const fp: GLCol = { key: "fp", label: "FP", get: (r) => (r.ptsStd != null ? r.ptsStd.toFixed(1) : "—"), gold: true };
  if (pos === "QB") return [...base,
    { key: "ca", label: "C/A", get: (r) => `${r.passCmp}/${r.passAtt}` },
    { key: "payd", label: "Pa Yd", get: (r) => `${r.passYd}` },
    { key: "patd", label: "Pa TD", get: (r) => `${r.passTd}` },
    { key: "int", label: "INT", get: (r) => `${r.passInt}` },
    { key: "ruyd", label: "Ru Yd", get: (r) => `${r.rushYd}` },
    { key: "rutd", label: "Ru TD", get: (r) => `${r.rushTd}` },
    fp];
  if (pos === "RB") return [...base,
    { key: "att", label: "Att", get: (r) => `${r.rushAtt}` },
    { key: "ruyd", label: "Ru Yd", get: (r) => `${r.rushYd}` },
    { key: "rutd", label: "Ru TD", get: (r) => `${r.rushTd}` },
    { key: "tgt", label: "Tgt", get: (r) => `${r.tgt}` },
    { key: "rec", label: "Rec", get: (r) => `${r.rec}` },
    { key: "reyd", label: "Re Yd", get: (r) => `${r.recYd}` },
    fp];
  return [...base,
    { key: "tgt", label: "Tgt", get: (r) => `${r.tgt}` },
    { key: "rec", label: "Rec", get: (r) => `${r.rec}` },
    { key: "reyd", label: "Re Yd", get: (r) => `${r.recYd}` },
    { key: "retd", label: "Re TD", get: (r) => `${r.recTd}` },
    fp];
}

// Inner weekly game-log table (regular season + playoffs merged). Rendered
// inside an expanded Production season row.
function WeeklyGameLogTable({ logs, pos }: { logs: GLRow[]; pos: string }) {
  const cols = gameLogColumns(pos);
  const firstPostIdx = logs.findIndex((r) => r.seasonType === "post");
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            {cols.map((c) => (
              <th key={c.key} className={cn("px-2.5 py-2.5 whitespace-nowrap", c.key === "wk" || c.key === "opp" ? "text-left" : "text-right")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((r, i) => (
            <Fragment key={`${r.seasonType}-${r.week}`}>
              {i === firstPostIdx && (
                <tr className="bg-muted/40">
                  <td colSpan={cols.length} className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#d4af37]">Playoffs</td>
                </tr>
              )}
              <tr className={cn("border-b border-border/30", r.seasonType === "post" && "bg-[#0b3a7a]/5")}>
                {cols.map((c) => (
                  <td key={c.key} className={cn(
                    "px-2.5 py-2 whitespace-nowrap tabular-nums",
                    c.key === "wk" || c.key === "opp" ? "text-left text-foreground/85" : "text-right",
                    c.gold ? "text-[#d4af37] font-bold" : "text-foreground/80",
                    c.key === "wk" && "font-semibold text-foreground",
                  )}>{c.get(r)}</td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared building blocks ─────────────────────────────────────────────────────
function MetricCard({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <Card className={cn("p-3", accent && "border-[#d4af37]/30 bg-[#d4af37]/5")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={cn("font-black tabular-nums mt-0.5 truncate", small ? "text-sm" : "text-xl", accent ? "text-[#d4af37]" : "text-foreground")}>{value}</div>
    </Card>
  );
}

function SectionTitle({ icon: Icon, title, noMargin }: { icon: typeof Star; title: string; noMargin?: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5", noMargin ? "" : "mb-3")}>
      <Icon className="w-4 h-4 text-[#d4af37]" />
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground italic">{text}</p>;
}

function EmptyBlock({ icon: Icon, text }: { icon: typeof Activity; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-center">
      <Icon className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">{text}</p>
    </div>
  );
}

// Latest News — stored Rotowire headlines matched to this player. Headline +
// source + date + outbound link only (no article bodies); links open in a new
// tab. Clean empty state when nothing has been ingested for the player yet.
function NewsTab({ playerId }: { playerId: string | null }) {
  const [items, setItems] = useState<PlayerNewsItem[] | null>(null);

  useEffect(() => {
    if (!playerId) { setItems([]); return; }
    let cancelled = false;
    setItems(null);
    fetchPlayerNews(playerId, 8)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [playerId]);

  if (items === null) return <Card className="p-6"><SkeletonLines n={5} /></Card>;
  if (!items.length) {
    return <ComingSoon icon={Newspaper} title="No recent news found" body="The latest Rotowire headlines for this player will appear here as they're published." />;
  }

  const sourceLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtDate = (s: string | null) => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <Card className="divide-y divide-border/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-[#d4af37]" />
        <p className="text-sm font-bold text-foreground">Latest News</p>
      </div>
      {items.map((it) => {
        const date = fmtDate(it.publishedAt);
        return (
          <a
            key={it.id}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-3 hover:bg-muted/30 transition-colors group"
            data-testid={`player-news-${it.id}`}
          >
            <p className="text-sm font-semibold text-foreground group-hover:text-[#d4af37] transition-colors leading-snug">{it.title}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{sourceLabel(it.source)}</span>
              {date && <><span aria-hidden>·</span><span>{date}</span></>}
              <span className="ml-auto inline-flex items-center gap-1 text-[#d4af37]/80 group-hover:text-[#d4af37] whitespace-nowrap">
                View on {sourceLabel(it.source)} <ExternalLink className="w-3 h-3" />
              </span>
            </div>
          </a>
        );
      })}
    </Card>
  );
}

function ComingSoon({ icon: Icon, title, body }: { icon: typeof Activity; title: string; body: string }) {
  return (
    <Card className="p-10 text-center">
      <Icon className="w-7 h-7 text-muted-foreground/50 mx-auto mb-3" />
      <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">{body}</p>
    </Card>
  );
}

function SkeletonLines({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-3.5 rounded bg-muted/40 animate-pulse" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
      ))}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="max-w-[1200px] mx-auto px-4 py-5 space-y-5">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="w-full sm:w-[180px] h-[180px] bg-muted/40 animate-pulse" />
          <div className="flex-1 p-5 space-y-3">
            <div className="h-7 w-1/2 rounded bg-muted/40 animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-muted/30 animate-pulse" />
            <div className="flex gap-2 pt-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 w-20 rounded-lg bg-muted/30 animate-pulse" />)}
            </div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
      </div>
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading player…
      </div>
    </div>
  );
}

function NotFound({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  return (
    <div className="max-w-[700px] mx-auto px-4 py-16 text-center">
      <CircleUserRound className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
      <h2 className="text-lg font-bold text-foreground">Player not found</h2>
      <p className="text-sm text-muted-foreground mt-1">We couldn't find a player for <span className="font-mono">{playerId}</span> in the current data sources.</p>
      <button onClick={onBack} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0b3a7a] text-white text-sm font-semibold">
        <ArrowLeft className="w-4 h-4" /> Back to app
      </button>
    </div>
  );
}
