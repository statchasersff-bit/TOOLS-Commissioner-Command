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

// Cap the whole app at PG_POOL_MAX connections (default 40). Override via env if
// the database's ceiling allows more headroom. Keep this comfortably below
// `max_connections` so the session store and vitals monitor always get a slot.
//
// WHY 40 (raised from 10) — every server module now shares THIS one pool (see the
// consolidation note above), so the old "23 pools × 10 = 230 connections" math no
// longer applies; the whole app's app-query footprint is bounded by this single
// number. Production `max_connections` is ~450 and steady-state usage sits under
// 20, so 10 left almost all of that headroom unused while artificially starving
// normal traffic: a single slow endpoint (e.g. the user/trade ingest crawl) could
// pin the handful of slots and queue hundreds of requests behind them — including
// /api/sc-auth/me and /login, which then time out (→ 500, spinner, "Login
// failed"). 40 app + 5 session + the vitals monitor stays far under 450 while
// giving auth and normal reads room to get a connection even while a crawl runs.
const POOL_MAX = Number(process.env.PG_POOL_MAX || 40);

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
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_TXN_TIMEOUT_MS,
});

// A pool-level 'error' fires when an idle client dies (e.g. the DB dropped the
// connection during maintenance). Swallow + log it so it can't bubble up to the
// process-level unhandledRejection handler — the pool transparently recycles.
pool.on("error", (err) => {
  console.error("[db] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

export const db = drizzle(pool);
