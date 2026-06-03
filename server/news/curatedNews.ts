/**
 * Curated player-news pipeline (compliance-first).
 *
 * Every 15 minutes:
 *   1. Pull approved PRIMARY feeds (credited sources) + DISCOVERY feeds.
 *   2. Match each item to a Sleeper player (id/name/team/position).
 *   3. Build the discovery audit map (e.g. a RotoWire signal => discovery_source
 *      "rotowire"); we keep ONLY the player match + discovery URL, never text.
 *   4. Dedup by external_hash = hash(player_id | source_url | published_at).
 *   5. For each new primary item: check robots/paywall on the ORIGINAL source.
 *        - not allowed / paywalled  -> store link-only, review_status "needs_review"
 *        - allowed                   -> fetch excerpt, extract facts, AI-summarize,
 *                                       store with review_status "auto"
 *   6. Persist to curated_player_news (idempotent on id).
 *
 * We never read, store, or summarize discovery-feed (RotoWire) text — discovery
 * feeds only tell us a player is in the news so we can attribute discovery_source.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { curatedPlayerNews, type CuratedPlayerNews } from "@shared/schema";
import {
  fetchPrimaryItems,
  fetchDiscoveryItems,
  NEWS_USER_AGENT,
  type FeedItem,
} from "./feeds";
import { isFetchAllowed } from "./robots";
import { isNewsAiAvailable, summarizeFromSource } from "./summarize";
import { getSleeperPlayers } from "../sleeper";
import { normName } from "../nflNews";

// review_status values considered publicly visible.
const PUBLIC_STATUSES = ["auto", "published"] as const;

// Don't summarize more than this many fresh items in one run (AI cost guard).
const MAX_NEW_PER_RUN = 40;
const INGEST_INTERVAL_MS = 15 * 60 * 1000;
const PLAYER_INDEX_TTL_MS = 24 * 60 * 60 * 1000;
// A discovery signal only attributes items published within this window of it.
const DISCOVERY_WINDOW_MS = 36 * 60 * 60 * 1000;

interface PlayerInfo {
  name: string;
  team: string | null;
  position: string;
}
interface PlayerIndex {
  byId: Map<string, PlayerInfo>;
  // normalized "firstToken lastToken" -> player_id
  nameToId: Map<string, string>;
}

let indexCache: { idx: PlayerIndex; ts: number } | null = null;

/** Build (and cache) a player lookup index from Sleeper's player DB. */
async function getPlayerIndex(): Promise<PlayerIndex> {
  if (indexCache && Date.now() - indexCache.ts < PLAYER_INDEX_TTL_MS) return indexCache.idx;
  const byId = new Map<string, PlayerInfo>();
  const nameToId = new Map<string, string>();
  try {
    const players = await getSleeperPlayers();
    for (const [id, p] of Object.entries(players)) {
      const pos = (p as any).fantasy_positions?.[0] || (p as any).position;
      if (!pos || !["QB", "RB", "WR", "TE", "K"].includes(pos)) continue;
      const first = (p as any).first_name ?? "";
      const last = (p as any).last_name ?? "";
      const full = (p as any).full_name || `${first} ${last}`.trim();
      const team = (p as any).team ?? null;
      byId.set(id, { name: full, team, position: pos });

      const firstTok = normName(first).split(" ")[0];
      const lastToks = normName(last).split(" ").filter(Boolean);
      const lastTok = lastToks[lastToks.length - 1];
      if (!firstTok || !lastTok) continue;
      const key = `${firstTok} ${lastTok}`;
      // On a name collision, prefer a player currently on a team (active proxy).
      if (!nameToId.has(key) || team) nameToId.set(key, id);
    }
    indexCache = { idx: { byId, nameToId }, ts: Date.now() };
  } catch (e) {
    console.error("[news/curated] player index build failed:", e instanceof Error ? e.message : e);
  }
  return { byId, nameToId };
}

/** Find a Sleeper player_id mentioned in free text (first full-name bigram hit). */
function matchPlayer(text: string | null, idx: PlayerIndex): string | null {
  if (!text) return null;
  const toks = normName(text).split(" ").filter(Boolean);
  for (let i = 0; i < toks.length - 1; i++) {
    const id = idx.nameToId.get(`${toks[i]} ${toks[i + 1]}`);
    if (id) return id;
  }
  return null;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Dedup key per spec: player + source_url + published_at. Also used as row id. */
function externalHash(playerId: string | null, sourceUrl: string, publishedAt: Date | null): string {
  const basis = `${playerId ?? ""}|${sourceUrl}|${publishedAt ? publishedAt.toISOString() : ""}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Fetch a plain-text excerpt from an original source page (robots already OK'd). */
async function fetchArticleExcerpt(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "User-Agent": NEWS_USER_AGENT() },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html") && !ctype.includes("text")) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return text ? text.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

interface DiscoverySignal {
  source: string; // feed key, e.g. "rotowire"
  url: string;
  ts: Date | null;
}

/** Build player_id -> most-recent discovery signal from the discovery feeds. */
function buildDiscoveryMap(items: FeedItem[], idx: PlayerIndex): Map<string, DiscoverySignal> {
  const map = new Map<string, DiscoverySignal>();
  for (const it of items) {
    const pid = matchPlayer(it.title, idx); // title only — just to identify the player
    if (!pid) continue;
    const ts = parseDate(it.pubDate);
    const prev = map.get(pid);
    if (!prev || (ts && (!prev.ts || ts > prev.ts))) {
      map.set(pid, { source: it.feedKey, url: it.link, ts });
    }
  }
  return map;
}

export interface IngestStats {
  created: number;
  needsReview: number;
  skipped: number;
  capped: number;
}

/** Run one full ingestion pass. Idempotent — safe to call repeatedly. */
export async function runCuratedIngestion(): Promise<IngestStats> {
  const stats: IngestStats = { created: 0, needsReview: 0, skipped: 0, capped: 0 };
  if (!isNewsAiAvailable()) {
    console.warn("[news/curated] ANTHROPIC_API_KEY unset — skipping curated ingestion");
    return stats;
  }

  const [primary, discovery, idx] = await Promise.all([
    fetchPrimaryItems(),
    fetchDiscoveryItems(),
    getPlayerIndex(),
  ]);
  const discoveryMap = buildDiscoveryMap(discovery, idx);

  // Resolve players + hashes; collapse duplicates that appear in multiple feeds.
  type Candidate = { item: FeedItem; playerId: string; player: PlayerInfo; publishedAt: Date | null; hash: string };
  const candidates = new Map<string, Candidate>();
  for (const item of primary) {
    const playerId = matchPlayer(item.title, idx) ?? matchPlayer(item.contentSnippet, idx);
    if (!playerId) { stats.skipped++; continue; }
    const player = idx.byId.get(playerId);
    if (!player) { stats.skipped++; continue; }
    const publishedAt = parseDate(item.pubDate);
    const hash = externalHash(playerId, item.link, publishedAt);
    if (!candidates.has(hash)) candidates.set(hash, { item, playerId, player, publishedAt, hash });
  }

  // Drop ones we already have (dedup) before doing any expensive AI work.
  const hashes = Array.from(candidates.keys());
  if (hashes.length) {
    const existing = await db
      .select({ id: curatedPlayerNews.id })
      .from(curatedPlayerNews)
      .where(inArray(curatedPlayerNews.id, hashes));
    for (const row of existing) {
      candidates.delete(row.id);
      stats.skipped++;
    }
  }

  let fresh = Array.from(candidates.values());
  if (fresh.length > MAX_NEW_PER_RUN) {
    stats.capped = fresh.length - MAX_NEW_PER_RUN;
    fresh = fresh.slice(0, MAX_NEW_PER_RUN);
    console.warn(`[news/curated] capping run: ${stats.capped} fresh items deferred to next pass`);
  }

  for (const c of fresh) {
    const sig = discoveryMap.get(c.playerId);
    // discovery_source: a discovery feed (e.g. rotowire) within window tipped us;
    // otherwise we discovered it via the primary feed itself.
    const tipped = sig && (!sig.ts || !c.publishedAt || Math.abs(sig.ts.getTime() - c.publishedAt.getTime()) <= DISCOVERY_WINDOW_MS);
    const discoverySource = tipped ? sig!.source : c.item.feedKey;
    const discoveryUrl = tipped ? sig!.url : c.item.link;

    const base = {
      id: c.hash,
      playerId: c.playerId,
      playerName: c.player.name,
      team: c.player.team,
      position: c.player.position,
      sourceName: c.item.sourceName, // credited original source
      sourceUrl: c.item.link,
      discoverySource,
      discoveryUrl,
      publishedAt: c.publishedAt,
      externalHash: c.hash,
    };

    // Compliance gate: only fetch the original page if robots/terms allow.
    const allowed = await isFetchAllowed(c.item.link);
    if (!allowed) {
      await insertRow({ ...base, reviewStatus: "needs_review" });
      stats.needsReview++;
      continue;
    }

    let excerpt: string | null = null;
    try {
      excerpt = await fetchArticleExcerpt(c.item.link);
    } catch { /* excerpt is best-effort */ }

    let result;
    try {
      result = await summarizeFromSource({
        playerName: c.player.name,
        team: c.player.team,
        position: c.player.position,
        sourceName: c.item.sourceName,
        sourceTitle: c.item.title,
        sourceSnippet: c.item.contentSnippet,
        sourceExcerpt: excerpt,
      });
    } catch (e) {
      console.error(`[news/curated] summarize failed (${c.player.name}):`, e instanceof Error ? e.message : e);
      await insertRow({ ...base, reviewStatus: "needs_review" });
      stats.needsReview++;
      continue;
    }

    if (!result) { stats.skipped++; continue; } // model found no usable news

    await insertRow({
      ...base,
      headline: result.headline,
      summary: result.summary,
      fantasyImpact: result.fantasyImpact,
      category: result.category,
      rawFactsJson: result.facts,
      aiModel: result.model,
      reviewStatus: "auto",
    });
    stats.created++;
  }

  return stats;
}

type InsertValues = typeof curatedPlayerNews.$inferInsert;

async function insertRow(values: InsertValues): Promise<void> {
  await db
    .insert(curatedPlayerNews)
    .values({ ...values, updatedAt: new Date() })
    .onConflictDoNothing({ target: curatedPlayerNews.id });
}

/** Public-facing curated news for a player (visible statuses only), newest first. */
export async function getCuratedPlayerNews(playerId: string, limit = 8): Promise<CuratedPlayerNews[]> {
  return db
    .select()
    .from(curatedPlayerNews)
    .where(
      and(
        eq(curatedPlayerNews.playerId, playerId),
        inArray(curatedPlayerNews.reviewStatus, PUBLIC_STATUSES as unknown as string[]),
      ),
    )
    .orderBy(desc(curatedPlayerNews.publishedAt), desc(curatedPlayerNews.createdAt))
    .limit(Math.min(Math.max(limit, 1), 25));
}

/** Admin: rows in a given review status (default needs_review), newest first. */
export async function listCuratedNewsByStatus(status = "needs_review", limit = 100): Promise<CuratedPlayerNews[]> {
  return db
    .select()
    .from(curatedPlayerNews)
    .where(eq(curatedPlayerNews.reviewStatus, status))
    .orderBy(desc(curatedPlayerNews.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Admin: change an item's review status (e.g. publish or reject). */
export async function setCuratedNewsStatus(id: string, status: string): Promise<boolean> {
  const res = await db
    .update(curatedPlayerNews)
    .set({ reviewStatus: status, updatedAt: new Date() })
    .where(eq(curatedPlayerNews.id, id))
    .returning({ id: curatedPlayerNews.id });
  return res.length > 0;
}

let started = false;

/** Start the background curated-news ingestion loop (idempotent). */
export function startCuratedNewsIngestion(): void {
  if (started) return;
  started = true;
  const run = () =>
    runCuratedIngestion()
      .then((s) =>
        console.log(
          `[news/curated] ok — created=${s.created} needsReview=${s.needsReview} skipped=${s.skipped} capped=${s.capped}`,
        ),
      )
      .catch((e) => console.error("[news/curated] ingest failed:", e instanceof Error ? e.message : e));
  // Stagger after boot so we don't pile onto the existing RSS ingestion.
  setTimeout(run, 35_000);
  setInterval(run, INGEST_INTERVAL_MS).unref?.();
}
