/**
 * Global Manager Intel drawer state.
 *
 * Any component anywhere in the app can call
 *   useManagerIntel().openManagerIntel({ userId, username, avatar, leagueId })
 * to pop the same drawer. Mirrors the PlayerProfileContext pattern: a
 * Provider near the app root + a sibling drawer mount.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface ManagerIntelTarget {
  userId: string;
  /** Optional — used for the loading-state header before the API resolves. */
  username?: string | null;
  avatar?: string | null;
  /** Current league context. Drives the "Current League" tab. */
  leagueId?: string | null;
}

interface ManagerIntelState {
  target: ManagerIntelTarget | null;
  isOpen: boolean;
  openManagerIntel: (target: ManagerIntelTarget) => void;
  closeManagerIntel: () => void;
}

const ManagerIntelContext = createContext<ManagerIntelState | null>(null);

export function ManagerIntelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ManagerIntelTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openManagerIntel = useCallback((t: ManagerIntelTarget) => {
    if (!t?.userId) return;
    setTarget(t);
    setIsOpen(true);
  }, []);

  const closeManagerIntel = useCallback(() => {
    setIsOpen(false);
    // Keep `target` briefly so the drawer can animate out without flashing.
  }, []);

  const value = useMemo<ManagerIntelState>(
    () => ({ target, isOpen, openManagerIntel, closeManagerIntel }),
    [target, isOpen, openManagerIntel, closeManagerIntel],
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
