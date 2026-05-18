/**
 * Admin allowlist for Dynasty Command.
 *
 * Two parallel lists:
 *   - ADMIN_EMAILS — StatChasers account emails. This is the AUTHORITATIVE
 *     server-side check; the backend grants admin access when the
 *     authenticated DC user's email is in this list.
 *   - ADMIN_SLEEPER_USERNAMES — Sleeper handles. Used for FRONTEND UI hints
 *     only (e.g., show an admin badge to a logged-in DC user whose linked
 *     Sleeper account is in this list). NEVER trusted for backend auth —
 *     read-only Sleeper "connections" are not authenticated, so anyone
 *     could claim a username.
 *
 * Keep entries lowercase-normalized — comparisons are case-insensitive.
 *
 * For real role management, replace this file with a DB-backed roles table
 * and update isAdminUser() to consult it.
 */

const norm = (s: string | undefined | null): string => (s ?? "").trim().toLowerCase();

export const ADMIN_EMAILS: readonly string[] = [
  "maklovric@gmail.com",
];

export const ADMIN_SLEEPER_USERNAMES: readonly string[] = [
  "makitrain",
];

const EMAIL_SET = new Set(ADMIN_EMAILS.map(norm));
const SLEEPER_SET = new Set(ADMIN_SLEEPER_USERNAMES.map(norm));

/**
 * Permissive check — true if EITHER the email OR the Sleeper username
 * matches the allowlist. Suitable for frontend UI hints, where matching
 * by Sleeper username is acceptable (the worst case is showing a tools
 * button to someone who can't actually use it, since the backend will
 * still reject their requests).
 */
export function isAdminUser(user?: {
  email?: string | null;
  sleeperUsername?: string | null;
}): boolean {
  if (!user) return false;
  if (user.email && EMAIL_SET.has(norm(user.email))) return true;
  if (user.sleeperUsername && SLEEPER_SET.has(norm(user.sleeperUsername))) return true;
  return false;
}

/**
 * Strict check — only the email is consulted. Use this on the backend
 * where the email is verified (came from a DC session). Sleeper usernames
 * are NOT validated server-side, so they're not safe to trust here.
 */
export function isAdminByEmail(email?: string | null): boolean {
  if (!email) return false;
  return EMAIL_SET.has(norm(email));
}
