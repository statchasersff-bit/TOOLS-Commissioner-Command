/**
 * Manager activity + inactivity-risk scoring.
 *
 *   activityScore (0–100, higher = more engaged) rewards transaction engagement:
 *     trades, waiver / FA moves, and recency of activity. It penalizes staleness
 *     (weeks since last move). Lineup signals are intentionally NOT used here —
 *     lineup health lives in the separate Lineups module, so Activity scores
 *     purely on transaction behavior.
 *
 *   inactivityRiskScore (0–100, higher = WORSE) is a separate signal that stacks
 *     transaction-inactivity indicators so a commissioner can triage who needs a
 *     nudge.
 *
 * Both are clamped to [0,100]. Settings toggles let a league exclude trade /
 * waiver / FA contributions.
 */
import type { ManagerActivityRow, ActivitySettings, ManagerActivityFlag } from "./types";
import { getActivityLabel, clampScore } from "./helpers";

export function scoreManagerActivity(
  row: ManagerActivityRow,
  settings: ActivitySettings,
): ManagerActivityRow {
  // Orphan (no owner): an empty, ownerless roster has no manager whose engagement
  // we can measure. We still surface the row (flagged as a possible orphan) so the
  // commissioner can fill the seat, but we don't score it — scoring an empty roster
  // as a negligent manager wrongly trips every staleness penalty (risk → ~95) and
  // drags the league down. It's also excluded from league/season aggregates in
  // scoreLeagueActivity / scoreSeasonActivity.
  if (!row.ownerId) {
    return {
      ...row,
      activityScore: 0,
      inactivityRiskScore: 0,
      activityLabel: "unknown",
      flags: ["possible_orphan_risk"],
    };
  }

  const {
    transactionsCount,
    tradesCount,
    waiverCount,
    freeAgentCount,
    weeksSinceTransaction,
  } = row;

  // ── Activity score (transaction-based only) ──
  let score = 0;
  if (transactionsCount >= 1) score += 20;
  if (transactionsCount >= 3) score += 10;
  if (settings.includeTradesInActivityScore && tradesCount >= 1) score += 10;
  if (settings.includeWaiversInActivityScore && waiverCount >= 1) score += 10;
  if (settings.includeFreeAgentMovesInActivityScore && freeAgentCount >= 1) score += 10;

  if (weeksSinceTransaction != null && weeksSinceTransaction <= 1) score += 10;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 3) score -= 15;

  const activityScore = clampScore(score);

  // ── Inactivity risk score (transaction-based only) ──
  let risk = 0;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 2) risk += 15;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 3) risk += 25;
  if (activityScore < 40) risk += 20;
  if (activityScore < 20) risk += 35;

  const inactivityRiskScore = clampScore(risk);

  const flags = deriveManagerFlags(row, settings, activityScore, inactivityRiskScore);

  return {
    ...row,
    activityScore,
    inactivityRiskScore,
    activityLabel: getActivityLabel(activityScore),
    flags,
  };
}

function deriveManagerFlags(
  row: ManagerActivityRow,
  settings: ActivitySettings,
  activityScore: number,
  inactivityRiskScore: number,
): ManagerActivityFlag[] {
  const flags: ManagerActivityFlag[] = [];

  if (
    settings.flagNoTransactions &&
    row.weeksSinceTransaction != null &&
    row.weeksSinceTransaction >= settings.inactiveTransactionWeeks
  ) {
    flags.push("no_recent_transactions");
  }
  if (activityScore < settings.lowActivityScoreThreshold) {
    flags.push("low_activity_score");
  }
  if (inactivityRiskScore >= 50) {
    flags.push("high_inactivity_risk");
  }
  // Possible orphan: no owner attached, or extreme inactivity.
  if (!row.ownerId || inactivityRiskScore >= 75) {
    flags.push("possible_orphan_risk");
  }

  return flags;
}
