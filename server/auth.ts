import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { financePasswords } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const SALT_ROUNDS = 12;

let db: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool);
  }
  return db;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
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

export async function hasPassword(sleeperId: string): Promise<boolean> {
  const d = getDb();
  const rows = await d.select().from(financePasswords).where(eq(financePasswords.sleeperUserId, sleeperId)).limit(1);
  return rows.length > 0;
}

export async function getPasswordHash(sleeperId: string): Promise<string | null> {
  const d = getDb();
  const rows = await d.select().from(financePasswords).where(eq(financePasswords.sleeperUserId, sleeperId)).limit(1);
  return rows[0]?.passwordHash ?? null;
}

export async function setPasswordHash(sleeperId: string, hash: string): Promise<void> {
  const d = getDb();
  const existing = await d.select().from(financePasswords).where(eq(financePasswords.sleeperUserId, sleeperId)).limit(1);
  if (existing.length > 0) {
    await d.update(financePasswords).set({ passwordHash: hash }).where(eq(financePasswords.sleeperUserId, sleeperId));
  } else {
    await d.insert(financePasswords).values({ sleeperUserId: sleeperId, passwordHash: hash });
  }
}

export function requireFinanceAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const userId = (req.params.userId || req.params.sleeperUserId || req.body?.sleeperUserId) as string | undefined;
  if (userId && payload.sleeperId !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  (req as any).sleeperId = payload.sleeperId;
  next();
}
