import { useCallback } from "react";
import { useLocation } from "wouter";
import { useSleeper } from "@/contexts/SleeperContext";

// Module keys mapped to the existing /:tab/:sub route segments. To add support
// for a new module's league view, add an entry here — call sites never need to
// know the route shape.
export type ModuleKey = "trades" | "finance";

const MODULE_ROUTES: Record<ModuleKey, { tab: string; sub: string }> = {
  trades:  { tab: "trade-center", sub: "trade-review" },
  finance: { tab: "portfolio", sub: "finances" },
};

export function useActiveLeagueNavigation() {
  const sleeper = useSleeper();
  const [, setLocation] = useLocation();

  // Set the shared active league THEN navigate. Calling setActiveLeague before
  // navigation means the destination module reads the new value on its first
  // render — no flash of the previous league.
  const goToLeagueView = useCallback((moduleKey: ModuleKey, leagueId: string) => {
    sleeper.setActiveLeague(leagueId);
    const route = MODULE_ROUTES[moduleKey];
    setLocation(`/${route.tab}/${route.sub}`);
  }, [sleeper, setLocation]);

  return {
    activeLeagueId: sleeper.activeLeagueId,
    activeLeague: sleeper.activeLeague,
    setActiveLeague: sleeper.setActiveLeague,
    goToLeagueView,
  };
}
