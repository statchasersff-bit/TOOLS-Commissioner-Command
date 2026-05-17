import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues } from "@/lib/sleeperApi";
import { useAuth } from "@/contexts/AuthContext";

// IMPORTANT: there is intentionally no localStorage key for the Sleeper
// connection. The connection is derived from useAuth().sleeperInfo, which is
// itself driven by the server-canonical /api/sc-auth/me response. Auto-loading
// a username from localStorage caused a critical account-isolation bug where
// DC user B inherited DC user A's Sleeper @username.

interface SleeperState {
  isConnected: boolean;
  user: SleeperUser | null;
  leagues: SleeperLeagueSummary[];
  activeLeagueId: string | null;
  isLoading: boolean;
  error: string | null;
  lastSyncTime: string | null;
  connect: (username: string) => Promise<void>;
  disconnect: () => void;
  setActiveLeague: (leagueId: string) => void;
  refresh: () => Promise<void>;
}

const SleeperContext = createContext<SleeperState | null>(null);

export function SleeperProvider({ children }: { children: React.ReactNode }) {
  const { sleeperInfo } = useAuth();
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
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    await fetchUserAndLeagues(user.username);
  }, [user, fetchUserAndLeagues]);

  // ── Connection source of truth: useAuth().sleeperInfo ─────────────────────
  // When the DC user is unauthenticated or has not linked a Sleeper account,
  // this resets to disconnected. When the linked Sleeper changes (e.g. the
  // user signed out of DC and a different DC user signed in), this re-syncs
  // to the new account. No localStorage lookup of a Sleeper username — that
  // path leaked across DC accounts and is intentionally gone.
  useEffect(() => {
    const linkedUsername = sleeperInfo?.username ?? null;
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
      "[sleeper] loading leagues for linked Sleeper user:",
      linkedUsername,
      "(sleeper_user_id:", sleeperInfo?.userId ?? "(none)", "source: auth-context)"
    );
    fetchUserAndLeagues(linkedUsername);
  }, [sleeperInfo?.username, sleeperInfo?.userId, fetchUserAndLeagues]);

  return (
    <SleeperContext.Provider
      value={{
        isConnected,
        user,
        leagues,
        activeLeagueId,
        isLoading,
        error,
        lastSyncTime,
        connect,
        disconnect,
        setActiveLeague,
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
