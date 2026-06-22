/**
 * Sleeper Auth Service — GraphQL implementation
 *
 * All auth calls hit the single Sleeper GraphQL endpoint.
 * Credentials, OTP codes, captcha tokens, and JWTs are NEVER logged.
 * All token handling is client-side only — nothing routes through our backend.
 */

import { SLEEPER_GQL_URL } from "@/config/sleeperAuthEndpoints";

// ─── Storage keys ─────────────────────────────────────────────────────────────
//
// Sleeper sessions MUST be scoped to the currently authenticated Dynasty
// Command user. Storing under a global key leaks sessions across DC accounts
// when the same browser is reused (severe account-isolation bug).
//
//   New keys: statchasers_sleeper_auth:<dcUserId>
//   Legacy:   statchasers_sleeper_auth (global) — purged on logout, never written
//
// activeDcUserId is set by AuthContext as soon as the DC session resolves.
// While it is null, every getter returns null and every setter refuses to
// persist. This makes it impossible to read or write a Sleeper session in a
// context where the DC user is unknown.

const SCOPED_KEY_PREFIX = "statchasers_sleeper_auth:";
const LEGACY_GLOBAL_KEY = "statchasers_sleeper_auth";
/** Legacy username cache from SleeperContext — purged on logout. */
const LEGACY_SC_USERNAME_KEY = "sc-sleeper-connection";
/** Legacy paste-JWT cache used by LiveDraft/TradeCenter/etc. */
const LEGACY_DRAFT_JWT_KEY = "dc-sleeper-draft-jwt";
/** Per-Sleeper-user finance token cache prefix from FinanceTab. */
const FINANCE_TOKEN_PREFIX = "dc-finance-token-";
/** Read-only Sleeper identity (public API, no token, no DC user). */
const READONLY_SLEEPER_KEY = "sc_readonly_sleeper";

let activeDcUserId: string | null = null;

function scopedKey(dcUserId: string): string {
  return `${SCOPED_KEY_PREFIX}${dcUserId}`;
}

/**
 * Bind the Sleeper auth store to a Commissioner Command user. Pass the DC user's
 * id as soon as the DC session is known; pass null after logout. While
 * null, reads return null and writes are refused — so no Sleeper session
 * can be loaded or persisted in a context where the DC user is unknown.
 *
 * Dispatches a window event so listening components can resync.
 */
export function setActiveDcUser(dcUserId: string | null): void {
  if (activeDcUserId === dcUserId) return;
  activeDcUserId = dcUserId;
  try {
    window.dispatchEvent(new CustomEvent("sleeper-session-changed"));
  } catch { /* SSR / no window */ }
}

export function getActiveDcUserId(): string | null {
  return activeDcUserId;
}

/**
 * Detect and remove pre-scoping legacy Sleeper keys. Returns the list of keys
 * that were found and removed, so the caller can flag the bootstrap source
 * as "legacy-cache-removed" for diagnostics.
 *
 * Call at the START of every bootstrap (checkSession) — before reading any
 * scoped session — so that no code path can ever observe a legacy global key.
 */
export function detectAndRemoveLegacySleeperKeys(): string[] {
  const removed: string[] = [];
  try {
    const legacyKeys = [
      LEGACY_GLOBAL_KEY,
      LEGACY_SC_USERNAME_KEY,
      LEGACY_DRAFT_JWT_KEY,
    ];
    for (const k of legacyKeys) {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        removed.push(k);
      }
    }
  } catch { /* ignore */ }
  return removed;
}

/**
 * Purge every Sleeper-related localStorage entry across all DC users.
 * Call on full DC logout so a future sign-in cannot inherit prior state.
 */
export function purgeAllSleeperLocalState(): void {
  const toDelete: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k === LEGACY_GLOBAL_KEY ||
        k === LEGACY_SC_USERNAME_KEY ||
        k === LEGACY_DRAFT_JWT_KEY ||
        k === READONLY_SLEEPER_KEY ||
        k.startsWith(SCOPED_KEY_PREFIX) ||
        k.startsWith(FINANCE_TOKEN_PREFIX)
      ) {
        toDelete.push(k);
      }
    }
    for (const k of toDelete) localStorage.removeItem(k);
  } catch { /* ignore quota / privacy mode */ }
  activeDcUserId = null;
  try {
    window.dispatchEvent(new CustomEvent("sleeper-session-changed"));
  } catch { /* SSR / no window */ }
}

// ─── Session shape ────────────────────────────────────────────────────────────
// Matches the JWT payload fields exactly. Do NOT add server-derived fields here.

export interface SleeperSession {
  token: string;
  user_id: string;
  display_name: string;
  avatar: string | null;
  /** Raw JWT exp claim (seconds since epoch). Use isSessionExpired() to check. */
  exp: number | null;
  /** Raw JWT iat claim (seconds since epoch). */
  iat: number | null;
}

// ─── JWT helpers (client-side only, no library) ───────────────────────────────

interface JWTPayload {
  user_id?: string;
  sub?: string;
  display_name?: string;
  username?: string;
  avatar?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

/**
 * Decode a Sleeper JWT client-side using base64/atob.
 * Never log the token or return value.
 * Returns null if the token is malformed.
 */
export function decodeSleeperJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    return JSON.parse(json) as JWTPayload;
  } catch {
    return null;
  }
}

function sessionFromJWT(token: string, fallbackIdentifier: string): SleeperSession {
  const payload = decodeSleeperJWT(token);
  return {
    token,
    user_id: payload?.user_id ?? payload?.sub ?? "",
    display_name: payload?.display_name ?? payload?.username ?? fallbackIdentifier,
    avatar: payload?.avatar ?? null,
    exp: payload?.exp ?? null,
    iat: payload?.iat ?? null,
  };
}

export function isSessionExpired(session: SleeperSession): boolean {
  if (!session.exp) return false;
  return Date.now() >= session.exp * 1000;
}

// ─── Storage (DC-user-scoped) ────────────────────────────────────────────────

/**
 * Returns the Sleeper session for the currently-bound DC user, or null if no
 * DC user is bound (e.g. before AuthContext has resolved). Never returns
 * another DC user's session even if leftover data exists in localStorage.
 */
export function getSleeperSession(): SleeperSession | null {
  if (!activeDcUserId) return null;
  try {
    const raw = localStorage.getItem(scopedKey(activeDcUserId));
    if (!raw) return null;
    return JSON.parse(raw) as SleeperSession;
  } catch {
    return null;
  }
}

/**
 * Read only the token string from localStorage without parsing the full object.
 * Never log the return value.
 */
export function getSleeperToken(): string | null {
  return getSleeperSession()?.token ?? null;
}

export function saveSleeperSession(session: SleeperSession): void {
  if (!activeDcUserId) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(
        "[sleeper-auth] saveSleeperSession called without an active DC user; refusing to persist."
      );
    }
    return;
  }
  try {
    localStorage.setItem(scopedKey(activeDcUserId), JSON.stringify(session));
    window.dispatchEvent(new CustomEvent("sleeper-session-changed"));
  } catch { /* ignore */ }
}

export function clearSleeperSession(): void {
  if (!activeDcUserId) return;
  try {
    localStorage.removeItem(scopedKey(activeDcUserId));
    window.dispatchEvent(new CustomEvent("sleeper-session-changed"));
  } catch { /* ignore */ }
}

// ─── GraphQL transport (api.sleeper.app — auth operations only) ───────────────
//
// The auth endpoint (api.sleeper.app/graphql) uses standard Bearer format.
// Do NOT use this for sleeper.com/graphql — see sleeperAuthedApi.ts.

export async function sleeperGQL(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  authToken?: string
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Sleeper API error (${res.status})`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Sleeper authentication failed.");
  }
  return json.data ?? {};
}

// ─── GraphQL queries / mutations ──────────────────────────────────────────────

const LOGIN_CONTEXT_QUERY = `
  query login_context($email_or_phone_or_username: String!) {
    login_context_by_email_or_phone_or_username(
      email_or_phone_or_username: $email_or_phone_or_username
    ) {
      display
      has_password
    }
  }
`;

const CREATE_VERIFICATION_CODE_MUTATION = `
  mutation create_verification_code($email_or_phone: String!, $captcha: String) {
    create_verification_code(email_or_phone: $email_or_phone, captcha: $captcha)
  }
`;

const LOGIN_MUTATION = `
  query login(
    $email_or_phone_or_username: String!,
    $password: String!,
    $captcha: String
  ) {
    login(
      email_or_phone_or_username: $email_or_phone_or_username,
      password: $password,
      captcha: $captcha
    ) {
      token
    }
  }
`;

// ─── Public auth functions ────────────────────────────────────────────────────

/**
 * Fetch login context for an identifier.
 * Returns whether the account uses a password or OTP flow.
 */
export async function getLoginContext(identifier: string): Promise<{
  display: string | null;
  has_password: boolean;
}> {
  const data = await sleeperGQL(SLEEPER_GQL_URL, LOGIN_CONTEXT_QUERY, {
    email_or_phone_or_username: identifier,
  });
  const ctx = (data.login_context_by_email_or_phone_or_username as any) ?? {};
  return {
    display: ctx.display ?? null,
    has_password: ctx.has_password ?? false,
  };
}

/**
 * Send a one-time verification code to the user's email/phone.
 * Returns true on success.
 */
export async function requestSleeperCode(identifier: string, captchaToken: string): Promise<boolean> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error("Enter your Sleeper username, email, or phone.");
  }
  await sleeperGQL(SLEEPER_GQL_URL, CREATE_VERIFICATION_CODE_MUTATION, {
    email_or_phone: trimmed,
    captcha: captchaToken,
  });
  return true;
}

/**
 * Log in with a password or OTP code + hCaptcha token.
 * The `password` field accepts either the user's password or the OTP code sent via requestSleeperCode().
 * Never log `password` or `captchaToken`.
 */
export async function loginWithCredentials(
  identifier: string,
  password: string,
  captchaToken: string
): Promise<SleeperSession> {
  const data = await sleeperGQL(SLEEPER_GQL_URL, LOGIN_MUTATION, {
    email_or_phone_or_username: identifier,
    password,
    captcha: captchaToken,
  });

  const token: string = (data.login as any)?.token;
  if (!token) throw new Error("Login failed. No token returned from Sleeper.");

  const session = sessionFromJWT(token, identifier);
  saveSleeperSession(session);
  return session;
}

/**
 * Store a manually-entered JWT token by decoding it client-side.
 * No network call required.
 */
export async function loginWithToken(
  token: string,
  fallbackUsername = "unknown"
): Promise<SleeperSession> {
  const session = sessionFromJWT(token.trim(), fallbackUsername);
  if (!session.token) throw new Error("Invalid token. Could not parse.");
  saveSleeperSession(session);
  return session;
}

/**
 * Log out: clear local session. No server-side invalidation endpoint is known yet.
 */
export async function logoutSleeper(): Promise<void> {
  clearSleeperSession();
}
