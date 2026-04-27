import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";

const SLEEPER_AUTH = "https://api.sleeper.app/v1/auth";
const SLEEPER_API  = "https://api.sleeper.app/v1";

const SLEEPER_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Sleeper/10.0.0 CFNetwork/1408.0.4 Darwin/22.5.0",
  "Accept": "application/json",
};

// ── Sleeper token confirmation (server-side only) ─────────────────────────────
// The browser handles send_code + verify directly with Sleeper.
// We only receive the resulting Sleeper token and confirm it here.

export async function confirmSleeperToken(
  sleeperToken: string,
  expectedSleeperId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await fetch(`${SLEEPER_API}/user/me`, {
      headers: { ...SLEEPER_HEADERS, Authorization: `Bearer ${sleeperToken}` },
    });
    if (!me.ok) return { ok: false, error: "Could not verify your Sleeper session." };
    const meData = await me.json();
    const confirmedId: string = meData?.user_id ?? meData?.id ?? "";
    if (!confirmedId) return { ok: false, error: "Sleeper did not return a user ID." };
    if (confirmedId !== expectedSleeperId) {
      return { ok: false, error: "The Sleeper account you verified doesn't match your connected account." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

// ── Fallback: display-name challenge ─────────────────────────────────────────

const challenges = new Map<string, { code: string; expiresAt: number }>();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  return "SC-" + Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

export function createChallenge(sleeperId: string): string {
  const code = generateCode();
  challenges.set(sleeperId, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
  return code;
}

export function getChallenge(sleeperId: string): string | null {
  const entry = challenges.get(sleeperId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { challenges.delete(sleeperId); return null; }
  return entry.code;
}

export async function verifyChallenge(sleeperId: string): Promise<{ ok: boolean; error?: string }> {
  const entry = challenges.get(sleeperId);
  if (!entry) return { ok: false, error: "No active challenge. Please refresh and try again." };
  if (Date.now() > entry.expiresAt) {
    challenges.delete(sleeperId);
    return { ok: false, error: "Challenge expired. Please refresh to get a new code." };
  }
  try {
    const res = await fetch(`${SLEEPER_API}/user/${sleeperId}`);
    if (!res.ok) return { ok: false, error: "Could not reach Sleeper API." };
    const user = await res.json();
    const displayName: string = (user?.display_name ?? user?.username ?? "").toUpperCase();
    if (displayName.includes(entry.code)) { challenges.delete(sleeperId); return { ok: true }; }
    return { ok: false, error: "Code not found in your Sleeper display name." };
  } catch {
    return { ok: false, error: "Network error reaching Sleeper API." };
  }
}

export function signToken(sleeperId: string): string {
  return jwt.sign({ sleeperId }, JWT_SECRET, { expiresIn: "90d" });
}

export function verifyToken(token: string): { sleeperId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sleeperId: string };
  } catch {
    return null;
  }
}

export function requireFinanceAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  const userId = (req.params.userId || req.params.sleeperUserId || req.body?.sleeperUserId) as string | undefined;
  if (userId && payload.sleeperId !== userId) return res.status(403).json({ error: "Forbidden" });
  (req as any).sleeperId = payload.sleeperId;
  next();
}
