import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { leagueFinances } from "@shared/schema";

let db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool);
  }
  return db;
}

export async function getFinancesForUser(sleeperUserId: string) {
  const d = getDb();
  return d.select().from(leagueFinances).where(eq(leagueFinances.sleeperUserId, sleeperUserId));
}

export async function upsertLeagueFinance(data: {
  sleeperUserId: string;
  leagueId: string;
  season: string;
  buyIn: number;
  prizes: { place: number; amount: number }[];
  notes?: string;
}) {
  const d = getDb();
  const existing = await d
    .select()
    .from(leagueFinances)
    .where(and(eq(leagueFinances.sleeperUserId, data.sleeperUserId), eq(leagueFinances.leagueId, data.leagueId)))
    .limit(1);

  if (existing.length > 0) {
    await d
      .update(leagueFinances)
      .set({
        buyIn: data.buyIn,
        prizes: data.prizes as any,
        notes: data.notes ?? null,
        season: data.season,
        updatedAt: new Date(),
      })
      .where(and(eq(leagueFinances.sleeperUserId, data.sleeperUserId), eq(leagueFinances.leagueId, data.leagueId)));
  } else {
    await d.insert(leagueFinances).values({
      sleeperUserId: data.sleeperUserId,
      leagueId: data.leagueId,
      season: data.season,
      buyIn: data.buyIn,
      prizes: data.prizes as any,
      notes: data.notes ?? null,
    });
  }
  return { ok: true };
}
