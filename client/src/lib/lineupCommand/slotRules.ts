/**
 * Centralized slot eligibility rules for fantasy football positions.
 * Ensures consistent slot legality checks across optimizer, diff calculator, and waiver simulation.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'DL' | 'LB' | 'DB';
export type Slot = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'SUPER_FLEX' | 'K' | 'DEF' |
                   'REC_FLEX' | 'WRRB_FLEX' | 'IDP_FLEX' | 'DL' | 'LB' | 'DB' | 'BN';

/**
 * Maps each position to the slots it can legally fill.
 */
const SLOT_RULES: Record<string, Slot[]> = {
  QB:  ['QB', 'SUPER_FLEX'],
  RB:  ['RB', 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX'],
  WR:  ['WR', 'FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX'],
  TE:  ['TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'],
  K:   ['K'],
  DEF: ['DEF'],
  DST: ['DEF'],
  // IDP positions
  DL: ['DL', 'IDP_FLEX'],
  LB: ['LB', 'IDP_FLEX'],
  DB: ['DB', 'IDP_FLEX'],
};

/**
 * Check if a given position can legally fill a given slot.
 */
export function canFillSlot(pos: string, slot: string): boolean {
  const normalizedPos = pos === 'DST' ? 'DEF' : pos;
  const eligibleSlots = SLOT_RULES[normalizedPos] || [];
  return eligibleSlots.includes(slot as Slot);
}

/**
 * Check if two positions share any eligible slots (are interchangeable).
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
 */
export function getEligibleSlots(pos: string): Slot[] {
  const normalizedPos = pos === 'DST' ? 'DEF' : pos;
  return SLOT_RULES[normalizedPos] || [];
}

/**
 * Check if a slot is a flex-type slot (can accept multiple positions).
 */
export function isFlexSlot(slot: string): boolean {
  return ['FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX', 'IDP_FLEX'].includes(slot);
}

/**
 * Find the most restrictive eligible slot for a position from available slots.
 * Prefers specific slots (RB, WR, etc.) over flex slots.
 */
export function findBestSlot(pos: string, availableSlots: string[]): string | null {
  const eligibleSlots = getEligibleSlots(pos);
  const slotPriority: Slot[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB',
                                 'REC_FLEX', 'WRRB_FLEX', 'FLEX', 'SUPER_FLEX', 'IDP_FLEX'];
  for (const slot of slotPriority) {
    if (eligibleSlots.includes(slot) && availableSlots.includes(slot)) return slot;
  }
  return null;
}
