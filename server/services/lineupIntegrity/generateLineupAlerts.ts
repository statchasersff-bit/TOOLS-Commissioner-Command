/**
 * Turn a scored lineup check into actionable, NEUTRALLY-worded alerts.
 *
 * Wording rule: alerts describe signals and recommend review — they never
 * accuse. "Potential Tanking Signal", not "tanking confirmed".
 */
import type {
  LineupCheckRow,
  LineupAlertRow,
  LineupIntegritySettings,
  AlertSeverity,
} from "./types";

export interface AlertContext {
  repeatIssueCount: number;
  playoffImpactMatchup: boolean;
  /** Starters were identical to last week despite a bye/inactive/IR starter. */
  unchangedLineup?: boolean;
}

export function generateLineupAlerts(
  check: LineupCheckRow,
  settings: LineupIntegritySettings,
  ctx: AlertContext,
): LineupAlertRow[] {
  const alerts: LineupAlertRow[] = [];
  const team = check.teamName || check.managerName || `Roster ${check.rosterId}`;
  const wk = check.week;

  const base = {
    leagueId: check.leagueId,
    season: check.season,
    week: check.week,
    rosterId: check.rosterId,
    ownerId: check.ownerId,
  };

  if (settings.enableEmptySlotChecks && check.emptyStarterSlots > 0) {
    alerts.push({
      ...base,
      alertType: "empty_starter",
      severity: check.emptyStarterSlots >= 2 ? "critical" : "high",
      title: "Empty Starter Slot",
      description: `${team} has ${plural(check.emptyStarterSlots, "empty starter slot")} for Week ${wk}.`,
      suggestedAction:
        "Send a lineup reminder and document whether the manager corrected the issue before kickoff.",
    });
  }

  if (settings.enableByeStarterChecks && check.byeStarters > 0) {
    alerts.push({
      ...base,
      alertType: "bye_starter",
      severity: check.byeStarters >= 2 ? "high" : "medium",
      title: "Bye-Week Starter",
      description: `${team} started ${plural(check.byeStarters, "player")} on bye in Week ${wk}.`,
      suggestedAction: "Send a lineup reminder before kickoff.",
    });
  }

  if (settings.enableOutStarterChecks && check.inactiveStarters > 0) {
    alerts.push({
      ...base,
      alertType: "inactive_starter",
      severity: check.inactiveStarters >= 2 ? "critical" : "high",
      title: "Inactive Starter",
      description: `${team} has ${plural(check.inactiveStarters, "inactive/OUT player")} in the starting lineup for Week ${wk}.`,
      suggestedAction: "Review and send a reminder; availability data may lag official reports.",
    });
  }

  if (settings.enableIrStarterChecks && check.irStarters > 0) {
    alerts.push({
      ...base,
      alertType: "ir_starter",
      severity: "high",
      title: "IR Player in Starting Lineup",
      description: `${team} has ${plural(check.irStarters, "IR player")} in a starting slot for Week ${wk}.`,
      suggestedAction: "Review the lineup; an IR-tagged player cannot legally start.",
    });
  }

  if (settings.enableDoubtfulStarterChecks && check.doubtfulStarters > 0) {
    alerts.push({
      ...base,
      alertType: "doubtful_starter",
      severity: "low",
      title: "Doubtful Starter",
      description: `${team} started ${plural(check.doubtfulStarters, "player")} listed as Doubtful in Week ${wk}.`,
      suggestedAction: "Informational — monitor game-day inactives.",
    });
  }

  if (settings.enableUnchangedLineupChecks && ctx.unchangedLineup) {
    alerts.push({
      ...base,
      alertType: "unchanged_lineup",
      severity: "low",
      title: "Unchanged Lineup",
      description: `${team} did not change their starting lineup from last week despite a bye or inactive starter in Week ${wk}.`,
      suggestedAction: "Possible set-and-forget — send a reminder to confirm the manager is still active.",
    });
  }

  if (settings.enableSuspiciousBenchingChecks && check.suspiciousBenchings > 0) {
    alerts.push({
      ...base,
      alertType: "suspicious_benching",
      severity: check.suspiciousBenchings >= 2 ? "high" : "medium",
      title: "Potential Suspicious Benching",
      description: `${team} started a player while a clearly stronger eligible option was on the bench in Week ${wk}.`,
      suggestedAction: "Review the lineup context before issuing any warning.",
    });
  }

  if (check.optimalityGap >= settings.optimalityGapWarning) {
    alerts.push({
      ...base,
      alertType: "large_optimality_gap",
      severity: check.optimalityGap >= settings.optimalityGapCritical ? "high" : "medium",
      title: "Large Lineup Gap",
      description: `${team}'s projected lineup was ${round1(check.optimalityGap)} points below the estimated optimal lineup in Week ${wk}.`,
      suggestedAction: "Review whether this reflects a strategic decision or a lineup-setting lapse.",
    });
  }

  if (ctx.repeatIssueCount >= settings.repeatIssueWeeks) {
    alerts.push({
      ...base,
      alertType: "repeat_lineup_issue",
      severity: ctx.repeatIssueCount >= settings.repeatIssueWeeks + 1 ? "high" : "medium",
      title: "Repeat Lineup Issue",
      description: `${team} has had lineup integrity issues in ${ctx.repeatIssueCount} recent weeks.`,
      suggestedAction: "A repeated pattern matters more than one accident — review history and consider a warning.",
    });
  }

  if (settings.enableTankingRiskChecks && check.tankingRiskScore >= 50) {
    alerts.push({
      ...base,
      alertType: "potential_tanking",
      severity: check.tankingRiskScore >= 75 ? "critical" : "high",
      title: "Potential Tanking Signal",
      description: `${team} has multiple lineup integrity signals that may warrant commissioner review for Week ${wk}. This is a signal, not a determination.`,
      suggestedAction: "Review context, document findings, and follow league bylaws before taking any action.",
    });
  }

  if (ctx.playoffImpactMatchup && check.lineupIntegrityScore < 75) {
    alerts.push({
      ...base,
      alertType: "playoff_integrity",
      severity: "high",
      title: "Playoff Integrity Review",
      description: `This Week ${wk} lineup issue occurred in a matchup that may affect playoff seeding or qualification.`,
      suggestedAction: "Document the matchup context; competitive-integrity concerns near the playoffs warrant a closer look.",
    });
  }

  return alerts;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Severity ordering helper (for sorting "top alerts"). */
export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
