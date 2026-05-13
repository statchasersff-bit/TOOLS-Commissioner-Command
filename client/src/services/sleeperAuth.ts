/**
 * Sleeper Auth Service — GraphQL implementation
 *
 * All auth calls hit the single Sleeper GraphQL endpoint.
 * Credentials, OTP codes, captcha tokens, and JWTs are NEVER logged.
 * All token handling is client-side only — nothing routes through our backend.
 */

import { SLEEPER_GQL_URL } from "@/config/sleeperAuthEndpoints";

const STORAGE_KEY = "statchasers_sleeper_auth";

export interface SleeperSession {
  token: string;
  user_id: string;
  username: string;
  avatar: string | null;
  connected_at: string;
  /** ISO string derived from JWT exp claim, or null if unavailable */
  expires_at: string | null;
}

// ─── JWT helpers (client-side only, no library) ───────────────────────────────

interface JWTPayload {
  user_id?: string;
  sub?: string;
  username?: string;
  avatar?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function decodeJWT(token: string): JWTPayload | null {
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
  const payload = decodeJWT(token);
  return {
    token,
    user_id: payload?.user_id ?? payload?.sub ?? "",
    username: payload?.username ?? fallbackIdentifier,
    avatar: payload?.avatar ?? null,
    connected_at: new Date().toISOString(),
    expires_at: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
  };
}

export function isSessionExpired(session: SleeperSession): boolean {
  if (!session.expires_at) return false;
  return Date.now() >= new Date(session.expires_at).getTime();
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

export function saveSleeperSession(session: SleeperSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSleeperSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── GraphQL transport ────────────────────────────────────────────────────────

async function sleeperGQL(
  query: string,
  variables: Record<string, unknown>,
  authToken?: string
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(SLEEPER_GQL_URL, {
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
  mutation create_verification_code($email_or_phone_or_username: String!) {
    create_verification_code(
      email_or_phone_or_username: $email_or_phone_or_username
    )
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
  const data = await sleeperGQL(LOGIN_CONTEXT_QUERY, {
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
export async function requestSleeperCode(identifier: string): Promise<boolean> {
  await sleeperGQL(CREATE_VERIFICATION_CODE_MUTATION, {
    email_or_phone_or_username: identifier,
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
  const data = await sleeperGQL(LOGIN_MUTATION, {
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
