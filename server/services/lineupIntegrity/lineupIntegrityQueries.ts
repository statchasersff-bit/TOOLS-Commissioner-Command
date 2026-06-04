/**
 * Read/query layer for the Lineup Integrity API. Shapes DB rows (drizzle returns
 * numeric columns as strings) into clean JSON for the frontend, and builds the
 * overview, checks feed, detail, alerts, manager history, weekly report, and
 * multi-league aggregates.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  commissionerLineupChecks,
  commissionerLineupPlayerChecks,
  commissionerLineupAlerts,
  commissionerLineupStrikes,
} from "@shared/schema";
import { SEVERITY_RANK } from "./generateLineupAlerts";
import { buildWeeklyReport, type WeeklyReportTeam } from "./lineupIntegritySummary";

const n = (v: unknown): number => {
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

export interface ShapedCheck {
  id: number;
  leagueId: string;
  season: string;
  week: number;
  rosterId: number;
  ownerId: string | null;
  managerName: string | null;
  teamName: string | null;
  lineupIntegrityScore: number;
  tankingRiskScore: number;
  riskLabel: string;
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  irStarters: number;
  doubtfulStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  optimalityGapPct: number;
  projectedStarterPoints: number;
  projectedOptimalPoints: number;
  reviewStatus: string;
  flags: string[];
}

function shapeCheck(r: typeof commissionerLineupChecks.$inferSelect): ShapedCheck {
  return {
    id: r.id,
    leagueId: r.leagueId,
    season: r.season,
    week: r.week,
    rosterId: r.rosterId,
    ownerId: r.ownerId,
    managerName: r.managerName,
    teamName: r.teamName,
    lineupIntegrityScore: r.lineupIntegrityScore ?? 100,
    tankingRiskScore: r.tankingRiskScore ?? 0,
    riskLabel: r.riskLabel ?? "low",
    emptyStarterSlots: r.emptyStarterSlots ?? 0,
    byeStarters: r.byeStarters ?? 0,
    inactiveStarters: r.inactiveStarters ?? 0,
    irStarters: r.irStarters ?? 0,
    doubtfulStarters: r.doubtfulStarters ?? 0,
    suspiciousBenchings: r.suspiciousBenchings ?? 0,
    optimalityGap: n(r.optimalityGap),
    optimalityGapPct: n(r.optimalityGapPct),
    projectedStarterPoints: n(r.projectedStarterPoints),
    projectedOptimalPoints: n(r.projectedOptimalPoints),
    reviewStatus: r.reviewStatus ?? "none",
    flags: (r.flags as string[]) ?? [],
  };
}

/** Latest week we have checks for in a league/season (for default views). */
export async function getLatestWeek(leagueId: string, season: string): Promise<number | null> {
  const rows = await db
    .select({ week: commissionerLineupChecks.week })
    .from(commissionerLineupChecks)
    .where(and(eq(commissionerLineupChecks.leagueId, leagueId), eq(commissionerLineupChecks.season, season)))
    .orderBy(desc(commissionerLineupChecks.week))
    .limit(1);
  return rows[0]?.week ?? null;
}

async function loadChecks(leagueId: string, season: string, week: number): Promise<ShapedCheck[]> {
  const rows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(
      and(
        eq(commissionerLineupChecks.leagueId, leagueId),
        eq(commissionerLineupChecks.season, season),
        eq(commissionerLineupChecks.week, week),
      ),
    );
  return rows.map(shapeCheck);
}

async function countOpenAlerts(leagueId: string, season: string, week?: number): Promise<number> {
  const conds = [
    eq(commissionerLineupAlerts.leagueId, leagueId),
    eq(commissionerLineupAlerts.season, season),
    eq(commissionerLineupAlerts.status, "open"),
  ];
  if (week != null) conds.push(eq(commissionerLineupAlerts.week, week));
  const rows = await db.select({ id: commissionerLineupAlerts.id }).from(commissionerLineupAlerts).where(and(...conds));
  return rows.length;
}

export async function getOverview(leagueId: string, season: string, week: number) {
  const checks = await loadChecks(leagueId, season, week);
  const total = checks.length;
  const cleanLineups = checks.filter((c) => c.lineupIntegrityScore >= 90).length;
  const needsReview = checks.filter((c) => c.reviewStatus === "needs_review").length;
  const emptyStarterSlots = checks.reduce((s, c) => s + c.emptyStarterSlots, 0);
  const byeStarters = checks.reduce((s, c) => s + c.byeStarters, 0);
  const inactiveStarters = checks.reduce((s, c) => s + c.inactiveStarters + c.irStarters, 0);
  const suspiciousBenchings = checks.reduce((s, c) => s + c.suspiciousBenchings, 0);
  const averageIntegrityScore = total
    ? Math.round(checks.reduce((s, c) => s + c.lineupIntegrityScore, 0) / total)
    : 100;
  const highTankingRiskTeams = checks.filter((c) => c.tankingRiskScore >= 50).length;
  const openAlerts = await countOpenAlerts(leagueId, season, week);

  const alertRows = await db
    .select()
    .from(commissionerLineupAlerts)
    .where(
      and(
        eq(commissionerLineupAlerts.leagueId, leagueId),
        eq(commissionerLineupAlerts.season, season),
        eq(commissionerLineupAlerts.week, week),
        eq(commissionerLineupAlerts.status, "open"),
      ),
    );
  const topAlerts = alertRows
    .map((a) => ({
      id: a.id,
      week: a.week,
      rosterId: a.rosterId,
      lineupCheckId: a.lineupCheckId,
      alertType: a.alertType,
      severity: a.severity,
      title: a.title,
      description: a.description,
      suggestedAction: a.suggestedAction,
      status: a.status ?? "open",
      notes: a.notes,
    }))
    .sort((a, b) => (SEVERITY_RANK[b.severity as keyof typeof SEVERITY_RANK] ?? 0) - (SEVERITY_RANK[a.severity as keyof typeof SEVERITY_RANK] ?? 0))
    .slice(0, 8);

  const highestRiskTeams = [...checks]
    .filter((c) => c.tankingRiskScore >= 25 || c.lineupIntegrityScore < 75)
    .sort((a, b) => b.tankingRiskScore - a.tankingRiskScore || a.lineupIntegrityScore - b.lineupIntegrityScore)
    .slice(0, 5);

  return {
    week,
    summary: {
      totalTeamsChecked: total,
      cleanLineups,
      needsReview,
      emptyStarterSlots,
      byeStarters,
      inactiveStarters,
      suspiciousBenchings,
      averageIntegrityScore,
      highTankingRiskTeams,
      openAlerts,
    },
    topAlerts,
    highestRiskTeams,
  };
}

export interface ChecksFilter {
  riskLabel?: string;
  reviewStatus?: string;
  rosterId?: number;
  hasAlerts?: boolean;
  flag?: string;
}

export async function listChecks(leagueId: string, season: string, week: number, filter: ChecksFilter = {}) {
  let checks = await loadChecks(leagueId, season, week);

  if (filter.riskLabel) checks = checks.filter((c) => c.riskLabel === filter.riskLabel);
  if (filter.reviewStatus) checks = checks.filter((c) => c.reviewStatus === filter.reviewStatus);
  if (filter.rosterId != null) checks = checks.filter((c) => c.rosterId === filter.rosterId);
  if (filter.flag) checks = checks.filter((c) => c.flags.includes(filter.flag!));

  if (filter.hasAlerts) {
    const open = await db
      .select({ rosterId: commissionerLineupAlerts.rosterId })
      .from(commissionerLineupAlerts)
      .where(
        and(
          eq(commissionerLineupAlerts.leagueId, leagueId),
          eq(commissionerLineupAlerts.season, season),
          eq(commissionerLineupAlerts.week, week),
          eq(commissionerLineupAlerts.status, "open"),
        ),
      );
    const withAlerts = new Set(open.map((o) => o.rosterId));
    checks = checks.filter((c) => withAlerts.has(c.rosterId));
  }

  checks.sort(
    (a, b) =>
      a.lineupIntegrityScore - b.lineupIntegrityScore ||
      b.tankingRiskScore - a.tankingRiskScore,
  );
  return checks;
}

export async function getCheckDetail(checkId: number) {
  const checkRows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(eq(commissionerLineupChecks.id, checkId))
    .limit(1);
  const checkRow = checkRows[0];
  if (!checkRow) return null;
  const check = shapeCheck(checkRow);

  const playerRows = await db
    .select()
    .from(commissionerLineupPlayerChecks)
    .where(eq(commissionerLineupPlayerChecks.lineupCheckId, checkId));

  const players = playerRows.map((p) => ({
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
    projection: n(p.projection),
    playerValue: n(p.playerValue),
    betterBenchOption: p.betterBenchOption,
    betterBenchPlayerName: p.betterBenchPlayerName,
    valueGapVsBench: n(p.valueGapVsBench),
    projectionGapVsBench: n(p.projectionGapVsBench),
    flags: (p.flags as string[]) ?? [],
  }));

  const starters = players.filter((p) => p.isStarter);
  const bench = players.filter((p) => p.isBench);
  const suspiciousBenchings = starters.filter((p) => p.betterBenchOption);

  const alerts = await db
    .select()
    .from(commissionerLineupAlerts)
    .where(eq(commissionerLineupAlerts.lineupCheckId, checkId));

  return { check, starters, bench, suspiciousBenchings, alerts };
}

export interface AlertsFilter {
  status?: string;
  week?: number;
  alertType?: string;
}

export async function listAlerts(leagueId: string, season: string | undefined, filter: AlertsFilter = {}) {
  const conds = [eq(commissionerLineupAlerts.leagueId, leagueId)];
  if (season) conds.push(eq(commissionerLineupAlerts.season, season));
  if (filter.status) conds.push(eq(commissionerLineupAlerts.status, filter.status));
  if (filter.week != null) conds.push(eq(commissionerLineupAlerts.week, filter.week));
  if (filter.alertType) conds.push(eq(commissionerLineupAlerts.alertType, filter.alertType));

  const rows = await db
    .select()
    .from(commissionerLineupAlerts)
    .where(and(...conds))
    .orderBy(desc(commissionerLineupAlerts.createdAt));

  return rows.map((a) => ({
    id: a.id,
    leagueId: a.leagueId,
    season: a.season,
    week: a.week,
    lineupCheckId: a.lineupCheckId,
    rosterId: a.rosterId,
    alertType: a.alertType,
    severity: a.severity,
    title: a.title,
    description: a.description,
    suggestedAction: a.suggestedAction,
    status: a.status ?? "open",
    notes: a.notes,
  }));
}

export async function updateAlert(
  alertId: number,
  patch: { status?: string; notes?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.status) {
    set.status = patch.status;
    if (patch.status === "acknowledged") set.acknowledgedAt = new Date();
    if (patch.status === "resolved" || patch.status === "dismissed") set.resolvedAt = new Date();
  }
  if (patch.notes != null) set.notes = patch.notes;
  if (!Object.keys(set).length) return;
  await db.update(commissionerLineupAlerts).set(set).where(eq(commissionerLineupAlerts.id, alertId));
}

/** Aggregate per-manager history across a season (one row per roster). */
export async function getManagerHistory(leagueId: string, season: string) {
  const rows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(and(eq(commissionerLineupChecks.leagueId, leagueId), eq(commissionerLineupChecks.season, season)))
    .orderBy(asc(commissionerLineupChecks.week));

  const strikes = await db
    .select()
    .from(commissionerLineupStrikes)
    .where(and(eq(commissionerLineupStrikes.leagueId, leagueId), eq(commissionerLineupStrikes.season, season)));
  const strikeCountByRoster = new Map<number, number>();
  for (const s of strikes) strikeCountByRoster.set(s.rosterId, (strikeCountByRoster.get(s.rosterId) ?? 0) + 1);

  const byRoster = new Map<number, ShapedCheck[]>();
  for (const r of rows) {
    const c = shapeCheck(r);
    const arr = byRoster.get(c.rosterId) ?? [];
    arr.push(c);
    byRoster.set(c.rosterId, arr);
  }

  const managers: any[] = [];
  byRoster.forEach((checks: ShapedCheck[], rosterId: number) => {
    const totalChecks = checks.length;
    const avgIntegrity = totalChecks
      ? Math.round(checks.reduce((s, c) => s + c.lineupIntegrityScore, 0) / totalChecks)
      : 100;
    const weeksWithIssues = checks.filter((c) => c.lineupIntegrityScore < 75).map((c) => c.week);
    const worst = [...checks].sort((a, b) => a.lineupIntegrityScore - b.lineupIntegrityScore)[0];
    const latest = checks[checks.length - 1];
    managers.push({
      rosterId,
      managerName: latest?.managerName ?? `Roster ${rosterId}`,
      teamName: latest?.teamName ?? "",
      totalChecks,
      averageIntegrityScore: avgIntegrity,
      emptyStarterCount: checks.reduce((s, c) => s + c.emptyStarterSlots, 0),
      byeStarterCount: checks.reduce((s, c) => s + c.byeStarters, 0),
      inactiveStarterCount: checks.reduce((s, c) => s + c.inactiveStarters + c.irStarters, 0),
      suspiciousBenchingCount: checks.reduce((s, c) => s + c.suspiciousBenchings, 0),
      strikes: strikeCountByRoster.get(rosterId) ?? 0,
      weeksWithIssues,
      worstWeek: worst ? { week: worst.week, integrityScore: worst.lineupIntegrityScore } : null,
    });
  });

  managers.sort((a, b) => a.averageIntegrityScore - b.averageIntegrityScore);
  return managers;
}

/** Build the copy-ready weekly report text. */
export async function getWeeklyReport(
  leagueId: string,
  season: string,
  week: number,
  leagueName: string,
): Promise<string> {
  const checks = await loadChecks(leagueId, season, week);
  const toTeam = (c: ShapedCheck): WeeklyReportTeam => ({
    managerName: c.managerName ?? `Roster ${c.rosterId}`,
    teamName: c.teamName ?? "",
    lineupIntegrityScore: c.lineupIntegrityScore,
    tankingRiskScore: c.tankingRiskScore,
    emptyStarterSlots: c.emptyStarterSlots,
    byeStarters: c.byeStarters,
    inactiveStarters: c.inactiveStarters + c.irStarters,
    suspiciousBenchings: c.suspiciousBenchings,
    optimalityGap: c.optimalityGap,
    ownsOwnFirst: c.flags.includes("potential_tanking"),
    flags: c.flags,
  });

  const needingAttention = checks
    .filter((c) => c.lineupIntegrityScore < 75 || c.emptyStarterSlots > 0 || c.suspiciousBenchings > 0)
    .sort((a, b) => a.lineupIntegrityScore - b.lineupIntegrityScore)
    .map(toTeam);

  const tankingReview = checks.filter((c) => c.tankingRiskScore >= 50).sort((a, b) => b.tankingRiskScore - a.tankingRiskScore).map(toTeam);

  return buildWeeklyReport({
    leagueName,
    week,
    totalTeamsChecked: checks.length,
    cleanLineups: checks.filter((c) => c.lineupIntegrityScore >= 90).length,
    needsReview: checks.filter((c) => c.reviewStatus === "needs_review").length,
    emptyStarterSlots: checks.reduce((s, c) => s + c.emptyStarterSlots, 0),
    inactiveStarters: checks.reduce((s, c) => s + c.inactiveStarters + c.irStarters, 0),
    potentialTankingSignals: tankingReview.length,
    teamsNeedingAttention: needingAttention,
    tankingReviewTeams: tankingReview,
  });
}

/** Per-league aggregate row for the multi-league dashboard. */
export async function getMultiLeagueSummary(leagueIds: string[], season: string) {
  if (!leagueIds.length) return [];

  const rows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(and(inArray(commissionerLineupChecks.leagueId, leagueIds), eq(commissionerLineupChecks.season, season)));

  const alertRows = await db
    .select()
    .from(commissionerLineupAlerts)
    .where(
      and(
        inArray(commissionerLineupAlerts.leagueId, leagueIds),
        eq(commissionerLineupAlerts.season, season),
        eq(commissionerLineupAlerts.status, "open"),
      ),
    );

  return leagueIds.map((leagueId) => {
    const leagueChecks = rows.filter((r) => r.leagueId === leagueId).map(shapeCheck);
    const latestWeek = leagueChecks.reduce((m, c) => Math.max(m, c.week), 0);
    const weekChecks = leagueChecks.filter((c) => c.week === latestWeek);
    const openAlerts = alertRows.filter((a) => a.leagueId === leagueId && a.week === latestWeek).length;
    const avg = weekChecks.length
      ? Math.round(weekChecks.reduce((s, c) => s + c.lineupIntegrityScore, 0) / weekChecks.length)
      : null;
    return {
      leagueId,
      week: latestWeek || null,
      averageIntegrity: avg,
      needsReview: weekChecks.filter((c) => c.reviewStatus === "needs_review").length,
      criticalIssues: weekChecks.filter((c) => c.lineupIntegrityScore < 25 || c.emptyStarterSlots > 0).length,
      tankingSignals: weekChecks.filter((c) => c.tankingRiskScore >= 50).length,
      openAlerts,
    };
  });
}
