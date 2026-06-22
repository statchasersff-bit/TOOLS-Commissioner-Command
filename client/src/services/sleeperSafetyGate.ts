/**
 * Sleeper Safety Gate
 *
 * Two safety layers that sit *above* the pacing limiter:
 *
 *   1. Emergency kill switch — toggle to instantly block every authenticated
 *      Sleeper write across the app. Driven by `VITE_SLEEPER_WRITES_ENABLED`
 *      (build-time) and a localStorage runtime override (runtime). Reads
 *      are never blocked.
 *
 *   2. Soft action caps — hourly + daily rolling counters per action type,
 *      stored in localStorage. Surfaces near-cap warnings and past-cap
 *      confirmations so users don't accidentally torch their account with
 *      a runaway batch.
 *
 * Both layers fail-safe: if storage is unavailable, the kill switch
 * defaults to "enabled" (don't lock the user out) and the caps default to
 * "0 used" (don't block a legitimate first batch).
 *
 * No JWTs, tokens, or message bodies are stored here. Only:
 *   - action type
 *   - timestamp
 *   - count
 */

import type { SleeperWriteAction } from "@/services/sleeperWriteLimiter";
import { sleeperWriteLimiter } from "@/services/sleeperWriteLimiter";

// ─── Kill switch ────────────────────────────────────────────────────────────

const RUNTIME_KILL_SWITCH_KEY = "sc:sleeper-writes-disabled";

export const KILL_SWITCH_MESSAGE =
  "Sleeper actions are temporarily paused by StatChasers for safety. Please try again later.";

function envSaysDisabled(): boolean {
  try {
    // Vite inlines `import.meta.env.VITE_*` at build time. We treat the
    // literal string "false" as disabled. Anything else (undefined, "true",
    // "1") leaves writes enabled.
    const v = (import.meta as any)?.env?.VITE_SLEEPER_WRITES_ENABLED;
    return typeof v === "string" && v.trim().toLowerCase() === "false";
  } catch {
    return false;
  }
}

function runtimeSaysDisabled(): boolean {
  try {
    return localStorage.getItem(RUNTIME_KILL_SWITCH_KEY) === "1";
  } catch {
    return false;
  }
}

/** True when writes are allowed. Reads are never gated by this function. */
export function isWriteEnabled(): boolean {
  if (envSaysDisabled()) return false;
  if (runtimeSaysDisabled()) return false;
  return true;
}

/** Runtime override — turns the kill switch on without a redeploy. The env
 *  variable still wins, so a build with `VITE_SLEEPER_WRITES_ENABLED=false`
 *  cannot be re-enabled from the client. */
export function setRuntimeKillSwitch(disabled: boolean): void {
  try {
    if (disabled) localStorage.setItem(RUNTIME_KILL_SWITCH_KEY, "1");
    else localStorage.removeItem(RUNTIME_KILL_SWITCH_KEY);
    window.dispatchEvent(new CustomEvent("sc:sleeper-kill-switch-changed"));
  } catch {
    /* storage disabled */
  }
}

/** Single source of truth for the user-facing block message. */
export function killSwitchError(): Error {
  return new Error(KILL_SWITCH_MESSAGE);
}

// ─── Action caps ────────────────────────────────────────────────────────────

const CAP_STORAGE_KEY = "sc:sleeper-action-log";

/** Per-action hourly/daily soft caps. These are guidance, not enforcement —
 *  the user can still proceed after explicit confirmation. */
export const ACTION_CAPS: Record<SleeperWriteAction, { hour: number; day: number }> = {
  trade:   { hour: 25, day: 100 },
  waiver:  { hour: 30, day: 120 },
  lineup:  { hour: 60, day: 200 },
  chat:    { hour: 15, day: 50 },
  draft:   { hour: 60, day: 400 },
  other:   { hour: 30, day: 120 },
};

/** Threshold at which we surface the "near cap" warning. */
const NEAR_CAP_FRACTION = 0.8;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PRUNE_MS = DAY_MS; // drop entries older than the longest window we use

interface ActionLogEntry {
  /** Action type recorded. */
  a: SleeperWriteAction;
  /** Millisecond timestamp the write was authorised. */
  t: number;
}

function readLog(): ActionLogEntry[] {
  try {
    const raw = localStorage.getItem(CAP_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Defensive: drop anything that doesn't match the expected shape.
    return arr.filter((e): e is ActionLogEntry =>
      e && typeof e === "object" && typeof e.t === "number" && typeof e.a === "string"
    );
  } catch {
    return [];
  }
}

function writeLog(log: ActionLogEntry[]): void {
  try {
    localStorage.setItem(CAP_STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* storage disabled / quota — degrade gracefully */
  }
}

function pruneLog(log: ActionLogEntry[], now: number): ActionLogEntry[] {
  const cutoff = now - PRUNE_MS;
  if (log.length === 0 || log[0].t >= cutoff) return log;
  return log.filter((e) => e.t >= cutoff);
}

function countWithin(log: ActionLogEntry[], action: SleeperWriteAction, windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.t < cutoff) break; // log is append-ordered
    if (e.a === action) n++;
  }
  return n;
}

export interface ActionCounts {
  /** Writes of this action type in the rolling hour window. */
  hour: number;
  /** Writes of this action type in the rolling day window. */
  day: number;
  /** Configured hourly cap. */
  hourCap: number;
  /** Configured daily cap. */
  dayCap: number;
  /** True when current count is ≥80% of either cap. */
  nearCap: boolean;
  /** True when current count is at or over either cap. */
  overCap: boolean;
}

/** Snapshot of how many recent writes of this type we've recorded locally. */
export function getActionCounts(action: SleeperWriteAction): ActionCounts {
  const now = Date.now();
  const log = readLog();
  const caps = ACTION_CAPS[action] ?? ACTION_CAPS.other;
  const hour = countWithin(log, action, HOUR_MS, now);
  const day = countWithin(log, action, DAY_MS, now);
  const nearCap = hour >= Math.floor(caps.hour * NEAR_CAP_FRACTION)
                || day  >= Math.floor(caps.day  * NEAR_CAP_FRACTION);
  const overCap = hour >= caps.hour || day >= caps.day;
  return { hour, day, hourCap: caps.hour, dayCap: caps.day, nearCap, overCap };
}

/**
 * Record one successful authenticated write. Called by `sleeperGraphQLRequest`
 * after the response resolves with no errors. If the recorded action pushes
 * us over the soft cap, also bumps the global pacing limiter into its
 * cooldown tier so the next several actions slow down automatically.
 */
export function recordWrite(action: SleeperWriteAction): void {
  const now = Date.now();
  const log = pruneLog(readLog(), now);
  log.push({ a: action, t: now });
  writeLog(log);

  const counts = getActionCounts(action);
  if (counts.overCap) {
    // Don't punish forever — a short cooldown is enough to slow the next
    // few writes. The limiter's existing 429 logic handles bigger bumps.
    sleeperWriteLimiter.noteRateLimit(`soft-cap:${action}`);
  }
}

/** Wipe stored counters — admin/debug utility. Does not affect kill switch. */
export function resetActionCounts(): void {
  try { localStorage.removeItem(CAP_STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Cap-confirm helper (browser-native confirm) ────────────────────────────

export interface BatchPreflightInput {
  /** Action type the batch is about to fire. */
  action: SleeperWriteAction;
  /** Optional batch size — used in the prompt copy. */
  batchSize?: number;
}

export interface BatchPreflightResult {
  /** True when the batch is allowed to proceed. */
  ok: boolean;
  /** Why preflight refused (only set when ok === false). */
  blockedReason?: "kill-switch" | "user-declined-confirmation";
  /** Counts snapshot at preflight time — for UI surfacing. */
  counts: ActionCounts;
  /** True when current counts are over the soft cap. */
  overCap: boolean;
  /** True when within 80% of either cap (advisory). */
  nearCap: boolean;
}

/**
 * Run before starting any batch action queue.
 *   1) Returns ok=false with "kill-switch" reason when writes are disabled.
 *   2) Asks the user to confirm when current counts are over the soft cap.
 *   3) Returns the counts snapshot either way so the queue UI can show
 *      "you've used N of M today" near-cap warnings without re-querying.
 *
 * Uses window.confirm() for the over-cap check — minimal UI surface that
 * blocks until the user decides. A richer modal can be substituted later.
 */
export function preflightBatch(input: BatchPreflightInput): BatchPreflightResult {
  const counts = getActionCounts(input.action);
  if (!isWriteEnabled()) {
    return { ok: false, blockedReason: "kill-switch", counts, overCap: counts.overCap, nearCap: counts.nearCap };
  }
  if (counts.overCap) {
    const proceed = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(
          `You've submitted ${counts.day} ${input.action} action${counts.day === 1 ? "" : "s"} today ` +
          `(soft cap ${counts.dayCap}).\n\n` +
          `Continuing may increase rate-limit risk and Commissioner Command will slow things down automatically. ` +
          `Do you want to continue?`,
        )
      : true;
    if (!proceed) {
      return { ok: false, blockedReason: "user-declined-confirmation", counts, overCap: true, nearCap: counts.nearCap };
    }
  }
  return { ok: true, counts, overCap: counts.overCap, nearCap: counts.nearCap };
}

// ─── Messaging feature flags + auto trade-link DM caps ──────────────────────

export const MESSAGING_DISABLED_MESSAGE =
  "Sleeper messaging is temporarily disabled.";

/**
 * Generic Sleeper messaging surfaces (free-text DMs, league chat, custom
 * trade-card DMs) are gated by this flag. Default: disabled.
 * Set VITE_ENABLE_GENERAL_SLEEPER_MESSAGES=true to re-enable.
 */
export function isGeneralMessagingEnabled(): boolean {
  try {
    const v = (import.meta as any)?.env?.VITE_ENABLE_GENERAL_SLEEPER_MESSAGES;
    return typeof v === "string" && v.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * The opt-in "share Commissioner Command to your league chats" feature. Posts to
 * league chat (parent_type: "league") only — NOT free-text DMs. Gated
 * independently of general messaging so the share feature can ship without
 * re-opening every messaging surface. Default: disabled.
 * Set VITE_ENABLE_LEAGUE_SHARE=true to enable.
 */
export function isLeagueShareEnabled(): boolean {
  try {
    const v = (import.meta as any)?.env?.VITE_ENABLE_LEAGUE_SHARE;
    return typeof v === "string" && v.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * The controlled, automatic post-trade "Commissioner Command link" DM. Default:
 * enabled. Set VITE_ENABLE_TRADE_LINK_DM=false to disable.
 */
export function isTradeLinkDmEnabled(): boolean {
  try {
    const v = (import.meta as any)?.env?.VITE_ENABLE_TRADE_LINK_DM;
    if (typeof v !== "string") return true;
    return v.trim().toLowerCase() !== "false";
  } catch {
    return true;
  }
}

// Caps for the automatic trade-link DM. These are STRICTER than the general
// action caps because the trade-link DM is the only messaging surface that
// still goes to other users — we want zero "spammy" appearance.
const TRADE_LINK_HOURLY_CAP = 5;
const TRADE_LINK_DAILY_CAP = 20;
/** Minimum gap between two trade-link DMs to the SAME recipient in the SAME
 *  league — duplicate prevention. */
const TRADE_LINK_PER_RECIPIENT_WINDOW_MS = 24 * HOUR_MS;

const TRADE_LINK_LOG_KEY = "sc:sleeper-trade-link-dm-log";

interface TradeLinkLogEntry {
  /** Recipient Sleeper user_id. */
  u: string;
  /** League id the trade was sent in. */
  l: string;
  /** Sender Sleeper user_id (so multiple DC accounts share storage safely). */
  s?: string;
  /** Timestamp (ms). */
  t: number;
}

function readTradeLinkLog(): TradeLinkLogEntry[] {
  try {
    const raw = localStorage.getItem(TRADE_LINK_LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is TradeLinkLogEntry =>
      e && typeof e === "object" && typeof e.t === "number"
        && typeof e.u === "string" && typeof e.l === "string"
    );
  } catch {
    return [];
  }
}

function writeTradeLinkLog(log: TradeLinkLogEntry[]): void {
  try { localStorage.setItem(TRADE_LINK_LOG_KEY, JSON.stringify(log)); }
  catch { /* ignore */ }
}

function pruneTradeLinkLog(log: TradeLinkLogEntry[], now: number): TradeLinkLogEntry[] {
  // Keep last 48h so dedupe window has headroom.
  const cutoff = now - 2 * DAY_MS;
  return log.filter((e) => e.t >= cutoff);
}

export type TradeLinkSkipReason = "caps-hour" | "caps-day" | "duplicate" | "disabled";

export interface TradeLinkPreflight {
  ok: boolean;
  skipReason?: TradeLinkSkipReason;
  /** Counts at preflight time — informational for diagnostics. */
  hour: number;
  day: number;
}

/**
 * Decide whether the automatic trade-link DM is allowed RIGHT NOW for this
 * (sender, recipient, league) triple. Pure read — does not record.
 */
export function canSendTradeLinkDm(opts: {
  senderUserId?: string | null;
  recipientUserId: string;
  leagueId: string;
}): TradeLinkPreflight {
  if (!isTradeLinkDmEnabled()) {
    return { ok: false, skipReason: "disabled", hour: 0, day: 0 };
  }
  const now = Date.now();
  const log = pruneTradeLinkLog(readTradeLinkLog(), now);

  let hour = 0;
  let day = 0;
  for (const e of log) {
    if (now - e.t <= HOUR_MS) hour++;
    if (now - e.t <= DAY_MS) day++;
  }
  if (hour >= TRADE_LINK_HOURLY_CAP) {
    return { ok: false, skipReason: "caps-hour", hour, day };
  }
  if (day >= TRADE_LINK_DAILY_CAP) {
    return { ok: false, skipReason: "caps-day", hour, day };
  }
  // Duplicate prevention — same sender + recipient + league within window.
  for (const e of log) {
    if (now - e.t > TRADE_LINK_PER_RECIPIENT_WINDOW_MS) continue;
    if (e.u !== opts.recipientUserId) continue;
    if (e.l !== opts.leagueId) continue;
    if (opts.senderUserId && e.s && e.s !== opts.senderUserId) continue;
    return { ok: false, skipReason: "duplicate", hour, day };
  }
  return { ok: true, hour, day };
}

/**
 * Record that an automatic trade-link DM was sent successfully. Must be
 * called AFTER a successful create_message — never call optimistically.
 */
export function recordTradeLinkDm(opts: {
  senderUserId?: string | null;
  recipientUserId: string;
  leagueId: string;
}): void {
  const now = Date.now();
  const log = pruneTradeLinkLog(readTradeLinkLog(), now);
  log.push({
    u: opts.recipientUserId,
    l: opts.leagueId,
    s: opts.senderUserId || undefined,
    t: now,
  });
  writeTradeLinkLog(log);
}

export const sleeperSafetyGate = {
  isWriteEnabled,
  setRuntimeKillSwitch,
  killSwitchError,
  KILL_SWITCH_MESSAGE,
  getActionCounts,
  recordWrite,
  resetActionCounts,
  preflightBatch,
  ACTION_CAPS,
  isGeneralMessagingEnabled,
  isLeagueShareEnabled,
  isTradeLinkDmEnabled,
  canSendTradeLinkDm,
  recordTradeLinkDm,
  MESSAGING_DISABLED_MESSAGE,
};
