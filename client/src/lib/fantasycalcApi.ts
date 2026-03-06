const API_BASE = "https://api.fantasycalc.com/values/current";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface FantasyCalcPlayerRaw {
  player: {
    id: number;
    name: string;
    sleeperId: string | null;
    position: string;
    maybeTeam: string | null;
    maybeAge: number | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
}

interface UnmatchedPlayer {
  name: string;
  pos: string;
  team: string;
  value: number;
}

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
  unmatched: UnmatchedPlayer[];
}

function getCacheKey(prefix: string, format: string): string {
  return `sc-fantasycalc-${prefix}-${format}`;
}

function getCachedData(key: string): FantasyCalcResponse | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached._cachedAt < CACHE_TTL_MS) {
      return cached.data as FantasyCalcResponse;
    }
    localStorage.removeItem(key);
  } catch {}
  return null;
}

function setCachedData(key: string, data: FantasyCalcResponse): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, _cachedAt: Date.now() }));
  } catch {}
}

function normalizeApiResponse(
  raw: FantasyCalcPlayerRaw[],
  format: string
): FantasyCalcResponse {
  const valuesBySleeperId: Record<string, number> = {};
  const players: FantasyCalcResponse["players"] = [];
  const unmatched: UnmatchedPlayer[] = [];

  for (const row of raw) {
    if (row.player.sleeperId && row.player.position !== "PICK") {
      valuesBySleeperId[row.player.sleeperId] = row.value;
      players.push({
        sleeperId: row.player.sleeperId,
        name: row.player.name,
        pos: row.player.position,
        team: row.player.maybeTeam || "FA",
        value: row.value,
        age: row.player.maybeAge || 0,
        overallRank: row.overallRank,
      });
    } else if (row.player.position !== "PICK") {
      unmatched.push({
        name: row.player.name,
        pos: row.player.position,
        team: row.player.maybeTeam || "FA",
        value: row.value,
      });
    }
  }

  return {
    source: "fantasycalc",
    format,
    updatedAt: new Date().toISOString(),
    valuesBySleeperId,
    players,
    unmatched,
  };
}

export async function getFantasyCalcValues(
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  const cacheKey = getCacheKey("dynasty", format);
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const numQbs = format === "sf" ? 2 : 1;
  const url = `${API_BASE}?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FantasyCalc API returned ${response.status}`);
  }
  const raw: FantasyCalcPlayerRaw[] = await response.json();
  const normalized = normalizeApiResponse(raw, format);

  setCachedData(cacheKey, normalized);
  return normalized;
}

export async function getFantasyCalcRedraftValues(
  format: string = "sf"
): Promise<FantasyCalcResponse> {
  const cacheKey = getCacheKey("redraft", format);
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const numQbs = format === "sf" ? 2 : 1;
  const url = `${API_BASE}?isDynasty=false&numQbs=${numQbs}&numTeams=12&ppr=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FantasyCalc redraft API returned ${response.status}`);
    }
    const raw: FantasyCalcPlayerRaw[] = await response.json();
    const normalized = normalizeApiResponse(raw, `redraft_${format}`);

    setCachedData(cacheKey, normalized);
    return normalized;
  } catch (err) {
    console.warn("[FantasyCalc] Redraft fetch failed, returning empty:", err);
    return {
      source: "fantasycalc",
      format: `redraft_${format}`,
      updatedAt: "unavailable",
      valuesBySleeperId: {},
      players: [],
      unmatched: [],
    };
  }
}
