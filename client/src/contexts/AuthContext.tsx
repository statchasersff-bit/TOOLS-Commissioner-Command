import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { saveSleeperSession, clearSleeperSession, type SleeperSession } from "@/services/sleeperAuth";
import { API_BASE } from "@/lib/apiBase";

const SC_TOKEN_KEY = "sc_auth_token";

function getStoredToken(): string | null {
  try { return localStorage.getItem(SC_TOKEN_KEY); } catch { return null; }
}
function saveToken(token: string): void {
  try { localStorage.setItem(SC_TOKEN_KEY, token); } catch {}
}
function clearToken(): void {
  try { localStorage.removeItem(SC_TOKEN_KEY); } catch {}
}
function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ScUser {
  id: string;
  email: string;
}

export interface SleeperInfo {
  username: string | null;
  userId: string | null;
  token: string | null;
}

export type AuthStatus = "loading" | "unauthenticated" | "needs-sleeper" | "ready";

interface AuthContextValue {
  status: AuthStatus;
  user: ScUser | null;
  sleeperInfo: SleeperInfo | null;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
  onLoginSuccess: (token: string) => Promise<void>;
  onSleeperConnected: (username: string, userId: string, token: string) => Promise<void>;
  onSleeperDisconnected: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<ScUser | null>(null);
  const [sleeperInfo, setSleeperInfo] = useState<SleeperInfo | null>(null);

  const checkSession = useCallback(async () => {
    try {
      setStatus("loading");
      const storedToken = getStoredToken();
      const headers = { "Content-Type": "application/json", ...authHeaders() };
      console.log("[sc-auth] checkSession — token in localStorage:", !!storedToken, "Authorization header set:", !!headers.Authorization);
      const res = await fetch(`${API_BASE}/api/sc-auth/me`, {
        credentials: "include",
        headers,
      });
      console.log("[sc-auth] /me response status:", res.status);
      if (res.status === 401) {
        clearToken();
        setUser(null);
        setSleeperInfo(null);
        setStatus("unauthenticated");
        return;
      }
      const data = await res.json();
      if (!data.user) {
        clearToken();
        setUser(null);
        setSleeperInfo(null);
        setStatus("unauthenticated");
        return;
      }
      setUser(data.user);
      if (data.sleeper?.token) {
        const session: SleeperSession = {
          token: data.sleeper.token,
          user_id: data.sleeper.userId ?? "",
          display_name: data.sleeper.username ?? "",
          avatar: null,
          exp: null,
          iat: null,
        };
        saveSleeperSession(session);
        setSleeperInfo(data.sleeper);
        setStatus("ready");
      } else {
        setSleeperInfo(null);
        setStatus("needs-sleeper");
      }
    } catch {
      setUser(null);
      setSleeperInfo(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const onLoginSuccess = useCallback(async (token: string) => {
    saveToken(token);
    await checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/sc-auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders(),
      });
    } catch { /* ignore */ }
    clearToken();
    clearSleeperSession();
    setUser(null);
    setSleeperInfo(null);
    setStatus("unauthenticated");
  }, []);

  const onSleeperConnected = useCallback(async (username: string, userId: string, token: string) => {
    await fetch(`${API_BASE}/api/sc-auth/connect-sleeper`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ sleeperUsername: username, sleeperUserId: userId, token }),
    });
    await checkSession();
  }, [checkSession]);

  const onSleeperDisconnected = useCallback(async () => {
    await fetch(`${API_BASE}/api/sc-auth/disconnect-sleeper`, {
      method: "DELETE",
      credentials: "include",
      headers: authHeaders(),
    });
    clearSleeperSession();
    setSleeperInfo(null);
    setStatus("needs-sleeper");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, sleeperInfo, checkSession, logout, onLoginSuccess, onSleeperConnected, onSleeperDisconnected }}>
      {children}
    </AuthContext.Provider>
  );
}
