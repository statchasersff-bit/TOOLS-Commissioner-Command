import { sleeperGraphql } from "@/lib/sleeperApi";

export const ROSTER_UPDATE_TAXI_MUTATION = `
  mutation roster_update_taxi($league_id: ID!, $roster_id: Int!, $taxi: [String]) {
    roster_update_taxi(league_id: $league_id, roster_id: $roster_id, taxi: $taxi) {
      roster_id
      taxi
      players
      starters
    }
  }
`;

export interface SleeperRosterTaxiResult {
  roster_id: number;
  taxi: string[] | null;
  players: string[];
  starters: string[];
}

export async function updateTaxi(
  token: string,
  leagueId: string,
  rosterId: number,
  taxiPlayerIds: string[]
): Promise<SleeperRosterTaxiResult> {
  const data = await sleeperGraphql<{ roster_update_taxi: SleeperRosterTaxiResult }>(token, {
    operationName: "roster_update_taxi",
    variables: { league_id: leagueId, roster_id: rosterId, taxi: taxiPlayerIds },
    query: ROSTER_UPDATE_TAXI_MUTATION,
  });
  return data.roster_update_taxi;
}
