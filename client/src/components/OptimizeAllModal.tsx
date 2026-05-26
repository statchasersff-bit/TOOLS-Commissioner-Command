/**
 * OptimizeAllModal — Confirmation + live progress UI for bulk lineup optimization.
 *
 * Phase 1 (confirm): Shows leagues to be optimized, total count, auth check.
 * Phase 2 (progress): Live queue status with pause/resume/cancel + ETA.
 * Phase 3 (summary): Final results after completion or cancel.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Zap, CheckCircle2, XCircle, Loader2, Pause, Play, X,
  AlertTriangle, Clock, SkipForward, Users,
} from "lucide-react";
import type { OptimizeQueueItem, QueueSummary, QueueStatus } from "@/services/optimizeQueue";
import { fmtEta } from "@/services/optimizeQueue";
import { getSleeperSession } from "@/services/sleeperAuth";
import { preflightBatch, isWriteEnabled } from "@/services/sleeperSafetyGate";
import { SafePacingNotice } from "@/components/SafePacingNotice";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt1(n: number): string { return n.toFixed(1); }

function StatusIcon({ status }: { status: OptimizeQueueItem["status"] }) {
  if (status === "done")       return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
  if (status === "failed")     return <XCircle      className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
  if (status === "processing") return <Loader2      className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0 animate-spin" />;
  return <Clock className="w-3.5 h-3.5 text-white/20 flex-shrink-0" />;
}

// ─── Confirmation view ────────────────────────────────────────────────────────

function ConfirmView({
  leagues,
  nflWeek,
  onConfirm,
  onClose,
}: {
  leagues: Omit<OptimizeQueueItem, "status">[];
  nflWeek: number | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const session = getSleeperSession();
  const hasAuth = !!session?.token;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
        <div className="w-8 h-8 rounded-lg bg-[#d4af37]/15 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-[#d4af37]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black text-white">Optimize All Lineups</h2>
          <p className="text-[10px] text-white/40">Week {nflWeek ?? "—"} · {leagues.length} league{leagues.length !== 1 ? "s" : ""} need optimization</p>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Auth warning */}
      {!hasAuth && (
        <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/25 px-3.5 py-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-yellow-300">Authentication Required</p>
            <p className="text-[10px] text-yellow-300/60 mt-0.5">
              Connect your Sleeper account using the <span className="font-semibold">Connect Sleeper</span> button in the top navigation bar, then try again.
            </p>
          </div>
        </div>
      )}

      {/* Safe pacing notice — set expectations about deliberate delays. */}
      <div className="mx-5 mt-4">
        {isWriteEnabled() ? (
          <SafePacingNotice variant="idle" batchSize={leagues.length} />
        ) : (
          <SafePacingNotice variant="kill" />
        )}
      </div>

      {/* League list */}
      <div className="px-5 py-4 space-y-2 max-h-72 overflow-y-auto">
        {leagues.map((l, i) => (
          <div
            key={l.leagueId}
            className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2.5"
            data-testid={`confirm-league-${l.leagueId}`}
          >
            <span className="text-[9px] font-bold text-white/20 w-4 tabular-nums flex-shrink-0">{i + 1}</span>
            {l.avatar ? (
              <img src={l.avatar} alt="" className="w-6 h-6 rounded-md object-cover flex-shrink-0"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-6 h-6 rounded-md bg-[#0b3a7a]/40 flex items-center justify-center flex-shrink-0">
                <Users className="w-3 h-3 text-blue-400/50" />
              </div>
            )}
            <span className="text-[12px] font-bold text-white/80 flex-1 truncate">{l.leagueName}</span>
            <span className="text-[10px] font-bold text-emerald-400 tabular-nums flex-shrink-0">
              +{fmt1(l.projGain)} pts
            </span>
            <span className="text-[9px] text-white/30 flex-shrink-0">
              {l.swapCount} swap{l.swapCount !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 pt-2 border-t border-white/6 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onClose}
          className="flex-1 border-white/12 text-white/50 hover:text-white/80">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const pre = preflightBatch({ action: "lineup", batchSize: leagues.length });
            if (!pre.ok) return;
            onConfirm();
          }}
          disabled={!hasAuth || !isWriteEnabled()}
          data-testid="button-confirm-optimize-all"
          className={cn(
            "flex-1 font-bold transition-all",
            hasAuth && isWriteEnabled()
              ? "bg-[#d4af37] hover:bg-[#c9a227] text-[#0b0e14]"
              : "opacity-40 cursor-not-allowed bg-white/10 text-white/40"
          )}
        >
          <Zap className="w-3.5 h-3.5 mr-1.5" />
          Start Optimizing {leagues.length} League{leagues.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </>
  );
}

// ─── Progress view ────────────────────────────────────────────────────────────

function ProgressView({
  items,
  qStatus,
  processingId,
  completedCount,
  totalCount,
  estimatedRemainingMs,
  summary,
  onPause,
  onResume,
  onCancel,
  onDone,
}: {
  items: OptimizeQueueItem[];
  qStatus: QueueStatus;
  processingId: string | null;
  completedCount: number;
  totalCount: number;
  estimatedRemainingMs: number;
  summary: QueueSummary | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const isDone      = qStatus === "done" || (summary !== null && qStatus === "idle");
  const isPaused    = qStatus === "paused";
  const isRunning   = qStatus === "running";
  const pct         = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const processingLeague = processingId
    ? items.find(i => i.leagueId === processingId)
    : null;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          isDone ? "bg-emerald-500/15" : "bg-[#d4af37]/15"
        )}>
          {isDone
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <Zap className={cn("w-4 h-4 text-[#d4af37]", isRunning && "animate-pulse")} />
          }
        </div>
        <div className="flex-1 min-w-0">
          {isDone ? (
            <>
              <h2 className="text-sm font-black text-white">Optimization Complete</h2>
              <p className="text-[10px] text-white/40">
                {summary?.optimized ?? 0} optimized · {summary?.failed ?? 0} failed · {summary?.skipped ?? 0} skipped
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-black text-white">
                {isPaused ? "Queue Paused" : `Optimizing ${completedCount + 1} of ${totalCount}…`}
              </h2>
              <p className="text-[10px] text-white/40">
                {isPaused
                  ? "Resume to continue processing"
                  : processingLeague
                    ? processingLeague.leagueName
                    : `ETA ${fmtEta(estimatedRemainingMs)}`
                }
              </p>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {!isDone && (
        <div className="px-5 pt-4 pb-2">
          <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: isPaused ? "#d4af37" : "#22c55e",
              }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] text-white/25">{completedCount} of {totalCount} done</span>
            {!isPaused && estimatedRemainingMs > 0 && (
              <span className="text-[9px] text-white/25">ETA {fmtEta(estimatedRemainingMs)}</span>
            )}
          </div>
        </div>
      )}

      {/* Active-pacing notice — keeps users from thinking the tool is stuck. */}
      {!isDone && isRunning && (
        <div className="px-5 pt-2">
          <SafePacingNotice
            variant="active"
            message="Submitting lineups safely. Dynasty Command spaces each push to avoid Sleeper rate limits."
          />
        </div>
      )}

      {/* Summary cards (done state) */}
      {isDone && summary && (
        <div className="px-5 pt-4 pb-2 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
            <p className="text-lg font-black text-emerald-400 tabular-nums">{summary.optimized}</p>
            <p className="text-[9px] text-emerald-400/60 font-semibold uppercase tracking-wide mt-0.5">Optimized</p>
          </div>
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-center">
            <p className="text-lg font-black text-red-400 tabular-nums">{summary.failed}</p>
            <p className="text-[9px] text-red-400/60 font-semibold uppercase tracking-wide mt-0.5">Failed</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 p-3 text-center">
            <p className="text-lg font-black text-white/40 tabular-nums">{summary.skipped}</p>
            <p className="text-[9px] text-white/25 font-semibold uppercase tracking-wide mt-0.5">Skipped</p>
          </div>
        </div>
      )}

      {/* League list */}
      <div className="px-5 py-3 space-y-1.5 max-h-64 overflow-y-auto">
        {items.map(item => (
          <div
            key={item.leagueId}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 border transition-colors",
              item.status === "done"       ? "bg-emerald-500/5 border-emerald-500/15" :
              item.status === "failed"     ? "bg-red-500/5 border-red-500/15" :
              item.status === "processing" ? "bg-[#d4af37]/8 border-[#d4af37]/20" :
                                             "bg-white/[0.02] border-white/5"
            )}
            data-testid={`queue-item-${item.leagueId}`}
          >
            <StatusIcon status={item.status} />
            {item.avatar ? (
              <img src={item.avatar} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-5 h-5 rounded bg-[#0b3a7a]/30 flex-shrink-0" />
            )}
            <span className="text-[11px] font-bold text-white/75 flex-1 truncate">{item.leagueName}</span>
            {item.status === "processing" && (
              <span className="text-[9px] font-bold text-[#d4af37]/70 flex-shrink-0 animate-pulse">Submitting…</span>
            )}
            {item.status === "done" && (
              <span className="text-[9px] font-bold text-emerald-400/70 flex-shrink-0">Done</span>
            )}
            {item.status === "failed" && item.error && (
              <span className="text-[9px] text-red-400/60 flex-shrink-0 truncate max-w-[100px]" title={item.error}>
                Error
              </span>
            )}
            {item.status === "pending" && (
              <span className="text-[9px] text-white/20 flex-shrink-0">Pending</span>
            )}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="px-5 pb-5 pt-3 border-t border-white/6">
        {isDone ? (
          <Button size="sm" onClick={onDone}
            className="w-full bg-[#d4af37] hover:bg-[#c9a227] text-[#0b0e14] font-bold"
            data-testid="button-queue-done">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Done
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {isPaused ? (
              <Button size="sm" onClick={onResume} data-testid="button-queue-resume"
                className="flex-1 bg-[#d4af37] hover:bg-[#c9a227] text-[#0b0e14] font-bold">
                <Play className="w-3.5 h-3.5 mr-1.5" /> Resume Queue
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onPause} data-testid="button-queue-pause"
                className="flex-1 border-white/15 text-white/60 hover:text-white/90">
                <Pause className="w-3.5 h-3.5 mr-1.5" /> Pause
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onCancel} data-testid="button-queue-cancel"
              className="flex-1 border-red-500/20 text-red-400/70 hover:text-red-400 hover:border-red-500/40">
              <SkipForward className="w-3.5 h-3.5 mr-1.5" /> Cancel Remaining
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface OptimizeAllModalProps {
  open: boolean;
  onClose: () => void;
  leaguesToOptimize: Omit<OptimizeQueueItem, "status">[];
  nflWeek: number | null;
  qStatus: QueueStatus;
  items: OptimizeQueueItem[];
  processingId: string | null;
  completedCount: number;
  totalCount: number;
  estimatedRemainingMs: number;
  summary: QueueSummary | null;
  onConfirm: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDone: () => void;
}

export function OptimizeAllModal({
  open,
  onClose,
  leaguesToOptimize,
  nflWeek,
  qStatus,
  items,
  processingId,
  completedCount,
  totalCount,
  estimatedRemainingMs,
  summary,
  onConfirm,
  onPause,
  onResume,
  onCancel,
  onDone,
}: OptimizeAllModalProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  if (!open) return null;

  const inProgress = qStatus === "running" || qStatus === "paused" ||
    qStatus === "done" || (summary !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={!inProgress ? onClose : undefined}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "linear-gradient(180deg, rgba(10,18,32,0.98) 0%, rgba(6,12,22,0.99) 100%)" }}
        data-testid="modal-optimize-all"
      >
        {inProgress ? (
          <ProgressView
            items={items}
            qStatus={qStatus}
            processingId={processingId}
            completedCount={completedCount}
            totalCount={totalCount}
            estimatedRemainingMs={estimatedRemainingMs}
            summary={summary}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            onDone={onDone}
          />
        ) : (
          <ConfirmView
            leagues={leaguesToOptimize}
            nflWeek={nflWeek}
            onConfirm={onConfirm}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
