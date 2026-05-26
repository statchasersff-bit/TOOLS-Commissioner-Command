/**
 * Diff-based recommendation builder for fantasy football lineups.
 * Compares before/after lineups to produce clear, actionable recommendations.
 */

import { interchangeable } from './slotRules';

export type Starter = {
  playerId: string;
  name: string;
  pos: string;
  slot: string;
  proj: number;
  locked?: boolean;
};

export type RecommendationDiff = {
  add: { playerId: string; name: string; pos: string; slot: string; source: 'FA' | 'BENCH' };
  moves: Array<{ playerId: string; name: string; from: string; to: string }>;
  bench: Array<{ playerId: string; name: string; pos: string; proj: number }>;
  netDelta: number;
  displaced: { name: string; pos: string } | null;
  source: 'FA' | 'BENCH';
  fromIR?: boolean;
};

/**
 * Diff two lineup snapshots and produce a structured recommendation.
 * @param before - Current starting lineup
 * @param after - Optimal starting lineup after change
 * @param projections - Map of player projections
 * @param source - Whether the added player is from FA or BENCH
 * @param fromIR - Whether the added player is coming from IR
 * @returns Structured recommendation with add, moves, bench, and netDelta
 */
export function diffLineups(
  before: Starter[],
  after: Starter[],
  projections: Map<string, number>,
  source: 'FA' | 'BENCH' = 'BENCH',
  fromIR: boolean = false
): RecommendationDiff | null {
  const beforeMap = new Map(before.map(s => [s.playerId, s]));
  const afterMap = new Map(after.map(s => [s.playerId, s]));

  // Find the player being added (in after but not in before)
  const addedStarters = Array.from(afterMap.values()).filter(s => !beforeMap.has(s.playerId));
  if (addedStarters.length === 0) {
    return null; // No change
  }
  
  const add = addedStarters[0]; // Should only be one per recommendation

  // Find players being benched (in before but not in after)
  const bench = Array.from(beforeMap.values())
    .filter(s => !afterMap.has(s.playerId))
    .map(s => ({
      playerId: s.playerId,
      name: s.name,
      pos: s.pos,
      proj: s.proj
    }));

  // Find moves (players changing slots)
  const moves = Array.from(afterMap.values())
    .map(s => {
      const prev = beforeMap.get(s.playerId);
      return prev && prev.slot !== s.slot
        ? { playerId: s.playerId, name: s.name, from: prev.slot, to: s.slot }
        : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Calculate net delta (after total - before total)
  const beforeTotal = before.reduce((sum, s) => sum + (s.proj || 0), 0);
  const afterTotal = after.reduce((sum, s) => sum + (s.proj || 0), 0);
  const netDelta = afterTotal - beforeTotal;

  // Identify primary displaced player
  const displaced = bench.length > 0 
    ? primaryBenched(add.pos, bench, projections)
    : null;

  return {
    add: {
      playerId: add.playerId,
      name: add.name,
      pos: add.pos,
      slot: add.slot,
      source
    },
    moves,
    bench,
    netDelta,
    displaced,
    source,
    fromIR
  };
}

/**
 * Identify the primary benched player - the one truly displaced by the add.
 * Prefers players whose position is interchangeable with the added player.
 * Tie-breaks by highest projection (the true displacement).
 * 
 * @param addPos - Position of the player being added
 * @param benched - List of players being benched
 * @param projections - Map of player projections
 * @returns Primary benched player, or null if none
 */
function primaryBenched(
  addPos: string,
  benched: Array<{ playerId: string; name: string; pos: string; proj: number }>,
  projections: Map<string, number>
): { name: string; pos: string } | null {
  if (benched.length === 0) return null;

  // Sort by: 1) interchangeable with add position, 2) highest projection
  const sorted = [...benched].sort((a, b) => {
    const aInterchangeable = interchangeable(addPos, a.pos) ? 1 : 0;
    const bInterchangeable = interchangeable(addPos, b.pos) ? 1 : 0;
    
    if (aInterchangeable !== bInterchangeable) {
      return bInterchangeable - aInterchangeable; // Interchangeable first
    }
    
    // Tie-break by projection (use stored proj, fallback to map)
    const aProj = a.proj ?? projections.get(a.playerId) ?? 0;
    const bProj = b.proj ?? projections.get(b.playerId) ?? 0;
    return bProj - aProj; // Higher projection first
  });

  return {
    name: sorted[0].name,
    pos: sorted[0].pos
  };
}

/**
 * Legacy recommendation format for backward compatibility.
 */
export type LegacyRecommendation = {
  out: any;
  in: any;
  slot: string;
  delta: number;
  fromIR?: boolean;
};

/**
 * Dual-format recommendation with both diff and legacy formats.
 * Allows staged migration where new UI can use diff while old UI uses legacy.
 */
export type DualFormatRecommendation = {
  diff: RecommendationDiff;
  legacy: LegacyRecommendation;
};

/**
 * Convert a RecommendationDiff to legacy format.
 * Identifies the primary displaced player (or null for empty slot fills).
 * 
 * @param diff - Diff-based recommendation
 * @returns Legacy format recommendation
 */
export function toLegacyFormat(diff: RecommendationDiff): LegacyRecommendation {
  // For legacy format, we need to identify the "out" player
  // If there's a displaced player, use that; otherwise use first benched or create empty marker
  const outPlayer = diff.displaced
    ? {
        player_id: diff.bench.find(b => b.name === diff.displaced!.name)?.playerId || '',
        name: diff.displaced.name,
        pos: diff.displaced.pos,
        proj: diff.bench.find(b => b.name === diff.displaced!.name)?.proj || 0,
      }
    : null;

  return {
    out: outPlayer,
    in: {
      player_id: diff.add.playerId,
      name: diff.add.name,
      pos: diff.add.pos,
      proj: 0, // Will be filled from actual player data
    },
    slot: diff.add.slot,
    delta: diff.netDelta,
    fromIR: diff.fromIR,
  };
}

/**
 * Build a dual-format recommendation from a lineup diff.
 * Returns both the detailed diff format and the legacy format for backward compatibility.
 * 
 * @param before - Current starting lineup
 * @param after - Optimal starting lineup after change
 * @param projections - Map of player projections
 * @param source - Whether the added player is from FA or BENCH
 * @param fromIR - Whether the added player is coming from IR
 * @returns Dual-format recommendation with both diff and legacy formats
 */
export function buildDualFormatRecommendation(
  before: Starter[],
  after: Starter[],
  projections: Map<string, number>,
  source: 'FA' | 'BENCH' = 'BENCH',
  fromIR: boolean = false
): DualFormatRecommendation | null {
  const diff = diffLineups(before, after, projections, source, fromIR);
  if (!diff) return null;

  const legacy = toLegacyFormat(diff);
  
  return { diff, legacy };
}
