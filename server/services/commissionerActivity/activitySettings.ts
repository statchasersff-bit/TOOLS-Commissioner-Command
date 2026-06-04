/**
 * Per-league activity settings: load (with defaults), patch, and derive league
 * context (best ball / season type) that influences scoring.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { commissionerActivitySettings } from "@shared/schema";
import {
  DEFAULT_ACTIVITY_SETTINGS,
  type ActivitySettings,
  type LeagueActivityContext,
} from "./types";
import { getLeague, getNflState } from "./sleeperActivityApi";

/** Load settings for a league, falling back to defaults when no row exists. */
export async function getActivitySettings(leagueId: string): Promise<ActivitySettings> {
  const [row] = await db
    .select()
    .from(commissionerActivitySettings)
    .where(eq(commissionerActivitySettings.leagueId, leagueId))
    .limit(1);
  if (!row) return { ...DEFAULT_ACTIVITY_SETTINGS };
  return {
    inactiveTransactionWeeks: row.inactiveTransactionWeeks ?? DEFAULT_ACTIVITY_SETTINGS.inactiveTransactionWeeks,
    inactiveLineupWeeks: row.inactiveLineupWeeks ?? DEFAULT_ACTIVITY_SETTINGS.inactiveLineupWeeks,
    unchangedLineupWeeks: row.unchangedLineupWeeks ?? DEFAULT_ACTIVITY_SETTINGS.unchangedLineupWeeks,
    flagEmptyStarters: row.flagEmptyStarters ?? DEFAULT_ACTIVITY_SETTINGS.flagEmptyStarters,
    flagNoTransactions: row.flagNoTransactions ?? DEFAULT_ACTIVITY_SETTINGS.flagNoTransactions,
    flagUnchangedLineups: row.flagUnchangedLineups ?? DEFAULT_ACTIVITY_SETTINGS.flagUnchangedLineups,
    flagLowLeagueActivity: row.flagLowLeagueActivity ?? DEFAULT_ACTIVITY_SETTINGS.flagLowLeagueActivity,
    lowActivityScoreThreshold: row.lowActivityScoreThreshold ?? DEFAULT_ACTIVITY_SETTINGS.lowActivityScoreThreshold,
    inactiveManagerScoreThreshold: row.inactiveManagerScoreThreshold ?? DEFAULT_ACTIVITY_SETTINGS.inactiveManagerScoreThreshold,
    ignoreLineupChecksInOffseason: row.ignoreLineupChecksInOffseason ?? DEFAULT_ACTIVITY_SETTINGS.ignoreLineupChecksInOffseason,
    ignoreLineupChecksForBestBall: row.ignoreLineupChecksForBestBall ?? DEFAULT_ACTIVITY_SETTINGS.ignoreLineupChecksForBestBall,
    includeTradesInActivityScore: row.includeTradesInActivityScore ?? DEFAULT_ACTIVITY_SETTINGS.includeTradesInActivityScore,
    includeWaiversInActivityScore: row.includeWaiversInActivityScore ?? DEFAULT_ACTIVITY_SETTINGS.includeWaiversInActivityScore,
    includeFreeAgentMovesInActivityScore: row.includeFreeAgentMovesInActivityScore ?? DEFAULT_ACTIVITY_SETTINGS.includeFreeAgentMovesInActivityScore,
  };
}

export async function updateActivitySettings(
  leagueId: string,
  patch: Partial<ActivitySettings>,
): Promise<ActivitySettings> {
  const current = await getActivitySettings(leagueId);
  const merged = { ...current, ...patch };
  await db
    .insert(commissionerActivitySettings)
    .values({ leagueId, ...merged })
    .onConflictDoUpdate({
      target: commissionerActivitySettings.leagueId,
      set: { ...merged, updatedAt: sql`now()` },
    });
  return merged;
}

/**
 * Derive league context for scoring. Best ball is detected from Sleeper league
 * settings (`settings.best_ball === 1` or a `best_ball` flag); season type comes
 * from NFL state. Failures degrade gracefully to "regular season, not best ball".
 */
export async function getLeagueActivityContext(leagueId: string): Promise<LeagueActivityContext> {
  let bestBall = false;
  let seasonType = "regular";
  try {
    const league = await getLeague(leagueId);
    const settings = (league?.settings ?? {}) as Record<string, unknown>;
    bestBall =
      Number(settings.best_ball) === 1 ||
      (league as any)?.best_ball === 1 ||
      (league as any)?.best_ball === true;
  } catch {
    /* default: not best ball */
  }
  try {
    const state = await getNflState();
    if (state.season_type) seasonType = state.season_type;
  } catch {
    /* default: regular */
  }
  return { bestBall, seasonType };
}

/**
 * Whether lineup-based checks should be skipped for this scan, combining league
 * context with the league's settings toggles.
 */
export function shouldSkipLineupChecks(
  context: LeagueActivityContext,
  settings: ActivitySettings,
): boolean {
  if (settings.ignoreLineupChecksForBestBall && context.bestBall) return true;
  if (settings.ignoreLineupChecksInOffseason && context.seasonType !== "regular") return true;
  return false;
}
