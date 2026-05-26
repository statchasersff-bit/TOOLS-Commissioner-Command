import type { LeagueSummary } from "./types";
import { interchangeable, canFillSlot, isFlexSlot } from "./slotRules";

export type LineupDiff = {
  ins: { player_id: string; name: string; pos: string; proj: number }[];
  outs: { player_id: string; name: string; pos: string; proj: number }[];
  // Best-effort mapping of which player should move into which slot
  moves: { slot: string; in_pid: string; in_name: string; out_pid?: string; out_name?: string; gain: number; fromIR?: boolean }[];
  delta: number;
  // Enhanced recommendation format for rich UI display
  enrichedMoves?: EnrichedRecommendation[];
};

/**
 * Enhanced recommendation format per user specification.
 * Provides all data needed for rich UI display including displaced player identification,
 * cascade moves, source indicators, and fill-empty detection.
 */
export type EnrichedRecommendation = {
  // Primary action
  title: string; // e.g., "Start Zonovan Knight"
  slot: string; // e.g., "FLEX"
  netDelta: number; // Projected point gain
  inPlayer: { player_id: string; name: string; pos: string; proj: number };
  
  // What's happening to existing lineup
  displaced: { name: string; pos: string } | null; // null if filling empty slot
  isFillingEmpty: boolean; // Quick check for empty slot fills
  
  // Cascade moves (other players shifting slots as a result)
  cascadeMoves: Array<{ player_id: string; name: string; from: string; to: string }>;
  
  // Context indicators
  source: 'FA' | 'BENCH' | 'IR'; // Where the player is coming from
  fromIR?: boolean; // Legacy flag for IR moves
  respectsLocks?: boolean; // Whether this recommendation respects locked players
};

export function buildLineupDiff(lg: LeagueSummary, allEligible?: any[], irList?: string[]): LineupDiff {
  const fixedSlots = lg.roster_positions;

  // CRITICAL: Preserve slot positions with null for empty slots
  // This ensures slot index lookups are accurate (e.g., DEF at index 11 stays at index 11)
  const currentStarters: (string | null)[] = lg.starters.map(pid => 
    (pid && pid !== "0") ? pid : null
  );
  
  // Filtered version for set membership checks only (not index-based lookups)
  const curIds = currentStarters.filter((x): x is string => x !== null);
  const curSet = new Set(curIds);

  // optimal starters (by player_id -> info)
  const optPlayers = lg.optimalSlots.map(s => s.player).filter(Boolean) as any[];
  const optIds = optPlayers.map(p => p.player_id);
  const optSet = new Set(optIds);

  // true ins = in optimal but not in current
  const ins = optPlayers
    .filter(p => !curSet.has(p.player_id))
    .map(p => ({ player_id: p.player_id, name: p.name, pos: p.pos, proj: p.proj ?? 0 }));

  // true outs = in current but not in optimal
  const outs = curIds
    .filter(pid => !optSet.has(pid))
    .map(pid => {
      // try to find name/pos/proj from optimalSlots or allEligible (bench info not carried; set proj 0 if unknown)
      const hit = optPlayers.find(p => p.player_id === pid) || allEligible?.find(p => p.player_id === pid);
      return { player_id: pid, name: hit?.name ?? `player_id ${pid}`, pos: hit?.pos ?? "", proj: hit?.proj ?? 0 };
    });

  // slot-level suggestions without self-swaps:
  // For each slot in optimal, suggest "put <opt player> into <slot>" and, if the current
  // player occupying that slot is NOT the same pid and is NOT used somewhere else in optimal, mark as out.
  const moves: LineupDiff["moves"] = [];
  const usedIn = new Set<string>(); // avoid suggesting the same 'in' twice
  const usedOut = new Set<string>();
  
  // Get current starter objects for player info lookup
  const starterObjs = (lg as any).starterObjs || [];

  lg.optimalSlots.forEach((s, i) => {
    const inP = s.player;
    const slot = s.slot;
    if (!inP) return;

    // Use currentStarters (preserves nulls) for accurate slot-index lookup
    const curPidAtSlot = currentStarters[i]; // what the user currently has in the same slot index
    const same = curPidAtSlot === inP.player_id;

    if (!same && !usedIn.has(inP.player_id)) {
      // if the current player in that slot is part of optimal elsewhere, we shouldn't call it an OUT
      const currentIsOptimalSomewhere = curPidAtSlot && optSet.has(curPidAtSlot);
      
      // FILTER: Only show bench → starter promotions, skip intra-starter reshuffles
      const inPlayerIsCurrentlyStarting = curSet.has(inP.player_id);
      const outPlayerIsCurrentlyStarting = curPidAtSlot && curSet.has(curPidAtSlot);
      
      // Skip if both players are currently starters (this is just a position reshuffle)
      if (inPlayerIsCurrentlyStarting && outPlayerIsCurrentlyStarting) {
        return;
      }
      
      // Look up the player being benched for proper name and projection
      // ALWAYS show who's being benched, even for FA additions
      let outName: string | undefined = undefined;
      let outProj = 0;
      let actualOutPid: string | undefined = undefined;
      
      if (curPidAtSlot) {
        // There's someone in this slot currently - ALWAYS record them
        // This is crucial for accurate "Benches X" display
        const outPlayer = optPlayers.find(p => p.player_id === curPidAtSlot) 
          || allEligible?.find(p => p.player_id === curPidAtSlot)
          || starterObjs.find((p: any) => p.player_id === curPidAtSlot);
        
        // ALWAYS record the actual slot occupant for accurate display
        // Even if they're optimal elsewhere (cascade), we still want to know who WAS here
        outName = outPlayer?.name ?? `player_id ${curPidAtSlot}`;
        outProj = outPlayer?.proj ?? 0;
        actualOutPid = curPidAtSlot;
      }
      
      // Calculate actual gain (difference between incoming and outgoing player)
      const gain = (inP.proj ?? 0) - outProj;
      
      // Check if the incoming player is from IR
      const fromIR = irList ? irList.includes(inP.player_id) : false;
      
      moves.push({
        slot,
        in_pid: inP.player_id,
        in_name: inP.name,
        out_pid: actualOutPid,
        out_name: outName,
        gain,
        fromIR,
      });
      usedIn.add(inP.player_id);
      if (curPidAtSlot && !currentIsOptimalSomewhere) usedOut.add(curPidAtSlot);
    }
  });

  // Generate enriched recommendations with proper pairing to avoid bench player reuse
  const enrichedMoves: EnrichedRecommendation[] = [];
  
  // Identify all players being benched (in current but not optimal)
  // Use starterObjs (defined earlier) for player info since benched players
  // are current starters and might not be in optPlayers or allEligible
  const allBenchedPlayers = curIds
    .filter(pid => !optSet.has(pid))
    .map(pid => {
      // Look up player info in multiple sources:
      // 1. starterObjs - current starter objects (most likely for benched players)
      // 2. optPlayers - players in optimal lineup
      // 3. allEligible - bench/eligible pool
      const player = starterObjs.find((p: any) => p.player_id === pid) 
        || optPlayers.find(p => p.player_id === pid) 
        || allEligible?.find(p => p.player_id === pid);
      return player ? {
        player_id: pid,
        name: player.name,
        pos: player.pos,
        proj: player.proj ?? 0
      } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  
  // Track which bench players have been consumed
  const consumedBenchIds = new Set<string>();
  
  // Detect cascade moves once for all recommendations
  // Use currentStarters (with nulls) to preserve correct slot indexes
  const allCascadeMoves: { player_id: string; name: string; from: string; to: string }[] = [];
  currentStarters.forEach((curPid, idx) => {
    if (curPid && optSet.has(curPid)) {
      const optIdx = optIds.indexOf(curPid);
      if (optIdx !== -1 && optIdx !== idx) {
        const player = optPlayers.find(p => p.player_id === curPid);
        if (player) {
          allCascadeMoves.push({
            player_id: curPid,
            name: player.name,
            from: fixedSlots[idx] || 'unknown',
            to: fixedSlots[optIdx] || 'unknown'
          });
        }
      }
    }
  });
  
  // Get new players (in optimal but not in current)
  // Sort by projection (highest first) to ensure higher-impact recommendations
  // get paired with weaker displaced players first
  const newPlayerIds = optIds.filter(pid => !curSet.has(pid));
  const sortedNewPlayers = newPlayerIds
    .map(pid => {
      const p = optPlayers.find(x => x.player_id === pid);
      return { pid, proj: p?.proj ?? 0 };
    })
    .sort((a, b) => b.proj - a.proj) // Highest projection first
    .map(x => x.pid);
  
  // For each promotion, pair with an available benched player
  for (const inPid of sortedNewPlayers) {
    const inPlayer = optPlayers.find(p => p.player_id === inPid);
    if (!inPlayer) continue;
    
    const slotIdx = optIds.indexOf(inPid);
    const slot = fixedSlots[slotIdx];
    if (!slot) continue;
    
    // CRITICAL: Check if the current slot is actually empty (no player assigned)
    // Use currentStarters (preserves nulls) for accurate slot-index lookup
    const currentSlotPlayerId = currentStarters[slotIdx];
    const slotIsTrulyEmpty = !currentSlotPlayerId;
    
    // Determine primary displaced player
    // PRIORITY 1: If slot is truly empty, no one is displaced
    // PRIORITY 2: Use the actual player from the moves array (slot-level accurate)
    // PRIORITY 3: Fall back to weakest available benched player (for cascade scenarios)
    let displaced: { name: string; pos: string } | null = null;
    let displacedId: string | null = null;
    
    // If slot is truly empty, skip all displacement logic - no one is benched
    if (slotIsTrulyEmpty) {
      // displaced stays null, isFillingEmpty will be true
    } else {
      // CORRECT APPROACH: Only use allBenchedPlayers (players leaving the lineup entirely)
      // These are players in current but NOT in optimal - the true "outs"
      const availableBenched = allBenchedPlayers.filter(p => !consumedBenchIds.has(p.player_id));
      
      if (availableBenched.length > 0) {
        // POSITION-AWARE MATCHING: Prefer benched players with matching position
        // Priority 1: Exact position match (QB replaces QB, RB replaces RB)
        // Priority 2: Slot-compatible position (TE can fill FLEX, etc.)
        // Priority 3: Any available benched player (fallback)
        const inPos = inPlayer.pos?.toUpperCase() || '';
        const slotUpper = slot.toUpperCase();
        
        // Find exact position match first
        let chosenPlayer = availableBenched.find(p => 
          p.pos?.toUpperCase() === inPos
        );
        
        // If no exact match, find slot-compatible position
        if (!chosenPlayer) {
          chosenPlayer = availableBenched.find(p => {
            const pPos = p.pos?.toUpperCase() || '';
            // Check if the benched player could have filled this slot type
            if (slotUpper === 'FLEX') {
              return ['RB', 'WR', 'TE'].includes(pPos);
            } else if (slotUpper === 'SUPER_FLEX' || slotUpper === 'SUPERFLEX') {
              return ['QB', 'RB', 'WR', 'TE'].includes(pPos);
            } else {
              return pPos === slotUpper;
            }
          });
        }
        
        // Fallback: take lowest projection available
        if (!chosenPlayer) {
          const sortedBenched = [...availableBenched].sort((a, b) => a.proj - b.proj);
          chosenPlayer = sortedBenched[0];
        }
        
        if (chosenPlayer) {
          displaced = {
            name: chosenPlayer.name,
            pos: chosenPlayer.pos
          };
          displacedId = chosenPlayer.player_id;
          consumedBenchIds.add(displacedId);
        }
      }
    }
    
    // Determine source
    const isFromIR = irList ? irList.includes(inPid) : false;
    const isFA = allEligible?.find(p => p.player_id === inPid)?.isFA || false;
    const source: 'FA' | 'BENCH' | 'IR' = isFromIR ? 'IR' : (isFA ? 'FA' : 'BENCH');
    
    // Calculate accurate netDelta
    const outProj = displaced && allBenchedPlayers.find(p => p.player_id === displacedId)?.proj || 0;
    const netDelta = (inPlayer.proj ?? 0) - outProj;
    
    enrichedMoves.push({
      title: `Start ${inPlayer.name}`,
      slot,
      netDelta,
      inPlayer: {
        player_id: inPlayer.player_id,
        name: inPlayer.name,
        pos: inPlayer.pos,
        proj: inPlayer.proj ?? 0
      },
      displaced,
      isFillingEmpty: slotIsTrulyEmpty, // Use TRUE empty check, not displaced === null
      cascadeMoves: allCascadeMoves, // Include all cascades in each recommendation
      source,
      fromIR: isFromIR,
      respectsLocks: false
    });
  }

  return { ins, outs, moves, delta: lg.delta, enrichedMoves };
}