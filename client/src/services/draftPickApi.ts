/**
 * Client wrapper for POST /api/sleeper/drafts/:draftId/pick.
 *
 * The Sleeper JWT is NOT sent from the browser — the server-side
 * encrypted store holds it. The browser only sends the draft id, player
 * id, and pick number.
 *
 * Errors come back as `{ error, code }`. We re-throw a typed error so
 * callers can match on the code and render an inline message instead of
 * a generic "something went wrong."
 */

import { API_BASE } from "@/lib/apiBase";

export interface DraftPickResponse {
  ok: true;
  pick: {
    draft_id: string;
    pick_no: number;
    player_id: string;
    picked_by: string;
    is_keeper: boolean | null;
    metadata: Record<string, unknown> | null;
    reactions: unknown[] | null;
  };
}

export class DraftPickApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const SC_TOKEN_KEY = "sc_auth_token";
function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem(SC_TOKEN_KEY);
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

export async function submitDraftPick(opts: {
  draftId: string;
  playerId: string;
  pickNo: number;
}): Promise<DraftPickResponse> {
  const res = await fetch(`${API_BASE}/api/sleeper/drafts/${encodeURIComponent(opts.draftId)}/pick`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ playerId: opts.playerId, pickNo: opts.pickNo }),
  });

  let body: any = null;
  try { body = await res.json(); } catch { /* leave null */ }

  if (!res.ok) {
    const code = (body?.code as string) ?? "DRAFT_PICK_REQUEST_FAILED";
    const message = (body?.error as string) ?? `HTTP ${res.status}`;
    throw new DraftPickApiError(code, message, res.status);
  }
  return body as DraftPickResponse;
}
