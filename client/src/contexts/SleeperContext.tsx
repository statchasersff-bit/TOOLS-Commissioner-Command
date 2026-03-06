import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues } from "@/lib/sleeperApi";

const STORAGE_KEY = "sc-sleeper-connection";

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
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeagueSummary[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

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
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setActiveLeague = useCallback((leagueId: string) => {
    setActiveLeagueId(leagueId);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    await fetchUserAndLeagues(user.username);
  }, [user, fetchUserAndLeagues]);

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
