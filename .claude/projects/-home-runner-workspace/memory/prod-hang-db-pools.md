---
name: prod-hang-db-pools
description: Root cause of recurring production "infinite loading spinner until republish" — Postgres connection-pool exhaustion
metadata:
  type: project
---

The published app (Reserved VM, `deploymentTarget = "vm"`, runs `npm run start`) periodically hangs on the loading spinner after running a while; a republish (fresh VM boot) temporarily fixes it.

**Root cause:** ~22 server modules each create their own `new pg.Pool({ connectionString })` with **no `max`**, so each defaults to 10 connections (~220 possible) on top of the connect-pg-simple session-store pool that is hit on *every* request. The database ceiling is `max_connections = 112` (confirmed via pg_stat_activity). Under production load + the production-only background crawler (`ENABLE_CRAWLER=true`, plus snapshot/ADP schedulers), total connections cross 112; new connection attempts then block, so the per-request session lookup hangs and the browser sits on the spinner forever. Fresh VM = fresh connections = works again.

**Monitoring added (2026-06-01):** `server/vitals.ts` + wiring in `server/index.ts`. Logs a `[vitals]` heartbeat every 60s (memory, event-loop lag, in-flight/hung requests, `pg=total/max`), warns with ⚠️ when pg ≥80% of max / loop lag / hung requests, and exposes `GET /health/vitals` JSON for an external uptime monitor. This catches/confirms saturation but does NOT fix it.

**Real fix (not yet done):** consolidate to a single shared pool with a sane `max`, or at minimum cap every pool's `max`. See [[news-ticker-rotowire-offseason]] for an unrelated finding from the same session.
