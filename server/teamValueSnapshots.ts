import { and, eq, asc } from "drizzle-orm";
import { db } from "./db";
import { teamValueSnapshots } from "@shared/schema";

// Shared, capped pool (see server/db.ts). getDb() retained for call-site compat.
function getDb() {
  return db;
}

export interface SnapshotInput {
  leagueId: string;
  rosterId: number;
  snapshotDate: string; // YYYY-MM-DD
  dynastyValue: number;
  winNowValue: number;
  pickValue: number;
  starterStrength: number;
  avgAge: number; // we store * 10 internally
}

/**
 * Idempotent per (leagueId, rosterId, snapshotDate). If a row for today
 * already exists we update it with fresh numbers — value-source switches
 * during the day shouldn't create dupes, and the latest read of the day wins.
 */
export async function upsertTeamSnapshot(input: SnapshotInput) {
  const d = getDb();
  const where = and(
    eq(teamValueSnapshots.leagueId, input.leagueId),
    eq(teamValueSnapshots.rosterId, input.rosterId),
    eq(teamValueSnapshots.snapshotDate, input.snapshotDate),
  );
  const existing = await d.select().from(teamValueSnapshots).where(where).limit(1);
  const payload = {
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    snapshotDate: input.snapshotDate,
    dynastyValue: Math.round(input.dynastyValue),
    winNowValue: Math.round(input.winNowValue),
    pickValue: Math.round(input.pickValue),
    starterStrength: Math.round(input.starterStrength),
    avgAgeX10: Math.round(input.avgAge * 10),
  };
  if (existing.length > 0) {
    await d.update(teamValueSnapshots).set(payload).where(where);
  } else {
    await d.insert(teamValueSnapshots).values(payload);
  }
  return { ok: true };
}

export async function getTeamSnapshots(leagueId: string, rosterId: number) {
  const d = getDb();
  const rows = await d
    .select()
    .from(teamValueSnapshots)
    .where(and(eq(teamValueSnapshots.leagueId, leagueId), eq(teamValueSnapshots.rosterId, rosterId)))
    .orderBy(asc(teamValueSnapshots.snapshotDate));
  return rows.map((r) => ({
    snapshotDate: r.snapshotDate,
    dynastyValue: r.dynastyValue,
    winNowValue: r.winNowValue,
    pickValue: r.pickValue,
    starterStrength: r.starterStrength,
    avgAge: (r.avgAgeX10 ?? 0) / 10,
    capturedAt: r.capturedAt ? r.capturedAt.toISOString() : null,
  }));
}
