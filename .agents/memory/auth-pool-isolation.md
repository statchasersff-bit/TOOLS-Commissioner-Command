---
name: Auth pool isolation
description: Why login/me get their own dedicated Postgres pool separate from the main app pool
---

## Rule
`server/scAuth.ts` uses `authDb` (from `server/db.ts`) — a dedicated 3-connection pool — NOT the shared `db` pool used by background jobs.

## Why
The main pool (max=40) is shared with ADP crawlers, value snapshots, player news ingest, and trade ingestion — all running on `setInterval` timers. When those saturate the pool, login/me queue behind them, wait the full `connectionTimeoutMillis` (10s), then return a 500. Users see "Login failed" / spinner stuck.

Same structural fix already used for the session store (its own 5-connection pool in `server/index.ts`).

## How to apply
- Auth queries (login, /me, register, password reset, connected-sleeper): use `authDb` / `authPool` from `server/db.ts`
- Everything else: use `db` / `pool` from `server/db.ts`
- `authPool.connectionTimeoutMillis = 4000` (short, fail fast vs. 10s for main pool)
- `authPool.max = 3` (login + /me + register rarely concurrent)
