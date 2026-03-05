import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MainTabs } from "@/components/MainTabs";
import { SubTabs } from "@/components/SubTabs";
import { LeagueSelector } from "@/components/LeagueSelector";
import { ValueSourceSelector, ValueAttribution } from "@/components/ValueSourceSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useValueModel } from "@/contexts/ValueModelContext";
import { NAV_CONFIG, getLeagues } from "@/data/mockData";
import type { League, Team } from "@/types";
import { Share2, Download, LayoutDashboard, Loader2 } from "lucide-react";

import { DashboardOverview, DashboardSnapshot, DashboardKeyInsights } from "./tabs/Dashboard";
import { PowerRankings, TierBreakdown, RosterComparison } from "./tabs/LeagueAnalyzer";
import { RosterStrength, AgeCurve, DepthChart } from "./tabs/TeamBreakdown";
import { TradeFinder, TradeTargets, TradeBlockScanner } from "./tabs/TradeCenter";
import { PickValue, PickDistribution } from "./tabs/DraftCapital";
import { PositionalSurplus, MarketValue } from "./tabs/LeagueMarket";
import { TeamInsights, LeagueTrends } from "./tabs/Insights";

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
    tab: urlTab || saved?.tab || "dashboard",
    sub: urlSub || saved?.sub || "overview",
    leagueId: saved?.leagueId || null,
  };
}

export default function DynastyCommandCenter() {
  const leagues = getLeagues();
  const initial = getInitialState();
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(initial.leagueId);
  const [activeMainTab, setActiveMainTab] = useState(initial.tab);
  const [activeSubTab, setActiveSubTab] = useState(initial.sub);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { isRecalculating, isLoading, getPlayerValue, getPickValue, calculateMetrics } = useValueModel();

  const rawLeague = leagues.find((l) => l.id === selectedLeagueId) || null;

  const league: League | null = useMemo(() => {
    if (!rawLeague) return null;
    return {
      ...rawLeague,
      teams: rawLeague.teams.map((team) => {
        const roster = team.roster.map((p) => ({ ...p, value: getPlayerValue(p) }));
        const picks = team.picks.map((p) => ({ ...p, value: getPickValue(p) }));
        const adjustedTeam = { ...team, roster, picks };
        return { ...adjustedTeam, metrics: calculateMetrics(adjustedTeam) };
      }),
    };
  }, [rawLeague, getPlayerValue, getPickValue, calculateMetrics]);

  const userTeam = league?.teams[0] || null;
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
    if (!rawLeague) {
      setActiveMainTab("dashboard");
      setActiveSubTab("overview");
    }
  }, [rawLeague]);

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

  const renderContent = () => {
    if (!league || !userTeam) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="p-10 text-center max-w-md">
            <div className="mx-auto w-16 h-16 rounded-full bg-[#0b3a7a]/8 dark:bg-blue-400/10 flex items-center justify-center mb-5">
              <LayoutDashboard className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold mb-2" data-testid="text-empty-state">Select a League to Begin</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Choose a league from the dropdown above to explore your dynasty command center with power rankings, trade tools, and deep roster analysis.
            </p>
          </Card>
        </div>
      );
    }

    const key = `${activeMainTab}:${activeSubTab}`;
    switch (key) {
      case "dashboard:overview": return <DashboardOverview league={league} userTeam={userTeam} onNavigate={navigateToSubTab} />;
      case "dashboard:snapshot": return <DashboardSnapshot league={league} />;
      case "dashboard:key-insights": return <DashboardKeyInsights league={league} userTeam={userTeam} />;
      case "league-analyzer:power-rankings": return <PowerRankings league={league} />;
      case "league-analyzer:tier-breakdown": return <TierBreakdown league={league} />;
      case "league-analyzer:roster-comparison": return <RosterComparison league={league} />;
      case "team-breakdown:roster-strength": return <RosterStrength league={league} userTeam={userTeam} />;
      case "team-breakdown:age-curve": return <AgeCurve userTeam={userTeam} />;
      case "team-breakdown:depth-chart": return <DepthChart userTeam={userTeam} />;
      case "trade-center:trade-finder": return <TradeFinder league={league} userTeam={userTeam} />;
      case "trade-center:trade-targets": return <TradeTargets league={league} userTeam={userTeam} />;
      case "trade-center:trade-block": return <TradeBlockScanner league={league} />;
      case "draft-capital:pick-value": return <PickValue league={league} userTeam={userTeam} />;
      case "draft-capital:pick-distribution": return <PickDistribution league={league} />;
      case "league-market:positional-surplus": return <PositionalSurplus league={league} />;
      case "league-market:market-value": return <MarketValue league={league} />;
      case "insights:team-insights": return <TeamInsights league={league} />;
      case "insights:league-trends": return <LeagueTrends league={league} />;
      default: return <div className="text-center text-muted-foreground py-12">Select a tab to get started</div>;
    }
  };

  return (
    <div className="min-h-screen bg-background blueprint-bg">
      <header className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3.5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-[#0b3a7a] flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">SC</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-foreground leading-tight tracking-tight" data-testid="text-app-title">
                  StatChasers
                </h1>
                <p className="text-xs text-[#d4af37] font-semibold tracking-wide">Dynasty Command Center</p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:inline">League:</span>
                <LeagueSelector
                  leagues={leagues}
                  selectedLeagueId={selectedLeagueId}
                  onSelect={handleLeagueSelect}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:inline">Value:</span>
                <ValueSourceSelector />
              </div>
              <div className="flex items-center gap-1.5 border-l border-border/50 pl-3">
                <Button variant="outline" size="sm" disabled data-testid="button-share">
                  <Share2 className="w-3 h-3 mr-1" /> Share
                </Button>
                <Button variant="outline" size="sm" disabled data-testid="button-export">
                  <Download className="w-3 h-3 mr-1" /> Export
                </Button>
                <ThemeToggle />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-1">
            <ValueAttribution />
          </div>
        </div>
      </header>

      <MainTabs tabs={NAV_CONFIG} activeTab={activeMainTab} setActiveTab={handleMainTabChange} />

      {currentMainConfig && (
        <SubTabs tabs={currentMainConfig.subTabs} activeTab={activeSubTab} setActiveTab={handleSubTabChange} />
      )}

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 relative">
        {isRecalculating && (
          <div className="absolute inset-0 z-30 flex items-start justify-center pt-24" data-testid="recalculating-overlay">
            <div className="bg-background/90 backdrop-blur-sm border border-border rounded-lg px-5 py-3 shadow-lg flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#d4af37] animate-spin" />
              <span className="text-sm font-semibold text-foreground">Recalculating league analysis...</span>
            </div>
          </div>
        )}
        <div
          className={`transition-opacity duration-180 ${isTransitioning || isRecalculating ? "opacity-30" : "opacity-100"}`}
        >
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
