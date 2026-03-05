import fs from "fs";
import path from "path";

const CACHE_DIR = "/tmp";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const API_BASE = "https://api.fantasycalc.com/values/current";

interface FantasyCalcPlayer {
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

function getCachePath(format: string): string {
  return path.join(CACHE_DIR, `fantasycalc_cache_${format}.json`);
}

function getSnapshotPath(format: string): string {
  return path.join(
    __dirname,
    "data",
    `fantasycalc_snapshot_${format}.json`
  );
}

function isCacheValid(cachePath: string): boolean {
  try {
    const stat = fs.statSync(cachePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function normalizeApiResponse(
  raw: FantasyCalcPlayer[],
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

  if (unmatched.length > 0) {
    console.log(`[FantasyCalc] ${unmatched.length} unmatched players (no sleeperId):`,
      unmatched.slice(0, 10).map(p => `${p.name} (${p.pos})`).join(", ")
    );
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
  const cachePath = getCachePath(format);

  if (isCacheValid(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      return cached as FantasyCalcResponse;
    } catch {}
  }

  const numQbs = format === "sf" ? 2 : 1;
  const url = `${API_BASE}?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FantasyCalc API returned ${response.status}`);
    }
    const raw: FantasyCalcPlayer[] = await response.json();
    const normalized = normalizeApiResponse(raw, format);

    fs.writeFileSync(cachePath, JSON.stringify(normalized), "utf-8");

    return normalized;
  } catch (err) {
    const snapshotPath = getSnapshotPath(format);
    try {
      const snapshotRaw: FantasyCalcPlayer[] = JSON.parse(
        fs.readFileSync(snapshotPath, "utf-8")
      );
      const normalized = normalizeApiResponse(snapshotRaw, format);
      normalized.updatedAt = "snapshot";
      return normalized;
    } catch {
      throw new Error(
        `Failed to fetch FantasyCalc values and no snapshot available: ${err}`
      );
    }
  }
}
