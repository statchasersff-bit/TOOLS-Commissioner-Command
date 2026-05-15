import { updateReserve } from "./graphql/mutations/updateReserve";
import type { SleeperRosterReserveResult } from "./graphql/mutations/updateReserve";

// Sleeper roster_update_reserve replaces the entire reserve array.
// Always send the full desired reserve player_ids array.

export async function movePlayerToReserve({
  token,
  leagueId,
  rosterId,
  currentReserve,
  playerId,
}: {
  token: string;
  leagueId: string;
  rosterId: number;
  currentReserve: string[];
  playerId: string;
}): Promise<SleeperRosterReserveResult> {
  if (currentReserve.includes(playerId)) {
    throw new Error(`Player ${playerId} is already in reserve.`);
  }
  const nextReserve = [...currentReserve, playerId];
  const data = await updateReserve(token, leagueId, rosterId, nextReserve);
  return data.roster_update_reserve;
}

export async function removePlayerFromReserve({
  token,
  leagueId,
  rosterId,
  currentReserve,
  playerId,
}: {
  token: string;
  leagueId: string;
  rosterId: number;
  currentReserve: string[];
  playerId: string;
}): Promise<SleeperRosterReserveResult> {
  const nextReserve = currentReserve.filter((id) => id !== playerId);
  const data = await updateReserve(token, leagueId, rosterId, nextReserve);
  return data.roster_update_reserve;
}
