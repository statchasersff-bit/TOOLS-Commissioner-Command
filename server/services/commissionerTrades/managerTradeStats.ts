/**
 * managerTradeStats — maintain the aggregated manager-to-manager trade history
 * used for the repeat-partner flag and the Manager Trade History UI.
 *
 * One row per unordered roster pair per league (lower roster id = rosterIdA).
 * For trades with 3+ rosters we record every pairwise combination so a busy
 * three-team trade still counts toward each manager pair.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { commissionerManagerTradeStats } from "@shared/schema";
import { getManagerPairKey } from "./helpers";

/** All unordered pairs from a list of roster ids. */
export function rosterPairs(rosterIds: number[]): Array<[number, number]> {
  const uniq = Array.from(new Set(rosterIds)).sort((a, b) => a - b);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      pairs.push([uniq[i], uniq[j]]);
    }
  }
  return pairs;
}

/**
 * Count how many trades the given roster pair has done in a league. Reads the
 * current aggregate; returns 0 if the pair has never traded. Used to compute the
 * repeat-partner count BEFORE the current trade is recorded.
 */
export async function getPairTradeCount(
  leagueId: string,
  a: number,
  b: number,
): Promise<number> {
  const { rosterIdA, rosterIdB } = getManagerPairKey(a, b);
  const rows = await db
    .select({ tradeCount: commissionerManagerTradeStats.tradeCount })
    .from(commissionerManagerTradeStats)
    .where(
      and(
        eq(commissionerManagerTradeStats.leagueId, leagueId),
        eq(commissionerManagerTradeStats.rosterIdA, rosterIdA),
        eq(commissionerManagerTradeStats.rosterIdB, rosterIdB),
      ),
    );
  return rows[0]?.tradeCount ?? 0;
}

/**
 * For a 2-team trade, the repeat-partner count is the existing pair count + 1
 * (this trade). For multi-team, return the max pairwise count so the busiest
 * relationship drives the flag.
 */
export async function computeRepeatPartnerCount(
  leagueId: string,
  rosterIds: number[],
): Promise<number> {
  const pairs = rosterPairs(rosterIds);
  if (pairs.length === 0) return 0;
  let max = 0;
  for (const [a, b] of pairs) {
    const prior = await getPairTradeCount(leagueId, a, b);
    max = Math.max(max, prior + 1);
  }
  return max;
}

/**
 * Record a trade's contribution to every roster pair's aggregate. Idempotent at
 * the trade level is the caller's responsibility (only call once per NEW trade).
 */
export async function recordTradeForPairs(opts: {
  leagueId: string;
  rosterIds: number[];
  tradeTs: number | null;
  valueMoved: number;
  valueDiffPct: number;
}): Promise<void> {
  const { leagueId, rosterIds, tradeTs, valueMoved, valueDiffPct } = opts;
  for (const [a, b] of rosterPairs(rosterIds)) {
    const { rosterIdA, rosterIdB } = getManagerPairKey(a, b);
    await db
      .insert(commissionerManagerTradeStats)
      .values({
        leagueId,
        rosterIdA,
        rosterIdB,
        tradeCount: 1,
        lastTradeTs: tradeTs ?? undefined,
        totalValueMoved: String(valueMoved),
        avgValueDiffPct: String(valueDiffPct),
      })
      .onConflictDoUpdate({
        target: [
          commissionerManagerTradeStats.leagueId,
          commissionerManagerTradeStats.rosterIdA,
          commissionerManagerTradeStats.rosterIdB,
        ],
        set: {
          tradeCount: sql`${commissionerManagerTradeStats.tradeCount} + 1`,
          // Keep the most recent trade timestamp.
          lastTradeTs: sql`GREATEST(COALESCE(${commissionerManagerTradeStats.lastTradeTs}, 0), ${tradeTs ?? 0})`,
          totalValueMoved: sql`${commissionerManagerTradeStats.totalValueMoved} + ${valueMoved}`,
          // Running average of value-diff pct.
          avgValueDiffPct: sql`((${commissionerManagerTradeStats.avgValueDiffPct} * ${commissionerManagerTradeStats.tradeCount}) + ${valueDiffPct}) / (${commissionerManagerTradeStats.tradeCount} + 1)`,
          updatedAt: sql`NOW()`,
        },
      });
  }
}
