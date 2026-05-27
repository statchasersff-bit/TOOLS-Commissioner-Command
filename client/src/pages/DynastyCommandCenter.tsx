import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, startTransition } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MegaMenuNav, MobileBottomNav } from "@/components/MegaMenu";
import { LeagueSelector } from "@/components/LeagueSelector";
import { HeaderValueSourceBadge } from "@/components/ValueSourceSelector";
import { ValueSourceManager } from "@/components/ValueSourceManager";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { useAuth } from "@/contexts/AuthContext";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { SettingsModal } from "@/components/SettingsModal";
import { NAV_CONFIG } from "@/data/mockData";
import { FEATURES } from "@/config/features";
import type { League, Team } from "@/types";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { DataDiagnostics } from "@/components/DataDiagnostics";
import { LayoutDashboard, Loader2, Lock, Check, User, RefreshCw, AlertCircle, Wifi, WifiOff, ChevronDown, LogOut, Trophy, ArrowRightLeft, TrendingUp, Zap, X, MessageSquare, HelpCircle, Eye, Unlink, Star, Settings } from "lucide-react";
import { AccessGate } from "@/components/AccessGate";
import { UpgradeFlow } from "@/components/UpgradeFlow";
import { resolveAccess } from "@/config/moduleAccess";
import { SiDiscord } from "react-icons/si";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";

import { API_BASE } from "@/lib/apiBase";
import { ShareDynastyPopup } from "@/components/ShareDynastyPopup";
import { WhatsNewModal } from "@/components/WhatsNewModal";

// ── Lazy-loaded tab components ─────────────────────────────────────────────
// Each tab is split into its own async chunk so the initial bundle only
// contains the shell + header. Tabs load on first navigation.
const PlayerPage        = lazy(() => import("@/pages/PlayerPage"));
const PortfolioConnect  = lazy(() => import("./tabs/Portfolio").then(m => ({ default: m.PortfolioConnect })));
const PortfolioSummary  = lazy(() => import("./tabs/Portfolio").then(m => ({ default: m.PortfolioSummary })));
const WaiverCommand     = lazy(() => import("./tabs/WaiverCommand"));
const DashboardSnapshot = lazy(() => import("./tabs/Dashboard").then(m => ({ default: m.DashboardSnapshot })));
const MyTeam            = lazy(() => import("./tabs/Dashboard").then(m => ({ default: m.MyTeam })));
const ShareTeam         = lazy(() => import("./tabs/ShareTeam").then(m => ({ default: m.ShareTeam })));
const RosterComparison  = lazy(() => import("./tabs/LeagueAnalyzer").then(m => ({ default: m.RosterComparison })));
const PlayoffCalculator = lazy(() => import("./tabs/PlayoffCalculator").then(m => ({ default: m.PlayoffCalculator })));
const Transactions      = lazy(() => import("./tabs/Transactions"));
const TradeBlockScanner    = lazy(() => import("./tabs/TradeCenter").then(m => ({ default: m.TradeBlockScanner })));
const TradeCalculatorView  = lazy(() => import("./tabs/TradeCenter").then(m => ({ default: m.TradeCalculatorView })));
const TradeDatabase        = lazy(() => import("./tabs/TradeCenter").then(m => ({ default: m.TradeDatabase })));
const TradeSync         = lazy(() => import("./tabs/TradeSync"));
const PositionalAnalysis= lazy(() => import("./tabs/PositionalAnalysis").then(m => ({ default: m.PositionalAnalysis })));
const MarketValue       = lazy(() => import("./tabs/LeagueMarket").then(m => ({ default: m.MarketValue })));
const Analysis          = lazy(() => import("./tabs/Analysis"));
const LiveDraft         = lazy(() => import("./tabs/LiveDraft"));
const LineupCommand     = lazy(() => import("./tabs/LineupCommand").then(m => ({ default: m.LineupCommand })));
const PositionStats     = lazy(() => import("./tabs/PositionStats"));
const DraftCommand      = lazy(() => import("./tabs/DraftCommand").then(m => ({ default: m.DraftCommand })));
const DraftAvailability = lazy(() => import("./tabs/DraftAvailability").then(m => ({ default: m.DraftAvailability })));
const AboutPage         = lazy(() => import("@/components/AboutModal").then(m => ({ default: m.AboutPage })));
const FeedbackPage      = lazy(() => import("@/components/FeedbackPage").then(m => ({ default: m.FeedbackPage })));
const TermsPage         = lazy(() => import("@/components/LegalModals").then(m => ({ default: m.TermsPage })));
const PrivacyPage       = lazy(() => import("@/components/LegalModals").then(m => ({ default: m.PrivacyPage })));
const CookiesPage       = lazy(() => import("@/components/LegalModals").then(m => ({ default: m.CookiesPage })));

const STORAGE_KEY = "sc-dynasty-state";

// NOTE: leagueId is no longer persisted here — it lives in SleeperContext's
// own per-user storage (`sc-active-league:<userId>`) so accounts can't inherit
// each other's selection. Any legacy `leagueId` key in this payload is ignored.
function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { tab?: string; sub?: string };
  } catch {}
  return null;
}

function getInitialState(pathTab?: string, pathSub?: string) {
  const saved = loadSavedState();
  let requestedTab = pathTab || saved?.tab || "portfolio";
  let requestedSub = pathSub || saved?.sub || "portfolio-summary";

  // Legacy redirect — the "Live Draft" module was merged into "Draft" as
  // the Draft Board sub-tab. Keep old URLs / saved state working.
  if (requestedTab === "live-draft") {
    requestedTab = "draft";
    requestedSub = "draft-board";
  }

  // Draft module temporarily hidden — see FEATURES.SHOW_DRAFT_MODULE.
  // Any stale URL/saved state that targets `draft` falls back to portfolio
  // so the user isn't dropped on a nav-less, unrenderable tab.
  if (!FEATURES.SHOW_DRAFT_MODULE && requestedTab === "draft") {
    requestedTab = "portfolio";
    requestedSub = "portfolio-summary";
  }

  return {
    tab: requestedTab,
    sub: requestedSub,
  };
}


export default function DynastyCommandCenter({ params, playerProfileId }: { params?: { tab?: string; sub?: string }; playerProfileId?: string }) {
  useEffect(() => { console.log("[app] DynastyCommandCenter mounted"); }, []);

  // ── Background chunk preloading ────────────────────────────────────────────
  // Wave 1 (immediate): most-visited tabs — ready before the user clicks.
  // Wave 2 (1.5 s): remaining tabs, loaded while the user reads the dashboard.
  // Calling the raw dynamic import() primes the browser cache without rendering
  // anything; React.lazy reuses the same cached promise on first render.
  useEffect(() => {
    import("./tabs/Dashboard");
    import("./tabs/Portfolio");
    import("./tabs/TradeCenter");
    import("./tabs/DraftCommand");
    const t = setTimeout(() => {
      import("./tabs/LiveDraft");
      import("./tabs/LeagueAnalyzer");
      import("./tabs/PlayoffCalculator");
      import("./tabs/Transactions");
      import("./tabs/PositionalAnalysis");
      import("./tabs/LeagueMarket");
      import("./tabs/Analysis");
      import("./tabs/PositionStats");
      import("./tabs/WaiverCommand");
      import("./tabs/TradeSync");
      import("./tabs/LineupCommand");
      import("./tabs/DraftAvailability");
      import("./tabs/ShareTeam");
      import("@/pages/PlayerPage");
      import("@/components/AboutModal");
      import("@/components/FeedbackPage");
      import("@/components/LegalModals");
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  const [, setLocation] = useLocation();
  const initial = getInitialState(params?.tab, params?.sub);
  const [activeMainTab, setActiveMainTab] = useState(initial.tab);
  const [activeSubTab, setActiveSubTab] = useState(initial.sub);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fetchedLeague, setFetchedLeague] = useState<{ league: League; userTeamId: string | null } | null>(null);
  const [isLeagueLoading, setIsLeagueLoading] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { favoriteTeam } = useFavoriteTeam();
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  const [forceOpenShare, setForceOpenShare] = useState(false);
  const [hasSeenAbout, setHasSeenAbout] = useState(() => {
    try { return localStorage.getItem("sc-seen-about") === "1"; } catch { return false; }
  });

  const { isRecalculating, isLoading, getPlayerValue, getPickValue, calculateAllTeamMetrics, optimizeLineup } = useValueModel();
  const sleeper = useSleeper();
  const {
    user: scUser,
    logout: scLogout,
    accessLevel,
    readOnlySleeperUser,
    disconnectReadOnlySleeper,
  } = useAuth();
  const [headerUpgradeOpen, setHeaderUpgradeOpen] = useState(false);

  // Single source of truth for "which league are we looking at?" — lives in
  // SleeperContext so the header, every module page, and any future
  // league-specific tool all read the same value. The header dropdown writes
  // to it; modules (e.g. WaiverCommand) also write to it on row clicks via
  // useActiveLeagueNavigation. Persistence is handled inside SleeperContext.
  const selectedLeagueId = sleeper.activeLeagueId;

  const sleeperLeaguesAsLeagues = useMemo(() => {
    return sleeper.leagues.map((sl) => ({
      id: sl.leagueId,
      name: sl.name,
      platform: "sleeper" as string,
      scoringFormat: `${sl.scoringFormat} ${sl.format}`,
      teams: [] as Team[],
      avatar: sl.avatar ? `https://sleepercdn.com/avatars/thumbs/${sl.avatar}` : null,
    }));
  }, [sleeper.leagues]);

  const selectedLeagueSummary = useMemo(() =>
    sleeper.leagues.find((l) => l.leagueId === selectedLeagueId) ?? null,
  [sleeper.leagues, selectedLeagueId]);
  const isSelectedBestBall = selectedLeagueSummary?.isBestBall ?? false;

  useEffect(() => {
    if (activeMainTab === "about" && !hasSeenAbout) {
      setHasSeenAbout(true);
      try { localStorage.setItem("sc-seen-about", "1"); } catch { /* ignore */ }
    }
  }, [activeMainTab, hasSeenAbout]);

  useEffect(() => {
    if (!selectedLeagueId || !sleeper.isConnected || !sleeper.user) return;
    let cancelled = false;
    setIsLeagueLoading(true);
    console.info("[app] league load start", { leagueId: selectedLeagueId, sleeperUserId: sleeper.user.userId });

    fetchSleeperLeagueFull(selectedLeagueId, sleeper.user.userId)
      .then((data: { league: League; userTeamId: string | null }) => {
        if (cancelled) return;
        console.info("[app] league load ok", { leagueId: selectedLeagueId, teams: data.league?.teams?.length, userTeamId: data.userTeamId });
        setFetchedLeague(data);
        setIsLeagueLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // fetchSleeperLeagueFull now times out rather than hanging, so this
        // branch always runs on failure — clearing the overlay instead of
        // leaving the app stuck on "Loading league data...".
        console.error("[app] league load failed", { leagueId: selectedLeagueId, endpoint: "fetchSleeperLeagueFull", error: err });
        setFetchedLeague(null);
        setIsLeagueLoading(false);
      })
      .finally(() => {
        if (!cancelled) console.info("[app] league load finished — isLeagueLoading: false");
      });

    return () => { cancelled = true; };
  }, [selectedLeagueId, sleeper.isConnected, sleeper.user]);

  const league: League | null = useMemo(() => {
    if (!fetchedLeague?.league) return null;
    const raw = fetchedLeague.league;
    const positions = raw.rosterPositions;
    const adjustedTeams = raw.teams.map((team) => {
      const valuedRoster = team.roster.map((p) => ({ ...p, value: getPlayerValue(p) }));
      const roster = positions
        ? optimizeLineup(valuedRoster, positions)
        : valuedRoster;
      const picks = team.picks.map((p) => ({ ...p, value: getPickValue(p) }));
      return { ...team, roster, picks };
    });
    const metricsMap = calculateAllTeamMetrics(adjustedTeams, positions);
    return {
      ...raw,
      teams: adjustedTeams.map((team) => ({
        ...team,
        metrics: metricsMap.get(team.id) || { overall: 50, starters: 50, depth: 50, youth: 50, picks: 50, qb: 50, rb: 50, wr: 50, te: 50, contenderWindowYears: 2, windowStartOffset: 0 },
      })),
    };
  }, [fetchedLeague, getPlayerValue, getPickValue, calculateAllTeamMetrics, optimizeLineup]);

  const userTeam = useMemo(() => {
    if (!league || !fetchedLeague?.userTeamId) return league?.teams[0] || null;
    return league.teams.find((t) => t.id === fetchedLeague.userTeamId) || league.teams[0] || null;
  }, [league, fetchedLeague]);

  useEffect(() => {
    if (!sleeper.user?.username) return;
    fetch(`${API_BASE}/api/trades/ingest-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: sleeper.user.username }),
    }).catch(() => {});
  }, [sleeper.user?.userId]);

  useEffect(() => {
    if (!fetchedLeague || !selectedLeagueId) return;
    const summary = sleeper.leagues.find((l) => l.leagueId === selectedLeagueId);
    if (!summary) return;
    fetch(`${API_BASE}/api/trades/ingest-league`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId: selectedLeagueId,
        season: summary.season,
        teamCount: summary.totalRosters || fetchedLeague.league.teams.length,
        format: summary.format || fetchedLeague.league.format || "1QB",
        scoringFormat: summary.scoringFormat || fetchedLeague.league.scoringFormat || "PPR",
      }),
    }).catch(() => {});
  }, [fetchedLeague, selectedLeagueId, sleeper.leagues]);

  const currentMainConfig = NAV_CONFIG.find((t) => t.id === activeMainTab);

  useEffect(() => {
    setLocation(`/${activeMainTab}/${activeSubTab}`, { replace: true });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tab: activeMainTab,
        sub: activeSubTab,
      }));
    } catch {}
  }, [activeMainTab, activeSubTab, setLocation]);

  useEffect(() => {
    if (!userDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [userDropdownOpen]);

  useEffect(() => {
    if (!logoMenuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (logoMenuRef.current && !logoMenuRef.current.contains(e.target as Node)) {
        setLogoMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [logoMenuOpen]);

  const handleLeagueSelect = useCallback((id: string) => {
    sleeper.setActiveLeague(id);
  }, [sleeper]);

  const handleMainTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    startTransition(() => {
      setActiveMainTab(id);
      const config = NAV_CONFIG.find((t) => t.id === id);
      if (config) setActiveSubTab(config.subTabs[0].id);
    });
    setTimeout(() => setIsTransitioning(false), 180);
  }, []);

  const handleSubTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    startTransition(() => {
      setActiveSubTab(id);
    });
    setTimeout(() => setIsTransitioning(false), 180);
  }, []);

  const navigateToSubTab = useCallback((mainTabId: string, subTabId: string) => {
    setIsTransitioning(true);
    startTransition(() => {
      setActiveMainTab(mainTabId);
      setActiveSubTab(subTabId);
    });
    setTimeout(() => setIsTransitioning(false), 180);
  }, []);

  const renderLockedState = () => (
    <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
      <Card className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30" data-testid="locked-state-card">
        <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
          <Lock className="w-6 h-6 md:w-7 md:h-7 text-[#0b3a7a] dark:text-blue-400" />
        </div>
        <h3 className="text-lg md:text-xl font-bold mb-1.5">Connect Sleeper to Unlock</h3>
        <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed mb-5 max-w-[280px] mx-auto">
          Link your Sleeper account for real-time dynasty analysis with your actual rosters and picks.
        </p>
        <div className="text-left space-y-2 mb-5 max-w-[260px] mx-auto">
          {[
            "Real-time roster analysis",
            "Multi-league portfolio view",
            "FantasyCalc-powered valuations",
          ].map((text) => (
            <div key={text} className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500/10 dark:bg-emerald-400/10 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[13px] text-muted-foreground">{text}</span>
            </div>
          ))}
        </div>
        <Button
          className="w-full md:w-auto bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white h-11 md:h-10 text-sm font-semibold shadow-md shadow-[#0b3a7a]/20 hover:shadow-lg hover:shadow-[#0b3a7a]/30 transition-all"
          onClick={() => navigateToSubTab("portfolio", "connect")}
          data-testid="button-connect-sleeper-locked"
        >
          Connect Sleeper
        </Button>
      </Card>
    </div>
  );

  // Empty-state branching. We only reach this when AccessGate has confirmed
  // at least readonly access, so "Connect Sleeper Account" is almost always
  // the wrong CTA — the user has already connected. The cases we actually
  // need to handle are:
  //   A. Sleeper API still fetching → spinner card
  //   B. Connected, but Sleeper returned zero eligible dynasty leagues →
  //      "No eligible dynasty leagues found" + "Try Another Username" (only
  //      a real action for readonly users; auth-linked users can't swap
  //      Sleeper accounts from here).
  //   C. Leagues exist + a league is selected, but its full payload hasn't
  //      arrived yet → "Loading Your League" (no CTA).
  //   D. Pathological fall-through (no user at all, somehow past AccessGate)
  //      → keep the old Connect prompt as a last resort.
  const renderSelectLeague = () => {
    const hasUser = !!(sleeper.user || readOnlySleeperUser);
    const isFetchingLeagues = sleeper.isLoading;
    const noLeagues = hasUser && !isFetchingLeagues && sleeper.leagues.length === 0;
    const isReadOnlyUser = !!readOnlySleeperUser && !sleeper.isConnected ? true : (accessLevel === "readonly");

    // A. Initial fetch — show a spinner card.
    if (hasUser && isFetchingLeagues) {
      return (
        <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
          <Card className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30" data-testid="loading-leagues-card">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
              <Loader2 className="w-6 h-6 md:w-7 md:h-7 text-[#0b3a7a] dark:text-blue-400 animate-spin" />
            </div>
            <h3 className="text-lg md:text-xl font-bold mb-1.5">Loading Your Leagues</h3>
            <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
              Looking up your Sleeper dynasty leagues…
            </p>
          </Card>
        </div>
      );
    }

    // B. Connected, but no eligible leagues exist.
    if (noLeagues) {
      return (
        <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
          <Card className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30" data-testid="no-leagues-card">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-amber-500/10 dark:bg-amber-400/10 flex items-center justify-center mb-4 ring-1 ring-amber-500/20 dark:ring-amber-400/20">
              <AlertCircle className="w-6 h-6 md:w-7 md:h-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-lg md:text-xl font-bold mb-1.5" data-testid="text-no-leagues">No eligible dynasty leagues found for this Sleeper username.</h3>
            <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed mb-5 max-w-[300px] mx-auto">
              We couldn't find any active dynasty leagues with a drafted roster under{" "}
              <span className="font-semibold text-foreground">@{sleeper.user?.username ?? readOnlySleeperUser?.username}</span>.
            </p>
            {isReadOnlyUser && (
              <Button
                variant="outline"
                className="w-full md:w-auto h-11 md:h-10 text-sm font-semibold"
                onClick={() => disconnectReadOnlySleeper()}
                data-testid="button-try-another-username"
              >
                Try Another Username
              </Button>
            )}
          </Card>
        </div>
      );
    }

    // C. Leagues are loaded and a selection exists — we're just waiting on
    //    the full league payload (rosters, picks, etc.) to render the module.
    if (hasUser && sleeper.leagues.length > 0) {
      return (
        <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
          <Card className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30" data-testid="loading-league-card">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
              <Loader2 className="w-6 h-6 md:w-7 md:h-7 text-[#0b3a7a] dark:text-blue-400 animate-spin" />
            </div>
            <h3 className="text-lg md:text-xl font-bold mb-1.5" data-testid="text-loading-league">Loading Your League</h3>
            <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed max-w-[300px] mx-auto">
              We found your Sleeper leagues and are opening one now.
            </p>
          </Card>
        </div>
      );
    }

    // D. True "not connected" fallback. AccessGate normally catches this
    //    before we reach here — but if a render slips through, keep the
    //    Connect CTA as a safety net.
    return (
      <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
        <Card className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30" data-testid="select-league-card">
          <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
            <LayoutDashboard className="w-6 h-6 md:w-7 md:h-7 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg md:text-xl font-bold mb-1.5" data-testid="text-empty-state">Select a League to Begin</h3>
          <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed mb-5 max-w-[280px] mx-auto">
            Choose a league to explore power rankings, trade tools, and deep roster analysis.
          </p>
          <Button
            variant="outline"
            className="w-full md:w-auto h-11 md:h-10 text-sm font-semibold"
            onClick={() => navigateToSubTab("portfolio", "connect")}
            data-testid="button-go-to-leagues"
          >
            Connect Sleeper Account
          </Button>
        </Card>
      </div>
    );
  };

  // Navigate back to the default read-only landing module — used by the
  // "Back to Read-Only Tools" button on the LoginRequiredGate.
  const backToReadOnly = useCallback(() => {
    navigateToSubTab("portfolio", "portfolio-summary");
  }, [navigateToSubTab]);

  /**
   * Inner render — the module body without any access gating. AccessGate
   * wraps the result and decides whether to render it, show
   * ConnectSleeperUsername, or show LoginRequiredGate.
   */
  const renderModule = () => {
    if (activeMainTab === "about") {
      return (
        <AboutPage
          onNavigate={(tab, sub) => { handleMainTabChange(tab); handleSubTabChange(sub); }}
          onOpenFeedback={() => handleMainTabChange("feedback")}
          onOpenCookies={() => handleMainTabChange("cookies")}
          onOpenTerms={() => handleMainTabChange("terms")}
          onOpenPrivacy={() => handleMainTabChange("privacy")}
          onShareWithLeagues={() => setForceOpenShare(true)}
        />
      );
    }

    if (activeMainTab === "feedback") return <FeedbackPage />;
    if (activeMainTab === "terms") return <TermsPage onNavigate={handleMainTabChange} />;
    if (activeMainTab === "privacy") return <PrivacyPage onNavigate={handleMainTabChange} />;
    if (activeMainTab === "cookies") return <CookiesPage onNavigate={handleMainTabChange} />;

    // Draft module — Draft Board (live Sleeper draft tracker) and ADP
    // Explorer (public ADP dataset). Both run without an active league.
    if (activeMainTab === "draft") {
      if (activeSubTab === "draft-board") return (
        <LiveDraft
          onConnectSleeper={
            accessLevel === "guest" || accessLevel === "readonly"
              ? () => { handleMainTabChange("portfolio"); handleSubTabChange("portfolio-summary"); }
              : () => setHeaderUpgradeOpen(true)
          }
        />
      );
      if (activeSubTab === "player-availability") return <DraftAvailability />;
      return <DraftCommand />;
    }

    if (activeMainTab === "portfolio") {
      const key = `portfolio:${activeSubTab}`;
      switch (key) {
        case "portfolio:connect":          return <PortfolioConnect onNavigate={navigateToSubTab} />;
        case "portfolio:lineup-command":   return <LineupCommand />;
        case "portfolio:portfolio-summary":return <PortfolioSummary onNavigate={navigateToSubTab} />;
        case "portfolio:waiver-command":   return <WaiverCommand />;
        default:                           return <PortfolioConnect onNavigate={navigateToSubTab} />;
      }
    }

    // trade-sync doesn't need a selected league
    if (activeMainTab === "trade-center" && activeSubTab === "trade-sync") {
      return <TradeSync onNavigate={navigateToSubTab} />;
    }

    // position-stats is fully self-contained (local bundled data, no Sleeper API)
    if (activeMainTab === "league-market" && activeSubTab === "position-stats") {
      return <PositionStats />;
    }

    // Resources (analysis) is self-contained — no league/Sleeper required, so
    // it renders for guests too. Must sit above the active-league guard below.
    if (activeMainTab === "league-market" && activeSubTab === "analysis") {
      return <Analysis />;
    }

    // Trade Calculator has a guest-accessible "Quick" mode (no login/league), so
    // it renders above the active-league guard. Logged-in users also get the full
    // league-based calculator inside it.
    if (activeMainTab === "trade-center" && activeSubTab === "trade-calculator") {
      return <TradeCalculatorView league={league} userTeam={userTeam} onNavigate={navigateToSubTab} />;
    }

    // Past this point we need an active league. AccessGate has already
    // ensured the user is at least readonly-connected; if they're connected
    // but haven't loaded a league yet, prompt them.
    if (!league || !userTeam) {
      return renderSelectLeague();
    }

    const key = `${activeMainTab}:${activeSubTab}`;
    switch (key) {
      case "dashboard:my-team":                  return <MyTeam league={league} userTeam={userTeam} onNavigate={navigateToSubTab} />;
      case "dashboard:share-team":               return <ShareTeam league={league} userTeam={userTeam} />;
      case "league-analyzer:power-rankings":     return <DashboardSnapshot league={league} userTeam={userTeam} />;
      case "league-analyzer:roster-comparison":  return <RosterComparison league={league} />;
      case "league-analyzer:playoff-calculator": return <PlayoffCalculator />;
      case "league-analyzer:transactions":       return <Transactions leagueId={selectedLeagueId!} />;
      case "trade-center:trade-database":        return <TradeDatabase league={league} />;
      case "trade-center:positional-analysis":   return <PositionalAnalysis league={league} userTeam={userTeam} />;
      case "trade-center:trade-block":           return <TradeBlockScanner league={league} />;
      case "league-market:market-value":         return <MarketValue league={league} />;
      case "league-market:analysis":             return <Analysis />;
      case "league-market:position-stats":       return <PositionStats />;
      default: return <div className="text-center text-muted-foreground py-12">Select a tab to get started</div>;
    }
  };

  const renderContent = () => {
    // Player profile is rendered inside the shell (header/mega-menu stay
    // visible) when the route is /players/:id.
    if (playerProfileId) return <PlayerPage params={{ playerId: playerProfileId }} embedded />;
    const access = resolveAccess(activeMainTab, activeSubTab);
    const isTradeInbox = activeMainTab === "trade-center" && activeSubTab === "trade-sync";
    return (
      <AccessGate
        requiredAccess={access}
        onBackToReadOnly={backToReadOnly}
        gateTitle={isTradeInbox ? "Login required to see trade inbox." : undefined}
        gateDescription={isTradeInbox ? "Create a free StatChasers account below." : undefined}
        showBackButton={!isTradeInbox}
      >
        {renderModule()}
      </AccessGate>
    );
  };

  const showLoadingOverlay = isLeagueLoading || isRecalculating || (isLoading && selectedLeagueId && sleeper.isConnected);

  return (
    <div className="min-h-screen sc-page-bg">
      <header
        className="sticky top-0 z-50 backdrop-blur-sm dark:bg-[rgba(5,10,24,0.98)] dark:border-b dark:border-[rgba(212,175,55,0.16)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.30)] bg-[var(--sc-nav-bg-translucent)] border-b border-[var(--sc-border)] shadow-[var(--sc-shadow-sm)]"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-3 py-[14px] md:py-3">
          <div className="flex items-center gap-3">

            {/* ── Logo (clickable menu trigger) ── */}
            <div className="relative flex-shrink-0 flex-1 flex items-center gap-2" ref={logoMenuRef}>
              <button
                onClick={() => setLogoMenuOpen(v => !v)}
                data-testid="button-logo-menu"
                className="relative flex items-center gap-2.5 rounded-xl transition-all duration-200 group"
                style={{ padding: "4px 8px 4px 4px", background: logoMenuOpen ? "rgba(212,175,55,0.07)" : "transparent", border: logoMenuOpen ? "1px solid rgba(212,175,55,0.20)" : "1px solid transparent" }}
              >
                {!hasSeenAbout && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 pointer-events-none">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-70" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                )}
                <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center flex-shrink-0">
                  <img src={logoDark} alt="StatChasers" className="w-8 h-8 md:w-9 md:h-9 hidden dark-any:block" />
                  <img src={logoLight} alt="StatChasers" className="w-8 h-8 md:w-9 md:h-9 block dark-any:hidden" />
                </div>
                <div className="leading-none hidden md:block text-left">
                  <h1 className="text-sm md:text-base font-bold text-foreground leading-tight tracking-tight" data-testid="text-app-title">StatChasers</h1>
                  <p className="text-[10px] md:text-xs text-[#d4af37] font-semibold tracking-wide leading-tight mt-0.5">Dynasty Command</p>
                </div>
                <ChevronDown className={`w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-transform duration-200 hidden md:block ${logoMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Discord — moved out of the logo dropdown to sit beside the brand. */}
              <a
                href="https://discord.gg/yerHQKBrre"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="button-discord"
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold rounded-md transition-all duration-200 text-[#5865F2] bg-[#5865F2]/10 hover:bg-[#5865F2]/20 border border-[#5865F2]/25 hover:border-[#5865F2]/40 flex-shrink-0"
              >
                <SiDiscord className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Discord</span>
              </a>

              {/* Logo dropdown menu */}
              {logoMenuOpen && (
                <div
                  className="absolute left-0 top-full mt-2 z-[55] overflow-hidden"
                  style={{ width: 240, borderRadius: 16, background: "rgba(5,10,24,0.98)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 40px rgba(0,0,0,0.50), 0 0 0 1px rgba(212,175,55,0.06)" }}
                >
                  {/* Brand header */}
                  <div className="px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(11,58,122,0.18) 0%, transparent 100%)" }}>
                    <div className="flex items-center gap-2.5">
                      <img src={logoDark} alt="StatChasers" className="w-7 h-7 hidden dark-any:block" />
                      <img src={logoLight} alt="StatChasers" className="w-7 h-7 block dark-any:hidden" />
                      <div>
                        <p className="text-[13px] font-black text-white leading-tight">StatChasers</p>
                        <p className="text-[10px] font-semibold leading-tight" style={{ color: "#d4af37" }}>Dynasty Command</p>
                      </div>
                    </div>
                  </div>

                  {/* About + Feedback items */}
                  <div className="px-1.5 pb-1.5">
                    <button
                      onClick={() => { setLogoMenuOpen(false); handleMainTabChange("about"); }}
                      data-testid="button-logo-about"
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 hover:bg-white/5"
                    >
                      <HelpCircle style={{ width: 14, height: 14, flexShrink: 0, color: "rgba(212,175,55,0.65)" }} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(203,213,225,0.55)" }}>About</span>
                      {!hasSeenAbout && (
                        <span className="ml-auto flex h-2 w-2 flex-shrink-0">
                          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-500 opacity-70" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => { setLogoMenuOpen(false); handleMainTabChange("feedback"); }}
                      data-testid="button-logo-feedback"
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 hover:bg-white/5"
                    >
                      <MessageSquare style={{ width: 14, height: 14, flexShrink: 0, color: "rgba(212,175,55,0.65)" }} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(203,213,225,0.55)" }}>Feedback</span>
                    </button>
                  </div>

                  {/* Footer row */}
                  <div className="flex items-center justify-end px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <ThemeToggle />
                  </div>
                </div>
              )}
            </div>

            {/* ── League selector (centered) ── */}
            {sleeper.isConnected && (
              <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                <LeagueSelector
                  leagues={sleeperLeaguesAsLeagues}
                  selectedLeagueId={selectedLeagueId}
                  onSelect={handleLeagueSelect}
                />
                {isSelectedBestBall && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-300 dark:border-sky-700" data-testid="badge-bestball-active">
                    Best Ball
                  </Badge>
                )}
              </div>
            )}

            {/* ── Right side ── */}
            <div className="flex items-center gap-2 md:gap-3 flex-1 justify-end">

              {/* Read-only mode badge + Login for Full Access (readonly tier only) */}
              {accessLevel === "readonly" && readOnlySleeperUser && (
                <div className="flex items-center gap-1.5 md:gap-2">
                  <span
                    data-testid="badge-read-only-mode"
                    className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
                  >
                    <Eye className="w-3 h-3" />
                    Read-Only Mode
                  </span>
                  <button
                    onClick={() => setHeaderUpgradeOpen(true)}
                    data-testid="button-login-for-full"
                    className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold rounded-md transition-all duration-200 text-[#d4af37] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Login for Full Access</span>
                    <span className="md:hidden">Login</span>
                  </button>
                </div>
              )}

              {/* Connect Sleeper Username button (guest only) */}
              {accessLevel === "guest" && (
                <button
                  onClick={() => { handleMainTabChange("portfolio"); handleSubTabChange("portfolio-summary"); }}
                  data-testid="button-header-connect"
                  className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm font-semibold rounded-md transition-all duration-200 text-[#d4af37] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Connect Sleeper Username</span>
                  <span className="md:hidden">Connect</span>
                </button>
              )}

              {/* DC-authenticated but missing Sleeper token: offer upgrade */}
              {accessLevel === "authenticated" && (
                <button
                  onClick={() => setHeaderUpgradeOpen(true)}
                  data-testid="button-connect-sleeper-token"
                  className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold rounded-md transition-all duration-200 text-[#d4af37] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Connect Sleeper for Actions</span>
                  <span className="md:hidden">Sleeper</span>
                </button>
              )}


              <ValueSourceManager />

              {/* User dropdown (when connected) — contains Discord + ThemeToggle */}
              {sleeper.isConnected && sleeper.user ? (
                <div className="relative" ref={userDropdownRef}>
                  <button
                    onClick={() => setUserDropdownOpen(v => !v)}
                    data-testid="button-user-menu"
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors border border-transparent hover:border-border/40"
                  >
                    <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-border/40 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center">
                      {sleeper.user.avatar ? (
                        <img
                          src={`https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}`}
                          alt={sleeper.user.displayName}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          data-testid="img-user-avatar"
                        />
                      ) : (
                        <User className="w-3 h-3 text-[#0b3a7a] dark:text-blue-400" />
                      )}
                    </div>
                    <span className="text-xs font-medium text-foreground hidden md:block" data-testid="text-sleeper-user">
                      {sleeper.user.displayName}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-150 ${userDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {userDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-border/60 bg-background shadow-lg shadow-black/10 dark:shadow-black/30 z-50 overflow-hidden">
                      {/* Sleeper identity */}
                      <div className="px-3 py-2.5 border-b border-border/40 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-border/40 bg-muted flex items-center justify-center">
                          {sleeper.user?.avatar ? (
                            <img
                              src={`https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}`}
                              alt={sleeper.user.displayName}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <User className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">@{sleeper.user?.username}</p>
                          {scUser?.email
                            ? <p className="text-[11px] text-muted-foreground truncate">{scUser.email}</p>
                            : <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Read-only mode</p>}
                        </div>
                      </div>

                      {/* Favorite NFL Team row — always visible, opens Settings */}
                      <button
                        onClick={() => { setUserDropdownOpen(false); setSettingsOpen(true); }}
                        data-testid="button-menu-favorite-team"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors border-b border-border/30"
                      >
                        <Star className="w-3.5 h-3.5 flex-shrink-0 text-[#d4af37]" />
                        <span className="flex-1 text-left min-w-0">
                          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">
                            Favorite NFL Team
                          </span>
                          <span className="block truncate text-xs">
                            {favoriteTeam ? favoriteTeam.name : "Not set"}
                          </span>
                        </span>
                        <span className="text-[10px] text-[#d4af37] flex-shrink-0">
                          {favoriteTeam ? "Change" : "Choose"}
                        </span>
                      </button>

                      {/* Read-only: offer login for full access */}
                      {accessLevel === "readonly" && (
                        <button
                          onClick={() => { setUserDropdownOpen(false); setHeaderUpgradeOpen(true); }}
                          data-testid="button-menu-login-for-full"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                        >
                          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                          Login for Full Access
                        </button>
                      )}

                      {/* Read-only: disconnect Sleeper */}
                      {accessLevel === "readonly" && (
                        <button
                          onClick={() => { setUserDropdownOpen(false); disconnectReadOnlySleeper(); }}
                          data-testid="button-disconnect-readonly-sleeper"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground border-t border-border/30 transition-colors"
                        >
                          <Unlink className="w-3.5 h-3.5 flex-shrink-0" />
                          Disconnect Sleeper
                        </button>
                      )}

                      {/* DC-authenticated: sign out */}
                      {(accessLevel === "authenticated" || accessLevel === "full") && (
                        <button
                          onClick={() => { setUserDropdownOpen(false); scLogout(); }}
                          data-testid="button-sign-out"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/8 border-t border-border/30 transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
                          Sign out
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* ThemeToggle inline when not connected (Discord now lives beside the logo) */
                <div className="flex items-center gap-1.5 border-l border-border/40 pl-2">
                  <ThemeToggle />
                </div>
              )}
            </div>
          </div>


          {/* League selector (mobile) */}
          {sleeper.isConnected && (
            <div className="flex items-center gap-2 mt-3 mb-1 md:hidden mx-auto" style={{ width: "calc(90vw - 32px)", maxWidth: 380 }}>
              <LeagueSelector
                leagues={sleeperLeaguesAsLeagues}
                selectedLeagueId={selectedLeagueId}
                onSelect={handleLeagueSelect}
              />
              {isSelectedBestBall && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-300 dark:border-sky-700 flex-shrink-0" data-testid="badge-bestball-mobile">
                  Best Ball
                </Badge>
              )}
            </div>
          )}

          {/* Bottom strip: sync errors */}
          {sleeper.error && (
            <div className="mt-1">
              <span className="flex items-center gap-1 text-[11px] text-destructive" data-testid="text-sync-error">
                <AlertCircle className="w-3 h-3" />
                {sleeper.error}
              </span>
            </div>
          )}
        </div>
      </header>

      <MegaMenuNav
        tabs={NAV_CONFIG}
        activeTab={activeMainTab}
        activeSub={activeSubTab}
        setActiveTab={handleMainTabChange}
        onNavigate={(tab, sub) => { handleMainTabChange(tab); handleSubTabChange(sub); }}
      />

      <main className="max-w-7xl mx-auto px-2 sm:px-3 md:px-4 pt-5 pb-4 sm:py-6 md:py-8 md:pb-8 relative" style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
        {showLoadingOverlay && (
          <div className="absolute inset-0 z-30 flex items-start justify-center pt-24" data-testid="recalculating-overlay">
            <div className="bg-background/90 backdrop-blur-sm border border-border rounded-lg px-5 py-3 shadow-lg flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#d4af37] animate-spin" />
              <span className="text-sm font-semibold text-foreground">
                {isLeagueLoading ? "Loading league data..." : isLoading ? "Loading FantasyCalc values..." : "Recalculating league analysis..."}
              </span>
            </div>
          </div>
        )}
        <div
          className={`transition-opacity duration-180 ${isTransitioning || showLoadingOverlay ? "opacity-30" : "opacity-100"}`}
        >
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-[40vh]">
              <Loader2 className="w-6 h-6 animate-spin text-[#d4af37]" />
            </div>
          }>
            {renderContent()}
          </Suspense>
        </div>
      </main>
      <DataDiagnostics />
      <ShareDynastyPopup
        blocked={false}
        forceOpen={forceOpenShare}
        onForceOpenConsumed={() => setForceOpenShare(false)}
      />
      {/* DCC mounts only after AuthGate clears, so a non-null scUser is the
          authoritative signal that the user is signed in. The modal handles
          its own per-version localStorage gating. */}
      <WhatsNewModal
        isAuthenticated={!!scUser}
      />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <MobileBottomNav
        tabs={NAV_CONFIG}
        activeTab={activeMainTab}
        activeSub={activeSubTab}
        onNavigate={(tab, sub) => { handleMainTabChange(tab); if (sub) handleSubTabChange(sub); }}
      />
      {headerUpgradeOpen && (
        <UpgradeFlow onDone={() => setHeaderUpgradeOpen(false)} />
      )}
    </div>
  );
}
