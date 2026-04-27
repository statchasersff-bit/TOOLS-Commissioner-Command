import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";

// In-memory challenge store: sleeperId → { code, expiresAt }
const challenges = new Map<string, { code: string; expiresAt: number }>();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  const rand = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  return `SC-${rand}`;
}

export function createChallenge(sleeperId: string): string {
  const code = generateCode();
  challenges.set(sleeperId, { code, expiresAt: Date.now() + 15 * 60 * 1000 }); // 15-min TTL
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
    const res = await fetch(`https://api.sleeper.app/v1/user/${sleeperId}`);
    if (!res.ok) return { ok: false, error: "Could not reach Sleeper API." };
    const user = await res.json();
    const displayName: string = (user?.display_name ?? user?.username ?? "").toUpperCase();
    if (displayName.includes(entry.code)) {
      challenges.delete(sleeperId);
      return { ok: true };
    }
    return { ok: false, error: "Code not found in your Sleeper display name. Make sure it matches exactly and try again." };
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
