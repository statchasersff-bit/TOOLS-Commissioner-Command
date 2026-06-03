---
name: sc-auth/me hang root cause
description: Why /api/sc-auth/me hangs 25s in production and what fixed it
---

## The bug
`/api/sc-auth/me` made 4 sequential DB calls. Three of them (`getConnectedSleeper`, `getSubscriptionStatusForUser`, `getPreferences`) each used the main app pool (`db`, max=60). Background ADP crawlers saturate that pool; each call then waits up to `connectionTimeoutMillis` (10s) for a free slot. 4 × 10s = 40s > 25s frontend abort → AbortError "session check timed out".

## The fix (applied)
1. **server/appMode.ts** — `getSubscriptionStatusForUser` changed from `db` → `authDb` (dedicated auth pool, isolated from crawlers).
2. **server/scAuthRoutes.ts** — after `getUser`, the three independent lookups are now `Promise.all([getConnectedSleeper, getSubscriptionStatusForUser, getPreferences])`.
3. **server/db.ts** — `authPool.max` bumped 3 → 5 to handle 3 parallel queries per /me without pool contention.

**Why:** `scAuth.ts` already routes through `authDb` via its internal `getDb()`. `appMode.ts` was the outlier that still imported the main `db`.

**How to apply:** Any new function called from `/api/sc-auth/me` must use `authDb`/`authPool`, not the main `db`/`pool`.

## Second root cause (found after deploy confirmed fix wasn't enough)
The session middleware was mounted globally (`app.use(session(...))`), so ALL
160+ concurrent ADP requests each acquired a sessionPool slot (max=5) before
any route handler ran. This fully saturated the pool. `/me` requests then
waited for a session slot for the full 25s before the client aborted.

**Fix**: `app.use("/api/sc-auth", session(...))` — session now only runs on
`/api/sc-auth/*` routes. Plus guarded `req.session` access in `getAuthResult`
for callers on non-sc-auth paths.
