/**
 * Browser-side wrapper around the shared app-mode policy. Read this
 * module from any UI component that needs to hide write-only controls.
 *
 * Source of truth:
 *   1. Server-supplied `appMode` from `/api/sc-auth/me` (preferred — the
 *      server is the only place that can enforce the gate, so its answer
 *      always wins).
 *   2. `getAppMode(window.location.hostname)` for unauthenticated /
 *      pre-session UI.
 *
 * Components should prefer `useAppMode()` from AuthContext rather than
 * calling these directly so any future override (e.g. admin "preview as"
 * tool) flows through one place.
 */

import {
  getAppMode,
  isWriteAccessDomain as sharedIsWriteAccessDomain,
  isReadOnlyDomain as sharedIsReadOnlyDomain,
  getPublicAppUrl,
  getWriteAccessUrl,
  type AppMode,
} from "@shared/appMode";

export type { AppMode };
export { getPublicAppUrl, getWriteAccessUrl };

function currentHost(): string | null {
  try {
    return window.location.hostname;
  } catch {
    return null;
  }
}

/** App mode for the current browser tab — derived from window.location. */
export function getBrowserAppMode(): AppMode {
  return getAppMode(currentHost());
}

export function isWriteAccessDomain(): boolean {
  return sharedIsWriteAccessDomain(currentHost());
}

export function isReadOnlyDomain(): boolean {
  return sharedIsReadOnlyDomain(currentHost());
}

/** True when the current domain may EXPOSE write features. Use this to
 *  decide whether to render UpgradeFlow, Connect-Sleeper-token CTAs, and
 *  any "full"-tier module. Read-only domains should funnel users to the
 *  paid domain instead. */
export function canShowWriteFeatures(serverAppMode?: AppMode | null): boolean {
  if (serverAppMode === "WRITE_ACCESS") return true;
  if (serverAppMode === "READ_ONLY") return false;
  return getBrowserAppMode() === "WRITE_ACCESS";
}
