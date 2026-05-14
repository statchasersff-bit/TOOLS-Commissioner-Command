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
      creator
      roster_ids
      adds
      drops
      waiver_bid
      settings
      metadata
      consenter_ids
      created
      updated
      status_updated
      player_map
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
  creator: string | null;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  waiver_bid: number | null;
  settings: { expires_at?: number | null; [key: string]: unknown } | null;
  metadata: Record<string, unknown> | null;
  consenter_ids: number[];
  created: number;
  updated: number;
  status_updated: number | null;
  player_map: Record<string, { full_name?: string; position?: string; team?: string }> | null;
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

// ─── propose_trade ────────────────────────────────────────────────────────────

function buildProposeTrademutation(
  leagueId: string,
  draftPicks: string[],
  expiresAt: number,
  rejectTransactionId?: string,
  rejectTransactionLeg?: number
): string {
  const rejectIdLine = rejectTransactionId
    ? `reject_transaction_id: "${rejectTransactionId}",`
    : "";
  const rejectLegLine = rejectTransactionLeg != null
    ? `reject_transaction_leg: ${rejectTransactionLeg},`
    : "";
  return `
    mutation propose_trade(
      $k_adds: [String],
      $v_adds: [Int],
      $k_drops: [String],
      $v_drops: [Int]
    ) {
      propose_trade(
        league_id: "${leagueId}",
        ${rejectIdLine}
        ${rejectLegLine}
        draft_picks: ${JSON.stringify(draftPicks)},
        k_adds: $k_adds,
        v_adds: $v_adds,
        k_drops: $k_drops,
        v_drops: $v_drops,
        expires_at: ${expiresAt}
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

export interface ProposeTradeParams {
  leagueId: string;
  /** playerId → receiving roster ID */
  adds: Record<string, number>;
  /** playerId → sending roster ID */
  drops: Record<string, number>;
  draftPicks: string[];
  expiresAt: number;
  /** When countering an existing offer, the transaction to reject */
  rejectTransactionId?: string;
  rejectTransactionLeg?: number;
}

export interface ProposeTradeResult {
  adds: Record<string, number> | null;
  consenter_ids: number[];
  created: number;
  creator: string | null;
  draft_picks: unknown[];
  drops: Record<string, number> | null;
  league_id: string;
  leg: number;
  metadata: Record<string, unknown> | null;
  roster_ids: number[];
  settings: Record<string, unknown> | null;
  status: string;
  status_updated: number | null;
  transaction_id: string;
  type: string;
  player_map: Record<string, unknown> | null;
  waiver_budget: unknown[];
}

/**
 * Propose (or counter) a trade via sleeper.com/graphql.
 *
 * IMPORTANT: Always show a confirmation UI before calling this function.
 * Show exactly what each side receives. If countering, show
 * "This will counter and reject the existing offer."
 * Never call this silently or automatically.
 *
 * On success, refetch league_transactions_filtered with type_filters ["trade"]
 * to keep local state in sync.
 */
export async function proposeTrade(params: ProposeTradeParams): Promise<ProposeTradeResult> {
  const {
    leagueId,
    adds,
    drops,
    draftPicks,
    expiresAt,
    rejectTransactionId,
    rejectTransactionLeg,
  } = params;

  const k_adds = Object.keys(adds);
  const v_adds = Object.values(adds);
  const k_drops = Object.keys(drops);
  const v_drops = Object.values(drops);

  const data = await sleeperGraphQLRequest<{ propose_trade: ProposeTradeResult }>({
    operationName: "propose_trade",
    query: buildProposeTrademutation(
      leagueId,
      draftPicks,
      expiresAt,
      rejectTransactionId,
      rejectTransactionLeg
    ),
    variables: { k_adds, v_adds, k_drops, v_drops },
  });

  if (!data.propose_trade) {
    throw new Error("Trade proposal failed — no response from Sleeper.");
  }
  return data.propose_trade;
}

function buildAcceptTradeMutation(leagueId: string): string {
  return `
    mutation accept_trade($transaction_id: String!) {
      accept_trade(league_id: "${leagueId}", transaction_id: $transaction_id) {
        transaction_id
        status
        consenter_ids
        roster_ids
      }
    }
  `;
}

function buildRejectTradeMutation(leagueId: string): string {
  return `
    mutation RejectTrade($transactionId: String!, $leg: Int!) {
      reject_trade(
        league_id: "${leagueId}"
        transaction_id: $transactionId
        leg: $leg
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

export interface TradeActionResult {
  transaction_id: string;
  status: string;
  consenter_ids?: number[];
  roster_ids?: number[];
  metadata?: Record<string, unknown> | null;
}

export async function acceptTrade(
  leagueId: string,
  transactionId: string
): Promise<TradeActionResult> {
  const data = await sleeperGraphQLRequest<{ accept_trade: TradeActionResult }>({
    operationName: "accept_trade",
    query: buildAcceptTradeMutation(leagueId),
    variables: { transaction_id: transactionId },
  });
  if (!data.accept_trade) {
    throw new Error("Trade acceptance failed — no response from Sleeper.");
  }
  return data.accept_trade;
}

export async function rejectTrade(
  leagueId: string,
  transactionId: string,
  leg: number = 1
): Promise<TradeActionResult> {
  const data = await sleeperGraphQLRequest<{ reject_trade: TradeActionResult }>({
    operationName: "RejectTrade",
    query: buildRejectTradeMutation(leagueId),
    variables: { transactionId, leg },
  });
  if (!data.reject_trade) {
    throw new Error("Trade rejection failed — no response from Sleeper.");
  }
  return data.reject_trade;
}

// ─── get_dm_by_members ────────────────────────────────────────────────────────

/**
 * Look up the DM channel ID for a given Sleeper user.
 *
 * Returns the dm_id string on success, or null if no DM exists yet.
 * Use the dm_id to link to https://sleeper.com/dms/<dm_id>.
 * Never display DM contents — only store/use the dm_id as a link target.
 */
export async function getDmByMembers(otherUserId: string): Promise<string | null> {
  const data = await sleeperGraphQLRequest<{
    get_dm_by_members: { dm_id: string } | null;
  }>({
    operationName: "get_dm_by_members",
    query: `
      query get_dm_by_members {
        get_dm_by_members(members: ["${otherUserId}"]) {
          dm_id
        }
      }
    `,
  });
  return data.get_dm_by_members?.dm_id ?? null;
}

// ─── create_message (trade DM) ───────────────────────────────────────────────

export interface SendTradeMessageParams {
  dmId: string;
  text: string;
  transactionId: string;
  leagueId: string;
  status: string;
  transactionsByRoster: Record<string, unknown>;
  usersInLeagueMap: Record<string, unknown>;
  attachTradeCard: boolean;
}

export interface SendTradeMessageResult {
  message_id: string;
  text: string;
}

/**
 * Send a DM to a trade partner via Sleeper's create_message mutation.
 *
 * Generates a fresh client_id via crypto.randomUUID() on every call to
 * prevent duplicate messages on retry.
 *
 * When attachTradeCard=true the trade metadata is sent as attachment_data so
 * Sleeper can render an inline trade card inside the DM thread.
 * When false, a plain text message is sent with empty attachment arrays.
 *
 * NEVER log the JWT or the raw message text.
 */
export async function sendTradeMessage(
  params: SendTradeMessageParams
): Promise<SendTradeMessageResult> {
  const {
    dmId, text, transactionId, leagueId, status,
    transactionsByRoster, usersInLeagueMap, attachTradeCard,
  } = params;

  const clientId = crypto.randomUUID();

  const kData = attachTradeCard
    ? ["status", "transactions_by_roster", "transaction_id", "league_id", "users_in_league_map"]
    : [];
  const vData = attachTradeCard
    ? [
        status,
        JSON.stringify(transactionsByRoster),
        transactionId,
        leagueId,
        JSON.stringify(usersInLeagueMap),
      ]
    : [];

  const data = await sleeperGraphQLRequest<{
    create_message: SendTradeMessageResult;
  }>({
    operationName: "create_message",
    query: `
      mutation create_message(
        $text: String,
        $k_attachment_data: [String],
        $v_attachment_data: [String]
      ) {
        create_message(
          parent_id: "${dmId}",
          client_id: "${clientId}",
          parent_type: "dm",
          text: $text,
          shard_min: null,
          shard_max: null,
          attachment_type: "trade_dm",
          k_attachment_data: $k_attachment_data,
          v_attachment_data: $v_attachment_data
        ) {
          message_id
          text
        }
      }
    `,
    variables: {
      text,
      k_attachment_data: kData,
      v_attachment_data: vData,
    },
  });
  return data.create_message;
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
