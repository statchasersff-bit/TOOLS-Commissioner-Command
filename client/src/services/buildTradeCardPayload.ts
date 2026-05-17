/**
 * Native-equivalent trade_dm payload generator.
 *
 * Builds the exact shape Sleeper's own client sends to `create_message` for a
 * trade DM. Use the result with `sendTradeMessage({ attachTradeCard: true, ... })`.
 *
 * Contract:
 *   - No partial player objects ever. If even one player on the trade cannot
 *     be resolved to a full Sleeper player object (from the players DB or the
 *     propose_trade `player_map`), this returns { ok: false } and the caller
 *     MUST fall back to plain-text DM.
 *   - No `{ player_id }` fallback. The resolved object must include either
 *     `full_name` OR `first_name`+`last_name` to count as full.
 *   - Real Sleeper user objects come from /league/{id}/users — placeholders
 *     are rejected.
 *   - All six per-roster list fields are populated on BOTH sides:
 *       adds (receiver)            drops (sender)
 *       added_picks (receiver)     dropped_picks (sender)
 *       added_budget (receiver)    dropped_budget (sender)
 *   - The final payload is re-checked through the Zod schema in
 *     tradeAttachmentSchema.ts before returning ok=true.
 *
 * NEVER add branding fields to the payload — Sleeper's renderer may treat
 * unknown keys as iterable and crash.
 */

import type { ProposeTradeResult } from "./sleeperAuthedApi";
import {
  validateTradeAttachmentPayload,
  type TradeCardAttachment,
  type TradeCardValidationIssue,
} from "./tradeAttachmentSchema";

/** Minimal shape we need from a /league/{id}/users entry. */
export interface LeagueUserLike {
  user_id: string;
  display_name?: string | null;
  avatar?: string | null;
  metadata?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
}

export interface TradeCardBuildContext {
  /** Full Sleeper players DB (e.g. result of getSleeperPlayers()). */
  playersDb: Record<string, unknown>;
  /** League users from /league/{leagueId}/users. */
  leagueUsers: LeagueUserLike[];
  /** Map of roster_id → owner user_id. Derived from /league/{leagueId}/rosters. */
  rosterOwnerByRosterId: Record<number, string>;
}

export type TradeCardBuildResult =
  | { ok: true; payload: TradeCardAttachment }
  | { ok: false; reason: string; issues?: TradeCardValidationIssue[] };

interface NativeUser {
  avatar: string | null;
  display_name: string;
  is_bot: boolean;
  is_owner: boolean;
  league_id: string;
  metadata: Record<string, unknown>;
  settings: Record<string, unknown>;
  user_id: string;
}

interface NormalizedPick {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

interface NormalizedBudget {
  sender: number;
  receiver: number;
  amount: number;
}

/**
 * A full Sleeper player object must include `player_id` plus identifying name
 * fields. Anything less (e.g. bare `{ player_id }`) is rejected so the
 * desktop trade-DM renderer never iterates a partial object.
 */
function isFullPlayerObject(p: unknown): p is Record<string, unknown> {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.player_id !== "string" || !o.player_id) return false;
  return (
    typeof o.full_name === "string" ||
    (typeof o.first_name === "string" && typeof o.last_name === "string")
  );
}

/**
 * Parse a Sleeper pick — either the CSV string form
 * `"originalRosterId,season,round,owner_id,previous_owner_id"` returned by
 * propose_trade, or an already-parsed object.
 */
function normalizePick(pick: unknown): NormalizedPick | null {
  if (typeof pick === "string") {
    const parts = pick.split(",");
    if (parts.length < 5) return null;
    const roster_id = Number(parts[0]);
    const season = parts[1];
    const round = Number(parts[2]);
    const owner_id = Number(parts[3]);
    const previous_owner_id = Number(parts[4]);
    if (!season) return null;
    if (![roster_id, round, owner_id, previous_owner_id].every(Number.isFinite)) {
      return null;
    }
    return { season, round, roster_id, owner_id, previous_owner_id };
  }
  if (pick && typeof pick === "object") {
    const p = pick as Record<string, unknown>;
    const season =
      typeof p.season === "string" ? p.season : p.season != null ? String(p.season) : "";
    const round = Number(p.round);
    const roster_id = Number(p.roster_id);
    const owner_id = Number(p.owner_id);
    const previous_owner_id = Number(p.previous_owner_id);
    if (!season) return null;
    if (![round, roster_id, owner_id, previous_owner_id].every(Number.isFinite)) {
      return null;
    }
    return { season, round, roster_id, owner_id, previous_owner_id };
  }
  return null;
}

function normalizeBudget(wb: unknown): NormalizedBudget | null {
  if (!wb || typeof wb !== "object") return null;
  const w = wb as Record<string, unknown>;
  const sender = Number(w.sender);
  const receiver = Number(w.receiver);
  const amount = Number(w.amount);
  if (![sender, receiver, amount].every(Number.isFinite)) return null;
  return { sender, receiver, amount };
}

/**
 * Build a native-equivalent trade_dm payload from a propose_trade result.
 *
 * Returns { ok: false, reason } when any input is incomplete — callers must
 * fall back to plain-text DM. Returns { ok: true, payload } only when the
 * full payload passes the Zod schema.
 */
export function buildNativeTradeCardPayload(
  trade: ProposeTradeResult,
  ctx: TradeCardBuildContext
): TradeCardBuildResult {
  const { playersDb, leagueUsers, rosterOwnerByRosterId } = ctx;
  const leagueId = trade.league_id;
  if (!leagueId) return { ok: false, reason: "trade.league_id is missing" };

  // ── Real Sleeper user objects, indexed by user_id ──────────────────────────
  const usersByUserId = new Map<string, NativeUser>();
  for (const u of leagueUsers) {
    if (!u || !u.user_id) continue;
    usersByUserId.set(u.user_id, {
      avatar: u.avatar ?? null,
      display_name: u.display_name || u.user_id,
      is_bot: false,
      is_owner: false,
      league_id: leagueId,
      metadata: (u.metadata as Record<string, unknown>) ?? {},
      settings: (u.settings as Record<string, unknown>) ?? {},
      user_id: u.user_id,
    });
  }

  // ── Collect every roster the trade touches ────────────────────────────────
  const involvedRids = new Set<number>();
  for (const rid of trade.roster_ids ?? []) {
    if (Number.isFinite(rid)) involvedRids.add(Number(rid));
  }
  for (const rid of Object.values(trade.adds ?? {})) involvedRids.add(Number(rid));
  for (const rid of Object.values(trade.drops ?? {})) involvedRids.add(Number(rid));
  const normalizedPicks: NormalizedPick[] = [];
  for (const raw of trade.draft_picks ?? []) {
    const p = normalizePick(raw);
    if (!p) {
      return { ok: false, reason: "trade contains an unparseable draft pick" };
    }
    normalizedPicks.push(p);
    involvedRids.add(p.owner_id);
    involvedRids.add(p.previous_owner_id);
  }
  const normalizedBudgets: NormalizedBudget[] = [];
  for (const raw of trade.waiver_budget ?? []) {
    const w = normalizeBudget(raw);
    if (!w) {
      return { ok: false, reason: "trade contains an unparseable waiver_budget entry" };
    }
    normalizedBudgets.push(w);
    involvedRids.add(w.sender);
    involvedRids.add(w.receiver);
  }

  // ── Resolve every player to a full object, with no partial fallbacks ──────
  const playerIds = new Set<string>([
    ...Object.keys(trade.adds ?? {}),
    ...Object.keys(trade.drops ?? {}),
  ]);
  const resolvedPlayers = new Map<string, Record<string, unknown>>();
  const missingPlayerIds: string[] = [];
  for (const pid of Array.from(playerIds)) {
    const fromDb = playersDb[pid];
    const fromMap = trade.player_map?.[pid];
    const source = isFullPlayerObject(fromDb)
      ? fromDb
      : isFullPlayerObject(fromMap)
        ? fromMap
        : null;
    if (!source) {
      missingPlayerIds.push(pid);
      continue;
    }
    resolvedPlayers.set(pid, source);
  }
  if (missingPlayerIds.length > 0) {
    return {
      ok: false,
      reason:
        `missing full player data for ${missingPlayerIds.length} player(s): ` +
        missingPlayerIds.join(", "),
    };
  }

  // ── Build per-roster entries (both sending AND receiving sides) ───────────
  const status = trade.status || "proposed";
  const transactionsByRoster: Record<string, unknown> = {};
  const userObjectsInUse = new Map<string, NativeUser>();

  for (const rid of Array.from(involvedRids)) {
    if (!Number.isFinite(rid)) continue;
    const ridStr = String(rid);

    const adds: unknown[] = [];
    const drops: unknown[] = [];
    for (const [pid, receivingRid] of Object.entries(trade.adds ?? {})) {
      if (Number(receivingRid) === rid) {
        adds.push(resolvedPlayers.get(pid));
      }
    }
    for (const [pid, sendingRid] of Object.entries(trade.drops ?? {})) {
      if (Number(sendingRid) === rid) {
        drops.push(resolvedPlayers.get(pid));
      }
    }

    const added_picks: NormalizedPick[] = [];
    const dropped_picks: NormalizedPick[] = [];
    for (const pick of normalizedPicks) {
      if (pick.owner_id === rid) added_picks.push(pick);
      if (pick.previous_owner_id === rid) dropped_picks.push(pick);
    }

    const added_budget: NormalizedBudget[] = [];
    const dropped_budget: NormalizedBudget[] = [];
    for (const w of normalizedBudgets) {
      if (w.receiver === rid) added_budget.push(w);
      if (w.sender === rid) dropped_budget.push(w);
    }

    const ownerUserId = rosterOwnerByRosterId[rid];
    const user = ownerUserId ? usersByUserId.get(ownerUserId) : undefined;
    if (!user) {
      return {
        ok: false,
        reason: `no user object for roster ${rid} (owner_user_id=${ownerUserId ?? "missing"})`,
      };
    }
    userObjectsInUse.set(user.user_id, user);

    transactionsByRoster[ridStr] = {
      adds,
      drops,
      added_picks,
      dropped_picks,
      added_budget,
      dropped_budget,
      status,
      user,
    };
  }

  const usersInLeagueMap: Record<string, unknown> = {};
  for (const [uid, u] of Array.from(userObjectsInUse)) usersInLeagueMap[uid] = u;

  // ── Final schema gate ─────────────────────────────────────────────────────
  const payload = { status, transactionsByRoster, usersInLeagueMap };
  const result = validateTradeAttachmentPayload(payload);
  if (!result.ok) {
    return {
      ok: false,
      reason: "generated payload failed schema validation",
      issues: result.issues,
    };
  }
  return { ok: true, payload: payload as TradeCardAttachment };
}
