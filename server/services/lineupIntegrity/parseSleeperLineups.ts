/**
 * Build starter / bench arrays from Sleeper matchup + roster data, and align
 * each starter to its lineup-slot label.
 *
 * Sleeper's matchup row gives `starters` (positional — same order as the
 * league's non-bench roster_positions) and `players` (everyone on the roster
 * that week). Bench = players − starters. Empty starter slots show up as null /
 * "0" entries in the starters array.
 */
export interface SleeperMatchupLite {
  roster_id: number;
  matchup_id?: number | null;
  starters?: Array<string | null> | null;
  players?: string[] | null;
  points?: number | null;
}

export interface SleeperRosterLite {
  roster_id: number;
  players?: string[] | null;
  starters?: Array<string | null> | null;
}

const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Empty-slot sentinels Sleeper uses when a starter slot is left unfilled. */
function isEmptySlot(slot: string | null | undefined): boolean {
  return !slot || slot === "0" || slot === "null" || slot === "None";
}

export function countEmptyStarterSlots(starters: Array<string | null | undefined> | null | undefined): number {
  return (starters ?? []).filter(isEmptySlot).length;
}

/** The ordered list of STARTING slot labels (bench/IR/taxi removed). */
export function getStartingSlots(rosterPositions: string[] | null | undefined): string[] {
  return (rosterPositions ?? []).filter((p) => !NON_STARTING_SLOTS.has(p));
}

export interface ParsedLineup {
  rosterId: number;
  starters: Array<string | null>;
  /** Parallel to `starters`: the slot label for each starter index. */
  starterSlots: string[];
  benchPlayers: string[];
  allPlayers: string[];
}

export function parseSleeperLineup(input: {
  matchup: SleeperMatchupLite | undefined;
  roster: SleeperRosterLite | undefined;
  rosterPositions: string[];
}): ParsedLineup {
  const matchup = input.matchup;
  const roster = input.roster;

  const starters: Array<string | null> = (matchup?.starters ?? roster?.starters ?? []) as Array<string | null>;
  const allPlayers: string[] = (matchup?.players ?? roster?.players ?? []).filter(Boolean) as string[];

  const startingSlots = getStartingSlots(input.rosterPositions);
  // Align slot labels to starter indices. If we don't know the roster layout,
  // fall back to a generic "FLEX" label so eligibility checks stay permissive.
  const starterSlots = starters.map((_, i) => startingSlots[i] ?? "FLEX");

  const starterSet = new Set(starters.filter((s) => !isEmptySlot(s)) as string[]);
  const benchPlayers = allPlayers.filter((pid) => pid && !starterSet.has(pid));

  return {
    rosterId: Number(matchup?.roster_id ?? roster?.roster_id ?? 0),
    starters,
    starterSlots,
    benchPlayers,
    allPlayers,
  };
}
