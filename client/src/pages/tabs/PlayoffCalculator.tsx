import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
import { PlayoffOdds } from "./PlayoffOdds";

// Weekly Matchups was removed from the UI per Mak's request. The component
// (`./WeeklyMatchups`) and its server endpoint are intentionally left in
// place so re-enabling is a one-import change.
export function PlayoffCalculator() {
  const sleeper = useSleeper();
  const leagueId = sleeper.activeLeagueId;

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

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Playoff Calculator"
        subtitle="Monte Carlo playoff odds blending win-now value with your remaining schedule"
      />
      <PlayoffOdds leagueId={leagueId} />
    </div>
  );
}
