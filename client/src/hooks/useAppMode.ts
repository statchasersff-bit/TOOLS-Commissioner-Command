/**
 * Single-call hook for any UI that needs to know the current app mode.
 *
 * Prefer this over reading `useAuth().appMode` directly so the public
 * surface stays narrow and future overrides (admin "preview as", debug
 * mode, etc.) flow through one place.
 *
 * Returns:
 *   isReadOnlyMode    — true on statchasers.com / www.statchasers.com
 *   isWriteAccessMode — true on dynastycommandff.com / www.dynastycommandff.com
 *   writeAccessUrl    — canonical URL for the paid app (APP_WRITE_URL env)
 *   publicUrl         — canonical URL for the free read-only app
 *   subscription      — server-confirmed subscription record
 *   canPerformWriteActions — composite flag: domain ✓ auth ✓ token ✓ sub ✓
 */

import { useAuth } from "@/contexts/AuthContext";
import { getPublicAppUrl, getWriteAccessUrl } from "@/lib/appMode";

export function useAppMode() {
  const {
    appMode,
    isWriteAccessDomain,
    subscription,
    canPerformWriteActions,
    isAuthenticatedUser,
    hasSleeperToken,
  } = useAuth();
  return {
    appMode,
    isReadOnlyMode: appMode === "READ_ONLY",
    isWriteAccessMode: appMode === "WRITE_ACCESS",
    isWriteAccessDomain,
    writeAccessUrl: getWriteAccessUrl(),
    publicUrl: getPublicAppUrl(),
    subscription,
    canPerformWriteActions,
    isAuthenticatedUser,
    hasSleeperToken,
  };
}
