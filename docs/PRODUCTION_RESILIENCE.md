# Production Resilience — why Commissioner Command went down nightly, and what fixes it

## TL;DR

The production process was being killed by a single line of code, not by Replit
"taking the site down." When Replit ran its overnight maintenance, DB/network
connections blipped for a few seconds. That blip surfaced as an **unhandled
promise rejection**, and our crash handler responded with `process.exit(1)` —
killing the whole Express server. The result was a 504 until someone clicked
**Publish** (which rebuilt and booted a fresh process, by which point
maintenance was over and the DB was reachable again).

Clicking Publish "worked" only because it happened to restart the process after
the blip had passed. It was never the real fix.

## Root cause (the exact line)

`server/index.ts`, previous version:

```ts
process.on("unhandledRejection", (reason) => {
  if (/* benign client abort */) return;
  console.error("[server] unhandledRejection:", reason);
  process.exit(1);   // <-- killed prod on any transient rejection
});
```

- A rejected promise from a momentarily-unreachable Postgres (session store,
  any background query) during maintenance → `process.exit(1)`.
- There was **no `uncaughtException` handler** at all, so a synchronous throw
  could also drop the process with no useful log.
- If the VM tried to restart while the DB was *still* unreachable, the process
  could crash again on boot, and the deployment would sit in a failed/504 state
  until a manual republish well after maintenance ended.

## What changed in code

All in `server/index.ts` and `script/build.ts`:

1. **`unhandledRejection` no longer exits.** Transient rejections are logged
   loudly (`[server] unhandledRejection (process kept alive)`) and the server
   keeps serving. A dropped DB connection is not a reason to take the site down.
2. **Added an `uncaughtException` handler** that *does* exit cleanly (`exit 1`)
   — because an uncaught synchronous exception can leave the process in a
   corrupt state. Exiting lets the Reserved VM supervisor restart a clean
   process automatically (resilience via supervised restart, not limping on).
3. **Added a `/health` (and `/healthz`) liveness endpoint**, registered
   *before* the session/DB middleware so it returns `200` whenever the Express
   process is alive — even if Postgres is momentarily down. This is the signal
   an external uptime monitor uses to distinguish "VM dead" (504/timeout) from
   "app up."
4. **Rich startup logs** — `server started`, port, environment, build time,
   commit — so a restart is visible and you can confirm which build is live.
5. **Build stamping** — `script/build.ts` injects `BUILD_TIME` and
   `GIT_COMMIT` at build time; both are reported by `/health` and the startup
   logs.

`/health` example response:

```json
{ "status":"ok", "env":"production", "uptimeSec":4,
  "commit":"8fa73e0", "builtAt":"2026-05-24T02:29:25.554Z",
  "ts":"2026-05-24T02:29:47.650Z" }
```

`uptimeSec` resetting to a low number is your proof the process restarted.

## Deployment configuration (already correct — keep it)

`.replit` already declares a **Reserved VM** deployment, which is the right
choice for an always-on Express server:

```toml
[deployment]
deploymentTarget = "vm"               # Reserved VM = runs 24/7, supervised
run   = ["npm", "run", "start"]        # NODE_ENV=production node dist/index.cjs
build = ["npm", "run", "build"]
```

- `deploymentTarget = "vm"` (Reserved VM) keeps one instance running
  continuously and **auto-restarts the process if it exits** and after Replit
  maintenance/VM migration. (Autoscale would be wrong here — it scales to zero
  and is request-driven.)
- The server binds to `process.env.PORT` (`server/index.ts`:
  `parseInt(process.env.PORT || "5000", 10)`), so it works with whatever port
  Replit injects. No hardcoded port.

> ⚠️ **Verify in the dashboard, not just the file.** The `.replit` block is the
> *intended* config; the live deployment is whatever was last created. In the
> Replit **Deployments** tab, confirm the active deployment is **Reserved VM**
> (not Autoscale) and that "Run command" is `npm run start`. If it's Autoscale,
> recreate it as Reserved VM.

## Deployment secrets — the other common cause of crash-on-boot

**Workspace Secrets are NOT automatically available to a Deployment.** A
Deployment has its own separate secrets. If a required secret is missing in the
Deployment, the server can crash on boot and look exactly like the maintenance
504. Set these in **Deployments → (your deployment) → Secrets**:

Required:
- `DATABASE_URL` — Postgres (session store + app data). Without it the session
  middleware fails on first request.
- `SESSION_SECRET` — falls back to a dev string if unset; **must** be set in
  prod or sessions are insecure/unstable across restarts.

Used by features (set the ones you rely on):
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — billing.
- `RESEND_API_KEY` — transactional email.
- `ADMIN_SECRET` — admin auth.
- `DISCORD_WEBHOOK_URL` — alerts/notifications.
- `CORS_ORIGIN` — extra allowed origins (prod domains are also hardcoded in
  `server/index.ts`).

`NODE_ENV=production` and the `VITE_*` / `CORS_ORIGIN` values are already set via
`.replit` `[userenv.production]` / `[userenv.shared]`.

Quick check after deploy:
```
curl -s https://commissioner-command.replit.app/health
# expect HTTP 200 + JSON above. A 5xx/timeout means the process isn't up.
```

## Uptime monitoring (do this — it's the backstop + alerting)

A monitor hitting `/health` every 5 minutes gives you (a) an alert the moment
the site is actually down and (b) a periodic request that keeps the deployment
warm. I can't create the monitor for you (it needs your account), but here are
exact steps for either provider:

### UptimeRobot (free tier is enough)
1. Sign in at https://uptimerobot.com → **+ Add New Monitor**.
2. Monitor Type: **HTTP(s)**.
3. URL: `https://commissioner-command.replit.app/health`
4. Monitoring Interval: **5 minutes**.
5. (Optional, stricter) Under advanced/keyword settings choose **Keyword**,
   keyword `"status":"ok"`, alert when keyword **does not exist**.
6. Add an **Alert Contact** (email/SMS/Slack) and attach it to the monitor.

### Better Stack (Uptime)
1. Sign in at https://betterstack.com → **Uptime → Monitors → Create monitor**.
2. URL: `https://commissioner-command.replit.app/health`
3. Check frequency: **5 minutes** (3 min on paid if you want faster).
4. Expected status code **200**; optionally assert response contains
   `"status":"ok"`.
5. Set the **on-call / escalation** contact so you actually get paged.

> If you give me an UptimeRobot API key (or a Better Stack API token) I can
> create and configure the monitor for you via their API instead of you doing
> it in the UI.

## How to confirm it's fixed going forward

1. After the next deploy, hit `/health` — note `commit` and `uptimeSec`.
2. After the next Replit maintenance window, hit `/health` again **without**
   republishing. If `uptimeSec` is small (process restarted on its own) and you
   get a `200`, the auto-restart worked — no manual Publish needed.
3. Watch deploy logs for `server started` lines after a restart, and for
   `unhandledRejection (process kept alive)` entries — those are now survivable
   events instead of fatal ones.

## Second root cause — unbounded queries saturating the capped pools

Capping the pools (`server/db.ts` app pool, `server/index.ts` session pool)
fixed *too many connections*. But it exposed a second, subtler version of the
same "hangs every few hours, Publish fixes it" symptom — this time reported as
the browser console error:

```
[sc-auth] session check timed out — token preserved, retry 1/5
AbortError: signal is aborted without reason
```

That `AbortError` is the **client's** 25s timeout firing because `/api/sc-auth/me`
never responded. The server side:

- node-postgres puts **no timeout** on how long `pool.query()` waits for a free
  slot. (`connectionTimeoutMillis` only bounds *establishing* a new connection,
  not waiting for the pool.)
- So if even one query never returns — lock contention, a stuck/leaked
  transaction, a DB hiccup — it pins its pooled connection indefinitely. Once
  all `max` slots are pinned, **every** subsequent query queues forever, and
  every request that touches the DB hangs. `/me` is one of them → spinner.
- The vitals DB census (`pg=total/max_connections`) does **not** catch this: the
  app pool can be 10/10 saturated while Postgres only sees ~16/100 connections,
  so the old `PG_CONNECTIONS_HOT` warning never tripped.

**The fix (code):**

1. Per-query timeouts on both the app pool and the session pool
   (`statement_timeout`, `query_timeout`, `idle_in_transaction_session_timeout`,
   defaults 30s/30s/60s, env-tunable via `PG_STATEMENT_TIMEOUT_MS` /
   `PG_IDLE_TXN_TIMEOUT_MS`). Now a query that runs too long is aborted and its
   connection released — an indefinitely-held slot is structurally impossible.
   A failed query becomes a fast `500` (process stays up) instead of a site-wide
   hang.
2. `server/vitals.ts` now reports the **app pool** directly:
   `apppool=total/max(idle:.. wait:..)` and warns `APP_POOL_STARVED` the moment
   `waiting > 0`. A sustained `wait:` count in the deploy logs is the early
   signal that something is pinning connections — investigate that endpoint
   before it locks the site.

**How to confirm:** hit `/health/vitals` and check the `appPool` block — under
normal load `waiting` is `0`. If you ever see it climbing, the heartbeat will
also be logging `APP_POOL_STARVED` with the count.
