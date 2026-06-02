/**
 * Single shared Postgres connection pool for the entire server.
 *
 * WHY THIS EXISTS — the "app hangs on the loading spinner every few hours" bug.
 * Previously every server module constructed its own `new pg.Pool(...)`. With
 * ~23 modules each defaulting to node-postgres' max of 10 connections, the
 * aggregate ceiling was ~230 connections — far above a typical Postgres
 * `max_connections` (often 100 or lower on managed instances). When the
 * background jobs (ADP crawler, snapshots, news ingest) ran alongside user
 * traffic, the total crossed that ceiling. The session store's per-request
 * connection acquisition then blocked, so EVERY API request hung — which the
 * browser shows as the app stuck on the loading spinner. A republish "fixed" it
 * only because booting a fresh VM dropped all server-side connections.
 *
 * Consolidating every module onto this one capped pool bounds the server's
 * connection footprint predictably. The session store (server/index.ts) and the
 * vitals monitor (server/vitals.ts) keep their own small pools; everything else
 * imports from here.
 *
 * See docs/PRODUCTION_RESILIENCE.md and server/vitals.ts for the diagnosis.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// `@types/pg` (8.x) hasn't caught up to pg-pool, which implements
// `maxLifetimeSeconds` at runtime (see node_modules/pg-pool/index.js). Extend the
// config type so we can pass it through while keeping full type-checking on every
// other field. Exported so the session pool in server/index.ts uses the same type.
export type PoolConfigWithLifetime = pg.PoolConfig & { maxLifetimeSeconds?: number };

// Cap the whole app at PG_POOL_MAX connections (default 40). Override via env if
// the database's ceiling allows more headroom. Keep this comfortably below
// `max_connections` so the session store and vitals monitor always get a slot.
//
// WHY 25 — every server module now shares THIS one pool (see the consolidation
// note above), so the old "23 pools × 10 = 230 connections" math no longer
// applies; the whole app's app-query footprint is bounded by this single number.
// The DB's actual `max_connections` is 112 (measured against the live TimescaleDB
// instance — NOT the ~450 an earlier comment assumed). Steady-state usage sits
// under 20, so 10 artificially starved normal traffic: a single slow endpoint
// (e.g. the user/trade ingest crawl) could pin the handful of slots and queue
// hundreds of requests behind them — including /api/sc-auth/me and /login, which
// then time out (→ 500, spinner, "Login failed"). 25 app + 3 auth + 5 session +
// 1 vitals = 34 per instance, so even TWO overlapping instances during a deploy
// (~68) plus TimescaleDB's own background workers stay comfortably under 112,
// while giving auth and normal reads room to get a connection even while a crawl
// runs. (40 would have left only ~14 headroom under a deploy overlap.)
const POOL_MAX = Number(process.env.PG_POOL_MAX || 25);

// ── Stale-connection self-healing — the "timeout exceeded when trying to connect"
// fix. ── A pg.Pool counts a checked-out client against `max` until that client
// is released or emits 'error'. When the DB restarts or a network path drops
// (TimescaleDB maintenance, a transient blip), already-open connections can be
// severed at the TCP layer WITHOUT node-postgres noticing — the socket just goes
// quiet. Those dead clients keep occupying pool slots forever, so every new
// pool.query() waits the full connectionTimeoutMillis (10s) for a slot that never
// frees, then rejects with "timeout exceeded when trying to connect". The DB
// itself is fine and nearly idle; only the app's pool is wedged, which is why a
// republish (fresh, empty pool) was the only known fix. Two options make the pool
// recover on its own:
//   • keepAlive                — turns on TCP keepalive so the OS probes idle
//                                connections and surfaces a severed one as an
//                                error; the pool then evicts it instead of
//                                counting it as live indefinitely.
//   • maxLifetimeSeconds       — proactively retires each connection after this
//                                long regardless of health, so even a dead-but-
//                                undetected connection is rotated out within the
//                                window. This bounds how long a wedge can last to
//                                ~maxLifetime instead of "until the next deploy".
const KEEPALIVE_DELAY_MS = Number(process.env.PG_KEEPALIVE_DELAY_MS || 10_000);
const MAX_LIFETIME_SEC = Number(process.env.PG_MAX_LIFETIME_SEC || 300);

// ── Per-query timeouts — the OTHER half of the "hangs every few hours" fix. ──
// Capping the pool size bounds how MANY connections we open, but a single query
// that never returns (lock contention, a stuck transaction, a DB hiccup) still
// holds its slot forever. node-postgres puts NO timeout on how long a
// pool.query() waits for a free slot, so once all `max` slots are held by stuck
// queries, EVERY subsequent query — including /api/sc-auth/me — queues
// indefinitely and the request hangs until the browser's own 25s abort fires
// ("session check timed out / AbortError"). A republish only "fixes" it because
// the fresh pool starts empty. These three timeouts make an indefinitely-held
// connection structurally impossible:
//   • statement_timeout                  — Postgres aborts any single query that
//                                           runs longer than this, releasing it.
//   • query_timeout                       — client-side backstop: node-postgres
//                                           rejects + releases the client even if
//                                           the server-side timer never fires
//                                           (e.g. the connection itself wedged).
//   • idle_in_transaction_session_timeout — Postgres kills a transaction left
//                                           open/idle (a leaked BEGIN), freeing
//                                           the slot the txn was pinning.
// All are per-statement, so the batched-insert transactions in adp.ts (each
// statement is one ≤500-row insert) stay well under the ceiling. Override via
// env if a legitimately long query needs more room.
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30_000);
const IDLE_TXN_TIMEOUT_MS = Number(process.env.PG_IDLE_TXN_TIMEOUT_MS || 60_000);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
  maxLifetimeSeconds: MAX_LIFETIME_SEC,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_TXN_TIMEOUT_MS,
} as PoolConfigWithLifetime);

// A pool-level 'error' fires when an idle client dies (e.g. the DB dropped the
// connection during maintenance). Swallow + log it so it can't bubble up to the
// process-level unhandledRejection handler — the pool transparently recycles.
pool.on("error", (err) => {
  console.error("[db] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

export const db = drizzle(pool);

// ── Dedicated auth pool ───────────────────────────────────────────────────────
// Login, /me, register, and password-reset are the most user-visible routes.
// They share the main pool above with ADP crawlers, snapshot jobs, news ingest,
// and trade ingestion — all of which can hold connections for seconds at a time.
// When those background jobs saturate the main pool the auth routes queue behind
// them, wait the full connectionTimeoutMillis (10s), then return a 500 — which
// the user sees as "Login failed / spinner stuck". The same structural fix used
// for the session store (its own capped pool in server/index.ts): give auth its
// own tiny pool that background work can never touch.
// 3 connections is plenty: login + /me + register are fast point queries and
// rarely concurrent. connectionTimeoutMillis is intentionally short (4s) so a
// DB hiccup returns a real error quickly rather than holding the login button
// in a 10s spin.
export const authPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 4_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
  maxLifetimeSeconds: MAX_LIFETIME_SEC,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_TXN_TIMEOUT_MS,
} as PoolConfigWithLifetime);
authPool.on("error", (err) => {
  console.error("[auth-db] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

export const authDb = drizzle(authPool);
