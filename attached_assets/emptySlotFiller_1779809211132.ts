import { canFillSlot } from "./slotRules";
import { isPlayerLocked, type GameSchedule } from "./gameLocking";
import type { Projection } from "./types";

export interface PlayerCandidate {
  player_id: string;
  name: string;
  pos: string;
  proj: number;
  team?: string;
  opp?: string;
  injury_status?: string;
}

export interface FillOption {
  source: 'BENCH' | 'FA';
  player: PlayerCandidate;
  proj: number;
  blocked?: boolean;
  blockReason?: string;
}

export interface EmptySlotFix {
  slot: string;
  best: FillOption | null;
  alternatives: FillOption[];
  potentialDelta: number; // Points gained from filling this slot
  reachableDelta: number; // Points if best option is not blocked
}

interface BestFillParams {
  slot: string;
  bench: PlayerCandidate[];
  faPool: PlayerCandidate[];
  projections: Map<string, Projection>;
  schedule?: GameSchedule;
  nowUtc?: number;
  playedPlayerIds?: Record<string, boolean>;
  actualPoints?: Record<string, number>;
  pickupCapRemaining?: number;
  considerWaivers: boolean;
}

/**
 * Find the best player (bench first, then FA) to fill an empty starting slot.
 * Respects locks, slot eligibility, and pickup caps.
 */
export function bestFillForEmptySlot({
  slot,
  bench,
  faPool,
  projections,
  schedule,
  nowUtc = Date.now(),
  playedPlayerIds = {},
  actualPoints = {},
  pickupCapRemaining = 0,
  considerWaivers
}: BestFillParams): EmptySlotFix {
  
  // Helper to check if a player is locked (use actualPoints for reliable detection)
  const checkLocked = (p: PlayerCandidate): boolean => {
    if (!schedule) return false;
    return isPlayerLocked(
      { player_id: p.player_id, team: p.team },
      schedule,
      nowUtc,
      playedPlayerIds,
      actualPoints
    );
  };

  // 1) Eligible bench candidates
  const benchChoices: FillOption[] = bench
    .filter(p => !checkLocked(p) && canFillSlot(p.pos, slot))
    .map(p => {
      const proj = projections.get(p.player_id);
      const isLocked = checkLocked(p);
      return {
        source: 'BENCH' as const,
        player: p,
        proj: proj?.proj ?? 0,
        blocked: isLocked,
        blockReason: isLocked ? `${p.name} already played. Cannot be started.` : undefined
      };
    });

  // 2) Eligible FA candidates (if allowed and cap remaining)
  const faChoices: FillOption[] = 
    considerWaivers && pickupCapRemaining > 0
      ? faPool
          .filter(p => !checkLocked(p) && canFillSlot(p.pos, slot))
          .map(p => {
            const proj = projections.get(p.player_id);
            const isLocked = checkLocked(p);
            return {
              source: 'FA' as const,
              player: p,
              proj: proj?.proj ?? 0,
              blocked: isLocked,
              blockReason: isLocked ? `${p.name} already played. Cannot be added.` : undefined
            };
          })
      : [];

  // Combine and sort by projection (highest first)
  const allCandidates = [...benchChoices, ...faChoices]
    .filter(c => c.proj > 0) // Only consider players with positive projections
    .sort((a, b) => b.proj - a.proj);

  const best = allCandidates[0] ?? null;
  const alternatives = allCandidates.slice(1, 4); // Show up to 3 alternatives

  // Calculate deltas
  const potentialDelta = best ? best.proj : 0;
  const reachableDelta = (best && !best.blocked) ? best.proj : 0;

  return {
    slot,
    best,
    alternatives,
    potentialDelta,
    reachableDelta
  };
}

/**
 * Find all empty slots in the current starters and suggest fills.
 */
export function findEmptySlotFixes(params: {
  currentStarters: Array<{ slot: string; player_id?: string | null }>;
  bench: PlayerCandidate[];
  faPool: PlayerCandidate[];
  projections: Map<string, Projection>;
  schedule?: GameSchedule;
  nowUtc?: number;
  playedPlayerIds?: Record<string, boolean>;
  actualPoints?: Record<string, number>;
  pickupCapRemaining?: number;
  considerWaivers: boolean;
}): EmptySlotFix[] {
  const { currentStarters, ...rest } = params;
  
  const emptySlots = currentStarters.filter(
    s => !s.player_id || s.player_id === "0" || s.player_id === ""
  );

  return emptySlots.map(s => 
    bestFillForEmptySlot({
      slot: s.slot,
      ...rest
    })
  );
}

/**
 * Check if any starters are empty (for suppressing "optimal" messages).
 */
export function hasEmptyStarters(starters: Array<{ player_id?: string | null }>): boolean {
  return starters.some(s => !s.player_id || s.player_id === "0" || s.player_id === "");
}
