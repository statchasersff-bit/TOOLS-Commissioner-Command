/**
 * ADP crawl persistence repair + crash recovery.
 *
 * Three responsibilities:
 *
 *   1. `recoverStaleCrawlLogs` — on server boot, find any adp_crawl_log row
 *      stuck in status="running" past the inactivity threshold and flip it
 *      to status="failed" with a recovery message. Without this, a process
 *      kill mid-scan would leave the live state showing "running" forever
 *      and the next scan would be blocked by the in-flight guard.
 *
 *   2. `recoverStaleQueueItems` — the legacy `adpCrawlQueue` worker claims
 *      a row by flipping it to "processing"; a crash leaves it stuck. Reset
 *      stale processing rows back to "pending" so the worker can pick them
 *      up on the next tick.
 *
 *   3. `repairIncompleteDrafts` — admin-triggered cleanup that finds draft
 *      rows the ingest never finished writing picks for (status=complete,
 *      excludedFromAdp=false, picks=0 or picks < expected*0.6) and either
 *      deletes the orphan row or flips it to a re-ingest-eligible status.
 *      Used to recover from the failure mode that prompted this fix:
 *      drafts marked complete in the DB but with no picks, which the old
 *      dedup gate would not re-fetch.
 *
 * All functions are idempotent — running them repeatedly is safe.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  adpCrawlLog,
  adpCrawlQueue,
  drafts,
  draftPicks,
} from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

/** A scan that hasn't written a terminal row within this window is treated
 *  as crashed. 30 min is generous — even a depth-2 crawl finishes well under
 *  that, and the rate limiter caps total wall time. */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/** A queue item claimed (status="processing") but not updated in this window
 *  is treated as orphaned. Shorter because each item is one Sleeper call. */
const STALE_PROCESSING_MS = 10 * 60 * 1000;

export interface RecoveryResult {
  staleScansFlagged: number;
  staleQueueItemsReset: number;
}

/**
 * Run all the crash-recovery sweeps. Called from the server startup hook so
 * any state left dangling by the previous process is cleaned up before the
 * scheduler kicks off new work.
 */
export async function recoverAdpCrawlState(): Promise<RecoveryResult> {
  const [staleScansFlagged, staleQueueItemsReset] = await Promise.all([
    recoverStaleCrawlLogs(),
    recoverStaleQueueItems(),
  ]);
  if (staleScansFlagged > 0 || staleQueueItemsReset > 0) {
    console.log(
      `[ADP recovery] flagged ${staleScansFlagged} stale running scans, ` +
      `reset ${staleQueueItemsReset} stuck queue items`,
    );
  }
  return { staleScansFlagged, staleQueueItemsReset };
}

export async function recoverStaleCrawlLogs(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_RUNNING_MS);
  const result = await db
    .update(adpCrawlLog)
    .set({
      status: "failed",
      message: sql`COALESCE(${adpCrawlLog.message}, '') || ' [recovery: marked failed — process exited without finalizing]'`,
      completedAt: now,
    })
    .where(and(
      eq(adpCrawlLog.status, "running"),
      lt(adpCrawlLog.startedAt, threshold),
    ))
    .returning({ id: adpCrawlLog.id });
  return result.length;
}

export async function recoverStaleQueueItems(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_PROCESSING_MS);
  const result = await db
    .update(adpCrawlQueue)
    .set({
      status: "pending",
      lastError: "recovery: requeued after worker crash",
    })
    .where(and(
      eq(adpCrawlQueue.status, "processing"),
      lt(adpCrawlQueue.createdAt, threshold),
    ))
    .returning({ id: adpCrawlQueue.id });
  return result.length;
}

export interface DraftRepairResult {
  /** Drafts whose status=complete but had 0 picks AND aren't IDP/quality-
   *  filter excluded. These are the canonical "crashed mid-ingest" rows.
   *  Deleted so the next crawl re-ingests them cleanly. */
  orphansDeleted: number;
  /** Drafts whose status=complete but picks < expected*0.6 (partial
   *  inserts). Deleted along with their picks. */
  partialsDeleted: number;
  /** Drafts found and inspected. */
  inspected: number;
}

/**
 * Find and reset draft rows that are in an inconsistent state — status says
 * "complete" but the picks table doesn't have the matching rows. Each such
 * row gets its picks AND the drafts entry deleted so the next crawl can
 * re-ingest from scratch.
 *
 * We do NOT touch:
 *   * drafts with excludedFromAdp=true (intentional 0-picks state for IDP,
 *     quality-filter, real-kicker exclusions — these should NOT be re-fetched)
 *   * drafts whose status is pre_draft / drafting / paused (those are fine
 *     as-is; the next crawl will re-ingest when they complete)
 *   * drafts with enough picks to look complete (picks >= teams*rounds*0.6)
 */
export async function repairIncompleteDrafts(opts: { dryRun?: boolean } = {}): Promise<DraftRepairResult> {
  const dryRun = opts.dryRun === true;

  // Pull every "completed-but-shouldn't-be-skipped" draft. We compute
  // expected picks from teams * rounds since the column isn't stored — the
  // 0.6 slack matches the ingester's enoughPicks rule so we don't churn on
  // drafts that legitimately had a few empty slots.
  const suspects = await db
    .select({
      draftId: drafts.draftId,
      teams: drafts.teams,
      rounds: drafts.rounds,
    })
    .from(drafts)
    .where(and(
      eq(drafts.status, "complete"),
      eq(drafts.excludedFromAdp, false),
    ));

  let orphansDeleted = 0;
  let partialsDeleted = 0;

  for (const s of suspects) {
    const expected = (s.teams ?? 0) * (s.rounds ?? 0);
    const minAcceptable = expected > 0 ? Math.floor(expected * 0.6) : 1;

    const pickCount = await db
      .select({ c: sql<number>`count(*)` })
      .from(draftPicks)
      .where(eq(draftPicks.draftId, s.draftId));
    const picksStored = Number(pickCount[0]?.c ?? 0);

    if (picksStored >= minAcceptable) continue; // healthy

    if (!dryRun) {
      // Delete picks first to avoid orphan child rows, then the draft itself.
      // No FK in the schema (draft_picks.draft_id is plain varchar), but the
      // order is still meaningful for cleanliness.
      await db.transaction(async (tx) => {
        await tx.delete(draftPicks).where(eq(draftPicks.draftId, s.draftId));
        await tx.delete(drafts).where(eq(drafts.draftId, s.draftId));
      });
    }
    if (picksStored === 0) orphansDeleted++;
    else partialsDeleted++;
  }

  console.log(
    `[ADP repair] inspected=${suspects.length} ` +
    `orphansDeleted=${orphansDeleted} partialsDeleted=${partialsDeleted} dryRun=${dryRun}`,
  );
  return { orphansDeleted, partialsDeleted, inspected: suspects.length };
}
