---
name: ADP date-range cache miss
description: Why ADP Explorer shows "computing" spinner every morning and how the fallback fix works.
---

## The problem
The ADP Explorer "Last 30 days" date picker sets `endDate = today`. Each new
calendar day creates a new filterKey (e.g. `sd=2026-05-04|ed=2026-06-03`).
That exact key has never been computed before, so `getCachedAdp()` returns null,
the code fires a background compute, and returns `computing: true` immediately.
Users see a spinner and think the feature is broken rather than waiting 15-30s.

The prior day's snapshot (`sd=2026-05-03|ed=2026-06-02`) exists but has a
different key — so the stale-serve branch (`cached && rows.length > 0`) never
fires because `cached === null` for the new key.

## The fix (server/adp.ts `_getAdpFromDb`)
Added `findNearestDateRangeSnapshot(exactKey)` which:
1. Strips the `|sd=...|ed=...` segment from the exact key to get a static prefix.
2. Queries `adp_snapshots WHERE filter_key LIKE '<prefix>|sd=%|_ver=vN'` ordered by `computed_at DESC LIMIT 1`.
3. If found with rows, returns that snapshot as `stale: true` so the user
   sees real data instantly while the exact background compute runs.

This runs AFTER the `triggerBackgroundAdpCompute()` call, so the exact compute
is still kicked off and will replace the stale result on the next cache miss.

## Key numbers (2026-06-03 verification)
- 136 drafts pass the full `buildDraftWhere` for the failing filter combo.
- Snapshot `sd=2026-05-03|ed=2026-06-02` exists: 141 drafts / 422 rows.
- After fix: endpoint returns 424 rows / 169 drafts, `stale: true`, zero wait.

## Why
**Why:** FILTER_KEY_VERSION bumps and daily date-window shifts both create new
keys that have no snapshot yet. The stale-serve path only fires when the
EXACT key has a prior snapshot; this fallback covers the "never computed" case.

**How to apply:** If "computing" spinner reappears for date-range queries,
check whether `findNearestDateRangeSnapshot` finds a matching row. If the
LIKE pattern finds nothing (brand-new filter combo with NO prior date-range
snapshot), the first load still shows "computing" — that's acceptable.
