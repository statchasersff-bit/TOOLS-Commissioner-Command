import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
import { BarChart3, Swords } from "lucide-react";
import { PlayoffOdds } from "./PlayoffOdds";
import { WeeklyMatchups } from "./WeeklyMatchups";

type SubTab = "odds" | "matchups";

const SUB_TABS = [
  {
    id: "odds" as const,
    label: "Playoff Odds",
    icon: BarChart3,
    subtitle: "Monte Carlo playoff odds blending win-now value with your remaining schedule",
  },
  {
    id: "matchups" as const,
    label: "Weekly Matchups",
    icon: Swords,
    subtitle: "Every matchup, grouped by week, with projected win probabilities",
  },
];

function renderSubTabButton(
  tab: typeof SUB_TABS[number],
  isActive: boolean,
  onClick: () => void,
  testIdSuffix?: string,
) {
  const Icon = tab.icon;
  return (
    <button
      key={tab.id}
      onClick={onClick}
      data-testid={`pc-tab-${tab.id}${testIdSuffix ? `-${testIdSuffix}` : ""}`}
      className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
      style={{
        borderRadius: 12,
        fontSize: 13,
        letterSpacing: "0.01em",
        background: isActive
          ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)"
          : "transparent",
        color: isActive ? "#fff" : "rgba(203,213,225,0.45)",
        border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent",
        boxShadow: isActive
          ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "none",
      }}
    >
      <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
      {tab.label}
      {isActive && (
        <span
          className="absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full"
          style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }}
        />
      )}
    </button>
  );
}

export function PlayoffCalculator() {
  const sleeper = useSleeper();
  const leagueId = sleeper.activeLeagueId;
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("odds");

  const subtitle = SUB_TABS.find((t) => t.id === activeSubTab)?.subtitle ?? "";

  if (!leagueId) {
    return (
      <div className="space-y-5">
        <SectionHeader title="Playoff Calculator" subtitle="Monte Carlo playoff odds for your league" />
        <Card className="p-8 text-center text-muted-foreground" data-testid="pc-empty">
          {activeSubTab === "matchups"
            ? "Select a league to view weekly matchups."
            : "Select a league to view playoff odds."}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header row: title on the left, desktop pill switcher on the right */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="Playoff Calculator" subtitle={subtitle} />
        <div className="hidden md:flex items-center gap-2 flex-shrink-0 pt-1">
          <div
            className="grid flex-shrink-0"
            style={{
              gridTemplateColumns: "1fr 1fr",
              height: 48,
              borderRadius: 16,
              padding: 4,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              gap: 4,
              width: 300,
            }}
          >
            {SUB_TABS.map((tab) =>
              renderSubTabButton(tab, activeSubTab === tab.id, () => setActiveSubTab(tab.id), "desktop"),
            )}
          </div>
        </div>
      </div>

      {/* Mobile switcher */}
      <div className="md:hidden flex justify-center sm:justify-start !mt-0">
        <div
          className="grid w-full sm:w-auto"
          style={{
            gridTemplateColumns: "1fr 1fr",
            maxWidth: 420,
            height: 48,
            borderRadius: 16,
            padding: 4,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            gap: 4,
          }}
        >
          {SUB_TABS.map((tab) =>
            renderSubTabButton(tab, activeSubTab === tab.id, () => setActiveSubTab(tab.id)),
          )}
        </div>
      </div>

      {activeSubTab === "odds" && <PlayoffOdds leagueId={leagueId} />}
      {activeSubTab === "matchups" && <WeeklyMatchups leagueId={leagueId} />}
    </div>
  );
}
