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

/** A manager's season-long activity, averaged across the weeks they were scored. */
export interface SeasonManagerAggregate {
  rosterId: number;
  avgActivityScore: number;
  avgRiskScore: number;
}

export interface ScoreSeasonInput {
  leagueId: string;
  season: string;
  /** Distinct weeks aggregated (≥1). Used to normalize cumulative volume. */
  weeks: number;
  managerAggregates: SeasonManagerAggregate[];
  totals: {
    totalTransactions: number;
    totalTrades: number;
    totalWaivers: number;
    totalFreeAgentMoves: number;
    totalLineupChanges: number;
    totalEmptyStarterSlots: number;
  };
  settings: ActivitySettings;
}

/**
 * Season-wide league activity score — "how alive has this league felt all year?"
 *
 * Same shape as the weekly score, but fed the whole season's cumulative totals
 * and each manager's season-average activity. The per-week health thresholds are
 * tuned for a single week's volume, so we normalize the cumulative transaction /
 * lineup / empty-slot counts back to a per-week basis before applying them; that
 * keeps the bonuses/penalties meaningful at season scale instead of always
 * tripping (every league trades "≥1" and runs ">manager/2 transactions" once you
 * sum 14+ weeks). Stored under the sentinel week 0.
 */
export function scoreSeasonActivity(input: ScoreSeasonInput): LeagueSnapshotRow {
  const { managerAggregates, totals, settings } = input;
  const managerCount = managerAggregates.length || 1;
  const weeks = Math.max(1, input.weeks);

  const inactiveManagerCount = managerAggregates.filter(
    (m) => m.avgRiskScore >= 50 || m.avgActivityScore < 20,
  ).length;
  const activeManagerCount = managerCount - inactiveManagerCount;

  const avgManagerScore =
    managerAggregates.reduce((sum, m) => sum + m.avgActivityScore, 0) / managerCount;

  // Normalize cumulative season volume to a typical-week basis so the per-week
  // thresholds below stay calibrated.
  const txnsPerWeek = totals.totalTransactions / weeks;
  const lineupChangesPerWeek = totals.totalLineupChanges / weeks;
  const emptyStarterSlotsPerWeek = totals.totalEmptyStarterSlots / weeks;

  let leagueScore = avgManagerScore;
  if (txnsPerWeek >= managerCount / 2) leagueScore += 10;
  if (totals.totalTrades >= 1) leagueScore += 5;
  if (lineupChangesPerWeek >= managerCount / 2) leagueScore += 10;

  if (inactiveManagerCount >= 1) leagueScore -= 10;
  if (inactiveManagerCount >= 2) leagueScore -= 20;
  if (emptyStarterSlotsPerWeek >= 1) leagueScore -= 15;
  if (emptyStarterSlotsPerWeek >= 3) leagueScore -= 30;

  const leagueActivityScore = clampScore(leagueScore);

  return {
    leagueId: input.leagueId,
    season: input.season,
    week: 0, // 0 == whole-season aggregate
    totalTransactions: totals.totalTransactions,
    totalTrades: totals.totalTrades,
    totalWaivers: totals.totalWaivers,
    totalFreeAgentMoves: totals.totalFreeAgentMoves,
    totalLineupChanges: totals.totalLineupChanges,
    totalEmptyStarterSlots: totals.totalEmptyStarterSlots,
    activeManagerCount,
    inactiveManagerCount,
    leagueActivityScore,
    leagueActivityLabel: getLeagueActivityLabel(leagueActivityScore),
    rawSummary: {
      scope: "season",
      weeks,
      avgManagerScore: Math.round(avgManagerScore),
      managerCount,
      lowActivityThreshold: settings.lowActivityScoreThreshold,
    },
  };
}
