import { cn } from "@/lib/utils";
import { SIGNAL_STYLES, type MarketSignal, type MarketTone } from "@/lib/market/marketSignals";

/** Small colored pill for a buy/sell signal. */
export function MarketSignalBadge({
  signal,
  tone,
  className,
}: {
  signal?: MarketSignal;
  tone?: MarketTone;
  className?: string;
}) {
  if (!signal) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap",
        SIGNAL_STYLES[tone ?? "neutral"],
        className,
      )}
    >
      {signal}
    </span>
  );
}
