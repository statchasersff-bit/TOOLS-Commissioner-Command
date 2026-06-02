import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { leagueFinances } from "@shared/schema";

// Shared, capped pool (see server/db.ts). getDb() retained for call-site compat.
function getDb() {
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
  isFree?: boolean;
  ignored?: boolean;
  leagueSafeUrl?: string;
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
        isFree: data.isFree ?? false,
        ignored: data.ignored ?? false,
        leagueSafeUrl: data.leagueSafeUrl ?? null,
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
      isFree: data.isFree ?? false,
      ignored: data.ignored ?? false,
      leagueSafeUrl: data.leagueSafeUrl ?? null,
    });
  }
  return { ok: true };
}
