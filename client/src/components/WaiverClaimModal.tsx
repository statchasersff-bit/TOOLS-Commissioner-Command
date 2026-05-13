/**
 * WaiverClaimModal
 *
 * Review-and-confirm modal for Sleeper waiver claims.
 * Shows the full claim summary (Add / Drop / Bid / League) before submitting.
 * Calls submitWaiverClaim() only after the user explicitly confirms.
 * On success, refetches pending waivers and calls onSuccess().
 *
 * If JWT is missing or expired, shows a Connect prompt rather than a generic error.
 * Use onConnectRequired to wire up opening the SleeperAuthCard modal.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PlusCircle,
  MinusCircle,
  DollarSign,
  Trophy,
  ShieldAlert,
} from "lucide-react";
import {
  submitWaiverClaim,
  fetchLeagueTransactionsFiltered,
  type SleeperTransaction,
  type SleeperWaiverClaimResult,
} from "@/services/sleeperAuthedApi";

export interface WaiverPlayer {
  id: string;
  name: string;
  position?: string;
  team?: string;
}

export interface WaiverClaimModalProps {
  open: boolean;
  onClose: () => void;

  leagueId: string;
  leagueName: string;
  rosterId: number;

  addPlayers: WaiverPlayer[];
  dropPlayers: WaiverPlayer[];
  waiverBid: number;

  /** Called with the API result after a successful submit */
  onSuccess?: (result: SleeperWaiverClaimResult, pendingWaivers: SleeperTransaction[]) => void;

  /**
   * Called when the user clicks "Connect Sleeper" after an auth error.
   * Wire this to open the SleeperAuthCard dialog so they can connect.
   */
  onConnectRequired?: () => void;
}

type SubmitState = "idle" | "submitting" | "success" | "error" | "needs-auth";

function isAuthError(message: string): boolean {
  return message.toLowerCase().includes("connect your sleeper account");
}

export function WaiverClaimModal({
  open,
  onClose,
  leagueId,
  leagueName,
  rosterId,
  addPlayers,
  dropPlayers,
  waiverBid,
  onSuccess,
  onConnectRequired,
}: WaiverClaimModalProps) {
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [result, setResult] = useState<SleeperWaiverClaimResult | null>(null);

  function handleClose() {
    setSubmitState("idle");
    setErrorMessage("");
    setResult(null);
    onClose();
  }

  async function handleSubmit() {
    setSubmitState("submitting");
    setErrorMessage("");

    try {
      const claimResult = await submitWaiverClaim(
        leagueId,
        rosterId,
        addPlayers.map((p) => p.id),
        dropPlayers.map((p) => p.id),
        waiverBid
      );

      // Refetch pending waivers after successful submit (non-fatal if it fails)
      let pendingWaivers: SleeperTransaction[] = [];
      try {
        pendingWaivers = await fetchLeagueTransactionsFiltered(
          leagueId,
          ["waiver"],
          undefined,
          ["pending"]
        );
      } catch {
        // Claim succeeded — refetch failure is non-fatal
      }

      setResult(claimResult);
      setSubmitState("success");
      onSuccess?.(claimResult, pendingWaivers);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (isAuthError(msg)) {
        setSubmitState("needs-auth");
      } else {
        setSubmitState("error");
        setErrorMessage(msg);
      }
    }
  }

  function handleConnectClick() {
    handleClose();
    onConnectRequired?.();
  }

  const isSubmitting = submitState === "submitting";
  const isSuccess = submitState === "success";
  const needsAuth = submitState === "needs-auth";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="max-w-md bg-[#0d1117] border border-white/10 text-white"
        data-testid="waiver-claim-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white">
            {isSuccess
              ? "Waiver Claim Submitted"
              : needsAuth
              ? "Connect Sleeper Account"
              : "Review Waiver Claim"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Success state ─────────────────────────────────────────────────── */}
        {isSuccess && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="text-sm text-white/70">
              Your waiver claim has been submitted to Sleeper.
            </p>
            {result && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-400 text-xs"
              >
                Status: {result.status}
              </Badge>
            )}
            <Button
              className="mt-2 w-full bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
              onClick={handleClose}
              data-testid="waiver-modal-done"
            >
              Done
            </Button>
          </div>
        )}

        {/* ── Needs auth state ──────────────────────────────────────────────── */}
        {needsAuth && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-14 h-14 rounded-full bg-[#0b3a7a]/20 flex items-center justify-center ring-1 ring-[#0b3a7a]/30">
              <ShieldAlert className="h-7 w-7 text-blue-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                Sleeper account not connected
              </p>
              <p className="text-xs text-white/50 leading-snug">
                Connect your Sleeper account to submit waiver claims and other
                league actions.
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                className="flex-1 border-white/20 text-white/60 hover:bg-white/5"
                onClick={handleClose}
                data-testid="waiver-modal-cancel-auth"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white font-semibold"
                onClick={handleConnectClick}
                data-testid="waiver-modal-connect-sleeper"
              >
                Connect Sleeper
              </Button>
            </div>
          </div>
        )}

        {/* ── Review + error state ──────────────────────────────────────────── */}
        {!isSuccess && !needsAuth && (
          <>
            {/* League */}
            <div className="flex items-center gap-2 text-sm text-white/60 pb-1">
              <Trophy className="h-4 w-4 text-[#d4af37]" />
              <span className="font-medium text-white">{leagueName}</span>
            </div>

            <Separator className="bg-white/10" />

            {/* Add players */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
                Add
              </p>
              {addPlayers.length === 0 ? (
                <p className="text-sm text-white/40 italic">None</p>
              ) : (
                addPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2"
                    data-testid={`waiver-add-${p.id}`}
                  >
                    <PlusCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-sm font-medium text-white">{p.name}</span>
                    {(p.position || p.team) && (
                      <span className="text-xs text-white/40">
                        {[p.position, p.team].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Drop players */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-2">
                Drop
              </p>
              {dropPlayers.length === 0 ? (
                <p className="text-sm text-white/40 italic">None</p>
              ) : (
                dropPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2"
                    data-testid={`waiver-drop-${p.id}`}
                  >
                    <MinusCircle className="h-4 w-4 text-rose-400 shrink-0" />
                    <span className="text-sm font-medium text-white">{p.name}</span>
                    {(p.position || p.team) && (
                      <span className="text-xs text-white/40">
                        {[p.position, p.team].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Bid */}
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[#d4af37]" />
              <span className="text-sm text-white/60">Bid:</span>
              <span className="text-sm font-semibold text-white">
                {waiverBid > 0 ? `$${waiverBid}` : "No bid (waiver order)"}
              </span>
            </div>

            <Separator className="bg-white/10" />

            {/* Error */}
            {submitState === "error" && (
              <div className="flex items-start gap-2 rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-300">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                className="border-white/20 text-white/60 hover:bg-white/5"
                onClick={handleClose}
                disabled={isSubmitting}
                data-testid="waiver-modal-cancel"
              >
                Cancel
              </Button>
              <Button
                className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold min-w-[120px]"
                onClick={handleSubmit}
                disabled={isSubmitting || addPlayers.length === 0}
                data-testid="waiver-modal-confirm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit Claim"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
