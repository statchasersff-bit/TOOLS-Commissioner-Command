import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
  saveSleeperSession,
  clearSleeperSession,
  getSleeperSession,
  setActiveDcUser,
  purgeAllSleeperLocalState,
  detectAndRemoveLegacySleeperKeys,
  getActiveDcUserId,
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

/**
 * Where the currently-active Sleeper session came from on the most recent
 * bootstrap. Use this for diagnostics and as a verification handle.
 *
 *   "server-linked"  — DC user has Sleeper linked on the server; token came
 *                      from /api/sc-auth/me. This is the only "trusted"
 *                      auto-auth source.
 *   "local-scoped"   — A scoped-per-DC-user session in localStorage was used
 *                      because the server didn't provide one. Currently
 *                      checkSession always prefers server, so this should
 *                      not occur in normal flow; if it does, investigate.
 *   "legacy-cache-removed" — Pre-scoping global keys (e.g. statchasers_sleeper_auth
 *                      without a DC-user suffix) were detected and removed.
 *                      They were NOT used for auth. Surfaced so a UI badge
 *                      can flag the cleanup happened.
 *   "none"           — No Sleeper auth active.
 */
export type SleeperSource = "server-linked" | "local-scoped" | "legacy-cache-removed" | "none";

interface AuthContextValue {
  status: AuthStatus;
  user: ScUser | null;
  sleeperInfo: SleeperInfo | null;
  /** Source of the active Sleeper session — see SleeperSource for semantics. */
  sleeperSource: SleeperSource;
  /** Legacy global keys that were detected and removed on the last bootstrap. */
  legacyKeysRemoved: string[];
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
  const [sleeperSource, setSleeperSource] = useState<SleeperSource>("none");
  const [legacyKeysRemoved, setLegacyKeysRemoved] = useState<string[]>([]);

  const checkSession = useCallback(async () => {
    // ── Step 0: ALWAYS clean up legacy global keys before any read. ──────────
    // This runs at the start of every bootstrap so a legacy global key can
    // never influence the source decision below.
    const removed = detectAndRemoveLegacySleeperKeys();
    setLegacyKeysRemoved(removed);
    if (removed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[sc-auth] removed legacy pre-scoping Sleeper keys (NOT used for auth):",
        removed
      );
    }

    try {
      setStatus("loading");
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
        setSleeperSource("none");
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
      const preLocalSession = getSleeperSession();
      const serverSleeperUserId: string | null = data.sleeper?.userId ?? null;
      if (
        preLocalSession &&
        serverSleeperUserId &&
        preLocalSession.user_id &&
        preLocalSession.user_id !== serverSleeperUserId
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          "[sc-auth] sleeper user mismatch for DC user",
          data.user.id,
          "— local:", preLocalSession.user_id,
          "server:", serverSleeperUserId,
          "— clearing local session"
        );
        clearSleeperSession();
      }

      setUser(data.user);
      let source: SleeperSource;
      if (data.sleeper?.token) {
        // ── Server-linked path: server provided a canonical token for this
        // DC user. Persist into the scoped key and use that as the source.
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
        source = "server-linked";
        setStatus("ready");
      } else {
        // ── Server says no Sleeper linked. Be authoritative: clear any
        // local-scoped session that lingered. Never fall back to local.
        clearSleeperSession();
        setSleeperInfo(null);
        // If the legacy-key cleanup found anything, surface that label so a
        // human reading the badge knows cleanup happened on this bootstrap.
        source = removed.length > 0 ? "legacy-cache-removed" : "none";
        setStatus("needs-sleeper");
      }

      setSleeperSource(source);
      // eslint-disable-next-line no-console
      console.info(
        `[auth] Sleeper source: ${source}`,
        "| DC user:", data.user.id,
        "| Sleeper user:", data.sleeper?.userId || "(none)",
        "| linked Sleeper:", data.sleeper?.username || "(none)",
        ...(removed.length > 0 ? ["| legacy removed:", removed] : []),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[sc-auth] checkSession threw — purging all Sleeper local state", err);
      clearToken();
      purgeAllSleeperLocalState();
      setUser(null);
      setSleeperInfo(null);
      setSleeperSource("none");
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
    setSleeperSource("none");
    setLegacyKeysRemoved([]);
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
    setSleeperSource("none");
    setStatus("needs-sleeper");
  }, [user?.id]);

  // ── Debug helper exposed on window so the source label can be inspected
  // from DevTools without rendering it in the UI. Updated on every render
  // so it always reflects the latest state.
  useEffect(() => {
    try {
      (window as unknown as { __dcAuthDebug?: () => void }).__dcAuthDebug = () => {
        // eslint-disable-next-line no-console
        console.info("[auth-debug]", {
          dcUserId: user?.id ?? null,
          dcEmail: user?.email ?? null,
          activeDcUserIdInStore: getActiveDcUserId(),
          sleeperUserId: sleeperInfo?.userId ?? null,
          linkedSleeperUsername: sleeperInfo?.username ?? null,
          sleeperSource,
          legacyKeysRemovedOnLastBootstrap: legacyKeysRemoved,
          status,
        });
      };
    } catch { /* SSR / no window */ }
  }, [user, sleeperInfo, sleeperSource, legacyKeysRemoved, status]);

  return (
    <AuthContext.Provider value={{ status, user, sleeperInfo, sleeperSource, legacyKeysRemoved, checkSession, logout, onLoginSuccess, onSleeperConnected, onSleeperDisconnected }}>
      {children}
    </AuthContext.Provider>
  );
}
