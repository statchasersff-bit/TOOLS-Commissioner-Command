/**
 * Turn scored managers + the league snapshot into commissioner-facing alerts.
 *
 * Alerts use neutral, operations-desk language ("Inactive Risk", "Needs
 * Attention", "Follow-Up Recommended") — never judgmental wording. Each alert
 * carries a natural dedupe key (league, season, week, roster, alertType) so a
 * re-scan updates the existing alert rather than piling up duplicates.
 */
import type {
  ManagerActivityRow,
  LeagueSnapshotRow,
  ActivityAlertRow,
  ActivitySettings,
} from "./types";

export interface GenerateAlertsInput {
  leagueId: string;
  season: string;
  week: number;
  managers: ManagerActivityRow[];
  leagueSnapshot: LeagueSnapshotRow;
  settings: ActivitySettings;
}

export function generateActivityAlerts(input: GenerateAlertsInput): ActivityAlertRow[] {
  const { leagueId, season, week, managers, leagueSnapshot, settings } = input;
  const alerts: ActivityAlertRow[] = [];

  for (const m of managers) {
    // Orphan rosters (no owner) are surfaced as possible orphans in the manager
    // table, but they aren't a manager being negligent — skip the per-manager
    // activity alerts so empty seats don't spam "No Transactions" / "Empty
    // Starter" / "Inactive Manager Risk".
    if (!m.ownerId) continue;

    const base = {
      leagueId,
      season,
      week,
      rosterId: m.rosterId,
      ownerId: m.ownerId,
      status: "open" as const,
    };

    // Empty starter slot
    if (settings.flagEmptyStarters && m.emptyStarterSlots > 0) {
      alerts.push({
        ...base,
        alertType: "empty_starter",
        severity: m.emptyStarterSlots >= 2 ? "high" : "medium",
        title: "Empty Starter Slot",
        description: `${m.teamName} has ${m.emptyStarterSlots} empty starter slot(s) for Week ${week}.`,
      });
    }

    // No recent transactions
    if (
      settings.flagNoTransactions &&
      m.weeksSinceTransaction != null &&
      m.weeksSinceTransaction >= settings.inactiveTransactionWeeks
    ) {
      alerts.push({
        ...base,
        alertType: "no_transactions",
        severity: m.weeksSinceTransaction >= 5 ? "high" : "medium",
        title: "No Recent Transactions",
        description: `${m.teamName} has not made a transaction in ${m.weeksSinceTransaction} week(s).`,
      });
    }

    // Lineup unchanged (soft alert — a strong team may not need changes)
    if (
      settings.flagUnchangedLineups &&
      m.weeksSinceLineupChange != null &&
      m.weeksSinceLineupChange >= settings.unchangedLineupWeeks
    ) {
      alerts.push({
        ...base,
        alertType: "lineup_unchanged",
        severity: m.weeksSinceLineupChange >= 3 ? "high" : "low",
        title: "Lineup Has Not Changed",
        description: `${m.teamName} has used the same starting lineup for ${m.weeksSinceLineupChange} straight week(s).`,
      });
    }

    // Inactive manager risk
    if (m.inactivityRiskScore >= 50) {
      alerts.push({
        ...base,
        alertType: "inactive_manager_risk",
        severity: m.inactivityRiskScore >= 75 ? "critical" : "high",
        title: "Inactive Manager Risk",
        description: `${m.teamName} is showing multiple inactivity signals (risk score ${m.inactivityRiskScore}). Follow-up recommended.`,
      });
    }
  }

  // League-level: low activity
  if (
    settings.flagLowLeagueActivity &&
    leagueSnapshot.leagueActivityScore < settings.lowActivityScoreThreshold
  ) {
    alerts.push({
      leagueId,
      season,
      week,
      rosterId: null,
      ownerId: null,
      alertType: "low_league_activity",
      severity: leagueSnapshot.leagueActivityScore < 25 ? "high" : "medium",
      title: "Low League Activity",
      description: `This league had low transaction and lineup activity this week (score ${leagueSnapshot.leagueActivityScore}/100).`,
      status: "open",
    });
  }

  return alerts;
}
