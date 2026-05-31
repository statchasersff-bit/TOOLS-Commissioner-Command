import { cn } from "@/lib/utils";
import type { ValueLabel } from "@/lib/value-finder/types";
import { LABEL_TONE, LABEL_TONE_STYLES } from "@/lib/value-finder/types";

// Headline recommendation badge — colored by tone family (buy / sell / neutral).
export function ValueLabelBadge({
  label,
  className,
}: {
  label?: ValueLabel;
  className?: string;
}) {
  const l = label ?? "Insufficient Data";
  const tone = LABEL_TONE[l];
  return (
    <span
      data-testid={`vf-label-${l.replace(/\s+/g, "-").toLowerCase()}`}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap leading-none",
        LABEL_TONE_STYLES[tone],
        className,
      )}
    >
      {l}
    </span>
  );
}

export default ValueLabelBadge;
