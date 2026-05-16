/**
 * Optimize Queue — centralized queue manager for bulk Sleeper write operations.
 *
 * Designed to be reusable for: bulk lineup optimization, bulk waivers,
 * bulk trades, bulk DMs, and other sequential Sleeper actions.
 *
 * Safety rules:
 * - Sequential processing only (never Promise.all)
 * - Dynamic delay scaling based on completed count
 * - Auto-retry once per item on failure
 * - Pause / Resume / Cancel supported at any point
 * - JWT is NEVER logged
 */

import { useState, useRef, useCallback } from "react";
import { submitLineup } from "@/services/sleeperAuthedApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimizeQueueItem {
  leagueId: string;
  leagueName: string;
  avatar?: string | null;
  rosterId: number;
  optimalStarters: string[];
  swapCount: number;
  projGain: number;
  status: "pending" | "processing" | "done" | "failed";
  error?: string;
}

export interface QueueSummary {
  optimized: number;
  failed: number;
  skipped: number;
}

export type QueueStatus = "idle" | "running" | "paused" | "done";

// ─── Delay scaling ────────────────────────────────────────────────────────────
//   completedCount: how many items have already been processed
//   leagues 1–5   → 5–10 s
//   leagues 6–10  → 20–45 s
//   leagues 11–20 → 60–120 s
//   20+           → 120–240 s

export function computeDelay(completedCount: number): number {
  const r = Math.random();
  if (completedCount < 5)  return Math.floor((5   + r * 5)   * 1000);
  if (completedCount < 10) return Math.floor((20  + r * 25)  * 1000);
  if (completedCount < 20) return Math.floor((60  + r * 60)  * 1000);
  return                          Math.floor((120 + r * 120) * 1000);
}

export function estimateRemainingMs(completedCount: number, pendingCount: number): number {
  let ms = 0;
  for (let i = 0; i < pendingCount; i++) {
    const idx = completedCount + i;
    if (idx === 0)     ms += 1_500;
    else if (idx < 5)  ms += 7_500;
    else if (idx < 10) ms += 32_500;
    else if (idx < 20) ms += 90_000;
    else               ms += 180_000;
  }
  return ms;
}

export function fmtEta(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60)  return `~${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 60)  return `~${min}m`;
  return `~${Math.ceil(min / 60)}h`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOptimizeQueue() {
  const [items, setItemsRaw] = useState<OptimizeQueueItem[]>([]);
  const [qStatus, setQStatus] = useState<QueueStatus>("idle");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<QueueSummary | null>(null);

  // Refs give the async loop access to the latest values without closure issues
  const itemsRef    = useRef<OptimizeQueueItem[]>([]);
  const qStatusRef  = useRef<QueueStatus>("idle");
  const loopActive  = useRef(false);

  function setItems(updater: OptimizeQueueItem[] | ((p: OptimizeQueueItem[]) => OptimizeQueueItem[])) {
    setItemsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      itemsRef.current = next;
      return next;
    });
  }

  function patchItem(leagueId: string, patch: Partial<OptimizeQueueItem>) {
    setItems(prev => prev.map(i => i.leagueId === leagueId ? { ...i, ...patch } : i));
  }

  // ── Core processing loop ──────────────────────────────────────────────────

  const runLoop = useCallback(async () => {
    if (loopActive.current) return;
    loopActive.current = true;

    try {
      let completed = itemsRef.current.filter(
        i => i.status === "done" || i.status === "failed"
      ).length;

      outerLoop: while (true) {
        const st = qStatusRef.current;
        if (st === "idle" || st === "done") break;

        // ── Pause: poll until resumed or cancelled ──
        if (st === "paused") {
          await new Promise<void>(resolve => {
            const id = setInterval(() => {
              if (qStatusRef.current !== "paused") { clearInterval(id); resolve(); }
            }, 300);
          });
          continue;
        }

        // ── Find next pending item ──
        const item = itemsRef.current.find(i => i.status === "pending");
        if (!item) break;

        // ── Inter-league delay (skip delay before the very first item) ──
        if (completed > 0) {
          const delayMs = computeDelay(completed);
          const STEP    = 300;
          let elapsed   = 0;
          while (elapsed < delayMs) {
            const cur = qStatusRef.current;
            if (cur === "idle")   break outerLoop;
            if (cur === "paused") continue outerLoop; // handle pause → re-enter
            await new Promise(r => setTimeout(r, Math.min(STEP, delayMs - elapsed)));
            elapsed += STEP;
          }
          if (qStatusRef.current === "idle")   break;
          if (qStatusRef.current === "paused") continue;
        }

        // ── Submit lineup ──
        setProcessingId(item.leagueId);
        patchItem(item.leagueId, { status: "processing" });

        let ok      = false;
        let lastErr = "";

        // Attempt 1
        try {
          await submitLineup(item.leagueId, item.rosterId, item.optimalStarters);
          ok = true;
        } catch (e: any) {
          lastErr = e?.message || "Submission failed";
        }

        // Auto-retry once after a short pause
        if (!ok && qStatusRef.current !== "idle") {
          await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
          if ((qStatusRef.current as QueueStatus) !== "idle") {
            try {
              await submitLineup(item.leagueId, item.rosterId, item.optimalStarters);
              ok = true;
            } catch (e: any) {
              lastErr = e?.message || "Submission failed (retry)";
            }
          }
        }

        patchItem(item.leagueId, ok ? { status: "done" } : { status: "failed", error: lastErr });
        setProcessingId(null);
        completed++;
      }
    } finally {
      loopActive.current = false;
    }

    // Finalize if loop ran to completion naturally
    if (qStatusRef.current === "running") {
      qStatusRef.current = "done";
      setQStatus("done");
      const final = itemsRef.current;
      setSummary({
        optimized: final.filter(i => i.status === "done").length,
        failed:    final.filter(i => i.status === "failed").length,
        skipped:   final.filter(i => i.status === "pending").length,
      });
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────

  const start = useCallback((newItems: Omit<OptimizeQueueItem, "status">[]) => {
    const withStatus: OptimizeQueueItem[] = newItems.map(i => ({ ...i, status: "pending" }));
    itemsRef.current     = withStatus;
    qStatusRef.current   = "running";
    setItemsRaw(withStatus);
    setQStatus("running");
    setProcessingId(null);
    setSummary(null);
    runLoop();
  }, [runLoop]);

  const pause = useCallback(() => {
    if (qStatusRef.current === "running") {
      qStatusRef.current = "paused";
      setQStatus("paused");
    }
  }, []);

  const resume = useCallback(() => {
    if (qStatusRef.current === "paused") {
      qStatusRef.current = "running";
      setQStatus("running");
      if (!loopActive.current) runLoop(); // restart loop if it exited during pause
    }
  }, [runLoop]);

  const cancel = useCallback(() => {
    const prev = qStatusRef.current;
    qStatusRef.current = "idle";
    setQStatus("idle");
    setProcessingId(null);
    if (prev !== "idle") {
      const final = itemsRef.current;
      setSummary({
        optimized: final.filter(i => i.status === "done").length,
        failed:    final.filter(i => i.status === "failed").length,
        skipped:   final.filter(i => i.status === "pending" || i.status === "processing").length,
      });
    }
  }, []);

  const reset = useCallback(() => {
    qStatusRef.current = "idle";
    setQStatus("idle");
    itemsRef.current = [];
    setItemsRaw([]);
    setProcessingId(null);
    setSummary(null);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const completedCount = items.filter(i => i.status === "done" || i.status === "failed").length;
  const pendingCount   = items.filter(i => i.status === "pending" || i.status === "processing").length;

  return {
    items,
    qStatus,
    processingId,
    summary,
    totalCount:           items.length,
    completedCount,
    pendingCount,
    estimatedRemainingMs: estimateRemainingMs(completedCount, pendingCount),
    start,
    pause,
    resume,
    cancel,
    reset,
  };
}
