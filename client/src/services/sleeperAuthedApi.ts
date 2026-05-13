/**
 * Sleeper Authenticated API Wrapper
 *
 * All write / action calls go through sleeperAuthedFetch().
 * Authenticated GraphQL calls go through sleeperAuthedGQL().
 * If the endpoint URL is blank in sleeperAuthEndpoints.ts the call fails fast
 * with a clear "not configured yet" message — no silent no-ops.
 */

import {
  SLEEPER_AUTH_ENDPOINTS,
  SLEEPER_ACTION_ENDPOINTS,
  SLEEPER_WEB_GQL_URL,
  type ActionEndpointKey,
} from "@/config/sleeperAuthEndpoints";
import { getSleeperSession, sleeperGQL } from "@/services/sleeperAuth";

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
 * Make an authenticated GraphQL call to sleeper.com/graphql.
 * Used for read/action operations that require a session token.
 */
async function sleeperAuthedGQL<T = unknown>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const session = requireSleeperAuth();
  const data = await sleeperGQL(SLEEPER_WEB_GQL_URL, query, variables, session.token);
  return data as T;
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

// ─── league_transactions_filtered ────────────────────────────────────────────

const LEAGUE_TRANSACTIONS_FILTERED_QUERY = `
  query league_transactions_filtered(
    $league_id: String!
    $type_filters: [String]
    $leg_filters: [Int]
    $status_filters: [String]
  ) {
    league_transactions_filtered(
      league_id: $league_id
      type_filters: $type_filters
      leg_filters: $leg_filters
      status_filters: $status_filters
    ) {
      transaction_id
      type
      status
      leg
      roster_ids
      adds
      drops
      waiver_bid
      settings
      metadata
      consenter_ids
      created
      updated
      draft_picks {
        season
        round
        roster_id
        previous_owner_id
        owner_id
      }
    }
  }
`;

export interface SleeperTransactionPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  waiver_bid: number | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  consenter_ids: number[];
  created: number;
  updated: number;
  draft_picks: SleeperTransactionPick[];
}

/**
 * Fetch filtered league transactions via the authenticated sleeper.com/graphql endpoint.
 *
 * @param leagueId      - Sleeper league ID
 * @param typeFilters   - e.g. ["trade"] | ["waiver"] | ["free_agent"] | undefined (all)
 * @param legFilters    - Week numbers to filter to, e.g. [1, 2, 3] | undefined (all)
 * @param statusFilters - e.g. ["complete"] | ["failed"] | undefined (all)
 */
export async function fetchLeagueTransactionsFiltered(
  leagueId: string,
  typeFilters?: string[],
  legFilters?: number[],
  statusFilters?: string[]
): Promise<SleeperTransaction[]> {
  const data = await sleeperAuthedGQL<{
    league_transactions_filtered: SleeperTransaction[];
  }>(LEAGUE_TRANSACTIONS_FILTERED_QUERY, {
    league_id: leagueId,
    type_filters: typeFilters ?? null,
    leg_filters: legFilters ?? null,
    status_filters: statusFilters ?? null,
  });
  return data.league_transactions_filtered ?? [];
}

// ─── submit_waiver_claim ──────────────────────────────────────────────────────

/**
 * Sleeper uses leagueId as a string literal inside the mutation body (not a GQL variable).
 * Build the mutation string with leagueId interpolated at call time.
 */
function buildWaiverClaimMutation(leagueId: string): string {
  return `
    mutation submit_waiver_claim(
      $k_adds: [String]
      $v_adds: [Int]
      $k_drops: [String]
      $v_drops: [Int]
      $k_settings: [String]
      $v_settings: [Int]
    ) {
      submit_waiver_claim(
        league_id: "${leagueId}"
        k_adds: $k_adds
        v_adds: $v_adds
        k_drops: $k_drops
        v_drops: $v_drops
        k_settings: $k_settings
        v_settings: $v_settings
      ) {
        adds
        consenter_ids
        created
        creator
        draft_picks
        drops
        league_id
        leg
        metadata
        roster_ids
        settings
        status
        status_updated
        transaction_id
        type
        player_map
        waiver_budget
      }
    }
  `;
}

export interface SleeperWaiverClaimResult {
  adds: Record<string, number> | null;
  consenter_ids: number[];
  created: number;
  creator: string;
  draft_picks: unknown[];
  drops: Record<string, number> | null;
  league_id: string;
  leg: number;
  metadata: Record<string, unknown> | null;
  roster_ids: number[];
  settings: Record<string, unknown> | null;
  status: string;
  status_updated: number;
  transaction_id: string;
  type: string;
  player_map: Record<string, unknown> | null;
  waiver_budget: unknown[];
}

/**
 * Submit a waiver claim via the authenticated sleeper.com/graphql endpoint.
 *
 * Requires a connected Sleeper session (JWT). Do NOT call without displaying
 * a review modal to the user first — use WaiverClaimModal for that.
 *
 * @param leagueId      - Active league ID
 * @param rosterId      - Caller's roster ID in that league
 * @param addPlayerIds  - Player IDs to add (usually 1)
 * @param dropPlayerIds - Player IDs to drop (0 or 1)
 * @param waiverBid     - FAAB bid amount (0 for waiver-order leagues)
 */
export async function submitWaiverClaim(
  leagueId: string,
  rosterId: number,
  addPlayerIds: string[],
  dropPlayerIds: string[],
  waiverBid: number
): Promise<SleeperWaiverClaimResult> {
  const k_adds = addPlayerIds;
  const v_adds = addPlayerIds.map(() => rosterId);
  const k_drops = dropPlayerIds;
  const v_drops = dropPlayerIds.map(() => rosterId);
  const k_settings = waiverBid > 0 ? ["waiver_bid"] : [];
  const v_settings = waiverBid > 0 ? [waiverBid] : [];

  const data = await sleeperAuthedGQL<{ submit_waiver_claim: SleeperWaiverClaimResult }>(
    buildWaiverClaimMutation(leagueId),
    { k_adds, v_adds, k_drops, v_drops, k_settings, v_settings }
  );

  if (!data.submit_waiver_claim) {
    throw new Error("Waiver claim submission failed — no response from Sleeper.");
  }
  return data.submit_waiver_claim;
}

// ─── Action helpers ───────────────────────────────────────────────────────────

export async function setLineup(leagueId: string, rosterId: number, starters: string[]) {
  return sleeperAuthedFetch("setLineup", { league_id: leagueId, roster_id: rosterId, starters });
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
