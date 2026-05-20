/**
 * Sleeper Authenticated API — sleeper.com/graphql
 *
 * All authenticated operations use the exact header format discovered from Sleeper's web app:
 *   authorization: <JWT>           (no "Bearer" prefix)
 *   x-sleeper-graphql-op: <operationName>
 *
 * The request body always includes { operationName, query, variables }.
 *
 * JWT is read via getSleeperToken() from services/sleeperAuth.ts, which
 * scopes storage per Dynasty Command user — see that module for the
 * account-isolation contract.
 * JWT is NEVER logged, exposed in UI, or sent to our backend.
 */

import { SLEEPER_WEB_GQL_URL } from "@/config/sleeperAuthEndpoints";
import { getSleeperSession, getSleeperToken } from "@/services/sleeperAuth";
import {
  sleeperWriteLimiter,
  type SleeperWriteAction,
} from "@/services/sleeperWriteLimiter";
import {
  isWriteEnabled,
  killSwitchError,
  KILL_SWITCH_MESSAGE,
  recordWrite as recordSafetyWrite,
  isGeneralMessagingEnabled,
  isTradeLinkDmEnabled,
  MESSAGING_DISABLED_MESSAGE,
  canSendTradeLinkDm,
  recordTradeLinkDm,
  type TradeLinkSkipReason,
} from "@/services/sleeperSafetyGate";

// ─── Core transport ───────────────────────────────────────────────────────────

interface GQLRequest {
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
  /** Optional diagnostic context — included in error logs, never sent to
   *  Sleeper. Use this to surface "which queue / league produced an error"
   *  without opening DevTools. */
  meta?: {
    actionType?: SleeperWriteAction;
    queueType?: string;
    leagueId?: string;
    /** Required when calling create_message. "trade-link" is the controlled
     *  automatic post-trade DM (only allowed when VITE_ENABLE_TRADE_LINK_DM
     *  is on); "general" covers every other create_message and is only
     *  allowed when VITE_ENABLE_GENERAL_SLEEPER_MESSAGES is on. */
    messagingIntent?: "trade-link" | "general";
  };
}

/**
 * Mutation operation names treated as authenticated writes — every entry
 * here is gated through the global write limiter. Add new write ops here
 * when introducing them. Reads (queries) are not pre-paced.
 */
const WRITE_OPERATIONS = new Set<string>([
  "submit_lineup",
  "submit_waiver_claim",
  "propose_trade",
  "accept_trade",
  "reject_trade",
  "draft_pick",
  "create_message", // DMs, league chat, trade-card DMs
]);

/** Default action type derived from operation name when callers don't pass
 *  one explicitly. */
function deriveActionType(op: string): SleeperWriteAction {
  if (op === "submit_lineup") return "lineup";
  if (op === "submit_waiver_claim") return "waiver";
  if (op === "propose_trade" || op === "accept_trade" || op === "reject_trade") return "trade";
  if (op === "create_message") return "chat";
  if (op === "draft_pick") return "draft";
  return "other";
}

/** Shortened request id for log correlation across the request lifetime. */
function makeRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
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

  const op = req.operationName;
  const requestId = makeRequestId();
  const isWrite = WRITE_OPERATIONS.has(op);
  const actionType: SleeperWriteAction = req.meta?.actionType ?? deriveActionType(op);
  const queueType = req.meta?.queueType ?? (isWrite ? "single" : "read");
  const leagueId = req.meta?.leagueId;
  const logPrefix = `[Sleeper GQL ${requestId} ${op}]`;

  // ── Emergency kill switch ────────────────────────────────────────────────
  // Reads are never blocked. Writes throw a clear user-facing error before
  // any network call. Logs include diagnostic context but never the JWT.
  if (isWrite && !isWriteEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(
      `${logPrefix} blocked by safety gate (writes disabled) action=${actionType} queue=${queueType}` +
      (leagueId ? ` league=${leagueId}` : ""),
    );
    throw killSwitchError();
  }

  // ── Messaging gate ───────────────────────────────────────────────────────
  // create_message is the only authenticated write that can carry arbitrary
  // user-typed content. Require callers to explicitly tag intent, and gate
  // each intent independently:
  //   - "trade-link" → controlled automatic post-trade DM only.
  //   - "general"    → free-text messaging (currently disabled by default).
  // Untagged create_message attempts are refused — no path can sneak past.
  if (op === "create_message") {
    const intent = req.meta?.messagingIntent;
    if (intent === "trade-link") {
      if (!isTradeLinkDmEnabled()) {
        // eslint-disable-next-line no-console
        console.warn(`${logPrefix} blocked: trade-link DM disabled by env flag`);
        throw new Error(MESSAGING_DISABLED_MESSAGE);
      }
    } else if (intent === "general") {
      if (!isGeneralMessagingEnabled()) {
        // eslint-disable-next-line no-console
        console.warn(`${logPrefix} blocked: general messaging disabled by env flag`);
        throw new Error(MESSAGING_DISABLED_MESSAGE);
      }
    } else {
      // Missing tag → refuse. Forces every call site to declare intent so
      // we can't accidentally re-open general messaging by mistake.
      // eslint-disable-next-line no-console
      console.warn(`${logPrefix} blocked: create_message called without messagingIntent`);
      throw new Error(MESSAGING_DISABLED_MESSAGE);
    }
  }

  // Every authenticated write passes through the global limiter. Reads are
  // not pre-paced (Sleeper's read endpoints carry a far higher budget).
  let waitedMs = 0;
  let tier = "n/a";
  if (isWrite) {
    const turn = await sleeperWriteLimiter.waitTurn(actionType);
    waitedMs = turn.waitedMs;
    tier = turn.tier;
    if (waitedMs > 1000 || tier !== "base") {
      // eslint-disable-next-line no-console
      console.info(
        `${logPrefix} limiter released after ${waitedMs}ms tier=${tier}` +
        (leagueId ? ` league=${leagueId}` : "") +
        ` queue=${queueType}`,
      );
    }
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(SLEEPER_WEB_GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authorization": token,
        "x-sleeper-graphql-op": op,
      },
      body: JSON.stringify({
        operationName: op,
        query: req.query,
        variables: req.variables ?? {},
      }),
    });
  } catch (err: any) {
    const latency = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error(
      `${logPrefix} network error after ${latency}ms` +
      (leagueId ? ` league=${leagueId}` : "") +
      ` queue=${queueType}`,
      err?.message ?? err,
    );
    throw err;
  }
  const latency = Date.now() - startedAt;

  let rawBody = "";
  try { rawBody = await res.text(); } catch { /* ignore */ }

  if (!res.ok) {
    let message = `Sleeper request failed (${res.status})`;
    try {
      const body = JSON.parse(rawBody);
      message =
        body?.errors?.[0]?.message ||
        body?.message ||
        body?.error ||
        message;
    } catch { /* ignore */ }

    // Anti-abuse / rate-limit feedback: tell the limiter so every future
    // write across the app slows down for a cooldown period. We feed BOTH
    // raw status and the parsed message so the matcher catches either.
    if (res.status === 429 || sleeperWriteLimiter.looksLikeRateLimit(message)) {
      sleeperWriteLimiter.noteRateLimit(`HTTP ${res.status}`);
    }

    // eslint-disable-next-line no-console
    console.error(
      `${logPrefix} ${res.status} after ${latency}ms` +
      (leagueId ? ` league=${leagueId}` : "") +
      ` queue=${queueType} action=${actionType}`,
      rawBody.slice(0, 500),
    );
    throw new Error(message + (rawBody ? `: ${rawBody.slice(0, 300)}` : ""));
  }

  let json: any;
  try { json = JSON.parse(rawBody); } catch {
    // eslint-disable-next-line no-console
    console.error(`${logPrefix} non-JSON 200 after ${latency}ms`, rawBody.slice(0, 200));
    throw new Error("Sleeper returned non-JSON response.");
  }
  if (json.errors?.length) {
    const firstMsg = json.errors[0]?.message || "Sleeper operation failed.";
    if (sleeperWriteLimiter.looksLikeRateLimit(firstMsg)) {
      sleeperWriteLimiter.noteRateLimit("graphql error");
    }
    // eslint-disable-next-line no-console
    console.error(
      `${logPrefix} GraphQL errors after ${latency}ms` +
      (leagueId ? ` league=${leagueId}` : "") +
      ` queue=${queueType} action=${actionType}`,
      json.errors,
    );
    throw new Error(firstMsg);
  }
  if (isWrite) {
    // Record into the soft-cap counters. Triggers a limiter bump if the
    // write puts us past the configured per-action threshold.
    try { recordSafetyWrite(actionType); } catch { /* never block on telemetry */ }
    // eslint-disable-next-line no-console
    console.info(
      `${logPrefix} ok ${latency}ms` +
      (leagueId ? ` league=${leagueId}` : "") +
      ` queue=${queueType} action=${actionType}`,
    );
  }
  return (json.data ?? {}) as T;
}

// Re-export so consumers can show the kill-switch message inline without
// directly importing from sleeperSafetyGate.
export { KILL_SWITCH_MESSAGE };

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
      waiver_budget
      settings
      metadata
      consenter_ids
      created
      status_updated
      player_map
      draft_picks
    }
  }
`;

export interface SleeperTransactionPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
  pick_no?: number;
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
  waiver_budget: Array<{ sender: number; receiver: number; amount: number } | string> | string | null;
  settings: { expires_at?: number | null; [key: string]: unknown } | null;
  metadata: Record<string, unknown> | null;
  consenter_ids: number[];
  created: number;
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
      type_filters: typeFilters ?? [],
      leg_filters: legFilters ?? [],
      status_filters: statusFilters ?? [],
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
    throw new Error("Waiver claim submission failed. No response from Sleeper.");
  }
  return data.submit_waiver_claim;
}

// ─── Future operation stubs ───────────────────────────────────────────────────
//
// These will be implemented once their exact mutation shapes are discovered.
// Each uses sleeperGraphQLRequest with operationName matching the Sleeper op.

/**
 * Submit a lineup update via sleeper.com/graphql.
 *
 * Uses the `submit_lineup` operation as identified from Sleeper's web app.
 * league_id and roster_id are embedded as literals (same pattern as waiver/trade mutations).
 * JWT is NEVER logged.
 *
 * Always show a confirmation UI before calling this — never call silently.
 */
function buildSubmitLineupMutation(leagueId: string, rosterId: number): string {
  return `
    mutation submit_lineup($starters: [String]) {
      submit_lineup(
        league_id: "${leagueId}"
        roster_id: ${rosterId}
        starters: $starters
      ) {
        roster_id
        starters
      }
    }
  `;
}

export async function submitLineup(
  leagueId: string,
  rosterId: number,
  starters: string[]
): Promise<void> {
  await sleeperGraphQLRequest<{ submit_lineup: unknown }>({
    operationName: "submit_lineup",
    query: buildSubmitLineupMutation(leagueId, rosterId),
    variables: { starters },
  });
}

// ─── propose_trade ────────────────────────────────────────────────────────────

function buildProposeTrademutation(
  leagueId: string,
  picksCsv: string[],
  expiresAt: number | null,
  rejectTransactionId?: string,
  rejectTransactionLeg?: number,
  waiverBudget?: Array<{ sender: number; receiver: number; amount: number }>
): string {
  const counterLines = rejectTransactionId
    ? `reject_transaction_id: "${rejectTransactionId}", reject_transaction_leg: ${rejectTransactionLeg ?? 1},`
    : "";
  const expiresLine = expiresAt !== null ? `expires_at: ${expiresAt},` : "";
  const budgetLiteral = waiverBudget && waiverBudget.length > 0
    ? JSON.stringify(waiverBudget)
    : "[]";
  return `
    mutation propose_trade(
      $k_adds: [String],
      $v_adds: [Int],
      $k_drops: [String],
      $v_drops: [Int]
    ) {
      propose_trade(
        league_id: "${leagueId}",
        ${counterLines}
        draft_picks: ${JSON.stringify(picksCsv)},
        k_adds: $k_adds,
        v_adds: $v_adds,
        k_drops: $k_drops,
        v_drops: $v_drops,
        waiver_budget: ${budgetLiteral},
        ${expiresLine}
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
  draftPicks: SleeperTransactionPick[];
  expiresAt: number | null;
  /** FAAB transfers included in this trade */
  waiverBudget?: Array<{ sender: number; receiver: number; amount: number }>;
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
    waiverBudget,
    rejectTransactionId,
    rejectTransactionLeg,
  } = params;

  const k_adds = Object.keys(adds);
  const v_adds = Object.values(adds);
  const k_drops = Object.keys(drops);
  const v_drops = Object.values(drops);

  // Sleeper pick CSV: "originalRosterId,season,round,owner_id,previous_owner_id"
  // owner_id = receiving roster; previous_owner_id = sending roster
  // (matches the format Sleeper returns in completed trade draft_picks arrays)
  const picksCsv = draftPicks.map(p =>
    `${p.roster_id},${p.season},${p.round},${p.owner_id},${p.previous_owner_id}`
  );

  const mutation = buildProposeTrademutation(
    leagueId,
    picksCsv,
    expiresAt,
    rejectTransactionId,
    rejectTransactionLeg,
    waiverBudget
  );

  const data = await sleeperGraphQLRequest<{ propose_trade: ProposeTradeResult }>({
    operationName: "propose_trade",
    query: mutation,
    variables: { k_adds, v_adds, k_drops, v_drops },
  });

  if (!data.propose_trade) {
    throw new Error("Trade proposal failed. No response from Sleeper.");
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
    mutation reject_trade($transactionId: String!, $leg: Int!) {
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
    throw new Error("Trade acceptance failed. No response from Sleeper.");
  }
  return data.accept_trade;
}

export async function rejectTrade(
  leagueId: string,
  transactionId: string,
  leg: number = 1
): Promise<TradeActionResult> {
  const data = await sleeperGraphQLRequest<{ reject_trade: TradeActionResult }>({
    operationName: "reject_trade",
    query: buildRejectTradeMutation(leagueId),
    variables: { transactionId, leg },
  });
  if (!data.reject_trade) {
    throw new Error("Trade rejection failed. No response from Sleeper.");
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

// ─── getDmByMembersFull ───────────────────────────────────────────────────────

export interface SleeperDmInfo {
  dm_id: string;
  last_message_id: string | null;
  last_read_id: string | null;
}

export async function getDmByMembersFull(otherUserId: string): Promise<SleeperDmInfo | null> {
  const data = await sleeperGraphQLRequest<{
    get_dm_by_members: SleeperDmInfo | null;
  }>({
    operationName: "get_dm_by_members",
    query: `
      query get_dm_by_members {
        get_dm_by_members(members: ["${otherUserId}"]) {
          dm_id
          last_message_id
          last_read_id
        }
      }
    `,
  });
  return data.get_dm_by_members ?? null;
}

// ─── markDmRead ───────────────────────────────────────────────────────────────

export async function markDmRead(dmId: string, messageId: string): Promise<void> {
  try {
    await sleeperGraphQLRequest({
      operationName: "create_receipt",
      query: `
        query create_receipt {
          create_read_receipt(
            parent_type: "dm",
            parent_id: "${dmId}",
            message_id: "${messageId}"
          )
        }
      `,
    });
  } catch { /* not critical */ }
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

/**
 * The user object Sleeper expects inside each `transactions_by_roster[rid].user`
 * slot and inside `users_in_league_map[user_id]`. Required fields only.
 */
export interface TradeAttachmentUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  is_bot: boolean;
  is_owner: boolean;
  league_id: string;
  metadata: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/**
 * Build a Sleeper-compatible placeholder user. Use whenever a real user object
 * is unavailable. Never return null — Sleeper's desktop trade-DM renderer
 * crashes (`r.map is not a function`) on null/undefined access.
 */
export function makeTradeAttachmentUser(
  userId: string | null | undefined,
  displayName: string | null | undefined,
  leagueId: string,
  avatar: string | null = null
): TradeAttachmentUser {
  return {
    user_id: userId || "",
    display_name: displayName || "Unknown Manager",
    avatar,
    is_bot: false,
    is_owner: false,
    league_id: leagueId,
    metadata: {},
    settings: {},
  };
}

/**
 * Build the per-roster trade-card payload Sleeper renders inside DM threads.
 * Every list field is guaranteed to be an array, `user` is guaranteed non-null,
 * and `status` is always a string. Pass empty arrays for slots you don't have
 * data for — never undefined. This prevents `TypeError: r.map is not a function`
 * in Sleeper's desktop renderer when it iterates the lists.
 */
export interface TradeAttachmentRosterInput {
  rosterId: number;
  user: TradeAttachmentUser;
  adds?: unknown[];           // array of player objects, e.g. { player_id, full_name, position, team }
  drops?: unknown[];          // array of player objects
  added_picks?: unknown[];    // array of { season, round, roster_id, owner_id, previous_owner_id }
  dropped_picks?: unknown[];  // same shape
  added_budget?: unknown[];   // array of { sender, receiver, amount }
  dropped_budget?: unknown[]; // same shape
}

export interface BuildTradeAttachmentInput {
  status: string;
  rosters: TradeAttachmentRosterInput[];
  users: TradeAttachmentUser[];
}

export interface BuildTradeAttachmentResult {
  transactionsByRoster: Record<string, unknown>;
  usersInLeagueMap: Record<string, unknown>;
}

export function buildTradeAttachment(
  input: BuildTradeAttachmentInput
): BuildTradeAttachmentResult {
  const transactionsByRoster: Record<string, unknown> = {};
  for (const r of input.rosters) {
    transactionsByRoster[String(r.rosterId)] = {
      adds:           Array.isArray(r.adds)           ? r.adds           : [],
      drops:          Array.isArray(r.drops)          ? r.drops          : [],
      added_picks:    Array.isArray(r.added_picks)    ? r.added_picks    : [],
      dropped_picks:  Array.isArray(r.dropped_picks)  ? r.dropped_picks  : [],
      added_budget:   Array.isArray(r.added_budget)   ? r.added_budget   : [],
      dropped_budget: Array.isArray(r.dropped_budget) ? r.dropped_budget : [],
      status:         input.status || "proposed",
      user:           r.user, // guaranteed non-null by TradeAttachmentUser type
    };
  }
  const usersInLeagueMap: Record<string, unknown> = {};
  for (const u of input.users) {
    if (u.user_id) usersInLeagueMap[u.user_id] = u;
  }
  return { transactionsByRoster, usersInLeagueMap };
}

// ─── Trade-card payload validation ───────────────────────────────────────────
//
// Schemas live in ./tradeAttachmentSchema.ts and are modeled on a captured
// native Sleeper trade_dm payload. Re-exported here for backwards compat with
// existing internal callers. Any deviation from the native shape risks
// crashing Sleeper's desktop renderer.

import {
  validateTradeAttachmentPayload,
  assertValidTradeAttachmentPayload,
  type TradeCardValidationIssue,
} from "./tradeAttachmentSchema";

export {
  validateTradeAttachmentPayload,
  assertValidTradeAttachmentPayload,
} from "./tradeAttachmentSchema";
export type {
  TradeCardAttachment,
  TradeCardValidationIssue,
  TradeCardValidationResult,
} from "./tradeAttachmentSchema";

export interface SendTradeMessageResult {
  message_id: string;
  text: string;
  attachment?: string;
  author_avatar?: string;
  author_display_name?: string;
  author_id?: string;
  created?: number;
  parent_id?: string;
  parent_type?: string;
  text_map?: string;
  user_reactions?: string;
  client_id?: string;
  /**
   * True when the trade_dm attachment was actually included in the send.
   * False when the message was downgraded to plain text — either because
   * `attachTradeCard` was false, or because the safe-mode fallback engaged
   * after the payload failed schema validation.
   */
  attachment_sent?: boolean;
  /**
   * Reason the safe-mode fallback engaged (validation issues joined by `; `).
   * Only set when `attachment_sent === false` AND `attachTradeCard` was true.
   */
  attachment_skipped_reason?: string;
}

/**
 * Send a DM to a trade partner via Sleeper's create_message mutation.
 *
 * Generates a fresh client_id via crypto.randomUUID() on every call to
 * prevent duplicate messages on retry.
 *
 * Safe-mode contract (PERMANENT, do not remove):
 *   When attachTradeCard=true, the payload is validated against the native
 *   Sleeper trade_dm schema before send. If validation fails for ANY reason
 *   (schema mismatch, thrown error inside the validator, anything), the
 *   message is automatically downgraded to a plain-text DM via sendPlainDm
 *   and the result carries `attachment_sent: false`. The malformed payload
 *   is NEVER transmitted. Fail safe, not fail open.
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

  // ── Safe-mode gate ─────────────────────────────────────────────────────────
  // Validate (non-throwing) before considering the attachment send. If
  // validation fails or throws, downgrade to plain-text via sendPlainDm so
  // a malformed trade_dm can never reach Sleeper's desktop renderer.
  let attach = attachTradeCard;
  let skippedReason: string | undefined;
  if (attach) {
    let issues: TradeCardValidationIssue[] = [];
    try {
      const result = validateTradeAttachmentPayload({
        status, transactionsByRoster, usersInLeagueMap,
      });
      if (!result.ok) issues = result.issues;
    } catch (err) {
      issues = [{
        path: "(validator)",
        message: err instanceof Error ? err.message : String(err),
      }];
    }
    if (issues.length > 0) {
      attach = false;
      skippedReason = issues.map(i => `${i.path} ${i.message}`).join("; ");
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error(
          "[trade-attachment] safe-mode fallback engaged — sending plain text only",
          issues
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn("[trade-attachment] safe-mode fallback engaged — sending plain text only");
      }
    }
  }

  if (!attach) {
    const plain = await sendPlainDm(dmId, text, "general");
    return {
      message_id: plain.message_id,
      text: plain.text,
      parent_id: plain.parent_id,
      parent_type: plain.parent_type,
      created: plain.created,
      client_id: plain.client_id,
      attachment_sent: false,
      ...(skippedReason ? { attachment_skipped_reason: skippedReason } : {}),
    };
  }

  // Reaching here means safe-mode passed and we're sending the full trade_dm
  // attachment. The k/v_attachment_data order is fixed to match the native
  // Sleeper payload exactly.
  const clientId = crypto.randomUUID();

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
          attachment
          author_avatar
          author_display_name
          author_id
          created
          message_id
          parent_id
          parent_type
          text
          text_map
          user_reactions
          client_id
        }
      }
    `,
    variables: {
      text,
      k_attachment_data: ["status", "transactions_by_roster", "transaction_id", "league_id", "users_in_league_map"],
      v_attachment_data: [
        status,
        JSON.stringify(transactionsByRoster),
        transactionId,
        leagueId,
        JSON.stringify(usersInLeagueMap),
      ],
    },
    meta: { messagingIntent: "general" },
  });
  return { ...data.create_message, attachment_sent: true };
}

// ─── sendPlainDm — plain-text only, no attachment ─────────────────────────────

export interface SendPlainDmResult {
  message_id: string;
  parent_id: string;
  parent_type: string;
  text: string;
  created: number;
  client_id: string;
}

/**
 * Send a plain-text DM with no attachment_type, no k/v_attachment_data.
 * A fresh client_id is generated on every call.
 *
 * `intent` is REQUIRED and gates this call through the messaging flags:
 *   - "trade-link" → controlled automatic post-trade DM (always allowed
 *     unless explicitly disabled).
 *   - "general"    → user-initiated DM (disabled by default).
 */
export async function sendPlainDm(
  dmId: string,
  text: string,
  intent: "trade-link" | "general" = "general",
): Promise<SendPlainDmResult> {
  const clientId = crypto.randomUUID();
  const data = await sleeperGraphQLRequest<{ create_message: SendPlainDmResult }>({
    operationName: "create_message",
    query: `
      mutation create_message($text: String) {
        create_message(
          parent_id: "${dmId}",
          client_id: "${clientId}",
          parent_type: "dm",
          text: $text
        ) {
          message_id
          parent_id
          parent_type
          text
          created
          client_id
        }
      }
    `,
    variables: { text },
    meta: { messagingIntent: intent },
  });
  return data.create_message;
}

// ─── DM messaging ─────────────────────────────────────────────────────────────

export interface SleeperDmMessage {
  message_id: string;
  parent_id: string;
  parent_type: string;
  author_id: string;
  author_display_name: string;
  author_avatar: string | null;
  author_real_name: string | null;
  author_is_bot: boolean;
  author_role_id: string | null;
  text: string | null;
  text_map: Record<string, unknown> | null;
  attachment: { type: string; [key: string]: unknown } | null;
  created: number;
  edited: number | null;
  pinned: boolean;
  reactions: Record<string, unknown> | null;
  user_reactions: Record<string, unknown> | null;
  client_id?: string;
  _optimistic?: boolean;
}

export async function fetchDmMessages(dmId: string): Promise<SleeperDmMessage[]> {
  const data = await sleeperGraphQLRequest<{ messages: SleeperDmMessage[] }>({
    operationName: "messages",
    query: `query messages { messages(parent_id: "${dmId}") { attachment author_avatar author_display_name author_real_name author_id author_is_bot author_role_id created edited message_id parent_id parent_type pinned reactions user_reactions text text_map } }`,
  });
  return data.messages ?? [];
}

export async function sendDmMessage(dmId: string, text: string): Promise<SleeperDmMessage> {
  const clientId = crypto.randomUUID();
  const data = await sleeperGraphQLRequest<{ create_message: SleeperDmMessage }>({
    operationName: "create_message",
    query: `
      mutation create_message($text: String) {
        create_message(
          parent_id: "${dmId}",
          client_id: "${clientId}",
          parent_type: "dm",
          text: $text
        ) {
          attachment author_avatar author_display_name author_real_name
          author_id author_is_bot author_role_id created edited
          message_id parent_id parent_type pinned reactions
          user_reactions text text_map client_id
        }
      }
    `,
    variables: { text },
    meta: { messagingIntent: "general" },
  });
  return data.create_message;
}

export async function sendLeagueChatMessage(
  leagueId: string,
  text: string
): Promise<SleeperDmMessage> {
  const clientId = crypto.randomUUID();
  const data = await sleeperGraphQLRequest<{ create_message: SleeperDmMessage }>({
    operationName: "create_message",
    query: `
      mutation create_message($text: String) {
        create_message(
          parent_id: "${leagueId}",
          client_id: "${clientId}",
          parent_type: "league",
          text: $text
        ) {
          attachment author_avatar author_display_name author_real_name
          author_id author_is_bot author_role_id created edited
          message_id parent_id parent_type pinned reactions
          user_reactions text text_map client_id
        }
      }
    `,
    variables: { text },
    meta: { messagingIntent: "general" },
  });
  return data.create_message;
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

// ─── Automatic post-trade Dynasty Command link DM ────────────────────────────
//
// Single source of truth for the controlled, automatic message we send to a
// trade partner right after a propose_trade succeeds. This is the ONLY
// messaging surface that remains active while general messaging is
// disabled. Templated copy, no free-text input, caps + dedupe enforced.

/** Fixed copy — never user-customizable. */
const TRADE_LINK_DM_TEXT =
  "Trade sent through Dynasty Command by StatChasers: https://statchasers.com/dynasty-command/";

export type TradeLinkDmStatus = "sent" | "skipped" | "failed";

export interface FirePostTradeLinkDmParams {
  /** Sleeper user_id of the trade recipient. */
  recipientUserId: string;
  /** League the trade was sent in. */
  leagueId: string;
  /** Sender Sleeper user_id, when known — for accurate dedupe across DC accounts. */
  senderUserId?: string | null;
  /** Diagnostic queue label for logs (e.g. "bulk-trade", "trade-calc"). */
  queueType?: string;
}

export interface FirePostTradeLinkDmResult {
  status: TradeLinkDmStatus;
  /** When status === "skipped". */
  skipReason?: TradeLinkSkipReason;
  /** When status === "failed". */
  error?: string;
}

function randRange(loMs: number, hiMs: number): number {
  return Math.floor(loMs + Math.random() * (hiMs - loMs));
}

/**
 * Fire the automatic post-trade Dynasty Command link DM.
 *
 *   1. Waits a randomized 20–60 s so it looks human-paced relative to the
 *      preceding propose_trade.
 *   2. Re-runs preflight after the wait (cap counts may have advanced).
 *   3. Resolves the recipient's DM channel and sends a plain-text DM via
 *      sendPlainDm with intent "trade-link" — the only path that bypasses
 *      the general-messaging gate.
 *   4. Records the send so caps + dedupe work on the NEXT call.
 *
 * This function NEVER throws. Trades must not roll back if the DM fails.
 * Returns a discriminated status so the caller can surface user-facing
 * messaging.
 */
export async function firePostTradeLinkDm(
  params: FirePostTradeLinkDmParams,
): Promise<FirePostTradeLinkDmResult> {
  const { recipientUserId, leagueId, senderUserId, queueType } = params;

  if (!recipientUserId || !leagueId) {
    return { status: "failed", error: "Missing recipient or league id." };
  }

  // 1) Preflight up front — if disabled or already over caps for this
  //    triple, exit before paying the 20–60s wait.
  const preBefore = canSendTradeLinkDm({ senderUserId, recipientUserId, leagueId });
  if (!preBefore.ok) {
    return { status: "skipped", skipReason: preBefore.skipReason };
  }

  // 2) Humanized post-trade pause.
  const delayMs = randRange(20_000, 60_000);
  await new Promise((r) => setTimeout(r, delayMs));

  // 3) Re-preflight — counts may have moved while we waited.
  const preAfter = canSendTradeLinkDm({ senderUserId, recipientUserId, leagueId });
  if (!preAfter.ok) {
    return { status: "skipped", skipReason: preAfter.skipReason };
  }

  // 4) Resolve DM channel. Treat resolution failure as a generic failure
  //    so the caller can surface "could not deliver" without revealing
  //    Sleeper-internal error text in the UI.
  try {
    const dmInfo = await getDmByMembersFull(recipientUserId);
    if (!dmInfo?.dm_id) {
      return { status: "failed", error: "No DM channel with the trade recipient." };
    }
    await sendPlainDm(dmInfo.dm_id, TRADE_LINK_DM_TEXT, "trade-link");

    // 5) Record on success — cap + dedupe state advances.
    recordTradeLinkDm({ recipientUserId, leagueId, senderUserId });

    // eslint-disable-next-line no-console
    console.info(
      `[Sleeper trade-link-dm] sent league=${leagueId} recipient=${recipientUserId} queue=${queueType ?? "single"}`,
    );
    return { status: "sent" };
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Sleeper trade-link-dm] failed league=${leagueId} recipient=${recipientUserId} queue=${queueType ?? "single"}: ${err?.message ?? err}`,
    );
    return { status: "failed", error: err?.message ?? "DM failed" };
  }
}

/** Status → user-facing copy for trade flows. */
export function describeTradeLinkResult(r: FirePostTradeLinkDmResult): string {
  if (r.status === "sent") return "Trade sent. Dynasty Command link shared with the manager.";
  if (r.status === "failed") return "Trade sent. Link message could not be delivered.";
  // Skipped — show the canonical safe-limits copy regardless of which
  // specific skip reason fired. Internal details are in console logs.
  return "Trade sent. Link message skipped to stay within safe messaging limits.";
}
