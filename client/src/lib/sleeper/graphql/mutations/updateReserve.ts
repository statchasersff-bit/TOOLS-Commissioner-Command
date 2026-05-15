import { sleeperGraphql } from "@/lib/sleeperApi";

// Sleeper roster_update_reserve replaces the entire reserve array.
// Always send the full desired reserve player_ids array.

export const UPDATE_RESERVE_MUTATION = `
  mutation roster_update_reserve($league_id: ID!, $roster_id: Int!, $reserve: [String!]!) {
    roster_update_reserve(
      league_id: $league_id,
      roster_id: $roster_id,
      reserve: $reserve
    ) {
      league_id
      co_owners
      metadata
      owner_id
      players
      player_map
      roster_id
      reserve
      taxi
      settings
      starters
    }
  }
`;

export interface SleeperRosterReserveResult {
  league_id: string;
  co_owners: string[] | null;
  metadata: Record<string, any> | null;
  owner_id: string;
  players: string[];
  player_map: Record<string, any> | null;
  roster_id: number;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: Record<string, any> | null;
  starters: string[];
}

export async function updateReserve(
  token: string,
  leagueId: string,
  rosterId: number,
  reservePlayerIds: string[]
): Promise<{ roster_update_reserve: SleeperRosterReserveResult }> {
  return sleeperGraphql<{ roster_update_reserve: SleeperRosterReserveResult }>(token, {
    operationName: "roster_update_reserve",
    variables: {
      league_id: leagueId,
      roster_id: rosterId,
      reserve: reservePlayerIds,
    },
    query: UPDATE_RESERVE_MUTATION,
  });
}
