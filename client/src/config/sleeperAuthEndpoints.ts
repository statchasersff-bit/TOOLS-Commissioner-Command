/**
 * Sleeper Authenticated Endpoint Configuration
 *
 * All endpoint URLs are intentionally blank until discovered and verified.
 * See docs/sleeper-auth-discovery.md for the discovery process.
 *
 * NEVER scatter raw Sleeper URLs throughout the app.
 * Every authenticated call must route through sleeperAuthedFetch() which reads this file.
 */

export const SLEEPER_AUTH_ENDPOINTS = {
  /** POST — request a one-time code sent to the user's identifier */
  requestCode: "",
  /** POST — verify the code and receive a session token */
  verifyCode: "",
  /** POST — log in directly with a known token/password */
  login: "",
  /** GET  — validate a stored token is still active */
  validateToken: "",
  /** POST — refresh an expiring token */
  refreshToken: "",
  /** POST — invalidate the current session token */
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
