export async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function getUserByName(username: string) {
  try {
    return await fetchJSON<{ user_id: string }>(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
  } catch (error: any) {
    if (error.message?.includes('404')) return null;
    throw error;
  }
}

export async function getUserLeagues(userId: string, season: string) {
  return fetchJSON<any[]>(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${season}`);
}

export async function getLeagueRosters(leagueId: string) {
  return fetchJSON<any[]>(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
}

export async function getLeagueUsers(leagueId: string) {
  return fetchJSON<any[]>(`https://api.sleeper.app/v1/league/${leagueId}/users`);
}

export async function getLeagueDetails(leagueId: string) {
  return fetchJSON<any>(`https://api.sleeper.app/v1/league/${leagueId}`);
}

export async function getLeagueMatchups(leagueId: string, week: string) {
  return fetchJSON<any[]>(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
}

export async function getPlayersIndex() {
  return fetchJSON<Record<string, any>>("https://api.sleeper.app/v1/players/nfl");
}

/**
 * Get matchup data for all leagues to detect if players have already played/scored.
 * Returns both locked status and actual points scored.
 */
export async function getLeagueMatchupsForLocking(leagueIds: string[], week: string): Promise<{
  playedPlayerIds: Record<string, boolean>;
  actualPoints: Record<string, number>;
}> {
  const playedPlayerIds: Record<string, boolean> = {};
  const actualPoints: Record<string, number> = {};
  
  try {
    const results = await Promise.all(
      leagueIds.map(async (leagueId) => {
        try {
          const matchups = await getLeagueMatchups(leagueId, week);
          return { leagueId, matchups };
        } catch (error) {
          console.warn(`Failed to fetch matchups for league ${leagueId}:`, error);
          return { leagueId, matchups: [] };
        }
      })
    );
    
    for (const { matchups } of results) {
      for (const matchup of matchups) {
        if (matchup.players_points && typeof matchup.players_points === 'object') {
          for (const [playerId, points] of Object.entries(matchup.players_points)) {
            if (playerId && playerId !== "0" && typeof points === 'number') {
              actualPoints[playerId] = points;
              if (points !== 0) playedPlayerIds[playerId] = true;
            }
          }
        }
      }
    }
    
    return { playedPlayerIds, actualPoints };
  } catch (error) {
    console.error('Failed to fetch league matchups for locking:', error);
    return { playedPlayerIds: {}, actualPoints: {} };
  }
}
