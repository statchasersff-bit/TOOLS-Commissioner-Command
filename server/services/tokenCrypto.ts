import crypto from "crypto";

/**
 * Authenticated encryption for OAuth tokens stored in `platform_connections`.
 *
 * Uses AES-256-GCM keyed off `TOKEN_ENCRYPTION_KEY`. GCM (vs the legacy
 * AES-256-CBC in scAuth.ts) gives us integrity — a tampered ciphertext fails to
 * decrypt rather than silently returning garbage, which matters for tokens we
 * later hand to Yahoo.
 *
 * Ciphertext format: "<ivHex>:<authTagHex>:<dataHex>".
 *
 * Key handling: we accept either a 64-char hex string (exact 32 bytes) or any
 * passphrase, which we SHA-256 into a 32-byte key. In production
 * TOKEN_ENCRYPTION_KEY must be set; in dev we fall back to SESSION_SECRET so the
 * app still boots, with a one-time warning.
 */

let warned = false;

function resolveKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw && raw.length > 0) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    return crypto.createHash("sha256").update(raw).digest();
  }
  const fallback = process.env.SESSION_SECRET;
  if (!fallback) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set and no SESSION_SECRET fallback is available; refusing to encrypt tokens with a default key.",
    );
  }
  if (!warned) {
    console.warn(
      "[tokenCrypto] TOKEN_ENCRYPTION_KEY not set — falling back to SESSION_SECRET. Set TOKEN_ENCRYPTION_KEY in production.",
    );
    warned = true;
  }
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = resolveKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/** True when a usable encryption key is configured (either dedicated or fallback). */
export function hasEncryptionKey(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET);
}
