/**
 * Convert Sleeper transactions into normalized ActivityEvents.
 *
 * Sleeper transaction types we handle in Phase 1: "trade", "waiver",
 * "free_agent". A transaction can involve multiple rosters (trades), so we emit
 * one event per (transaction, roster) pair. Only completed transactions count —
 * failed/pending waivers are noise for activity scoring.
 *
 * Event titles are human-readable using resolved team and player names
 * ("Team Alpha added Josh Downs") when a player map + users are supplied, and
 * gracefully fall back to "Team N" / raw ids when they are not.
 */
import type {
  ActivityEvent,
  SleeperTransaction,
  SleeperRoster,
  SleeperLeagueUser,
} from "./types";
import { getOwnerIdForRoster, buildUserMap, getTeamName } from "./helpers";

/** Minimal player shape from Sleeper's /players/nfl payload. */
export interface PlayerLite {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  team?: string | null;
}
export type PlayersById = Record<string, PlayerLite | undefined>;

export interface ParseTransactionInput {
  leagueId: string;
  season: string;
  week: number;
  transactions: SleeperTransaction[];
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  /** Optional /players/nfl map for resolving player names in event text. */
  players?: PlayersById;
}

export function parseTransactionEvents(input: ParseTransactionInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const userById = buildUserMap(input.users ?? []);
  const players = input.players ?? {};

  const teamName = (rosterId: number): string => {
    const roster = (input.rosters ?? []).find((r) => Number(r.roster_id) === Number(rosterId));
    const user = roster?.owner_id ? userById.get(String(roster.owner_id)) : undefined;
    return getTeamName(user, roster);
  };
  const playerName = (id: string): string => {
    const p = players[id];
    if (!p) return id;
    const name = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    return name || id;
  };
  const nameList = (ids: string[]): string => ids.map(playerName).join(", ");

  for (const tx of input.transactions ?? []) {
    if (tx.status && tx.status !== "complete") continue;

    const rosterIds = tx.roster_ids ?? [];
    const eventTs = tx.status_updated ?? tx.created ?? null;
    const adds = tx.adds ?? {};
    const drops = tx.drops ?? {};

    for (const rosterId of rosterIds) {
      const ownerId = getOwnerIdForRoster(input.rosters, rosterId);
      const team = teamName(rosterId);
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
        const partners = rosterIds
          .filter((r) => Number(r) !== Number(rosterId))
          .map((r) => teamName(r));
        events.push({
          ...base,
          eventType: "trade",
          eventTitle: partners.length
            ? `${team} completed a trade with ${partners.join(", ")}`
            : `${team} completed a trade`,
          eventDescription: undefined,
          relatedRosterIds: rosterIds,
          rawEvent: tx,
        });
      } else if (tx.type === "waiver" || tx.type === "free_agent") {
        const addedIds = idsForRoster(adds, rosterId);
        const droppedIds = idsForRoster(drops, rosterId);
        const eventType = tx.type === "waiver" ? "waiver" : "free_agent";
        events.push({
          ...base,
          eventType,
          eventTitle: describeMove(team, nameList(addedIds), nameList(droppedIds), eventType),
          eventDescription: undefined,
          relatedPlayerIds: [...addedIds, ...droppedIds],
          rawEvent: tx,
        });
      }
    }
  }

  return events;
}

/** Compose the human headline for a waiver / free-agent move. */
function describeMove(team: string, added: string, dropped: string, type: "waiver" | "free_agent"): string {
  if (added && dropped) return `${team} added ${added} and dropped ${dropped}`;
  if (added) return `${team} added ${added}`;
  if (dropped) return `${team} dropped ${dropped}`;
  return type === "waiver" ? `${team} made a waiver move` : `${team} made a free agent move`;
}

/** Player ids in an adds/drops map that belong to a specific roster id. */
function idsForRoster(map: Record<string, number>, rosterId: number): string[] {
  const ids: string[] = [];
  for (const [pid, rid] of Object.entries(map)) {
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
