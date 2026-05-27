/**
 * KeepTradeCut (KTC) dynasty value source.
 *
 * KTC has no public JSON API, but its dynasty-rankings page embeds the full
 * ranked player set in a `var playersArray = [...]` literal — and every entry
 * carries BOTH 1QB (`oneQBValues.value`) and Superflex (`superflexValues.value`)
 * non-TEP values. So a single page fetch yields all ~500 players for both
 * formats; we don't need to walk the 10 paginated pages (that pagination is
 * client-side on KTC). A small fallback walks pages 0–9 only if the embedded
 * array ever comes back partial.
 *
 * KTC entries arrive as player names (no Sleeper IDs), so we map name+pos→
 * Sleeper ID via the shared matcher in customValues.ts. Rookie draft picks
 * (position "RDP") are skipped — pick values are handled by the app's separate
 * pick-value model, not the player-value source.
 *
 * Output mirrors FantasyCalcResponse so the client can consume it identically.
 */

import fs from "fs";
import path from "path";
import { matchPlayerByName } from "./customValues";

const CACHE_DIR = "/tmp";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// The KTC page is ~1.3MB of HTML; give it room but still bail before the
// client's request times out.
const UPSTREAM_TIMEOUT_MS = 15_000;

const KTC_BASE = "https://keeptradecut.com/dynasty-rankings";
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
// KTC lists a handful of players under formal/legal names that differ from the
// nicknames Sleeper uses; remap them so they match by name+pos.
const NAME_ALIASES: Record<string, string> = {
  "Chigoziem Okonkwo": "Chig Okonkwo",
  "Gabriel Davis": "Gabe Davis",
  "Bam Knight": "Zonovan Knight",
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface KtcPick {
  /** e.g. "2027 Early 1st" */
  label: string;
  season: number;
  round: number;
  bucket: "early" | "mid" | "late";
  value: number;
}

export interface KtcResponse {
  source: "ktc";
  /** "sf" | "1qb" | "redraft_sf" | "redraft_1qb" */
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
  /** Rookie-pick values (dynasty only). KTC pick values are format-agnostic. */
  picks: KtcPick[];
  unmatched: Array<{ name: string; pos: string; team: string; value: number }>;
}

interface KtcRawPlayer {
  playerName: string;
  position: string;
  team: string;
  age?: number | null;
  oneQBValues?: { value?: number };
  superflexValues?: { value?: number };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA } });
  } finally {
    clearTimeout(timer);
  }
}

function getCachePath(format: string): string {
  return path.join(CACHE_DIR, `ktc_cache_${format}.json`);
}

function isCacheValid(cachePath: string): boolean {
  try {
    const stat = fs.statSync(cachePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/** Extract the embedded `var playersArray = [...]` literal from a KTC page. */
function parsePlayersArray(html: string): KtcRawPlayer[] {
  const m = html.match(/var playersArray\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]) as KtcRawPlayer[];
  } catch {
    return [];
  }
}

// KTC ranking pages. Both embed the FULL set in page 0; pagination is a
// fallback if KTC ever switches to server-side paging.
const KTC_KINDS = {
  dynasty: { base: "https://keeptradecut.com/dynasty-rankings", filters: "QB|WR|RB|TE|RDP", maxPages: 9 },
  redraft: { base: "https://keeptradecut.com/fantasy-rankings", filters: "QB|WR|RB|TE|DST|PK", maxPages: 7 },
} as const;

async function fetchKtcArray(kind: keyof typeof KTC_KINDS): Promise<KtcRawPlayer[]> {
  const { base, filters, maxPages } = KTC_KINDS[kind];
  // format=2 embeds BOTH 1QB and SF value sets, so one fetch covers both.
  const url = (page: number) => `${base}?page=${page}&filters=${filters}&format=2`;
  const res = await fetchWithTimeout(url(0), UPSTREAM_TIMEOUT_MS);
  if (!res.ok) throw new Error(`KTC returned ${res.status}`);
  const first = parsePlayersArray(await res.text());
  if (first.length >= 100) return first;

  const all = [...first];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const r = await fetchWithTimeout(url(page), UPSTREAM_TIMEOUT_MS);
      if (!r.ok) break;
      const more = parsePlayersArray(await r.text());
      if (more.length === 0) break;
      all.push(...more);
    } catch {
      break;
    }
  }
  return all;
}

function valueForFormat(p: KtcRawPlayer, format: string): number {
  // format may be "sf" | "1qb" | "redraft_sf" | "redraft_1qb".
  const v = format.includes("1qb") ? p.oneQBValues?.value : p.superflexValues?.value;
  return typeof v === "number" ? v : 0;
}

const ROUND_WORD: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };
/** Parse an RDP row name like "2027 Early 1st" into a structured pick. */
function parsePickName(name: string, value: number): KtcPick | null {
  const m = name.match(/^(\d{4})\s+(Early|Mid|Late)\s+(\d(?:st|nd|rd|th))$/i);
  if (!m) return null;
  const round = ROUND_WORD[m[3].toLowerCase()];
  if (!round) return null;
  return {
    label: name,
    season: Number(m[1]),
    round,
    bucket: m[2].toLowerCase() as KtcPick["bucket"],
    value,
  };
}

async function buildResponse(raw: KtcRawPlayer[], format: string, withPicks: boolean): Promise<KtcResponse> {
  const valuesBySleeperId: Record<string, number> = {};
  const players: KtcResponse["players"] = [];
  const unmatched: KtcResponse["unmatched"] = [];
  const picks: KtcPick[] = [];

  // Resolve names → Sleeper IDs. Done sequentially against the cached player
  // index (the index itself is cached, so this is in-memory map lookups).
  for (const p of raw) {
    const pos = (p.position || "").toUpperCase();
    if (pos === "RDP") {
      // Rookie draft pick. KTC pick values are format-agnostic — use SF.
      if (withPicks) {
        const pickVal = typeof p.superflexValues?.value === "number" ? p.superflexValues.value : 0;
        const pick = pickVal > 0 ? parsePickName(p.playerName, pickVal) : null;
        if (pick) {
          picks.push(pick);
          // Expose a round baseline (mid bucket) under the FP_ key so generic
          // pick consumers work under KTC too.
          if (pick.bucket === "mid") valuesBySleeperId[`FP_${pick.season}_${pick.round}`] = pick.value;
        }
      }
      continue;
    }
    if (!SKILL_POSITIONS.has(pos)) continue; // skip DST / PK
    const value = valueForFormat(p, format);
    if (value <= 0) continue;
    const team = (p.team || "FA").toUpperCase();
    const lookupName = NAME_ALIASES[p.playerName] ?? p.playerName;
    const matched = await matchPlayerByName(lookupName, pos, team);
    if (matched) {
      valuesBySleeperId[matched.id] = value;
      players.push({
        sleeperId: matched.id,
        // Use the app's canonical Sleeper name/pos so the client's name-based
        // fallback keys line up with its own player records.
        name: matched.name,
        pos: matched.pos,
        team: matched.team,
        value,
        age: typeof p.age === "number" ? Math.round(p.age) : 0,
        overallRank: 0, // filled after sort
      });
    } else {
      unmatched.push({ name: p.playerName, pos, team, value });
    }
  }

  players.sort((a, b) => b.value - a.value);
  players.forEach((pl, i) => { pl.overallRank = i + 1; });

  if (unmatched.length > 0) {
    console.log(
      `[KTC] ${unmatched.length} unmatched players (${format}):`,
      unmatched.slice(0, 10).map((p) => `${p.name} (${p.pos})`).join(", "),
    );
  }

  picks.sort((a, b) => b.value - a.value);

  return {
    source: "ktc",
    format,
    updatedAt: new Date().toISOString(),
    valuesBySleeperId,
    players,
    picks,
    unmatched,
  };
}

function emptyResponse(format: string): KtcResponse {
  return {
    source: "ktc",
    format,
    updatedAt: "unavailable",
    valuesBySleeperId: {},
    players: [],
    picks: [],
    unmatched: [],
  };
}

/**
 * KTC dynasty values for the given format ("sf" | "1qb"). Cached on disk for
 * 24h per format. Returns an empty response on upstream failure so the client
 * can keep its existing/bundled values rather than blanking out.
 */
export async function getKtcValues(format: string = "sf"): Promise<KtcResponse> {
  const fmt = format === "1qb" ? "1qb" : "sf";
  const cachePath = getCachePath(fmt);

  if (isCacheValid(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as KtcResponse;
    } catch {
      /* fall through to refetch */
    }
  }

  try {
    const raw = await fetchKtcArray("dynasty");
    if (raw.length === 0) throw new Error("KTC playersArray empty / not found");
    const normalized = await buildResponse(raw, fmt, true);
    if (normalized.players.length === 0) throw new Error("KTC produced no matched players");
    try {
      fs.writeFileSync(cachePath, JSON.stringify(normalized), "utf-8");
    } catch {
      /* cache write best-effort */
    }
    console.log(`[KTC] Cached ${normalized.players.length} ${fmt} values + ${normalized.picks.length} picks (${normalized.unmatched.length} unmatched).`);
    return normalized;
  } catch (err) {
    console.warn(`[KTC] fetch failed (${fmt}), returning empty:`, err);
    return emptyResponse(fmt);
  }
}

/**
 * KTC redraft (fantasy-rankings) values for the given format. Cached 24h.
 * Picks are dynasty-only, so the redraft response carries none.
 */
export async function getKtcRedraftValues(format: string = "sf"): Promise<KtcResponse> {
  const fmt = format === "1qb" ? "1qb" : "sf";
  const cacheKey = `redraft_${fmt}`;
  const cachePath = getCachePath(cacheKey);

  if (isCacheValid(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as KtcResponse;
    } catch {
      /* refetch */
    }
  }

  try {
    const raw = await fetchKtcArray("redraft");
    if (raw.length === 0) throw new Error("KTC redraft playersArray empty / not found");
    const normalized = await buildResponse(raw, cacheKey, false);
    if (normalized.players.length === 0) throw new Error("KTC redraft produced no matched players");
    try {
      fs.writeFileSync(cachePath, JSON.stringify(normalized), "utf-8");
    } catch {
      /* best-effort */
    }
    console.log(`[KTC] Cached ${normalized.players.length} ${cacheKey} values (${normalized.unmatched.length} unmatched).`);
    return normalized;
  } catch (err) {
    console.warn(`[KTC] redraft fetch failed (${fmt}), returning empty:`, err);
    return emptyResponse(cacheKey);
  }
}
