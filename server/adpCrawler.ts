import { db } from "./db";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  adpCrawlSeeds,
  adpCrawlQueue,
  adpCrawlLog,
  adpUserCrawlEvents,
  drafts,
  draftPicks,
} from "@shared/schema";
import { ingestDraftById, rateLimitedFetchJson } from "./adp";

const SLEEPER_API = "https://api.sleeper.app/v1";

// Shared, capped Postgres pool (see server/db.ts).

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
  seedSleeperUserId: string | null = null,
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
  await db.insert(adpCrawlQueue).values({ targetType, targetId, season, priority, status: "pending", seedSleeperUserId });
  return true;
}

// ── Passive (user-login) enrichment ──────────────────────────────────────────
// Cooldown windows. The 7-day complete window keeps us from re-fetching the
// same user's leagues on every login; the 24-hour failed window lets us
// retry transient Sleeper API errors next day without manual intervention.
const COOLDOWN_COMPLETE_MS = 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_FAILED_MS   = 24 * 60 * 60 * 1000;

export type EnqueueSleeperUserResult =
  | { enqueued: true; eventId: number }
  | { enqueued: false; eventId: number | null; reason: "already_running" | "cooldown_complete" | "cooldown_failed" };

/** Enqueue a Sleeper user_id at low priority for a depth-1 crawl. Called when
 *  a user connects their Sleeper account (auth or read-only). Returns a
 *  result describing whether the enqueue happened or why it was skipped, so
 *  callers can show non-blocking UI without making a new call. */
export async function enqueueSleeperUser(
  sleeperUserId: string,
  opts: {
    sleeperUsername?: string;
    seasons?: string[];
    source?: "user_login_depth1" | "readonly_connect_depth1" | "admin_recrawl";
    force?: boolean;
  } = {},
): Promise<EnqueueSleeperUserResult> {
  const source = opts.source ?? "user_login_depth1";

  // Cooldown gate. Read the most recent event for this Sleeper user; decide
  // whether to skip, retry, or enqueue fresh. Admins can pass force=true to
  // bypass the gate (used by the admin recrawl button).
  if (!opts.force) {
    const recent = await db
      .select()
      .from(adpUserCrawlEvents)
      .where(eq(adpUserCrawlEvents.sleeperUserId, sleeperUserId))
      .orderBy(desc(adpUserCrawlEvents.createdAt))
      .limit(1);
    if (recent.length > 0) {
      const last = recent[0];
      const ageMs = Date.now() - last.createdAt.getTime();
      if (last.status === "queued" || last.status === "running") {
        return { enqueued: false, eventId: last.id, reason: "already_running" };
      }
      if (last.status === "complete" && ageMs < COOLDOWN_COMPLETE_MS) {
        return { enqueued: false, eventId: last.id, reason: "cooldown_complete" };
      }
      if (last.status === "failed" && ageMs < COOLDOWN_FAILED_MS) {
        return { enqueued: false, eventId: last.id, reason: "cooldown_failed" };
      }
    }
  }

  // Record the event so this user enters the seed pool consumed by the unified
  // scheduled crawler (server/unifiedCrawler.ts). We no longer enqueue per-user
  // queue items or run the old passive worker — the unified crawler now owns all
  // trade + draft gathering. The row is marked "skipped" to make clear no
  // queue work is pending; its sleeper_user_id is all the seed pool needs.
  const [event] = await db.insert(adpUserCrawlEvents).values({
    sleeperUserId,
    sleeperUsername: opts.sleeperUsername ?? null,
    source,
    status: "skipped",
    completedAt: new Date(),
  }).returning({ id: adpUserCrawlEvents.id });

  return { enqueued: true, eventId: event.id };
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
      const result = await processItem(
        item.targetType as any,
        item.targetId,
        item.season,
        item.seedSleeperUserId ?? null,
      );
      draftsFound = result.draftsFound;
      draftsIngested = result.draftsIngested;
      picksIngested = result.picksIngested;
    } catch (err: any) {
      error = err?.message ?? "unknown error";
    }

    const willRetry = !!error && item.attempts + 1 < MAX_ATTEMPTS;
    await db.update(adpCrawlQueue)
      .set({
        status: error ? (willRetry ? "pending" : "failed") : "completed",
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

    // Passive crawl: update the originating event row.
    // - processUser items contribute leagues_scanned (each league enqueued).
    // - processLeague items contribute drafts_found (each eligible draft).
    // - processDraft items contribute drafts_added (1 if ingested).
    // - On retry the item stays "pending" — we hold off counter updates
    //   until the terminal pass to avoid double-counting.
    if (item.seedSleeperUserId && !willRetry) {
      await applyPassiveEventIncrement(
        item.seedSleeperUserId,
        item.targetType as any,
        { draftsFound, draftsIngested },
        error,
      );
      await maybeCompletePassiveEvent(item.seedSleeperUserId);
    }
  }
}

/** Apply per-item counter increments to the most recent open event for
 *  this Sleeper user. Also flips status from "queued" → "running" on the
 *  first non-error item. */
async function applyPassiveEventIncrement(
  sleeperUserId: string,
  targetType: "username" | "user" | "league" | "draft",
  counts: { draftsFound: number; draftsIngested: number },
  error: string | null,
) {
  const recent = await db
    .select()
    .from(adpUserCrawlEvents)
    .where(and(
      eq(adpUserCrawlEvents.sleeperUserId, sleeperUserId),
      inArray(adpUserCrawlEvents.status, ["queued", "running"]),
    ))
    .orderBy(desc(adpUserCrawlEvents.createdAt))
    .limit(1);
  if (recent.length === 0) return;
  const event = recent[0];

  const patch: Partial<typeof adpUserCrawlEvents.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (event.status === "queued") patch.status = "running";
  if (targetType === "user" || targetType === "username") {
    // processUser/processUsername returns leagues-enqueued as draftsFound.
    patch.leaguesScanned = event.leaguesScanned + counts.draftsFound;
  } else if (targetType === "league") {
    patch.draftsFound = event.draftsFound + counts.draftsFound;
  } else if (targetType === "draft") {
    patch.draftsAdded = event.draftsAdded + counts.draftsIngested;
  }
  if (error) patch.errorMessage = error;

  await db.update(adpUserCrawlEvents)
    .set(patch)
    .where(eq(adpUserCrawlEvents.id, event.id));
}

/** Mark the event complete when no pending/processing queue items remain
 *  for this Sleeper user. If at least one terminal item recorded an error
 *  and zero progress was made, mark it failed instead. */
async function maybeCompletePassiveEvent(sleeperUserId: string) {
  const outstanding = await db
    .select({ c: sql<number>`count(*)` })
    .from(adpCrawlQueue)
    .where(and(
      eq(adpCrawlQueue.seedSleeperUserId, sleeperUserId),
      inArray(adpCrawlQueue.status, ["pending", "processing"]),
    ));
  if (Number(outstanding[0]?.c ?? 0) > 0) return;

  const recent = await db
    .select()
    .from(adpUserCrawlEvents)
    .where(and(
      eq(adpUserCrawlEvents.sleeperUserId, sleeperUserId),
      inArray(adpUserCrawlEvents.status, ["queued", "running"]),
    ))
    .orderBy(desc(adpUserCrawlEvents.createdAt))
    .limit(1);
  if (recent.length === 0) return;
  const event = recent[0];

  const noProgress = event.leaguesScanned === 0 && event.draftsFound === 0 && event.draftsAdded === 0;
  const status = noProgress && event.errorMessage ? "failed" : "complete";
  await db.update(adpUserCrawlEvents)
    .set({ status, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(adpUserCrawlEvents.id, event.id));
}

// ── Per-item processors ──────────────────────────────────────────────────────

async function processItem(
  targetType: "username" | "user" | "league" | "draft",
  targetId: string,
  season: string | null,
  seedSleeperUserId: string | null,
): Promise<{ draftsFound: number; draftsIngested: number; picksIngested: number }> {
  if (targetType === "username") return processUsername(targetId, season, seedSleeperUserId);
  if (targetType === "user")     return processUser(targetId, season, seedSleeperUserId);
  if (targetType === "league")   return processLeague(targetId, seedSleeperUserId);
  if (targetType === "draft")    return processDraft(targetId);
  throw new Error(`unknown target type: ${targetType}`);
}

async function processUsername(username: string, season: string | null, seedSleeperUserId: string | null) {
  const user = await rateLimitedFetchJson<{ user_id: string }>(`${SLEEPER_API}/user/${username}`);
  if (!user?.user_id) {
    return { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };
  }
  return processUser(user.user_id, season, seedSleeperUserId);
}

async function processUser(userId: string, season: string | null, seedSleeperUserId: string | null) {
  const seasons = season ? [season] : DEFAULT_SEASONS;
  let totals = { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };

  for (const s of seasons) {
    const leagues = await rateLimitedFetchJson<Array<{ league_id: string }>>(
      `${SLEEPER_API}/user/${userId}/leagues/nfl/${s}`,
    );
    if (!leagues) continue;
    // Enqueue each league as its own queue row so the work fans out and
    // remains resumable across server restarts. For passive crawls we
    // tag every descendant with the originating sleeper_user_id so the
    // event-row counters and completion detection in workerTick can
    // attribute work back to the right event.
    for (const lg of leagues) {
      const added = await enqueueOnce("league", lg.league_id, null, 60, seedSleeperUserId);
      if (added) totals.draftsFound++;
    }
  }
  // Passive-crawl counter semantics: for processUser, draftsFound carries
  // the number of leagues enqueued (this becomes leagues_scanned at the
  // event level).
  return totals;
}

async function processLeague(leagueId: string, seedSleeperUserId: string | null) {
  const draftList = await rateLimitedFetchJson<Array<{ draft_id: string; status?: string; type?: string; sport?: string }>>(
    `${SLEEPER_API}/league/${leagueId}/drafts`,
  );
  if (!draftList) return { draftsFound: 0, draftsIngested: 0, picksIngested: 0 };

  // Eligibility gate. Only startup / rookie NFL drafts feed the ADP dataset.
  // Sleeper's `type` field is one of "snake" | "auction" | "linear" for the
  // draft FORMAT, and the dynasty/startup classification lives on the
  // associated league. The per-draft `metadata.scoring_type === "rookies"`
  // or the league's `settings.type` would be more reliable, but those are
  // only available after a per-draft fetch. We do a cheap first-pass filter
  // here using whatever the drafts-list response gives us, then let
  // ingestDraftById's deriveDraftType + quality filters reject the rest.
  // The result is we waste at most one extra Sleeper fetch per misclassified
  // draft instead of dragging an entire redraft league through the pipe.
  const eligible = draftList.filter((d) => {
    if (d.sport && d.sport !== "nfl") return false;
    return true;
  });

  let drafts_found = 0;
  for (const d of eligible) {
    const added = await enqueueOnce("draft", d.draft_id, null, 70, seedSleeperUserId);
    if (added) drafts_found++;
  }
  // Passive-crawl counter semantics: for processLeague, draftsFound is the
  // number of eligible drafts we just enqueued for this league.
  return { draftsFound: drafts_found, draftsIngested: 0, picksIngested: 0 };
}

async function processDraft(draftId: string) {
  const r = await ingestDraftById(draftId);
  if (!r.ok) return { draftsFound: 1, draftsIngested: 0, picksIngested: 0 };
  // ingestDraftById's quality filter rejects non-dynasty / IDP / mock /
  // micro-league drafts; deriveDraftType labels each accepted draft. We
  // only count drafts that actually landed picks in the table — anything
  // skipped (already complete, excluded, quality filtered) returns
  // r.picks=0 and so doesn't bump drafts_added.
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

/** Recent passive-crawl events for the admin panel. Ordered newest first.
 *  Includes derived `pendingItems` so the UI can show "still running" rows
 *  with a useful denominator. */
export async function getPassiveCrawlEvents(limit = 50): Promise<Array<{
  id: number;
  sleeperUserId: string;
  sleeperUsername: string | null;
  source: string;
  status: string;
  queuedItems: number;
  leaguesScanned: number;
  draftsFound: number;
  draftsAdded: number;
  pendingItems: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>> {
  const rows = await db
    .select()
    .from(adpUserCrawlEvents)
    .orderBy(desc(adpUserCrawlEvents.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.sleeperUserId)));
  const pendingRows = await db
    .select({ uid: adpCrawlQueue.seedSleeperUserId, c: sql<number>`count(*)` })
    .from(adpCrawlQueue)
    .where(and(
      isNotNull(adpCrawlQueue.seedSleeperUserId),
      inArray(adpCrawlQueue.seedSleeperUserId, userIds),
      inArray(adpCrawlQueue.status, ["pending", "processing"]),
    ))
    .groupBy(adpCrawlQueue.seedSleeperUserId);
  const pendingByUser = new Map<string, number>(
    pendingRows.map((r) => [r.uid as string, Number(r.c ?? 0)]),
  );

  return rows.map((r) => ({
    id: r.id,
    sleeperUserId: r.sleeperUserId,
    sleeperUsername: r.sleeperUsername,
    source: r.source,
    status: r.status,
    queuedItems: r.queuedItems,
    leaguesScanned: r.leaguesScanned,
    draftsFound: r.draftsFound,
    draftsAdded: r.draftsAdded,
    pendingItems: pendingByUser.get(r.sleeperUserId) ?? 0,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}

export async function resetFailedQueueItems(): Promise<{ reset: number }> {
  const result = await db
    .update(adpCrawlQueue)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(eq(adpCrawlQueue.status, "failed"))
    .returning({ id: adpCrawlQueue.id });
  return { reset: result.length };
}
