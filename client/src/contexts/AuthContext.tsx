import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
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
import { getBrowserAppMode } from "@/lib/appMode";
import {
  isDevRuntime,
  isDevSubscriptionOverride,
  isDevSleeperConnectedOverride,
  anyDevOverrideActive,
  type AppMode,
} from "@shared/appMode";

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

export interface SubscriptionInfo {
  status: string;
  plan: string | null;
  currentPeriodEnd: number | null;
  active: boolean;
}

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

  // ── Domain-based app mode + subscription entitlement ───────────────────
  // `appMode` is the server's authoritative answer for the current host;
  // `isWriteAccessDomain` is true when we're allowed to expose write
  // features at all (subscription gate is separate).
  appMode: AppMode;
  isWriteAccessDomain: boolean;
  subscription: SubscriptionInfo;
  /**
   * Composite "can the UI render write controls right now?" flag:
   *   write-access domain  &&  authenticated  &&  has Sleeper token  &&  active subscription
   * The backend enforces the same condition — this is for hiding UI.
   */
  canPerformWriteActions: boolean;
  /**
   * Dev override snapshot — populated only in non-production builds.
   * `active` is true when ANY override is in force; the per-field flags
   * tell the UI which gate is being bypassed. Never set in production.
   */
  devOverrides: { active: boolean; appMode: boolean; subscription: boolean; sleeperConnected: boolean } | null;

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

  // App mode + subscription. Defaults to a safe browser-derived value so
  // the UI can render on an unauthenticated visit; /me overrides with the
  // server's canonical answer once a session exists.
  const [serverAppMode, setServerAppMode] = useState<AppMode | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo>({
    status: "inactive",
    plan: null,
    currentPeriodEnd: null,
    active: false,
  });

  const checkSession = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.info("[sc-auth] auth check started");

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

    // The final status we'll commit in `finally`. Default = guest. Every
    // path in this function only *proposes* a status; the finally block
    // is the ONLY place that actually releases the bootstrap splash.
    // That guarantee is the whole point — neither a hang, an AbortError,
    // nor an unexpected throw can leave the user staring at a loader.
    let finalStatus: AuthStatus = "unauthenticated";

    // clearJwt=true only for genuine 401s (token invalid/expired).
    // Network failures and 5xx errors must NOT clear the token — the server
    // may be temporarily down and the token is still valid. Wiping it on a
    // transient error is what caused users to get silently logged out.
    const failClosedNoDc = (reason: string, clearJwt = false) => {
      // eslint-disable-next-line no-console
      console.info(`[sc-auth] no DC session (${reason}) — proceeding without StatChasers account`);
      if (clearJwt) clearToken();
      setUser(null);
      setSleeperInfo(null);
      setServerIsAdmin(false);
      setSleeperSource(readOnly ? "read-only" : "none");
      finalStatus = "unauthenticated";
    };

    try {
      const headers = { "Content-Type": "application/json", ...authHeaders() };

      // Generous timeout. Replit deployments can take ~15s to cold-boot;
      // the previous 10s was tripping on healthy-but-warming backends and
      // surfacing as the "AbortError: signal is aborted without reason"
      // the user saw. 25s lets the server wake; the finally block still
      // guarantees the splash releases.
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 25_000);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/sc-auth/me`, {
          credentials: "include",
          headers,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // eslint-disable-next-line no-console
      console.info(`[sc-auth] /api/sc-auth/me status: ${res.status}`);

      if (res.status === 401) {
        // The server may be warming up and the session is simply empty —
        // that's NOT a reason to wipe a perfectly valid JWT. We only clear
        // the token when the server explicitly tells us the JWT itself is
        // cryptographically bad (jwtBad: true). Any other 401 (no session,
        // DB not yet ready, etc.) is treated like a transient failure: keep
        // the token and let the retry logic below handle it.
        const body = await res.json().catch(() => null);
        const tokenIsBad = !!(body as any)?.jwtBad;
        // eslint-disable-next-line no-console
        console.info(`[sc-auth] 401 from /me — jwtBad=${tokenIsBad}`);
        failClosedNoDc("401 from /me", tokenIsBad);
        if (!tokenIsBad && getStoredToken()) {
          // Server said "not authenticated" but the JWT looks fine locally —
          // treat this like a network hiccup and retry.
          if (retryCountRef.current < 5) {
            retryCountRef.current += 1;
            const delayMs = Math.min(5_000 * retryCountRef.current, 20_000);
            // eslint-disable-next-line no-console
            console.info(`[sc-auth] 401 without jwtBad — retry ${retryCountRef.current} in ${delayMs / 1000}s`);
            retryTimerRef.current = setTimeout(() => { void checkSession(); }, delayMs);
            finalStatus = "loading";
          }
        }
        return;
      }
      // Any other non-OK (5xx, 404 from a misrouted proxy, etc.) degrades
      // to guest mode but intentionally keeps the JWT intact — the server
      // may be temporarily unavailable and the token is still valid.
      if (!res.ok) { failClosedNoDc(`status ${res.status} from /me`); return; }

      const data = await res.json().catch(() => null);
      if (!data) { failClosedNoDc("/me returned non-JSON"); return; }
      if (!data.user) { failClosedNoDc("/me returned no user"); return; }

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

      // If the server authenticated via the JWT cookie (localStorage was
      // empty/cleared), it echoes the token back as `freshToken`. Restore it
      // to localStorage so subsequent requests use the Authorization header
      // path again instead of relying on the cookie every time.
      if (data.freshToken && !getStoredToken()) {
        // eslint-disable-next-line no-console
        console.info("[sc-auth] restoring sc_auth_token from server JWT cookie");
        saveToken(data.freshToken);
      }

      // Successful auth — reset the retry counter so any future overnight
      // restart gets the full 5-retry budget again.
      retryCountRef.current = 0;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }

      setUser(data.user);
      setServerIsAdmin(!!data.isAdmin);
      // /me now carries the server-canonical app mode + subscription so
      // the client can hide write controls without guessing from URL.
      if (data.appMode === "READ_ONLY" || data.appMode === "WRITE_ACCESS") {
        setServerAppMode(data.appMode);
      }
      if (data.subscription && typeof data.subscription === "object") {
        setSubscription({
          status: typeof data.subscription.status === "string" ? data.subscription.status : "inactive",
          plan: typeof data.subscription.plan === "string" ? data.subscription.plan : null,
          currentPeriodEnd:
            typeof data.subscription.currentPeriodEnd === "number"
              ? data.subscription.currentPeriodEnd
              : null,
          active: !!data.subscription.active,
        });
      }
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
        finalStatus = "ready";
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
        finalStatus = "needs-sleeper";
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
      // AbortError = our own timeout fired, not a real failure. Other
      // throws = network/DNS/CORS failures. Both degrade to guest mode;
      // we only log them at warn level so they don't look like crashes.
      // IMPORTANT: do NOT clear the JWT here — the server may be temporarily
      // unavailable. Keeping the token means the next page load will restore
      // the session automatically once the server is back up.
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const storedToken = getStoredToken();
      const MAX_RETRIES = 5;
      // eslint-disable-next-line no-console
      console.warn(
        `[sc-auth] session check ${isAbort ? "timed out" : "failed"}`,
        storedToken
          ? `— token preserved, retry ${retryCountRef.current + 1}/${MAX_RETRIES}`
          : "— no token, continuing as guest",
        err
      );
      setUser(null);
      setSleeperInfo(null);
      setServerIsAdmin(false);
      setSleeperSource(readOnly ? "read-only" : "none");

      // If a JWT exists and we haven't exhausted retries, keep showing the
      // loading screen and retry automatically. This recovers from overnight
      // VM restarts without forcing the user to manually refresh or log in.
      if (storedToken && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        const delayMs = Math.min(5_000 * retryCountRef.current, 20_000);
        // eslint-disable-next-line no-console
        console.info(`[sc-auth] scheduling retry ${retryCountRef.current} in ${delayMs / 1000}s`);
        retryTimerRef.current = setTimeout(() => { void checkSession(); }, delayMs);
        finalStatus = "loading"; // keep the splash, not the login screen
      } else {
        // No token or retries exhausted — surface guest mode so the user
        // can at least use the app as a guest.
        retryCountRef.current = 0;
        finalStatus = "unauthenticated";
      }
    } finally {
      // Single point of release. No code path above sets `status` directly,
      // so this line is the *only* thing that can flip the bootstrap splash
      // off — making "stuck on loading screen" structurally impossible.
      setStatus(finalStatus);
      // eslint-disable-next-line no-console
      console.info(`[sc-auth] auth check finished — status: ${finalStatus}`);
    }
  }, []);

  // Retry state for server-restart recovery. When the server is temporarily
  // unreachable and we have a stored JWT, we keep showing "loading" and
  // schedule an automatic retry so the user doesn't land on the login screen
  // after an overnight VM restart. Cap at 5 retries (~60s total) to avoid
  // spinning indefinitely when the server is genuinely unavailable.
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // StrictMode (and any incidental remount) would otherwise fire two
  // overlapping /me requests on first paint. The ref guard makes the
  // initial bootstrap exactly-once; explicit re-checks via onLoginSuccess /
  // onSleeperConnected still go through `checkSession` directly.
  const bootstrapRanRef = useRef(false);
  useEffect(() => {
    if (bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;
    void checkSession();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
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
    // The server-side handler fire-and-forget enqueues a depth-1 ADP crawl
    // for this Sleeper user (cooldown-gated). Surface the same affordance
    // here as the read-only connect path so users see consistent UX.
    toast({
      title: "Sleeper connected",
      description: "We'll scan eligible dynasty drafts in the background to improve ADP.",
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

  // Prefer server's answer for app mode; fall back to the browser-derived
  // value when no /me response is in hand yet (guest visits). Both already
  // honor DEV_APP_MODE in non-production.
  const appMode: AppMode = serverAppMode ?? getBrowserAppMode();
  const isWriteAccessDomainFlag = appMode === "WRITE_ACCESS";

  // Dev-only overrides (never apply in production). Mirror server-side
  // bypass logic so the UI's view of "subscribed / Sleeper-connected"
  // matches what the backend will honor on the next request.
  const subOverride = isDevSubscriptionOverride();
  const sleeperOverride = isDevSleeperConnectedOverride();
  const effectiveSubscription: SubscriptionInfo = subOverride
    ? { ...subscription, status: "active", active: true, plan: subscription.plan ?? "dev_override" }
    : subscription;
  const effectiveHasSleeperToken = sleeperOverride ? true : hasSleeperToken;
  const effectiveIsAuthenticated = subOverride || sleeperOverride ? true : isAuthenticatedUser;
  // Synthetic devOverrides — only populated outside production.
  const devOverrides = isDevRuntime()
    ? {
        active: anyDevOverrideActive(),
        appMode: false, // resolved inside getAppMode; surfaced for the banner only when DEV_APP_MODE was read
        subscription: subOverride,
        sleeperConnected: sleeperOverride,
      }
    : null;

  // Composite "may we render write affordances?" — every leg of the
  // server-side write gate, in client form. Defense in depth: the server
  // still re-checks all of these on the actual request.
  const canPerformWriteActions =
    isWriteAccessDomainFlag &&
    effectiveIsAuthenticated &&
    effectiveHasSleeperToken &&
    effectiveSubscription.active;

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
      isAuthenticatedUser: effectiveIsAuthenticated,
      hasSleeperToken: effectiveHasSleeperToken,
      isAdmin,
      appMode,
      isWriteAccessDomain: isWriteAccessDomainFlag,
      subscription: effectiveSubscription,
      canPerformWriteActions,
      devOverrides,
      checkSession, logout, onLoginSuccess, onSleeperConnected, onSleeperDisconnected,
      connectReadOnlySleeper, disconnectReadOnlySleeper,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
