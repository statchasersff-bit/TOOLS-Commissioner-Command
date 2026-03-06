import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MainTabs, MobileMenuButton } from "@/components/MainTabs";
import { SubTabs } from "@/components/SubTabs";
import { LeagueSelector } from "@/components/LeagueSelector";
import { ValueSourceSelector, ValueAttribution } from "@/components/ValueSourceSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { NAV_CONFIG } from "@/data/mockData";
import type { League, Team } from "@/types";
import { DataDiagnostics } from "@/components/DataDiagnostics";
import { Share2, Download, LayoutDashboard, Loader2, Lock, Check, User } from "lucide-react";

import { PortfolioConnect, PortfolioMyLeagues, PortfolioSummary } from "./tabs/Portfolio";
import { DashboardOverview, DashboardSnapshot } from "./tabs/Dashboard";
import { RosterComparison } from "./tabs/LeagueAnalyzer";
import { RosterBreakdown } from "./tabs/TeamBreakdown";
import { TradeTargets, TradeBlockScanner, TradeCalculator, TradeDatabase } from "./tabs/TradeCenter";
import { PositionalAnalysis } from "./tabs/PositionalAnalysis";
import { MarketValue } from "./tabs/LeagueMarket";
import { LeagueIntelligence } from "./tabs/Insights";
import { LeagueEconomy } from "./tabs/LeagueEconomy";
import LiveDraft from "./tabs/LiveDraft";
import Transactions from "./tabs/Transactions";

const STORAGE_KEY = "sc-dynasty-state";

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { tab?: string; sub?: string; leagueId?: string };
  } catch {}
  return null;
}

function getInitialState() {
  const params = new URLSearchParams(window.location.search);
  const saved = loadSavedState();
  const urlTab = params.get("tab");
  const urlSub = params.get("sub");

  return {
    tab: urlTab || saved?.tab || "portfolio",
    sub: urlSub || saved?.sub || "connect",
    leagueId: saved?.leagueId || null,
  };
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DynastyCommandCenter() {
  const initial = getInitialState();
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(initial.leagueId);
  const [activeMainTab, setActiveMainTab] = useState(initial.tab);
  const [activeSubTab, setActiveSubTab] = useState(initial.sub);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fetchedLeague, setFetchedLeague] = useState<{ league: League; userTeamId: string | null } | null>(null);
  const [isLeagueLoading, setIsLeagueLoading] = useState(false);

  const { isRecalculating, isLoading, getPlayerValue, getPickValue, calculateAllTeamMetrics, optimizeLineup } = useValueModel();
  const sleeper = useSleeper();

  const sleeperLeaguesAsLeagues = useMemo(() => {
    return sleeper.leagues.map((sl) => ({
      id: sl.leagueId,
      name: sl.name,
      platform: "sleeper" as string,
      scoringFormat: `${sl.scoringFormat} ${sl.format}`,
      teams: [] as Team[],
    }));
  }, [sleeper.leagues]);

  useEffect(() => {
    if (!selectedLeagueId || !sleeper.isConnected || !sleeper.user) return;
    let cancelled = false;
    setIsLeagueLoading(true);

    fetch(`/api/sleeper/league/${selectedLeagueId}/full?userId=${sleeper.user.userId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch league");
        return r.json();
      })
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
        metrics: metricsMap.get(team.id) || { overall: 50, starters: 50, depth: 50, youth: 50, picks: 50, qb: 50, rb: 50, wr: 50, te: 50, contenderWindowYears: 2 },
      })),
    };
  }, [fetchedLeague, getPlayerValue, getPickValue, calculateAllTeamMetrics, optimizeLineup]);

  const userTeam = useMemo(() => {
    if (!league || !fetchedLeague?.userTeamId) return league?.teams[0] || null;
    return league.teams.find((t) => t.id === fetchedLeague.userTeamId) || league.teams[0] || null;
  }, [league, fetchedLeague]);

  const currentMainConfig = NAV_CONFIG.find((t) => t.id === activeMainTab);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeMainTab);
    url.searchParams.set("sub", activeSubTab);
    window.history.replaceState({}, "", url.toString());

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tab: activeMainTab,
        sub: activeSubTab,
        leagueId: selectedLeagueId,
      }));
    } catch {}
  }, [activeMainTab, activeSubTab, selectedLeagueId]);

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

  const handlePortfolioLeagueSelect = useCallback((leagueId: string) => {
    setSelectedLeagueId(leagueId);
    sleeper.setActiveLeague(leagueId);
  }, [sleeper]);

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
          onClick={() => navigateToSubTab("portfolio", "my-leagues")}
          data-testid="button-go-to-leagues"
        >
          Go to My Leagues
        </Button>
      </Card>
    </div>
  );

  const renderContent = () => {
    if (activeMainTab === "live-draft") {
      return <LiveDraft />;
    }

    if (activeMainTab === "portfolio") {
      const key = `portfolio:${activeSubTab}`;
      switch (key) {
        case "portfolio:connect":
          return <PortfolioConnect />;
        case "portfolio:my-leagues":
          return <PortfolioMyLeagues onSelectLeague={handlePortfolioLeagueSelect} onNavigate={navigateToSubTab} />;
        case "portfolio:portfolio-summary":
          return <PortfolioSummary />;
        default:
          return <PortfolioConnect />;
      }
    }

    if (!sleeper.isConnected) {
      return renderLockedState();
    }

    if (!league || !userTeam) {
      return renderSelectLeague();
    }

    const key = `${activeMainTab}:${activeSubTab}`;
    switch (key) {
      case "dashboard:overview": return <DashboardOverview league={league} userTeam={userTeam} onNavigate={navigateToSubTab} />;
      case "league-analyzer:power-rankings": return <DashboardSnapshot league={league} userTeam={userTeam} />;
      case "league-analyzer:league-intelligence": return <LeagueIntelligence league={league} userTeam={userTeam} />;
      case "league-analyzer:league-economy": return <LeagueEconomy league={league} />;
      case "league-analyzer:roster-comparison": return <RosterComparison league={league} />;
      case "league-analyzer:transactions": return <Transactions />;
      case "dashboard:roster-breakdown": return <RosterBreakdown league={league} userTeam={userTeam} />;
      case "trade-center:trade-database": return <TradeDatabase league={league} />;
      case "trade-center:trade-calculator": return <TradeCalculator league={league} userTeam={userTeam} />;
      case "trade-center:positional-analysis": return <PositionalAnalysis league={league} userTeam={userTeam} />;
      case "trade-center:trade-targets": return <TradeTargets league={league} userTeam={userTeam} />;
      case "trade-center:trade-block": return <TradeBlockScanner league={league} />;
      case "league-market:market-value": return <MarketValue league={league} />;
      default: return <div className="text-center text-muted-foreground py-12">Select a tab to get started</div>;
    }
  };

  const showLoadingOverlay = isLeagueLoading || isRecalculating || (isLoading && selectedLeagueId && sleeper.isConnected);

  return (
    <div className="min-h-screen bg-background blueprint-bg">
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-2.5 md:py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-[#0b3a7a] flex items-center justify-center flex-shrink-0 shadow-sm shadow-[#0b3a7a]/20">
                <span className="text-white font-bold text-xs md:text-sm tracking-tight">SC</span>
              </div>
              <div className="leading-none">
                <h1 className="text-sm md:text-base font-bold text-foreground leading-tight tracking-tight" data-testid="text-app-title">
                  StatChasers
                </h1>
                <p className="text-[10px] md:text-xs text-[#d4af37] font-semibold tracking-wide leading-tight mt-0.5">Dynasty Command Center</p>
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              {sleeper.isConnected && sleeper.user && (
                <div className="hidden md:flex items-center gap-1.5 border-r border-border/40 pr-3">
                  <div className="w-6 h-6 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-3 h-3 text-[#0b3a7a] dark:text-blue-400" />
                  </div>
                  <span className="text-xs font-medium text-foreground" data-testid="text-sleeper-user">
                    {sleeper.user.displayName}
                  </span>
                </div>
              )}

              {sleeper.isConnected && (
                <div className="hidden md:flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">League:</span>
                  <LeagueSelector
                    leagues={sleeperLeaguesAsLeagues}
                    selectedLeagueId={selectedLeagueId}
                    onSelect={handleLeagueSelect}
                  />
                </div>
              )}

              <div className="hidden md:flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Value:</span>
                <ValueSourceSelector />
              </div>

              <div className="hidden md:flex items-center gap-1.5 border-l border-border/40 pl-3">
                <Button variant="outline" size="sm" disabled data-testid="button-share">
                  <Share2 className="w-3 h-3 mr-1" /> Share
                </Button>
                <Button variant="outline" size="sm" disabled data-testid="button-export">
                  <Download className="w-3 h-3 mr-1" /> Export
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <ThemeToggle />
                <MobileMenuButton tabs={NAV_CONFIG} activeTab={activeMainTab} setActiveTab={handleMainTabChange} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 mt-1.5 md:hidden">
            {sleeper.isConnected && (
              <LeagueSelector
                leagues={sleeperLeaguesAsLeagues}
                selectedLeagueId={selectedLeagueId}
                onSelect={handleLeagueSelect}
              />
            )}
            <ValueSourceSelector />
          </div>

          <div className="flex items-center justify-end gap-2 mt-1">
            {sleeper.isConnected && sleeper.lastSyncTime && (
              <Badge variant="outline" className="text-[9px] md:text-[10px] font-medium" data-testid="badge-sync-status">
                Synced {formatTimeAgo(sleeper.lastSyncTime)}
              </Badge>
            )}
            <ValueAttribution />
          </div>
        </div>
      </header>

      <MainTabs tabs={NAV_CONFIG} activeTab={activeMainTab} setActiveTab={handleMainTabChange} />

      {currentMainConfig && (
        <SubTabs tabs={currentMainConfig.subTabs} activeTab={activeSubTab} setActiveTab={handleSubTabChange} />
      )}

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-6 md:py-8 relative">
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
    </div>
  );
}
