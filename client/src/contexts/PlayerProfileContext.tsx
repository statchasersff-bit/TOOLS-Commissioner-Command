/**
 * Global player-profile trigger.
 *
 * Any component can call `openPlayerProfile(playerId)` to open a player. As of
 * the full Player Page rollout this NAVIGATES to /players/:slug rather than
 * popping a drawer — the page is the single deep experience. The context stays
 * as a thin request bus so the many existing call sites don't have to change;
 * `<PlayerProfileNavigator />` (mounted inside the wouter Router for base-aware
 * navigation) performs the actual redirect.
 *
 * NOTE: separate from the ADP Explorer drawer (PlayerProfileDrawer.tsx).
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
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { slugForId } from "@/lib/playerSlug";

interface PlayerProfileState {
  /** The player id requested but not yet navigated to (consumed by the navigator). */
  pendingPlayerId: string | null;
  openPlayerProfile: (playerId: string) => void;
  clearPending: () => void;
}

const PlayerProfileContext = createContext<PlayerProfileState | null>(null);

export function PlayerProfileProvider({ children }: { children: ReactNode }) {
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);

  const openPlayerProfile = useCallback((playerId: string) => {
    if (!playerId) return;
    setPendingPlayerId(playerId);
  }, []);

  const clearPending = useCallback(() => setPendingPlayerId(null), []);

  const value = useMemo<PlayerProfileState>(
    () => ({ pendingPlayerId, openPlayerProfile, clearPending }),
    [pendingPlayerId, openPlayerProfile, clearPending],
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

/**
 * Mounted inside the wouter Router. Watches for a pending player id and
 * navigates to the slug URL (falling back to the raw id), then clears the
 * request. Kept inside the Router so `setLocation` honors the router base path.
 */
export function PlayerProfileNavigator() {
  const { pendingPlayerId, clearPending } = usePlayerProfile();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!pendingPlayerId) return;
    let cancelled = false;
    (async () => {
      let target = pendingPlayerId;
      try {
        const db = await getSleeperPlayers();
        const slug = slugForId(db, pendingPlayerId);
        if (slug) target = slug;
      } catch {
        /* fall back to raw id */
      }
      if (cancelled) return;
      clearPending();
      setLocation(`/players/${target}`);
    })();
    return () => { cancelled = true; };
  }, [pendingPlayerId, clearPending, setLocation]);

  return null;
}
