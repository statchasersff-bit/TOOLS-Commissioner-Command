import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
import { PlayoffOdds } from "./PlayoffOdds";
import { WeeklyMatchups } from "./WeeklyMatchups";
import { Calculator, Swords } from "lucide-react";

type PCTab = "odds" | "matchups";

export function PlayoffCalculator() {
  const sleeper = useSleeper();
  const leagueId = sleeper.activeLeagueId;
  const [innerTab, setInnerTab] = useState<PCTab>("odds");

  if (!leagueId) {
    return (
      <div className="space-y-5">
        <SectionHeader title="Playoff Calculator" subtitle="Monte Carlo playoff odds for your league" />
        <Card className="p-8 text-center text-muted-foreground" data-testid="pc-empty">
          Select a league to view playoff odds.
        </Card>
      </div>
    );
  }

  const innerToggle = (
    <div
      className="grid flex-shrink-0 w-[90vw] md:w-[320px]"
      style={{
        gridTemplateColumns: "1fr 1fr",
        height: 48,
        borderRadius: 16,
        padding: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        gap: 4,
      }}
      data-testid="pc-inner-toggle"
    >
      {(["odds", "matchups"] as const).map((tab) => {
        const isActive = innerTab === tab;
        const Icon = tab === "odds" ? Calculator : Swords;
        const label = tab === "odds" ? "Playoff Odds" : "Matchups";
        return (
          <button
            key={tab}
            onClick={() => setInnerTab(tab)}
            data-testid={`pc-inner-tab-${tab}`}
            className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
            style={{
              borderRadius: 12,
              fontSize: 13,
              letterSpacing: "0.01em",
              background: isActive
                ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)"
                : "transparent",
              color: isActive ? "#fff" : "var(--sc-toggle-inactive-text)",
              border: isActive
                ? "1px solid rgba(212,175,55,0.30)"
                : "1px solid transparent",
              boxShadow: isActive
                ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "none",
            }}
          >
            <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
            {label}
            {isActive && (
              <span
                className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full"
                style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          title="Playoff Calculator"
          subtitle={
            innerTab === "odds"
              ? "Monte Carlo playoff odds blending win-now value with your remaining schedule"
              : "Weekly matchups with win-now matchup edges and upset watch"
          }
        />
        <div className="w-full md:w-auto md:ml-auto flex justify-center">{innerToggle}</div>
      </div>
      {innerTab === "odds" ? (
        <PlayoffOdds leagueId={leagueId} />
      ) : (
        <WeeklyMatchups leagueId={leagueId} />
      )}
    </div>
  );
}
