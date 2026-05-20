/**
 * Singleton premium-lock modal. Mount `<WriteAccessModalProvider>` once
 * at the app root; any component can call `useWriteAccessModal().openModal(state)`
 * to surface the appropriate locked-state copy + CTA.
 *
 * Why a context-managed singleton instead of inline modals: write buttons
 * exist all over the app (Send Trade, Submit Waiver, Bulk Trade, …) and
 * we want one consistent modal regardless of which one was clicked.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, ExternalLink, LogIn, CreditCard, Key } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getWriteAccessUrl } from "@/lib/appMode";
import type { WriteAccessState } from "@/lib/writeAccessState";

interface WriteAccessModalContextValue {
  openModal: (state: WriteAccessState) => void;
  closeModal: () => void;
}

const WriteAccessModalContext = createContext<WriteAccessModalContextValue | null>(null);

export function useWriteAccessModal(): WriteAccessModalContextValue {
  const ctx = useContext(WriteAccessModalContext);
  if (!ctx) throw new Error("useWriteAccessModal must be used within WriteAccessModalProvider");
  return ctx;
}

export function WriteAccessModalProvider({ children }: { children: ReactNode }) {
  const [activeState, setActiveState] = useState<WriteAccessState | null>(null);
  const openModal = useCallback((s: WriteAccessState) => setActiveState(s), []);
  const closeModal = useCallback(() => setActiveState(null), []);

  const value = useMemo(() => ({ openModal, closeModal }), [openModal, closeModal]);

  return (
    <WriteAccessModalContext.Provider value={value}>
      {children}
      <PremiumLockModal state={activeState} onClose={closeModal} />
    </WriteAccessModalContext.Provider>
  );
}

interface ModalCopy {
  Icon: typeof Lock;
  title: string;
  body: string;
  cta: { label: string; href?: string; action?: "login" | "subscribe" | "connect-sleeper" };
}

const COPY: Record<Exclude<WriteAccessState, "UNLOCKED">, ModalCopy> = {
  PUBLIC_LOCKED: {
    Icon: Lock,
    title: "Dynasty Command Pro feature",
    body:
      "Send Trade, Submit Waiver, Bulk Trade, and other write actions are part of Dynasty Command Pro. " +
      "Read-only analysis tools remain free at statchasers.com.",
    cta: { label: "Open Pro Version", href: getWriteAccessUrl() },
  },
  WRONG_DOMAIN: {
    Icon: Lock,
    title: "Dynasty Command Pro feature",
    body:
      "Write actions live on the paid Dynasty Command domain. Click below to open Pro and continue.",
    cta: { label: "Open Pro Version", href: getWriteAccessUrl() },
  },
  NEEDS_LOGIN: {
    Icon: LogIn,
    title: "Log in to unlock write access",
    body: "Sign in to your Dynasty Command account to submit trades, waivers, and other Sleeper actions.",
    cta: { label: "Log In", action: "login" },
  },
  NEEDS_SUBSCRIPTION: {
    Icon: CreditCard,
    title: "Write access requires an active subscription",
    body:
      "Upgrade to Dynasty Command Pro to enable trade submission, bulk actions, and waiver claims.",
    cta: { label: "Upgrade", action: "subscribe" },
  },
  NEEDS_SLEEPER_CONNECTION: {
    Icon: Key,
    title: "Connect Sleeper to submit actions",
    body:
      "We need your Sleeper authentication to submit on your behalf. The token is stored encrypted and never logged.",
    cta: { label: "Connect Sleeper", action: "connect-sleeper" },
  },
};

function PremiumLockModal({ state, onClose }: { state: WriteAccessState | null; onClose: () => void }) {
  const { isAuthenticatedUser } = useAuth();
  const open = state !== null && state !== "UNLOCKED";
  const copy = open ? COPY[state as Exclude<WriteAccessState, "UNLOCKED">] : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid={`write-access-modal-${state ?? "closed"}`}>
        {copy && (
          <>
            <DialogHeader>
              <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 mx-auto flex items-center justify-center border border-[#d4af37]/30 mb-3">
                <copy.Icon className="w-6 h-6 text-[#d4af37]" />
              </div>
              <DialogTitle className="text-center">{copy.title}</DialogTitle>
              <DialogDescription className="text-center text-sm leading-relaxed pt-1">
                {copy.body}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <CtaButton copy={copy} authenticated={isAuthenticatedUser} onClose={onClose} />
              <Button variant="outline" onClick={onClose} data-testid="button-write-modal-close">
                Maybe later
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CtaButton({ copy, authenticated, onClose }: { copy: ModalCopy; authenticated: boolean; onClose: () => void }) {
  // Domain-locked states use an external link to the paid domain.
  if (copy.cta.href) {
    return (
      <Button asChild className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold" data-testid="button-write-modal-cta">
        <a href={copy.cta.href} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="w-4 h-4 mr-1.5" />
          {copy.cta.label}
        </a>
      </Button>
    );
  }
  // In-app actions (login, subscribe, connect Sleeper). Wire to existing
  // flows where present; for now the CTA closes the modal so the user
  // can take the next step from the normal nav. This intentionally avoids
  // reinventing the flows here — each has its own dedicated entry point
  // already (UpgradeFlow / ConnectSleeper / Billing).
  const _ = authenticated; // surface dependency, may be used later
  return (
    <Button
      onClick={onClose}
      className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold"
      data-testid="button-write-modal-cta"
    >
      {copy.cta.label}
    </Button>
  );
}
