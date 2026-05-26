/**
 * Lineup diffing utilities for computing changes between two lineup states.
 * Computes deltas from full lineup diffs, not slot-by-slot comparisons.
 */

export type LineupPlayer = {
  player_id: string;
  slot: string;
  proj?: number;
  name?: string;
  pos?: string;
  locked?: boolean;
};

export type LineupDiff = {
  added: LineupPlayer[];      // New starters (bench → starter or FA → starter)
  removed: LineupPlayer[];    // Starters pushed to bench
  moved: Array<LineupPlayer & { prevSlot: string }>; // Starters whose slot changed
};

/**
 * Compute the difference between two lineups by comparing player ID sets.
 * 
 * @param before - Starting lineup (array of players in slots)
 * @param after - Ending lineup (array of players in slots)
 * @returns Object with added, removed, and moved players
 * 
 * Algorithm:
 * - added: players in 'after' but not in 'before'
 * - removed: players in 'before' but not in 'after'
 * - moved: players in both, but slot changed
 */
export function diffLineups(before: LineupPlayer[], after: LineupPlayer[]): LineupDiff {
  // Build maps keyed by player_id for fast lookup
  const beforeMap = new Map(
    before
      .filter(s => s.player_id) // Exclude empty slots
      .map(s => [s.player_id, s])
  );
  
  const afterMap = new Map(
    after
      .filter(s => s.player_id) // Exclude empty slots
      .map(s => [s.player_id, s])
  );
  
  // Find added players (in after but not in before)
  const added = Array.from(afterMap.values()).filter(s => !beforeMap.has(s.player_id));
  
  // Find removed players (in before but not in after)
  const removed = Array.from(beforeMap.values()).filter(s => !afterMap.has(s.player_id));
  
  // Find moved players (in both, but slot changed)
  const moved = Array.from(afterMap.values())
    .map(s => {
      const prevSlot = beforeMap.get(s.player_id)?.slot;
      return { ...s, prevSlot: prevSlot || '' };
    })
    .filter(x => x.prevSlot && x.prevSlot !== x.slot);
  
  return { added, removed, moved };
}

/**
 * Calculate the point delta between two lineups.
 * Delta = sum(proj(after)) - sum(proj(before))
 * 
 * @param before - Starting lineup
 * @param after - Ending lineup
 * @returns Net point difference (positive = improvement)
 */
export function calculateLineupDelta(before: LineupPlayer[], after: LineupPlayer[]): number {
  const beforeTotal = before.reduce((sum, p) => sum + (p.proj || 0), 0);
  const afterTotal = after.reduce((sum, p) => sum + (p.proj || 0), 0);
  return afterTotal - beforeTotal;
}

/**
 * Summarize lineup diff into a human-readable explanation.
 * 
 * @param diff - LineupDiff object from diffLineups()
 * @param delta - Total point delta from calculateLineupDelta()
 * @returns Array of change descriptions
 */
export function explainDiff(diff: LineupDiff, delta: number): string[] {
  const explanations: string[] = [];
  
  // Helper to format projection points safely
  const formatProj = (proj: number | undefined, isAddition: boolean): string => {
    if (proj === undefined || !Number.isFinite(proj)) return '';
    const sign = isAddition ? '+' : '-';
    return ` (${sign}${Math.abs(proj).toFixed(1)} pts)`;
  };
  
  // Added players
  diff.added.forEach(p => {
    explanations.push(`➕ Add ${p.name || p.player_id} → ${p.slot}${formatProj(p.proj, true)}`);
  });
  
  // Moved players
  diff.moved.forEach(p => {
    explanations.push(`🔁 Move ${p.name || p.player_id} ${p.prevSlot} → ${p.slot}`);
  });
  
  // Removed players
  diff.removed.forEach(p => {
    explanations.push(`⬇️ Bench ${p.name || p.player_id}${formatProj(p.proj, false)}`);
  });
  
  // Net summary
  if (Math.abs(delta) > 0.01 && Number.isFinite(delta)) {
    const sign = delta > 0 ? '+' : '';
    explanations.push(`Net: ${sign}${delta.toFixed(1)} pts`);
  }
  
  return explanations;
}

/**
 * Sort removed players deterministically for cascade explanations.
 * Priority: slot overlap → higher projection → stable ID order
 * 
 * @param removed - Array of removed players
 * @param added - Array of added players (for slot overlap comparison)
 * @returns Sorted array of removed players
 */
export function sortRemovedPlayers(
  removed: LineupPlayer[], 
  added: LineupPlayer[]
): LineupPlayer[] {
  return removed.sort((a, b) => {
    // Calculate slot overlap with added players
    const overlapA = added.filter(p => p.slot === a.slot).length;
    const overlapB = added.filter(p => p.slot === b.slot).length;
    
    if (overlapA !== overlapB) {
      return overlapB - overlapA; // Higher overlap first
    }
    
    // Tie-break by projection (higher first)
    const projA = a.proj || 0;
    const projB = b.proj || 0;
    if (projA !== projB) {
      return projB - projA;
    }
    
    // Final tie-break: stable ID order
    return (a.player_id || '').localeCompare(b.player_id || '');
  });
}
