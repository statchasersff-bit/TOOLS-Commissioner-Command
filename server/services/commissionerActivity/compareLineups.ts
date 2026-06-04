/**
 * Lineup comparison utilities. Sleeper matchup rows carry `starters` (ordered by
 * slot) and `players` (full active roster). We compare starters week-over-week to
 * detect set-and-forget managers, and count empty starter slots (a manager who
 * left a roster slot unfilled — a strong inactivity signal during the season).
 */

/** Placeholder values Sleeper uses for an unfilled starter slot. */
const EMPTY_SLOT_VALUES = new Set(["", "0", "null", "undefined"]);

function isEmptySlot(slot: string | null | undefined): boolean {
  if (slot == null) return true;
  return EMPTY_SLOT_VALUES.has(String(slot).trim());
}

export interface LineupDiff {
  changed: boolean;
  addedToLineup: string[];
  removedFromLineup: string[];
  changeCount: number;
}

export function getLineupDiff(
  currentStarters: Array<string | null> | null | undefined,
  previousStarters: Array<string | null> | null | undefined,
): LineupDiff {
  // Ignore empty slots in the diff so "empty → still empty" isn't a change, and
  // an empty slot being filled IS a change.
  const currentSet = new Set((currentStarters ?? []).filter((s) => !isEmptySlot(s)).map(String));
  const previousSet = new Set((previousStarters ?? []).filter((s) => !isEmptySlot(s)).map(String));

  const addedToLineup = Array.from(currentSet).filter((id) => !previousSet.has(id));
  const removedFromLineup = Array.from(previousSet).filter((id) => !currentSet.has(id));

  return {
    changed: addedToLineup.length > 0 || removedFromLineup.length > 0,
    addedToLineup,
    removedFromLineup,
    changeCount: addedToLineup.length + removedFromLineup.length,
  };
}

export function didLineupChange(
  currentStarters: Array<string | null> | null | undefined,
  previousStarters: Array<string | null> | null | undefined,
): boolean {
  return getLineupDiff(currentStarters, previousStarters).changed;
}

export function countEmptyStarters(starters: Array<string | null | undefined> | null | undefined): number {
  return (starters ?? []).filter((slot) => isEmptySlot(slot)).length;
}
