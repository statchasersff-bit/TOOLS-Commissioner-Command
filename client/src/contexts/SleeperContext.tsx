import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues, sleeperLogin } from "@/lib/sleeperApi";

const STORAGE_KEY = "sc-sleeper-connection";
const TOKEN_KEY   = "sc-sleeper-token";

interface SleeperState {
  isConnected: boolean;
  user: SleeperUser | null;
  leagues: SleeperLeagueSummary[];
  activeLeagueId: string | null;
  isLoading: boolean;
  error: string | null;
  lastSyncTime: string | null;
  sleeperToken: string | null;
  connect: (username: string) => Promise<void>;
  disconnect: () => void;
  setActiveLeague: (leagueId: string) => void;
  refresh: () => Promise<void>;
  loginWithPassword: (password: string) => Promise<void>;
  clearToken: () => void;
}

const SleeperContext = createContext<SleeperState | null>(null);

export function SleeperProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeagueSummary[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [sleeperToken, setSleeperToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY)
  );

  const isConnected = user !== null;

  const fetchUserAndLeagues = useCallback(async (username: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const userData = await fetchSleeperUser(username);
      setUser(userData);

      const leaguesData = await fetchSleeperLeagues(userData.userId, "2026");
      setLeagues(leaguesData);
      setLastSyncTime(new Date().toISOString());

      localStorage.setItem(STORAGE_KEY, username);
    } catch (err: any) {
      setError(err.message || "Connection failed");
      setUser(null);
      setLeagues([]);
      localStorage.removeItem(STORAGE_KEY);
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
    setSleeperToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const setActiveLeague = useCallback((leagueId: string) => {
    setActiveLeagueId(leagueId);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    await fetchUserAndLeagues(user.username);
  }, [user, fetchUserAndLeagues]);

  const loginWithPassword = useCallback(async (password: string) => {
    if (!user) throw new Error("Not connected to a Sleeper account");
    const token = await sleeperLogin(user.username, password);
    setSleeperToken(token);
    localStorage.setItem(TOKEN_KEY, token);
  }, [user]);

  const clearToken = useCallback(() => {
    setSleeperToken(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      fetchUserAndLeagues(stored);
    }
  }, [fetchUserAndLeagues]);

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
        sleeperToken,
        connect,
        disconnect,
        setActiveLeague,
        refresh,
        loginWithPassword,
        clearToken,
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
