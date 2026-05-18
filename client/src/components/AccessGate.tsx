import { useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { AccessRequirement } from "@/config/moduleAccess";
import { ConnectSleeperUsername } from "@/pages/auth/ConnectSleeperUsername";
import { LoginRequiredGate } from "./LoginRequiredGate";
import { UpgradeFlow } from "./UpgradeFlow";

/**
 * AccessGate — wraps a module render and enforces the configured access tier.
 *
 *   requiredAccess="public"   → always renders children.
 *   requiredAccess="readonly" → guest sees ConnectSleeperUsername inline;
 *                               otherwise renders children.
 *   requiredAccess="full"     → guest/readonly sees LoginRequiredGate which
 *                               opens UpgradeFlow on click. Once the user
 *                               has a DC account, UpgradeFlow continues to
 *                               the Sleeper credentials flow. After full
 *                               access, the module renders.
 *
 * Reads the centralized policy via `useAuth().accessLevel`. See
 * `client/src/config/moduleAccess.ts` for the per-module mapping.
 */

export function AccessGate({
  requiredAccess,
  onBackToReadOnly,
  children,
}: {
  requiredAccess: AccessRequirement;
  /** Callback invoked when a full-mode gate user clicks "Back to Read-Only Tools". */
  onBackToReadOnly?: () => void;
  children: ReactNode;
}) {
  const { accessLevel } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Public: always render.
  if (requiredAccess === "public") {
    return <>{children}</>;
  }

  // Readonly tier: need at least a Sleeper username connected.
  if (requiredAccess === "readonly") {
    if (accessLevel === "guest") {
      return <ConnectSleeperUsername />;
    }
    return <>{children}</>;
  }

  // Full tier: need DC login + Sleeper token.
  if (requiredAccess === "full") {
    if (accessLevel === "full") {
      return <>{children}</>;
    }
    if (showUpgrade) {
      return (
        <UpgradeFlow
          onDone={() => setShowUpgrade(false)}
        />
      );
    }
    return (
      <LoginRequiredGate
        onLogin={() => setShowUpgrade(true)}
        onBack={() => onBackToReadOnly?.()}
      />
    );
  }

  return <>{children}</>;
}
