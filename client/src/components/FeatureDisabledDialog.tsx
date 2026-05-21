import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

export class FeatureDisabledError extends Error {
  constructor(message = "Feature currently disabled") {
    super(message);
    this.name = "FeatureDisabledError";
  }
}

let openHandler: (() => void) | null = null;

/**
 * Imperatively open the "Feature currently disabled" dialog.
 * Safe to call from non-React code (e.g. API service layer).
 * No-op if the host hasn't mounted yet.
 */
export function showFeatureDisabled(): void {
  openHandler?.();
}

/**
 * Mount once at the app root. Registers the imperative open handler.
 */
export function FeatureDisabledDialogHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    openHandler = () => setOpen(true);
    return () => { openHandler = null; };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm" data-testid="dialog-feature-disabled">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#d4af37]" />
            Feature currently disabled
          </DialogTitle>
          <DialogDescription>
            This feature is temporarily disabled. Please check back soon.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} data-testid="btn-feature-disabled-ok">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
