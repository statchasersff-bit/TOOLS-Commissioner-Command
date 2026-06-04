/**
 * Pure helper functions for League Activity Monitoring. No I/O — identity
 * resolution, label mapping, and small counting utilities shared across the
 * parsing / scoring services and mirrored by the UI so wording stays consistent.
 */
import type {
  SleeperRoster,
  SleeperLeagueUser,
  ActivityEvent,
  ActivityLabel,
  LeagueActivityLabel,
  InactivityRiskLabel,
  ManagerActivityFlag,
} from "./types";

export function buildUserMap(users: SleeperLeagueUser[]): Map<string, SleeperLeagueUser> {
  const map = new Map<string, SleeperLeagueUser>();
  for (const u of users ?? []) {
    if (u?.user_id) map.set(String(u.user_id), u);
  }
  return map;
}

export function buildRosterMap(rosters: SleeperRoster[]): Map<number, SleeperRoster> {
  const map = new Map<number, SleeperRoster>();
  for (const r of rosters ?? []) {
    if (r?.roster_id != null) map.set(Number(r.roster_id), r);
  }
  return map;
}

export function getOwnerIdForRoster(rosters: SleeperRoster[], rosterId: number): string | null {
  const r = (rosters ?? []).find((x) => Number(x.roster_id) === Number(rosterId));
  return r?.owner_id ? String(r.owner_id) : null;
}

/** Manager handle: display name → username → "Manager N". */
export function getManagerDisplayName(
  user: SleeperLeagueUser | undefined,
  roster: SleeperRoster | undefined,
): string {
  if (user?.display_name) return user.display_name;
  if (user?.username) return user.username;
  if (roster?.roster_id != null) return `Manager ${roster.roster_id}`;
  return "Unknown Manager";
}

/** Team name: Sleeper team metadata → manager handle → "Team N". */
export function getTeamName(
  user: SleeperLeagueUser | undefined,
  roster: SleeperRoster | undefined,
): string {
  const meta = user?.metadata?.team_name;
  if (meta && meta.trim()) return meta.trim();
  if (user?.display_name) return `${user.display_name}'s Team`;
  if (roster?.roster_id != null) return `Team ${roster.roster_id}`;
  return "Unowned Team";
}

// ── Per-roster event counts ──────────────────────────────────────────────────

export function countTransactionTypesForRoster(events: ActivityEvent[], rosterId: number) {
  const forRoster = events.filter((e) => Number(e.rosterId) === Number(rosterId));
  return {
    transactionsCount: forRoster.filter((e) =>
      e.eventType === "trade" || e.eventType === "waiver" || e.eventType === "free_agent",
    ).length,
    tradesCount: forRoster.filter((e) => e.eventType === "trade").length,
    waiverCount: forRoster.filter((e) => e.eventType === "waiver").length,
    freeAgentCount: forRoster.filter((e) => e.eventType === "free_agent").length,
  };
}

export function countLineupEventsForRoster(events: ActivityEvent[], rosterId: number) {
  const forRoster = events.filter((e) => Number(e.rosterId) === Number(rosterId));
  const changes = forRoster.filter((e) => e.eventType === "lineup_change");
  const emptyEvents = forRoster.filter((e) => e.eventType === "empty_starter");
  return {
    lineupChanged: changes.length > 0,
    lineupChangeCount: changes.reduce(
      (sum, e) => sum + (Number((e.rawEvent as any)?.changeCount) || 1),
      0,
    ),
    // The empty_starter event carries the count; default to 1.
    emptyStarterSlots: emptyEvents.reduce(
      (sum, e) => sum + (Number((e.rawEvent as any)?.emptyStarterSlots) || 1),
      0,
    ),
  };
}

// ── Label maps (mirrored in the UI) ──────────────────────────────────────────

export function getActivityLabel(score: number): ActivityLabel {
  if (score >= 80) return "highly_active";
  if (score >= 60) return "active";
  if (score >= 40) return "quiet";
  if (score >= 20) return "inactive_risk";
  return "inactive";
}

export function getInactivityRiskLabel(score: number): InactivityRiskLabel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function getLeagueActivityLabel(score: number): LeagueActivityLabel {
  if (score >= 85) return "thriving";
  if (score >= 70) return "healthy";
  if (score >= 50) return "average";
  if (score >= 30) return "low_activity";
  return "at_risk";
}

export const ACTIVITY_LABEL_DISPLAY: Record<ActivityLabel, string> = {
  highly_active: "Highly Active",
  active: "Active",
  quiet: "Quiet",
  inactive_risk: "Inactive Risk",
  inactive: "Inactive",
  unknown: "Unknown",
};

export const LEAGUE_LABEL_DISPLAY: Record<LeagueActivityLabel, string> = {
  thriving: "Thriving",
  healthy: "Healthy",
  average: "Average",
  low_activity: "Low Activity",
  at_risk: "At Risk",
  unknown: "Unknown",
};

export const MANAGER_FLAG_DISPLAY: Record<ManagerActivityFlag, string> = {
  no_recent_transactions: "No Recent Moves",
  lineup_unchanged: "Lineup Unchanged",
  empty_starter: "Empty Starter",
  low_activity_score: "Low Activity",
  high_inactivity_risk: "Follow-Up Recommended",
  possible_orphan_risk: "Orphan Risk",
};

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Determine which weeks to scan given the current week and a mode. */
export function getWeeksToScan(currentWeek: number, mode: "recent" | "season" | number[]): number[] {
  if (Array.isArray(mode)) return mode.filter((w) => w >= 1);
  if (mode === "season") {
    return Array.from({ length: Math.max(1, currentWeek) }, (_, i) => i + 1);
  }
  // "recent" — previous + current week (deduped, floored at 1).
  return Array.from(new Set([Math.max(1, currentWeek - 1), Math.max(1, currentWeek)]));
}
