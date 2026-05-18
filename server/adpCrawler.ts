import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adpCrawlSeeds,
  adpCrawlQueue,
  adpCrawlLog,
  drafts,
  draftPicks,
} from "@shared/schema";
import { ingestDraftById, rateLimitedFetchJson } from "./adp";

const SLEEPER_API = "https://api.sleeper.app/v1";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Seasons we automatically expand into when given a user-level seed. The
// caller can override per-seed but most operators will want the default to
// reach back at least two years for sample-size purposes.
const DEFAULT_SEASONS = ["2026", "2025", "2024"];

// Worker pacing. The actual Sleeper rate cap is enforced inside
// rateLimitedFetchJson (~150 req/min). The interval below just decides how
// often the worker wakes up to claim more items; one pass typically makes
// several API calls so we don't need a tight loop here.
const WORKER_TICK_MS = 1500;
const WORKER_BATCH = 1;
const MAX_ATTEMPTS = 3;

type SeedType = "username" | "user_id" | "league_id" | "draft_id";

// ── Seed parsing ─────────────────────────────────────────────────────────────
// Sleeper IDs are 18–19 digit decimal strings. Usernames are ≤32 chars and
// contain letters/digits/underscores/hyphens. We can't distinguish league vs
// draft vs user IDs from the digits alone — when a numeric token comes in
// without an explicit type hint we treat it as a "probe" that the worker
// resolves at run time.

export interface SeedInput {
  /** Either a free-text paste (one per line) or a structured list. */
  text?: string;
  items?: Array<{ type?: SeedType; value: string }>;
  /** Seasons to fan out from user-level seeds. Defaults to [2026, 2025, 2024]. */
  seasons?: string[];
}

interface ParsedSeed {
  type: SeedType | "numeric_id";
  value: string;
}

export function parseSeedText(raw: string): ParsedSeed[] {
  const out: ParsedSeed[] = [];
  for (const line of raw.split(/[\s,]+/)) {
    const v = line.trim();
    if (!v) continue;

    // Explicit prefix syntax: "username:foo", "league:1234", etc.
    const m = v.match(/^(username|user_id|user|league_id|league|draft_id|draft):(.+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (!val) continue;
      const type: SeedType =
        key === "user" || key === "user_id" ? "user_id"
        : key === "league" || key === "league_id" ? "league_id"
        : key === "draft" || key === "draft_id" ? "draft_id"
        : "username";
      out.push({ type, value: val });
      continue;
    }

    if (/^\d{15,20}$/.test(v)) {
      // Sleeper IDs — user/league/draft all share this format. Worker probes
      // each shape until one resolves.
      out.push({ type: "numeric_id", value: v });
    } else if (/^[a-zA-Z0-9_\-.]{2,32}$/.test(v)) {
      out.push({ type: "username", value: v });
    }
    // silently drop anything that doesn't match — protects us from accidental
    // multi-line garbage paste
  }
  // dedup
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.type}|${s.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function enqueueSeeds(input: SeedInput): Promise<{ seedsAdded: number; queueAdded: number }> {
  const seasons = input.seasons && input.seasons.length > 0 ? input.seasons : DEFAULT_SEASONS;

  const parsed: ParsedSeed[] = [];
  if (input.text) parsed.push(...parseSeedText(input.text));
  if (input.items) {
    for (const it of input.items) {
      const v = it.value?.trim();
      if (!v) continue;
      parsed.push({ type: it.type ?? (/^\d{15,20}$/.test(v) ? "numeric_id" : "username"), value: v });
    }
  }

  let seedsAdded = 0;
  let queueAdded = 0;

  for (const seed of parsed) {
    // Record the seed row for audit.
    await db.insert(adpCrawlSeeds).values({
      seedType: seed.type === "numeric_id" ? "user_id" : seed.type, // numeric_id treated as user_id in the seed table
      seedValue: seed.value,
      status: "pending",
    });
    seedsAdded++;

    // Fan out into queue items. For usernames and ambiguous numeric IDs we
    // enqueue a single "resolve user" task per season; the worker turns
    // that into league/draft tasks as it goes.
    if (seed.type === "draft_id") {
      await enqueueOnce("draft", seed.value, null);
      queueAdded++;
    } else if (seed.type === "league_id") {
      await enqueueOnce("league", seed.value, null);
      queueAdded++;
    } else {
      for (const season of seasons) {
        const added = await enqueueOnce(seed.type === "username" ? "username" : "user", seed.value, season);
        if (added) queueAdded++;
      }
    }
  }

  return { seedsAdded, queueAdded };
}

async function enqueueOnce(
  targetType: "username" | "user" | "league" | "draft",
  targetId: string,
  season: string | null,
  priority = 50,
): Promise<boolean> {
  // Dedup pending queue items so re-pasting the same seed doesn't pile up
  // duplicate work.
  const existing = await db
    .select({ id: adpCrawlQueue.id })
    .from(adpCrawlQueue)
    .where(and(
      eq(adpCrawlQueue.targetType, targetType),
      eq(adpCrawlQueue.targetId, targetId),
      eq(adpCrawlQueue.status, "pending"),
      season ? eq(adpCrawlQueue.season, season) : sql`season IS NULL`,
    ))
    .limit(1);
  if (existing.length > 0) return false;
  await db.insert(adpCrawlQueue).values({ targetType, targetId, season, priority, status: "pending" });
  return true;
}

/** Enqueue a Sleeper user_id at low-ish priority. Called when a DC user
 *  connects their Sleeper account. */
export async function enqueueSleeperUser(userId: string, seasons: string[] = DEFAULT_SEASONS): Promise<number> {
  let added = 0;
  for (const s of seasons) {
    if (await enqueueOnce("user", userId, s, 30)) added++;
  }
  if (added > 0 && !workerRunning) startCrawlWorker();
  return added;
}

// ── Worker ───────────────────────────────────────────────────────────────────

let workerRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

export function startCrawlWorker() {
  if (workerRunning) return;
  workerRunning = true;
  workerTimer = setInterval(() => { void workerTick().catch(() => {}); }, WORKER_TICK_MS);
  if (workerTimer.unref) workerTimer.unref();
  console.log("[ADP crawler] worker started");
}

export function stopCrawlWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerRunning = false;
}

async function workerTick() {
  // Pull a small batch of pending items, ordered by priority then age.
  const items = await db
    .select()
    .from(adpCrawlQueue)
    .where(eq(adpCrawlQueue.status, "pending"))
    .orderBy(asc(adpCrawlQueue.priority), asc(adpCrawlQueue.id))
    .limit(WORKER_BATCH);

  if (items.length === 0) {
    // Idle — but keep the worker alive so user-triggered seeds still wake it.
    return;
  }

  for (const item of items) {
    // Claim the row atomically.
    const claimed = await db
      .update(adpCrawlQueue)
      .set({ status: "processing", attempts: item.attempts + 1 })
      .where(and(eq(adpCrawlQueue.id, item.id), eq(adpCrawlQueue.status, "pending")))
      .returning({ id: adpCrawlQueue.id });
    if (claimed.length === 0) continue; // someone else grabbed it

    const logRow = await db
      .insert(adpCrawlLog)
      .values({
        jobType: `process_${item.targetType}`,
        status: "running",
        message: `${item.targetType}=${item.targetId}${item.season ? ` season=${item.season}` : ""}`,
      })
      .returning({ id: adpCrawlLog.id });
    const logId = logRow[0].id;

    let draftsFound = 0;
    let draftsIngested = 0;
    let picksIngested = 0;
    let error: string | null = null;

    try {
      const result = await processItem(item.targetType as any, item.targetId, item.season);
      draftsFound = result.draftsFound;
      draftsIngested = result.draftsIngested;
      picksIngested = result.picksIngested;
    } catch (err: any) {
      error = err?.message ?? "unknown error";
    }

    await db.update(adpCrawlQueue)
      .set({
        status: error ? (item.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending") : "completed",
        lastError: error,
        processedAt: new Date(),
      })
      .where(eq(adpCrawlQueue.id, item.id));

    await db.update(adpCrawlLog)
      .set({
        status: error ? "failed" : "completed",
        message: error ?? `found=${draftsFound} ingested=${draftsIngested} picks=${picksIngested}`,
        draftsFound,
        draftsIngested,
        picksIngested,
        completedAt: new Date(),
      })
      .where(eq(adpCrawlLog.id, logId));
  }
}

// ── Per-item processors ──────────────────────────────────────────────────────

async function processItem(
  targetType: "username" | "user" | "league" | "draft",
  targetId: string,
  season: string | null,
): Promise<{ draftsFound: number; draftsIngested: number; picksIngested: number }> {
  if (targetType === "username") return processUsername(targetId, season);
  if (targetType === "user")     return processUser(targetId, season);
  if (targetType === "league")   return processLeague(targetId);
  if (targetType === "draft")    return processDraft(targetId);
  throw new Error(`unknown target type: ${targetType}`);
}

async function processUsername(username: string, season: string | null) {
  const user = await rateLimitedFetchJson<{ user_id: string }>(`${SLEEPER_API}/user/${username}`);
  if (!user?.user_id) {
    return { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };
  }
  return processUser(user.user_id, season);
}

async function processUser(userId: string, season: string | null) {
  const seasons = season ? [season] : DEFAULT_SEASONS;
  let totals = { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };

  for (const s of seasons) {
    const leagues = await rateLimitedFetchJson<Array<{ league_id: string }>>(
      `${SLEEPER_API}/user/${userId}/leagues/nfl/${s}`,
    );
    if (!leagues) continue;
    // Enqueue each league as its own queue row so the work fans out and
    // remains resumable across server restarts.
    for (const lg of leagues) {
      await enqueueOnce("league", lg.league_id, null, 60);
      totals.draftsFound++;
    }
  }
  return totals;
}

async function processLeague(leagueId: string) {
  const draftList = await rateLimitedFetchJson<Array<{ draft_id: string; status?: string }>>(
    `${SLEEPER_API}/league/${leagueId}/drafts`,
  );
  if (!draftList) return { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };

  let totals = { draftsFound: draftList.length, draftsIngested: 0, picksIngested: 0 };
  for (const d of draftList) {
    await enqueueOnce("draft", d.draft_id, null, 70);
  }
  return totals;
}

async function processDraft(draftId: string) {
  const r = await ingestDraftById(draftId);
  if (!r.ok) return { draftsFound: 1, draftsIngested: 0, picksIngested: 0 };
  return {
    draftsFound: 1,
    draftsIngested: r.skipped ? 0 : (r.picks > 0 ? 1 : 0),
    picksIngested: r.skipped ? 0 : r.picks,
  };
}

// ── Status / dashboard helpers ───────────────────────────────────────────────

export async function getCrawlStatus(): Promise<{
  totals: { drafts: number; completedDrafts: number; picks: number; seeds: number };
  queue: { pending: number; processing: number; failed: number; completed: number };
  recentLog: Array<{ id: number; jobType: string; status: string; message: string | null; draftsFound: number; draftsIngested: number; picksIngested: number; startedAt: string | null; completedAt: string | null }>;
  workerRunning: boolean;
}> {
  const [draftsCount, completeDraftsCount, picksCount, seedsCount] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(drafts),
    db.select({ c: sql<number>`count(*)` }).from(drafts).where(eq(drafts.status, "complete")),
    db.select({ c: sql<number>`count(*)` }).from(draftPicks),
    db.select({ c: sql<number>`count(*)` }).from(adpCrawlSeeds),
  ]);

  const queueGroups = await db
    .select({ status: adpCrawlQueue.status, c: sql<number>`count(*)` })
    .from(adpCrawlQueue)
    .groupBy(adpCrawlQueue.status);
  const queue = { pending: 0, processing: 0, failed: 0, completed: 0 } as Record<string, number>;
  for (const g of queueGroups) queue[g.status] = Number(g.c ?? 0);

  const log = await db
    .select()
    .from(adpCrawlLog)
    .orderBy(desc(adpCrawlLog.id))
    .limit(25);

  return {
    totals: {
      drafts: Number(draftsCount[0]?.c ?? 0),
      completedDrafts: Number(completeDraftsCount[0]?.c ?? 0),
      picks: Number(picksCount[0]?.c ?? 0),
      seeds: Number(seedsCount[0]?.c ?? 0),
    },
    queue: {
      pending: queue.pending ?? 0,
      processing: queue.processing ?? 0,
      failed: queue.failed ?? 0,
      completed: queue.completed ?? 0,
    },
    recentLog: log.map((r) => ({
      id: r.id,
      jobType: r.jobType,
      status: r.status,
      message: r.message,
      draftsFound: r.draftsFound,
      draftsIngested: r.draftsIngested,
      picksIngested: r.picksIngested,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    workerRunning,
  };
}

export async function resetFailedQueueItems(): Promise<{ reset: number }> {
  const result = await db
    .update(adpCrawlQueue)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(eq(adpCrawlQueue.status, "failed"))
    .returning({ id: adpCrawlQueue.id });
  return { reset: result.length };
}
