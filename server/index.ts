import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { installVitals, startVitalsHeartbeat, getVitals } from "./vitals";
import { checkDbHealth } from "./db";
import { createServer } from "http";
import { readFileSync, readdirSync, readlinkSync } from "fs";
import pg from "pg";

/**
 * Find the PID holding `port` via /proc/net/tcp, then SIGKILL it.
 * Falls back silently if /proc is unavailable or nothing is on the port.
 */
async function freePort(port: number): Promise<void> {
  try {
    // /proc/net/tcp uses hex little-endian addresses: "00000000:1388" for 0.0.0.0:5000
    const portHex = port.toString(16).toUpperCase().padStart(4, "0");
    const tcp = readFileSync("/proc/net/tcp", "utf8");

    // Find the inode for the listening socket on this port
    let inode: string | null = null;
    for (const line of tcp.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (!parts[1]) continue;
      const localPort = parts[1].split(":")[1];
      if (localPort === portHex && parts[3] === "0A") { // 0A = LISTEN
        inode = parts[9];
        break;
      }
    }
    if (!inode) return; // nothing listening on this port

    // Walk /proc/*/fd/* to find which PID owns the inode
    const ownPid = process.pid;
    for (const pidEntry of readdirSync("/proc")) {
      const pid = parseInt(pidEntry, 10);
      if (isNaN(pid) || pid === ownPid) continue;
      try {
        const fds = readdirSync(`/proc/${pid}/fd`);
        for (const fd of fds) {
          try {
            const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (link === `socket:[${inode}]`) {
              process.kill(pid, "SIGKILL");
              console.log(`[server] killed PID ${pid} holding port ${port}`);
              // Give the OS ~1s to reclaim the port
              await new Promise(r => setTimeout(r, 1000));
              return;
            }
          } catch { /* fd may disappear */ }
        }
      } catch { /* proc entry may disappear */ }
    }
  } catch {
    // /proc not available or other error — proceed and let bind fail naturally
  }
}

const app = express();
const httpServer = createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
// MUST be registered before every other middleware (installVitals, session,
// body-parser, auth, routes). This guarantees that:
//   • OPTIONS preflights respond with 204 + CORS headers before auth runs.
//   • Regular responses already carry the CORS headers even if a later
//     middleware throws (the error handler applies cors again as a safety net).
//
// Allowed origins: hardcoded production domains + CORS_ORIGIN env var overrides
// + any *.replit.dev / *.replit.app preview domain + localhost for dev.
const BUILTIN_ORIGINS = [
  "https://dynastycommandff.com",
  "https://www.dynastycommandff.com",
  "https://statchasers.com",
  "https://www.statchasers.com",
  "https://dynasty-command.pages.dev",
  "https://dynasty-command.replit.app",
];
const CORS_ORIGINS = [
  ...BUILTIN_ORIGINS,
  ...(process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : []),
];

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (server-to-server, curl, Replit health checks)
    if (!origin) return callback(null, true);
    // Allow known production domains + Replit dev/preview subdomains + localhost
    if (
      CORS_ORIGINS.includes(origin) ||
      /\.replit\.dev$/.test(origin) ||
      /\.replit\.app$/.test(origin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    // Unknown origin — no CORS headers, but don't throw/500
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-admin-secret",
    "x-requested-with",
  ],
  maxAge: 86400,
};

// Pre-create one middleware instance so we can reuse it in the error handler.
const corsMiddleware = cors(corsOptions);

console.log("[startup] before cors");

// 1. Global CORS headers on every response.
app.use(corsMiddleware);

// 2. Explicit OPTIONS responder — uses a RegExp path to avoid the
//    path-to-regexp v8 wildcard syntax ("/{*path}" / "*") that crashes
//    this version of Express. OPTIONS preflights never touch session/auth.
app.options(/.*/, corsMiddleware);

// ── Ultra-light health probe ─────────────────────────────────────────────────
// Registered immediately after CORS — before installVitals, session, body
// parsers, auth, and all routes — so it responds in <1 ms regardless of
// database / background-worker health. Use this to confirm the server is
// listening before diagnosing any other endpoint.
app.get("/api/health/light", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), uptime: process.uptime() });
});

console.log("[startup] after cors + health/light registered");

// Track in-flight requests as early as possible — registered before the session
// and body middleware so a request that hangs *inside* that middleware (the
// suspected pool-exhaustion failure mode) is still counted and surfaced.
installVitals(app);
console.log("[startup] after installVitals");

// Build/runtime identity. BUILD_TIME and GIT_COMMIT are inlined at build time
// by esbuild (see script/build.ts). In dev (tsx) they're undefined and fall
// back to sensible defaults.
const BUILD_TIME = process.env.BUILD_TIME || "dev";
const GIT_COMMIT = process.env.GIT_COMMIT || "unknown";

// ── Liveness probe ───────────────────────────────────────────────────────────
// Registered BEFORE the session/DB middleware on purpose: "healthy" must mean
// "the Express process is alive and listening", independent of whether Postgres
// happens to be reachable. That's exactly the signal an external uptime monitor
// needs to tell "VM is dead" (504/timeout) apart from "app is up". Both /health
// and /healthz are served so any monitor convention works.
app.get(["/health", "/healthz"], (_req, res) => {
  res.status(200).json({
    status: "ok",
    env: process.env.NODE_ENV || "development",
    uptimeSec: Math.round(process.uptime()),
    commit: GIT_COMMIT,
    builtAt: BUILD_TIME,
    ts: new Date().toISOString(),
  });
});

// ── Deep vitals probe ────────────────────────────────────────────────────────
// Unlike /health (pure liveness), this reports the resource metrics that
// precede a hang — Postgres connection count vs. ceiling, in-flight/hung
// requests, event-loop lag, and memory — as JSON. Point an external uptime
// monitor at it and alert when pg.total approaches pg.max or hung > 0, so you
// learn the VM is saturating *before* it locks up.
app.get(["/health/vitals", "/healthz/vitals"], async (_req, res) => {
  try {
    res.status(200).json({ status: "ok", commit: GIT_COMMIT, ...(await getVitals()) });
  } catch (err) {
    res.status(200).json({ status: "vitals-error", error: err instanceof Error ? err.message : String(err) });
  }
});

// ── DB connectivity probe ─────────────────────────────────────────────────────
// Answers the single question "can the app talk to Postgres right now, and how
// fast?" and — crucially — distinguishes "DB unreachable" from "app pool
// saturated". Both surface to users as a connection timeout, so this endpoint
// is the fastest way to tell them apart: if connected=true but pool.waiting is
// high, the DB is fine and the pool is the bottleneck (the ADP-compute
// stampede), not DATABASE_URL/SSL/the DB being asleep.
app.get(["/health/db", "/api/health/db"], async (_req, res) => {
  const health = await checkDbHealth();
  res.status(health.connected ? 200 : 503).json({ ok: health.connected, ...health });
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    // 5MB ceiling covers CSV uploads for the Value Source Manager (largest
    // realistic upload is ~10k players × ~80 chars ≈ 800KB).
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "5mb" }));

// ── Session middleware ─────────────────────────────────────────────────────────
console.log("[startup] before session pool");
declare module "express-session" {
  interface SessionData {
    scUserId?: string;
  }
}

// Dedicated, capped pool for the session store. The session middleware runs on
// EVERY request and acquires a connection each time, so it gets its own small
// pool isolated from heavy app/background query load. Capping it (plus the
// shared app pool in server/db.ts) keeps the server's total connection
// footprint well under Postgres' max_connections — the fix for the "every few
// hours the app hangs on the loading spinner" bug. See docs/PRODUCTION_RESILIENCE.md.
const sessionPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_SESSION_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  // 3 s instead of 10 s: a session-store timeout should fail fast so the
  // request returns a 500 quickly rather than hanging for 10 s. The /api/health/light
  // probe above bypasses sessions entirely, so uptime monitors still work.
  connectionTimeoutMillis: 3_000,
  // TCP keepalive + connection max-lifetime so a connection severed by a DB
  // restart/network blip is detected and recycled instead of occupying a slot
  // forever (the "timeout exceeded when trying to connect" wedge — see the full
  // rationale in server/db.ts). The session store is the most request-critical
  // pool, so self-healing it matters most.
  keepAlive: true,
  keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS || 10_000),
  maxLifetimeSeconds: Number(process.env.PG_MAX_LIFETIME_SEC || 300),
  // Same per-query timeouts as the app pool (see server/db.ts for the full
  // rationale). The session store touches the DB on every request, so an
  // unbounded session query is the single most likely thing to hang the whole
  // site. Failing a session query fast (→ 500, process stays up) beats every
  // request queuing forever behind one wedged connection.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30_000),
  query_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30_000),
  idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TXN_TIMEOUT_MS || 60_000),
  // `maxLifetimeSeconds` is implemented by pg-pool at runtime but not yet in
  // @types/pg, so widen the config type to pass it through (see server/db.ts).
} as pg.PoolConfig & { maxLifetimeSeconds?: number });
sessionPool.on("error", (err) => {
  console.error("[session-store] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

const PgStore = connectPgSimple(session);
console.log("[startup] before session middleware");
app.use(
  session({
    store: new PgStore({
      pool: sessionPool,
      createTableIfMissing: true,
      tableName: "sc_sessions",
    }),
    name: "sc.sid",
    secret: process.env.SESSION_SECRET || "fallback-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);
console.log("[startup] after session middleware");

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Transient TCP/network errors that do NOT corrupt process state and should
// never cause a supervisor restart. These happen constantly in production:
// clients disconnect, outbound HTTP times out, DNS blips, Replit network
// maintenance, etc. Killing the server on these is strictly worse than logging
// and continuing to serve the remaining healthy connections.
//
// Codes we intentionally do NOT list here (they DO warrant a restart):
//   - EADDRINUSE — port conflict at bind time, can't serve anything
//   - EACCES     — permission denied, structural problem
const BENIGN_NETWORK_CODES = new Set([
  "ECONNABORTED",  // client aborted mid-request (body parsers)
  "ECONNRESET",    // client reset the TCP connection
  "ECONNREFUSED",  // outbound request refused by remote
  "ETIMEDOUT",     // outbound request / DB connect timed out
  "ENETUNREACH",   // no route to host (transient Replit network blip)
  "EHOSTUNREACH",  // same as above, different layer
  "ENOTFOUND",     // DNS lookup failed (transient)
  "EAI_AGAIN",     // DNS temporary failure
  "EPIPE",         // write to closed socket (client gone)
  "ENOENT",        // occasionally from tmp-file ops on aborted requests
]);

function isBenignConnectionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as NodeJS.ErrnoException).code;
  if (code && BENIGN_NETWORK_CODES.has(code)) return true;
  const msg = e.message ?? "";
  return (
    (e as any).type === "request.aborted" ||
    msg.includes("request aborted") ||
    msg.includes("socket hang up") ||
    msg.includes("socket closed") ||
    msg.includes("write after end") ||
    msg.includes("read ECONNRESET") ||
    msg.includes("connect ETIMEDOUT") ||
    msg.includes("connect ENETUNREACH") ||
    msg.includes("HPE_INVALID_CHUNK_EXTENSION") ||
    msg.includes("aborted")
  );
}

// ── Crash safety ─────────────────────────────────────────────────────────────
// THIS IS THE FIX FOR THE DAILY 504s. The old handler called process.exit(1)
// on ANY unhandled rejection. During Replit's overnight maintenance window the
// DB/network connections blip, which surfaces as a rejected promise somewhere
// in the request/background path — and that single transient blip was killing
// the whole production process. A rejected promise is NOT a reason to take the
// site down, so we now log loudly and keep serving.
process.on("unhandledRejection", (reason) => {
  if (isBenignConnectionError(reason)) return;
  console.error("[server] unhandledRejection (process kept alive):", reason);
});

// An uncaughtException can leave the process in a genuinely undefined state, so
// here we DO exit — but cleanly (exit 1) so the Reserved VM supervisor restarts
// a fresh process automatically. Resilience comes from the supervised restart,
// not from limping along in a corrupt state. Benign client aborts are ignored.
process.on("uncaughtException", (err) => {
  if (isBenignConnectionError(err)) return;
  console.error("[server] uncaughtException — exiting for clean supervisor restart:", err);
  process.exit(1);
});

(async () => {
  console.log("[startup] before registerRoutes");
  await registerRoutes(httpServer, app);
  console.log("[startup] after registerRoutes");

  // Any /api request that falls through here did not match an Express route.
  // Without this, the SPA catch-all would respond with index.html, which the
  // frontend can't parse and which masks the missing route as "Expected JSON
  // but received text/html". Returning a JSON 404 makes the failure obvious.
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "API route not found",
      path: req.originalUrl,
    });
  });

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Re-apply CORS headers on error responses. The global corsMiddleware at
    // the top of the chain already set them for normal requests, but if an
    // error short-circuits before the response is flushed the headers may be
    // absent. A 500 without Access-Control-Allow-Origin is indistinguishable
    // from a CORS failure in the browser and hides the real error message.
    corsMiddleware(req, res, () => {
      res.status(status).json({ message });
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  console.log("[startup] before vite/static setup");
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
  console.log("[startup] after vite/static setup");

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  // Kill whatever is currently holding the port, then bind.
  console.log(`[startup] before freePort(${port})`);
  await freePort(port);
  console.log(`[startup] after freePort — about to listen on :${port}`);

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[server] fatal listen error:", err);
    process.exit(1);
  });

  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log("server started");
    log(`  port:        ${port}`);
    log(`  environment: ${process.env.NODE_ENV || "development"}`);
    log(`  build time:  ${BUILD_TIME}`);
    log(`  commit:      ${GIT_COMMIT}`);
    log(`  health:      GET /health`);
    log(`  vitals:      GET /health/vitals`);
    // Begin periodic vitals logging (memory, event-loop lag, in-flight/hung
    // requests, Postgres connection census). Surfaces resource saturation in
    // the deploy logs in the minutes before a hang.
    startVitalsHeartbeat();
    // ── Startup DB connectivity check ─────────────────────────────────────────
    // Run once on boot (non-blocking) so the deploy logs immediately show
    // whether Postgres is reachable and how fast, instead of discovering it only
    // when the first user request fails. Logs the provider + latency on success,
    // or the classified failure (connect vs pool-acquire) on error.
    checkDbHealth()
      .then((h) => {
        if (h.connected) {
          log(`  db:          OK (${h.provider}, SELECT 1 in ${h.latencyMs}ms, pool ${h.pool.total}/${h.pool.max})`);
        } else {
          console.error(`[server] DB health check FAILED on startup [${h.kind}]: ${h.error} :: ${h.detail}`);
        }
      })
      .catch((err) => console.error("[server] DB health check threw on startup:", err));
    // Kick a self-request so Vite compiles the module graph immediately on
    // startup rather than on the first real browser request (which causes a
    // white screen while Vite cold-compiles).
    if (process.env.NODE_ENV !== "production") {
      fetch(`http://localhost:${port}/`).catch(() => {});
    }
  });
})();
