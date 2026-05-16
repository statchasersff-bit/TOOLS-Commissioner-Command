import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { eq, and, gt, isNull, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { scUsers, emailVerificationCodes, scConnectedAccounts } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const CIPHER_KEY = crypto.createHash("sha256").update(JWT_SECRET).digest();

let _db: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!_db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    _db = drizzle(pool);
  }
  return _db;
}

// ── Encryption (AES-256-CBC) ──────────────────────────────────────────────────

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", CIPHER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptToken(ciphertext: string): string | null {
  try {
    const [ivHex, encHex] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", CIPHER_KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── In-memory rate limiting ───────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxCount: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= maxCount) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count++;
  return { allowed: true };
}

// ── Email sending (Resend) ────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}\nBody: ${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StatChasers <noreply@mail.statchasers.com>",
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown error");
    throw new Error(`Email delivery failed: ${err}`);
  }
}

// ── Verification codes ────────────────────────────────────────────────────────

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendVerificationCode(
  email: string,
  purpose: "signup" | "password_reset",
  ip: string,
): Promise<{ ok: boolean; error?: string }> {
  const emailKey = `email:${email.toLowerCase()}:${purpose}`;
  const emailLimit = checkRateLimit(emailKey, 3);
  if (!emailLimit.allowed) {
    const mins = Math.ceil((emailLimit.retryAfterMs ?? WINDOW_MS) / 60000);
    return { ok: false, error: `Too many codes sent. Please wait ${mins} minute(s) before requesting another.` };
  }

  const ipKey = `ip:${ip}:code`;
  const ipLimit = checkRateLimit(ipKey, 10);
  if (!ipLimit.allowed) {
    return { ok: false, error: "Too many requests from your network. Please try again later." };
  }

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await getDb().insert(emailVerificationCodes).values({
    email: email.toLowerCase(),
    codeHash,
    purpose,
    expiresAt,
  });

  const subjects: Record<string, string> = {
    signup: "Your StatChasers verification code",
    password_reset: "Reset your StatChasers password",
  };
  const bodies: Record<string, string> = {
    signup: `Your StatChasers verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
    password_reset: `Your StatChasers password reset code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
  };

  await sendEmail(email, subjects[purpose], bodies[purpose]);
  return { ok: true };
}

export async function verifyCode(
  email: string,
  code: string,
  purpose: "signup" | "password_reset",
  ip: string,
): Promise<{ ok: boolean; verifiedToken?: string; error?: string }> {
  const ipKey = `ip:${ip}:verify`;
  const ipLimit = checkRateLimit(ipKey, 10);
  if (!ipLimit.allowed) {
    return { ok: false, error: "Too many verification attempts. Please try again later." };
  }

  const rows = await getDb()
    .select()
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, email.toLowerCase()),
        eq(emailVerificationCodes.purpose, purpose),
        isNull(emailVerificationCodes.usedAt),
        gt(emailVerificationCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailVerificationCodes.id))
    .limit(5);

  if (!rows.length) {
    return { ok: false, error: "Code not found or expired. Please request a new one." };
  }

  for (const row of rows) {
    const match = await bcrypt.compare(code.trim(), row.codeHash);
    if (match) {
      await getDb()
        .update(emailVerificationCodes)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationCodes.id, row.id));

      const verifiedToken = jwt.sign(
        { email: email.toLowerCase(), purpose },
        JWT_SECRET,
        { expiresIn: "15m" },
      );
      return { ok: true, verifiedToken };
    }
  }

  return { ok: false, error: "Incorrect code. Please check and try again." };
}

export function parseVerifiedToken(token: string, expectedPurpose: string): { email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { email: string; purpose: string };
    if (payload.purpose !== expectedPurpose) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

// ── User management ───────────────────────────────────────────────────────────

export async function registerUser(
  email: string,
  password: string,
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await getDb()
    .select({ id: scUsers.id })
    .from(scUsers)
    .where(eq(scUsers.email, email.toLowerCase()))
    .limit(1);

  if (existing.length) {
    return { ok: false, error: "An account with this email already exists. Please log in." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await getDb()
    .insert(scUsers)
    .values({ email: email.toLowerCase(), passwordHash, emailVerified: true })
    .returning({ id: scUsers.id });

  return { ok: true, userId: rows[0].id };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const rows = await getDb()
    .select()
    .from(scUsers)
    .where(eq(scUsers.email, email.toLowerCase()))
    .limit(1);

  if (!rows.length) {
    return { ok: false, error: "No account found with this email address." };
  }

  const user = rows[0];
  if (!user.emailVerified) {
    return { ok: false, error: "Email not verified. Please complete your registration." };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: "Incorrect password." };
  }

  await getDb()
    .update(scUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(scUsers.id, user.id));

  return { ok: true, userId: user.id };
}

export async function resetPassword(
  email: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const hash = await bcrypt.hash(newPassword, 12);
  const result = await getDb()
    .update(scUsers)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(scUsers.email, email.toLowerCase()))
    .returning({ id: scUsers.id });

  if (!result.length) {
    return { ok: false, error: "Account not found." };
  }
  return { ok: true };
}

export async function getUser(userId: string) {
  const rows = await getDb()
    .select({ id: scUsers.id, email: scUsers.email, createdAt: scUsers.createdAt })
    .from(scUsers)
    .where(eq(scUsers.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Connected accounts ────────────────────────────────────────────────────────

export async function getConnectedSleeper(userId: string) {
  const rows = await getDb()
    .select()
    .from(scConnectedAccounts)
    .where(
      and(
        eq(scConnectedAccounts.userId, userId),
        eq(scConnectedAccounts.provider, "sleeper"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function connectSleeper(
  userId: string,
  sleeperUsername: string,
  sleeperUserId: string,
  token: string,
): Promise<void> {
  const encryptedToken = encryptToken(token);
  const existing = await getConnectedSleeper(userId);
  if (existing) {
    await getDb()
      .update(scConnectedAccounts)
      .set({ sleeperUsername, sleeperUserId, encryptedToken, updatedAt: new Date() })
      .where(eq(scConnectedAccounts.id, existing.id));
  } else {
    await getDb()
      .insert(scConnectedAccounts)
      .values({ userId, provider: "sleeper", sleeperUsername, sleeperUserId, encryptedToken });
  }
}

export async function disconnectSleeper(userId: string): Promise<void> {
  await getDb()
    .delete(scConnectedAccounts)
    .where(
      and(
        eq(scConnectedAccounts.userId, userId),
        eq(scConnectedAccounts.provider, "sleeper"),
      ),
    );
}
