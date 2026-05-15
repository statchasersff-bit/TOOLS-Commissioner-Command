const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
};

const SKIP_SLOTS = new Set(["BN", "TAXI", "IR", "K", "DEF", "DL", "LB", "DB", "IDP_FLEX"]);
const DEDICATED_SLOTS = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Pure (non-React) greedy optimal starter algorithm.
 * Step 1: fill dedicated positional slots (QB×N, RB×N, WR×N, TE×N) with top players by value.
 * Step 2: fill each FLEX/SUPER_FLEX/REC_FLEX/WRRB_FLEX slot greedily from remaining eligible pool.
 * No player appears in two slots.
 *
 * @param playerIds  - array of player IDs on the roster
 * @param getPos     - returns the player's position string, or null if unknown
 * @param getValue   - returns the player's value (redraft) for sorting
 * @param rosterPositions - league roster position slots (e.g. ["QB","RB","WR","WR","FLEX","SF","BN",...])
 * @returns Set of player IDs that belong in the optimal starting lineup
 */
export function buildOptimalStarterIds(
  playerIds: string[],
  getPos: (id: string) => string | null,
  getValue: (id: string) => number,
  rosterPositions: string[]
): Set<string> {
  const positionalSlots = rosterPositions.filter((s) => DEDICATED_SLOTS.has(s));
  const flexSlots = rosterPositions.filter(
    (s) => !DEDICATED_SLOTS.has(s) && !SKIP_SLOTS.has(s) && SLOT_ELIGIBILITY[s]
  );

  const sorted = (playerIds
    .map((id) => ({ id, pos: getPos(id), val: getValue(id) }))
    .filter((p) => p.pos !== null) as Array<{ id: string; pos: string; val: number }>)
    .sort((a, b) => b.val - a.val);

  const used = new Set<string>();
  const starterIds = new Set<string>();

  for (const slot of positionalSlots) {
    const eligible = SLOT_ELIGIBILITY[slot] ?? [];
    const best = sorted.find((p) => eligible.includes(p.pos) && !used.has(p.id));
    if (best) {
      used.add(best.id);
      starterIds.add(best.id);
    }
  }

  for (const slot of flexSlots) {
    const eligible = SLOT_ELIGIBILITY[slot] ?? [];
    const best = sorted.find((p) => eligible.includes(p.pos) && !used.has(p.id));
    if (best) {
      used.add(best.id);
      starterIds.add(best.id);
    }
  }

  return starterIds;
}
