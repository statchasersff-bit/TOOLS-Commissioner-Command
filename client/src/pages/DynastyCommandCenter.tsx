import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MainTabs } from "@/components/MainTabs";
import { SubTabs } from "@/components/SubTabs";
import { LeagueSelector } from "@/components/LeagueSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NAV_CONFIG, getLeagues } from "@/data/mockData";
import type { League } from "@/types";
import { Share2, Download, LayoutDashboard } from "lucide-react";

import { DashboardOverview, DashboardSnapshot, DashboardKeyInsights } from "./tabs/Dashboard";
import { PowerRankings, TierBreakdown, RosterComparison } from "./tabs/LeagueAnalyzer";
import { RosterStrength, AgeCurve, DepthChart } from "./tabs/TeamBreakdown";
import { TradeFinder, TradeTargets, TradeBlockScanner } from "./tabs/TradeCenter";
import { PickValue, PickDistribution } from "./tabs/DraftCapital";
import { PositionalSurplus, MarketValue } from "./tabs/LeagueMarket";
import { TeamInsights, LeagueTrends } from "./tabs/Insights";

function getInitialState() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get("tab") || "dashboard",
    sub: params.get("sub") || "overview",
  };
}

export default function DynastyCommandCenter() {
  const leagues = getLeagues();
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const initial = getInitialState();
  const [activeMainTab, setActiveMainTab] = useState(initial.tab);
  const [activeSubTab, setActiveSubTab] = useState(initial.sub);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const league = leagues.find((l) => l.id === selectedLeagueId) || null;
  const userTeam = league?.teams[0] || null;
  const currentMainConfig = NAV_CONFIG.find((t) => t.id === activeMainTab);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeMainTab);
    url.searchParams.set("sub", activeSubTab);
    window.history.replaceState({}, "", url.toString());
  }, [activeMainTab, activeSubTab]);

  const handleMainTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    setActiveMainTab(id);
    const config = NAV_CONFIG.find((t) => t.id === id);
    if (config) setActiveSubTab(config.subTabs[0].id);
    setTimeout(() => setIsTransitioning(false), 150);
  }, []);

  const handleSubTabChange = useCallback((id: string) => {
    setIsTransitioning(true);
    setActiveSubTab(id);
    setTimeout(() => setIsTransitioning(false), 150);
  }, []);

  const renderContent = () => {
    if (!league || !userTeam) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="p-8 text-center max-w-md">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-500/10 flex items-center justify-center mb-4">
              <LayoutDashboard className="w-6 h-6 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2" data-testid="text-empty-state">Select a League to Begin</h3>
            <p className="text-sm text-muted-foreground">
              Choose a league from the dropdown above to explore your dynasty command center.
            </p>
          </Card>
        </div>
      );
    }

    const key = `${activeMainTab}:${activeSubTab}`;
    switch (key) {
      case "dashboard:overview": return <DashboardOverview league={league} userTeam={userTeam} />;
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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#0b3a7a] flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">SC</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground leading-tight" data-testid="text-app-title">
                StatChasers
              </h1>
              <p className="text-xs text-[#d4af37] font-medium">Dynasty Command Center</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <LeagueSelector
              leagues={leagues}
              selectedLeagueId={selectedLeagueId}
              onSelect={setSelectedLeagueId}
            />
            <Button variant="outline" size="sm" disabled data-testid="button-share">
              <Share2 className="w-3 h-3 mr-1" /> Share
            </Button>
            <Button variant="outline" size="sm" disabled data-testid="button-export">
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <MainTabs tabs={NAV_CONFIG} activeTab={activeMainTab} setActiveTab={handleMainTabChange} />

      {currentMainConfig && (
        <SubTabs tabs={currentMainConfig.subTabs} activeTab={activeSubTab} setActiveTab={handleSubTabChange} />
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div
          className={`transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}
        >
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
