// Slot eligibility rules for lineup optimization
// NOTE: This is a stub — fill in with your full slotRules logic when building Lineup Command.

export type Slot =
  | "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPER_FLEX" | "K" | "DEF" | "BN";

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export const SLOT_RULES: Record<Position, Slot[]> = {
  QB:  ["QB", "SUPER_FLEX"],
  RB:  ["RB", "FLEX", "SUPER_FLEX"],
  WR:  ["WR", "FLEX", "SUPER_FLEX"],
  TE:  ["TE", "FLEX", "SUPER_FLEX"],
  K:   ["K"],
  DEF: ["DEF"],
};

export function canFillSlot(pos: string, slot: string): boolean {
  return (SLOT_RULES[pos as Position] ?? []).includes(slot as Slot);
}

export function isFlexSlot(slot: string): boolean {
  return ["FLEX", "SUPER_FLEX", "WRT", "WRTQ", "REC_FLEX", "OP"].includes(slot.toUpperCase());
}

/**
 * Two positions are interchangeable if they share at least one common slot.
 */
export function interchangeable(posA: string, posB: string): boolean {
  const slotsA = new Set(SLOT_RULES[posA as Position] ?? []);
  const slotsB = SLOT_RULES[posB as Position] ?? [];
  return slotsB.some(s => slotsA.has(s));
}
