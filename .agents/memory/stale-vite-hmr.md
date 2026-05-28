---
name: Stale Vite HMR after checkpoint
description: Vite dev server serves old compiled modules after checkpoint/deployment merges new code, causing white screen or "app is starting" hang.
---

## The pattern
After a checkpoint is created or a task-agent merge lands while the dev server is running, Vite's HMR can get stuck serving the pre-merge compiled version of a file. Symptoms:
- "Your app is starting" screen that never resolves
- White screen in the preview pane
- Browser console shows `[vite] Failed to reload /src/...` for a file that looks correct on disk
- Vite logs show a parse/syntax error for code that no longer exists in the file

## Why
Vite caches compiled module graphs in memory. A checkpoint write-back can update files on disk without triggering a proper HMR invalidation, leaving the in-memory graph pointing at stale compiled output.

## How to apply
Whenever the user reports "stuck on starting screen" or a white screen immediately after a checkpoint/deployment, check logs first to confirm it's a Vite parse error on a file that looks correct on disk, then restart the workflow immediately — do not spend time editing the file.

**Why:** Editing the file to fix a "bug" that doesn't actually exist in the current source wastes time and introduces unnecessary diffs. The restart is the correct and complete fix.
