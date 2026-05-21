import { getSleeperSession } from "@/services/sleeperAuth";

const DEV_JWT_KEY = "dc-sleeper-draft-jwt";

/**
 * Returns the Sleeper JWT for GraphQL requests (e.g. draft messages).
 *
 * Priority:
 *   1. Scoped session store — set automatically by the full Sleeper connect
 *      flow (onSleeperConnected → saveSleeperSession). Preferred source.
 *   2. DEV only — legacy manual-paste key used during internal testing.
 *
 * Never reads from unsecured / global keys outside development.
 * Never call this in a render; pass the token as a prop or derive it from
 * useAuth().sleeperInfo.token in a component.
 */
export function getSleeperAuthToken(): string | null {
  const session = getSleeperSession();
  if (session?.token) return session.token;

  if (import.meta.env.DEV) {
    try {
      const dev = localStorage.getItem(DEV_JWT_KEY);
      if (dev) return dev;
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Masks a JWT for safe console logging — shows only the first 6 and last 4
 * characters to help identify a token without exposing it.
 * Never log full JWTs.
 */
export function maskToken(token: string): string {
  if (!token || token.length <= 10) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export { DEV_JWT_KEY };
