/**
 * DraftPickConfirmModal — final-confirm step before firing the
 * server-mediated draft pick mutation.
 *
 * Shows player + pick context, fires `submitDraftPick`, and surfaces
 * Sleeper's response (or a typed error) back to the parent via onSuccess
 * / onError. The parent is responsible for refreshing the board.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Trophy } from "lucide-react";
import { submitDraftPick, DraftPickApiError, type DraftPickResponse } from "@/services/draftPickApi";

export interface DraftPickTarget {
  draftId: string;
  draftName?: string;
  pickNo: number;
  /** "R.PP" — e.g. "4.05" — for the header. */
  pickLabel: string;
  player: {
    playerId: string;
    name: string;
    pos: string;
    team?: string | null;
  };
}

export function DraftPickConfirmModal({
  target,
  open,
  onClose,
  onSuccess,
}: {
  target: DraftPickTarget | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (response: DraftPickResponse) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const handleSubmit = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitDraftPick({
        draftId: target.draftId,
        playerId: target.player.playerId,
        pickNo: target.pickNo,
      });
      onSuccess(result);
    } catch (err) {
      const apiErr = err instanceof DraftPickApiError
        ? { code: err.code, message: err.message }
        : { code: "UNKNOWN_ERROR", message: (err as Error)?.message ?? "Failed to submit pick." };
      setError(apiErr);
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md" data-testid="draft-pick-confirm-modal">
        {target && (
          <>
            <DialogHeader>
              <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 mx-auto flex items-center justify-center border border-[#d4af37]/30 mb-2">
                <Trophy className="w-6 h-6 text-[#d4af37]" />
              </div>
              <DialogTitle className="text-center" data-testid="text-draft-pick-title">
                Draft {target.player.name} at {target.pickLabel}?
              </DialogTitle>
              <DialogDescription className="text-center text-xs pt-1">
                {target.player.pos}
                {target.player.team ? ` · ${target.player.team}` : ""}
                {target.draftName ? <span className="block mt-1 text-muted-foreground">{target.draftName}</span> : null}
                <span className="block mt-0.5 text-[10px] text-muted-foreground/70 font-mono">
                  Pick #{target.pickNo}
                </span>
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div
                className="rounded-md border border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400 text-xs p-3 flex items-start gap-2"
                data-testid="text-draft-pick-error"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <div>
                  <p className="font-semibold">{error.message}</p>
                  <p className="text-[10px] opacity-70 mt-0.5 font-mono">{error.code}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 justify-end pt-1">
              <Button
                variant="outline"
                onClick={close}
                disabled={submitting}
                data-testid="button-draft-pick-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold"
                data-testid="button-draft-pick-confirm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Drafting…
                  </>
                ) : (
                  <>
                    <Trophy className="w-4 h-4 mr-1.5" />
                    Draft Player
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
