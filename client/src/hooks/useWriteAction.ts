/**
 * useWriteAction — single-call hook for any premium write button.
 *
 * Buttons should remain VISIBLE on the read-only domain rather than being
 * hidden. Use the returned `requireUnlock(handler)` wrapper instead of
 * binding the handler directly to `onClick`; it transparently runs the
 * action when unlocked and opens the premium lock modal otherwise.
 *
 * Example:
 *
 *   const { state, requireUnlock } = useWriteAction();
 *   <Button onClick={() => requireUnlock(submitTrade)}>
 *     Send Trade
 *   </Button>
 *
 * The button keeps its full visual treatment (label, icon, color). A
 * small "Pro" badge can be conditionally rendered when `state !== "UNLOCKED"`.
 */

import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWriteAccessModal } from "@/contexts/WriteAccessModalContext";
import { getWriteAccessState, isUnlocked, type WriteAccessState } from "@/lib/writeAccessState";

export function useWriteAction() {
  const { appMode, isAuthenticatedUser, hasSleeperToken, subscription } = useAuth();
  const { openModal } = useWriteAccessModal();

  const host = typeof window !== "undefined" ? window.location.hostname : null;
  const state: WriteAccessState = getWriteAccessState({
    appMode,
    host,
    isAuthenticated: isAuthenticatedUser,
    hasActiveSubscription: subscription.active,
    hasSleeperToken,
  });

  /**
   * Wrap an action handler. If unlocked, runs it. Otherwise opens the
   * premium-lock modal with the current state and never invokes the
   * handler. Returns the result of the handler when invoked.
   */
  const requireUnlock = useCallback(
    <T,>(handler: () => T | Promise<T>): T | Promise<T> | undefined => {
      if (isUnlocked(state)) return handler();
      openModal(state);
      return undefined;
    },
    [state, openModal],
  );

  return {
    state,
    unlocked: isUnlocked(state),
    /** True for any non-UNLOCKED state — convenience for showing a Pro chip. */
    locked: !isUnlocked(state),
    requireUnlock,
    /** Manually open the modal for a state (e.g. from a "Why is this locked?" link). */
    openLockModal: openModal,
  };
}
