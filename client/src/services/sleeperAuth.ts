/**
 * Sleeper Auth Service
 *
 * Manages token-based authentication with Sleeper for write operations.
 * All credentials/tokens stay client-side — never routed through our backend.
 * Never log tokens or credentials to the console.
 */

import { SLEEPER_AUTH_ENDPOINTS } from "@/config/sleeperAuthEndpoints";

const STORAGE_KEY = "statchasers_sleeper_auth";
const SLEEPER_BASE = "https://api.sleeper.app";

export interface SleeperSession {
  token: string;
  user_id: string;
  username: string;
  avatar: string | null;
  connected_at: string;
  expires_at: string | null;
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

// ─── Auth Calls ───────────────────────────────────────────────────────────────

/**
 * Request a one-time code to be sent to the user's identifier.
 * Returns true on success.
 */
export async function requestSleeperCode(identifier: string): Promise<boolean> {
  const url = SLEEPER_AUTH_ENDPOINTS.requestCode;
  if (!url) throw new Error("Sleeper authenticated endpoint is not configured yet.");

  const res = await fetch(`${SLEEPER_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error || `Request failed (${res.status})`);
  }
  return true;
}

/**
 * Verify a one-time code and exchange it for a session token.
 */
export async function verifySleeperCode(
  identifier: string,
  code: string
): Promise<SleeperSession> {
  const url = SLEEPER_AUTH_ENDPOINTS.verifyCode;
  if (!url) throw new Error("Sleeper authenticated endpoint is not configured yet.");

  const res = await fetch(`${SLEEPER_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, code }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error || `Verification failed (${res.status})`);
  }

  const data = await res.json();
  const session: SleeperSession = {
    token: data.token ?? data.access_token ?? data.session_token ?? "",
    user_id: data.user_id ?? data.userId ?? "",
    username: data.username ?? identifier,
    avatar: data.avatar ?? null,
    connected_at: new Date().toISOString(),
    expires_at: data.expires_at ?? data.exp ?? null,
  };
  saveSleeperSession(session);
  return session;
}

/**
 * Log in directly with a manually-entered token.
 * Validates the token first, then persists the session.
 */
export async function loginWithToken(
  token: string,
  username: string
): Promise<SleeperSession> {
  const validated = await validateSleeperToken(token);
  const session: SleeperSession = {
    token,
    user_id: validated?.user_id ?? "",
    username: validated?.username ?? username,
    avatar: validated?.avatar ?? null,
    connected_at: new Date().toISOString(),
    expires_at: validated?.expires_at ?? null,
  };
  saveSleeperSession(session);
  return session;
}

/**
 * Validate a token against Sleeper.
 * Returns partial session info if the endpoint is configured, or the bare
 * minimum session shape if not (trusting the token is valid).
 */
export async function validateSleeperToken(
  token: string
): Promise<Partial<SleeperSession>> {
  const url = SLEEPER_AUTH_ENDPOINTS.validateToken;
  if (!url) {
    return {};
  }

  try {
    const res = await fetch(`${SLEEPER_BASE}${url}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Validation failed (${res.status})`);
    const data = await res.json();
    return {
      user_id: data.user_id ?? data.userId ?? "",
      username: data.username ?? "",
      avatar: data.avatar ?? null,
      expires_at: data.expires_at ?? null,
    };
  } catch {
    return {};
  }
}

/**
 * Log out: invalidate the token server-side (if endpoint configured) and clear locally.
 */
export async function logoutSleeper(): Promise<void> {
  const session = getSleeperSession();
  clearSleeperSession();

  const url = SLEEPER_AUTH_ENDPOINTS.logout;
  if (!url || !session?.token) return;

  try {
    await fetch(`${SLEEPER_BASE}${url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
    });
  } catch {
    // Silently ignore — local session already cleared
  }
}
