import { canFillSlot, isFlexSlot, interchangeable, type Slot } from './slotRules';

export type { Slot };

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface WaiverSuggestion {
  slot: Slot;
  inP: { player_id: string; name: string; pos: string; proj: number };
  outP: { player_id: string; name: string; pos: string; proj: number };
  delta: number;
}

export interface GroupedWaiverSuggestion {
  player_id: string;
  name: string;
  pos: string;
  proj: number;
  bestDelta: number;
  alternatives: {
    outP: { player_id: string; name: string; pos: string; proj: number };
    slot: Slot;
    delta: number;
  }[];
  actionPlan?: ActionPlan;
}

export interface ActionPlan {
  steps: ActionStep[];
  totalDelta: number;
}

export type ActionStep =
  | { type: "add"; player: string; pos: string; slot: string; blocked?: boolean; blockReason?: string }
  | { type: "move"; player: string; from: string; to: string; blocked?: boolean; blockReason?: string }
  | { type: "bench"; player: string; pos: string; blocked?: boolean; blockReason?: string };

export interface StarterWithSlot {
  player_id: string;
  name: string;
  pos: string;
  slot: Slot;
  proj: number;
}

export interface FreeAgent {
  player_id: string;
  name: string;
  pos: string;
  team: string;
  injury_status?: string;
}

export interface ScoredFreeAgent extends FreeAgent {
  proj: number;
  isByeOrOut: boolean;
}

export interface RosterSlot {
  playerId: string;
  slot: Slot;
  position: string;
  name: string;
  proj: number;
}

export interface DiffWaiverRecommendation {
  added: {
    player_id: string;
    name: string;
    pos: string;
    proj: number;
    slot: Slot;
  };
  removed: {
    player_id: string;
    name: string;
    pos: string;
    proj: number;
    slot: Slot;
  }[];
  moved: {
    player_id: string;
    name: string;
    fromSlot: Slot;
    toSlot: Slot;
  }[];
  deltaTotal: number;
  debug?: {
    benchTotal: number;
    waiverTotal: number;
    addedLocked: boolean;
    removedLocked: boolean[];
    removedStatuses: string[];
  };
}

export interface LineupDiff {
  added: RosterSlot[];
  removed: RosterSlot[];
  moved: { player: RosterSlot; fromSlot: Slot; toSlot: Slot }[];
}

/**
 * Diff two lineups to find what changed
 */
export function diffLineups(before: RosterSlot[], after: RosterSlot[]): LineupDiff {
  const beforeMap = new Map(before.map(s => [s.playerId, s]));
  const afterMap = new Map(after.map(s => [s.playerId, s]));

  const added: RosterSlot[] = [];
  const removed: RosterSlot[] = [];
  const moved: { player: RosterSlot; fromSlot: Slot; toSlot: Slot }[] = [];

  for (const slot of after) {
    if (!beforeMap.has(slot.playerId)) added.push(slot);
  }

  for (const slot of before) {
    const afterSlot = afterMap.get(slot.playerId);
    if (!afterSlot) {
      removed.push(slot);
    } else if (afterSlot.slot !== slot.slot) {
      moved.push({ player: afterSlot, fromSlot: slot.slot, toSlot: afterSlot.slot });
    }
  }

  return { added, removed, moved };
}

export const isFlexEligible = (pos: string): boolean => canFillSlot(pos, "FLEX");
export const isSuperFlexEligible = (pos: string): boolean => canFillSlot(pos, "SUPER_FLEX");
export function slotEligible(pos: string, slot: Slot): boolean { return canFillSlot(pos, slot); }

export function buildStarterFloors(
  starters: StarterWithSlot[],
  activeSlots: Set<Slot>
): Record<Slot, { player_id: string; proj: number } | null> {
  const floors: Record<Slot, { player_id: string; proj: number } | null> = {
    QB: null, RB: null, WR: null, TE: null, K: null, DEF: null,
    FLEX: null, SUPER_FLEX: null, REC_FLEX: null, WRRB_FLEX: null,
    IDP_FLEX: null, DL: null, LB: null, DB: null, BN: null,
  };

  for (const s of starters) {
    if (s.slot === "BN") continue;
    const cur = floors[s.slot];
    if (!cur || (s.proj ?? 0) < (cur.proj ?? 0)) {
      floors[s.slot] = { player_id: s.player_id, proj: s.proj ?? 0 };
    }
  }

  if (activeSlots.has("FLEX")) {
    const flexCandidates = starters.filter(s => slotEligible(s.pos, "FLEX"));
    floors.FLEX = flexCandidates.length
      ? flexCandidates.reduce((m, s) =>
          m && m.proj <= (s.proj ?? 0) ? m : { player_id: s.player_id, proj: s.proj ?? 0 },
          null as any)
      : null;
  }

  if (activeSlots.has("SUPER_FLEX")) {
    const sfCandidates = starters.filter(s => slotEligible(s.pos, "SUPER_FLEX"));
    floors.SUPER_FLEX = sfCandidates.length
      ? sfCandidates.reduce((m, s) =>
          m && m.proj <= (s.proj ?? 0) ? m : { player_id: s.player_id, proj: s.proj ?? 0 },
          null as any)
      : null;
  }

  return floors;
}

const WAIVER_BLOCKLIST = new Set(["Donnie Ernsberger", "Mark McNamee"]);

export async function getFreeAgentsForLeague(
  leagueId: string,
  allPlayers: Record<string, any>,
  ownedPlayerIds: Set<string>
): Promise<FreeAgent[]> {
  try {
    const response = await fetch(`https://api.sleeper.app/v1/players/nfl/trending/add?limit=300`);
    const trending = await response.json();

    const faIds = trending
      .map((t: any) => String(t.player_id))
      .filter((pid: string) => !ownedPlayerIds.has(pid) && allPlayers[pid]);

    return faIds
      .map((pid: string): FreeAgent | null => {
        const p = allPlayers[pid];
        const name = (p.full_name || p.first_name + " " + p.last_name).trim();
        if (WAIVER_BLOCKLIST.has(name)) return null;
        return {
          player_id: pid,
          name,
          pos: p.position || p.fantasy_positions?.[0] || "UNKNOWN",
          team: p.team || "",
          injury_status: p.injury_status,
        };
      })
      .filter((fa: FreeAgent | null): fa is FreeAgent => fa !== null);
  } catch (err) {
    console.error(`[Waivers] Error fetching free agents for league ${leagueId}:`, err);
    return [];
  }
}

export function scoreFreeAgents(
  fas: FreeAgent[],
  leagueScoring: any,
  projMap: Map<string, any>
): ScoredFreeAgent[] {
  return fas.map(p => {
    const row = projMap.get(p.player_id);
    const base = row?.proj ?? 0;
    const isByeOrOut = row?.opp === "BYE" || ["O", "IR", "NA"].includes(p.injury_status || "");
    return { ...p, proj: base, isByeOrOut };
  });
}

export function pickWaiverUpgrades(
  scoredFAs: ScoredFreeAgent[],
  starters: StarterWithSlot[],
  activeSlots: Set<Slot>,
  minGain: number = 1.5,
  maxSuggestions: number = 3
): WaiverSuggestion[] {
  const floors = buildStarterFloors(starters, activeSlots);
  const suggestions: WaiverSuggestion[] = [];
  const byId = new Map(starters.map(s => [s.player_id, s]));

  for (const fa of scoredFAs) {
    if (!fa || !Number.isFinite(fa.proj)) continue;
    if (fa.isByeOrOut) continue;
    if (fa.pos === "K") continue;

    (["QB", "RB", "WR", "TE", "DEF", "FLEX", "SUPER_FLEX"] as Slot[]).forEach(slot => {
      if (!activeSlots.has(slot)) return;
      if (!canFillSlot(fa.pos, slot)) return;

      const floor = floors[slot];
      if (!floor) return;

      const outS = byId.get(floor.player_id);
      const outPos = outS?.pos ?? "";
      if (outPos && !interchangeable(fa.pos, outPos)) return;

      const delta = fa.proj - floor.proj;
      if (delta >= minGain) {
        suggestions.push({
          slot,
          inP: { player_id: fa.player_id, name: fa.name, pos: fa.pos, proj: fa.proj },
          outP: { player_id: floor.player_id, name: outS?.name ?? "(starter)", pos: outPos, proj: floor.proj },
          delta,
        });
      }
    });
  }

  const key = (s: WaiverSuggestion) => `${s.slot}:${s.inP.player_id}`;
  const best = new Map<string, WaiverSuggestion>();
  for (const s of suggestions) {
    const k = key(s);
    if (!best.has(k) || best.get(k)!.delta < s.delta) best.set(k, s);
  }

  const byPosition = new Map<string, WaiverSuggestion[]>();
  for (const s of Array.from(best.values())) {
    const pos = s.inP.pos;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(s);
  }

  const result: WaiverSuggestion[] = [];
  for (const [, posGroup] of Array.from(byPosition.entries())) {
    result.push(...posGroup.sort((a, b) => b.delta - a.delta).slice(0, maxSuggestions));
  }
  return result.sort((a, b) => b.delta - a.delta);
}

export function computeLineupDiff(
  currentStarters: StarterWithSlot[],
  newStarters: StarterWithSlot[],
  faPlayerId: string,
  lockedPlayerIds?: Set<string>
): ActionPlan {
  const byIdCur = new Map(currentStarters.map(s => [s.player_id, s]));
  const byIdNew = new Map(newStarters.map(s => [s.player_id, s]));
  const locked = lockedPlayerIds || new Set<string>();

  const adds: ActionStep[] = [];
  const moves: ActionStep[] = [];
  const benches: ActionStep[] = [];

  for (const s of newStarters) {
    const prev = byIdCur.get(s.player_id);
    if (!prev) {
      const isLocked = locked.has(s.player_id);
      adds.push({
        type: "add", player: s.name, pos: s.pos, slot: s.slot,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played. Cannot be started.` : undefined,
      });
    } else if (prev.slot !== s.slot) {
      const isLocked = locked.has(s.player_id);
      moves.push({
        type: "move", player: s.name, from: prev.slot, to: s.slot,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played. Cannot be moved.` : undefined,
      });
    }
  }

  for (const s of currentStarters) {
    if (!byIdNew.has(s.player_id)) {
      const isLocked = locked.has(s.player_id);
      benches.push({
        type: "bench", player: s.name, pos: s.pos,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played.` : undefined,
      });
    }
  }

  const steps: ActionStep[] = [...adds, ...moves, ...benches];

  const beforeTotal = currentStarters.reduce((sum, s) => sum + (s.proj ?? 0), 0);
  const afterTotal = newStarters.reduce((sum, s) => sum + (s.proj ?? 0), 0);
  const totalDelta = afterTotal - beforeTotal;

  return { steps, totalDelta };
}
