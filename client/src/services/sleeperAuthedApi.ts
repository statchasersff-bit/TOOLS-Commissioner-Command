/**
 * Sleeper Authenticated API — sleeper.com/graphql
 *
 * All authenticated operations use the exact header format discovered from Sleeper's web app:
 *   authorization: <JWT>           (no "Bearer" prefix)
 *   x-sleeper-graphql-op: <operationName>
 *
 * The request body always includes { operationName, query, variables }.
 *
 * JWT is read from localStorage["statchasers_sleeper_auth"].token.
 * JWT is NEVER logged, exposed in UI, or sent to our backend.
 */

import { SLEEPER_WEB_GQL_URL } from "@/config/sleeperAuthEndpoints";
import { getSleeperSession, getSleeperToken } from "@/services/sleeperAuth";

// ─── Core transport ───────────────────────────────────────────────────────────

interface GQLRequest {
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
}

/**
 * Authenticated GraphQL request to sleeper.com/graphql.
 *
 * Header format (discovered):
 *   authorization: <JWT>                    ← no "Bearer" prefix
 *   x-sleeper-graphql-op: <operationName>   ← required by Sleeper
 *
 * Throws if no session token exists or if Sleeper returns errors.
 */
export async function sleeperGraphQLRequest<T = unknown>(
  req: GQLRequest
): Promise<T> {
  const token = getSleeperToken();
  if (!token) {
    throw new Error(
      "You must connect your Sleeper account to perform this action."
    );
  }

  const res = await fetch(SLEEPER_WEB_GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": token,
      "x-sleeper-graphql-op": req.operationName,
    },
    body: JSON.stringify({
      operationName: req.operationName,
      query: req.query,
      variables: req.variables ?? {},
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as any)?.errors?.[0]?.message ||
        `Sleeper request failed (${res.status})`
    );
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Sleeper operation failed.");
  }
  return (json.data ?? {}) as T;
}

/**
 * Throws if no valid session exists.
 * Call before any write operation as an early guard.
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
 * Fetch filtered league transactions.
 *
 * @param leagueId      - Sleeper league ID
 * @param typeFilters   - e.g. ["trade"] | ["waiver"] | ["free_agent"] | undefined (all)
 * @param legFilters    - Week numbers, e.g. [1, 2, 3] | undefined (all)
 * @param statusFilters - e.g. ["complete"] | ["pending"] | ["failed"] | undefined (all)
 */
export async function fetchLeagueTransactionsFiltered(
  leagueId: string,
  typeFilters?: string[],
  legFilters?: number[],
  statusFilters?: string[]
): Promise<SleeperTransaction[]> {
  const data = await sleeperGraphQLRequest<{
    league_transactions_filtered: SleeperTransaction[];
  }>({
    operationName: "league_transactions_filtered",
    query: LEAGUE_TRANSACTIONS_FILTERED_QUERY,
    variables: {
      league_id: leagueId,
      type_filters: typeFilters ?? null,
      leg_filters: legFilters ?? null,
      status_filters: statusFilters ?? null,
    },
  });
  return data.league_transactions_filtered ?? [];
}

// ─── submit_waiver_claim ──────────────────────────────────────────────────────
//
// league_id is embedded as a string literal in the mutation body (not a GQL variable)
// because that is how Sleeper's endpoint expects it.

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
 * Submit a waiver claim via sleeper.com/graphql.
 *
 * Requires a connected Sleeper session. Always show WaiverClaimModal for
 * user review before calling this function — never call silently.
 *
 * @param leagueId      - Active league ID
 * @param rosterId      - Caller's roster ID in that league
 * @param addPlayerIds  - Player IDs to add (usually 1)
 * @param dropPlayerIds - Player IDs to drop (0 or 1)
 * @param waiverBid     - FAAB bid amount; pass 0 for waiver-order leagues
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

  const data = await sleeperGraphQLRequest<{
    submit_waiver_claim: SleeperWaiverClaimResult;
  }>({
    operationName: "submit_waiver_claim",
    query: buildWaiverClaimMutation(leagueId),
    variables: { k_adds, v_adds, k_drops, v_drops, k_settings, v_settings },
  });

  if (!data.submit_waiver_claim) {
    throw new Error("Waiver claim submission failed — no response from Sleeper.");
  }
  return data.submit_waiver_claim;
}

// ─── Future operation stubs ───────────────────────────────────────────────────
//
// These will be implemented once their exact mutation shapes are discovered.
// Each uses sleeperGraphQLRequest with operationName matching the Sleeper op.

/** @todo Discover submit_lineup mutation shape from sleeper.com/graphql */
export async function submitLineup(
  _leagueId: string,
  _rosterId: number,
  _starters: string[]
): Promise<never> {
  throw new Error(
    "submit_lineup: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: submit_lineup."
  );
}

/** @todo Discover propose_trade mutation shape from sleeper.com/graphql */
export async function proposeTrade(
  _leagueId: string,
  _fromRosterId: number,
  _toRosterId: number,
  _offeredPlayerIds: string[],
  _requestedPlayerIds: string[],
  _offeredPickIds?: string[],
  _requestedPickIds?: string[]
): Promise<never> {
  throw new Error(
    "propose_trade: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: propose_trade."
  );
}

/** @todo Discover accept_trade mutation shape from sleeper.com/graphql */
export async function acceptTrade(
  _leagueId: string,
  _tradeId: string
): Promise<never> {
  throw new Error(
    "accept_trade: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: accept_trade."
  );
}

/** @todo Discover reject_trade mutation shape from sleeper.com/graphql */
export async function rejectTrade(
  _leagueId: string,
  _tradeId: string
): Promise<never> {
  throw new Error(
    "reject_trade: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: reject_trade."
  );
}

/** @todo Discover send_message mutation shape from sleeper.com/graphql */
export async function sendLeagueChatMessage(
  _leagueId: string,
  _message: string
): Promise<never> {
  throw new Error(
    "send_message: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: send_message."
  );
}

/** @todo Discover draft_pick mutation shape from sleeper.com/graphql */
export async function draftPlayer(
  _draftId: string,
  _playerId: string,
  _rosterId: number,
  _round: number,
  _pickNumber: number
): Promise<never> {
  throw new Error(
    "draft_pick: mutation shape not yet discovered. " +
      "Capture from sleeper.com/graphql with x-sleeper-graphql-op: draft_pick."
  );
}
