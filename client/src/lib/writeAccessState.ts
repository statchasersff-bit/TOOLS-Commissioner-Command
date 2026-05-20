/**
 * Frontend write-access state machine.
 *
 * Mirrors the order of `requireWriteCapability` on the server so the UI's
 * view of "is this clickable?" always matches the backend's. Buttons
 * should remain VISIBLE on the read-only domain — they just open a
 * premium-lock modal on click instead of firing.
 *
 * Return values:
 *
 *   PUBLIC_LOCKED            — on the configured read-only domain
 *                              (statchasers.com / www.statchasers.com).
 *                              The button shows as "Pro" + opens upgrade modal.
 *
 *   WRONG_DOMAIN             — on a host that's neither read-only nor
 *                              write-access (e.g. an unconfigured preview
 *                              URL). Treated as locked; same UX as
 *                              PUBLIC_LOCKED but distinct for telemetry.
 *
 *   NEEDS_LOGIN              — write-access domain, but no DC session.
 *                              Button opens login flow.
 *
 *   NEEDS_SUBSCRIPTION       — write-access + DC session, but no active sub.
 *                              Button opens upgrade flow.
 *
 *   NEEDS_SLEEPER_CONNECTION — write-access + DC + sub, but no Sleeper token.
 *                              Button opens Sleeper-connect flow.
 *
 *   UNLOCKED                 — everything checks out. Button fires its
 *                              real handler.
 */

import { getReadOnlyDomains, getWriteAccessDomains, normalizeHost, type AppMode } from "@shared/appMode";

export type WriteAccessState =
  | "PUBLIC_LOCKED"
  | "WRONG_DOMAIN"
  | "NEEDS_LOGIN"
  | "NEEDS_SUBSCRIPTION"
  | "NEEDS_SLEEPER_CONNECTION"
  | "UNLOCKED";

export interface WriteAccessInput {
  appMode: AppMode;
  host: string | null;
  isAuthenticated: boolean;
  hasActiveSubscription: boolean;
  hasSleeperToken: boolean;
}

/**
 * Pure resolver — given the inputs, returns the most specific state.
 *
 * Order matters: domain check first (matches server), then auth, then
 * subscription, then Sleeper token. Buttons read this single value and
 * branch their `onClick` handler accordingly.
 */
export function getWriteAccessState(input: WriteAccessInput): WriteAccessState {
  // 1. Domain gate. Distinguish "configured read-only host" from "totally
  //    unknown host" so analytics/telemetry can spot misconfiguration.
  if (input.appMode !== "WRITE_ACCESS") {
    const h = normalizeHost(input.host);
    if (h && getReadOnlyDomains().includes(h)) return "PUBLIC_LOCKED";
    if (h && getWriteAccessDomains().includes(h)) {
      // Edge case: host is in WRITE_ACCESS list but appMode resolved to
      // READ_ONLY (e.g. ENABLE_WRITE_ACCESS=false). Surface as
      // PUBLIC_LOCKED — the user can't act here either way.
      return "PUBLIC_LOCKED";
    }
    return "WRONG_DOMAIN";
  }

  // 2. Auth.
  if (!input.isAuthenticated) return "NEEDS_LOGIN";

  // 3. Subscription.
  if (!input.hasActiveSubscription) return "NEEDS_SUBSCRIPTION";

  // 4. Sleeper.
  if (!input.hasSleeperToken) return "NEEDS_SLEEPER_CONNECTION";

  return "UNLOCKED";
}

export function isUnlocked(state: WriteAccessState): boolean {
  return state === "UNLOCKED";
}
