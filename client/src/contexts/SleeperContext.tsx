import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues } from "@/lib/sleeperApi";
import { useAuth } from "@/contexts/AuthContext";

// IMPORTANT: there is intentionally no localStorage key for the Sleeper
// connection. The connection is derived from useAuth().sleeperInfo, which is
// itself driven by the server-canonical /api/sc-auth/me response. Auto-loading
// a username from localStorage caused a critical account-isolation bug where
// DC user B inherited DC user A's Sleeper @username.

// activeLeagueId IS persisted, but scoped to the sleeper userId so accounts
// can't inherit each other's selection. Key shape: sc-active-league:<userId>.
const ACTIVE_LEAGUE_KEY_PREFIX = "sc-active-league:";
function activeLeagueKey(userId: string) { return `${ACTIVE_LEAGUE_KEY_PREFIX}${userId}`; }
function readPersistedLeague(userId: string): string | null {
  try { return localStorage.getItem(activeLeagueKey(userId)); } catch { return null; }
}
function writePersistedLeague(userId: string, leagueId: string | null) {
  try {
    if (leagueId) localStorage.setItem(activeLeagueKey(userId), leagueId);
    else localStorage.removeItem(activeLeagueKey(userId));
  } catch { /* ignore */ }
}

interface SleeperState {
  isConnected: boolean;
  user: SleeperUser | null;
  leagues: SleeperLeagueSummary[];
  activeLeagueId: string | null;
  activeLeague: SleeperLeagueSummary | null;
  isLoading: boolean;
  error: string | null;
  lastSyncTime: string | null;
  connect: (username: string) => Promise<void>;
  disconnect: () => void;
  setActiveLeague: (leagueId: string) => void;
  setActiveLeagueById: (leagueId: string | null) => void;
  refresh: () => Promise<void>;
}

const SleeperContext = createContext<SleeperState | null>(null);

export function SleeperProvider({ children }: { children: React.ReactNode }) {
  const { sleeperInfo, readOnlySleeperUser } = useAuth();
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeagueSummary[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  // Track which username we've already auto-loaded leagues for, scoped to the
  // current sleeperInfo identity. Reset whenever the linked Sleeper changes.
  const lastAutoLoadedUsernameRef = useRef<string | null>(null);

  const isConnected = user !== null;

  const fetchUserAndLeagues = useCallback(async (
    username: string,
    opts: { preserveStubOnError?: boolean; stub?: SleeperUser | null } = {}
  ) => {
    setIsLoading(true);
    setError(null);
    // Show the stub immediately so UI flips to "connected" while the network call runs.
    if (opts.stub) setUser(opts.stub);

    try {
      const userData = await fetchSleeperUser(username);
      setUser(userData);

      const leaguesData = await fetchSleeperLeagues(userData.userId, "2026");
      setLeagues(leaguesData);
      setLastSyncTime(new Date().toISOString());

      // Restore the user's last-selected league (per-user, never cross-account).
      const persisted = readPersistedLeague(userData.userId);
      if (persisted && leaguesData.some((l) => l.leagueId === persisted)) {
        setActiveLeagueId(persisted);
      } else if (leaguesData.length > 0) {
        // Sensible default so league-specific views aren't perma-empty on first load.
        const fallback = leaguesData[0].leagueId;
        setActiveLeagueId(fallback);
        writePersistedLeague(userData.userId, fallback);
      } else {
        setActiveLeagueId(null);
      }
    } catch (err: any) {
      setError(err.message || "Connection failed");
      // When auth-derived, keep the stub user so the UI stays in "connected" state
      // and a transient network blip doesn't kick the user back to the connect form.
      if (!opts.preserveStubOnError) {
        setUser(null);
        setLeagues([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connect = useCallback(async (username: string) => {
    await fetchUserAndLeagues(username);
  }, [fetchUserAndLeagues]);

  const disconnect = useCallback(() => {
    setUser(null);
    setLeagues([]);
    setActiveLeagueId(null);
    setError(null);
    setLastSyncTime(null);
    lastAutoLoadedUsernameRef.current = null;
  }, []);

  const setActiveLeague = useCallback((leagueId: string) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
  }, [user?.userId]);

  // Same as setActiveLeague but accepts null to clear (used by route handlers
  // that may not have a leagueId yet).
  const setActiveLeagueById = useCallback((leagueId: string | null) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
  }, [user?.userId]);

  const activeLeague = useMemo(
    () => leagues.find((l) => l.leagueId === activeLeagueId) ?? null,
    [leagues, activeLeagueId]
  );

  const refresh = useCallback(async () => {
    if (!user) return;
    await fetchUserAndLeagues(user.username);
  }, [user, fetchUserAndLeagues]);

  // ── Connection source of truth ────────────────────────────────────────────
  // Prefer the DC-server-linked Sleeper (full mode), fall back to the
  // read-only Sleeper identity. Both paths use the same public read
  // endpoints to load leagues — the only difference is whether an auth
  // token is available for downstream action mutations.
  //
  // Account-isolation: when DC is logged in, sleeperInfo is canonical. When
  // not, readOnlySleeperUser is used. AuthContext is responsible for
  // reconciling the two on sign-in (read-only is cleared if it conflicts).
  useEffect(() => {
    const linkedUsername = sleeperInfo?.username ?? readOnlySleeperUser?.username ?? null;
    const linkedUserId = sleeperInfo?.userId ?? readOnlySleeperUser?.userId ?? null;
    if (!linkedUsername) {
      setUser(null);
      setLeagues([]);
      setActiveLeagueId(null);
      setError(null);
      setLastSyncTime(null);
      lastAutoLoadedUsernameRef.current = null;
      return;
    }
    if (lastAutoLoadedUsernameRef.current === linkedUsername) return;
    lastAutoLoadedUsernameRef.current = linkedUsername;
    // eslint-disable-next-line no-console
    console.info(
      "[sleeper] loading leagues for Sleeper user:",
      linkedUsername,
      "(sleeper_user_id:", linkedUserId ?? "(none)",
      "source:", sleeperInfo?.username ? "auth-context" : "read-only",
      ")"
    );
    fetchUserAndLeagues(linkedUsername);
  }, [sleeperInfo?.username, sleeperInfo?.userId, readOnlySleeperUser?.username, readOnlySleeperUser?.userId, fetchUserAndLeagues]);

  return (
    <SleeperContext.Provider
      value={{
        isConnected,
        user,
        leagues,
        activeLeagueId,
        activeLeague,
        isLoading,
        error,
        lastSyncTime,
        connect,
        disconnect,
        setActiveLeague,
        setActiveLeagueById,
        refresh,
      }}
    >
      {children}
    </SleeperContext.Provider>
  );
}

export function useSleeper(): SleeperState {
  const ctx = useContext(SleeperContext);
  if (!ctx) throw new Error("useSleeper must be used within SleeperProvider");
  return ctx;
}
