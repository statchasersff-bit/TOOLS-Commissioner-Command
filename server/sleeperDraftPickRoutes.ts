/**
 * POST /api/sleeper/drafts/:draftId/pick
 *
 * Server-mediated draft pick. The Sleeper JWT is read from our encrypted
 * store (never from the request body) and used inside the queue task; the
 * response from Sleeper is returned to the client.
 *
 * Gate chain (via `requireWriteCapability`):
 *   - write-access host
 *   - StatChasers session
 *   - linked Sleeper account
 *   - active subscription
 *
 * State validation (inside this handler, BEFORE the mutation):
 *   - draft is `drafting` status
 *   - pickNo equals the current pick number
 *   - playerId not already in picks
 *   - current slot's user_id matches the caller's Sleeper user_id
 *
 * Refusing stale or out-of-turn picks here saves a round-trip to Sleeper
 * and gives the user a tighter error message than Sleeper's own.
 */

import type { Express, Request, Response } from "express";
import { requireWriteCapability } from "./accessMiddleware";
import { getConnectedSleeper, decryptToken } from "./scAuth";
import { enqueueSleeperAction } from "./sleeperWriteQueue";
import {
  sleeperDraftPickPlayer,
  DraftPickError,
  type DraftPickResult,
} from "./sleeperDraftPick";

const SLEEPER_REST = "https://api.sleeper.app/v1";

interface RawDraft {
  draft_id: string;
  status: string;
  type: string;
  league_id: string | null;
  settings?: { teams?: number; rounds?: number };
  draft_order?: Record<string, number> | null;
}

interface RawPick {
  pick_no: number;
  player_id: string | null;
}

async function fetchPublicJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Snake-aware slot resolver. Mirrors the client-side helper so the
 * "current slot" computation always agrees between UI and backend.
 */
function slotForPick(pickNo: number, teams: number, snake: boolean): number {
  const round = Math.ceil(pickNo / teams);
  const pickInRound = ((pickNo - 1) % teams) + 1;
  return snake && round % 2 === 0 ? teams - pickInRound + 1 : pickInRound;
}

export function registerSleeperDraftPickRoutes(app: Express): void {
  app.post(
    "/api/sleeper/drafts/:draftId/pick",
    ...requireWriteCapability,
    async (req: Request, res: Response) => {
      const draftId = String(req.params.draftId || "");
      const body = (req.body ?? {}) as { playerId?: string; pickNo?: number };
      const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
      const pickNo = typeof body.pickNo === "number" ? body.pickNo : NaN;

      // ── Body validation ────────────────────────────────────────────
      if (!draftId || !/^[0-9]+$/.test(draftId)) {
        return res.status(400).json({ error: "Invalid draft id.", code: "INVALID_DRAFT_ID" });
      }
      if (!playerId || !/^[A-Za-z0-9_-]+$/.test(playerId)) {
        return res.status(400).json({ error: "Invalid player id.", code: "INVALID_PLAYER" });
      }
      if (!Number.isInteger(pickNo) || pickNo < 1) {
        return res.status(400).json({ error: "Invalid pick number.", code: "INVALID_PICK_NO" });
      }

      const dcUserId = (req as any).dcUserId as string;

      // ── State validation against the live public Sleeper draft ─────
      // We fetch draft + picks fresh so a stale UI can't slip past.
      const [draft, picks] = await Promise.all([
        fetchPublicJson<RawDraft>(`${SLEEPER_REST}/draft/${draftId}`),
        fetchPublicJson<RawPick[]>(`${SLEEPER_REST}/draft/${draftId}/picks`),
      ]);

      if (!draft) {
        return res.status(404).json({ error: "Draft not found.", code: "DRAFT_NOT_FOUND" });
      }
      if (draft.status !== "drafting") {
        return res.status(409).json({
          error: "Draft is not active.",
          code: "DRAFT_NOT_ACTIVE",
          status: draft.status,
        });
      }

      const picksMade = (picks ?? []).filter((p) => p.player_id).length;
      const currentPickNo = picksMade + 1;
      if (pickNo !== currentPickNo) {
        return res.status(409).json({
          error: "Draft has advanced. Refresh and try again.",
          code: "STALE_PICK_NO",
          currentPickNo,
        });
      }

      if ((picks ?? []).some((p) => p.player_id === playerId)) {
        return res.status(409).json({
          error: "Player already drafted.",
          code: "PLAYER_ALREADY_DRAFTED",
        });
      }

      // ── On-the-clock check ────────────────────────────────────────
      // Reject if the caller's linked Sleeper user_id isn't the owner of
      // the current slot. Skipped only when we lack the data needed to
      // compute it (e.g. an unfilled draft_order — Sleeper will reject
      // the mutation itself in that case).
      const linked = await getConnectedSleeper(dcUserId);
      const sleeperUserId = linked?.sleeperUserId ?? null;
      const teams = draft.settings?.teams ?? 0;
      const draftOrder = draft.draft_order ?? null;
      if (sleeperUserId && teams > 0 && draftOrder && Object.keys(draftOrder).length > 0) {
        const slot = slotForPick(pickNo, teams, draft.type === "snake");
        const currentUserId = Object.entries(draftOrder).find(([, s]) => s === slot)?.[0] ?? null;
        if (currentUserId && currentUserId !== sleeperUserId) {
          return res.status(403).json({
            error: "It's not your pick right now.",
            code: "NOT_ON_CLOCK",
          });
        }
      }

      // ── Token decrypt ─────────────────────────────────────────────
      if (!linked?.encryptedToken) {
        return res.status(403).json({
          error: "Sleeper authentication required.",
          code: "SLEEPER_TOKEN_MISSING",
        });
      }
      const token = decryptToken(linked.encryptedToken);
      if (!token) {
        return res.status(401).json({
          error: "Sleeper token could not be decrypted. Please reconnect Sleeper.",
          code: "SLEEPER_TOKEN_INVALID",
        });
      }

      // ── Submit through the queue ──────────────────────────────────
      try {
        const result: DraftPickResult = await enqueueSleeperAction({
          userId: dcUserId,
          actionType: "DRAFT_PICK",
          leagueId: draft.league_id ?? undefined,
          payloadSummary: `pickNo=${pickNo} player=${playerId}`,
          task: () => sleeperDraftPickPlayer({ token, draftId, playerId, pickNo }),
        });
        return res.json({ ok: true, pick: result });
      } catch (err: any) {
        if (err instanceof DraftPickError) {
          // Structured error — pass code + status through, never the token.
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        // Generic failure path — log without payload, return safe text.
        console.error(`[draft-pick] user=${dcUserId} draft=${draftId} unexpected error:`, err?.message ?? err);
        return res.status(500).json({
          error: "Failed to submit pick.",
          code: "DRAFT_PICK_INTERNAL_ERROR",
        });
      }
    },
  );
}
