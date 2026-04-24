import { API_BASE } from "@/lib/apiBase";

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
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  const res = await fetch(`${API_BASE}/api/values/fantasycalc?format=${encodeURIComponent(format)}`);
  if (!res.ok) {
    throw new Error(`FantasyCalc values request failed: ${res.status}`);
  }
  return res.json() as Promise<FantasyCalcResponse>;
}

export async function getFantasyCalcRedraftValues(
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  const res = await fetch(`${API_BASE}/api/values/fantasycalc/redraft?format=${encodeURIComponent(format)}`);
  if (!res.ok) {
    throw new Error(`FantasyCalc redraft request failed: ${res.status}`);
  }
  return res.json() as Promise<FantasyCalcResponse>;
}
