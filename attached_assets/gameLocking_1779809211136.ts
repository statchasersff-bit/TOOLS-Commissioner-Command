// Game locking logic to prevent lineup changes for teams that have already played

export type GameSchedule = Record<string, { start: number; state: 'pre' | 'in' | 'post' }>;

/**
 * Fetch week schedule from the backend API
 */
export async function getWeekSchedule(season: string, week: string): Promise<GameSchedule> {
  try {
    const response = await fetch(`/api/schedule?season=${season}&week=${week}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch schedule: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch week schedule:', error);
    return {};
  }
}

/**
 * Check if a team's game has started or finished
 */
export function hasGameStarted(team: string | undefined, schedule: GameSchedule, now: number = Date.now()): boolean {
  if (!team) return false;
  
  const teamData = schedule[team.toUpperCase()];
  if (!teamData) return false;
  
  // Game has started if it's not in 'pre' state or if current time is past kickoff
  return teamData.state !== 'pre' || now >= teamData.start;
}

/**
 * Check if a team is on bye (not in the schedule)
 * Returns false if schedule data is missing to avoid false positives
 */
export function isTeamOnBye(team: string | undefined, schedule: GameSchedule): boolean {
  if (!team) return true;
  
  // If schedule is empty or missing (e.g., ESPN API failed), fail open
  // This prevents all players from being marked as locked due to missing data
  if (!schedule || Object.keys(schedule).length === 0) {
    return false;
  }
  
  return !schedule[team.toUpperCase()];
}

/**
 * Reliable per-player lock detection using matchup data and team schedule
 * 
 * Lock Rules:
 * 1. Player has points in matchup data (definitive - they played)
 * 2. Player's team game has started (schedule-based)
 * 3. Use single nowUtc timestamp for entire run to avoid flapping
 * 
 * @param player Player object with team and player_id
 * @param schedule Week schedule with team game times
 * @param nowUtc Single timestamp for entire run (DO NOT use Date.now() directly)
 * @param playedPlayerIds Set of player IDs who have scored points
 * @param actualPoints Map of actual points scored (to distinguish 0 from not played)
 */
export function isPlayerLocked(
  player: { team?: string; player_id?: string; name?: string }, 
  schedule: GameSchedule, 
  nowUtc: number,
  playedPlayerIds?: Record<string, boolean>,
  actualPoints?: Record<string, number>
): boolean {
  // Priority 1: Player has scored points OR is marked as played = definitive lock
  if (player.player_id) {
    // Check if player is marked as played
    if (playedPlayerIds && playedPlayerIds[player.player_id]) {
      return true;
    }
    
    // Check if player has non-zero actual points (0 points before kickoff doesn't count)
    if (actualPoints && player.player_id in actualPoints) {
      const points = actualPoints[player.player_id];
      if (points !== undefined && points !== 0) {
        return true;
      }
    }
  }
  
  // Priority 3: Team's game has started (schedule-based fallback)
  const teamLocked = hasGameStarted(player.team, schedule, nowUtc) || isTeamOnBye(player.team, schedule);
  
  // DEBUG: Log lock decisions for specific players
  const debugPlayers = ['Josh Downs', 'Davis Mills'];
  if (player.name && debugPlayers.some(name => player.name?.includes(name))) {
    const pts = actualPoints && player.player_id ? actualPoints[player.player_id] : undefined;
    const played = playedPlayerIds && player.player_id ? playedPlayerIds[player.player_id] : false;
    console.log(`[LockDebug] ${player.name} (${player.team}):`, {
      played,
      actualPoints: pts,
      teamLocked,
      scheduleSize: Object.keys(schedule).length,
      teamInSchedule: player.team ? (player.team in schedule) : false,
      finalLocked: teamLocked
    });
  }
  
  return teamLocked;
}

/**
 * Filter out locked players from a list
 * 
 * @param players List of players to filter
 * @param schedule Week schedule with team game times
 * @param nowUtc Single timestamp for entire run
 * @param playedPlayerIds Set of player IDs who have scored points
 * @param actualPoints Map of actual points scored
 */
export function filterUnlockedPlayers<T extends { team?: string; player_id?: string }>(
  players: T[], 
  schedule: GameSchedule,
  nowUtc: number,
  playedPlayerIds?: Record<string, boolean>,
  actualPoints?: Record<string, number>
): T[] {
  return players.filter(player => !isPlayerLocked(player, schedule, nowUtc, playedPlayerIds, actualPoints));
}

/**
 * Get all locked teams for a given week
 */
export function getLockedTeams(schedule: GameSchedule, now: number = Date.now()): string[] {
  const lockedTeams: string[] = [];
  
  for (const [team, gameData] of Object.entries(schedule)) {
    if (hasGameStarted(team, schedule, now)) {
      lockedTeams.push(team);
    }
  }
  
  return lockedTeams;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use hasGameStarted with schedule instead
 */
export function hasTeamPlayed(team: string | undefined, season: string, week: string): boolean {
  // For backward compatibility, assume team has played if no schedule available
  console.warn('hasTeamPlayed is deprecated, use hasGameStarted with schedule instead');
  return false;
}