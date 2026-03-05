import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql, desc } from "drizzle-orm";
import { playerValueSnapshots } from "@shared/schema";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function captureValueSnapshot(): Promise<{ inserted: number; skipped: boolean }> {
  const date = todayStr();

  const existing = await db
    .select({ count: sql<number>`count(*)` })
    .from(playerValueSnapshots)
    .where(eq(playerValueSnapshots.snapshotDate, date));

  if (Number(existing[0]?.count) > 0) {
    return { inserted: 0, skipped: true };
  }

  const [dynasty1qb, dynastySf, redraft1qb, redraftSf] = await Promise.all([
    getFantasyCalcValues("1qb"),
    getFantasyCalcValues("sf"),
    getFantasyCalcRedraftValues("1qb"),
    getFantasyCalcRedraftValues("sf"),
  ]);

  const allSleeperIds = new Set<string>();
  for (const p of dynasty1qb.players) allSleeperIds.add(p.sleeperId);
  for (const p of dynastySf.players) allSleeperIds.add(p.sleeperId);
  for (const p of redraft1qb.players) allSleeperIds.add(p.sleeperId);
  for (const p of redraftSf.players) allSleeperIds.add(p.sleeperId);

  const playerInfo = new Map<string, { name: string; pos: string; team: string; age: number }>();
  for (const source of [dynasty1qb.players, dynastySf.players, redraft1qb.players, redraftSf.players]) {
    for (const p of source) {
      if (!playerInfo.has(p.sleeperId)) {
        playerInfo.set(p.sleeperId, { name: p.name, pos: p.pos, team: p.team, age: Math.round(p.age) });
      }
    }
  }

  const rows = Array.from(allSleeperIds).map(sid => {
    const info = playerInfo.get(sid) || { name: "Unknown", pos: "??", team: null, age: null };
    return {
      sleeperId: sid,
      name: info.name,
      pos: info.pos,
      team: info.team,
      age: info.age,
      dynastyValue: dynasty1qb.valuesBySleeperId[sid] || 0,
      dynastyValueSf: dynastySf.valuesBySleeperId[sid] || 0,
      redraftValue: redraft1qb.valuesBySleeperId[sid] || 0,
      redraftValueSf: redraftSf.valuesBySleeperId[sid] || 0,
      snapshotDate: date,
    };
  });

  if (rows.length === 0) return { inserted: 0, skipped: false };

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db.insert(playerValueSnapshots).values(rows.slice(i, i + BATCH_SIZE));
  }

  console.log(`[ValueSnapshots] Captured ${rows.length} player values for ${date}`);
  return { inserted: rows.length, skipped: false };
}

export async function getValueChanges(
  format: "sf" | "1qb" = "sf",
  type: "dynasty" | "redraft" = "dynasty",
  days: number = 30
): Promise<Array<{
  sleeperId: string;
  name: string;
  pos: string;
  team: string | null;
  age: number | null;
  currentValue: number;
  previousValue: number;
  change: number;
  changePct: number;
}>> {
  const today = todayStr();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const valueCol =
    type === "dynasty"
      ? format === "sf" ? playerValueSnapshots.dynastyValueSf : playerValueSnapshots.dynastyValue
      : format === "sf" ? playerValueSnapshots.redraftValueSf : playerValueSnapshots.redraftValue;

  const latestDateResult = await db
    .select({ maxDate: sql<string>`max(${playerValueSnapshots.snapshotDate})` })
    .from(playerValueSnapshots);
  const latestDate = latestDateResult[0]?.maxDate;
  if (!latestDate) return [];

  const comparisonDateResult = await db
    .select({ date: playerValueSnapshots.snapshotDate })
    .from(playerValueSnapshots)
    .where(sql`${playerValueSnapshots.snapshotDate} <= ${cutoffStr}`)
    .groupBy(playerValueSnapshots.snapshotDate)
    .orderBy(desc(playerValueSnapshots.snapshotDate))
    .limit(1);

  let earliestDate: string;
  if (comparisonDateResult.length > 0) {
    earliestDate = comparisonDateResult[0].date;
  } else {
    const oldestResult = await db
      .select({ date: playerValueSnapshots.snapshotDate })
      .from(playerValueSnapshots)
      .where(sql`${playerValueSnapshots.snapshotDate} < ${latestDate}`)
      .groupBy(playerValueSnapshots.snapshotDate)
      .orderBy(sql`${playerValueSnapshots.snapshotDate} asc`)
      .limit(1);
    if (oldestResult.length === 0) return [];
    earliestDate = oldestResult[0].date;
  }
  if (earliestDate === latestDate) return [];

  const currentRows = await db
    .select({
      sleeperId: playerValueSnapshots.sleeperId,
      name: playerValueSnapshots.name,
      pos: playerValueSnapshots.pos,
      team: playerValueSnapshots.team,
      age: playerValueSnapshots.age,
      value: valueCol,
    })
    .from(playerValueSnapshots)
    .where(eq(playerValueSnapshots.snapshotDate, latestDate));

  const previousRows = await db
    .select({
      sleeperId: playerValueSnapshots.sleeperId,
      value: valueCol,
    })
    .from(playerValueSnapshots)
    .where(eq(playerValueSnapshots.snapshotDate, earliestDate));

  const prevMap = new Map<string, number>();
  for (const row of previousRows) {
    prevMap.set(row.sleeperId, row.value);
  }

  const changes: Array<{
    sleeperId: string;
    name: string;
    pos: string;
    team: string | null;
    age: number | null;
    currentValue: number;
    previousValue: number;
    change: number;
    changePct: number;
  }> = [];

  for (const row of currentRows) {
    const prev = prevMap.get(row.sleeperId);
    if (prev === undefined) continue;
    if (prev === 0 && row.value === 0) continue;
    const change = row.value - prev;
    if (change === 0) continue;
    const changePct = prev > 0 ? Math.round((change / prev) * 100) : change > 0 ? 100 : -100;
    changes.push({
      sleeperId: row.sleeperId,
      name: row.name,
      pos: row.pos,
      team: row.team,
      age: row.age,
      currentValue: row.value,
      previousValue: prev,
      change,
      changePct,
    });
  }

  return changes;
}

export async function getAvailableSnapshotDates(): Promise<string[]> {
  const result = await db
    .select({ date: playerValueSnapshots.snapshotDate })
    .from(playerValueSnapshots)
    .groupBy(playerValueSnapshots.snapshotDate)
    .orderBy(desc(playerValueSnapshots.snapshotDate));
  return result.map(r => r.date);
}

let snapshotInterval: NodeJS.Timeout | null = null;

export function startSnapshotScheduler() {
  captureValueSnapshot()
    .then(r => {
      if (r.skipped) console.log("[ValueSnapshots] Today's snapshot already exists, skipped.");
      else console.log(`[ValueSnapshots] Initial snapshot: ${r.inserted} players captured.`);
    })
    .catch(err => console.error("[ValueSnapshots] Failed to capture initial snapshot:", err));

  snapshotInterval = setInterval(() => {
    captureValueSnapshot().catch(err =>
      console.error("[ValueSnapshots] Scheduled snapshot failed:", err)
    );
  }, 6 * 60 * 60 * 1000);
}

export function stopSnapshotScheduler() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}
