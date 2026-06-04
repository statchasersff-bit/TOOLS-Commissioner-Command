/**
 * Estimate the best LEGAL lineup from a roster's available players, using the
 * league's roster positions and our projection estimates. The gap between the
 * actual starting projection and this optimal projection is the "optimality
 * gap" — a core integrity/tanking signal.
 *
 * Only AVAILABLE players are eligible for the optimal lineup (inactive / IR /
 * on-bye players are excluded), so "you should have started X" never points at
 * a player who couldn't have played.
 */
import type { PlayerCheck, OptimalSlot } from "./types";

// Slot → eligible positions.
const ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  WRRB: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  SUPERFLEX: ["QB", "RB", "WR", "TE"],
  K: ["K"],
  DEF: ["DEF", "DST"],
  DST: ["DEF", "DST"],
  IDP_FLEX: ["DL", "LB", "DB"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
};

export function getEligiblePositions(slot: string | null | undefined): string[] {
  if (!slot) return ELIGIBILITY.FLEX;
  return ELIGIBILITY[slot] ?? ELIGIBILITY.FLEX;
}

export function isEligibleForStarterSlot(
  position: string | null | undefined,
  slot: string | null | undefined,
): boolean {
  const pos = (position ?? "").toUpperCase();
  return getEligiblePositions(slot).includes(pos);
}

// Fill the most constrained slots first so a SUPER_FLEX/FLEX doesn't greedily
// eat a player a single-position slot needed. Lower number = filled earlier.
const SLOT_SCARCITY: Record<string, number> = {
  QB: 0, RB: 1, WR: 1, TE: 2, K: 3, DEF: 3, DST: 3,
  DL: 3, LB: 3, DB: 3,
  WRRB_FLEX: 5, WRRB: 5, REC_FLEX: 5, FLEX: 6, IDP_FLEX: 6, SUPER_FLEX: 7, SUPERFLEX: 7,
};

function slotScarcity(slot: string): number {
  return SLOT_SCARCITY[slot] ?? 4;
}

export function buildOptimalLineup(input: {
  rosterPlayers: PlayerCheck[];
  rosterPositions: string[]; // STARTING slots only (bench/IR/taxi removed)
}): { optimalSlots: OptimalSlot[]; projectedOptimalPoints: number } {
  const available = input.rosterPlayers.filter(
    (p) => !p.isInactive && !p.isIr && !p.isOnBye,
  );

  const selected = new Set<string>();
  const optimalSlots: OptimalSlot[] = [];

  const orderedSlots = [...input.rosterPositions].sort(
    (a, b) => slotScarcity(a) - slotScarcity(b),
  );

  for (const slot of orderedSlots) {
    const eligible = getEligiblePositions(slot);
    const best = available
      .filter((p) => !selected.has(p.playerId))
      .filter((p) => eligible.includes((p.position ?? "").toUpperCase()))
      .sort((a, b) => b.projection - a.projection)[0];

    if (best) {
      selected.add(best.playerId);
      optimalSlots.push({
        slot,
        playerId: best.playerId,
        playerName: best.playerName,
        projection: best.projection,
      });
    } else {
      optimalSlots.push({ slot, playerId: null, projection: 0 });
    }
  }

  const projectedOptimalPoints =
    Math.round(optimalSlots.reduce((sum, s) => sum + (s.projection ?? 0), 0) * 10) / 10;

  return { optimalSlots, projectedOptimalPoints };
}
