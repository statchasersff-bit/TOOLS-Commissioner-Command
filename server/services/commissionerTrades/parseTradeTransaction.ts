/**
 * parseTradeTransaction — turn a raw Sleeper trade transaction into normalized
 * trade assets (one row per player / pick / FAAB movement).
 *
 * Sleeper represents player movement through `adds` and `drops` maps keyed by
 * player id, whose value is the roster id that received (adds) or gave up
 * (drops) that player. We reconstruct asset direction by comparing the two.
 *
 * All parsing is defensive: Sleeper payloads vary by transaction (FAAB-only,
 * pick-only, three-team, missing player metadata, retired players), so every
 * field is coerced and missing data degrades gracefully rather than throwing.
 */
import type {
  ParsedTradeAsset,
  SleeperPlayerLite,
  SleeperTransaction,
} from "./types";
import { toNum } from "./helpers";

function playerDisplayName(p: SleeperPlayerLite | undefined, playerId: string): string {
  if (!p) return playerId; // Retired / unknown player — fall back to the id.
  if (p.full_name) return p.full_name;
  const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return name || playerId;
}

export function parsePlayerAssets(
  tx: SleeperTransaction,
  players: Record<string, SleeperPlayerLite>,
): ParsedTradeAsset[] {
  const assets: ParsedTradeAsset[] = [];
  const adds = tx.adds ?? {};
  const drops = tx.drops ?? {};

  for (const [playerId, toRosterId] of Object.entries(adds)) {
    // The roster that gave the player up is whoever DROPPED it in the same txn.
    const fromRosterId = drops[playerId];
    const player = players[playerId];
    assets.push({
      assetType: "player",
      playerId,
      playerName: playerDisplayName(player, playerId),
      position: player?.position ?? undefined,
      team: player?.team ?? undefined,
      fromRosterId: fromRosterId != null ? toNum(fromRosterId) : undefined,
      toRosterId: toNum(toRosterId),
    });
  }

  return assets;
}

export function parsePickAssets(tx: SleeperTransaction): ParsedTradeAsset[] {
  const picks = tx.draft_picks ?? [];
  return picks.map((pick) => ({
    assetType: "pick" as const,
    pickSeason: String(pick.season),
    pickRound: toNum(pick.round),
    pickOriginalRosterId: toNum(pick.roster_id),
    fromRosterId: pick.previous_owner_id != null ? toNum(pick.previous_owner_id) : undefined,
    toRosterId: pick.owner_id != null ? toNum(pick.owner_id) : undefined,
  }));
}

export function parseFaabAssets(tx: SleeperTransaction): ParsedTradeAsset[] {
  const rows = tx.waiver_budget ?? [];
  return rows.map((row) => ({
    assetType: "faab" as const,
    faabAmount: toNum(row.amount),
    fromRosterId: row.sender != null ? toNum(row.sender) : undefined,
    toRosterId: row.receiver != null ? toNum(row.receiver) : undefined,
  }));
}

/** Parse all asset movements from a single Sleeper trade transaction. */
export function parseTradeTransaction(
  tx: SleeperTransaction,
  players: Record<string, SleeperPlayerLite>,
): ParsedTradeAsset[] {
  return [
    ...parsePlayerAssets(tx, players),
    ...parsePickAssets(tx),
    ...parseFaabAssets(tx),
  ];
}
