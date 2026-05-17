import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
  saveSleeperSession,
  clearSleeperSession,
  getSleeperSession,
  setActiveDcUser,
  purgeAllSleeperLocalState,
  type SleeperSession,
} from "@/services/sleeperAuth";
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
      // Unauthenticated path: clear ALL Sleeper state so a future sign-in
      // can't inherit anything from this browser session.
      const failClosed = (reason: string) => {
        // eslint-disable-next-line no-console
        console.warn(`[sc-auth] checkSession failed: ${reason} — purging all Sleeper local state`);
        clearToken();
        purgeAllSleeperLocalState();
        setUser(null);
        setSleeperInfo(null);
        setStatus("unauthenticated");
      };

      const res = await fetch(`${API_BASE}/api/sc-auth/me`, {
        credentials: "include",
        headers,
      });
      if (res.status === 401) return failClosed("401 from /me");

      const data = await res.json();
      if (!data.user) return failClosed("/me returned no user");

      // ── Bind the Sleeper auth store to this DC user BEFORE any read/write.
      // While bound, getSleeperSession() only ever returns this user's session.
      setActiveDcUser(data.user.id);

      // Account-isolation gate: if a leftover scoped session exists from a
      // prior browser state and its sleeper user_id doesn't match what the
      // server reports for this DC user, drop it and force re-derivation
      // from the server-canonical token.
      const localSession = getSleeperSession();
      const serverSleeperUserId: string | null = data.sleeper?.userId ?? null;
      if (
        localSession &&
        serverSleeperUserId &&
        localSession.user_id &&
        localSession.user_id !== serverSleeperUserId
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          "[sc-auth] sleeper user mismatch for DC user",
          data.user.id,
          "— local:", localSession.user_id,
          "server:", serverSleeperUserId,
          "— clearing local session"
        );
        clearSleeperSession();
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
        // eslint-disable-next-line no-console
        console.info(
          "[auth] ready — DC user:", data.user.id,
          "Sleeper user:", session.user_id || "(none)",
          "linked Sleeper:", data.sleeper.username || "(none)",
          "source: server"
        );
        setStatus("ready");
      } else {
        // No linked Sleeper for this DC user — make sure no stale scoped
        // session lingers for them either.
        clearSleeperSession();
        setSleeperInfo(null);
        // eslint-disable-next-line no-console
        console.info(
          "[auth] needs-sleeper — DC user:", data.user.id,
          "Sleeper user: (none) linked Sleeper: (none) source: server"
        );
        setStatus("needs-sleeper");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[sc-auth] checkSession threw — purging all Sleeper local state", err);
      clearToken();
      purgeAllSleeperLocalState();
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
    // Wipe every Sleeper-related localStorage entry (scoped sessions for any
    // DC user, legacy global keys, draft-JWT cache, finance-token cache) so a
    // future sign-in on this browser cannot inherit prior Sleeper state.
    purgeAllSleeperLocalState();
    // eslint-disable-next-line no-console
    console.info("[auth] logout — DC session cleared, all Sleeper local state purged");
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
    // Purge ALL Sleeper local state, not just the scoped session, so legacy
    // global keys (sc-sleeper-connection, dc-sleeper-draft-jwt, finance
    // token cache) don't survive a Sleeper disconnect.
    purgeAllSleeperLocalState();
    // Re-bind the active DC user since the purge nulls it.
    if (user?.id) setActiveDcUser(user.id);
    setSleeperInfo(null);
    setStatus("needs-sleeper");
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ status, user, sleeperInfo, checkSession, logout, onLoginSuccess, onSleeperConnected, onSleeperDisconnected }}>
      {children}
    </AuthContext.Provider>
  );
}
