---
name: Express 5 wildcard crash
description: path-to-regexp v8 incompatibility that crashes Express 5 at startup
---

## The bug
Express 5.2.1 uses path-to-regexp v8 which REJECTS `"/{*path}"` and bare `"*"` string wildcards — the process crashes at startup before `httpServer.listen()` with a RegExpSyntaxError. Production shows 0-byte timeout on every request.

## Safe alternatives
- `app.use((req, res, next) => { ... })` — no path argument (matches everything)
- `app.use(/.*/, handler)` — regex wildcard

## Context
`server/vite.ts` still has `"/{*path}"` but only runs in dev mode (safe). `server/static.ts` was the production crash site — fixed to no-path middleware form.

**Why:** path-to-regexp v8 removed the `/{*name}` syntax that Express 4 accepted.
