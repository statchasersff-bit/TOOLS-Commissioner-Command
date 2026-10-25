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
import { getLeague, getNflState } from "../commissionerActivity/sleeperActivityApi";

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
  questionableStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  optimalityGapPct: number;
  projectedStarterPoints: number;
  projectedOptimalPoints: number;
  reviewStatus: string;
  flags: string[];
  updatedAt: string | null;
  matchupId: number | null;
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
    questionableStarters: r.questionableStarters ?? 0,
    suspiciousBenchings: r.suspiciousBenchings ?? 0,
    optimalityGap: n(r.optimalityGap),
    optimalityGapPct: n(r.optimalityGapPct),
    projectedStarterPoints: n(r.projectedStarterPoints),
    projectedOptimalPoints: n(r.projectedOptimalPoints),
    reviewStatus: r.reviewStatus ?? "none",
    flags: (r.flags as string[]) ?? [],
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    matchupId: (() => {
      const id = (r.rawMatchup as any)?.matchup_id;
      return typeof id === "number" ? id : null;
    })(),
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
  const nflState = await getNflState().catch(() => null);
  const currentWeek = nflState?.display_week ?? nflState?.week ?? null;
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
    currentWeek,
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
  // Integrity history is only meaningful for weeks whose lineups are locked.
  // The current (in-progress) week and any future week can still change, so a
  // preview check there must not feed integrity scores / worst-week stats.
  const nflState = await getNflState().catch(() => null);
  const currentWeek = nflState?.display_week ?? nflState?.week ?? null;

  const allRows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(and(eq(commissionerLineupChecks.leagueId, leagueId), eq(commissionerLineupChecks.season, season)))
    .orderBy(asc(commissionerLineupChecks.week));
  const rows = currentWeek == null ? allRows : allRows.filter((r) => r.week < currentWeek);

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
export type MultiLeagueStatus =
  | "clean"
  | "needs_review"
  | "critical"
  | "resolved"
  | "best_ball_excluded"
  | "not_started"
  | "data_pending";

/** Map an alert severity to the commissioner-facing Action Required bucket. */
export function alertBucket(severity: string | null): "critical" | "warning" | "info" {
  if (severity === "critical") return "critical";
  if (severity === "high" || severity === "medium") return "warning";
  return "info";
}

export interface MultiLeagueOptions {
  /** Specific week to summarize for every league. */
  week?: number | null;
  /** Aggregate all unresolved issues across every week instead of a single week. */
  allOpen?: boolean;
  /** Live (current-week) mode: scope every league to the current NFL week. */
  live?: boolean;
}

/**
 * Cross-league commissioner audit summary. For each league, resolves the week
 * in scope (explicit week, the league's latest scanned week, or — in allOpen
 * mode — every week's open issues), classifies a status pill, and returns the
 * counts + the open alerts that drive the Action Required buckets.
 *
 * Best-ball / not-yet-drafted leagues are surfaced (not silently dropped) using
 * lightweight, cached Sleeper league metadata.
 */
interface BenchSwap {
  starterName: string;
  starterProj: number;
  benchName: string;
  benchProj: number;
  slot: string | null;
  more: number;
}

/**
 * For each lineup check, the biggest start/sit gap among its starters that had a
 * stronger eligible bench option. Reconstructs the bench projection from the
 * starter's projection + stored projection gap.
 */
async function loadTopBenchSwaps(checkIds: number[]): Promise<Map<number, BenchSwap>> {
  const map = new Map<number, BenchSwap>();
  if (!checkIds.length) return map;
  const rows = await db
    .select()
    .from(commissionerLineupPlayerChecks)
    .where(inArray(commissionerLineupPlayerChecks.lineupCheckId, checkIds));

  const byCheck = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.lineupCheckId == null) continue;
    const arr = byCheck.get(r.lineupCheckId) ?? [];
    arr.push(r);
    byCheck.set(r.lineupCheckId, arr);
  }

  const round1 = (x: number) => Math.round(x * 10) / 10;
  for (const [cid, prs] of Array.from(byCheck.entries())) {
    const swaps = prs
      .filter((p) => p.isStarter && p.betterBenchOption && p.betterBenchPlayerName)
      .sort((a, b) => n(b.projectionGapVsBench) - n(a.projectionGapVsBench));
    const top = swaps[0];
    if (!top) continue;
    const starterProj = round1(n(top.projection));
    map.set(cid, {
      starterName: top.playerName ?? "Starter",
      starterProj,
      benchName: top.betterBenchPlayerName ?? "Bench player",
      benchProj: round1(n(top.projection) + n(top.projectionGapVsBench)),
      slot: top.lineupSlot,
      more: swaps.length - 1,
    });
  }
  return map;
}

export async function getMultiLeagueSummary(
  leagueIds: string[],
  season: string,
  opts: MultiLeagueOptions = {},
) {
  if (!leagueIds.length) return { week: opts.week ?? null, currentWeek: null, availableWeeks: [], leagues: [] };

  // Current NFL week drives the live-vs-completed (audit) mode split on the
  // client. Failure-tolerant: a missing state feed just leaves it null.
  const nflState = await getNflState().catch(() => null);
  const currentWeek = nflState?.display_week ?? nflState?.week ?? null;

  const [checkRows, alertRows] = await Promise.all([
    db
      .select()
      .from(commissionerLineupChecks)
      .where(and(inArray(commissionerLineupChecks.leagueId, leagueIds), eq(commissionerLineupChecks.season, season))),
    db
      .select()
      .from(commissionerLineupAlerts)
      .where(and(inArray(commissionerLineupAlerts.leagueId, leagueIds), eq(commissionerLineupAlerts.season, season))),
  ]);

  const checks = checkRows.map(shapeCheck);
  const availableWeeks = Array.from(new Set(checks.map((c) => c.week)))
    .filter((w) => w > 0)
    .sort((a, b) => a - b);

  // Specific start/sit detail for benching / optimality alerts, derived live
  // from the stored player checks so the concrete swap ("Started X over Y")
  // shows for already-scanned leagues without requiring a re-scan.
  const detailCheckIds = Array.from(
    new Set(
      alertRows
        .filter((a) => a.alertType === "suspicious_benching" || a.alertType === "large_optimality_gap")
        .map((a) => a.lineupCheckId)
        .filter((id): id is number => id != null),
    ),
  );
  const benchSwapByCheck = await loadTopBenchSwaps(detailCheckIds);
  const gapByCheck = new Map(checks.map((c) => [c.id, c.optimalityGap]));

  // League metadata (best ball + draft/season status), cached + failure-tolerant.
  const metaEntries = await Promise.all(
    leagueIds.map(async (id) => {
      try {
        const lg = await getLeague(id);
        return [id, { bestBall: Boolean(lg?.settings?.best_ball), status: String(lg?.status ?? "") }] as const;
      } catch {
        return [id, { bestBall: false, status: "" }] as const;
      }
    }),
  );
  const metaById = new Map(metaEntries);

  // Manager / team names live on checks, not alerts — index them for lookup.
  const nameKey = (lid: string, wk: number, rid: number) => `${lid}|${wk}|${rid}`;
  const nameMap = new Map<string, { managerName: string | null; teamName: string | null }>();
  for (const c of checks) nameMap.set(nameKey(c.leagueId, c.week, c.rosterId), { managerName: c.managerName, teamName: c.teamName });

  const leagues = leagueIds.map((leagueId) => {
    const meta = metaById.get(leagueId) ?? { bestBall: false, status: "" };
    const leagueChecks = checks.filter((c) => c.leagueId === leagueId);
    const leagueAlerts = alertRows.filter((a) => a.leagueId === leagueId);

    const latestWeek = leagueChecks.reduce((m, c) => Math.max(m, c.week), 0);
    const targetWeek = opts.allOpen
      ? null
      : opts.live
        ? (currentWeek ?? (latestWeek || null))
        : (opts.week ?? (latestWeek || null));
    // Count fields are week-scoped; in allOpen mode fall back to the latest week.
    const countWeek = targetWeek ?? (latestWeek || null);
    const weekChecks = countWeek == null ? [] : leagueChecks.filter((c) => c.week === countWeek);

    const inScope = (wk: number) => (opts.allOpen ? true : wk === targetWeek);
    const openAlerts = leagueAlerts.filter((a) => a.status === "open" && inScope(a.week));
    const resolvedAlerts = leagueAlerts.filter(
      (a) => (a.status === "resolved" || a.status === "dismissed") && inScope(a.week),
    );

    const critical = openAlerts.filter((a) => alertBucket(a.severity) === "critical").length;
    const warnings = openAlerts.filter((a) => alertBucket(a.severity) === "warning").length;
    const info = openAlerts.filter((a) => alertBucket(a.severity) === "info").length;
    const affectedManagers = new Set(openAlerts.map((a) => a.rosterId)).size;

    // Matchups impacted (post-week audit metric): distinct matchups that contain
    // at least one roster with an open issue. Maps roster→matchup via the stored
    // raw Sleeper matchup (matchup_id), scoped to the same week(s) as the alerts.
    const matchupByRosterWeek = new Map<string, number | null>();
    for (const c of leagueChecks) matchupByRosterWeek.set(`${c.week}|${c.rosterId}`, c.matchupId);
    const impactedMatchups = new Set<string>();
    for (const a of openAlerts) {
      const mid = matchupByRosterWeek.get(`${a.week}|${a.rosterId}`);
      // Key by week+matchup so the same matchup_id across weeks isn't merged.
      if (mid != null) impactedMatchups.add(`${a.week}|${mid}`);
    }
    const matchupsImpacted = impactedMatchups.size;

    const avg = weekChecks.length
      ? Math.round(weekChecks.reduce((s, c) => s + c.lineupIntegrityScore, 0) / weekChecks.length)
      : null;
    const emptySlots = weekChecks.reduce((s, c) => s + c.emptyStarterSlots, 0);
    const inactiveStarters = weekChecks.reduce((s, c) => s + c.inactiveStarters + c.irStarters, 0);
    const byeStarters = weekChecks.reduce((s, c) => s + c.byeStarters, 0);
    const doubtfulStarters = weekChecks.reduce((s, c) => s + c.doubtfulStarters, 0);
    const questionableStarters = weekChecks.reduce((s, c) => s + c.questionableStarters, 0);
    // Teams showing a potential-tanking signal (risk score ≥ 25, matching the
    // Anti-Tanking review threshold used in the per-league audit).
    const tankingTeams = weekChecks.filter((c) => c.tankingRiskScore >= 25).length;
    const needsReview = weekChecks.filter((c) => c.reviewStatus === "needs_review").length;
    const scanned = leagueChecks.length > 0;
    // Most recent scan time across all of this league's checks (any week).
    const lastScanned = leagueChecks.reduce<string | null>((latest, c) => {
      if (!c.updatedAt) return latest;
      return latest == null || c.updatedAt > latest ? c.updatedAt : latest;
    }, null);

    let status: MultiLeagueStatus;
    if (meta.bestBall) status = "best_ball_excluded";
    else if (!scanned && (meta.status === "pre_draft" || meta.status === "drafting")) status = "not_started";
    else if (!weekChecks.length) status = "data_pending";
    else if (critical > 0) status = "critical";
    else if (openAlerts.length > 0 || needsReview > 0) status = "needs_review";
    else if (resolvedAlerts.length > 0) status = "resolved";
    else status = "clean";

    const alerts = openAlerts
      .map((a) => {
        const nm = nameMap.get(nameKey(leagueId, a.week, a.rosterId));
        // Spell out the actual start/sit for benching / optimality alerts.
        const swap = a.lineupCheckId != null ? benchSwapByCheck.get(a.lineupCheckId) : undefined;
        const isSwapAlert =
          a.alertType === "suspicious_benching" || a.alertType === "large_optimality_gap";
        let description = a.description;
        // Structured start/sit so the client can render a compact "started →
        // bench · +gap" row instead of a prose sentence. Mirrors `description`,
        // which is kept as a fallback for older / non-swap alerts.
        let swapDetail:
          | { slot: string | null; startedName: string; startedProj: number; benchName: string; benchProj: number; gap: number; more: number }
          | null = null;
        if (swap && isSwapAlert) {
          const slot = swap.slot && swap.slot !== "BN" ? ` at ${swap.slot}` : "";
          const more = swap.more > 0 ? ` (+${swap.more} more)` : "";
          // Build fresh (idempotent) sentences so re-deriving over an already
          // enriched stored description never double-appends the detail.
          if (a.alertType === "suspicious_benching") {
            description = `Started ${swap.starterName} (proj ${swap.starterProj}) over ${swap.benchName} (proj ${swap.benchProj})${slot}${more}.`;
          } else {
            const gap = a.lineupCheckId != null ? gapByCheck.get(a.lineupCheckId) ?? 0 : 0;
            description = `Projected lineup ${Math.round(gap * 10) / 10} pts below the estimated optimal. Biggest available improvement: ${swap.benchName} (proj ${swap.benchProj}) over ${swap.starterName} (proj ${swap.starterProj})${slot}.`;
          }
          swapDetail = {
            slot: swap.slot && swap.slot !== "BN" ? swap.slot : null,
            startedName: swap.starterName,
            startedProj: swap.starterProj,
            benchName: swap.benchName,
            benchProj: swap.benchProj,
            gap: Math.round((swap.benchProj - swap.starterProj) * 10) / 10,
            more: swap.more,
          };
        }
        return {
          id: a.id,
          leagueId,
          week: a.week,
          rosterId: a.rosterId,
          managerName: nm?.managerName ?? null,
          teamName: nm?.teamName ?? null,
          alertType: a.alertType,
          severity: a.severity ?? "info",
          bucket: alertBucket(a.severity),
          title: a.title,
          description,
          suggestedAction: a.suggestedAction,
          status: a.status ?? "open",
          swap: swapDetail,
        };
      })
      .sort(
        (x, y) =>
          (SEVERITY_RANK[y.severity as keyof typeof SEVERITY_RANK] ?? 0) -
          (SEVERITY_RANK[x.severity as keyof typeof SEVERITY_RANK] ?? 0),
      );

    return {
      leagueId,
      week: opts.allOpen ? null : (targetWeek || null),
      status,
      averageIntegrity: avg,
      totalIssues: openAlerts.length,
      critical,
      warnings,
      info,
      affectedManagers,
      emptySlots,
      inactiveStarters,
      byeStarters,
      doubtfulStarters,
      questionableStarters,
      tankingTeams,
      needsReview,
      resolvedThisWeek: resolvedAlerts.length,
      bestBall: meta.bestBall,
      lastScanned,
      matchupsImpacted,
      alerts,
    };
  });

  const week = opts.allOpen
    ? null
    : opts.live
      ? (currentWeek ?? (availableWeeks[availableWeeks.length - 1] ?? null))
      : (opts.week ?? (availableWeeks[availableWeeks.length - 1] ?? null));
  return { week, currentWeek, availableWeeks, leagues };
}
