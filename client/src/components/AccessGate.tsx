import { useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { AccessRequirement } from "@/config/moduleAccess";
import { ConnectSleeperUsername } from "@/pages/auth/ConnectSleeperUsername";
import { LoginRequiredGate } from "./LoginRequiredGate";
import { UpgradeFlow } from "./UpgradeFlow";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

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
  const { accessLevel, isWriteAccessDomain } = useAuth();
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
    // On a read-only domain, full-tier modules are unavailable regardless
    // of login state. Don't surface the upgrade flow — it'd send the user
    // through Sleeper credentials only to bounce off the backend's domain
    // gate. Tell them where to go instead.
    if (!isWriteAccessDomain) {
      return (
        <Card className="border-[#d4af37]/40" data-testid="card-readonly-domain-gate">
          <CardContent className="py-10 px-6 text-center space-y-3 max-w-xl mx-auto">
            <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 mx-auto flex items-center justify-center border border-[#d4af37]/30">
              <Lock className="w-6 h-6 text-[#d4af37]" />
            </div>
            <h3 className="text-base font-bold text-foreground">
              Available on Dynasty Command (paid)
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This feature performs Sleeper write actions and is only
              available on the paid Dynasty Command domain. Read-only tools
              remain free at statchasers.com.
            </p>
          </CardContent>
        </Card>
      );
    }
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
