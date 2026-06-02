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

// Cap the whole app at PG_POOL_MAX connections (default 10). Override via env if
// the database's ceiling allows more headroom. Keep this comfortably below
// `max_connections` so the session store and vitals monitor always get a slot.
const POOL_MAX = Number(process.env.PG_POOL_MAX || 10);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pool-level 'error' fires when an idle client dies (e.g. the DB dropped the
// connection during maintenance). Swallow + log it so it can't bubble up to the
// process-level unhandledRejection handler — the pool transparently recycles.
pool.on("error", (err) => {
  console.error("[db] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

export const db = drizzle(pool);
