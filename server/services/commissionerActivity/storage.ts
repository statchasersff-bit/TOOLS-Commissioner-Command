/**
 * Persistence for League Activity Monitoring. All reads/writes go through the
 * shared capped pool (server/db.ts). Upserts use the natural keys declared in
 * shared/schema.ts so a re-scan updates rather than duplicates.
 *
 * Alert upserts intentionally DO NOT clobber a commissioner's status/notes: on
 * conflict we refresh the content (severity/title/description/week) but leave
 * status, notes, and resolvedAt untouched, so an acknowledged/resolved alert
 * stays that way across re-scans.
 */
import { and, eq, desc, gte, lte, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  commissionerActivitySnapshots,
  commissionerManagerActivity,
  commissionerActivityEvents,
  commissionerActivityAlerts,
  type CommissionerActivitySnapshot,
  type CommissionerManagerActivity,
  type CommissionerActivityEvent,
  type CommissionerActivityAlert,
} from "@shared/schema";
import type {
  LeagueSnapshotRow,
  ManagerActivityRow,
  ActivityEvent,
  ActivityAlertRow,
} from "./types";

// ── Writes ───────────────────────────────────────────────────────────────────

export async function saveActivitySnapshot(row: LeagueSnapshotRow): Promise<void> {
  await db
    .insert(commissionerActivitySnapshots)
    .values({
      leagueId: row.leagueId,
      season: row.season,
      week: row.week,
      totalTransactions: row.totalTransactions,
      totalTrades: row.totalTrades,
      totalWaivers: row.totalWaivers,
      totalFreeAgentMoves: row.totalFreeAgentMoves,
      totalLineupChanges: row.totalLineupChanges,
      totalEmptyStarterSlots: row.totalEmptyStarterSlots,
      activeManagerCount: row.activeManagerCount,
      inactiveManagerCount: row.inactiveManagerCount,
      leagueActivityScore: row.leagueActivityScore,
      leagueActivityLabel: row.leagueActivityLabel,
      rawSummary: row.rawSummary as any,
    })
    .onConflictDoUpdate({
      target: [
        commissionerActivitySnapshots.leagueId,
        commissionerActivitySnapshots.season,
        commissionerActivitySnapshots.week,
      ],
      set: {
        totalTransactions: row.totalTransactions,
        totalTrades: row.totalTrades,
        totalWaivers: row.totalWaivers,
        totalFreeAgentMoves: row.totalFreeAgentMoves,
        totalLineupChanges: row.totalLineupChanges,
        totalEmptyStarterSlots: row.totalEmptyStarterSlots,
        activeManagerCount: row.activeManagerCount,
        inactiveManagerCount: row.inactiveManagerCount,
        leagueActivityScore: row.leagueActivityScore,
        leagueActivityLabel: row.leagueActivityLabel,
        rawSummary: row.rawSummary as any,
        updatedAt: sql`now()`,
      },
    });
}

export async function saveManagerActivityRows(rows: ManagerActivityRow[]): Promise<number> {
  if (!rows.length) return 0;
  for (const row of rows) {
    await db
      .insert(commissionerManagerActivity)
      .values({
        leagueId: row.leagueId,
        season: row.season,
        week: row.week,
        rosterId: row.rosterId,
        ownerId: row.ownerId,
        managerName: row.managerName,
        teamName: row.teamName,
        transactionsCount: row.transactionsCount,
        tradesCount: row.tradesCount,
        waiverCount: row.waiverCount,
        freeAgentCount: row.freeAgentCount,
        addsCount: row.addsCount,
        dropsCount: row.dropsCount,
        lineupChanged: row.lineupChanged,
        lineupChangeCount: row.lineupChangeCount,
        emptyStarterSlots: row.emptyStarterSlots,
        lastTransactionTs: row.lastTransactionTs,
        lastLineupChangeTs: row.lastLineupChangeTs,
        weeksSinceTransaction: row.weeksSinceTransaction,
        weeksSinceLineupChange: row.weeksSinceLineupChange,
        activityScore: row.activityScore,
        inactivityRiskScore: row.inactivityRiskScore,
        activityLabel: row.activityLabel,
        flags: row.flags as any,
        rawRoster: (row.rawRoster ?? {}) as any,
        rawMatchup: (row.rawMatchup ?? {}) as any,
      })
      .onConflictDoUpdate({
        target: [
          commissionerManagerActivity.leagueId,
          commissionerManagerActivity.season,
          commissionerManagerActivity.week,
          commissionerManagerActivity.rosterId,
        ],
        set: {
          ownerId: row.ownerId,
          managerName: row.managerName,
          teamName: row.teamName,
          transactionsCount: row.transactionsCount,
          tradesCount: row.tradesCount,
          waiverCount: row.waiverCount,
          freeAgentCount: row.freeAgentCount,
          addsCount: row.addsCount,
          dropsCount: row.dropsCount,
          lineupChanged: row.lineupChanged,
          lineupChangeCount: row.lineupChangeCount,
          emptyStarterSlots: row.emptyStarterSlots,
          lastTransactionTs: row.lastTransactionTs,
          lastLineupChangeTs: row.lastLineupChangeTs,
          weeksSinceTransaction: row.weeksSinceTransaction,
          weeksSinceLineupChange: row.weeksSinceLineupChange,
          activityScore: row.activityScore,
          inactivityRiskScore: row.inactivityRiskScore,
          activityLabel: row.activityLabel,
          flags: row.flags as any,
          rawRoster: (row.rawRoster ?? {}) as any,
          rawMatchup: (row.rawMatchup ?? {}) as any,
          updatedAt: sql`now()`,
        },
      });
  }
  return rows.length;
}

/**
 * Replace all stored events for a (league, season, week) with the freshly parsed
 * set. Events have no natural unique key (a roster can have many of one type),
 * so we delete-then-insert per week to keep re-scans idempotent.
 */
export async function saveActivityEventsForWeek(
  leagueId: string,
  season: string,
  week: number,
  events: ActivityEvent[],
): Promise<number> {
  await db
    .delete(commissionerActivityEvents)
    .where(
      and(
        eq(commissionerActivityEvents.leagueId, leagueId),
        eq(commissionerActivityEvents.season, season),
        eq(commissionerActivityEvents.week, week),
      ),
    );
  if (!events.length) return 0;
  await db.insert(commissionerActivityEvents).values(
    events.map((e) => ({
      leagueId: e.leagueId,
      season: e.season,
      week: e.week,
      rosterId: e.rosterId ?? null,
      ownerId: e.ownerId ?? null,
      eventType: e.eventType,
      eventTitle: e.eventTitle,
      eventDescription: e.eventDescription ?? null,
      transactionId: e.transactionId ?? null,
      relatedPlayerIds: (e.relatedPlayerIds ?? []) as any,
      relatedRosterIds: (e.relatedRosterIds ?? []) as any,
      eventTs: e.eventTs ?? null,
      severity: e.severity,
      rawEvent: (e.rawEvent ?? {}) as any,
    })),
  );
  return events.length;
}

export async function saveActivityAlerts(alerts: ActivityAlertRow[]): Promise<number> {
  if (!alerts.length) return 0;
  for (const a of alerts) {
    await db
      .insert(commissionerActivityAlerts)
      .values({
        leagueId: a.leagueId,
        season: a.season,
        week: a.week,
        rosterId: a.rosterId,
        ownerId: a.ownerId,
        alertType: a.alertType,
        severity: a.severity,
        title: a.title,
        description: a.description,
        status: a.status,
      })
      .onConflictDoUpdate({
        target: [
          commissionerActivityAlerts.leagueId,
          commissionerActivityAlerts.season,
          commissionerActivityAlerts.week,
          commissionerActivityAlerts.rosterId,
          commissionerActivityAlerts.alertType,
        ],
        // Refresh content only — never overwrite the commissioner's status/notes.
        set: {
          severity: a.severity,
          title: a.title,
          description: a.description,
        },
      });
  }
  return alerts.length;
}

// ── Weeks-since helpers (read stored events) ─────────────────────────────────

const TRANSACTION_EVENT_TYPES = ["trade", "waiver", "free_agent"];

/** Latest week ≤ maxWeek that has any event of the given types for a roster. */
export async function getLatestWeekWithEvent(
  leagueId: string,
  season: string,
  rosterId: number,
  eventTypes: string[],
  maxWeek: number,
): Promise<number | null> {
  const [row] = await db
    .select({ wk: max(commissionerActivityEvents.week) })
    .from(commissionerActivityEvents)
    .where(
      and(
        eq(commissionerActivityEvents.leagueId, leagueId),
        eq(commissionerActivityEvents.season, season),
        eq(commissionerActivityEvents.rosterId, rosterId),
        inArray(commissionerActivityEvents.eventType, eventTypes),
        lte(commissionerActivityEvents.week, maxWeek),
      ),
    );
  return row?.wk ?? null;
}

export async function getWeeksSinceLastTransaction(
  leagueId: string,
  season: string,
  rosterId: number,
  currentWeek: number,
): Promise<number> {
  const wk = await getLatestWeekWithEvent(leagueId, season, rosterId, TRANSACTION_EVENT_TYPES, currentWeek);
  return wk != null ? Math.max(0, currentWeek - wk) : currentWeek;
}

export async function getWeeksSinceLastLineupChange(
  leagueId: string,
  season: string,
  rosterId: number,
  currentWeek: number,
): Promise<number | null> {
  const wk = await getLatestWeekWithEvent(leagueId, season, rosterId, ["lineup_change"], currentWeek);
  if (wk != null) return Math.max(0, currentWeek - wk);
  // No change ever recorded. Week 1 can't be compared, so leave it unknown there.
  return currentWeek > 1 ? currentWeek - 1 : null;
}

// ── Reads for routes ─────────────────────────────────────────────────────────

export async function getSnapshot(
  leagueId: string,
  season: string,
  week: number,
): Promise<CommissionerActivitySnapshot | null> {
  const [row] = await db
    .select()
    .from(commissionerActivitySnapshots)
    .where(
      and(
        eq(commissionerActivitySnapshots.leagueId, leagueId),
        eq(commissionerActivitySnapshots.season, season),
        eq(commissionerActivitySnapshots.week, week),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getLatestSnapshot(
  leagueId: string,
  season: string,
): Promise<CommissionerActivitySnapshot | null> {
  const [row] = await db
    .select()
    .from(commissionerActivitySnapshots)
    .where(
      and(
        eq(commissionerActivitySnapshots.leagueId, leagueId),
        eq(commissionerActivitySnapshots.season, season),
      ),
    )
    .orderBy(desc(commissionerActivitySnapshots.week))
    .limit(1);
  return row ?? null;
}

export async function getManagerRows(
  leagueId: string,
  season: string,
  week: number,
): Promise<CommissionerManagerActivity[]> {
  return db
    .select()
    .from(commissionerManagerActivity)
    .where(
      and(
        eq(commissionerManagerActivity.leagueId, leagueId),
        eq(commissionerManagerActivity.season, season),
        eq(commissionerManagerActivity.week, week),
      ),
    )
    .orderBy(desc(commissionerManagerActivity.inactivityRiskScore));
}

export interface FeedFilters {
  eventType?: string;
  rosterId?: number;
  severity?: string;
  fromTs?: number;
  toTs?: number;
}

export async function getEvents(
  leagueId: string,
  season: string,
  week: number | null,
  filters: FeedFilters,
): Promise<CommissionerActivityEvent[]> {
  const conds = [
    eq(commissionerActivityEvents.leagueId, leagueId),
    eq(commissionerActivityEvents.season, season),
  ];
  if (week != null) conds.push(eq(commissionerActivityEvents.week, week));
  if (filters.eventType) conds.push(eq(commissionerActivityEvents.eventType, filters.eventType));
  if (filters.rosterId != null) conds.push(eq(commissionerActivityEvents.rosterId, filters.rosterId));
  if (filters.severity) conds.push(eq(commissionerActivityEvents.severity, filters.severity));
  if (filters.fromTs != null) conds.push(gte(commissionerActivityEvents.eventTs, filters.fromTs));
  if (filters.toTs != null) conds.push(lte(commissionerActivityEvents.eventTs, filters.toTs));

  return db
    .select()
    .from(commissionerActivityEvents)
    .where(and(...conds))
    .orderBy(desc(commissionerActivityEvents.week), desc(commissionerActivityEvents.eventTs))
    .limit(500);
}

export async function getAlerts(
  leagueId: string,
  opts: { status?: string; season?: string; week?: number } = {},
): Promise<CommissionerActivityAlert[]> {
  const conds = [eq(commissionerActivityAlerts.leagueId, leagueId)];
  if (opts.status) conds.push(eq(commissionerActivityAlerts.status, opts.status));
  if (opts.season) conds.push(eq(commissionerActivityAlerts.season, opts.season));
  if (opts.week != null) conds.push(eq(commissionerActivityAlerts.week, opts.week));
  return db
    .select()
    .from(commissionerActivityAlerts)
    .where(and(...conds))
    .orderBy(desc(commissionerActivityAlerts.createdAt))
    .limit(500);
}

export async function updateAlertStatus(
  alertId: number,
  status: string,
  notes?: string,
): Promise<CommissionerActivityAlert | null> {
  const set: Record<string, unknown> = { status };
  if (notes !== undefined) set.notes = notes;
  set.resolvedAt = status === "resolved" || status === "dismissed" ? sql`now()` : null;
  const [row] = await db
    .update(commissionerActivityAlerts)
    .set(set)
    .where(eq(commissionerActivityAlerts.id, alertId))
    .returning();
  return row ?? null;
}

export async function countOpenAlerts(leagueId: string): Promise<number> {
  const rows = await db
    .select({ id: commissionerActivityAlerts.id })
    .from(commissionerActivityAlerts)
    .where(
      and(
        eq(commissionerActivityAlerts.leagueId, leagueId),
        eq(commissionerActivityAlerts.status, "open"),
      ),
    );
  return rows.length;
}
