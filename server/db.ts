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
// WHY 60 — every server module now shares THIS one pool (see the consolidation
// note above), so the old "23 pools × 10 = 230 connections" math no longer
// applies; the whole app's app-query footprint is bounded by this single number.
// The PRODUCTION database's `max_connections` is ~450 (confirmed live via
// /health/vitals → pg.max). NOTE: the workspace/dev DATABASE_URL points at a
// DIFFERENT database whose ceiling is only 112 — do NOT size this pool off the
// dev DB. Under load the production app pool SATURATES: /health/vitals has shown
// all slots busy with ~470 requests queued (appPool.waiting) while the DB itself
// sat at only ~73/450 connections — i.e. the pool, not the DB, was the
// bottleneck, and every queued request waited out connectionTimeoutMillis (10s)
// then failed with "timeout exceeded when trying to connect" (that message is the
// pool-ACQUIRE timeout, not a TCP-connect failure). 40 was not enough headroom
// for that load and 25 made it worse; 60 uses the idle DB capacity to drain the
// queue. Footprint: 60 app + 3 auth + 5 session + 1 vitals = 69 per instance, so
// even TWO overlapping instances during a deploy (~138) stay well under ~450.
// Tune via PG_POOL_MAX if the DB shows CPU/connection pressure.
export const POOL_MAX = Number(process.env.PG_POOL_MAX || 60);

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

// ── Error classification ──────────────────────────────────────────────────────
// node-postgres surfaces several very different failures with confusingly
// similar messages. The most important distinction for THIS app:
//
//   "timeout exceeded when trying to connect"  — pg-pool's pool-ACQUIRE timeout.
//       Every slot in our capped pool (max=PG_POOL_MAX) is checked out and the
//       request waited connectionTimeoutMillis for a free one. The DATABASE is
//       fine and reachable — the APP POOL is saturated. This is the symptom of
//       a slow/stampeding endpoint (e.g. live ADP computes), NOT a DB outage,
//       NOT a bad DATABASE_URL, NOT SSL. Reported by the frontend as a generic
//       "connection timeout", which misleads everyone into chasing DB config.
//   ECONNREFUSED / ENOTFOUND / EAI_AGAIN / "getaddrinfo"  — a real TCP/DNS
//       failure reaching the database host (wrong URL, DB asleep, network).
//   statement/query timeout  — the connection was acquired fine but the QUERY
//       itself ran past statement_timeout/query_timeout.
//
// Returning the right `kind` lets routes emit an actionable message instead of
// the raw, misleading string.
export type DbErrorKind =
  | "pool-acquire-timeout"
  | "connect"
  | "query-timeout"
  | "auth"
  | "other";

export function classifyDbError(err: unknown): {
  kind: DbErrorKind;
  /** Human-readable, actionable headline. */
  error: string;
  /** Sanitized original message (no connection string / credentials). */
  detail: string;
} {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown error");
  const code = (err as any)?.code as string | undefined;
  // Strip anything that looks like a postgres URL / password from the detail.
  const detail = raw.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***");

  if (/timeout exceeded when trying to connect/i.test(raw)) {
    return {
      kind: "pool-acquire-timeout",
      error:
        "Database connection pool is saturated (could not acquire a connection). " +
        "The database itself is reachable; the app's pool is full.",
      detail,
    };
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return { kind: "connect", error: "Cannot reach the database host (TCP/DNS failure).", detail };
  }
  if (/statement timeout|query.*timeout|canceling statement due to statement timeout/i.test(raw)) {
    return { kind: "query-timeout", error: "Database query exceeded the statement timeout.", detail };
  }
  if (/password authentication failed|no pg_hba|role .* does not exist/i.test(raw)) {
    return { kind: "auth", error: "Database authentication failed (check DATABASE_URL credentials).", detail };
  }
  return { kind: "other", error: "Database error.", detail };
}

/** Best-effort provider name from the DATABASE_URL host (no secrets leaked). */
function dbProvider(): string {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    if (/neon\.tech$/i.test(host)) return "neon";
    if (/supabase\./i.test(host)) return "supabase";
    if (/render\.com$/i.test(host)) return "render";
    if (/\.rds\.amazonaws\.com$/i.test(host)) return "rds";
    if (/localhost|127\.0\.0\.1/.test(host)) return "local";
    return host ? "postgres" : "unknown";
  } catch {
    return "unknown";
  }
}

export interface DbHealth {
  connected: boolean;
  /** Round-trip latency of a `SELECT 1`, in ms. */
  latencyMs: number | null;
  provider: string;
  /** Live census of the main app pool. */
  pool: { total: number; idle: number; waiting: number; max: number };
  error?: string;
  detail?: string;
  kind?: DbErrorKind;
}

/**
 * Lightweight DB connectivity probe: acquires a connection and runs `SELECT 1`,
 * timing the round-trip. Reports the main pool's live census so a caller can
 * tell "DB unreachable" apart from "pool saturated" (the two failure modes that
 * both surface as a connection timeout). Never throws — failures are returned.
 */
export async function checkDbHealth(): Promise<DbHealth> {
  const started = Date.now();
  const census = () => ({
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: POOL_MAX,
  });
  try {
    await pool.query("SELECT 1");
    return {
      connected: true,
      latencyMs: Date.now() - started,
      provider: dbProvider(),
      pool: census(),
    };
  } catch (err) {
    const c = classifyDbError(err);
    return {
      connected: false,
      latencyMs: Date.now() - started,
      provider: dbProvider(),
      pool: census(),
      error: c.error,
      detail: c.detail,
      kind: c.kind,
    };
  }
}
