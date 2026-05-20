/**
 * Sleeper Write Limiter — global serialization + humanized pacing for every
 * authenticated Sleeper write across the app.
 *
 * Why this exists: each of our bulk queues (trades, lineups, share-chat,
 * waivers) paces its own actions, but they don't coordinate with each
 * other. Running two queues in parallel — or a single queue that doesn't
 * pace at all (the old waiver path) — produces bursts that look nothing
 * like a real user clicking through Sleeper's web UI.
 *
 * Every authenticated write must `await sleeperWriteLimiter.waitTurn(type)`
 * before sending. The limiter:
 *   1. Mutex-serializes turns so no two writes can overlap, even from
 *      different queues / tabs of the same component.
 *   2. Enforces a randomized minimum gap since the previous write. The gap
 *      adapts upward as recent volume rises (sliding 5- and 10-minute
 *      windows).
 *   3. Honours a global cooldown deadline set whenever a 429 / rate-limit
 *      response is observed, slowing every future write until the deadline.
 *
 * It does not implement retries — callers keep their own retry logic — but
 * the cooldown bumps make repeat retries automatically slower.
 *
 * No JWT or auth state is touched here. Pure pacing.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Minimum/maximum gap between consecutive writes under normal load. */
const BASE_GAP_MIN_MS = 4_000;
const BASE_GAP_MAX_MS = 8_000;

/** Window 1: >= N writes in the last X minutes → tighter pacing. */
const WINDOW_1_MS = 5 * 60_000;
const WINDOW_1_LIMIT = 5;
const WINDOW_1_GAP_MIN_MS = 8_000;
const WINDOW_1_GAP_MAX_MS = 15_000;

/** Window 2: >= N writes in the last X minutes → much slower. */
const WINDOW_2_MS = 10 * 60_000;
const WINDOW_2_LIMIT = 10;
const WINDOW_2_GAP_MIN_MS = 20_000;
const WINDOW_2_GAP_MAX_MS = 40_000;

/** Initial cooldown applied on the first 429 / rate-limit signal. */
const COOLDOWN_BASE_MIN_MS = 2 * 60_000;
const COOLDOWN_BASE_MAX_MS = 5 * 60_000;
/** Multiplier on each subsequent consecutive rate-limit before reset. */
const COOLDOWN_MULTIPLIER = 1.75;
const COOLDOWN_MAX_MS = 30 * 60_000;
/** Rate-limit streak resets after this many ms with no 429. */
const COOLDOWN_STREAK_RESET_MS = 15 * 60_000;

// ─── Types ──────────────────────────────────────────────────────────────────

export type SleeperWriteAction =
  | "trade"
  | "waiver"
  | "lineup"
  | "chat"
  | "draft"
  | "other";

interface LimiterState {
  /** Timestamp of the most recent write authorisation. */
  lastWriteAt: number;
  /** Timestamps of recent writes for the sliding window. Trimmed lazily. */
  recentWrites: number[];
  /** No write may proceed before this timestamp (set by rate-limit notices). */
  cooldownUntil: number;
  /** Promise chain used as a mutex so two waitTurn calls serialize. */
  pending: Promise<void>;
  /** Number of consecutive rate-limit events; reset after a quiet period. */
  rateLimitStreak: number;
  /** When the last rate-limit happened — used to decay the streak. */
  lastRateLimitAt: number;
  /** Whether we're currently in a cooldown (informational for UIs). */
  cooldownActive: boolean;
  /** Optional listener for cooldown-state changes (single subscriber for now). */
  onCooldownChange: ((info: { active: boolean; until: number; reason: string }) => void) | null;
}

const state: LimiterState = {
  lastWriteAt: 0,
  recentWrites: [],
  cooldownUntil: 0,
  pending: Promise.resolve(),
  rateLimitStreak: 0,
  lastRateLimitAt: 0,
  cooldownActive: false,
  onCooldownChange: null,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function randBetween(lo: number, hi: number): number {
  return Math.floor(lo + Math.random() * (hi - lo));
}

function trimWindow(now: number): void {
  // Keep only entries from the last 10 minutes (the largest window we look at).
  const cutoff = now - WINDOW_2_MS;
  if (state.recentWrites.length === 0 || state.recentWrites[0] >= cutoff) return;
  state.recentWrites = state.recentWrites.filter((t) => t >= cutoff);
}

function countWithin(now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let n = 0;
  for (let i = state.recentWrites.length - 1; i >= 0; i--) {
    if (state.recentWrites[i] >= cutoff) n++;
    else break;
  }
  return n;
}

function computeRequiredGapMs(now: number): { min: number; max: number; tier: string } {
  const inW1 = countWithin(now, WINDOW_1_MS);
  const inW2 = countWithin(now, WINDOW_2_MS);
  if (inW2 >= WINDOW_2_LIMIT) {
    return { min: WINDOW_2_GAP_MIN_MS, max: WINDOW_2_GAP_MAX_MS, tier: "slow" };
  }
  if (inW1 >= WINDOW_1_LIMIT) {
    return { min: WINDOW_1_GAP_MIN_MS, max: WINDOW_1_GAP_MAX_MS, tier: "moderate" };
  }
  return { min: BASE_GAP_MIN_MS, max: BASE_GAP_MAX_MS, tier: "base" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function decayRateLimitStreak(now: number): void {
  if (state.rateLimitStreak === 0) return;
  if (now - state.lastRateLimitAt < COOLDOWN_STREAK_RESET_MS) return;
  state.rateLimitStreak = 0;
}

function emitCooldownState(reason: string): void {
  state.onCooldownChange?.({
    active: state.cooldownActive,
    until: state.cooldownUntil,
    reason,
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface WaitTurnInfo {
  /** Milliseconds the caller slept before being released. */
  waitedMs: number;
  /** Which pacing tier applied: "base" | "moderate" | "slow" | "cooldown". */
  tier: string;
  /** Cooldown deadline if a cooldown was active; otherwise 0. */
  cooldownUntil: number;
}

/**
 * Acquire the global write turn. Blocks (asynchronously) until:
 *   - any earlier `waitTurn` call has finished, AND
 *   - any global cooldown has elapsed, AND
 *   - the randomized gap since the previous write has elapsed.
 *
 * Resolves once it's safe to fire the request. The caller MUST fire the
 * write soon after; the limiter records "lastWriteAt = now" at release time
 * so deliberate stalls don't slow the next write.
 *
 * Action type is recorded for logging/telemetry only; pacing is shared
 * across all action types (Sleeper's rate limiter doesn't distinguish).
 */
export async function waitTurn(_action: SleeperWriteAction): Promise<WaitTurnInfo> {
  // Chain onto the previous pending call so two waitTurns serialize.
  const prev = state.pending;
  let release: () => void = () => {};
  state.pending = new Promise<void>((r) => { release = r; });

  await prev;

  const startedWaitAt = Date.now();
  try {
    let tier = "base";

    // Honour any active cooldown first.
    while (Date.now() < state.cooldownUntil) {
      tier = "cooldown";
      const remaining = state.cooldownUntil - Date.now();
      await sleep(Math.min(remaining, 5_000));
    }

    decayRateLimitStreak(Date.now());

    // Then enforce the randomized gap since the last release.
    const now = Date.now();
    trimWindow(now);
    const { min, max, tier: gapTier } = computeRequiredGapMs(now);
    if (tier !== "cooldown") tier = gapTier;
    const requiredGap = randBetween(min, max);
    const elapsedSinceLast = state.lastWriteAt === 0 ? requiredGap : now - state.lastWriteAt;
    if (elapsedSinceLast < requiredGap) {
      await sleep(requiredGap - elapsedSinceLast);
    }

    const releasedAt = Date.now();
    state.lastWriteAt = releasedAt;
    state.recentWrites.push(releasedAt);

    return {
      waitedMs: releasedAt - startedWaitAt,
      tier,
      cooldownUntil: state.cooldownUntil > releasedAt ? state.cooldownUntil : 0,
    };
  } finally {
    release();
  }
}

/**
 * Record that the most recent write was met with a 429 / rate-limit
 * response. Bumps the global cooldown so every future write waits at least
 * `cooldownUntil` ms before firing. Consecutive 429s scale the cooldown up.
 */
export function noteRateLimit(reason: string = "429"): void {
  const now = Date.now();
  decayRateLimitStreak(now);
  state.rateLimitStreak += 1;
  state.lastRateLimitAt = now;

  // Base cooldown is randomized; each consecutive 429 multiplies.
  const baseRange = randBetween(COOLDOWN_BASE_MIN_MS, COOLDOWN_BASE_MAX_MS);
  const scaled = Math.min(
    Math.floor(baseRange * Math.pow(COOLDOWN_MULTIPLIER, state.rateLimitStreak - 1)),
    COOLDOWN_MAX_MS,
  );

  const newUntil = now + scaled;
  if (newUntil > state.cooldownUntil) state.cooldownUntil = newUntil;
  state.cooldownActive = true;
  emitCooldownState(reason);
}

/** Force-clear any active cooldown. Use sparingly — exposed so admin/debug
 *  tooling can reset state if needed. */
export function clearCooldown(): void {
  state.cooldownUntil = 0;
  state.cooldownActive = false;
  state.rateLimitStreak = 0;
  emitCooldownState("cleared");
}

/** Snapshot of current limiter state — read-only, for UI cards. */
export function getLimiterStatus(): {
  cooldownActive: boolean;
  cooldownUntil: number;
  recentWriteCount: number;
  lastWriteAt: number;
  rateLimitStreak: number;
} {
  const now = Date.now();
  trimWindow(now);
  decayRateLimitStreak(now);
  state.cooldownActive = state.cooldownUntil > now;
  return {
    cooldownActive: state.cooldownActive,
    cooldownUntil: state.cooldownUntil,
    recentWriteCount: state.recentWrites.length,
    lastWriteAt: state.lastWriteAt,
    rateLimitStreak: state.rateLimitStreak,
  };
}

/** Subscribe to cooldown state changes. Single subscriber; replaces any
 *  prior handler. Pass `null` to unsubscribe. */
export function onCooldownChange(
  fn: ((info: { active: boolean; until: number; reason: string }) => void) | null,
): void {
  state.onCooldownChange = fn;
}

/**
 * Detect a rate-limit signal from an arbitrary error message or HTTP code.
 * Helper for callers that catch errors from sleeperGraphQLRequest.
 */
export function looksLikeRateLimit(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b429\b/.test(msg)) return true;
  if (/rate[\s-]?limit/i.test(msg)) return true;
  if (/too many (requests|attempts)/i.test(msg)) return true;
  return false;
}

export const sleeperWriteLimiter = {
  waitTurn,
  noteRateLimit,
  clearCooldown,
  getLimiterStatus,
  onCooldownChange,
  looksLikeRateLimit,
};
