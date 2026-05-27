import { API_BASE } from "@/lib/apiBase";

export interface KtcPick {
  label: string;
  season: number;
  round: number;
  bucket: "early" | "mid" | "late";
  value: number;
}

export interface KtcResponse {
  source: "ktc";
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
  picks?: KtcPick[];
  unmatched: Array<{ name: string; pos: string; team: string; value: number }>;
}

const KTC_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function emptyResponse(format: string): KtcResponse {
  return { source: "ktc", format, updatedAt: "unavailable", valuesBySleeperId: {}, players: [], picks: [], unmatched: [] };
}

/**
 * KeepTradeCut dynasty values for the given format ("sf" | "1qb"). On any
 * failure returns an empty response — the ValueModel keeps its current values
 * rather than blanking out.
 */
export async function getKtcValues(format: string = "sf"): Promise<KtcResponse> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/values/ktc?format=${encodeURIComponent(format)}`,
      KTC_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`KTC values request failed: ${res.status}`);
    return (await res.json()) as KtcResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ktc] dynasty fetch failed — using empty response", err);
    return emptyResponse(format);
  }
}

/** KeepTradeCut redraft (fantasy-rankings) values for the given format. */
export async function getKtcRedraftValues(format: string = "sf"): Promise<KtcResponse> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/values/ktc/redraft?format=${encodeURIComponent(format)}`,
      KTC_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`KTC redraft request failed: ${res.status}`);
    return (await res.json()) as KtcResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ktc] redraft fetch failed — using empty response", err);
    return emptyResponse(`redraft_${format}`);
  }
}
