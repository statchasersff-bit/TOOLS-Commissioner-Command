/**
 * Sleeper Auth Endpoint Configuration
 *
 * All Sleeper authenticated calls go through the single GraphQL endpoint.
 * Action endpoints remain blank until discovered — see docs/sleeper-auth-discovery.md.
 *
 * NEVER scatter endpoint URLs or credentials throughout the app.
 */

// ─── GraphQL endpoint (discovered) ───────────────────────────────────────────

export const SLEEPER_GQL_URL = "https://api.sleeper.app/graphql";

// ─── hCaptcha (required by Sleeper login mutation) ────────────────────────────
// Fill in after discovering Sleeper's hCaptcha site key from their web app.

export const SLEEPER_HCAPTCHA_SITE_KEY = "";

// ─── REST action endpoints (still pending discovery) ─────────────────────────
// Every authenticated write call must reference this object.
// Leave blank until verified — sleeperAuthedFetch() will fail fast with a clear message.

export const SLEEPER_AUTH_ENDPOINTS = {
  /** GraphQL — handled via SLEEPER_GQL_URL, kept for backward compat */
  requestCode: "",
  verifyCode: "",
  login: "",
  validateToken: "",
  refreshToken: "",
  logout: "",
} as const;

export const SLEEPER_ACTION_ENDPOINTS = {
  /** PUT / PATCH — set a weekly starting lineup */
  setLineup: "",
  /** POST — submit a waiver wire claim */
  submitWaiver: "",
  /** POST — propose a trade to another team */
  proposeTrade: "",
  /** POST — accept an incoming trade offer */
  acceptTrade: "",
  /** POST — reject an incoming trade offer */
  rejectTrade: "",
  /** POST — make a pick during a live draft */
  draftPick: "",
  /** POST — send a message to the league chat */
  sendChatMessage: "",
} as const;

export type AuthEndpointKey   = keyof typeof SLEEPER_AUTH_ENDPOINTS;
export type ActionEndpointKey = keyof typeof SLEEPER_ACTION_ENDPOINTS;
