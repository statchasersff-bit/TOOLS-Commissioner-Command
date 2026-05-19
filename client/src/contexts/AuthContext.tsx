import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
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
import {
  connectReadOnlySleeperByUsername,
  getReadOnlySleeper,
  clearReadOnlySleeper,
  type ReadOnlySleeperIdentity,
} from "@/services/readOnlySleeper";
import { API_BASE } from "@/lib/apiBase";
import { isAdminUser } from "@shared/admin";

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
  /** NFL team abbreviation (e.g. "ATL"). Null when the user hasn't picked one. */
  favoriteNflTeam: string | null;
}

export interface SleeperInfo {
  username: string | null;
  userId: string | null;
  token: string | null;
}

/**
 * Legacy status field. Kept for any external consumer (e.g. tests) that may
 * still depend on it. New code should use `accessLevel` instead.
 *
 *   "loading"          — initial bootstrap in progress.
 *   "unauthenticated"  — no DC session.
 *   "needs-sleeper"    — DC session, no Sleeper linked. (Used by full-mode
 *                        upgrade flow only; no longer blocks the whole app.)
 *   "ready"            — DC + Sleeper both present (full mode).
 */
export type AuthStatus = "loading" | "unauthenticated" | "needs-sleeper" | "ready";

/**
 * Four-tier access level — the canonical handle for module gating.
 *
 *   guest         — no Sleeper connected of any kind.
 *   readonly      — Sleeper username connected via public API (no DC login).
 *   authenticated — DC login exists but no Sleeper auth token. Module access
 *                   equal to readonly. Action tools still require a Sleeper
 *                   token, which the upgrade flow asks for next.
 *   full          — DC login + Sleeper auth token.
 *
 * See client/src/config/moduleAccess.ts for which modules require which level.
 */
export type AccessLevel = "guest" | "readonly" | "authenticated" | "full";

export type SleeperSource = "server-linked" | "local-scoped" | "legacy-cache-removed" | "none" | "read-only";

interface AuthContextValue {
  status: AuthStatus;
  user: ScUser | null;
  sleeperInfo: SleeperInfo | null;
  sleeperSource: SleeperSource;
  legacyKeysRemoved: string[];

  // ── Access level handles ───────────────────────────────────────────────
  accessLevel: AccessLevel;
  readOnlySleeperUser: ReadOnlySleeperIdentity | null;
  isReadOnlyConnected: boolean;
  isAuthenticatedUser: boolean;
  hasSleeperToken: boolean;
  /**
   * True if the current user matches the admin allowlist (see
   * shared/admin.ts). Permissive — matches either DC email (authoritative,
   * set server-side via /me) or Sleeper username (frontend UI hint only).
   * Backend admin routes do their own strict server-side check.
   */
  isAdmin: boolean;

  // ── Actions ────────────────────────────────────────────────────────────
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
  onLoginSuccess: (token: string) => Promise<void>;
  onSleeperConnected: (username: string, userId: string, token: string) => Promise<void>;
  onSleeperDisconnected: () => Promise<void>;
  connectReadOnlySleeper: (username: string) => Promise<void>;
  disconnectReadOnlySleeper: () => void;
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
  const [readOnlySleeperUser, setReadOnlySleeperUser] = useState<ReadOnlySleeperIdentity | null>(null);
  // Server-derived admin flag — only true when /me reports the DC user's
  // email matches the allowlist. Stays false for read-only / guest users
  // even if they enter an admin Sleeper username, since the server can't
  // verify that claim. We additionally OR with the local admin helper
  // below so a connected-but-unauthenticated Mak (Sleeper username match)
  // still sees the admin UI — backend will still gate the API.
  const [serverIsAdmin, setServerIsAdmin] = useState<boolean>(false);

  const checkSession = useCallback(async () => {
    // ── Step 0: ALWAYS clean up legacy global keys before any read. ──────────
    const removed = detectAndRemoveLegacySleeperKeys();
    setLegacyKeysRemoved(removed);
    if (removed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[sc-auth] removed legacy pre-scoping Sleeper keys (NOT used for auth):",
        removed
      );
    }

    // ── Step 1: pick up any read-only Sleeper identity from localStorage.
    // This is independent of DC auth; a guest visitor with a saved read-only
    // username will see it restored here.
    const readOnly = getReadOnlySleeper();
    setReadOnlySleeperUser(readOnly);

    try {
      setStatus("loading");
      const headers = { "Content-Type": "application/json", ...authHeaders() };

      // Failure path: no DC session. Do NOT purge read-only Sleeper here —
      // a guest visitor is a valid state now.
      const failClosedNoDc = (reason: string) => {
        // eslint-disable-next-line no-console
        console.info(`[sc-auth] no DC session (${reason}) — proceeding without StatChasers account`);
        clearToken();
        setUser(null);
        setSleeperInfo(null);
        setServerIsAdmin(false);
        setSleeperSource(readOnly ? "read-only" : "none");
        setStatus("unauthenticated");
      };

      const res = await fetch(`${API_BASE}/api/sc-auth/me`, {
        credentials: "include",
        headers,
      });
      if (res.status === 401) return failClosedNoDc("401 from /me");

      const data = await res.json();
      if (!data.user) return failClosedNoDc("/me returned no user");

      // ── Bind the Sleeper auth store to this DC user BEFORE any read/write.
      setActiveDcUser(data.user.id);

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
      setServerIsAdmin(!!data.isAdmin);
      let source: SleeperSource;
      if (data.sleeper?.token) {
        // ── Server-linked path: full mode.
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

        // Reconcile read-only: if the DC user's linked Sleeper differs from
        // the read-only key, drop the read-only key so it doesn't shadow
        // the canonical identity.
        if (readOnly && readOnly.userId !== data.sleeper.userId) {
          clearReadOnlySleeper();
          setReadOnlySleeperUser(null);
        }

        source = "server-linked";
        setStatus("ready");
      } else {
        // ── DC user logged in but no Sleeper linked: authenticated tier.
        // Keep the read-only Sleeper identity if present — gives them
        // readonly module access without re-typing the username.
        clearSleeperSession();
        setSleeperInfo(null);
        if (readOnly) {
          source = "read-only";
        } else {
          source = removed.length > 0 ? "legacy-cache-removed" : "none";
        }
        setStatus("needs-sleeper");
      }

      setSleeperSource(source);
      // eslint-disable-next-line no-console
      console.info(
        `[auth] Sleeper source: ${source}`,
        "| DC user:", data.user.id,
        "| Sleeper user:", data.sleeper?.userId || readOnly?.userId || "(none)",
        "| linked Sleeper:", data.sleeper?.username || readOnly?.username || "(none)",
        ...(removed.length > 0 ? ["| legacy removed:", removed] : []),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[sc-auth] checkSession threw — DC unavailable, falling back to guest/read-only", err);
      clearToken();
      setUser(null);
      setSleeperInfo(null);
      setServerIsAdmin(false);
      setSleeperSource(readOnly ? "read-only" : "none");
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
    purgeAllSleeperLocalState();
    // eslint-disable-next-line no-console
    console.info("[auth] logout — DC session cleared, all Sleeper local state purged (read-only included)");
    setUser(null);
    setSleeperInfo(null);
    setReadOnlySleeperUser(null);
    setServerIsAdmin(false);
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
    // After server-linking, the read-only identity is redundant.
    clearReadOnlySleeper();
    setReadOnlySleeperUser(null);
    await checkSession();
  }, [checkSession]);

  const onSleeperDisconnected = useCallback(async () => {
    await fetch(`${API_BASE}/api/sc-auth/disconnect-sleeper`, {
      method: "DELETE",
      credentials: "include",
      headers: authHeaders(),
    });
    purgeAllSleeperLocalState();
    if (user?.id) setActiveDcUser(user.id);
    setSleeperInfo(null);
    setReadOnlySleeperUser(null);
    setSleeperSource("none");
    setStatus("needs-sleeper");
  }, [user?.id]);

  const connectReadOnlySleeper = useCallback(async (username: string) => {
    const identity = await connectReadOnlySleeperByUsername(username);
    setReadOnlySleeperUser(identity);
    // If we have no server-linked Sleeper, surface this as the active source.
    setSleeperSource(prev => (prev === "server-linked" ? prev : "read-only"));
  }, []);

  const disconnectReadOnlySleeper = useCallback(() => {
    clearReadOnlySleeper();
    setReadOnlySleeperUser(null);
    setSleeperSource(prev => (prev === "server-linked" ? prev : "none"));
  }, []);

  // ── Derived access level ───────────────────────────────────────────────
  const accessLevel: AccessLevel = useMemo(() => {
    const hasDc = !!user;
    const hasSleeperToken = !!sleeperInfo?.token;
    const hasSleeperUser = !!(sleeperInfo?.userId || readOnlySleeperUser?.userId);
    if (hasDc && hasSleeperToken) return "full";
    if (hasDc) return "authenticated";
    if (hasSleeperUser) return "readonly";
    return "guest";
  }, [user, sleeperInfo, readOnlySleeperUser]);

  const isAuthenticatedUser = !!user;
  const hasSleeperToken = !!sleeperInfo?.token;
  const isReadOnlyConnected =
    accessLevel === "readonly" || accessLevel === "full" || (!!readOnlySleeperUser && !sleeperInfo?.token);

  // Server-derived admin (email-matched) OR local admin hint (Sleeper
  // username match) — the latter only surfaces the UI; backend gates
  // requests independently. See shared/admin.ts.
  const isAdmin = useMemo(() => {
    if (serverIsAdmin) return true;
    return isAdminUser({
      email: user?.email,
      sleeperUsername: sleeperInfo?.username ?? readOnlySleeperUser?.username,
    });
  }, [serverIsAdmin, user?.email, sleeperInfo?.username, readOnlySleeperUser?.username]);

  // ── Debug helper exposed on window ─────────────────────────────────────
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
          readOnlySleeperUser,
          accessLevel,
          sleeperSource,
          legacyKeysRemovedOnLastBootstrap: legacyKeysRemoved,
          status,
        });
      };
    } catch { /* SSR / no window */ }
  }, [user, sleeperInfo, readOnlySleeperUser, accessLevel, sleeperSource, legacyKeysRemoved, status]);

  return (
    <AuthContext.Provider value={{
      status, user, sleeperInfo, sleeperSource, legacyKeysRemoved,
      accessLevel,
      readOnlySleeperUser,
      isReadOnlyConnected,
      isAuthenticatedUser,
      hasSleeperToken,
      isAdmin,
      checkSession, logout, onLoginSuccess, onSleeperConnected, onSleeperDisconnected,
      connectReadOnlySleeper, disconnectReadOnlySleeper,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
