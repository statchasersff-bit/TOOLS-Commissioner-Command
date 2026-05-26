import type { PlayerLite, RosterSlot } from './types';
import { normalizePos } from './projections';
import { canFillSlot, isFlexSlot } from './slotRules';

export type { PlayerLite, RosterSlot };

export function buildSlotCounts(roster_positions: string[]) {
  const counts: Record<string, number> = {};
  for (const slot of roster_positions) {
    const s = slot.toUpperCase();
    if (s === "BN" || s === "IR" || s === "TAXI") continue;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

export function toPlayerLite(playersIndex: Record<string, any>, player_id: string): PlayerLite | null {
  const p = playersIndex[player_id];
  if (!p) return null;
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || p.last_name || String(player_id);
  const pos = normalizePos(p.position || p.fantasy_positions?.[0] || "");
  return {
    player_id,
    name,
    team: p.team,
    pos,
    multiPos: (p.fantasy_positions || []).map((x: string) => normalizePos(x)),
    injury_status: p.injury_status,
  };
}

export function statusFlags(p?: PlayerLite & { proj?: number; opp?: string; locked?: boolean }) {
  const flags: string[] = [];
  if (!p) return flags;
  const s = (p.injury_status || "").toUpperCase();
  if (s === "O" || s === "IR" || s === "NA" || s === "SUS" || s === "SSPD" || s.includes("OUT")) flags.push("OUT");
  if (s.includes("DOU")) flags.push("DOUB");
  if (s.includes("QUE") || s === "Q" || s === "D") flags.push("Q");
  if ((p.opp || "").toUpperCase() === "BYE") flags.push("BYE");
  if (p.locked) flags.push("LOCKED");
  return flags;
}

function byProjDesc(a: any, b: any) { return (b.proj ?? 0) - (a.proj ?? 0); }

export interface OptimizationResult {
  lineup: RosterSlot[];
  total: number;
  reachableTotal?: number;
  fullTotal?: number;
  hasLockedPlayers?: boolean;
}

export function optimizeLineup(
  slotsMap: Record<string, number>,
  players: (PlayerLite & { proj?: number; opp?: string; locked?: boolean })[],
  season?: string,
  week?: string,
  currentStarters?: (string | null)[],
  respectLocks: boolean = true
): RosterSlot[] {
  const slotList: string[] = [];
  Object.entries(slotsMap).forEach(([slot, n]) => { for (let i = 0; i < n; i++) slotList.push(slot); });

  const filled: RosterSlot[] = slotList.map(s => ({ slot: s }));
  const used = new Set<string>();

  // Step 1: Freeze locked starters in their exact current slots
  if (respectLocks && currentStarters && season && week) {
    for (let i = 0; i < Math.min(currentStarters.length, filled.length); i++) {
      const starterId = currentStarters[i];
      if (!starterId || starterId === "0" || starterId === "") continue;
      const player = players.find(p => p.player_id === starterId);
      if (player && player.locked) {
        filled[i].player = player;
        used.add(player.player_id);
      }
    }
  }

  // Step 2: Build movable player pool
  const availablePlayers = respectLocks
    ? players.filter(p => !p.locked || used.has(p.player_id))
    : players;
  const sorted = [...availablePlayers].sort(byProjDesc);

  // Fill fixed positions first
  for (let i = 0; i < filled.length; i++) {
    if (filled[i].player) continue;
    const slot = filled[i].slot;
    if (isFlexSlot(slot)) continue;
    const idx = sorted.findIndex(p => !used.has(p.player_id) && canFillSlot(p.pos, slot));
    if (idx !== -1) { filled[i].player = sorted[idx]; used.add(sorted[idx].player_id); }
  }

  // Then flex slots
  for (let i = 0; i < filled.length; i++) {
    if (filled[i].player) continue;
    const slot = filled[i].slot;
    if (!isFlexSlot(slot)) continue;
    const idx = sorted.findIndex(p => !used.has(p.player_id) && canFillSlot(p.pos, slot));
    if (idx !== -1) { filled[i].player = sorted[idx]; used.add(sorted[idx].player_id); }
  }

  return filled;
}

export function optimizeLineupWithLockComparison(
  slotsMap: Record<string, number>,
  players: (PlayerLite & { proj?: number; opp?: string; locked?: boolean })[],
  season?: string,
  week?: string,
  currentStarters?: (string | null)[]
): OptimizationResult {
  const hasLockedPlayers = players.some(p => p.locked);
  const reachableLineup = optimizeLineup(slotsMap, players, season, week, currentStarters, true);
  const reachableTotal = sumProj(reachableLineup);
  let fullTotal = reachableTotal;

  if (hasLockedPlayers) {
    const fullLineup = optimizeLineup(slotsMap, players, season, week, currentStarters, false);
    fullTotal = sumProj(fullLineup);
  }

  return { lineup: reachableLineup, total: reachableTotal, reachableTotal, fullTotal, hasLockedPlayers };
}

export function sumProj(slots: RosterSlot[]) {
  return slots.reduce((acc, s) => acc + (s.player?.proj ?? 0), 0);
}

export function filterLockedRecommendations<T extends { in: { player_id: string }; out: { player_id: string } }>(
  recommendations: T[],
  lockedPlayerIds: Set<string>
): {
  allowed: T[];
  blocked: Array<T & { blockReason: string }>;
} {
  const allowed: T[] = [];
  const blocked: Array<T & { blockReason: string }> = [];

  for (const rec of recommendations) {
    const outIsLocked = lockedPlayerIds.has(rec.out.player_id);
    const inIsLocked = lockedPlayerIds.has(rec.in.player_id);

    if (outIsLocked) {
      blocked.push({ ...rec, blockReason: `${rec.out.player_id} has already played. Cannot be moved or benched.` });
    } else if (inIsLocked) {
      blocked.push({ ...rec, blockReason: `${rec.in.player_id} has already played. Cannot be started.` });
    } else {
      allowed.push(rec);
    }
  }

  return { allowed, blocked };
}

export function computeAchievableDelta<T extends { delta: number; in: { player_id: string }; out: { player_id: string } }>(
  reachableOptimalTotal: number,
  currentTotal: number,
  recommendations: T[],
  lockedPlayerIds: Set<string>
): {
  achievableDelta: number;
  blockedDelta: number;
  allowedRecommendations: T[];
  blockedRecommendations: Array<T & { blockReason: string }>;
} {
  const { allowed, blocked } = filterLockedRecommendations(recommendations, lockedPlayerIds);
  const blockedDelta = blocked.reduce((sum, rec) => sum + rec.delta, 0);
  const benchDelta = reachableOptimalTotal - currentTotal;
  const achievableDelta = Math.max(0, benchDelta - blockedDelta);

  return { achievableDelta, blockedDelta, allowedRecommendations: allowed, blockedRecommendations: blocked };
}

export function buildBenchRecommendations(
  currentSlots: RosterSlot[],
  optimalSlots: RosterSlot[],
  validStarters: string[],
  allEligible: (PlayerLite & { proj?: number; locked?: boolean })[],
  irList: string[] = []
): {
  recommendations: Array<{ out: any; in: any; slot: string; delta: number; fromIR?: boolean }>;
  filteredRecommendations: Array<{ out: any; in: any; slot: string; delta: number; fromIR?: boolean }>;
  blockedRecommendations: Array<{ out: any; in: any; slot: string; delta: number; fromIR?: boolean; blockReason: string }>;
  blockedDelta: number;
  lockedPlayerIds: Set<string>;
} {
  const recommendations: Array<{ out: any; in: any; slot: string; delta: number; fromIR?: boolean }> = [];
  const irPlayerIds = new Set(irList);

  const currStarterIds = new Set(validStarters);
  const optStarterIds = new Set(optimalSlots.map(s => s.player?.player_id).filter(Boolean));

  const promotions = optimalSlots
    .filter(s => s.player && !currStarterIds.has(s.player.player_id))
    .map(s => ({ ...s.player, slot: s.slot }));

  const demotions = currentSlots
    .filter(s => s.player && !optStarterIds.has(s.player.player_id))
    .map(s => ({ ...s.player, slot: s.slot }));

  const demotedPool = [...demotions];
  for (const inPlayer of promotions) {
    let bestIdx = -1;
    let bestGain = -Infinity;
    let bestOut: any = null;

    for (let i = 0; i < demotedPool.length; i++) {
      const outPlayer = demotedPool[i];
      const isCompatible = canFillSlot(inPlayer.pos || '', outPlayer.slot || '');
      if (inPlayer.player_id !== outPlayer.player_id && isCompatible) {
        const gain = (inPlayer.proj ?? 0) - (outPlayer.proj ?? 0);
        if (gain > bestGain) { bestGain = gain; bestIdx = i; bestOut = outPlayer; }
      }
    }

    if (bestOut && bestIdx >= 0) {
      recommendations.push({
        out: bestOut,
        in: inPlayer,
        slot: inPlayer.slot,
        delta: bestGain,
        fromIR: inPlayer.player_id ? irPlayerIds.has(inPlayer.player_id) : false
      });
      demotedPool.splice(bestIdx, 1);
    }
  }

  const lockedPlayerIds = new Set<string>();
  allEligible.forEach(p => { if (p.locked) lockedPlayerIds.add(p.player_id); });

  const { allowed: filteredRecommendations, blocked: blockedRecommendations } =
    filterLockedRecommendations(recommendations, lockedPlayerIds);

  const blockedDelta = blockedRecommendations.reduce((sum, rec) => sum + rec.delta, 0);

  return { recommendations, filteredRecommendations, blockedRecommendations, blockedDelta, lockedPlayerIds };
}

/**
 * Lock-aware wrapper for building reachable lineup.
 */
export function buildReachableLineup(
  slotsMap: Record<string, number>,
  players: (PlayerLite & { proj?: number; opp?: string; locked?: boolean })[],
  season: string,
  week: string,
  currentStarters: (string | null)[]
): RosterSlot[] {
  return optimizeLineup(slotsMap, players, season, week, currentStarters, true);
}
