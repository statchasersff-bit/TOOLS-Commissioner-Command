/**
 * League-wide activity score — "how alive does this league feel this week?"
 *
 * Starts from the average manager activity score, then nudges up for healthy
 * transaction / trade / lineup-change volume and down for inactive managers and
 * empty lineups. Clamped to [0,100] and mapped to a label (thriving → at_risk).
 */
import type {
  ManagerActivityRow,
  ActivityEvent,
  LeagueSnapshotRow,
  ActivitySettings,
} from "./types";
import { getLeagueActivityLabel, clampScore } from "./helpers";

export interface ScoreLeagueInput {
  leagueId: string;
  season: string;
  week: number;
  managerRows: ManagerActivityRow[];
  transactionEvents: ActivityEvent[];
  lineupEvents: ActivityEvent[];
  settings: ActivitySettings;
}

export function scoreLeagueActivity(input: ScoreLeagueInput): LeagueSnapshotRow {
  const { managerRows, transactionEvents, lineupEvents, settings } = input;
  const managerCount = managerRows.length || 1;

  // A trade involves multiple rosters and so emits one event PER roster; league
  // totals must count distinct transactions, not events, or trades double-count.
  const distinctTxnsByType = (type: string) =>
    new Set(transactionEvents.filter((e) => e.eventType === type).map((e) => e.transactionId)).size;
  const totalTrades = distinctTxnsByType("trade");
  const totalWaivers = distinctTxnsByType("waiver");
  const totalFreeAgentMoves = distinctTxnsByType("free_agent");
  const totalTransactions = totalTrades + totalWaivers + totalFreeAgentMoves;
  const totalLineupChanges = lineupEvents.filter((e) => e.eventType === "lineup_change").length;
  const totalEmptyStarterSlots = managerRows.reduce((sum, m) => sum + m.emptyStarterSlots, 0);

  const inactiveManagerCount = managerRows.filter(
    (m) => m.inactivityRiskScore >= 50 || m.activityScore < 20,
  ).length;
  const activeManagerCount = managerCount - inactiveManagerCount;

  const avgManagerScore =
    managerRows.reduce((sum, m) => sum + m.activityScore, 0) / managerCount;

  let leagueScore = avgManagerScore;
  if (totalTransactions >= managerCount / 2) leagueScore += 10;
  if (totalTrades >= 1) leagueScore += 5;
  if (totalLineupChanges >= managerCount / 2) leagueScore += 10;

  if (inactiveManagerCount >= 1) leagueScore -= 10;
  if (inactiveManagerCount >= 2) leagueScore -= 20;
  if (totalEmptyStarterSlots >= 1) leagueScore -= 15;
  if (totalEmptyStarterSlots >= 3) leagueScore -= 30;

  const leagueActivityScore = clampScore(leagueScore);

  return {
    leagueId: input.leagueId,
    season: input.season,
    week: input.week,
    totalTransactions,
    totalTrades,
    totalWaivers,
    totalFreeAgentMoves,
    totalLineupChanges,
    totalEmptyStarterSlots,
    activeManagerCount,
    inactiveManagerCount,
    leagueActivityScore,
    leagueActivityLabel: getLeagueActivityLabel(leagueActivityScore),
    rawSummary: {
      avgManagerScore: Math.round(avgManagerScore),
      managerCount,
      lowActivityThreshold: settings.lowActivityScoreThreshold,
    },
  };
}
