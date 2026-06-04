/**
 * Convert Sleeper transactions into normalized ActivityEvents.
 *
 * Sleeper transaction types we handle in Phase 1: "trade", "waiver",
 * "free_agent". A transaction can involve multiple rosters (trades), so we emit
 * one event per (transaction, roster) pair. Only completed transactions count —
 * failed/pending waivers are noise for activity scoring.
 */
import type {
  ActivityEvent,
  SleeperTransaction,
  SleeperRoster,
  SleeperLeagueUser,
} from "./types";
import { getOwnerIdForRoster } from "./helpers";

export interface ParseTransactionInput {
  leagueId: string;
  season: string;
  week: number;
  transactions: SleeperTransaction[];
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
}

export function parseTransactionEvents(input: ParseTransactionInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const tx of input.transactions ?? []) {
    if (tx.status && tx.status !== "complete") continue;

    const rosterIds = tx.roster_ids ?? [];
    const eventTs = tx.status_updated ?? tx.created ?? null;
    const adds = tx.adds ?? {};
    const drops = tx.drops ?? {};

    for (const rosterId of rosterIds) {
      const ownerId = getOwnerIdForRoster(input.rosters, rosterId);
      const base = {
        leagueId: input.leagueId,
        season: input.season,
        week: input.week,
        rosterId,
        ownerId,
        transactionId: tx.transaction_id,
        eventTs,
        severity: "info" as const,
      };

      if (tx.type === "trade") {
        events.push({
          ...base,
          eventType: "trade",
          eventTitle: "Trade completed",
          eventDescription: `Roster ${rosterId} completed a trade.`,
          relatedRosterIds: rosterIds,
          rawEvent: tx,
        });
      } else if (tx.type === "waiver") {
        events.push({
          ...base,
          eventType: "waiver",
          eventTitle: "Waiver move completed",
          eventDescription: `Roster ${rosterId} completed a waiver claim.`,
          relatedPlayerIds: playerIdsForRoster(adds, drops, rosterId),
          rawEvent: tx,
        });
      } else if (tx.type === "free_agent") {
        events.push({
          ...base,
          eventType: "free_agent",
          eventTitle: "Free agent move completed",
          eventDescription: `Roster ${rosterId} added or dropped a player.`,
          relatedPlayerIds: playerIdsForRoster(adds, drops, rosterId),
          rawEvent: tx,
        });
      }
    }
  }

  return events;
}

/** Player ids in `adds`/`drops` that belong to a specific roster id. */
function playerIdsForRoster(
  adds: Record<string, number>,
  drops: Record<string, number>,
  rosterId: number,
): string[] {
  const ids: string[] = [];
  for (const [pid, rid] of Object.entries(adds)) {
    if (Number(rid) === Number(rosterId)) ids.push(pid);
  }
  for (const [pid, rid] of Object.entries(drops)) {
    if (Number(rid) === Number(rosterId)) ids.push(pid);
  }
  return ids;
}

/** Adds/drops counts for a roster across all completed transactions of the week. */
export function countAddsDropsForRoster(
  transactions: SleeperTransaction[],
  rosterId: number,
): { addsCount: number; dropsCount: number } {
  let addsCount = 0;
  let dropsCount = 0;
  for (const tx of transactions ?? []) {
    if (tx.status && tx.status !== "complete") continue;
    for (const rid of Object.values(tx.adds ?? {})) {
      if (Number(rid) === Number(rosterId)) addsCount++;
    }
    for (const rid of Object.values(tx.drops ?? {})) {
      if (Number(rid) === Number(rosterId)) dropsCount++;
    }
  }
  return { addsCount, dropsCount };
}
