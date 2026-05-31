import { cn } from "@/lib/utils";
import type { ValueSignal } from "@/lib/value-finder/types";

// Brand-aligned, high-contrast badges. Greens for buys, red/orange for sells,
// muted gray for fair value / insufficient data.
const SIGNAL_STYLES: Record<ValueSignal, string> = {
  "Strong Buy":
    "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  Buy: "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/20",
  "Fair Value":
    "bg-muted/40 text-muted-foreground border-border",
  Sell: "bg-orange-500/10 text-orange-600 dark-any:text-orange-400 border-orange-500/25",
  "Strong Sell":
    "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
  "Insufficient Data":
    "bg-muted/20 text-muted-foreground/70 border-border/60",
};

const SHORT: Record<ValueSignal, string> = {
  "Strong Buy": "Strong Buy",
  Buy: "Buy",
  "Fair Value": "Fair",
  Sell: "Sell",
  "Strong Sell": "Strong Sell",
  "Insufficient Data": "No Data",
};

export function ValueSignalBadge({
  signal,
  className,
  compact = false,
}: {
  signal?: ValueSignal;
  className?: string;
  compact?: boolean;
}) {
  const s = signal ?? "Insufficient Data";
  return (
    <span
      data-testid={`vf-signal-${s.replace(/\s+/g, "-").toLowerCase()}`}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap leading-none",
        SIGNAL_STYLES[s],
        className,
      )}
    >
      {compact ? SHORT[s] : s}
    </span>
  );
}

export default ValueSignalBadge;
