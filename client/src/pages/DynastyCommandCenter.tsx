import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MegaMenuNav, MobileBottomNav } from "@/components/MegaMenu";
import { LeagueSelector } from "@/components/LeagueSelector";
import { HeaderValueSourceBadge } from "@/components/ValueSourceSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_CONFIG } from "@/data/mockData";
import type { League, Team } from "@/types";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { DataDiagnostics } from "@/components/DataDiagnostics";
import { LayoutDashboard, Loader2, Lock, Check, User, RefreshCw, AlertCircle, Wifi, WifiOff, ChevronDown, LogOut, Trophy, ArrowRightLeft, TrendingUp, Zap, X, MessageSquare, HelpCircle } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";

import { PortfolioConnect, PortfolioSummary } from "./tabs/Portfolio";
import WaiverCommand from "./tabs/WaiverCommand";
import { DashboardOverview, DashboardSnapshot, MyTeam } from "./tabs/Dashboard";
import { RosterComparison } from "./tabs/LeagueAnalyzer";
import { FieldView } from "./tabs/FieldView";
import { ShareTeam } from "./tabs/ShareTeam";
import { TradeBlockScanner, TradeCalculator, TradeDatabase, TradeFinder } from "./tabs/TradeCenter";
import { BulkTrade } from "@/components/trade/BulkTrade";
import { PositionalAnalysis } from "./tabs/PositionalAnalysis";
import { MarketValue } from "./tabs/LeagueMarket";
import Analysis from "./tabs/Analysis";
import { LeagueEconomy } from "./tabs/LeagueEconomy";
import { API_BASE } from "@/lib/apiBase";
import Transactions from "./tabs/Transactions";
import { LineupCommand } from "./tabs/LineupCommand";
import TradeSync from "./tabs/TradeSync";
import { CompareRBs } from "./tabs/CompareRBs";
import { ShareDynastyPopup } from "@/components/ShareDynastyPopup";
import { AboutPage } from "@/components/AboutModal";
import { FeedbackPage } from "@/components/FeedbackPage";
import { TermsPage, PrivacyPage, CookiesPage } from "@/components/LegalModals";

const STORAGE_KEY = "sc-dynasty-state";

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { tab?: string; sub?: string; leagueId?: string };
  } catch {}
  return null;
}

function getInitialState(pathTab?: string, pathSub?: string) {
  const saved = loadSavedState();
  const requestedTab = pathTab || saved?.tab || "portfolio";
  const requestedSub = pathSub || saved?.sub || "portfolio-summary";

  if (requestedTab === "live-draft") {
    return { tab: "portfolio", sub: "portfolio-summary", leagueId: saved?.leagueId || null };
  }

  return {
    tab: requestedTab,
    sub: requestedSub,
    leagueId: saved?.leagueId || null,
  };
}


export default function DynastyCommandCenter({ params }: { params?: { tab?: string; sub?: string } }) {
  useEffect(() => { console.log("[app] DynastyCommandCenter mounted"); }, []);
  const [, setLocation] = useLocation();
  const initial = getInitialState(params?.tab, params?.sub);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(initial.leagueId);
  const [activeMainTab, setActiveMainTab] = useState(initial.tab);
  const [activeSubTab, setActiveSubTab] = useState(initial.sub);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fetchedLeague, setFetchedLeague] = useState<{ league: League; userTeamId: string | null } | null>(null);
  const [isLeagueLoading, setIsLeagueLoading] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  const [forceOpenShare, setForceOpenShare] = useState(false);

  const { isRecalculating, isLoading, getPlayerValue, getPickValue, calculateAllTeamMetrics, optimizeLineup } = useValueModel();
  const sleeper = useSleeper();
  const { user: scUser, logout: scLogout } = useAuth();

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
    if (!selectedLeagueId || !sleeper.isConnected || !sleeper.user) return;
    let cancelled = false;
    setIsLeagueLoading(true);

    fetchSleeperLeagueFull(selectedLeagueId, sleeper.user.userId)
      .then((data: { league: League; userTeamId: string | null }) => {
        if (cancelled) return;
        setFetchedLeague(data);
        setIsLeagueLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("League fetch error:", err);
        setFetchedLeague(null);
        setIsLeagueLoading(false);
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
        leagueId: selectedLeagueId,
      }));
    } catch {}
  }, [activeMainTab, activeSubTab, selectedLeagueId, setLocation]);

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
    setSelectedLeagueId(id);
    sleeper.setActiveLeague(id);
  }, [sleeper]);

  const handleMainTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    setActiveMainTab(id);
    const config = NAV_CONFIG.find((t) => t.id === id);
    if (config) setActiveSubTab(config.subTabs[0].id);
    setTimeout(() => setIsTransitioning(false), 180);
  }, []);

  const handleSubTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    setActiveSubTab(id);
    setTimeout(() => setIsTransitioning(false), 180);
  }, []);

  const navigateToSubTab = useCallback((mainTabId: string, subTabId: string) => {
    setIsTransitioning(true);
    setActiveMainTab(mainTabId);
    setActiveSubTab(subTabId);
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

  const renderSelectLeague = () => (
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

  const renderContent = () => {
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

    if (activeMainTab === "feedback") {
      return <FeedbackPage />;
    }

    if (activeMainTab === "terms") {
      return <TermsPage onNavigate={handleMainTabChange} />;
    }

    if (activeMainTab === "privacy") {
      return <PrivacyPage onNavigate={handleMainTabChange} />;
    }

    if (activeMainTab === "cookies") {
      return <CookiesPage onNavigate={handleMainTabChange} />;
    }

    if (activeMainTab === "portfolio") {
      const key = `portfolio:${activeSubTab}`;
      switch (key) {
        case "portfolio:connect":
          return <PortfolioConnect onNavigate={navigateToSubTab} />;
        case "portfolio:lineup-command":
          return <LineupCommand />;
        case "portfolio:portfolio-summary":
          return <PortfolioSummary />;
        case "portfolio:waiver-command":
          return <WaiverCommand />;
        default:
          return <PortfolioConnect onNavigate={navigateToSubTab} />;
      }
    }

    if (!sleeper.isConnected) {
      return renderLockedState();
    }

    if (activeMainTab === "trade-center" && activeSubTab === "trade-sync") {
      return <TradeSync />;
    }

    if (!league || !userTeam) {
      return renderSelectLeague();
    }

    const key = `${activeMainTab}:${activeSubTab}`;
    switch (key) {
      case "dashboard:my-team": return <MyTeam league={league} userTeam={userTeam} onNavigate={navigateToSubTab} />;
      case "dashboard:share-team": return <ShareTeam league={league} userTeam={userTeam} />;
      case "league-analyzer:power-rankings": return <DashboardSnapshot league={league} userTeam={userTeam} />;
      case "league-analyzer:roster-comparison": return <RosterComparison league={league} />;
      case "league-analyzer:transactions": return <Transactions leagueId={selectedLeagueId!} />;
      case "trade-center:trade-database": return <TradeDatabase league={league} />;
      case "trade-center:trade-calculator": return <TradeCalculator league={league} userTeam={userTeam} />;
      case "trade-center:positional-analysis": return <PositionalAnalysis league={league} userTeam={userTeam} />;
      case "trade-center:bulk-trade": return <BulkTrade league={league} userTeam={userTeam} />;
      case "trade-center:trade-block": return <TradeBlockScanner league={league} />;
      case "league-market:market-value": return <MarketValue league={league} />;
      case "league-market:analysis": return <Analysis />;
      case "league-market:compare-players": return <CompareRBs />;
      default: return <div className="text-center text-muted-foreground py-12">Select a tab to get started</div>;
    }
  };

  const showLoadingOverlay = isLeagueLoading || isRecalculating || (isLoading && selectedLeagueId && sleeper.isConnected);

  return (
    <div className="min-h-screen bg-background blueprint-bg">
      <header
        className="sticky top-0 z-50 md:border-b md:border-border/60 md:bg-background/95 md:backdrop-blur-sm md:shadow-none"
        style={{
          background: "rgba(5, 10, 24, 0.98)",
          borderBottom: "1px solid rgba(212, 175, 55, 0.16)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.30)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-3 py-[14px] md:py-3">
          <div className="flex items-center gap-3">

            {/* ── Logo (clickable menu trigger) ── */}
            <div className="relative flex-shrink-0 flex-1" ref={logoMenuRef}>
              <button
                onClick={() => setLogoMenuOpen(v => !v)}
                data-testid="button-logo-menu"
                className="flex items-center gap-2.5 rounded-xl transition-all duration-200 group"
                style={{ padding: "4px 8px 4px 4px", background: logoMenuOpen ? "rgba(212,175,55,0.07)" : "transparent", border: logoMenuOpen ? "1px solid rgba(212,175,55,0.20)" : "1px solid transparent" }}
              >
                <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center flex-shrink-0">
                  <img src={logoDark} alt="StatChasers" className="w-8 h-8 md:w-9 md:h-9 hidden dark:block" />
                  <img src={logoLight} alt="StatChasers" className="w-8 h-8 md:w-9 md:h-9 block dark:hidden" />
                </div>
                <div className="leading-none hidden md:block text-left">
                  <h1 className="text-sm md:text-base font-bold text-foreground leading-tight tracking-tight" data-testid="text-app-title">StatChasers</h1>
                  <p className="text-[10px] md:text-xs text-[#d4af37] font-semibold tracking-wide leading-tight mt-0.5">Dynasty Command</p>
                </div>
                <ChevronDown className={`w-3 h-3 text-white/30 group-hover:text-white/55 transition-transform duration-200 hidden md:block ${logoMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Logo dropdown menu */}
              {logoMenuOpen && (
                <div
                  className="absolute left-0 top-full mt-2 z-[55] overflow-hidden"
                  style={{ width: 240, borderRadius: 16, background: "rgba(5,10,24,0.98)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 40px rgba(0,0,0,0.50), 0 0 0 1px rgba(212,175,55,0.06)" }}
                >
                  {/* Brand header */}
                  <div className="px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(11,58,122,0.18) 0%, transparent 100%)" }}>
                    <div className="flex items-center gap-2.5">
                      <img src={logoDark} alt="StatChasers" className="w-7 h-7 hidden dark:block" />
                      <img src={logoLight} alt="StatChasers" className="w-7 h-7 block dark:hidden" />
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
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <a
                      href="https://discord.gg/34XkMXF6t3"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setLogoMenuOpen(false)}
                      className="flex items-center gap-1.5 text-[12px] font-semibold transition-colors"
                      style={{ color: "#5865F2" }}
                    >
                      <SiDiscord className="w-3.5 h-3.5" />
                      Discord
                    </a>
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

              {/* Connect button (when not connected) */}
              {!sleeper.isConnected && (
                <button
                  onClick={() => { handleMainTabChange("portfolio"); handleSubTabChange("connect"); }}
                  data-testid="button-header-connect"
                  className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm font-semibold rounded-md transition-all duration-200 text-[#d4af37] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Connect Sleeper</span>
                  <span className="md:hidden">Connect</span>
                </button>
              )}


              <HeaderValueSourceBadge />

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
                    <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border/60 bg-background shadow-lg shadow-black/10 dark:shadow-black/30 z-50 overflow-hidden">
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
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">@{sleeper.user?.username}</p>
                          {scUser?.email && <p className="text-[11px] text-muted-foreground truncate">{scUser.email}</p>}
                        </div>
                      </div>
                      {/* Sign out */}
                      <button
                        onClick={() => { setUserDropdownOpen(false); scLogout(); }}
                        data-testid="button-sign-out"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/8 border-t border-border/30 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Discord + ThemeToggle inline when not connected */
                <div className="flex items-center gap-1.5 border-l border-border/40 pl-2">
                  <a
                    href="https://discord.gg/34XkMXF6t3"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="button-discord"
                    className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold rounded-md transition-all duration-200 text-[#5865F2] bg-[#5865F2]/10 hover:bg-[#5865F2]/20 border border-[#5865F2]/25 hover:border-[#5865F2]/40"
                  >
                    <SiDiscord className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Discord</span>
                  </a>
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
          {renderContent()}
        </div>
      </main>
      <DataDiagnostics />
      <ShareDynastyPopup
        blocked={false}
        forceOpen={forceOpenShare}
        onForceOpenConsumed={() => setForceOpenShare(false)}
      />
      <MobileBottomNav
        tabs={NAV_CONFIG}
        activeTab={activeMainTab}
        activeSub={activeSubTab}
        onNavigate={(tab, sub) => { handleMainTabChange(tab); if (sub) handleSubTabChange(sub); }}
      />
    </div>
  );
}
