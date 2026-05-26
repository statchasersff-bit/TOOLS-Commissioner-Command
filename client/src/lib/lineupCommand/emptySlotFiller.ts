import { isPlayerLocked, type GameSchedule } from './gameLocking';

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
  potentialDelta: number;
  reachableDelta: number;
}

// Minimal canFillSlot — import from slotRules when available
function canFillSlot(pos: string, slot: string): boolean {
  const p = pos.toUpperCase();
  const s = slot.toUpperCase();
  if (p === s) return true;
  if (['FLEX', 'WRT', 'REC_FLEX'].includes(s)) return ['RB', 'WR', 'TE'].includes(p);
  if (['SUPER_FLEX', 'OP'].includes(s)) return ['QB', 'RB', 'WR', 'TE'].includes(p);
  return false;
}

interface BestFillParams {
  slot: string;
  bench: PlayerCandidate[];
  faPool: PlayerCandidate[];
  projections: Map<string, { proj: number }>;
  schedule?: GameSchedule;
  nowUtc?: number;
  playedPlayerIds?: Record<string, boolean>;
  actualPoints?: Record<string, number>;
  pickupCapRemaining?: number;
  considerWaivers: boolean;
}

/**
 * Find the best player (bench first, then FA) to fill an empty starting slot.
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

  const allCandidates = [...benchChoices, ...faChoices]
    .filter(c => c.proj > 0)
    .sort((a, b) => b.proj - a.proj);

  const best = allCandidates[0] ?? null;
  const alternatives = allCandidates.slice(1, 4);

  return {
    slot,
    best,
    alternatives,
    potentialDelta: best ? best.proj : 0,
    reachableDelta: (best && !best.blocked) ? best.proj : 0
  };
}

/**
 * Find all empty slots in the current starters and suggest fills.
 */
export function findEmptySlotFixes(params: {
  currentStarters: Array<{ slot: string; player_id?: string | null }>;
  bench: PlayerCandidate[];
  faPool: PlayerCandidate[];
  projections: Map<string, { proj: number }>;
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
  return emptySlots.map(s => bestFillForEmptySlot({ slot: s.slot, ...rest }));
}

/**
 * Check if any starters are empty.
 */
export function hasEmptyStarters(starters: Array<{ player_id?: string | null }>): boolean {
  return starters.some(s => !s.player_id || s.player_id === "0" || s.player_id === "");
}
