/**
 * Persistence for lineup integrity scans (write side + repeat-issue lookup).
 *
 * Re-scanning a week is idempotent: lineup checks upsert on
 * (league, season, week, roster); player-check rows are replaced; OPEN alerts
 * are replaced while commissioner-actioned alerts (acknowledged/resolved/
 * dismissed) are preserved. A commissioner's review decision on a check is
 * never reset by a re-scan.
 */
import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  commissionerLineupChecks,
  commissionerLineupPlayerChecks,
  commissionerLineupAlerts,
} from "@shared/schema";
import type { LineupCheckRow, LineupAlertRow, PlayerCheck } from "./types";

/** Upsert one lineup check; returns its row id. Preserves commissioner review. */
export async function saveLineupCheck(check: LineupCheckRow): Promise<number> {
  const values = {
    leagueId: check.leagueId,
    season: check.season,
    week: check.week,
    rosterId: check.rosterId,
    ownerId: check.ownerId,
    managerName: check.managerName,
    teamName: check.teamName,
    starters: check.starters as unknown,
    benchPlayers: check.benchPlayers as unknown,
    allPlayers: check.allPlayers as unknown,
    emptyStarterSlots: check.emptyStarterSlots,
    byeStarters: check.byeStarters,
    inactiveStarters: check.inactiveStarters,
    irStarters: check.irStarters,
    doubtfulStarters: check.doubtfulStarters,
    questionableStarters: check.questionableStarters,
    suspiciousBenchings: check.suspiciousBenchings,
    optimalityGap: String(check.optimalityGap),
    optimalityGapPct: String(check.optimalityGapPct),
    projectedStarterPoints: String(check.projectedStarterPoints),
    projectedOptimalPoints: String(check.projectedOptimalPoints),
    lineupIntegrityScore: check.lineupIntegrityScore,
    tankingRiskScore: check.tankingRiskScore,
    riskLabel: check.riskLabel,
    reviewStatus: check.reviewStatus,
    flags: check.flags as unknown,
    rawMatchup: (check.rawMatchup ?? {}) as unknown,
    updatedAt: new Date(),
  };

  const rows = await db
    .insert(commissionerLineupChecks)
    .values(values as any)
    .onConflictDoUpdate({
      target: [
        commissionerLineupChecks.leagueId,
        commissionerLineupChecks.season,
        commissionerLineupChecks.week,
        commissionerLineupChecks.rosterId,
      ],
      set: {
        ...values,
        // Don't clobber a commissioner's decision: only promote 'none' forward.
        reviewStatus: sql`CASE WHEN ${commissionerLineupChecks.reviewStatus} = 'none'
          THEN ${check.reviewStatus} ELSE ${commissionerLineupChecks.reviewStatus} END`,
      } as any,
    })
    .returning({ id: commissionerLineupChecks.id });

  return rows[0].id;
}

/** Replace all player-check rows for a lineup check. */
export async function saveLineupPlayerChecks(
  checkId: number,
  check: LineupCheckRow,
): Promise<void> {
  await db
    .delete(commissionerLineupPlayerChecks)
    .where(eq(commissionerLineupPlayerChecks.lineupCheckId, checkId));

  if (!check.playerChecks.length) return;

  const rows = check.playerChecks.map((p: PlayerCheck) => ({
    lineupCheckId: checkId,
    leagueId: check.leagueId,
    season: check.season,
    week: check.week,
    rosterId: check.rosterId,
    playerId: p.playerId,
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    lineupSlot: p.lineupSlot,
    isStarter: p.isStarter,
    isBench: p.isBench,
    injuryStatus: p.injuryStatus,
    activeStatus: p.activeStatus,
    isOnBye: p.isOnBye,
    isInactive: p.isInactive,
    isIr: p.isIr,
    isDoubtful: p.isDoubtful,
    projection: String(p.projection),
    playerValue: String(p.playerValue),
    rankScore: String(p.rankScore),
    betterBenchOption: p.betterBenchOption,
    betterBenchPlayerId: p.betterBenchPlayerId,
    betterBenchPlayerName: p.betterBenchPlayerName,
    valueGapVsBench: String(p.valueGapVsBench),
    projectionGapVsBench: String(p.projectionGapVsBench),
    flags: p.flags as unknown,
  }));

  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(commissionerLineupPlayerChecks).values(rows.slice(i, i + BATCH) as any);
  }
}

/** Replace OPEN alerts for a check; keep commissioner-actioned ones. */
export async function replaceOpenAlerts(
  checkId: number,
  alerts: LineupAlertRow[],
): Promise<number> {
  await db
    .delete(commissionerLineupAlerts)
    .where(
      and(
        eq(commissionerLineupAlerts.lineupCheckId, checkId),
        eq(commissionerLineupAlerts.status, "open"),
      ),
    );

  if (!alerts.length) return 0;

  const rows = alerts.map((a) => ({
    leagueId: a.leagueId,
    season: a.season,
    week: a.week,
    lineupCheckId: checkId,
    rosterId: a.rosterId,
    ownerId: a.ownerId,
    alertType: a.alertType,
    severity: a.severity,
    title: a.title,
    description: a.description,
    suggestedAction: a.suggestedAction,
    status: "open",
  }));

  await db.insert(commissionerLineupAlerts).values(rows as any);
  return rows.length;
}

/**
 * Count recent weeks (before currentWeek) where this roster's integrity score
 * was below 75 — the "repeat issue" signal.
 */
export async function getRecentLineupIssueCount(input: {
  leagueId: string;
  rosterId: number;
  season: string;
  currentWeek: number;
  lookbackWeeks: number;
}): Promise<number> {
  const startWeek = Math.max(1, input.currentWeek - input.lookbackWeeks);
  const endWeek = input.currentWeek - 1;
  if (endWeek < startWeek) return 0;

  const rows = await db
    .select({ id: commissionerLineupChecks.id })
    .from(commissionerLineupChecks)
    .where(
      and(
        eq(commissionerLineupChecks.leagueId, input.leagueId),
        eq(commissionerLineupChecks.season, input.season),
        eq(commissionerLineupChecks.rosterId, input.rosterId),
        gte(commissionerLineupChecks.week, startWeek),
        lte(commissionerLineupChecks.week, endWeek),
        lt(commissionerLineupChecks.lineupIntegrityScore, 75),
      ),
    );

  return rows.length;
}
