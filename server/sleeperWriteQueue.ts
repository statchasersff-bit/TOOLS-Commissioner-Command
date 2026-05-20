/**
 * Server-side queue for Sleeper write actions.
 *
 * All Sleeper mutations should funnel through `enqueueSleeperAction` so:
 *   - Bursts (e.g. a bulk-trade across 12 leagues) get serialized with a
 *     deliberate delay rather than fired in parallel. Sleeper's anti-abuse
 *     code is aggressive against any IP that issues many auth'd writes
 *     in tight succession.
 *   - Per-user concurrency is capped at 1 so we never re-order a user's
 *     intent.
 *   - Per-process concurrency is bounded so one user can't starve the
 *     queue for everyone else.
 *   - Every action is logged (start, end, error) for postmortem.
 *
 * This is NOT an access boundary — the request must still pass the
 * `requireWriteCapability` middleware chain before reaching the queue.
 * The queue's only job is traffic shaping.
 *
 * The implementation is intentionally simple (in-memory, single-process).
 * If/when the deployment scales horizontally, replace `inFlightByUser` /
 * the global pacing token with Redis-backed primitives. The public API
 * (enqueueSleeperAction) should stay stable.
 */

export type SleeperWriteActionType =
  | "SEND_TRADE"
  | "ACCEPT_TRADE"
  | "REJECT_TRADE"
  | "SUBMIT_WAIVER"
  | "BULK_TRADE"
  | "BULK_WAIVER"
  | "SUBMIT_LINEUP"
  | "DRAFT_PICK"
  | "UPDATE_DRAFT_QUEUE"
  | "SEND_AUTO_MESSAGE";

interface QueuedAction<T> {
  userId: string;
  actionType: SleeperWriteActionType;
  leagueId?: string;
  payloadSummary?: string;
  task: () => Promise<T>;
}

// ── Pacing config ──────────────────────────────────────────────────────────
// Per-user serial: a single user always processes one action at a time so
// we never accidentally fire two trades in flight before the first response.
const inFlightByUser = new Map<string, Promise<unknown>>();

// Global gap between writes — prevents a tight serial loop from looking
// like a flood. 350ms ≈ 170 writes/min process-wide.
const GLOBAL_MIN_GAP_MS = 350;

// Bulk actions take an extra pause to keep them from monopolizing the
// queue's throughput.
const BULK_EXTRA_GAP_MS = 750;

let lastWriteAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isBulk(action: SleeperWriteActionType): boolean {
  return action === "BULK_TRADE" || action === "BULK_WAIVER";
}

async function awaitGlobalPace(action: SleeperWriteActionType): Promise<void> {
  const now = Date.now();
  const gap = isBulk(action) ? GLOBAL_MIN_GAP_MS + BULK_EXTRA_GAP_MS : GLOBAL_MIN_GAP_MS;
  const wait = Math.max(0, gap - (now - lastWriteAt));
  if (wait > 0) await sleep(wait);
  lastWriteAt = Date.now();
}

/**
 * Enqueue a Sleeper write. Resolves to whatever the task returns. Throws
 * the task's error after structured logging.
 *
 * Usage:
 *
 *   const result = await enqueueSleeperAction({
 *     userId: req.dcUserId,
 *     actionType: "SEND_TRADE",
 *     leagueId,
 *     payloadSummary: `to=${partner} send=${count}`,
 *     task: () => sleeperGraphqlProposeTrade(token, payload),
 *   });
 */
export async function enqueueSleeperAction<T>(opts: QueuedAction<T>): Promise<T> {
  const { userId, actionType, leagueId, payloadSummary, task } = opts;

  // Chain onto any in-flight action for this user — serial per user.
  const prior = inFlightByUser.get(userId) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((res) => { release = res; });
  inFlightByUser.set(userId, prior.then(() => next));

  try {
    await prior;
    await awaitGlobalPace(actionType);

    const startedAt = Date.now();
    logQueueEvent("start", { userId, actionType, leagueId, payloadSummary });
    try {
      const out = await task();
      logQueueEvent("done", {
        userId,
        actionType,
        leagueId,
        payloadSummary,
        durationMs: Date.now() - startedAt,
      });
      return out;
    } catch (err: any) {
      logQueueEvent("error", {
        userId,
        actionType,
        leagueId,
        payloadSummary,
        durationMs: Date.now() - startedAt,
        error: err?.message ?? String(err),
      });
      throw err;
    }
  } finally {
    release();
    // If we're the most-recent in-flight slot, clear so the map doesn't
    // grow without bound.
    if (inFlightByUser.get(userId) === (prior as any).then?.(() => next)) {
      inFlightByUser.delete(userId);
    }
  }
}

function logQueueEvent(
  kind: "start" | "done" | "error",
  opts: {
    userId: string;
    actionType: SleeperWriteActionType;
    leagueId?: string;
    payloadSummary?: string;
    durationMs?: number;
    error?: string;
  },
): void {
  const parts = [
    "[sleeper-queue]",
    `event=${kind}`,
    `user=${opts.userId}`,
    `action=${opts.actionType}`,
  ];
  if (opts.leagueId) parts.push(`league=${opts.leagueId}`);
  if (typeof opts.durationMs === "number") parts.push(`duration_ms=${opts.durationMs}`);
  if (opts.payloadSummary) parts.push(`payload="${opts.payloadSummary.replace(/"/g, "'")}"`);
  if (opts.error) parts.push(`error="${opts.error.replace(/"/g, "'")}"`);
  if (kind === "error") console.error(parts.join(" "));
  else console.info(parts.join(" "));
}
