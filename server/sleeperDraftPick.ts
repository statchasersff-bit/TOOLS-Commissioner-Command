/**
 * Server-side `draft_pick_player` mutation against sleeper.com/graphql.
 *
 * The Sleeper JWT is read from our encrypted server-side store, decrypted
 * once per call, and used to construct the request. The token is NEVER
 * logged, returned to the client, or echoed in error messages. Failure
 * details surface enough to be actionable ("not your pick", "player
 * already drafted") without leaking the token or full payload.
 *
 * This module is the ONLY place that should build the draft-pick mutation.
 * Keep the call signature stable so the queue middleware doesn't need to
 * know about the GraphQL shape.
 */

const SLEEPER_GRAPHQL_URL = "https://sleeper.com/graphql";

export interface DraftPickResult {
  draft_id: string;
  pick_no: number;
  player_id: string;
  picked_by: string;
  is_keeper: boolean | null;
  metadata: Record<string, unknown> | null;
  reactions: unknown[] | null;
}

export class DraftPickError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Map common Sleeper-side error messages to user-friendly codes. The
 * upstream API returns human-readable strings in `errors[0].message`;
 * we translate a few we know about. Anything we don't recognize falls
 * through with a generic SLEEPER_REJECTED code.
 */
function classifySleeperError(message: string): { code: string; userMessage: string; status: number } {
  const m = message.toLowerCase();
  if (m.includes("unauthorized") || m.includes("invalid token") || m.includes("expired")) {
    return {
      code: "SLEEPER_TOKEN_INVALID",
      userMessage: "Your Sleeper session has expired. Please reconnect Sleeper from the Connect tab.",
      status: 401,
    };
  }
  if (m.includes("not on the clock") || m.includes("not your turn")) {
    return {
      code: "NOT_ON_CLOCK",
      userMessage: "It's not your pick right now. Refresh the board if you think this is wrong.",
      status: 409,
    };
  }
  if (m.includes("already drafted") || m.includes("already picked")) {
    return {
      code: "PLAYER_ALREADY_DRAFTED",
      userMessage: "That player has already been drafted by someone else.",
      status: 409,
    };
  }
  if (m.includes("invalid pick") || m.includes("pick_no")) {
    return {
      code: "STALE_PICK_NO",
      userMessage: "Draft has advanced. Refresh and try again.",
      status: 409,
    };
  }
  if (m.includes("invalid player") || m.includes("player_id")) {
    return {
      code: "INVALID_PLAYER",
      userMessage: "That player isn't a valid Sleeper player.",
      status: 400,
    };
  }
  return { code: "SLEEPER_REJECTED", userMessage: message, status: 400 };
}

/**
 * Submit a draft pick via the Sleeper GraphQL `draft_pick_player`
 * mutation. The mutation's parameters are inlined into the query string
 * because Sleeper's web app does the same — keeping the request shape
 * identical reduces the chance of a 400 from a variable-binding mismatch.
 *
 * Token handling:
 *   - Caller passes the decrypted JWT. We attach it to the Authorization
 *     header and never echo it elsewhere.
 *   - On any failure path the JWT is not included in the error message.
 */
export async function sleeperDraftPickPlayer(opts: {
  token: string;
  draftId: string;
  playerId: string;
  pickNo: number;
}): Promise<DraftPickResult> {
  const { token, draftId, playerId, pickNo } = opts;
  // Server-side defensive validation. The route already validates these,
  // but a typo at the call site shouldn't slip through into a 400 round-trip.
  if (!token) throw new DraftPickError("SLEEPER_TOKEN_MISSING", "Sleeper token missing.", 401);
  if (!draftId || !/^[0-9]+$/.test(draftId)) {
    throw new DraftPickError("INVALID_DRAFT_ID", "Invalid draft id.", 400);
  }
  if (!playerId || !/^[A-Za-z0-9_-]+$/.test(playerId)) {
    throw new DraftPickError("INVALID_PLAYER", "Invalid player id.", 400);
  }
  if (!Number.isInteger(pickNo) || pickNo < 1) {
    throw new DraftPickError("INVALID_PICK_NO", "Invalid pick number.", 400);
  }

  // Build the query string the same way Sleeper's own web client does —
  // mutation name + inlined args. We intentionally don't use $variables.
  const query = `
    mutation draft_pick_player {
      draft_pick_player(
        sport: "nfl",
        player_id: "${playerId}",
        draft_id: "${draftId}",
        pick_no: ${pickNo}
      ) {
        draft_id
        pick_no
        player_id
        picked_by
        is_keeper
        metadata
        reactions
      }
    }
  `;

  let res: Response;
  try {
    res = await fetch(SLEEPER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "authorization": token,
        "x-sleeper-graphql-op": "draft_pick_player",
      },
      body: JSON.stringify({
        operationName: "draft_pick_player",
        variables: {},
        query,
      }),
    });
  } catch (err: any) {
    // Network-level failure — don't include the token in the error.
    throw new DraftPickError("SLEEPER_NETWORK_ERROR", `Sleeper request failed: ${err?.message ?? "unknown"}`, 502);
  }

  let body: any = null;
  try { body = await res.json(); } catch { /* leave null */ }

  if (!res.ok) {
    const apiMsg = body?.errors?.[0]?.message ?? body?.message ?? `HTTP ${res.status}`;
    const { code, userMessage, status } = classifySleeperError(String(apiMsg));
    throw new DraftPickError(code, userMessage, status);
  }

  if (body?.errors?.length) {
    const apiMsg = body.errors[0]?.message ?? "Sleeper rejected the pick.";
    const { code, userMessage, status } = classifySleeperError(String(apiMsg));
    throw new DraftPickError(code, userMessage, status);
  }

  const pick = body?.data?.draft_pick_player;
  if (!pick) {
    throw new DraftPickError("SLEEPER_EMPTY_RESPONSE", "Sleeper returned an empty response.", 502);
  }
  return pick as DraftPickResult;
}
