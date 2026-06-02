---
name: ADP pool exhaustion fix
description: Root cause and fix for the recurring production "spinning wheel / 500 on auth" outage caused by ADP endpoint overwhelming the DB pool.
---

## The problem
`getCachedAdp()` hits Postgres on **every** `/api/adp` request, even when a
snapshot exists in the DB. The SELECT (large JSON blob) takes **9–36 seconds**
under load. With multiple concurrent users at boot, all 40 pool connections are
occupied → auth, custom-values, and ingest-league 500 with
"timeout exceeded when trying to connect".

**Why:** The existing `inFlightAdpComputes` single-flight guard only covered the
*compute* path; the *DB read* path (`getCachedAdp`) had no coalescing at all.

## The fix (server/adp.ts)
1. **In-process memory cache** (`_adpMemCache`): serves `getAdp()` results from
   RAM for 5 minutes — zero DB calls per key per TTL window.
2. **Request coalescing** (`_adpInFlight`): concurrent requests for the same
   cold key share one DB query (Promise dedup), not N separate connections.
3. `invalidateAdpMemCache(key)` called from `refreshAdpSnapshot()` so the 6-hour
   scheduler immediately busts the RAM entry after writing a new snapshot.
4. **Startup delays**: `backfillLeagueScoring` delayed 45 s, `captureValueSnapshot`
   delayed 20 s to stop them competing with first-user traffic (belt + suspenders).

**Why invalidation matters:** without it, the scheduler could write a new snapshot
to Postgres but the memory cache would keep serving the old one for 5 more minutes.

## How to apply
Any future ADP query changes should preserve the memory cache layer. If you add
a new high-traffic read endpoint backed by a slow Postgres query, apply the same
pattern: in-process Map cache + Promise coalescing on the cold path.
