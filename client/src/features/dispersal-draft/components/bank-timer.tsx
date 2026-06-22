import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { computeEffectiveElapsedSeconds, isInPauseWindow } from "@dispersal/lib/pause-window";

function formatBank(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function computeRemaining(
  bankSeconds: number,
  turnStartedAt: string | null,
  pauseStart: string | null | undefined,
  pauseEnd: string | null | undefined,
  pauseTimezone: string | null | undefined,
): number {
  if (!turnStartedAt) return bankSeconds;
  const elapsed = computeEffectiveElapsedSeconds(
    new Date(turnStartedAt).getTime(),
    Date.now(),
    pauseStart,
    pauseEnd,
    pauseTimezone,
  );
  return Math.max(0, bankSeconds - elapsed);
}

interface BankTimerProps {
  /** The participant's current time-bank balance in seconds */
  bankSeconds: number;
  /**
   * ISO timestamp when the current turn started.
   * Pass the room's currentTurnStartedAt ONLY when this participant is on the clock
   * and the draft is active. Pass null for everyone else — their bank shows statically.
   */
  turnStartedAt: string | null;
  isOnClock: boolean;
  /** Daily pause window start, e.g. "23:00" */
  pauseStart?: string | null;
  /** Daily pause window end, e.g. "08:00" */
  pauseEnd?: string | null;
  /** IANA timezone for the pause window, e.g. "America/New_York" */
  pauseTimezone?: string | null;
  /** "header" = large top-bar badge, "order" = small order-panel badge, "board" = column-header badge */
  variant?: "header" | "order" | "board";
  className?: string;
}

export function BankTimer({
  bankSeconds,
  turnStartedAt,
  isOnClock,
  pauseStart,
  pauseEnd,
  pauseTimezone,
  variant = "order",
  className,
}: BankTimerProps) {
  const paused = isOnClock && isInPauseWindow(Date.now(), pauseStart, pauseEnd, pauseTimezone);

  const [rem, setRem] = useState(() =>
    computeRemaining(bankSeconds, turnStartedAt, pauseStart, pauseEnd, pauseTimezone),
  );

  useEffect(() => {
    setRem(computeRemaining(bankSeconds, turnStartedAt, pauseStart, pauseEnd, pauseTimezone));
    // Don't tick during a pause window — timer is frozen
    if (!turnStartedAt || paused) return;
    const id = setInterval(() => {
      const inWindow = isInPauseWindow(Date.now(), pauseStart, pauseEnd, pauseTimezone);
      if (!inWindow) {
        setRem(computeRemaining(bankSeconds, turnStartedAt, pauseStart, pauseEnd, pauseTimezone));
      }
    }, 500);
    return () => clearInterval(id);
  }, [bankSeconds, turnStartedAt, pauseStart, pauseEnd, pauseTimezone, paused]);

  // Pause-window display
  if (paused) {
    const sizeCls =
      variant === "header"
        ? "font-mono text-sm font-bold px-2 py-0.5 rounded border"
        : variant === "board"
        ? "inline-flex items-center gap-1 font-mono text-xs font-bold px-1.5 py-0.5 rounded-sm border"
        : "shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-sm border";
    return (
      <span
        className={cn(
          sizeCls,
          "text-blue-600 dark-any:text-blue-400 border-blue-500/30 bg-blue-500/10",
          className,
        )}
        title="Timer paused during quiet hours"
      >
        {variant === "board" ? "🌙 PAUSED" : variant === "header" ? "🌙 QUIET" : "🌙"}
      </span>
    );
  }

  const empty = rem <= 0;
  const low = rem < 60 && !empty;

  const colorCls = empty
    ? "text-destructive border-destructive/40 bg-destructive/10 animate-pulse"
    : low
    ? "text-amber-600 dark-any:text-amber-400 border-amber-500/30 bg-amber-500/10"
    : isOnClock
    ? "text-primary border-primary/30 bg-primary/10"
    : "text-muted-foreground/50 border-border/30 bg-transparent";

  const sizeCls =
    variant === "header"
      ? "font-mono text-sm font-bold px-2 py-0.5 rounded border"
      : variant === "board"
      ? "inline-flex items-center gap-1 font-mono text-xs font-bold px-1.5 py-0.5 rounded-sm border"
      : "shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-sm border";

  return (
    <span className={cn(sizeCls, colorCls, className)}>
      {variant === "board" && "⏱ "}
      {empty ? (variant === "header" ? "EXPIRED" : "0:00") : formatBank(rem)}
    </span>
  );
}
