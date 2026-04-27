import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { financePasswords } from "@shared/schema";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const SLEEPER_API  = "https://api.sleeper.app/v1";

let _db: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!_db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    _db = drizzle(pool);
  }
  return _db;
}

// ── Finance password management ───────────────────────────────────────────────

export async function hasFinancePassword(sleeperId: string): Promise<boolean> {
  const rows = await getDb().select().from(financePasswords).where(eq(financePasswords.sleeperUserId, sleeperId)).limit(1);
  return rows.length > 0;
}

export async function setFinancePassword(sleeperId: string, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 12);
  await getDb()
    .insert(financePasswords)
    .values({ sleeperUserId: sleeperId, passwordHash: hash })
    .onConflictDoUpdate({ target: financePasswords.sleeperUserId, set: { passwordHash: hash } });
}

export async function checkFinancePassword(sleeperId: string, password: string): Promise<boolean> {
  const rows = await getDb().select().from(financePasswords).where(eq(financePasswords.sleeperUserId, sleeperId)).limit(1);
  if (!rows.length) return false;
  return bcrypt.compare(password, rows[0].passwordHash);
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
