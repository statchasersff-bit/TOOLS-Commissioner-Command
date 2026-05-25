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
  BarChart3,
  ChevronDown,
  CircleUserRound,
  GitCompare,
  Layers,
  LineChart,
  Loader2,
  Newspaper,
  Repeat2,
  ScrollText,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperPlayers, fetchSleeperLeagueFull, fetchPlayerExposure, fetchTradesForPlayer, fetchPlayerGameLogs, type PlayerLeagueExposure, type PlayerTradeRecord, type PlayerTradeAsset, type PlayerGameLogRow } from "@/lib/sleeperApi";
import { resolvePlayerId, toPlayerSlug } from "@/lib/playerSlug";
import { getPlayerProfile, type PlayerProfile } from "@/lib/playerProfile";
import {
  loadPlayerAdvancedStats,
  type PlayerAdvancedResult,
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
import type { RankedPlayer } from "@/contexts/ValueModelContext";

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
    fetchPlayerExposure(userId, sleeper.leagues.map((l) => ({ leagueId: l.leagueId, name: l.name })), playerId)
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
  { id: "production", label: "Production", icon: BarChart3 },
  { id: "advanced", label: "Advanced Stats", icon: Layers },
  { id: "value", label: "Dynasty Value", icon: Trophy },
  { id: "trades", label: "Trades", icon: Repeat2 },
  { id: "availability", label: "Availability", icon: Users },
  { id: "news", label: "News", icon: Newspaper },
  { id: "compare", label: "Compare", icon: GitCompare },
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

  useEffect(() => {
    setTab("overview");
    window.scrollTo(0, 0);
    setTrades(null);
    tradesLoadedRef.current = null;
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
                <OverviewTab profile={profile} adv={adv} advLoading={advLoading} similar={similar} dynRank={dynRank} onOpenPlayer={(id) => setLocation(`/players/${id}`)} onCompare={() => setTab("compare")} />
              )}
              {tab === "production" && <ProductionTab playerId={resolvedId} adv={adv} advLoading={advLoading} pos={profile.player.pos} />}
              {tab === "advanced" && <AdvancedTab adv={adv} advLoading={advLoading} pos={profile.player.pos} />}
              {tab === "value" && <DynastyValueTab profile={profile} adv={adv} dynRank={dynRank} />}
              {tab === "trades" && <TradesTab trades={trades} loading={tradesLoading} />}
              {tab === "availability" && (
                <AvailabilityTab
                  connected={sleeper.isConnected}
                  exposure={exposure}
                  loading={exposureLoading}
                  activeLeagueId={sleeper.activeLeagueId}
                  onSetActive={(id) => sleeper.setActiveLeagueById(id)}
                />
              )}
              {tab === "news" && <ComingSoon icon={Newspaper} title="Player News" body="Beat reports, injury updates, and fantasy-impact analysis will appear here once the news feed is connected." />}
              {tab === "compare" && <CompareTab base={profile} baseAdv={adv} baseDynRank={dynRank} />}
            </div>

            <Sidebar
              profile={profile}
              raw={raw}
              dynRank={dynRank}
              connected={sleeper.isConnected}
              exposure={exposure}
              exposureLoading={exposureLoading}
              onCompare={() => setTab("compare")}
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
  const injured = p.injuryStatus && p.injuryStatus !== "Healthy" && p.injuryStatus.trim() !== "";

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
            </div>
          </div>

          <span className="block h-[2.5px] w-12 bg-[#d4af37] rounded-full my-3" />

          <div className="flex flex-wrap gap-2">
            <HeroBadge label="Dynasty Rank" value={dynRank ? `#${dynRank}` : "—"} />
            <HeroBadge label="Position Rank" value={profile.ranks.dynastyPositional ? `${p.pos}${profile.ranks.dynastyPositional}` : "—"} />
            {profile.ranks.redraftPositional && <HeroBadge label="Redraft Rank" value={`${p.pos}${profile.ranks.redraftPositional}`} />}
            <HeroBadge label="Value Tier" value={tier} accent />
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold",
              injured ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark-any:text-rose-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
            )}>
              <Activity className="w-3 h-3" />
              {injured ? p.injuryStatus : "Healthy"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroImage({ id, name, pos, team }: { id: string; name: string; pos: string; team?: string }) {
  const [err, setErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const synthetic = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  const initials = (name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");
  const showLogo = !!team && team !== "FA" && !logoErr;
  return (
    <div className="relative w-full sm:w-[180px] h-[180px] flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#0b3a7a]/25 to-transparent">
      {/* Faint team logo watermark — sits behind the player photo (visible in
          the gradient margins / behind the initials fallback). */}
      {showLogo && (
        <img
          src={`https://sleepercdn.com/images/team_logos/nfl/${team!.toLowerCase()}.png`}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 m-auto w-[85%] h-[85%] object-contain opacity-20 pointer-events-none select-none"
          onError={() => setLogoErr(true)}
        />
      )}
      {err || synthetic ? (
        <div className="relative w-full h-full flex items-center justify-center text-4xl font-black text-muted-foreground/50">{initials}</div>
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
  profile, adv, advLoading, similar, dynRank, onOpenPlayer, onCompare,
}: {
  profile: PlayerProfile;
  adv: PlayerAdvancedResult | null;
  advLoading: boolean;
  similar: SimilarPlayer[];
  dynRank: number | null;
  onOpenPlayer: (id: string) => void;
  onCompare: () => void;
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
        <div className="flex items-center justify-between">
          <SectionTitle icon={Users} title="Similar Dynasty Assets" noMargin />
          <button onClick={onCompare} className="text-[11px] font-semibold text-[#d4af37] hover:underline">Compare →</button>
        </div>
        {similar.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            {similar.map((s) => (
              <button
                key={s.sleeperId}
                onClick={() => onOpenPlayer(toPlayerSlug(s.name, s.team, s.pos))}
                className="text-left rounded-xl border border-border bg-muted/20 hover:border-[#d4af37]/40 hover:bg-muted/40 transition-colors p-3"
                data-testid={`similar-player-${s.sleeperId}`}
              >
                <div className="text-sm font-bold text-foreground truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.pos} · {s.team || "FA"} · Age {s.age}</div>
                <div className="text-xs font-bold text-[#d4af37] mt-1 tabular-nums">{fmtValue(s.value)}</div>
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
                    <tr key={r.season} className="border-b border-border/30">
                      <td className="px-3 py-2.5 font-semibold text-foreground">{r.season}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.team}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{r.games ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(r.ppgStd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(r.finishStd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(r.ppgHalf)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(r.finishHalf)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d4af37] font-bold border-l border-border/40">{ppg(r.ppgPpr)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/85">{fin(r.finishPpr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Weekly game logs — one collapsible row per season */}
      <div>
        <SectionTitle icon={ScrollText} title="Weekly Game Logs" />
        <GameLogTab playerId={playerId} pos={pos} />
      </div>
    </div>
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
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke="#d4af37" strokeWidth={2} />
      {coords.map((c) => (
        <g key={c.season}>
          <circle cx={c.x} cy={c.y} r={3.5} fill="#d4af37" />
          <text x={c.x} y={c.y - 8} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={700}>{c.ppg.toFixed(1)}</text>
          <text x={c.x} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>{c.season}</text>
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

// ── Availability (Phase 3: cross-league exposure) ───────────────────────────
function AvailabilityTab({
  connected, exposure, loading, activeLeagueId, onSetActive,
}: {
  connected: boolean;
  exposure: PlayerLeagueExposure[] | null;
  loading: boolean;
  activeLeagueId: string | null;
  onSetActive: (leagueId: string) => void;
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
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.leagueId} className="border-b border-border/30">
                  <td className="px-3 py-2.5 font-semibold text-foreground">{e.leagueName}</td>
                  <td className="px-3 py-2.5"><ExposureBadge status={e.status} starter={e.starter} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{e.status === "owned" ? "You" : e.manager || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    {activeLeagueId === e.leagueId ? (
                      <span className="text-[11px] font-bold text-[#d4af37]">Active</span>
                    ) : (
                      <button onClick={() => onSetActive(e.leagueId)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors">Set Active</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-muted-foreground/60">Deep links to propose trades and manage rosters from here arrive in a later phase.</p>
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

// ── Trades (Phase 4: trades involving this player across your leagues) ───────
function fmtTradeDate(ms: number): string {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "—"; }
}

function TradesTab({ trades, loading }: { trades: PlayerTradeRecord[] | null; loading: boolean }) {
  if (loading && !trades) return <Card className="p-5"><SkeletonLines n={6} /></Card>;
  if (!trades || !trades.length) {
    return <EmptyBlock icon={Repeat2} text="No trades involving this player were found in the trade database yet." />;
  }

  // "Most commonly traded for" = what the giver got back, aggregated.
  const freq = new Map<string, number>();
  for (const t of trades) for (const a of t.giverGot) freq.set(a.label, (freq.get(a.label) || 0) + 1);
  const common = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">{trades.length} trade{trades.length !== 1 ? "s" : ""} found in the trade database.</div>

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

      <div className="space-y-3">
        {trades.map((t, i) => (
          <Card key={`${t.leagueId}-${t.timestamp}-${i}`} className="p-4">
            <div className="flex items-center justify-between mb-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80 truncate">{t.leagueName}</span>
              <span className="flex-shrink-0">{fmtTradeDate(t.timestamp)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TradeSide title={t.receiver} subtitle="acquired" assets={t.receiverGot} />
              <TradeSide title={t.giver} subtitle="got back" assets={t.giverGot} />
            </div>
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/60">Trade calculator and find-partners links arrive in a later phase.</p>
    </div>
  );
}

function TradeSide({ title, subtitle, assets }: { title: string; subtitle: string; assets: PlayerTradeAsset[] }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="text-xs font-bold text-foreground truncate">{title}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">{subtitle}</div>
      <div className="flex flex-wrap gap-1">
        {assets.length ? assets.map((a, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium border",
              a.isThisPlayer
                ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]"
                : a.kind === "pick"
                  ? "border-purple-500/30 bg-purple-500/10 text-purple-600 dark-any:text-purple-300"
                  : "border-border bg-card text-foreground/85",
            )}
          >
            {a.label}
          </span>
        )) : <span className="text-[11px] text-muted-foreground/60 italic">—</span>}
      </div>
    </div>
  );
}

// ── Compare (Phase 5: player-vs-player) ──────────────────────────────────────
function posRankIn(list: RankedPlayer[], pos: string, id: string, name: string): number | null {
  const same = list.filter((p) => p.pos === pos);
  let idx = same.findIndex((p) => p.sleeperId === id);
  if (idx < 0) {
    const t = name.toLowerCase().trim();
    idx = same.findIndex((p) => p.name.toLowerCase().trim() === t);
  }
  return idx >= 0 ? idx + 1 : null;
}

interface CmpMetric {
  label: string;
  aDisplay: string; aVal: number | null;
  bDisplay: string; bVal: number | null;
  lowerBetter?: boolean;
}

function CompareTab({ base, baseAdv, baseDynRank }: { base: PlayerProfile; baseAdv: PlayerAdvancedResult | null; baseDynRank: number | null }) {
  const valueModel = useValueModel();
  const [query, setQuery] = useState("");
  const [opp, setOpp] = useState<RankedPlayer | null>(null);
  const [oppAdv, setOppAdv] = useState<PlayerAdvancedResult | null>(null);
  const [oppAdvLoading, setOppAdvLoading] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return valueModel.dynastyPlayerList
      .filter((p) => p.name.toLowerCase().includes(q) && p.sleeperId !== base.player.id && p.name.toLowerCase().trim() !== base.player.name.toLowerCase().trim())
      .slice(0, 8);
  }, [query, valueModel.dynastyPlayerList, base.player.id, base.player.name]);

  useEffect(() => {
    if (!opp) { setOppAdv(null); return; }
    let cancelled = false;
    setOppAdvLoading(true);
    loadPlayerAdvancedStats(opp.pos, opp.name)
      .then((r) => { if (!cancelled) setOppAdv(r); })
      .catch(() => { if (!cancelled) setOppAdv(null); })
      .finally(() => { if (!cancelled) setOppAdvLoading(false); });
    return () => { cancelled = true; };
  }, [opp?.sleeperId]);

  // Search UI (always shown).
  const search = (
    <Card className="p-4">
      <SectionTitle icon={GitCompare} title={`Compare ${base.player.name} to…`} />
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a player…"
          className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[#d4af37]/50"
          data-testid="compare-search"
        />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            {results.map((p) => (
              <button
                key={p.sleeperId}
                onClick={() => { setOpp(p); setQuery(""); }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                data-testid={`compare-result-${p.sleeperId}`}
              >
                <span className="text-sm font-semibold text-foreground truncate">{p.name}</span>
                <span className="text-[11px] text-muted-foreground flex-shrink-0">{p.pos} · {p.team || "FA"} · {fmtValue(p.value)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );

  if (!opp) {
    return (
      <div className="space-y-4">
        {search}
        <EmptyBlock icon={GitCompare} text="Search and select a player above to compare dynasty value, ranks, age, and advanced profile side-by-side." />
      </div>
    );
  }

  // Opponent derived metrics.
  const oppSynthetic: Player = {
    id: opp.sleeperId, sleeperId: opp.sleeperId, name: opp.name,
    pos: (["QB", "RB", "WR", "TE"].includes(opp.pos) ? opp.pos : "WR") as Player["pos"],
    age: opp.age, value: opp.value, team: opp.team,
  };
  const oppRedraft = (() => { const v = valueModel.getRedraftValue(oppSynthetic); return Number.isFinite(v) && v > 0 ? v : null; })();
  const oppDynRank = overallDynastyRank(valueModel.dynastyPlayerList, { id: opp.sleeperId, name: opp.name });
  const oppPosRank = posRankIn(valueModel.dynastyPlayerList, opp.pos, opp.sleeperId, opp.name);

  const metrics: CmpMetric[] = [
    { label: "Dynasty Value", aDisplay: fmtValue(base.values.dynasty), aVal: base.values.dynasty, bDisplay: fmtValue(opp.value), bVal: opp.value },
    { label: "Win-Now Value", aDisplay: fmtValue(base.values.redraft), aVal: base.values.redraft, bDisplay: fmtValue(oppRedraft), bVal: oppRedraft },
    { label: "Dynasty Rank", aDisplay: baseDynRank ? `#${baseDynRank}` : "—", aVal: baseDynRank, bDisplay: oppDynRank ? `#${oppDynRank}` : "—", bVal: oppDynRank, lowerBetter: true },
    { label: "Position Rank", aDisplay: base.ranks.dynastyPositional ? `${base.player.pos}${base.ranks.dynastyPositional}` : "—", aVal: base.ranks.dynastyPositional, bDisplay: oppPosRank ? `${opp.pos}${oppPosRank}` : "—", bVal: oppPosRank, lowerBetter: true },
    { label: "Age", aDisplay: base.player.age != null ? `${base.player.age}` : "—", aVal: base.player.age ?? null, bDisplay: `${opp.age}`, bVal: opp.age, lowerBetter: true },
    { label: "Value Tier", aDisplay: valueTier(base.values.dynasty), aVal: null, bDisplay: valueTier(opp.value), bVal: null },
  ];

  // Composite score rows (labels present in either side).
  const baseComp = new Map((baseAdv?.composites ?? []).map((c) => [c.label, c.score]));
  const oppComp = new Map((oppAdv?.composites ?? []).map((c) => [c.label, c.score]));
  const compLabels = Array.from(new Set([...Array.from(baseComp.keys()), ...Array.from(oppComp.keys())]));
  for (const label of compLabels) {
    const a = baseComp.get(label) ?? null;
    const b = oppComp.get(label) ?? null;
    metrics.push({ label, aDisplay: a != null ? `${a}` : "—", aVal: a, bDisplay: b != null ? `${b}` : "—", bVal: b });
  }

  const rec = compareRecommendation(base, baseDynRank, opp, oppRedraft);

  return (
    <div className="space-y-4">
      {search}

      {/* Header */}
      <Card className="p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <CmpPlayerHead id={base.player.id} name={base.player.name} pos={base.player.pos} team={base.player.team} age={base.player.age} />
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">vs</span>
          <CmpPlayerHead id={opp.sleeperId} name={opp.name} pos={opp.pos} team={opp.team} age={opp.age} right />
        </div>
      </Card>

      {/* Recommendation */}
      <Card className="p-4">
        <SectionTitle icon={Sparkles} title="Recommendation" />
        <p className="text-sm leading-relaxed text-foreground/85">{rec}</p>
      </Card>

      {/* Metric rows */}
      <Card className="p-0 overflow-hidden">
        {oppAdvLoading && <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/30">Loading advanced profile…</div>}
        {metrics.map((m, i) => {
          const winner = cmpWinner(m);
          return (
            <div key={m.label} className={cn("grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5", i % 2 === 1 && "bg-muted/20")}>
              <div className={cn("text-right text-sm tabular-nums", winner === "a" ? "font-black text-[#d4af37]" : "text-foreground/80")}>{m.aDisplay}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center px-2 whitespace-nowrap">{m.label}</div>
              <div className={cn("text-left text-sm tabular-nums", winner === "b" ? "font-black text-[#d4af37]" : "text-foreground/80")}>{m.bDisplay}</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function cmpWinner(m: CmpMetric): "a" | "b" | null {
  if (m.aVal == null && m.bVal == null) return null;
  if (m.aVal == null) return "b";
  if (m.bVal == null) return "a";
  if (m.aVal === m.bVal) return null;
  const aBetter = m.lowerBetter ? m.aVal < m.bVal : m.aVal > m.bVal;
  return aBetter ? "a" : "b";
}

function compareRecommendation(base: PlayerProfile, baseDynRank: number | null, opp: RankedPlayer, oppRedraft: number | null): string {
  const bv = base.values.dynasty ?? 0;
  const ov = opp.value ?? 0;
  const winner = bv >= ov ? base.player.name : opp.name;
  const loser = bv >= ov ? opp.name : base.player.name;
  const gap = Math.abs(bv - ov);
  const close = bv > 0 && ov > 0 && gap / Math.max(bv, ov) < 0.12;

  const baseAge = base.player.age ?? 99;
  const younger = baseAge < opp.age ? base.player.name : opp.age < baseAge ? opp.name : null;
  const brv = base.values.redraft ?? 0;
  const orv = oppRedraft ?? 0;
  const winNow = brv >= orv ? base.player.name : opp.name;

  let main: string;
  if (close) {
    main = `${base.player.name} and ${opp.name} carry near-identical dynasty value, so the choice comes down to fit and timeline.`;
  } else {
    main = `${winner} holds the clear dynasty-value edge over ${loser}.`;
  }
  const contender = `For contenders, lean ${winNow} (stronger win-now value).`;
  const rebuilder = younger ? `For rebuilders, ${younger} is the safer long-term hold thanks to age.` : `For rebuilders, both profile similarly on age.`;
  return `${main} ${contender} ${rebuilder}`;
}

function CmpPlayerHead({ id, name, pos, team, age, right }: { id: string; name: string; pos: string; team: string; age?: number; right?: boolean }) {
  const [err, setErr] = useState(false);
  const synthetic = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  return (
    <div className={cn("flex items-center gap-2 min-w-0", right ? "flex-row-reverse text-right" : "")}>
      <div className="w-9 h-9 rounded-full overflow-hidden bg-muted/40 flex-shrink-0">
        {err || synthetic ? null : (
          <img src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`} alt={name} className="w-full h-full object-cover object-top" onError={() => setErr(true)} />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-foreground truncate">{name}</div>
        <div className="text-[11px] text-muted-foreground truncate">{pos} · {team || "FA"}{age != null ? ` · ${age}y` : ""}</div>
      </div>
    </div>
  );
}

// ── Game Log (Phase 5: weekly logs via cached backend) ───────────────────────
function nflSeasonNow(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

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

function GameLogTab({ playerId, pos }: { playerId: string | null; pos: string }) {
  const cur = nflSeasonNow();
  const seasonOptions = [cur, cur - 1, cur - 2];
  return (
    <div className="space-y-2">
      {seasonOptions.map((s) => (
        <GameLogSeasonRow key={s} playerId={playerId} pos={pos} season={s} />
      ))}
    </div>
  );
}

// One collapsible row per season. Regular season + playoffs are fetched in
// parallel (allSettled, so one failing still shows the other) and merged into a
// single list. Data is fetched lazily the first time the row is expanded.
function GameLogSeasonRow({ playerId, pos, season, defaultOpen }: { playerId: string | null; pos: string; season: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [logs, setLogs] = useState<GLRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || !playerId || fetched.current) return;
    fetched.current = true;
    let cancelled = false;
    setLoading(true); setError(false);
    Promise.allSettled([
      fetchPlayerGameLogs(playerId, season, "regular"),
      fetchPlayerGameLogs(playerId, season, "post"),
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
  }, [open, playerId, season]);

  const cols = gameLogColumns(pos);
  const firstPostIdx = logs ? logs.findIndex((r) => r.seasonType === "post") : -1;
  const played = logs?.filter((r) => r.ptsStd != null) ?? [];
  const summary = played.length
    ? `${played.length} G · ${(played.reduce((s, r) => s + (r.ptsStd ?? 0), 0) / played.length).toFixed(1)} PPG`
    : null;

  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-0" : "-rotate-90")} />
          <span className="text-sm font-semibold text-foreground">{season}</span>
        </div>
        {summary && <span className="text-xs text-muted-foreground tabular-nums">{summary}</span>}
      </button>

      {open && (
        <div className="border-t border-border/60 p-4 space-y-4">
          {loading && !logs ? (
            <SkeletonLines n={6} />
          ) : error ? (
            <EmptyBlock icon={ScrollText} text="Game logs are temporarily unavailable from Sleeper. Try again later." />
          ) : !logs || !logs.length ? (
            <EmptyBlock icon={ScrollText} text={`No game logs for ${season}.`} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
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
          )}
        </div>
      )}
    </Card>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({
  profile, raw, dynRank, connected, exposure, exposureLoading, onCompare,
}: {
  profile: PlayerProfile;
  raw: any;
  dynRank: number | null;
  connected: boolean;
  exposure: PlayerLeagueExposure[] | null;
  exposureLoading: boolean;
  onCompare: () => void;
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
        <SectionTitle icon={Star} title="Quick Actions" />
        <div className="grid gap-2">
          <ActionButton icon={GitCompare} label="Compare Player" onClick={onCompare} />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/60">Trade calculator, watchlist, and rankings links arrive in later phases.</p>
      </Card>

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

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Star; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20 hover:border-[#d4af37]/40 hover:bg-muted/40 transition-colors text-xs font-semibold text-foreground"
    >
      <Icon className="w-3.5 h-3.5 text-[#d4af37]" />{label}
    </button>
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
