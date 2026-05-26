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
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  ChevronDown,
  CircleUserRound,
  Layers,
  LineChart,
  Loader2,
  Newspaper,
  Repeat2,
  ScrollText,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperPlayers, fetchSleeperLeagueFull, fetchPlayerExposure, fetchTradesForPlayer, fetchPlayerGameLogs, fetchPlayerAdpHistory, fetchPlayerAdpAvailability, type PlayerLeagueExposure, type PlayerTradeRecord, type PlayerTradeAsset, type PlayerGameLogRow, type PlayerAdpHistory, type PlayerAdpAvailability, type PlayerAdpAvailabilityCell, type AdpProfileFilters } from "@/lib/sleeperApi";

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
} from "@/lib/playerAdvancedStats";
import {
  dynastySnapshot,
  strengthsAndConcerns,
  similarPlayers,
  overallDynastyRank,
  valueTier,
  dynastyValueAnalysis,
  type SimilarPlayer,
  type DynastyValueAnalysis,
  type RecTone,
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
function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground/50";
  if (score >= 75) return "text-emerald-600 dark-any:text-emerald-400";
  if (score >= 50) return "text-[#d4af37]";
  return "text-muted-foreground";
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
  { id: "value", label: "Dynasty Value", icon: Trophy },
  { id: "adp", label: "ADP", icon: Target },
  { id: "trades", label: "Trades", icon: Repeat2 },
  { id: "availability", label: "Availability", icon: Users },
  { id: "news", label: "News", icon: Newspaper },
] as const;

// ── Page ───────────────────────────────────────────────────────────────────────
export default function PlayerPage({ params }: { params?: { playerId?: string } }) {
  const param = params?.playerId ?? "";
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<string>("overview");
  const { profile, adv, advLoading, exposure, exposureLoading, resolvedId, dbLoading, raw, valueModel, sleeper } = usePlayerPageData(param);

  // Trades are heavy to compute (per-league transaction scans) so they lazy-load
  // only when the Trades tab is first opened, and reset when the player changes.
  const [trades, setTrades] = useState<PlayerTradeRecord[] | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
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
    setAdpHistory(null);
    setAdpAvail(null);
    setAdpError(false);
    adpLoadedRef.current = null;
  }, [param]);

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
    () => (profile ? similarPlayers(valueModel.dynastyPlayerList, { id: profile.player.id, name: profile.player.name, pos: profile.player.pos, value: profile.values.dynasty }) : []),
    [profile, valueModel.dynastyPlayerList],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 h-12 flex items-center gap-3 px-4 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
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
        <div className="max-w-[1200px] mx-auto px-4 py-5 space-y-5">
          <Hero profile={profile} raw={raw} dynRank={dynRank} />

          {/* Sticky tab bar */}
          <div className="sticky top-12 z-20 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-border/50">
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    data-testid={`player-tab-${t.id}`}
                    className={cn(
                      "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors",
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

          {/* Content grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              {tab === "overview" && (
                <OverviewTab profile={profile} adv={adv} advLoading={advLoading} similar={similar} dynRank={dynRank} onOpenPlayer={(id) => setLocation(`/players/${id}`)} />
              )}
              {tab === "production" && <ProductionTab playerId={resolvedId} adv={adv} advLoading={advLoading} pos={profile.player.pos} />}
              {tab === "advanced" && <AdvancedTab adv={adv} advLoading={advLoading} pos={profile.player.pos} />}
              {tab === "value" && <DynastyValueTab profile={profile} adv={adv} dynRank={dynRank} />}
              {tab === "adp" && <AdpTab history={adpHistory} avail={adpAvail} loading={adpLoading} error={adpError} pos={profile.player.pos} filters={adpFilters} onFiltersChange={setAdpFilters} />}
              {tab === "trades" && <TradesTab trades={trades} loading={tradesLoading} valuesBySleeperId={valueModel.valuesBySleeperId} />}
              {tab === "availability" && (
                <AvailabilityTab
                  connected={sleeper.isConnected}
                  exposure={exposure}
                  loading={exposureLoading}
                />
              )}
              {tab === "news" && <ComingSoon icon={Newspaper} title="Player News" body="Beat reports, injury updates, and fantasy-impact analysis will appear here once the news feed is connected." />}
            </div>

            <Sidebar
              profile={profile}
              raw={raw}
              dynRank={dynRank}
              connected={sleeper.isConnected}
              exposure={exposure}
              exposureLoading={exposureLoading}
            />
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
      <div className="flex flex-col sm:flex-row">
        <HeroImage id={p.id} name={p.name} pos={p.pos} team={p.team} />
        <div className="flex-1 p-5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight text-foreground truncate" data-testid="player-page-name">{p.name}</h1>
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
    <div className={cn("relative w-full sm:w-[180px] h-[180px] flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#0b3a7a]/25 to-transparent", className)}>
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
      {/* Top metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Dynasty Value" value={fmtValue(profile.values.dynasty)} accent />
        <MetricCard label="Win-Now Value" value={fmtValue(profile.values.redraft)} />
        <MetricCard label="Dynasty Rank" value={dynRank ? `#${dynRank}` : "—"} />
        <MetricCard label="Position Rank" value={profile.ranks.dynastyPositional ? `${profile.player.pos}${profile.ranks.dynastyPositional}` : "—"} />
        <MetricCard label="Value Tier" value={valueTier(profile.values.dynasty)} small />
        <MetricCard label="Age" value={profile.player.age != null ? `${profile.player.age}` : "—"} />
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            {similar.map((s) => (
              <button
                key={s.sleeperId}
                onClick={() => onOpenPlayer(toPlayerSlug(s.name, s.team, s.pos))}
                className="group text-left rounded-xl border border-border bg-muted/20 hover:border-[#d4af37]/40 hover:bg-muted/40 transition-colors overflow-hidden"
                data-testid={`similar-player-${s.sleeperId}`}
              >
                <HeroImage
                  id={s.sleeperId}
                  name={s.name}
                  pos={s.pos}
                  team={s.team}
                  className="w-full sm:w-full h-28"
                  initialsClassName="text-3xl"
                  logoClassName="w-[120%] h-[120%] opacity-30"
                />
                <div className="p-3">
                  <div className="text-sm font-bold text-foreground truncate">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s.pos} · {s.team || "FA"} · Age {s.age}</div>
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
function ProductionTab({ playerId, adv, advLoading, pos }: { playerId: string | null; adv: PlayerAdvancedResult | null; advLoading: boolean; pos: string }) {
  const rows = adv?.production ?? [];
  const ppgVals = rows.filter((r) => r.ppgStd != null);
  const ppg = (v: number | null) => (v != null ? v.toFixed(1) : "—");
  const fin = (v: number | null) => (v != null ? `${pos}${v}` : "—");
  return (
    <div className="space-y-6">
      {advLoading ? (
        <Card className="p-5"><SkeletonLines n={6} /></Card>
      ) : !rows.length ? (
        <ComingSoon icon={BarChart3} title="No production history" body={`Season production for this ${pos} will appear once it has qualifying NFL usage in our dataset.`} />
      ) : (
        <div className="space-y-4">
          {ppgVals.length >= 2 && (
            <Card className="p-5">
              <SectionTitle icon={LineChart} title="Standard Fantasy PPG by Season" />
              <PpgChart rows={[...rows].reverse().map((r) => ({ season: r.season, ppg: r.ppgStd }))} />
            </Card>
          )}
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

function PpgChart({ rows }: { rows: { season: string; ppg: number | null }[] }) {
  const W = 600, H = 140, PAD = 28;
  const pts = rows.filter((r) => r.ppg != null) as { season: string; ppg: number }[];
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.ppg);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const coords = pts.map((p, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.ppg - min) / span) * (H - PAD * 2);
    return { x, y, ...p };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  // Thin the text labels so a long career (10+ seasons) doesn't overlap; always
  // keep the most recent season labelled. Dots still render for every season.
  const labelEvery = Math.ceil(pts.length / 8);
  const showLabel = (i: number) => i % labelEvery === 0 || i === pts.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke="#d4af37" strokeWidth={2} />
      {coords.map((c, i) => (
        <g key={c.season}>
          <circle cx={c.x} cy={c.y} r={3.5} fill="#d4af37" />
          {showLabel(i) && (
            <>
              <text x={c.x} y={c.y - 8} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={700}>{c.ppg.toFixed(1)}</text>
              <text x={c.x} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>{c.season}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

// ── Advanced Stats ────────────────────────────────────────────────────────────
function AdvancedTab({ adv, advLoading, pos }: { adv: PlayerAdvancedResult | null; advLoading: boolean; pos: string }) {
  const [showRaw, setShowRaw] = useState(false);
  if (advLoading) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!adv?.latest) {
    return <ComingSoon icon={Layers} title="No advanced stats available" body={`Advanced metrics for this ${pos} will appear once it has qualifying NFL usage in our dataset.`} />;
  }
  const composites = adv.composites;
  const latest = adv.latest;
  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">Based on {latest.season} season · ranked among qualifying {pos}s</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {composites.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className={cn("text-2xl font-black tabular-nums leading-none", scoreColor(c.score))}>{c.score ?? "—"}</div>
            </div>
            {c.percentile != null && c.rank != null && c.total != null ? (
              <div className="mt-1.5 text-[11px] font-semibold text-foreground/70">
                Top {c.percentile}% · {pos}{c.rank} of {c.total}
              </div>
            ) : (
              <div className="mt-1.5 text-[11px] text-muted-foreground/60">Not enough data</div>
            )}
            <div className="mt-2 text-[11px] text-muted-foreground leading-snug">{c.explanation}</div>
          </Card>
        ))}
      </div>

      {/* Raw advanced stats table (collapsible) */}
      <Card className="p-0 overflow-hidden">
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/20 transition-colors"
        >
          <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-[#d4af37]" /> Raw advanced stats ({latest.season})</span>
          <span className="text-xs text-muted-foreground">{showRaw ? "Hide" : "Show"}</span>
        </button>
        {showRaw && (
          <div className="border-t border-border/40">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border/30">
              {latest.columns
                .filter((c) => c.type !== "string" && !["rank", "playerId", "season"].includes(c.key))
                .map((c) => (
                  <div key={c.key} className="bg-card px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{c.label}</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">{fmtStat(latest.row[c.key], c.type)}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Dynasty Value (Phase 2: buy/sell/hold + age curve + fit) ─────────────────
const REC_TONE: Record<RecTone, string> = {
  "strong-buy": "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
  buy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
  hold: "border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]",
  "soft-sell": "border-orange-500/40 bg-orange-500/10 text-orange-600 dark-any:text-orange-400",
  sell: "border-rose-500/50 bg-rose-500/10 text-rose-600 dark-any:text-rose-400",
  contender: "border-sky-500/50 bg-sky-500/10 text-sky-600 dark-any:text-sky-300",
  avoid: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

function DynastyValueTab({ profile, adv, dynRank }: { profile: PlayerProfile; adv: PlayerAdvancedResult | null; dynRank: number | null }) {
  const prodScore = adv?.composites.find((c) => c.label === "Fantasy Production Score")?.score ?? null;
  const analysis = dynastyValueAnalysis({
    pos: profile.player.pos,
    age: profile.player.age,
    dynastyValue: profile.values.dynasty,
    redraftValue: profile.values.redraft,
    posRank: profile.ranks.dynastyPositional,
    prodScore,
    injuryStatus: profile.player.injuryStatus,
  });
  const rec = analysis.recommendation;

  return (
    <div className="space-y-4">
      {/* Recommendation */}
      <Card className="p-5">
        <SectionTitle icon={Trophy} title="Recommendation" />
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className={cn("inline-flex items-center justify-center rounded-xl border px-4 py-2 text-base font-black uppercase tracking-wide whitespace-nowrap", REC_TONE[rec.tone])}>
            {rec.badge}
          </span>
          <p className="text-sm leading-relaxed text-foreground/85">{rec.rationale}</p>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Dynasty Rank" value={dynRank ? `#${dynRank}` : "—"} />
        <MetricCard label="Position Rank" value={profile.ranks.dynastyPositional ? `${profile.player.pos}${profile.ranks.dynastyPositional}` : "—"} />
        <MetricCard label="Value Tier" value={valueTier(profile.values.dynasty)} small />
        <MetricCard label="Age" value={profile.player.age != null ? `${profile.player.age}` : "—"} />
      </div>

      {/* Age curve */}
      <Card className="p-5">
        <SectionTitle icon={LineChart} title="Age Curve" />
        <AgeCurve curve={analysis.ageCurve} pos={profile.player.pos} />
      </Card>

      {/* Insulation + fit */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FitCard title="Value Insulation" label={analysis.valueInsulation.label} note={analysis.valueInsulation.note} />
        <FitCard title="Contender Fit" label={analysis.contenderFit.label} note={analysis.contenderFit.note} />
        <FitCard title="Rebuilder Fit" label={analysis.rebuilderFit.label} note={analysis.rebuilderFit.note} />
      </div>
    </div>
  );
}

function AgeCurve({ curve, pos }: { curve: DynastyValueAnalysis["ageCurve"]; pos: string }) {
  const { minAge, maxAge, primeStart, primeEnd, age, band } = curve;
  const span = Math.max(1, maxAge - minAge);
  const pct = (a: number) => `${Math.min(100, Math.max(0, ((a - minAge) / span) * 100))}%`;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
        <span>{minAge}</span>
        <span className="font-semibold text-foreground/70">{band}{age != null ? ` · Age ${age}` : ""}</span>
        <span>{maxAge}</span>
      </div>
      <div className="relative h-3 rounded-full bg-muted/40 overflow-hidden">
        {/* prime window */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-500/30"
          style={{ left: pct(primeStart), width: `${((primeEnd - primeStart) / span) * 100}%` }}
        />
      </div>
      {age != null && (
        <div className="relative h-0">
          <div className="absolute -top-[18px] -translate-x-1/2 flex flex-col items-center" style={{ left: pct(age) }}>
            <div className="w-0.5 h-4 bg-[#d4af37]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#d4af37] ring-2 ring-background -mt-1" />
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40" /> Prime window ({primeStart}–{primeEnd})</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#d4af37]" /> {pos} age</span>
      </div>
    </div>
  );
}

function FitCard({ title, label, note }: { title: string; label: string; note: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="text-lg font-black text-foreground mt-0.5">{label}</div>
      <div className="text-[11px] text-muted-foreground leading-snug mt-1">{note}</div>
    </Card>
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
  const teams = avail?.teams ?? filters.teams;
  const cellsByRound = new Map<number, PlayerAdpAvailabilityCell[]>();
  if (avail) for (const c of avail.cells) {
    if (!cellsByRound.has(c.round)) cellsByRound.set(c.round, []);
    cellsByRound.get(c.round)!.push(c);
  }
  const expectedPickNo = avail?.expectedPick != null ? Math.round(avail.expectedPick) : null;
  const fmtSlot = (pickNo: number) => `${Math.ceil(pickNo / teams)}.${String(((pickNo - 1) % teams) + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-5">
      {/* Filters apply to both the ADP Over Time trend and the per-pick grid. */}
      <AdpFilterBar filters={filters} onChange={onFiltersChange} />

      {loading && !history && !avail ? (
        <Card className="p-5"><SkeletonLines n={6} /></Card>
      ) : error ? (
        <EmptyBlock icon={Target} text="ADP data is temporarily unavailable. Try again later." />
      ) : (!hasHistory && !hasAvail) ? (
        <ComingSoon icon={Target} title="No ADP data for these filters" body={`No crawled startup drafts match this filter combo for this ${pos}. Try a more common setup — e.g. SF · PPR · TEP · 12-team.`} />
      ) : (
      <div className="space-y-5">
      <div className="text-[11px] text-muted-foreground">
        Based on crawled startup drafts · current season for averages, last 3 years for the trend.
      </div>

      {/* Windowed average draft position */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="ADP · 7d" value={b("7d") != null ? b("7d")!.toFixed(1) : "—"} accent />
        <MetricCard label="ADP · 30d" value={b("30d") != null ? b("30d")!.toFixed(1) : "—"} />
        <MetricCard label="ADP · 90d" value={b("90d") != null ? b("90d")!.toFixed(1) : "—"} />
      </div>

      {/* 3-year ADP trend */}
      <Card className="p-5">
        <SectionTitle icon={LineChart} title="ADP Over Time" />
        <div className="text-[11px] text-muted-foreground mb-2">
          Quarterly average · last 3 years · lower = drafted earlier
          {hasHistory && (
            <> · <span className="font-bold text-foreground tabular-nums">{quarterly.length}</span> data points from <span className="font-bold text-foreground tabular-nums">{quarterly.reduce((sum, q) => sum + q.count, 0).toLocaleString()}</span> drafts</>
          )}
        </div>
        {hasHistory ? (
          <>
            <AdpHistoryChart series={quarterly} />
            <div className="text-[10px] text-muted-foreground mt-1">Hover a point to see its ADP and the number of drafts used for that quarter.</div>
          </>
        ) : (
          <EmptyLine text="Not enough data yet — needs picks in at least two different quarters." />
        )}
      </Card>

      {/* P(available) by pick */}
      <Card className="p-5">
        <SectionTitle icon={Target} title="Chance of Getting This Player by Pick" />
        {hasAvail ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground mb-3">
              <span>Expected pick <span className="font-bold text-foreground tabular-nums">{expectedPickNo != null ? fmtSlot(expectedPickNo) : "—"}</span></span>
              <span>Seen in <span className="font-bold text-foreground tabular-nums">{avail!.draftsWithPlayer.toLocaleString()}</span> / {avail!.totalDrafts.toLocaleString()} drafts</span>
              <span className="ml-auto">{teams}-team · % available when each pick is on the clock</span>
            </div>
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: "3px" }}>
                <thead>
                  <tr className="text-[10px] text-muted-foreground">
                    <th className="px-1 py-0.5 text-left font-semibold sticky left-0 bg-background z-10">Rd</th>
                    {Array.from({ length: teams }, (_, i) => (
                      <th key={i} className="px-1 py-0.5 text-center font-semibold tabular-nums w-9">{i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(cellsByRound.keys()).sort((a, z) => a - z).map((round) => {
                    const row = cellsByRound.get(round) ?? [];
                    return (
                      <tr key={round}>
                        <td className="px-1 py-0.5 text-[10px] font-semibold text-muted-foreground sticky left-0 bg-background z-10">R{round}</td>
                        {Array.from({ length: teams }, (_, i) => {
                          const cell = row.find((c) => c.pickInRound === i + 1);
                          if (!cell) return <td key={i} />;
                          const isExpected = expectedPickNo != null && cell.pickNo === expectedPickNo;
                          return (
                            <td key={i} className="p-0">
                              <div
                                className={cn(
                                  "rounded-[3px] h-8 w-9 flex items-center justify-center text-[11px] font-bold tabular-nums",
                                  availabilityClass(cell.availabilityPct),
                                  isExpected && "ring-2 ring-[#d4af37]",
                                )}
                                title={`Pick ${fmtSlot(cell.pickNo)} · ${cell.availabilityPct.toFixed(1)}% available`}
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
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-muted-foreground">
              <span>Likelihood still on the board:</span>
              {[["<10%", "bg-rose-500/40"], ["10–30%", "bg-orange-500/40"], ["30–60%", "bg-[#d4af37]/50"], ["60–85%", "bg-teal-500/40"], ["85%+", "bg-emerald-500/40"]].map(([label, cls]) => (
                <span key={label} className="flex items-center gap-1"><span className={cn("w-2.5 h-2.5 rounded-sm", cls)} />{label}</span>
              ))}
            </div>
          </>
        ) : (
          <EmptyLine text="No per-pick availability data for the current filters." />
        )}
      </Card>
      </div>
      )}
    </div>
  );
}

// Theme-aware ADP line chart. Y-axis is inverted vs PpgChart — a *lower* pick
// number is better, so earlier picks render toward the top.
function AdpHistoryChart({ series }: { series: { month: string; avgPick: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 150, PAD = 30;
  const pts = series;
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.avgPick);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const coords = pts.map((p, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    // Inverted: smallest avgPick (earliest) → top of the chart.
    const y = PAD + ((p.avgPick - min) / span) * (H - PAD * 2);
    return { x, y, ...p };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  // Label every Nth point so a long series doesn't overflow the axis.
  const labelEvery = Math.ceil(pts.length / 8);
  const active = hover != null ? coords[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[160px]" preserveAspectRatio="none">
        <polyline points={line} fill="none" stroke="#d4af37" strokeWidth={2} />
        {coords.map((c, i) => (
          <g key={c.month}>
            <circle cx={c.x} cy={c.y} r={hover === i ? 5 : 3} fill="#d4af37" />
            {i % labelEvery === 0 && (
              <>
                <text x={c.x} y={c.y - 7} textAnchor="middle" className="fill-foreground" fontSize={10} fontWeight={700}>{c.avgPick.toFixed(0)}</text>
                <text x={c.x} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{fmtAdpQuarter(c.month)}</text>
              </>
            )}
            {/* Wide transparent hit target so the count popup is easy to hover. */}
            <circle
              cx={c.x} cy={c.y} r={14} fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          </g>
        ))}
      </svg>
      {active && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{ left: `${(active.x / W) * 100}%`, top: `calc(${(active.y / H) * 100}% - 8px)` }}
        >
          <div className="rounded-md border border-border bg-popover text-popover-foreground px-2 py-1 shadow-md whitespace-nowrap">
            <div className="text-[11px] font-bold">{fmtAdpQuarter(active.month)}</div>
            <div className="text-[10px] text-muted-foreground">
              ADP <span className="font-semibold text-foreground tabular-nums">{active.avgPick.toFixed(1)}</span> · <span className="font-semibold text-foreground tabular-nums">{active.count.toLocaleString()}</span> draft{active.count === 1 ? "" : "s"}
            </div>
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

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left">League</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Manager</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.leagueId} className="border-b border-border/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarThumb src={e.leagueAvatar} alt={e.leagueName} fallback={e.leagueName} shape="rounded" />
                      <span className="font-semibold text-foreground truncate">{e.leagueName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><ExposureBadge status={e.status} starter={e.starter} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarThumb src={e.managerAvatar} alt={e.status === "owned" ? "You" : e.manager || ""} fallback={e.status === "owned" ? "You" : e.manager || "?"} shape="circle" />
                      <span className="text-muted-foreground truncate">{e.status === "owned" ? "You" : e.manager || "—"}</span>
                    </div>
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

function ExposureBadge({ status, starter }: { status: PlayerLeagueExposure["status"]; starter: boolean }) {
  const map = {
    owned: { text: "Owned", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400" },
    opponent: { text: "Opponent", cls: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark-any:text-sky-300" },
    available: { text: "Available", cls: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark-any:text-rose-300" },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold", map.cls)}>{map.text}</span>
      {status === "owned" && starter && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Starter</span>}
    </span>
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

function TradesTab({ trades, loading, valuesBySleeperId }: { trades: PlayerTradeRecord[] | null; loading: boolean; valuesBySleeperId: Record<string, number> }) {
  if (loading && !trades) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!trades || !trades.length) {
    return <EmptyBlock icon={Repeat2} text="No trades involving this player were found in your leagues yet." />;
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
          <span className="text-muted-foreground"> trade{trades.length !== 1 ? "s" : ""} involving this player across your leagues</span>
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

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({
  profile, raw, dynRank, connected, exposure, exposureLoading,
}: {
  profile: PlayerProfile;
  raw: any;
  dynRank: number | null;
  connected: boolean;
  exposure: PlayerLeagueExposure[] | null;
  exposureLoading: boolean;
}) {
  const p = profile.player;
  const meta: { label: string; value: string }[] = [
    { label: "Sleeper ID", value: p.id },
    { label: "Team", value: p.team || "FA" },
    { label: "Position", value: p.pos },
    { label: "Age", value: p.age != null ? `${p.age}` : "—" },
    { label: "Experience", value: p.yearsExp != null ? (p.yearsExp === 0 ? "Rookie" : `${p.yearsExp} yrs`) : (typeof raw?.years_exp === "number" ? `${raw.years_exp} yrs` : "—") },
  ];
  if (p.height) meta.push({ label: "Height", value: p.height });
  if (p.weight) meta.push({ label: "Weight", value: `${p.weight} lbs` });
  if (raw?.college) meta.push({ label: "College", value: String(raw.college) });
  if (raw?.number != null) meta.push({ label: "Jersey", value: `#${raw.number}` });

  return (
    <div className="space-y-4 lg:sticky lg:top-28">
      <Card className="p-4">
        <SectionTitle icon={CircleUserRound} title="Player Metadata" />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.label}</dt>
              <dd className="text-xs font-semibold text-foreground truncate">{m.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-4">
        <SectionTitle icon={Trophy} title="My Exposure" />
        {!connected ? (
          <p className="text-xs text-muted-foreground leading-relaxed">Connect Sleeper to see your exposure across leagues.</p>
        ) : exposureLoading && !exposure ? (
          <SkeletonLines n={3} />
        ) : exposure && exposure.length ? (
          <ExposureSummary exposure={exposure} />
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">No leagues found for your account.</p>
        )}
      </Card>
    </div>
  );
}

function ExposureSummary({ exposure }: { exposure: PlayerLeagueExposure[] }) {
  const owned = exposure.filter((e) => e.status === "owned").length;
  const opponent = exposure.filter((e) => e.status === "opponent").length;
  const available = exposure.filter((e) => e.status === "available").length;
  const rows: { label: string; value: number; cls: string }[] = [
    { label: "Owned", value: owned, cls: "text-emerald-600 dark-any:text-emerald-400" },
    { label: "Opponent-owned", value: opponent, cls: "text-sky-600 dark-any:text-sky-300" },
    { label: "Available", value: available, cls: "text-rose-600 dark-any:text-rose-300" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{r.label}</span>
          <span className={cn("font-bold tabular-nums", r.cls)}>{r.value} {r.value === 1 ? "league" : "leagues"}</span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs pt-1.5 mt-1 border-t border-border/40">
        <span className="text-muted-foreground">Total</span>
        <span className="font-bold tabular-nums text-foreground">{exposure.length} {exposure.length === 1 ? "league" : "leagues"}</span>
      </div>
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
