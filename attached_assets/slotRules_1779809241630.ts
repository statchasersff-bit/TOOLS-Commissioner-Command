/**
 * Centralized slot eligibility rules for fantasy football positions.
 * Ensures consistent slot legality checks across optimizer, diff calculator, and waiver simulation.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'DL' | 'LB' | 'DB';
export type Slot = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'SUPER_FLEX' | 'K' | 'DEF' | 
                   'REC_FLEX' | 'IDP_FLEX' | 'DL' | 'LB' | 'DB';

/**
 * Maps each position to the slots it can legally fill.
 * Offensive positions (QB/RB/WR/TE) can fill SUPER_FLEX.
 * Skill positions (RB/WR/TE) can fill FLEX.
 * RB/WR can also fill REC_FLEX (some leagues).
 */
const SLOT_RULES: Record<string, Slot[]> = {
  QB: ['QB', 'SUPER_FLEX'],
  RB: ['RB', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'],
  WR: ['WR', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'],
  TE: ['TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'], // TE can fill REC_FLEX in some leagues
  K: ['K'],
  DEF: ['DEF'],
  DST: ['DEF'], // Sleeper uses DST, we normalize to DEF
  // IDP positions
  DL: ['DL', 'IDP_FLEX'],
  LB: ['LB', 'IDP_FLEX'],
  DB: ['DB', 'IDP_FLEX'],
};

/**
 * Check if a given position can legally fill a given slot.
 * @param pos - Player's primary position (e.g., 'RB', 'WR')
 * @param slot - Roster slot to check (e.g., 'FLEX', 'RB')
 * @returns true if the position can fill the slot
 */
export function canFillSlot(pos: string, slot: string): boolean {
  // Normalize position (handle DST -> DEF)
  const normalizedPos = pos === 'DST' ? 'DEF' : pos;
  const eligibleSlots = SLOT_RULES[normalizedPos] || [];
  return eligibleSlots.includes(slot as Slot);
}

/**
 * Check if two positions share any eligible slots (are interchangeable).
 * Useful for determining if a player swap is legal.
 * @param posA - First position
 * @param posB - Second position
 * @returns true if positions share at least one eligible slot
 */
export function interchangeable(posA: string, posB: string): boolean {
  const normalizedA = posA === 'DST' ? 'DEF' : posA;
  const normalizedB = posB === 'DST' ? 'DEF' : posB;
  
  const slotsA = new Set(SLOT_RULES[normalizedA] || []);
  const slotsB = SLOT_RULES[normalizedB] || [];
  
  return slotsB.some(slot => slotsA.has(slot));
}

/**
 * Get all slots that a position can legally fill.
 * @param pos - Player's primary position
 * @returns Array of eligible slot names
 */
export function getEligibleSlots(pos: string): Slot[] {
  const normalizedPos = pos === 'DST' ? 'DEF' : pos;
  return SLOT_RULES[normalizedPos] || [];
}

/**
 * Check if a slot is a flex-type slot (can accept multiple positions).
 * @param slot - Slot name to check
 * @returns true if slot is a flex slot
 */
export function isFlexSlot(slot: string): boolean {
  return ['FLEX', 'SUPER_FLEX', 'REC_FLEX', 'IDP_FLEX'].includes(slot);
}

/**
 * Find the most restrictive eligible slot for a position from available slots.
 * Prefers specific slots (RB, WR, etc.) over flex slots.
 * @param pos - Player's primary position
 * @param availableSlots - Array of open slot names
 * @returns Most restrictive slot name, or null if none available
 */
export function findBestSlot(pos: string, availableSlots: string[]): string | null {
  const eligibleSlots = getEligibleSlots(pos);
  
  // Priority order: specific position > REC_FLEX > FLEX > SUPER_FLEX > IDP_FLEX
  const slotPriority: Slot[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 
                                'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'IDP_FLEX'];
  
  for (const slot of slotPriority) {
    if (eligibleSlots.includes(slot) && availableSlots.includes(slot)) {
      return slot;
    }
  }
  
  return null;
}
