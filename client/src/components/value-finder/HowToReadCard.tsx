import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// Collapsible "How to read this" helper — keeps each tab scannable while the
// explanation stays one tap away. Defaults open on desktop so new users get
// context, but on mobile it starts collapsed (a "Tap to expand" hint) so it
// doesn't push the chart below the fold.
export function HowToReadCard({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const isMobile = useIsMobile();
  // Open by default only on desktop; mobile starts folded regardless.
  const [open, setOpen] = useState(defaultOpen && !isMobile);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        data-testid="vf-how-to-read"
      >
        <span className="flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" />
          How to read this
        </span>
        <span className="flex items-center gap-2">
          {!open && (
            <span className="sm:hidden text-[10px] font-medium normal-case tracking-normal text-muted-foreground/70">
              Tap to expand
            </span>
          )}
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <p className="px-3 pb-2.5 text-[12px] text-muted-foreground leading-snug">{children}</p>
      )}
    </div>
  );
}

export default HowToReadCard;
