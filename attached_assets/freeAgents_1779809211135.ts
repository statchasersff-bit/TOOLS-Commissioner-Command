import type { Projection } from "./types";
import { normalizePos } from "./projections";
import { isPlayerLocked, type GameSchedule } from "./gameLocking";

/**
 * Players that should never appear in waiver recommendations
 * (non-active offensive players, etc.)
 */
const WAIVER_BLOCKLIST = new Set([
  "Donnie Ernsberger",
  "Mark McNamee",
  // Add other non-active players here as needed
]);

/**
 * Check if a player should be excluded from waiver recommendations
 * Enhanced version that can check Sleeper matchup data for played players
 */
function shouldExcludeFromWaivers(
  playerName: string, 
  playerData: any, 
  schedule?: GameSchedule, 
  playedPlayerIds?: Record<string, boolean>
): boolean {
  // Check against blocklist
  if (WAIVER_BLOCKLIST.has(playerName)) {
    return true;
  }
  
  // Check if player's team has already played, is on bye, or has played in matchup
  if (schedule && isPlayerLocked(playerData, schedule, Date.now(), playedPlayerIds)) {
    return true;
  }
  
  // Additional filters can be added here
  // e.g., exclude retired players, practice squad players, etc.
  
  return false;
}

export function getOwnedPlayerIds(allRosters: any[]): Set<string> {
  const owned = new Set<string>();
  for (const r of allRosters) {
    for (const id of (r.players || [])) if (id) owned.add(id);
    for (const id of (r.reserve || [])) if (id) owned.add(id);
    for (const id of (r.taxi || [])) if (id) owned.add(id);
    for (const id of (r.starters || [])) if (id) owned.add(id);
  }
  return owned;
}

/**
 * From projections + players index, create a lightweight pool of FAs.
 * Only keep players that have a projection and are NOT owned in the league.
 * Filters out players whose teams have already played, are on bye, or have played in matchup.
 * Optionally limit number per position for performance.
 */
export function buildFreeAgentPool(opts: {
  playersIndex: Record<string, any>;
  owned: Set<string>;
  projIdx: Record<string, Projection>;
  schedule?: GameSchedule;
  playedPlayerIds?: Record<string, boolean>;
}) {
  const { playersIndex, owned, projIdx, schedule, playedPlayerIds } = opts;
  const perPosCap = 125; // hard-coded cap for all positions

  const byPos: Record<
    string,
    { player_id: string; name: string; team?: string; pos: string; proj: number; opp?: string }[]
  > = {};

  const push = (p: any, pr: Projection, pid: string, pos: string) => {
    const playerName = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || String(pid);
    
    // Skip players that should be excluded from waiver recommendations
    if (shouldExcludeFromWaivers(playerName, p, schedule, playedPlayerIds)) {
      return;
    }
    
    (byPos[pos] ||= []).push({
      player_id: pid,
      name: playerName,
      team: p.team,
      pos,
      proj: pr.proj,
      opp: (pr as any).opp,
    });
  };

  for (const key in projIdx) {
    if (!/^\d+$/.test(key)) continue; // only numeric sleeper_ids
    const pid = key;
    if (owned.has(pid)) continue;
    const p = playersIndex[pid];
    if (!p) continue;
    const pos = normalizePos(p.position || p.fantasy_positions?.[0] || "");
    if (!pos) continue;
    const pr = projIdx[pid];
    if (!pr) continue;
    push(p, pr, pid, pos);
  }

  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    byPos[pos] = byPos[pos].slice(0, perPosCap);
  }
  return byPos;
}