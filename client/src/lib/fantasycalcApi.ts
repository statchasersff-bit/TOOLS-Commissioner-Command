import dynastyData from "@/data/fantasycalc_dynasty_sf.json";
import redraftData from "@/data/fantasycalc_redraft_sf.json";

export interface FantasyCalcResponse {
  source: "fantasycalc";
  format: string;
  updatedAt: string;
  valuesBySleeperId: Record<string, number>;
  players: Array<{
    sleeperId: string;
    name: string;
    pos: string;
    team: string;
    value: number;
    age: number;
    overallRank: number;
  }>;
  unmatched: Array<{
    name: string;
    pos: string;
    team: string;
    value: number;
  }>;
}

export async function getFantasyCalcValues(
  _format: string = "sf"
): Promise<FantasyCalcResponse> {
  return dynastyData as FantasyCalcResponse;
}

export async function getFantasyCalcRedraftValues(
  _format: string = "sf"
): Promise<FantasyCalcResponse> {
  return redraftData as FantasyCalcResponse;
}
