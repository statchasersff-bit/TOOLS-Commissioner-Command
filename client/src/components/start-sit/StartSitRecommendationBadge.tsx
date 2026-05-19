import { cn } from "@/lib/utils";
import type { StartSitRecommendation } from "@/lib/startSit";

const STYLES: Record<
  StartSitRecommendation,
  { bg: string; border: string; text: string; dot: string }
> = {
  "Strong Start": {
    bg: "bg-gradient-to-r from-[#d4af37]/20 to-emerald-500/15",
    border: "border-[#d4af37]/50",
    text: "text-[#fde68a]",
    dot: "bg-[#d4af37]",
  },
  Start: {
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  "Lean Start": {
    bg: "bg-blue-500/15",
    border: "border-blue-500/40",
    text: "text-blue-300",
    dot: "bg-blue-400",
  },
  "Toss-Up": {
    bg: "bg-white/[0.06]",
    border: "border-[#d4af37]/25",
    text: "text-white/70",
    dot: "bg-[#d4af37]/70",
  },
  Sit: {
    bg: "bg-rose-500/15",
    border: "border-rose-500/40",
    text: "text-rose-300",
    dot: "bg-rose-400",
  },
};

interface Props {
  recommendation: StartSitRecommendation;
  size?: "sm" | "md";
  bestStart?: boolean;
  className?: string;
}

export function StartSitRecommendationBadge({
  recommendation,
  size = "sm",
  bestStart = false,
  className,
}: Props) {
  const s = STYLES[recommendation];
  const sizeCls = size === "md"
    ? "text-[11px] px-3 py-1"
    : "text-[10px] px-2 py-0.5";
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wider",
          sizeCls,
          s.bg,
          s.border,
          s.text,
        )}
        data-testid={`recommendation-${recommendation.toLowerCase().replace(/[^a-z]/g, "-")}`}
      >
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", s.dot)} />
        {recommendation}
      </span>
      {bestStart && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-[#d4af37]/50 bg-[#d4af37]/15 text-[#fde68a] text-[9px] font-bold uppercase tracking-wider px-2 py-0.5"
          data-testid="badge-best-start"
        >
          ★ Best Start
        </span>
      )}
    </div>
  );
}
