/**
 * Zod schemas for the Sleeper `trade_dm` attachment payload.
 *
 * Shape modeled on a captured native Sleeper `create_message` payload. Any
 * deviation risks crashing Sleeper's desktop trade-DM renderer (`r.map is not
 * a function` and similar). Do NOT add fields here for branding — native
 * Sleeper does not include them, and the renderer may treat unknown keys as
 * iterable.
 *
 * Native field summary (k_attachment_data order is fixed):
 *   k_attachment_data = ["status","transactions_by_roster","transaction_id","league_id","users_in_league_map"]
 *   v_attachment_data = [status, JSON(transactionsByRoster), transaction_id, league_id, JSON(usersInLeagueMap)]
 *
 * Per-roster entry:
 *   adds:           full Sleeper player objects (NOT bare { player_id })
 *   drops:          full Sleeper player objects
 *   added_picks:    { owner_id, previous_owner_id, roster_id, season, round }
 *   dropped_picks:  same
 *   added_budget:   { sender, receiver, amount }
 *   dropped_budget: same
 *   status:         "proposed" | "accepted" | …  (always a non-empty string)
 *   user:           full user object (see TradeCardUserSchema)
 */

import { z } from "zod";

export const TradeCardUserSchema = z.object({
  avatar: z.string().nullable(),
  display_name: z.string().min(1),
  is_bot: z.boolean(),
  is_owner: z.boolean(),
  league_id: z.string().min(1),
  metadata: z.record(z.unknown()),
  settings: z.record(z.unknown()),
  user_id: z.string(),
});

export const TradeCardPickSchema = z.object({
  owner_id: z.number(),
  previous_owner_id: z.number(),
  roster_id: z.number(),
  season: z.string().min(1),
  round: z.number(),
});

export const TradeCardBudgetSchema = z.object({
  sender: z.number(),
  receiver: z.number(),
  amount: z.number(),
});

/**
 * Native Sleeper player objects always include identifying fields (full_name
 * and/or first_name+last_name, plus position/team). We require at least a
 * name field so a bare `{ player_id }` fallback is rejected — that fallback
 * is what currently crashes Sleeper's desktop renderer.
 */
export const TradeCardPlayerSchema = z
  .object({ player_id: z.string().min(1) })
  .passthrough()
  .refine(
    (obj) => {
      const o = obj as Record<string, unknown>;
      return (
        typeof o.full_name === "string" ||
        (typeof o.first_name === "string" && typeof o.last_name === "string")
      );
    },
    { message: "player object missing full_name (or first_name+last_name)" }
  );

export const TradeCardRosterEntrySchema = z.object({
  adds: z.array(TradeCardPlayerSchema),
  drops: z.array(TradeCardPlayerSchema),
  added_picks: z.array(TradeCardPickSchema),
  dropped_picks: z.array(TradeCardPickSchema),
  added_budget: z.array(TradeCardBudgetSchema),
  dropped_budget: z.array(TradeCardBudgetSchema),
  status: z.string().min(1),
  user: TradeCardUserSchema,
});

export const TradeCardAttachmentSchema = z.object({
  status: z.string().min(1),
  transactionsByRoster: z.record(z.string(), TradeCardRosterEntrySchema),
  usersInLeagueMap: z.record(z.string(), TradeCardUserSchema),
});

export type TradeCardAttachment = z.infer<typeof TradeCardAttachmentSchema>;

export interface TradeCardValidationIssue {
  path: string;
  message: string;
}

export interface TradeCardValidationResult {
  ok: boolean;
  issues: TradeCardValidationIssue[];
}

function flattenIssues(err: z.ZodError): TradeCardValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

/** Returns { ok, issues } without throwing. Use for non-blocking inspection. */
export function validateTradeAttachmentPayload(input: unknown): TradeCardValidationResult {
  const parsed = TradeCardAttachmentSchema.safeParse(input);
  if (parsed.success) return { ok: true, issues: [] };
  return { ok: false, issues: flattenIssues(parsed.error) };
}

/**
 * Throws if the payload does not match the native Sleeper `trade_dm` shape.
 * In development, every issue is logged via console.error before throwing so
 * the broken field is visible without inspecting a network request.
 *
 * Call this immediately before any `create_message` mutation that includes
 * `attachment_type: "trade_dm"`.
 */
export function assertValidTradeAttachmentPayload(
  input: unknown
): asserts input is TradeCardAttachment {
  const parsed = TradeCardAttachmentSchema.safeParse(input);
  if (parsed.success) return;
  const issues = flattenIssues(parsed.error);
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[trade-attachment] payload validation failed", issues);
  }
  const summary = issues.map((i) => `${i.path} ${i.message}`).join("; ");
  throw new Error(`Invalid trade-card attachment payload: ${summary}`);
}
