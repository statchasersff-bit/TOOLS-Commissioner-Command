import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { installVitals, startVitalsHeartbeat, getVitals } from "./vitals";
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

// Track in-flight requests as early as possible — registered before the session
// and body middleware so a request that hangs *inside* that middleware (the
// suspected pool-exhaustion failure mode) is still counted and surfaced.
installVitals(app);

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

// CORS — always allow the production domains plus any additional origins
// from CORS_ORIGIN env var. statchasers.com is included as a first-class
// production origin (see TEMPORARY note in shared/appMode.ts — when the
// temporary write-access promotion is reverted, statchasers.com should
// still keep CORS for read-only features).
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
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow known origins + Replit dev/preview domains
    if (
      CORS_ORIGINS.includes(origin) ||
      /\.replit\.dev$/.test(origin) ||
      /\.replit\.app$/.test(origin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    // Unknown origin — no CORS headers, but don't 500
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions));

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
  connectionTimeoutMillis: 10_000,
});
sessionPool.on("error", (err) => {
  console.error("[session-store] idle client error (pool will recycle):", err instanceof Error ? err.message : err);
});

const PgStore = connectPgSimple(session);
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

// Benign connection-abort errors (browser disconnected mid-request) come from
// raw-body/express.json() and are not server bugs — never log/act on them.
function isBenignConnectionError(e: unknown): boolean {
  return (
    e instanceof Error &&
    ((e as any).code === "ECONNABORTED" ||
      (e as any).type === "request.aborted" ||
      e.message?.includes("request aborted"))
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
  await registerRoutes(httpServer, app);

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

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  // Kill whatever is currently holding the port, then bind.
  await freePort(port);

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
    // Kick a self-request so Vite compiles the module graph immediately on
    // startup rather than on the first real browser request (which causes a
    // white screen while Vite cold-compiles).
    if (process.env.NODE_ENV !== "production") {
      fetch(`http://localhost:${port}/`).catch(() => {});
    }
  });
})();
