/**
 * League-level lineup integrity settings: read (merged onto defaults) + upsert.
 *
 * Drizzle returns `numeric` columns as strings, so we coerce them back to
 * numbers when building the effective settings object the services consume.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { commissionerLineupSettings } from "@shared/schema";
import { DEFAULT_LINEUP_INTEGRITY_SETTINGS, type LineupIntegritySettings } from "./types";

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Effective settings for a league (DB overrides merged onto defaults). */
export async function getLineupIntegritySettings(
  leagueId: string,
): Promise<LineupIntegritySettings> {
  const rows = await db
    .select()
    .from(commissionerLineupSettings)
    .where(eq(commissionerLineupSettings.leagueId, leagueId))
    .limit(1);

  const row = rows[0];
  const d = DEFAULT_LINEUP_INTEGRITY_SETTINGS;
  if (!row) return { ...d };

  return {
    enableEmptySlotChecks: bool(row.enableEmptySlotChecks, d.enableEmptySlotChecks),
    enableByeStarterChecks: bool(row.enableByeStarterChecks, d.enableByeStarterChecks),
    enableInactiveStarterChecks: bool(row.enableInactiveStarterChecks, d.enableInactiveStarterChecks),
    enableSuspiciousBenchingChecks: bool(row.enableSuspiciousBenchingChecks, d.enableSuspiciousBenchingChecks),
    enableTankingRiskChecks: bool(row.enableTankingRiskChecks, d.enableTankingRiskChecks),

    suspiciousBenchingValueGap: num(row.suspiciousBenchingValueGap, d.suspiciousBenchingValueGap),
    suspiciousBenchingProjectionGap: num(row.suspiciousBenchingProjectionGap, d.suspiciousBenchingProjectionGap),
    optimalityGapWarning: num(row.optimalityGapWarning, d.optimalityGapWarning),
    optimalityGapCritical: num(row.optimalityGapCritical, d.optimalityGapCritical),

    repeatIssueWeeks: num(row.repeatIssueWeeks, d.repeatIssueWeeks),
    strikeAfterRepeatIssues: num(row.strikeAfterRepeatIssues, d.strikeAfterRepeatIssues),

    playoffIntegrityStartWeek: num(row.playoffIntegrityStartWeek, d.playoffIntegrityStartWeek),

    ignoreLineupChecksInOffseason: bool(row.ignoreLineupChecksInOffseason, d.ignoreLineupChecksInOffseason),
    ignoreLineupChecksForBestBall: bool(row.ignoreLineupChecksForBestBall, d.ignoreLineupChecksForBestBall),

    autoCreateAlerts: bool(row.autoCreateAlerts, d.autoCreateAlerts),
    autoCreateStrikes: bool(row.autoCreateStrikes, d.autoCreateStrikes),
  };
}

/** Patch keys allowed from the API (camelCase → column). */
export type LineupSettingsPatch = Partial<LineupIntegritySettings>;

export async function upsertLineupIntegritySettings(
  leagueId: string,
  patch: LineupSettingsPatch,
): Promise<LineupIntegritySettings> {
  const numericKeys = new Set([
    "suspiciousBenchingValueGap",
    "suspiciousBenchingProjectionGap",
    "optimalityGapWarning",
    "optimalityGapCritical",
  ]);
  const intKeys = new Set([
    "repeatIssueWeeks",
    "strikeAfterRepeatIssues",
    "playoffIntegrityStartWeek",
  ]);

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (numericKeys.has(k)) payload[k] = String(v);
    else if (intKeys.has(k)) payload[k] = Math.round(Number(v));
    else payload[k] = v;
  }

  await db
    .insert(commissionerLineupSettings)
    .values({ leagueId, ...payload })
    .onConflictDoUpdate({
      target: commissionerLineupSettings.leagueId,
      set: { ...payload, updatedAt: new Date() },
    });

  return getLineupIntegritySettings(leagueId);
}
