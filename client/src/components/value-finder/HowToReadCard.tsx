import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Collapsible "How to read this" helper — keeps each tab scannable while the
// explanation stays one tap away. Defaults open on first paint so new users get
// context, but folds away cleanly.
export function HowToReadCard({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <p className="px-3 pb-2.5 text-[12px] text-muted-foreground leading-snug">{children}</p>
      )}
    </div>
  );
}

export default HowToReadCard;
