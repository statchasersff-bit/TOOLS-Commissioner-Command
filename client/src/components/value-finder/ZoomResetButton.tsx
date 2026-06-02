import { ZoomOut } from "lucide-react";

// Floating "Reset zoom" control shown over a chart once a box-zoom is applied.
// The parent must be positioned (relative) for the absolute placement to anchor.
export function ZoomResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] font-semibold text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      data-testid="vf-zoom-reset"
    >
      <ZoomOut className="h-3 w-3" /> Reset zoom
    </button>
  );
}

export default ZoomResetButton;
