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
import { and, eq, desc, gt, gte, lte, inArray, max, sql } from "drizzle-orm";
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
import { getActivityLabel } from "./helpers";

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
        // Skip the season aggregate (week 0); callers want the latest real week.
        gt(commissionerActivitySnapshots.week, 0),
      ),
    )
    .orderBy(desc(commissionerActivitySnapshots.week))
    .limit(1);
  return row ?? null;
}

/** The whole-season aggregate snapshot (stored under the sentinel week 0). */
export async function getSeasonSnapshot(
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
        eq(commissionerActivitySnapshots.week, 0),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Sum every real (week ≥ 1) snapshot into season cumulative totals + week count. */
export async function getSeasonTotals(
  leagueId: string,
  season: string,
): Promise<{
  weeks: number;
  totalTransactions: number;
  totalTrades: number;
  totalWaivers: number;
  totalFreeAgentMoves: number;
  totalLineupChanges: number;
  totalEmptyStarterSlots: number;
}> {
  const [row] = await db
    .select({
      weeks: sql<number>`count(*)`,
      totalTransactions: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalTransactions}), 0)`,
      totalTrades: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalTrades}), 0)`,
      totalWaivers: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalWaivers}), 0)`,
      totalFreeAgentMoves: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalFreeAgentMoves}), 0)`,
      totalLineupChanges: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalLineupChanges}), 0)`,
      totalEmptyStarterSlots: sql<number>`coalesce(sum(${commissionerActivitySnapshots.totalEmptyStarterSlots}), 0)`,
    })
    .from(commissionerActivitySnapshots)
    .where(
      and(
        eq(commissionerActivitySnapshots.leagueId, leagueId),
        eq(commissionerActivitySnapshots.season, season),
        gt(commissionerActivitySnapshots.week, 0),
      ),
    );
  return {
    weeks: Number(row?.weeks ?? 0),
    totalTransactions: Number(row?.totalTransactions ?? 0),
    totalTrades: Number(row?.totalTrades ?? 0),
    totalWaivers: Number(row?.totalWaivers ?? 0),
    totalFreeAgentMoves: Number(row?.totalFreeAgentMoves ?? 0),
    totalLineupChanges: Number(row?.totalLineupChanges ?? 0),
    totalEmptyStarterSlots: Number(row?.totalEmptyStarterSlots ?? 0),
  };
}

/** Each roster's season-average activity / inactivity-risk across real weeks. */
export async function getSeasonManagerAggregates(
  leagueId: string,
  season: string,
): Promise<{ rosterId: number; avgActivityScore: number; avgRiskScore: number }[]> {
  const rows = await db
    .select({
      rosterId: commissionerManagerActivity.rosterId,
      avgActivityScore: sql<number>`avg(${commissionerManagerActivity.activityScore})`,
      avgRiskScore: sql<number>`avg(${commissionerManagerActivity.inactivityRiskScore})`,
    })
    .from(commissionerManagerActivity)
    .where(
      and(
        eq(commissionerManagerActivity.leagueId, leagueId),
        eq(commissionerManagerActivity.season, season),
        gt(commissionerManagerActivity.week, 0),
      ),
    )
    .groupBy(commissionerManagerActivity.rosterId);
  return rows.map((r) => ({
    rosterId: r.rosterId,
    avgActivityScore: Number(r.avgActivityScore ?? 0),
    avgRiskScore: Number(r.avgRiskScore ?? 0),
  }));
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

/**
 * Season-wide manager rows: one row per roster, aggregating every scored week.
 * Counts (transactions / trades / waivers / FA / adds / drops / lineup changes /
 * empty starters) are summed across the season; activity & risk scores are the
 * season average; point-in-time fields (identity, current staleness, flags, last
 * move/lineup timestamps) come from the latest scored week. Sorted by risk desc
 * to mirror getManagerRows.
 */
export async function getSeasonManagerRows(
  leagueId: string,
  season: string,
): Promise<CommissionerManagerActivity[]> {
  const rows = await db
    .select()
    .from(commissionerManagerActivity)
    .where(
      and(
        eq(commissionerManagerActivity.leagueId, leagueId),
        eq(commissionerManagerActivity.season, season),
        gt(commissionerManagerActivity.week, 0),
      ),
    )
    .orderBy(commissionerManagerActivity.week); // ascending → last = latest week

  const byRoster = new Map<number, CommissionerManagerActivity[]>();
  for (const r of rows) {
    const list = byRoster.get(r.rosterId) ?? [];
    list.push(r);
    byRoster.set(r.rosterId, list);
  }

  const aggregated: CommissionerManagerActivity[] = [];
  for (const list of Array.from(byRoster.values())) {
    const latest = list[list.length - 1];
    const n = list.length || 1;
    const sum = (pick: (m: CommissionerManagerActivity) => number | null) =>
      list.reduce((s, m) => s + (pick(m) ?? 0), 0);
    const maxTs = (pick: (m: CommissionerManagerActivity) => number | null) =>
      list.reduce<number | null>((acc, m) => {
        const v = pick(m);
        return v != null && (acc == null || v > acc) ? v : acc;
      }, null);

    const activityScore = Math.round(sum((m) => m.activityScore) / n);
    const inactivityRiskScore = Math.round(sum((m) => m.inactivityRiskScore) / n);

    aggregated.push({
      ...latest,
      transactionsCount: sum((m) => m.transactionsCount),
      tradesCount: sum((m) => m.tradesCount),
      waiverCount: sum((m) => m.waiverCount),
      freeAgentCount: sum((m) => m.freeAgentCount),
      addsCount: sum((m) => m.addsCount),
      dropsCount: sum((m) => m.dropsCount),
      lineupChangeCount: sum((m) => m.lineupChangeCount),
      lineupChanged: list.some((m) => m.lineupChanged),
      emptyStarterSlots: sum((m) => m.emptyStarterSlots),
      activityScore,
      inactivityRiskScore,
      activityLabel: getActivityLabel(activityScore),
      lastTransactionTs: maxTs((m) => m.lastTransactionTs),
      lastLineupChangeTs: maxTs((m) => m.lastLineupChangeTs),
    });
  }

  aggregated.sort((a, b) => (b.inactivityRiskScore ?? 0) - (a.inactivityRiskScore ?? 0));
  return aggregated;
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
