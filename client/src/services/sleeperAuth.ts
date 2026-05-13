/**
 * Sleeper Auth Service — GraphQL implementation
 *
 * All auth calls hit the single Sleeper GraphQL endpoint.
 * Credentials, OTP codes, captcha tokens, and JWTs are NEVER logged.
 * All token handling is client-side only — nothing routes through our backend.
 */

import { SLEEPER_GQL_URL } from "@/config/sleeperAuthEndpoints";

const STORAGE_KEY = "statchasers_sleeper_auth";

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

// ─── Storage ─────────────────────────────────────────────────────────────────

export function getSleeperSession(): SleeperSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
  const session = getSleeperSession();
  return session?.token ?? null;
}

export function saveSleeperSession(session: SleeperSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSleeperSession(): void {
  localStorage.removeItem(STORAGE_KEY);
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
  if (!token) throw new Error("Login failed — no token returned from Sleeper.");

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
  if (!session.token) throw new Error("Invalid token — could not parse.");
  saveSleeperSession(session);
  return session;
}

/**
 * Log out: clear local session. No server-side invalidation endpoint is known yet.
 */
export async function logoutSleeper(): Promise<void> {
  clearSleeperSession();
}
