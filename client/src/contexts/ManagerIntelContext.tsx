/**
 * Global Manager Intel trigger.
 *
 * Any component anywhere in the app can call
 *   useManagerIntel().openManagerIntel({ userId, username, avatar, leagueId })
 * to open a manager. As of the full Manager Page rollout this NAVIGATES to
 * /managers/:userId rather than popping a drawer — the page is the single deep
 * experience. The context stays as a thin request bus so the many existing
 * call sites don't have to change, and
 * `<ManagerIntelNavigator />` (mounted inside the wouter Router for base-aware
 * navigation) performs the actual redirect.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

export interface ManagerIntelTarget {
  userId: string;
  /** Optional — passed through for callers; the page refetches fresh data. */
  username?: string | null;
  avatar?: string | null;
  /** Current league context. Drives the "Current League" tab on the page. */
  leagueId?: string | null;
}

interface ManagerIntelState {
  /** Target requested but not yet navigated to (consumed by the navigator). */
  pendingTarget: ManagerIntelTarget | null;
  openManagerIntel: (target: ManagerIntelTarget) => void;
  clearPending: () => void;
}

const ManagerIntelContext = createContext<ManagerIntelState | null>(null);

export function ManagerIntelProvider({ children }: { children: ReactNode }) {
  const [pendingTarget, setPendingTarget] = useState<ManagerIntelTarget | null>(null);

  const openManagerIntel = useCallback((t: ManagerIntelTarget) => {
    if (!t?.userId) return;
    setPendingTarget(t);
  }, []);

  const clearPending = useCallback(() => setPendingTarget(null), []);

  const value = useMemo<ManagerIntelState>(
    () => ({ pendingTarget, openManagerIntel, clearPending }),
    [pendingTarget, openManagerIntel, clearPending],
  );

  return (
    <ManagerIntelContext.Provider value={value}>
      {children}
    </ManagerIntelContext.Provider>
  );
}

export function useManagerIntel(): ManagerIntelState {
  const ctx = useContext(ManagerIntelContext);
  if (!ctx) {
    throw new Error("useManagerIntel must be used within ManagerIntelProvider");
  }
  return ctx;
}

/**
 * Mounted inside the wouter Router. Watches for a pending manager target and
 * navigates to /managers/:userId (carrying ?leagueId= for current-league
 * context), then clears the request. Kept inside the Router so `setLocation`
 * honors the router base path.
 */
export function ManagerIntelNavigator() {
  const { pendingTarget, clearPending } = useManagerIntel();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!pendingTarget) return;
    const { userId, leagueId } = pendingTarget;
    clearPending();
    const qs = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : "";
    setLocation(`/managers/${encodeURIComponent(userId)}${qs}`);
  }, [pendingTarget, clearPending, setLocation]);

  return null;
}
