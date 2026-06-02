/**
 * Runtime vitals monitoring — lightweight, dependency-free, never-throws.
 *
 * Purpose: catch the "app hangs on the loading spinner until we republish"
 * failure mode automatically, in the deployment logs, instead of guessing.
 *
 * What it watches (and why each one maps to that symptom):
 *  - Postgres connection count vs. max_connections. The app opens many
 *    independent pg.Pool instances (one per server module) plus the session
 *    store pool, none of which cap their size. If the total reaches the
 *    Postgres ceiling, the session middleware's per-request connection blocks
 *    and every request hangs — the browser sits on the loading spinner. A
 *    republish boots a fresh VM, dropping all server-side connections, which
 *    is why it "fixes" it temporarily. This is the prime suspect, so we
 *    measure it directly.
 *  - In-flight HTTP requests + per-request age. A pile-up of requests that
 *    never finish is the server-side shadow of the spinner; we log the actual
 *    method+path of anything stuck open past HUNG_MS so the culprit endpoint
 *    is named, not inferred.
 *  - Event-loop lag. If a background job (crawler/snapshots) blocks the loop,
 *    requests stall even with connections free.
 *  - Process memory (rss/heap). A slow leak ending in an OOM kill also
 *    presents as "degrades after running a while".
 *
 * Everything here is best-effort: a monitoring failure must never take down or
 * slow the app it is monitoring, so every async path is wrapped and the timers
 * are unref()'d so they can't keep the process alive on their own.
 */
import type { Express, Request, Response, NextFunction } from "express";
import pg from "pg";
import { pool as appPool } from "./db";

const HEARTBEAT_MS = 60_000;     // how often we log a vitals line
const HUNG_MS = 25_000;          // a request still open this long is "hung"
const EVENT_LOOP_SAMPLE_MS = 2_000;

// Warning thresholds — crossing one promotes the heartbeat to console.warn so
// it stands out in the deploy logs in the minutes before a hang.
const WARN_PG_UTIL = 0.8;        // ≥80% of max_connections in use
const WARN_LOOP_LAG_MS = 500;    // event loop stalled ≥0.5s
const WARN_INFLIGHT = 40;        // ≥40 concurrent in-flight requests
const WARN_RSS_MB = Number(process.env.VITALS_WARN_RSS_MB || 1500);
// Any client waiting for a free app-pool slot is the leading indicator of the
// "hangs every few hours" failure: the pool is full and queries are queuing.
// The DB-side census (total vs max_connections) does NOT catch this — the app
// pool can be saturated at 10/10 while the DB only sees ~16/100 connections.
const WARN_APP_POOL_WAITING = 1;

// ── In-flight request tracking ───────────────────────────────────────────────
type OpenReq = { method: string; path: string; start: number; done: boolean };
let reqSeq = 0;
const openRequests = new Map<number, OpenReq>();

// ── Event-loop lag sampling ──────────────────────────────────────────────────
let maxLoopLagMs = 0;
let loopTimerStarted = false;

function startEventLoopSampler(): void {
  if (loopTimerStarted) return;
  loopTimerStarted = true;
  let expected = Date.now() + EVENT_LOOP_SAMPLE_MS;
  const t = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    if (lag > maxLoopLagMs) maxLoopLagMs = lag;
    expected = now + EVENT_LOOP_SAMPLE_MS;
  }, EVENT_LOOP_SAMPLE_MS);
  t.unref?.();
}

// ── Postgres connection census ───────────────────────────────────────────────
// A dedicated single-connection pool so the monitor never competes with app
// traffic for slots and its own footprint is a constant 1.
let monitorPool: pg.Pool | null = null;
function getMonitorPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!monitorPool) {
    monitorPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 30_000,
      // Keep the monitor from itself hanging forever if the DB is saturated.
      connectionTimeoutMillis: 5_000,
    });
    // A pool 'error' event on an idle client is non-fatal here; swallow it so
    // it can't bubble to the process-level unhandledRejection handler.
    monitorPool.on("error", () => {});
  }
  return monitorPool;
}

type PgCensus = {
  total: number;
  active: number;
  idle: number;
  idleInTxn: number;
  max: number;
} | null;

async function pgCensus(): Promise<PgCensus> {
  const pool = getMonitorPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT setting::int FROM pg_settings WHERE name = 'max_connections')      AS max,
         count(*)::int                                                              AS total,
         count(*) FILTER (WHERE state = 'active')::int                              AS active,
         count(*) FILTER (WHERE state = 'idle')::int                                AS idle,
         count(*) FILTER (WHERE state = 'idle in transaction')::int                 AS idle_in_txn
       FROM pg_stat_activity
       WHERE datname = current_database()`,
    );
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      active: Number(r.active ?? 0),
      idle: Number(r.idle ?? 0),
      idleInTxn: Number(r.idle_in_txn ?? 0),
      max: Number(r.max ?? 0),
    };
  } catch {
    // DB unreachable / permission-limited view — report nothing rather than throw.
    return null;
  }
}

// ── Public snapshot (used by the heartbeat and the /health vitals endpoint) ──
export type Vitals = {
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  eventLoopLagMs: number;
  inFlight: number;
  hung: Array<{ method: string; path: string; ageSec: number }>;
  pg: PgCensus;
  // Client-side view of the shared app pool (server/db.ts). `waiting` > 0 means
  // queries are queued behind a full pool — the precursor to a site-wide hang.
  appPool: { total: number; idle: number; waiting: number; max: number };
};

export async function getVitals(): Promise<Vitals> {
  const now = Date.now();
  const mem = process.memoryUsage();
  const hung = Array.from(openRequests.values())
    .filter((r) => !r.done && now - r.start >= HUNG_MS)
    .map((r) => ({ method: r.method, path: r.path, ageSec: Math.round((now - r.start) / 1000) }))
    .sort((a, b) => b.ageSec - a.ageSec)
    .slice(0, 10);
  return {
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
    },
    eventLoopLagMs: Math.round(maxLoopLagMs),
    inFlight: openRequests.size,
    hung,
    pg: await pgCensus(),
    appPool: {
      total: appPool.totalCount,
      idle: appPool.idleCount,
      waiting: appPool.waitingCount,
      max: (appPool.options as { max?: number }).max ?? 0,
    },
  };
}

// ── Wiring ───────────────────────────────────────────────────────────────────

/**
 * Install the in-flight request tracker. Register this BEFORE the routes so it
 * sees every request, including ones that later hang.
 */
export function installVitals(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = ++reqSeq;
    const entry: OpenReq = { method: req.method, path: req.path, start: Date.now(), done: false };
    openRequests.set(id, entry);
    const close = () => {
      if (entry.done) return;
      entry.done = true;
      openRequests.delete(id);
    };
    res.on("finish", close);
    res.on("close", close);
    next();
  });
}

/**
 * Start the periodic vitals heartbeat. Call once after the server is listening.
 * Logs a single structured line per interval; promotes to console.warn (and
 * names any hung requests) when a threshold is crossed.
 */
export function startVitalsHeartbeat(): void {
  startEventLoopSampler();
  const tick = async () => {
    try {
      const v = await getVitals();
      const pgStr = v.pg
        ? `pg=${v.pg.total}/${v.pg.max}(act:${v.pg.active} idle:${v.pg.idle} idletx:${v.pg.idleInTxn})`
        : "pg=unavailable";
      const line =
        `[vitals] up=${v.uptimeSec}s rss=${v.memory.rssMb}MB heap=${v.memory.heapUsedMb}/${v.memory.heapTotalMb}MB ` +
        `loopLag=${v.eventLoopLagMs}ms inflight=${v.inFlight} hung=${v.hung.length} ${pgStr}`;

      const pgHot = !!v.pg && v.pg.max > 0 && v.pg.total >= v.pg.max * WARN_PG_UTIL;
      const warn =
        pgHot ||
        v.eventLoopLagMs >= WARN_LOOP_LAG_MS ||
        v.inFlight >= WARN_INFLIGHT ||
        v.memory.rssMb >= WARN_RSS_MB ||
        v.hung.length > 0;

      if (warn) {
        const reasons: string[] = [];
        if (pgHot) reasons.push(`PG_CONNECTIONS_HOT(${v.pg!.total}/${v.pg!.max})`);
        if (v.eventLoopLagMs >= WARN_LOOP_LAG_MS) reasons.push(`EVENT_LOOP_LAG(${v.eventLoopLagMs}ms)`);
        if (v.inFlight >= WARN_INFLIGHT) reasons.push(`INFLIGHT_HIGH(${v.inFlight})`);
        if (v.memory.rssMb >= WARN_RSS_MB) reasons.push(`RSS_HIGH(${v.memory.rssMb}MB)`);
        if (v.hung.length > 0) reasons.push(`HUNG_REQUESTS(${v.hung.length})`);
        console.warn(`${line} ⚠️ ${reasons.join(" ")}`);
        for (const h of v.hung) {
          console.warn(`[vitals]   ↳ hung ${h.ageSec}s: ${h.method} ${h.path}`);
        }
      } else {
        console.log(line);
      }
    } catch (err) {
      // Monitoring must never crash or noisily destabilize the app.
      console.error("[vitals] heartbeat error (ignored):", err instanceof Error ? err.message : err);
    } finally {
      // Reset the lag high-water mark so each interval reports its own peak.
      maxLoopLagMs = 0;
    }
  };
  const t = setInterval(tick, HEARTBEAT_MS);
  t.unref?.();
  // Emit one line shortly after boot so the logs confirm monitoring is live
  // without waiting a full interval.
  const warmup = setTimeout(tick, 5_000);
  warmup.unref?.();
}
