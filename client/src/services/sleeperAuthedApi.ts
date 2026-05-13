/**
 * Sleeper Authenticated API Wrapper
 *
 * All write / action calls go through sleeperAuthedFetch().
 * If the endpoint URL is blank in sleeperAuthEndpoints.ts the call fails fast
 * with a clear "not configured yet" message — no silent no-ops.
 */

import {
  SLEEPER_AUTH_ENDPOINTS,
  SLEEPER_ACTION_ENDPOINTS,
  type ActionEndpointKey,
} from "@/config/sleeperAuthEndpoints";
import { getSleeperSession } from "@/services/sleeperAuth";

const SLEEPER_BASE = "https://api.sleeper.app";

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

/**
 * Make an authenticated request to a Sleeper action endpoint.
 * @param endpointKey - Key from SLEEPER_ACTION_ENDPOINTS
 * @param payload     - Request body (will be JSON-serialised)
 * @param method      - HTTP method (default "POST")
 */
export async function sleeperAuthedFetch<T = unknown>(
  endpointKey: ActionEndpointKey,
  payload?: Record<string, unknown>,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "POST"
): Promise<T> {
  const url = SLEEPER_ACTION_ENDPOINTS[endpointKey];
  if (!url) {
    throw new Error(
      `Sleeper authenticated endpoint "${endpointKey}" is not configured yet.`
    );
  }

  const session = requireSleeperAuth();

  const res = await fetch(`${SLEEPER_BASE}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as any)?.error || `Sleeper action failed (${res.status})`
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Throws if no valid session exists.
 * Always call this before any write operation.
 */
export function requireSleeperAuth() {
  const session = getSleeperSession();
  if (!session?.token) {
    throw new Error(
      "You must connect your Sleeper account to perform this action."
    );
  }
  return session;
}

// ─── Action helpers ───────────────────────────────────────────────────────────

export async function setLineup(leagueId: string, rosterId: number, starters: string[]) {
  return sleeperAuthedFetch("setLineup", { league_id: leagueId, roster_id: rosterId, starters });
}

export async function submitWaiverClaim(
  leagueId: string,
  rosterId: number,
  playerId: string,
  dropPlayerId?: string,
  bidAmount?: number
) {
  return sleeperAuthedFetch("submitWaiver", {
    league_id: leagueId,
    roster_id: rosterId,
    player_id: playerId,
    drop_player_id: dropPlayerId ?? null,
    bid_amount: bidAmount ?? 0,
  });
}

export async function proposeTrade(
  leagueId: string,
  fromRosterId: number,
  toRosterId: number,
  offeredPlayerIds: string[],
  requestedPlayerIds: string[],
  offeredPickIds?: string[],
  requestedPickIds?: string[]
) {
  return sleeperAuthedFetch("proposeTrade", {
    league_id: leagueId,
    from_roster_id: fromRosterId,
    to_roster_id: toRosterId,
    offered_player_ids: offeredPlayerIds,
    requested_player_ids: requestedPlayerIds,
    offered_pick_ids: offeredPickIds ?? [],
    requested_pick_ids: requestedPickIds ?? [],
  });
}

export async function acceptTrade(leagueId: string, tradeId: string) {
  return sleeperAuthedFetch("acceptTrade", { league_id: leagueId, trade_id: tradeId });
}

export async function rejectTrade(leagueId: string, tradeId: string) {
  return sleeperAuthedFetch("rejectTrade", { league_id: leagueId, trade_id: tradeId });
}

export async function draftPlayer(draftId: string, playerId: string, rosterId: number, round: number, pickNumber: number) {
  return sleeperAuthedFetch("draftPick", {
    draft_id: draftId,
    player_id: playerId,
    roster_id: rosterId,
    round,
    pick_number: pickNumber,
  });
}

export async function sendLeagueChatMessage(leagueId: string, message: string) {
  return sleeperAuthedFetch("sendChatMessage", {
    league_id: leagueId,
    message,
  });
}

// ─── Auth endpoint helpers (re-exported for convenience) ─────────────────────

export { SLEEPER_AUTH_ENDPOINTS, SLEEPER_ACTION_ENDPOINTS };
