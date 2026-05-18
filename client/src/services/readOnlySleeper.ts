/**
 * Read-only Sleeper identity — public-API connection without StatChasers login.
 *
 * Stores just `{username, userId}` in localStorage. There is NO token, no
 * password, no captcha. We resolve the username via the public Sleeper API
 * (`/api/sleeper/user/:username`) which returns the user_id. After that we
 * use the public read endpoints (leagues, rosters, matchups) exactly like
 * the authenticated mode does — they don't require auth.
 *
 * This key is INTENTIONALLY NOT scoped to a DC user (there isn't one yet).
 * On DC sign-in:
 *   - if the DC user has a server-linked Sleeper that differs, drop this.
 *   - if not, the DC user inherits the read-only username (still no token).
 */

import { fetchSleeperUser } from "@/lib/sleeperApi";

const READONLY_KEY = "sc_readonly_sleeper";

export interface ReadOnlySleeperIdentity {
  username: string;
  userId: string;
}

export function getReadOnlySleeper(): ReadOnlySleeperIdentity | null {
  try {
    const raw = localStorage.getItem(READONLY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReadOnlySleeperIdentity>;
    if (!parsed.username || !parsed.userId) return null;
    return { username: parsed.username, userId: parsed.userId };
  } catch {
    return null;
  }
}

export function saveReadOnlySleeper(id: ReadOnlySleeperIdentity): void {
  try {
    localStorage.setItem(READONLY_KEY, JSON.stringify(id));
    window.dispatchEvent(new CustomEvent("readonly-sleeper-changed"));
  } catch { /* ignore quota / privacy mode */ }
}

export function clearReadOnlySleeper(): void {
  try {
    localStorage.removeItem(READONLY_KEY);
    window.dispatchEvent(new CustomEvent("readonly-sleeper-changed"));
  } catch { /* ignore */ }
}

/** Localstorage key — exported so the central purge helper can include it. */
export const READONLY_SLEEPER_KEY = READONLY_KEY;

/**
 * Resolve a Sleeper username to a user_id via the public API and persist it.
 * Throws on not-found or network failure.
 */
export async function connectReadOnlySleeperByUsername(
  username: string
): Promise<ReadOnlySleeperIdentity> {
  const trimmed = username.trim();
  if (!trimmed) throw new Error("Enter a Sleeper username.");
  const user = await fetchSleeperUser(trimmed);
  if (!user?.userId) throw new Error("Sleeper user not found.");
  const identity: ReadOnlySleeperIdentity = {
    username: user.username || trimmed,
    userId: user.userId,
  };
  saveReadOnlySleeper(identity);
  return identity;
}
