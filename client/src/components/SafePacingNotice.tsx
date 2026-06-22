/**
 * SafePacingNotice — single source of UX copy that explains why bulk Sleeper
 * actions are submitted gradually. Renders three states:
 *
 *   variant="idle"      — explanation before the queue starts.
 *   variant="active"    — status line while a queue is running.
 *   variant="cooldown"  — rate-limit / cooldown notice.
 *   variant="kill"      — global writes-disabled message.
 *
 * Drop into any bulk-action surface so users understand the tool is being
 * cautious, not slow or broken.
 */

import { Info, ShieldAlert, RefreshCw, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { KILL_SWITCH_MESSAGE } from "@/services/sleeperSafetyGate";

export type SafePacingVariant = "idle" | "active" | "cooldown" | "kill";

interface Props {
  variant?: SafePacingVariant;
  /** Optional one-line status, e.g. "Pacing the next claim (≈42s)…". */
  message?: string;
  /** Optional batch-size hint — when present, adds the "may take several minutes" line. */
  batchSize?: number;
  className?: string;
}

export function SafePacingNotice({
  variant = "idle",
  message,
  batchSize,
  className,
}: Props) {
  const long = typeof batchSize === "number" && batchSize >= 8;

  if (variant === "kill") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px]",
          "border-rose-500/30 bg-rose-500/8 text-rose-200",
          className,
        )}
        role="alert"
        data-testid="safe-pacing-notice-kill"
      >
        <OctagonAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
        <span>{KILL_SWITCH_MESSAGE}</span>
      </div>
    );
  }

  if (variant === "cooldown") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px]",
          "border-amber-500/30 bg-amber-500/8 text-amber-200",
          className,
        )}
        role="status"
        data-testid="safe-pacing-notice-cooldown"
      >
        <ShieldAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
        <span>
          {message ??
            "Sleeper is temporarily rate-limiting requests. Actions are continuing slowly to protect your account."}
        </span>
      </div>
    );
  }

  if (variant === "active") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px]",
          "border-white/10 bg-white/[0.03] text-white/70",
          className,
        )}
        role="status"
        data-testid="safe-pacing-notice-active"
      >
        <RefreshCw className="w-3.5 h-3.5 mt-px flex-shrink-0 text-[#d4af37] animate-spin" />
        <span>{message ?? "Submitting safely, pacing actions like a real user…"}</span>
      </div>
    );
  }

  // variant === "idle"
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px]",
        "border-white/10 bg-white/[0.025] text-white/65",
        className,
      )}
      data-testid="safe-pacing-notice-idle"
    >
      <Info className="w-3.5 h-3.5 mt-px flex-shrink-0 text-[#d4af37]" />
      <span>
        Actions are intentionally submitted gradually to help protect your Sleeper account and avoid rate limits.
        {long && (
          <>
            {" "}
            <span className="text-white/45">
              Large batches may take several minutes because Commissioner Command spaces out actions like a real user would.
            </span>
          </>
        )}
      </span>
    </div>
  );
}
