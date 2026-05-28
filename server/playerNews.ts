/**
 * Persistent player-news store (v1 — headline metadata only).
 *
 * A scheduled job ingests the Rotowire NFL RSS feed, matches each headline to a
 * Sleeper player_id, and upserts metadata (title, url, published date, source)
 * into the player_news table. Player profile pages query by player_id. We never
 * store article bodies/analysis — only the public headline + outbound link.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import { playerNews } from "@shared/schema";
import { fetchRotowireNfl, getNflNameIndex, matchSleeperId, playerNameFromTitle } from "./nflNews";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export type PlayerNewsRow = typeof playerNews.$inferSelect;

/** Fetch the current Rotowire feed and upsert headline metadata. Idempotent —
 *  keyed by `${source}:${guid||url}` so re-runs don't create duplicates. */
export async function ingestPlayerNews(): Promise<{ upserted: number }> {
  const [items, nameIndex] = await Promise.all([fetchRotowireNfl(), getNflNameIndex()]);
  let upserted = 0;

  for (const it of items) {
    const sleeperPlayerId = matchSleeperId(it.title, nameIndex);
    const id = `rotowire:${it.guid ?? it.link}`;
    const parsed = it.pubDate ? new Date(it.pubDate) : null;
    const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

    await db
      .insert(playerNews)
      .values({
        id,
        source: "rotowire",
        sourceGuid: it.guid,
        sleeperPlayerId,
        playerName: playerNameFromTitle(it.title),
        title: it.title,
        url: it.link,
        publishedAt,
      })
      .onConflictDoUpdate({
        target: playerNews.id,
        // Refresh mutable fields if the same item reappears (e.g. an improved
        // player match), but never touch created_at.
        set: {
          sleeperPlayerId,
          playerName: playerNameFromTitle(it.title),
          title: it.title,
          url: it.link,
          publishedAt,
        },
      });
    upserted++;
  }

  return { upserted };
}

/** Latest stored headlines for a Sleeper player, newest first. */
export async function getPlayerNews(sleeperPlayerId: string, limit = 10): Promise<PlayerNewsRow[]> {
  return db
    .select()
    .from(playerNews)
    .where(eq(playerNews.sleeperPlayerId, sleeperPlayerId))
    .orderBy(desc(playerNews.publishedAt), desc(playerNews.createdAt))
    .limit(Math.min(Math.max(limit, 1), 25));
}

let started = false;
const INGEST_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

/** Start the background ingestion loop (idempotent). Failures are logged and
 *  swallowed so a flaky feed never affects the rest of the app. */
export function startPlayerNewsIngestion(): void {
  if (started) return;
  started = true;
  const run = () =>
    ingestPlayerNews()
      .then((r) => console.log(`[player-news] ingest ok — upserted=${r.upserted}`))
      .catch((e) => console.error("[player-news] ingest failed:", e instanceof Error ? e.message : e));
  // First run shortly after boot (don't block startup), then on the interval.
  setTimeout(run, 20_000);
  setInterval(run, INGEST_INTERVAL_MS).unref?.();
}
