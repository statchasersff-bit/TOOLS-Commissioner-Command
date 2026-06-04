import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { platformConnections, type PlatformConnection } from "@shared/schema";
import { decryptSecret, encryptSecret } from "./tokenCrypto";

/**
 * Repository for the platform-adapter connection layer (`platform_connections`).
 *
 * This is the ONLY module that reads/writes encrypted OAuth tokens. Tokens are
 * decrypted in-memory for outbound API calls and are never returned to route
 * handlers that serialize to the client — use `toPublicStatus()` for anything
 * that crosses the wire.
 */

export type Platform = "yahoo" | "sleeper";

export interface DecryptedTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface PublicConnectionStatus {
  platform: Platform;
  connected: boolean;
  status: string; // "connected" | "needs_reconnect" | "syncing" | "error"
  platformUserId: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
}

export async function getConnection(
  userId: string,
  platform: Platform,
): Promise<PlatformConnection | null> {
  const rows = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertConnectionInput {
  userId: string;
  platform: Platform;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  platformUserId?: string | null;
  scopes?: string | null;
}

/** Create or update a connection, encrypting tokens at rest. */
export async function upsertConnection(input: UpsertConnectionInput): Promise<void> {
  const tokenExpiresAt = new Date(Date.now() + Math.max(0, input.expiresInSeconds) * 1000);
  const accessTokenEnc = encryptSecret(input.accessToken);
  const refreshTokenEnc = encryptSecret(input.refreshToken);

  const existing = await getConnection(input.userId, input.platform);
  if (existing) {
    await db
      .update(platformConnections)
      .set({
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        platformUserId: input.platformUserId ?? existing.platformUserId,
        scopes: input.scopes ?? existing.scopes,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(platformConnections.id, existing.id));
  } else {
    await db.insert(platformConnections).values({
      userId: input.userId,
      platform: input.platform,
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
      platformUserId: input.platformUserId ?? null,
      scopes: input.scopes ?? null,
      status: "connected",
    });
  }
}

/**
 * Persist a freshly-refreshed access token. Yahoo's refresh response usually
 * omits a new refresh token, so we keep the existing one unless a new one is
 * supplied.
 */
export async function updateAccessToken(
  userId: string,
  platform: Platform,
  accessToken: string,
  expiresInSeconds: number,
  newRefreshToken?: string | null,
): Promise<void> {
  const patch: Record<string, any> = {
    accessTokenEnc: encryptSecret(accessToken),
    tokenExpiresAt: new Date(Date.now() + Math.max(0, expiresInSeconds) * 1000),
    status: "connected",
    lastError: null,
    updatedAt: new Date(),
  };
  if (newRefreshToken) patch.refreshTokenEnc = encryptSecret(newRefreshToken);
  await db
    .update(platformConnections)
    .set(patch)
    .where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)));
}

export function decryptTokens(conn: PlatformConnection): DecryptedTokens {
  return {
    accessToken: decryptSecret(conn.accessTokenEnc),
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    expiresAt: conn.tokenExpiresAt ?? null,
  };
}

export async function setConnectionStatus(
  userId: string,
  platform: Platform,
  status: string,
  lastError?: string | null,
): Promise<void> {
  await db
    .update(platformConnections)
    .set({ status, lastError: lastError ?? null, updatedAt: new Date() })
    .where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)));
}

export async function disconnect(userId: string, platform: Platform): Promise<void> {
  await db
    .delete(platformConnections)
    .where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)));
}

/** Safe projection for the frontend — NEVER includes token material. */
export function toPublicStatus(conn: PlatformConnection | null, platform: Platform): PublicConnectionStatus {
  if (!conn) {
    return {
      platform,
      connected: false,
      status: "disconnected",
      platformUserId: null,
      tokenExpiresAt: null,
      lastError: null,
      connectedAt: null,
      updatedAt: null,
    };
  }
  return {
    platform,
    connected: true,
    status: conn.status,
    platformUserId: conn.platformUserId ?? null,
    tokenExpiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
    lastError: conn.lastError ?? null,
    connectedAt: conn.connectedAt ? conn.connectedAt.toISOString() : null,
    updatedAt: conn.updatedAt ? conn.updatedAt.toISOString() : null,
  };
}
