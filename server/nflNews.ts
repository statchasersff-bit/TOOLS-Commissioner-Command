/**
 * Shared NFL news source — Rotowire NFL RSS, fetched server-side.
 *
 * We use only the public RSS feed (headline metadata + outbound links) — never
 * article bodies. This module is the single place that knows how to fetch the
 * feed and resolve a headline's player to a Sleeper player_id, so both the
 * top-bar ticker and the persistent player-news ingestion stay in sync. Keep it
 * source-agnostic enough that other feeds can be added alongside Rotowire later.
 */
import Parser from "rss-parser";
import { getSleeperPlayers } from "./sleeper";

const ROTOWIRE_NFL_RSS = "https://www.rotowire.com/rss/news.php?sport=NFL";
const NAME_INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const parser = new Parser({ timeout: 10_000 });

export type RawNflNewsItem = {
  guid: string | null;
  title: string;
  link: string;
  pubDate: string | null;
};

/** Fetch + normalize the Rotowire NFL RSS items (metadata only). */
export async function fetchRotowireNfl(): Promise<RawNflNewsItem[]> {
  const feed = await parser.parseURL(ROTOWIRE_NFL_RSS);
  return (feed.items ?? []).map((item) => ({
    guid: item.guid ?? null,
    title: item.title || "NFL News",
    link: item.link || "https://www.rotowire.com/football/news.php",
    pubDate: item.pubDate ?? null,
  }));
}

/** Normalize a name for matching: lowercase, drop accents/punctuation/suffixes. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rotowire headlines are "Player Name: blurb" — return the name half, if any. */
export function playerNameFromTitle(title: string): string | null {
  return title.includes(":") ? title.split(":")[0].trim() : null;
}

/** Sleeper headshot URL for a player_id (may 404 for deep players — callers
 *  should degrade gracefully). */
export function sleeperHeadshot(sleeperPlayerId: string): string {
  return `https://sleepercdn.com/content/nfl/players/thumb/${sleeperPlayerId}.jpg`;
}

let nameIndexCache: { map: Map<string, string>; ts: number } | null = null;

/**
 * Build (and cache) a normalized "full name" → Sleeper player_id map from the
 * on-disk player DB. Best-effort: on any failure returns an empty map so news
 * still flows, just without player matches.
 */
export async function getNflNameIndex(): Promise<Map<string, string>> {
  if (nameIndexCache && Date.now() - nameIndexCache.ts < NAME_INDEX_TTL_MS) return nameIndexCache.map;
  const map = new Map<string, string>();
  try {
    const players = await getSleeperPlayers();
    for (const [id, p] of Object.entries(players)) {
      const pos = (p as any)?.position;
      if (!pos || !["QB", "RB", "WR", "TE", "K"].includes(pos)) continue;
      const full = `${(p as any).first_name ?? ""} ${(p as any).last_name ?? ""}`.trim();
      const key = normName(full);
      if (!key) continue;
      // Prefer an active player when two share a normalized name.
      if (!map.has(key) || (p as any).active) map.set(key, id);
    }
    nameIndexCache = { map, ts: Date.now() };
  } catch (e) {
    console.error("[nflNews] name index build failed:", e instanceof Error ? e.message : e);
  }
  return map;
}

/** Resolve a headline title to a Sleeper player_id, or null when no confident match. */
export function matchSleeperId(title: string, nameIndex: Map<string, string>): string | null {
  const playerName = playerNameFromTitle(title);
  if (!playerName) return null;
  return nameIndex.get(normName(playerName)) ?? null;
}
