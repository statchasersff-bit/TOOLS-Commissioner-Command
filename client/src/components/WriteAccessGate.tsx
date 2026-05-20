/**
 * WriteAccessGate — wraps any feature that performs a Sleeper write so the
 * UI never renders a button that the server will reject. Walks the same
 * checks the backend enforces, in the same order, and shows the
 * appropriate locked state when something is missing.
 *
 * Order of checks (matches server `requireWriteCapability`):
 *   1. Wrong domain  → "Available in Dynasty Command Pro" + Open Pro link
 *   2. Not logged in → "Log in to unlock write access" + Log In button
 *   3. No subscription → "Write access requires an active subscription" + Upgrade
 *   4. Sleeper not connected → "Connect Sleeper to submit trades and waivers"
 *   5. All good → render `children`
 *
 * Pass `compact` to render a small inline notice instead of a full card —
 * useful for inline action buttons that need a one-liner explanation
 * rather than a full takeover panel.
 */

import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, LogIn, ExternalLink, CreditCard, Key } from "lucide-react";
import { useAppMode } from "@/hooks/useAppMode";
import { useAuth } from "@/contexts/AuthContext";
import { UpgradeFlow } from "./UpgradeFlow";
import { getWriteAccessState, type WriteAccessState } from "@/lib/writeAccessState";

type LockReason = "wrong_domain" | "not_authenticated" | "no_subscription" | "no_sleeper_token";

function stateToLockReason(s: WriteAccessState): LockReason | null {
  switch (s) {
    case "UNLOCKED": return null;
    case "PUBLIC_LOCKED":
    case "WRONG_DOMAIN": return "wrong_domain";
    case "NEEDS_LOGIN": return "not_authenticated";
    case "NEEDS_SUBSCRIPTION": return "no_subscription";
    case "NEEDS_SLEEPER_CONNECTION": return "no_sleeper_token";
  }
}

export function WriteAccessGate({
  children,
  compact = false,
  fallback,
}: {
  children: ReactNode;
  /** Render an inline one-liner notice instead of the full card. */
  compact?: boolean;
  /** Optional custom render for the locked state. Receives the reason. */
  fallback?: (reason: LockReason) => ReactNode;
}) {
  const { writeAccessUrl, subscription } = useAppMode();
  const { isAuthenticatedUser, hasSleeperToken, appMode } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);

  const host = typeof window !== "undefined" ? window.location.hostname : null;
  const state = getWriteAccessState({
    appMode,
    host,
    isAuthenticated: isAuthenticatedUser,
    hasActiveSubscription: subscription.active,
    hasSleeperToken,
  });
  const reason = stateToLockReason(state);

  if (reason === null) return <>{children}</>;
  if (fallback) return <>{fallback(reason)}</>;

  // Upgrade flow takes over when the user clicks "Log In" on the
  // not-authenticated card. Closes back to the gate when done; once the
  // session updates, `reason` will recompute and unlock.
  if (showUpgrade && reason === "not_authenticated") {
    return <UpgradeFlow onDone={() => setShowUpgrade(false)} />;
  }

  return <LockedCard reason={reason} compact={compact} writeAccessUrl={writeAccessUrl} onLogin={() => setShowUpgrade(true)} />;
}

function LockedCard({
  reason,
  compact,
  writeAccessUrl,
  onLogin,
}: {
  reason: LockReason;
  compact: boolean;
  writeAccessUrl: string;
  onLogin: () => void;
}) {
  const copy = LOCK_COPY[reason];

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#d4af37]/40 bg-[#d4af37]/5 text-xs text-foreground"
        data-testid={`write-gate-compact-${reason}`}
      >
        <copy.Icon className="w-3.5 h-3.5 text-[#d4af37] shrink-0" />
        <span className="flex-1 leading-snug">{copy.title}</span>
        <LockAction reason={reason} writeAccessUrl={writeAccessUrl} onLogin={onLogin} compact />
      </div>
    );
  }

  return (
    <Card className="border-[#d4af37]/40" data-testid={`write-gate-${reason}`}>
      <CardContent className="py-10 px-6 text-center space-y-3 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 mx-auto flex items-center justify-center border border-[#d4af37]/30">
          <copy.Icon className="w-6 h-6 text-[#d4af37]" />
        </div>
        <h3 className="text-base font-bold text-foreground">{copy.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{copy.body}</p>
        <div className="pt-1">
          <LockAction reason={reason} writeAccessUrl={writeAccessUrl} onLogin={onLogin} compact={false} />
        </div>
      </CardContent>
    </Card>
  );
}

function LockAction({
  reason,
  writeAccessUrl,
  onLogin,
  compact,
}: {
  reason: LockReason;
  writeAccessUrl: string;
  onLogin: () => void;
  compact: boolean;
}) {
  const size = compact ? "sm" : "default";
  switch (reason) {
    case "wrong_domain":
      return (
        <Button asChild size={size} className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold">
          <a href={writeAccessUrl} target="_blank" rel="noopener noreferrer" data-testid="button-open-pro">
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Open Pro Version
          </a>
        </Button>
      );
    case "not_authenticated":
      return (
        <Button onClick={onLogin} size={size} className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold" data-testid="button-write-login">
          <LogIn className="w-4 h-4 mr-1.5" />
          Log In
        </Button>
      );
    case "no_subscription":
      return (
        <Button onClick={onLogin} size={size} className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold" data-testid="button-upgrade-subscription">
          <CreditCard className="w-4 h-4 mr-1.5" />
          Upgrade
        </Button>
      );
    case "no_sleeper_token":
      return (
        <Button onClick={onLogin} size={size} className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/85 text-white font-semibold" data-testid="button-connect-sleeper-write">
          <Key className="w-4 h-4 mr-1.5" />
          Connect Sleeper
        </Button>
      );
  }
}

const LOCK_COPY: Record<LockReason, { Icon: typeof Lock; title: string; body: string }> = {
  wrong_domain: {
    Icon: Lock,
    title: "This feature is available in Dynasty Command Pro.",
    body: "Trade actions, waivers, and other write features live on the paid Dynasty Command domain. Read-only tools remain free here.",
  },
  not_authenticated: {
    Icon: LogIn,
    title: "Log in to unlock write access.",
    body: "A Dynasty Command account is required to submit trades, waivers, and other Sleeper actions.",
  },
  no_subscription: {
    Icon: CreditCard,
    title: "Write access requires an active subscription.",
    body: "Upgrade to Dynasty Command Pro to enable trade submission, bulk actions, and waiver claims.",
  },
  no_sleeper_token: {
    Icon: Key,
    title: "Connect Sleeper to submit trades and waivers.",
    body: "We need your Sleeper authentication to submit actions on your behalf. Your token is stored encrypted and never logged.",
  },
};
