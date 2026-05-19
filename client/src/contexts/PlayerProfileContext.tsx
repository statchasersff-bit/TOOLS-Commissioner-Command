/**
 * Global player profile drawer state.
 *
 * Any component anywhere in the app can call `openPlayerProfile(playerId)` to
 * pop the same drawer. The Provider lives near the app root and the actual
 * drawer is rendered alongside it (see DynastyCommandCenter wiring).
 *
 * IMPORTANT: This is *separate* from the ADP Explorer profile drawer
 * (PlayerProfileDrawer.tsx) which is draft-focused. Do not merge them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface PlayerProfileState {
  selectedPlayerId: string | null;
  isOpen: boolean;
  openPlayerProfile: (playerId: string) => void;
  closePlayerProfile: () => void;
}

const PlayerProfileContext = createContext<PlayerProfileState | null>(null);

export function PlayerProfileProvider({ children }: { children: ReactNode }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openPlayerProfile = useCallback((playerId: string) => {
    if (!playerId) return;
    setSelectedPlayerId(playerId);
    setIsOpen(true);
  }, []);

  const closePlayerProfile = useCallback(() => {
    setIsOpen(false);
    // Keep `selectedPlayerId` briefly so the drawer can animate out without
    // flashing an empty body — Sheet's onOpenChange handles cleanup timing.
  }, []);

  const value = useMemo<PlayerProfileState>(
    () => ({ selectedPlayerId, isOpen, openPlayerProfile, closePlayerProfile }),
    [selectedPlayerId, isOpen, openPlayerProfile, closePlayerProfile],
  );

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
    </PlayerProfileContext.Provider>
  );
}

export function usePlayerProfile(): PlayerProfileState {
  const ctx = useContext(PlayerProfileContext);
  if (!ctx) {
    throw new Error("usePlayerProfile must be used within PlayerProfileProvider");
  }
  return ctx;
}
