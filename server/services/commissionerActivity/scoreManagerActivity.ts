/**
 * Manager activity + inactivity-risk scoring.
 *
 *   activityScore (0–100, higher = more engaged) rewards transactions, trades,
 *     waiver / FA moves, lineup changes, and a clean (no empty slots) lineup;
 *     it penalizes staleness (weeks since last move / lineup change) and empty
 *     starter slots.
 *
 *   inactivityRiskScore (0–100, higher = WORSE) is a separate signal that stacks
 *     inactivity indicators so a commissioner can triage who needs a nudge.
 *
 * Both are clamped to [0,100]. Settings toggles let a league exclude trade /
 * waiver / FA contributions and disable lineup-based scoring (best ball /
 * offseason — the caller zeroes lineup signals before this runs in those cases).
 */
import type { ManagerActivityRow, ActivitySettings, ManagerActivityFlag } from "./types";
import { getActivityLabel, clampScore } from "./helpers";

export function scoreManagerActivity(
  row: ManagerActivityRow,
  settings: ActivitySettings,
): ManagerActivityRow {
  const {
    transactionsCount,
    tradesCount,
    waiverCount,
    freeAgentCount,
    lineupChanged,
    emptyStarterSlots,
    weeksSinceTransaction,
    weeksSinceLineupChange,
  } = row;

  // ── Activity score ──
  let score = 0;
  if (transactionsCount >= 1) score += 20;
  if (transactionsCount >= 3) score += 10;
  if (settings.includeTradesInActivityScore && tradesCount >= 1) score += 10;
  if (settings.includeWaiversInActivityScore && waiverCount >= 1) score += 10;
  if (settings.includeFreeAgentMovesInActivityScore && freeAgentCount >= 1) score += 10;

  if (lineupChanged) score += 25;
  if (emptyStarterSlots === 0) score += 15;

  if (weeksSinceTransaction != null && weeksSinceTransaction <= 1) score += 10;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 3) score -= 15;
  if (weeksSinceLineupChange != null && weeksSinceLineupChange >= 2) score -= 15;
  if (emptyStarterSlots > 0) score -= 25;

  const activityScore = clampScore(score);

  // ── Inactivity risk score ──
  let risk = 0;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 2) risk += 15;
  if (weeksSinceTransaction != null && weeksSinceTransaction >= 3) risk += 25;
  if (weeksSinceLineupChange != null && weeksSinceLineupChange >= 2) risk += 20;
  if (weeksSinceLineupChange != null && weeksSinceLineupChange >= 3) risk += 35;
  if (emptyStarterSlots >= 1) risk += 30;
  if (emptyStarterSlots >= 2) risk += 45;
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
  if (
    settings.flagUnchangedLineups &&
    row.weeksSinceLineupChange != null &&
    row.weeksSinceLineupChange >= settings.unchangedLineupWeeks
  ) {
    flags.push("lineup_unchanged");
  }
  if (settings.flagEmptyStarters && row.emptyStarterSlots > 0) {
    flags.push("empty_starter");
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
