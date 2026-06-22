/**
 * League-specific weekly audit view for the Lineup Integrity feature.
 *
 * Powers the "Lineup Integrity — [League]" commissioner audit screen:
 *   • a Matchup Integrity Board (which matchups are affected this week)
 *   • a flattened, player-granular League Issues feed (slot + player + status)
 *   • a per-issue commissioner audit log (dispute protection)
 *
 * Everything is computed from already-ingested lineup checks + player checks +
 * alerts. This module is READ-ONLY against Sleeper (it only reads league
 * roster_positions to label empty starter slots) and never messages managers
 * or edits lineups.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  commissionerLineupChecks,
  commissionerLineupPlayerChecks,
  commissionerLineupAlerts,
  commissionerLineupAuditLog,
} from "@shared/schema";
import { getLeague, getLeagueRosters } from "../commissionerActivity/sleeperActivityApi";
import { getStartingSlots } from "./parseSleeperLineups";

function isEmptySlot(slot: string | null | undefined): boolean {
  return !slot || slot === "0" || slot === "null" || slot === "None";
}

const OUT_CODES = new Set(["out", "o"]);

export type IssueSeverity = "critical" | "warning" | "info";
export type IssueStatus = "open" | "acknowledged" | "resolved" | "ignored";

export interface AuditIssue {
  /** Stable key so commissioner actions + audit log attach to one issue. */
  id: string;
  checkId: number;
  rosterId: number;
  managerName: string;
  teamName: string;
  matchupId: number | null;
  opponentRosterId: number | null;
  opponentTeamName: string | null;
  severity: IssueSeverity;
  /** empty_slot | bye | ir | out | inactive | doubtful | questionable | suspicious_bench */
  category: string;
  slot: string | null;
  playerId: string | null;
  playerName: string | null;
  position: string | null;
  nflTeam: string | null;
  playerStatus: string;
  issueType: string;
  /** Game kickoff + hard lock status are not in our data feed yet. */
  gameTime: string | null;
  lockStatus: "unknown";
  issueStatus: IssueStatus;
  alertId: number | null;
  isRepeatOffender: boolean;
}

export interface AuditTeam {
  checkId: number;
  rosterId: number;
  managerName: string;
  teamName: string;
  integrityScore: number;
  reviewStatus: string;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
}

export type MatchupStatus = "clean" | "needs_review" | "critical" | "resolved" | "data_pending";

export interface AuditMatchup {
  matchupId: number | null;
  teams: AuditTeam[];
  totalIssues: number;
  criticalIssues: number;
  status: MatchupStatus;
}

export type LeagueStatus =
  | "clean"
  | "needs_review"
  | "critical"
  | "resolved"
  | "data_pending"
  | "not_started";

export interface LeagueWeekAudit {
  leagueId: string;
  season: string;
  week: number;
  status: LeagueStatus;
  summary: {
    totalIssues: number;
    criticalIssues: number;
    affectedManagers: number;
    emptyStarterSlots: number;
    inactiveStarters: number;
    /** Teams whose total rostered players exceed the league roster limit
     *  (roster_positions + taxi + IR slots). */
    overRosteredLineups: number;
    resolved: number;
    cleanTeams: number;
    totalTeams: number;
  };
  matchups: AuditMatchup[];
  issues: AuditIssue[];
}

function playerStatusLabel(p: {
  isOnBye: boolean | null;
  isIr: boolean | null;
  isInactive: boolean | null;
  isDoubtful: boolean | null;
  injuryStatus: string | null;
}): { status: string; severity: IssueSeverity; category: string } | null {
  const inj = (p.injuryStatus ?? "").trim().toLowerCase();
  if (p.isOnBye) return { status: "Bye", severity: "critical", category: "bye" };
  if (p.isIr) return { status: "IR", severity: "critical", category: "ir" };
  if (OUT_CODES.has(inj) || inj === "out") return { status: "Out", severity: "critical", category: "out" };
  if (p.isInactive) return { status: "Inactive", severity: "critical", category: "inactive" };
  if (p.isDoubtful || inj === "doubtful" || inj === "d") return { status: "Doubtful", severity: "warning", category: "doubtful" };
  if (inj === "questionable" || inj === "q") return { status: "Questionable", severity: "info", category: "questionable" };
  return null;
}

/** Build the full league-week audit payload from stored checks/players/alerts. */
export async function getLeagueWeekAudit(
  leagueId: string,
  season: string,
  week: number,
): Promise<LeagueWeekAudit> {
  const checkRows = await db
    .select()
    .from(commissionerLineupChecks)
    .where(
      and(
        eq(commissionerLineupChecks.leagueId, leagueId),
        eq(commissionerLineupChecks.season, season),
        eq(commissionerLineupChecks.week, week),
      ),
    );

  const emptyResult: LeagueWeekAudit = {
    leagueId,
    season,
    week,
    status: "data_pending",
    summary: {
      totalIssues: 0, criticalIssues: 0, affectedManagers: 0, emptyStarterSlots: 0,
      inactiveStarters: 0, overRosteredLineups: 0, resolved: 0, cleanTeams: 0, totalTeams: 0,
    },
    matchups: [],
    issues: [],
  };
  if (checkRows.length === 0) return emptyResult;

  const checkIds = checkRows.map((r) => r.id);
  const [playerRows, alertRows, league, rosters] = await Promise.all([
    db.select().from(commissionerLineupPlayerChecks).where(inArray(commissionerLineupPlayerChecks.lineupCheckId, checkIds)),
    db.select().from(commissionerLineupAlerts).where(
      and(
        eq(commissionerLineupAlerts.leagueId, leagueId),
        eq(commissionerLineupAlerts.season, season),
        eq(commissionerLineupAlerts.week, week),
      ),
    ),
    getLeague(leagueId).catch(() => null),
    getLeagueRosters(leagueId).catch(() => []),
  ]);

  const startingSlots = getStartingSlots((league?.roster_positions as string[]) ?? []);

  const playersByCheck = new Map<number, typeof playerRows>();
  for (const p of playerRows) {
    if (p.lineupCheckId == null) continue;
    const arr = playersByCheck.get(p.lineupCheckId) ?? [];
    arr.push(p);
    playersByCheck.set(p.lineupCheckId, arr);
  }

  // Team identity + matchup grouping.
  const teamNameByRoster = new Map<number, string>();
  const matchupIdByRoster = new Map<number, number | null>();
  for (const r of checkRows) {
    teamNameByRoster.set(r.rosterId, r.teamName ?? r.managerName ?? `Team ${r.rosterId}`);
    const mid = (r.rawMatchup as any)?.matchup_id;
    matchupIdByRoster.set(r.rosterId, mid != null ? Number(mid) : null);
  }
  // Opponent lookup within each matchup group.
  const rostersByMatchup = new Map<number, number[]>();
  for (const r of checkRows) {
    const mid = matchupIdByRoster.get(r.rosterId);
    if (mid == null) continue;
    const arr = rostersByMatchup.get(mid) ?? [];
    arr.push(r.rosterId);
    rostersByMatchup.set(mid, arr);
  }
  const opponentOf = (rosterId: number): number | null => {
    const mid = matchupIdByRoster.get(rosterId);
    if (mid == null) return null;
    return (rostersByMatchup.get(mid) ?? []).find((rid) => rid !== rosterId) ?? null;
  };

  // Resolve an issue's status from a matching open/closed alert when possible.
  const alertsByRoster = new Map<number, typeof alertRows>();
  for (const a of alertRows) {
    const arr = alertsByRoster.get(a.rosterId) ?? [];
    arr.push(a);
    alertsByRoster.set(a.rosterId, arr);
  }
  const ALERT_TYPE_BY_CATEGORY: Record<string, string[]> = {
    empty_slot: ["empty_starter"],
    bye: ["bye_starter"],
    ir: ["ir_starter", "inactive_starter"],
    out: ["inactive_starter"],
    inactive: ["inactive_starter"],
    doubtful: ["doubtful_starter"],
    suspicious_bench: ["suspicious_benching"],
  };
  function statusForIssue(rosterId: number, category: string): { issueStatus: IssueStatus; alertId: number | null } {
    const wanted = ALERT_TYPE_BY_CATEGORY[category] ?? [];
    const alert = (alertsByRoster.get(rosterId) ?? []).find((a) => wanted.includes(a.alertType));
    if (!alert) return { issueStatus: "open", alertId: null };
    const s = alert.status ?? "open";
    const issueStatus: IssueStatus =
      s === "dismissed" ? "ignored" : s === "resolved" ? "resolved" : s === "acknowledged" ? "acknowledged" : "open";
    return { issueStatus, alertId: alert.id };
  }

  const issues: AuditIssue[] = [];

  for (const r of checkRows) {
    const rosterId = r.rosterId;
    const managerName = r.managerName ?? `Roster ${rosterId}`;
    const teamName = r.teamName ?? managerName;
    const matchupId = matchupIdByRoster.get(rosterId) ?? null;
    const oppRosterId = opponentOf(rosterId);
    const opponentTeamName = oppRosterId != null ? teamNameByRoster.get(oppRosterId) ?? null : null;
    const isRepeat = ((r.flags as string[]) ?? []).includes("repeat_lineup_issue");
    const players = playersByCheck.get(r.id) ?? [];

    const baseIssue = (over: Partial<AuditIssue> & { id: string; category: string; severity: IssueSeverity }): AuditIssue => {
      const { issueStatus, alertId } = statusForIssue(rosterId, over.category);
      return {
        checkId: r.id,
        rosterId,
        managerName,
        teamName,
        matchupId,
        opponentRosterId: oppRosterId,
        opponentTeamName,
        slot: null,
        playerId: null,
        playerName: null,
        position: null,
        nflTeam: null,
        playerStatus: "—",
        issueType: "",
        gameTime: null,
        lockStatus: "unknown",
        issueStatus,
        alertId,
        isRepeatOffender: isRepeat,
        ...over,
      } as AuditIssue;
    };

    // 1) Empty starter slots — derive slot label from the raw starters array.
    const rawStarters = (r.starters as Array<string | null>) ?? [];
    rawStarters.forEach((pid, idx) => {
      if (!isEmptySlot(pid)) return;
      const slot = startingSlots[idx] ?? "FLEX";
      issues.push(
        baseIssue({
          id: `${r.id}:empty:${idx}`,
          category: "empty_slot",
          severity: "critical",
          slot,
          playerName: "Empty",
          playerStatus: "Empty",
          issueType: `Empty ${slot} starter slot`,
        }),
      );
    });

    // 2) Problematic starters (bye / out / IR / inactive / doubtful / questionable).
    for (const p of players) {
      if (!p.isStarter) continue;
      const verdict = playerStatusLabel(p);
      if (verdict) {
        issues.push(
          baseIssue({
            id: `${r.id}:status:${p.playerId}`,
            category: verdict.category,
            severity: verdict.severity,
            slot: p.lineupSlot,
            playerId: p.playerId,
            playerName: p.playerName,
            position: p.position,
            nflTeam: p.team,
            playerStatus: verdict.status,
            issueType:
              verdict.category === "questionable"
                ? "Questionable starter"
                : `Starter ${verdict.status.toLowerCase()}${verdict.status === "Bye" ? " week" : ""}`,
          }),
        );
      }
      // 3) Suspicious benching — a higher-ranked bench player was left out.
      if (p.betterBenchOption) {
        issues.push(
          baseIssue({
            id: `${r.id}:bench:${p.playerId}`,
            category: "suspicious_bench",
            severity: "warning",
            slot: p.lineupSlot,
            playerId: p.playerId,
            playerName: p.playerName,
            position: p.position,
            nflTeam: p.team,
            playerStatus: "Benched better option",
            issueType: p.betterBenchPlayerName
              ? `Higher-ranked bench option (${p.betterBenchPlayerName})`
              : "Higher-ranked bench option available",
          }),
        );
      }
    }
  }

  // Matchup board.
  const teamByRoster = new Map<number, AuditTeam>();
  for (const r of checkRows) {
    const rosterIssues = issues.filter((i) => i.rosterId === r.rosterId);
    teamByRoster.set(r.rosterId, {
      checkId: r.id,
      rosterId: r.rosterId,
      managerName: r.managerName ?? `Roster ${r.rosterId}`,
      teamName: r.teamName ?? r.managerName ?? `Team ${r.rosterId}`,
      integrityScore: r.lineupIntegrityScore ?? 100,
      reviewStatus: r.reviewStatus ?? "none",
      issueCount: rosterIssues.length,
      criticalCount: rosterIssues.filter((i) => i.severity === "critical").length,
      warningCount: rosterIssues.filter((i) => i.severity === "warning").length,
    });
  }

  const matchupGroups = new Map<number | null, AuditTeam[]>();
  for (const r of checkRows) {
    const mid = matchupIdByRoster.get(r.rosterId) ?? null;
    const arr = matchupGroups.get(mid) ?? [];
    const team = teamByRoster.get(r.rosterId);
    if (team) arr.push(team);
    matchupGroups.set(mid, arr);
  }

  const matchups: AuditMatchup[] = [];
  matchupGroups.forEach((teams, matchupId) => {
    teams.sort((a, b) => a.rosterId - b.rosterId);
    const totalIssues = teams.reduce((s, t) => s + t.issueCount, 0);
    const criticalIssues = teams.reduce((s, t) => s + t.criticalCount, 0);
    const matchupIssues = issues.filter((i) => i.matchupId === matchupId);
    const allResolved = matchupIssues.length > 0 && matchupIssues.every((i) => i.issueStatus === "resolved" || i.issueStatus === "ignored");
    let status: MatchupStatus = "clean";
    if (totalIssues === 0) status = "clean";
    else if (allResolved) status = "resolved";
    else if (criticalIssues > 0) status = "critical";
    else status = "needs_review";
    matchups.push({ matchupId, teams, totalIssues, criticalIssues, status });
  });
  // Stable order: most-critical matchups first, then by matchup id.
  matchups.sort(
    (a, b) =>
      b.criticalIssues - a.criticalIssues ||
      b.totalIssues - a.totalIssues ||
      (a.matchupId ?? 9999) - (b.matchupId ?? 9999),
  );

  // Summary.
  const affectedManagers = new Set(issues.map((i) => i.rosterId)).size;
  const criticalIssues = issues.filter((i) => i.severity === "critical").length;
  const emptyStarterSlots = issues.filter((i) => i.category === "empty_slot").length;
  const inactiveStarters = issues.filter((i) => ["out", "ir", "inactive", "bye"].includes(i.category)).length;
  const resolved = issues.filter((i) => i.issueStatus === "resolved" || i.issueStatus === "ignored").length;
  const unresolved = issues.filter((i) => i.issueStatus !== "resolved" && i.issueStatus !== "ignored");
  const cleanTeams = checkRows.filter((r) => !issues.some((i) => i.rosterId === r.rosterId)).length;

  // Over-rostered: a team carrying more total players than the league allows
  // (starting + bench slots from roster_positions, plus taxi and IR slots).
  // Scoped to teams that were checked this week so it tracks the audit's teams.
  const rosterPositions = (league?.roster_positions as string[]) ?? [];
  const taxiSlots = Number((league?.settings as any)?.taxi_slots ?? 0) || 0;
  const reserveSlots = Number((league?.settings as any)?.reserve_slots ?? 0) || 0;
  const rosterLimit = rosterPositions.length + taxiSlots + reserveSlots;
  const checkedRosterIds = new Set(checkRows.map((r) => r.rosterId));
  const overRosteredLineups = rosterLimit > 0
    ? (rosters as Array<{ roster_id: number; players?: string[] | null }>).filter(
        (r) => checkedRosterIds.has(r.roster_id) && (r.players?.length ?? 0) > rosterLimit,
      ).length
    : 0;

  let status: LeagueStatus = "clean";
  if (issues.length === 0) status = "clean";
  else if (unresolved.length === 0) status = "resolved";
  else if (unresolved.some((i) => i.severity === "critical")) status = "critical";
  else status = "needs_review";

  return {
    leagueId,
    season,
    week,
    status,
    summary: {
      totalIssues: issues.length,
      criticalIssues,
      affectedManagers,
      emptyStarterSlots,
      inactiveStarters,
      overRosteredLineups,
      resolved,
      cleanTeams,
      totalTeams: checkRows.length,
    },
    matchups,
    issues,
  };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number;
  week: number;
  rosterId: number | null;
  lineupCheckId: number | null;
  issueKey: string | null;
  action: string;
  actor: string;
  note: string | null;
  createdAt: string | null;
}

export async function appendAuditEntry(input: {
  leagueId: string;
  season: string;
  week: number;
  rosterId?: number | null;
  lineupCheckId?: number | null;
  issueKey?: string | null;
  action: string;
  actor?: string;
  actorUserId?: string | null;
  note?: string | null;
}): Promise<AuditLogEntry> {
  const [row] = await db
    .insert(commissionerLineupAuditLog)
    .values({
      leagueId: input.leagueId,
      season: input.season,
      week: input.week,
      rosterId: input.rosterId ?? null,
      lineupCheckId: input.lineupCheckId ?? null,
      issueKey: input.issueKey ?? null,
      action: input.action,
      actor: input.actor ?? "Commissioner",
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
    })
    .returning();
  return shapeAudit(row);
}

export async function listAuditLog(opts: {
  leagueId: string;
  season: string;
  week?: number;
  lineupCheckId?: number;
  issueKey?: string;
}): Promise<AuditLogEntry[]> {
  const conds = [
    eq(commissionerLineupAuditLog.leagueId, opts.leagueId),
    eq(commissionerLineupAuditLog.season, opts.season),
  ];
  if (opts.week != null) conds.push(eq(commissionerLineupAuditLog.week, opts.week));
  if (opts.lineupCheckId != null) conds.push(eq(commissionerLineupAuditLog.lineupCheckId, opts.lineupCheckId));
  if (opts.issueKey) conds.push(eq(commissionerLineupAuditLog.issueKey, opts.issueKey));

  const rows = await db
    .select()
    .from(commissionerLineupAuditLog)
    .where(and(...conds))
    .orderBy(asc(commissionerLineupAuditLog.createdAt));
  return rows.map(shapeAudit);
}

function shapeAudit(r: typeof commissionerLineupAuditLog.$inferSelect): AuditLogEntry {
  return {
    id: r.id,
    week: r.week,
    rosterId: r.rosterId,
    lineupCheckId: r.lineupCheckId,
    issueKey: r.issueKey,
    action: r.action,
    actor: r.actor ?? "Commissioner",
    note: r.note,
    createdAt: r.createdAt ? new Date(r.createdAt as any).toISOString() : null,
  };
}
