import { API_BASE } from "@/lib/apiBase";
import dynastySnapshot from "@/data/fantasycalc_snapshot_sf.json";
import redraftSnapshot from "@/data/fantasycalc_snapshot_redraft_sf.json";

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

// Bundled fallback used when the backend is unreachable. Lets the SPA
// boot useful values without a server round-trip; updated by hand from
// the server-side snapshot when refreshed.
const DYNASTY_SNAPSHOT = dynastySnapshot as unknown as FantasyCalcResponse;
const REDRAFT_SNAPSHOT = redraftSnapshot as unknown as FantasyCalcResponse;

// Single timeout for both endpoints. Long enough for a cold-booting
// Replit dyno, short enough that the static fallback kicks in before
// the spinner becomes a problem.
const FANTASYCALC_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getFantasyCalcValues(
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/values/fantasycalc?format=${encodeURIComponent(format)}`,
      FANTASYCALC_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`FantasyCalc values request failed: ${res.status}`);
    return (await res.json()) as FantasyCalcResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[fantasycalc] dynasty fetch failed — using bundled snapshot", err);
    return { ...DYNASTY_SNAPSHOT, format };
  }
}

export async function getFantasyCalcRedraftValues(
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/values/fantasycalc/redraft?format=${encodeURIComponent(format)}`,
      FANTASYCALC_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`FantasyCalc redraft request failed: ${res.status}`);
    return (await res.json()) as FantasyCalcResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[fantasycalc] redraft fetch failed — using bundled snapshot", err);
    return { ...REDRAFT_SNAPSHOT, format: `redraft_${format}` };
  }
}
