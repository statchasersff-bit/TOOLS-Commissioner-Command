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
  payments?: unknown[];
  notes?: string;
  isFree?: boolean;
  ignored?: boolean;
  leagueSafeUrl?: string;
  leagueSafeStatus?: string | null;
  dueDate?: string | null;
  paymentRule?: string | null;
}) {
  const d = getDb();
  // Natural key is (sleeperUserId, leagueId, season) — dynasty leagues keep one
  // finance row per season, so the season MUST be part of the match.
  const keyMatch = and(
    eq(leagueFinances.sleeperUserId, data.sleeperUserId),
    eq(leagueFinances.leagueId, data.leagueId),
    eq(leagueFinances.season, data.season),
  );
  const existing = await d.select().from(leagueFinances).where(keyMatch).limit(1);

  const fields = {
    buyIn: data.buyIn,
    prizes: data.prizes as any,
    payments: (data.payments ?? []) as any,
    notes: data.notes ?? null,
    isFree: data.isFree ?? false,
    ignored: data.ignored ?? false,
    leagueSafeUrl: data.leagueSafeUrl ?? null,
    leagueSafeStatus: data.leagueSafeStatus ?? null,
    dueDate: data.dueDate ?? null,
    paymentRule: data.paymentRule ?? null,
  };

  if (existing.length > 0) {
    await d
      .update(leagueFinances)
      .set({ ...fields, updatedAt: new Date() })
      .where(keyMatch);
  } else {
    await d.insert(leagueFinances).values({
      sleeperUserId: data.sleeperUserId,
      leagueId: data.leagueId,
      season: data.season,
      ...fields,
    });
  }
  return { ok: true };
}
