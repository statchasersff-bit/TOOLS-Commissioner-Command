---
name: Crash-loop on transient network errors
description: Server crash-loop caused by narrow isBenignConnectionError not covering TCP/network error codes
---

## The bug
Server crashed intermittently causing all endpoints to return 502 simultaneously. Root cause: `isBenignConnectionError` in `server/index.ts` only covered `ECONNABORTED` and "request.aborted". Background jobs (ADP snapshot refresh, outbound HTTP) throw `ETIMEDOUT` / `ENETUNREACH` when Replit's network blips. These escaped as `uncaughtException` → `process.exit(1)` → supervisor restart → 10-30s total outage window.

## The fix (applied)
Expanded `isBenignConnectionError` to a `BENIGN_NETWORK_CODES` Set covering:
`ECONNABORTED, ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENETUNREACH, EHOSTUNREACH, ENOTFOUND, EAI_AGAIN, EPIPE, ENOENT`
Plus message-based matches: "socket hang up", "socket closed", "write after end", "aborted", "HPE_INVALID_CHUNK_EXTENSION".

**Why:** These TCP-layer errors don't corrupt process state. Killing the server on them is strictly worse than logging + continuing.

**How to apply:** When adding new error codes to the benign list, confirm they can't leave Node.js state undefined (logic errors like TypeError should still exit; network errors should not).
