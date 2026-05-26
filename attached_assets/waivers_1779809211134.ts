import { scoreByLeague } from "./scoring";
import type { Projection } from "./types";
import { interchangeable, isFlexSlot } from "./slotRules";
import { buildReachableLineup, type PlayerLite } from "./optimizer";
import type { RosterSlot as OptimizerRosterSlot } from "./optimizer";

export type Slot =
  | "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPER_FLEX" | "K" | "DEF" | "BN";

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export const SLOT_RULES: Record<Position, Slot[]> = {
  QB: ["QB", "SUPER_FLEX"],
  RB: ["RB", "FLEX", "SUPER_FLEX"],
  WR: ["WR", "FLEX", "SUPER_FLEX"],
  TE: ["TE", "FLEX", "SUPER_FLEX"],
  K:  ["K"],
  DEF:["DEF"],
};

export function canFillSlot(pos: string, slot: Slot): boolean {
  return (SLOT_RULES[pos as Position] ?? []).includes(slot);
}

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
  actionPlan?: ActionPlan; // Cascading plan showing full lineup changes
}

// Action plan showing the complete sequence of changes
export interface ActionPlan {
  steps: ActionStep[];
  totalDelta: number;
}

export type ActionStep =
  | { type: "add"; player: string; pos: string; slot: string; blocked?: boolean; blockReason?: string }
  | { type: "move"; player: string; from: string; to: string; blocked?: boolean; blockReason?: string }
  | { type: "bench"; player: string; pos: string; blocked?: boolean; blockReason?: string }

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

// ========== DIFF-BASED WAIVER RECOMMENDATION SYSTEM ==========

export interface RosterSlot {
  playerId: string;
  slot: Slot;
  position: string;
  name: string;
  proj: number;
}

export interface DiffWaiverRecommendation {
  // The FA being added
  added: {
    player_id: string;
    name: string;
    pos: string;
    proj: number;
    slot: Slot;
  };
  // The player(s) actually displaced from the lineup
  removed: {
    player_id: string;
    name: string;
    pos: string;
    proj: number;
    slot: Slot;
  }[];
  // Players that shifted slots
  moved: {
    player_id: string;
    name: string;
    fromSlot: Slot;
    toSlot: Slot;
  }[];
  // Net improvement
  deltaTotal: number;
  // Debug diagnostics
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
export function diffLineups(
  before: RosterSlot[],
  after: RosterSlot[]
): LineupDiff {
  const beforeMap = new Map(before.map(s => [s.playerId, s]));
  const afterMap = new Map(after.map(s => [s.playerId, s]));

  const added: RosterSlot[] = [];
  const removed: RosterSlot[] = [];
  const moved: { player: RosterSlot; fromSlot: Slot; toSlot: Slot }[] = [];

  // Find added players
  for (const slot of after) {
    if (!beforeMap.has(slot.playerId)) {
      added.push(slot);
    }
  }

  // Find removed and moved players
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

// Legacy helpers (kept for backward compatibility)
export const isFlexEligible = (pos: string): boolean =>
  canFillSlot(pos, "FLEX");

export const isSuperFlexEligible = (pos: string): boolean =>
  canFillSlot(pos, "SUPER_FLEX");

export function slotEligible(pos: string, slot: Slot): boolean {
  return canFillSlot(pos, slot);
}

// Build starter floors by slot (worst starter per slot)
// Only calculates floors for slots that exist in the league's roster
export function buildStarterFloors(
  starters: StarterWithSlot[],
  activeSlots: Set<Slot>
): Record<Slot, { player_id: string; proj: number } | null> {
  const floors: Record<Slot, { player_id: string; proj: number } | null> = {
    QB: null,
    RB: null,
    WR: null,
    TE: null,
    K: null,
    DEF: null,
    FLEX: null,
    SUPER_FLEX: null,
    BN: null,
  };

  // Find worst starter for each primary slot
  for (const s of starters) {
    if (s.slot === "BN") continue;
    const cur = floors[s.slot];
    if (!cur || (s.proj ?? 0) < (cur.proj ?? 0)) {
      floors[s.slot] = { player_id: s.player_id, proj: s.proj ?? 0 };
    }
  }

  // Only calculate FLEX floor if league has FLEX position
  if (activeSlots.has("FLEX")) {
    const flexCandidates = starters.filter((s) =>
      slotEligible(s.pos, "FLEX")
    );
    floors.FLEX = flexCandidates.length
      ? flexCandidates.reduce(
          (m, s) =>
            m && m.proj <= (s.proj ?? 0)
              ? m
              : { player_id: s.player_id, proj: s.proj ?? 0 },
          null as any
        )
      : null;
  }

  // Only calculate SUPER_FLEX floor if league has SUPER_FLEX position
  if (activeSlots.has("SUPER_FLEX")) {
    const sfCandidates = starters.filter((s) =>
      slotEligible(s.pos, "SUPER_FLEX")
    );
    floors.SUPER_FLEX = sfCandidates.length
      ? sfCandidates.reduce(
          (m, s) =>
            m && m.proj <= (s.proj ?? 0)
              ? m
              : { player_id: s.player_id, proj: s.proj ?? 0 },
          null as any
        )
      : null;
  }

  return floors;
}

// Blocklist for players that should never appear in waiver suggestions
const WAIVER_BLOCKLIST = new Set([
  "Donnie Ernsberger",
  "Mark McNamee",
]);

// Fetch free agents for a league (not on any roster)
export async function getFreeAgentsForLeague(
  leagueId: string,
  allPlayers: Record<string, any>,
  ownedPlayerIds: Set<string>
): Promise<FreeAgent[]> {
  try {
    // Fetch trending free agents to limit pool size
    const response = await fetch(
      `https://api.sleeper.app/v1/players/nfl/trending/add?limit=300`
    );
    const trending = await response.json();

    // Filter to only unowned players
    const faIds = trending
      .map((t: any) => String(t.player_id))
      .filter((pid: string) => !ownedPlayerIds.has(pid) && allPlayers[pid]);

    // Map to lightweight objects and filter blocklist
    return faIds
      .map((pid: string): FreeAgent | null => {
        const p = allPlayers[pid];
        const name = (p.full_name || p.first_name + " " + p.last_name).trim();
        
        // Skip blocklisted players
        if (WAIVER_BLOCKLIST.has(name)) return null;
        
        return {
          player_id: pid,
          name: name,
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

// Score free agents with league-adjusted projections
export function scoreFreeAgents(
  fas: FreeAgent[],
  leagueScoring: any,
  projMap: Map<string, Projection>
): ScoredFreeAgent[] {
  return fas.map((p) => {
    const row = projMap.get(p.player_id);
    const base = row ? scoreByLeague(row.pos, row.stats || {}, leagueScoring) : 0;
    const isByeOrOut =
      row?.opp === "BYE" || ["O", "IR", "NA"].includes(p.injury_status || "");
    return { ...p, proj: base, isByeOrOut };
  });
}

// Compare FAs to floors and pick top suggestions
// Only checks against slots that exist in the league's roster
export function pickWaiverUpgrades(
  scoredFAs: ScoredFreeAgent[],
  starters: StarterWithSlot[],
  activeSlots: Set<Slot>,
  minGain: number = 1.5,
  maxSuggestions: number = 3
): WaiverSuggestion[] {
  const floors = buildStarterFloors(starters, activeSlots);
  const suggestions: WaiverSuggestion[] = [];

  // Build lookup of current starters by player_id for names/pos
  const byId = new Map(starters.map((s) => [s.player_id, s]));

  for (const fa of scoredFAs) {
    if (!fa || !Number.isFinite(fa.proj)) continue;
    if (fa.isByeOrOut) continue; // Skip BYE/OUT players
    
    // Explicitly exclude kickers from waiver recommendations
    if (fa.pos === "K") continue;

    // Check against each slot the FA can fill (only active slots in this league)
    (["QB", "RB", "WR", "TE", "DEF", "FLEX", "SUPER_FLEX"] as Slot[]).forEach(
      (slot) => {
        // Skip if league doesn't have this slot
        if (!activeSlots.has(slot)) return;
        
        // Check 1: Can the FA legally fill this slot?
        if (!canFillSlot(fa.pos, slot)) return;
        
        const floor = floors[slot];
        if (!floor) return;
        
        const outS = byId.get(floor.player_id);
        const outPos = outS?.pos ?? "";
        
        // Check 2: Can the player being replaced be swapped with the FA?
        // They must be interchangeable (compete for the same slot types)
        // This prevents illegal cross-position swaps like "Replace K with RB"
        if (outPos && !interchangeable(fa.pos, outPos)) return;
        
        const delta = fa.proj - floor.proj;
        if (delta >= minGain) {
          suggestions.push({
            slot,
            inP: {
              player_id: fa.player_id,
              name: fa.name,
              pos: fa.pos,
              proj: fa.proj,
            },
            outP: {
              player_id: floor.player_id,
              name: outS?.name ?? "(starter)",
              pos: outPos,
              proj: floor.proj,
            },
            delta,
          });
        }
      }
    );
  }

  // Deduplicate by FA & slot, keep the highest delta
  const key = (s: WaiverSuggestion) => `${s.slot}:${s.inP.player_id}`;
  const best = new Map<string, WaiverSuggestion>();
  for (const s of suggestions) {
    const k = key(s);
    if (!best.has(k) || best.get(k)!.delta < s.delta) best.set(k, s);
  }

  // Group by position and return top N per position
  const byPosition = new Map<string, WaiverSuggestion[]>();
  for (const s of Array.from(best.values())) {
    const pos = s.inP.pos;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(s);
  }

  // Sort each position group by delta and take top maxSuggestions per position
  const result: WaiverSuggestion[] = [];
  for (const [pos, suggestions] of Array.from(byPosition.entries())) {
    const topN = suggestions
      .sort((a: WaiverSuggestion, b: WaiverSuggestion) => b.delta - a.delta)
      .slice(0, maxSuggestions);
    result.push(...topN);
  }

  // Return all results sorted by delta
  return result.sort((a: WaiverSuggestion, b: WaiverSuggestion) => b.delta - a.delta);
}

// Compute cascading lineup diff between two complete lineups
// Shows: Add FA → Move players → Bench displaced player
// Marks steps as blocked if they involve locked players
export function computeLineupDiff(
  currentStarters: StarterWithSlot[],
  newStarters: StarterWithSlot[],
  faPlayerId: string,
  lockedPlayerIds?: Set<string>
): ActionPlan {
  const byIdCur = new Map(currentStarters.map((s) => [s.player_id, s]));
  const byIdNew = new Map(newStarters.map((s) => [s.player_id, s]));
  const locked = lockedPlayerIds || new Set<string>();

  const adds: ActionStep[] = [];
  const moves: ActionStep[] = [];
  const benches: ActionStep[] = [];

  // Find players newly starting
  for (const s of newStarters) {
    const prev = byIdCur.get(s.player_id);
    if (!prev) {
      // New starter (FA or from bench)
      const isLocked = locked.has(s.player_id);
      adds.push({
        type: "add",
        player: s.name,
        pos: s.pos,
        slot: s.slot,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played. Cannot be started.` : undefined,
      });
    } else if (prev.slot !== s.slot) {
      // Player moved to different slot
      const isLocked = locked.has(s.player_id);
      moves.push({
        type: "move",
        player: s.name,
        from: prev.slot,
        to: s.slot,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played. Cannot be moved.` : undefined,
      });
    }
  }

  // Find players pushed to bench
  for (const s of currentStarters) {
    if (!byIdNew.has(s.player_id)) {
      const isLocked = locked.has(s.player_id);
      benches.push({
        type: "bench",
        player: s.name,
        pos: s.pos,
        blocked: isLocked,
        blockReason: isLocked ? `${s.name} already played. Cannot be benched.` : undefined,
      });
    }
  }

  // Calculate total delta
  const currentTotal = currentStarters.reduce((sum, s) => sum + (s.proj || 0), 0);
  const newTotal = newStarters.reduce((sum, s) => sum + (s.proj || 0), 0);
  const totalDelta = newTotal - currentTotal;

  // Calculate reachable delta (excluding blocked steps)
  const hasBlockedSteps = [...adds, ...moves, ...benches].some(step => step.blocked);
  const reachableDelta = hasBlockedSteps ? 0 : totalDelta; // If any step is blocked, the whole plan is blocked

  // Order: Add → Move → Bench
  const steps: ActionStep[] = [...adds, ...moves, ...benches];

  return { steps, totalDelta: reachableDelta };
}

// Group waiver suggestions by player to avoid showing the same FA multiple times
// Returns one entry per player with the best delta and all alternatives listed
export function groupWaiverSuggestions(
  suggestions: WaiverSuggestion[],
  maxPlayers: number = 8
): GroupedWaiverSuggestion[] {
  // Group all suggestions by incoming player_id
  const byPlayer = new Map<string, WaiverSuggestion[]>();
  
  for (const s of suggestions) {
    const pid = s.inP.player_id;
    if (!byPlayer.has(pid)) {
      byPlayer.set(pid, []);
    }
    byPlayer.get(pid)!.push(s);
  }
  
  // For each player, create a grouped suggestion
  const grouped: GroupedWaiverSuggestion[] = [];
  
  for (const [playerId, playerSuggestions] of Array.from(byPlayer.entries())) {
    // Sort by delta to find best
    const sorted = playerSuggestions.sort((a: WaiverSuggestion, b: WaiverSuggestion) => b.delta - a.delta);
    const best = sorted[0];
    
    // Create alternatives list (all unique out players, sorted by delta)
    const uniqueOuts = new Map<string, { outP: typeof best.outP; slot: Slot; delta: number }>();
    
    for (const s of sorted) {
      const outId = s.outP.player_id;
      if (!uniqueOuts.has(outId) || uniqueOuts.get(outId)!.delta < s.delta) {
        uniqueOuts.set(outId, {
          outP: s.outP,
          slot: s.slot,
          delta: s.delta,
        });
      }
    }
    
    const alternatives = Array.from(uniqueOuts.values())
      .sort((a, b) => b.delta - a.delta);
    
    grouped.push({
      player_id: playerId,
      name: best.inP.name,
      pos: best.inP.pos,
      proj: best.inP.proj,
      bestDelta: best.delta,
      alternatives,
    });
  }
  
  // Sort by best delta and limit
  return grouped
    .sort((a, b) => b.bestDelta - a.bestDelta)
    .slice(0, maxPlayers);
}

// ========== DIFF-BASED WAIVER RECOMMENDATION GENERATOR ==========

export interface DiffWaiverInput {
  benchOptimal: OptimizerRosterSlot[]; // Roster-only optimal lineup
  benchTotal: number; // Total points for benchOptimal
  rosterPool: (PlayerLite & { proj?: number; locked?: boolean })[]; // Current roster players
  freeAgents: ScoredFreeAgent[]; // Available FAs, already scored
  projectionMap: Map<string, number>; // player_id → projection
  playerNames: Map<string, string>; // player_id → name
  playerPositions: Map<string, string>; // player_id → position
  slotsMap: Record<string, number>; // League roster slots
  season: string;
  week: string;
  currentStarters: (string | null)[]; // For lock detection
  lockCheck?: (playerId: string) => boolean; // Optional lock checker
  enableDebug?: boolean; // Enable debug diagnostics
  threshold?: number; // Minimum delta to show (default 1.5)
  maxFAs?: number; // Max FAs to evaluate (default 10)
}

/**
 * Generate diff-based waiver recommendations by:
 * 1. For each top FA, optimize with that FA added
 * 2. Diff benchOptimal vs waiverOptimal lineups
 * 3. Identify true displaced player(s)
 * 4. Filter by threshold, locks, and eligibility
 * 5. Return structured recommendations with debug info
 */
export function generateDiffBasedWaiverRecs(
  input: DiffWaiverInput
): DiffWaiverRecommendation[] {
  const {
    benchOptimal,
    benchTotal,
    rosterPool,
    freeAgents,
    projectionMap,
    playerNames,
    playerPositions,
    slotsMap,
    season,
    week,
    currentStarters,
    lockCheck = () => false,
    enableDebug = false,
    threshold = 1.5,
    maxFAs = 10,
  } = input;

  const recommendations: DiffWaiverRecommendation[] = [];

  // Convert benchOptimal to RosterSlot format for diffing
  const benchSlots: RosterSlot[] = benchOptimal.map(s => ({
    playerId: s.playerId,
    slot: s.slot as Slot,
    position: playerPositions.get(s.playerId) || "",
    name: playerNames.get(s.playerId) || s.playerId,
    proj: s.points || projectionMap.get(s.playerId) || 0,
  }));

  // Limit FA evaluation to top N by projection
  const topFAs = freeAgents
    .filter(fa => !lockCheck(fa.player_id)) // Skip locked FAs
    .sort((a, b) => (b.proj || 0) - (a.proj || 0))
    .slice(0, maxFAs);

  for (const fa of topFAs) {
    try {
      // Augment roster pool with this FA
      const augmentedPool: (PlayerLite & { proj?: number; locked?: boolean })[] = [
        ...rosterPool,
        {
          player_id: fa.player_id,
          position: fa.pos,
          proj: fa.proj,
          locked: false,
        },
      ];

      // Optimize with FA added
      const waiverLineup = buildReachableLineup(
        slotsMap,
        augmentedPool,
        season,
        week,
        currentStarters
      );

      // Calculate waiver total
      const waiverTotal = waiverLineup.reduce((sum, s) => sum + (s.points || 0), 0);

      // Calculate delta
      const deltaTotal = waiverTotal - benchTotal;

      // Filter: below threshold
      if (!Number.isFinite(deltaTotal) || deltaTotal < threshold) {
        continue;
      }

      // Convert to RosterSlot format for diffing
      const waiverSlots: RosterSlot[] = waiverLineup.map(s => ({
        playerId: s.playerId,
        slot: s.slot as Slot,
        position: playerPositions.get(s.playerId) || "",
        name: playerNames.get(s.playerId) || s.playerId,
        proj: s.points || projectionMap.get(s.playerId) || 0,
      }));

      // Diff the lineups
      const diff = diffLineups(benchSlots, waiverSlots);

      // The added player should be the FA
      const addedSlot = diff.added.find(s => s.playerId === fa.player_id);
      if (!addedSlot) {
        // FA wasn't added to lineup, skip
        if (enableDebug) {
          console.warn(`[DiffWaiver] FA ${fa.name} not in optimal lineup, skipping`);
        }
        continue;
      }

      // Filter: check if any removed player is locked
      const removedLocked = diff.removed.map(r => lockCheck(r.playerId));
      if (removedLocked.some(locked => locked)) {
        if (enableDebug) {
          console.warn(`[DiffWaiver] FA ${fa.name} would displace locked player, skipping`);
        }
        continue;
      }

      // Filter: if any displaced player has higher proj and isn't O/BYE, skip this rec
      let shouldSkip = false;
      for (const removed of diff.removed) {
        const removedProj = projectionMap.get(removed.playerId) || 0;
        const removedPos = playerPositions.get(removed.playerId) || "";
        
        // Find if removed player is O/BYE (check roster pool)
        const removedPlayer = rosterPool.find(p => p.player_id === removed.playerId);
        const removedStatus = (removedPlayer as any)?.injury_status || "";
        const isOutOrBye = removedStatus === "Out" || removedStatus === "BYE";

        if (removedProj >= fa.proj && !isOutOrBye) {
          if (enableDebug) {
            console.warn(`[DiffWaiver] FA ${fa.name} (${fa.proj}) would displace ${removed.name} (${removedProj}), skipping`);
          }
          shouldSkip = true;
          break;
        }
      }
      
      if (shouldSkip) {
        continue;
      }

      // Build recommendation
      const rec: DiffWaiverRecommendation = {
        added: {
          player_id: fa.player_id,
          name: fa.name,
          pos: fa.pos,
          proj: fa.proj,
          slot: addedSlot.slot,
        },
        removed: diff.removed.map(r => ({
          player_id: r.playerId,
          name: r.name,
          pos: r.position,
          proj: r.proj,
          slot: r.slot,
        })),
        moved: diff.moved.map(m => ({
          player_id: m.player.playerId,
          name: m.player.name,
          fromSlot: m.fromSlot,
          toSlot: m.toSlot,
        })),
        deltaTotal,
      };

      // Add debug info if enabled
      if (enableDebug) {
        rec.debug = {
          benchTotal,
          waiverTotal,
          addedLocked: lockCheck(fa.player_id),
          removedLocked,
          removedStatuses: diff.removed.map(r => {
            const p = rosterPool.find(rp => rp.player_id === r.playerId);
            return (p as any)?.injury_status || "NA";
          }),
        };

        console.log(`[DiffWaiver] ${fa.name} → ${addedSlot.slot} (+${deltaTotal.toFixed(1)})`, {
          removed: diff.removed.map(r => `${r.name} (${r.proj.toFixed(1)})`).join(", "),
          moved: diff.moved.map(m => `${m.player.name}: ${m.fromSlot}→${m.toSlot}`).join(", "),
          debug: rec.debug,
        });
      }

      recommendations.push(rec);
    } catch (err) {
      if (enableDebug) {
        console.error(`[DiffWaiver] Error processing FA ${fa.name}:`, err);
      }
      // Continue to next FA
      continue;
    }
  }

  // Sort by deltaTotal desc
  return recommendations.sort((a, b) => b.deltaTotal - a.deltaTotal);
}
