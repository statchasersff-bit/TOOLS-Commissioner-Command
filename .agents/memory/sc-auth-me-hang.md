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
