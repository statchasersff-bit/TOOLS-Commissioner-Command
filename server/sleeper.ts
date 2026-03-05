import fs from "fs";
import path from "path";

const SLEEPER_API = "https://api.sleeper.app/v1";
const PLAYERS_CACHE_PATH = "/tmp/sleeper_players.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SleeperUserRaw {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: { rec?: number; [key: string]: any };
  status: string;
  settings: any;
}

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
}

interface SleeperLeagueUserRaw {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
}

interface SleeperTradedPickRaw {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

interface SleeperPlayerRaw {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
  age: number | null;
  fantasy_positions: string[] | null;
}

export interface SleeperUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface SleeperLeagueSummary {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  rosterPositions: string[];
  scoringFormat: string;
  format: string;
  status: string;
}

function deriveFormat(rosterPositions: string[]): string {
  return rosterPositions.includes("SUPER_FLEX") ? "SF" : "1QB";
}

function deriveScoringFormat(scoringSettings: { rec?: number }): string {
  const rec = scoringSettings?.rec ?? 0;
  if (rec === 1) return "PPR";
  if (rec === 0.5) return "Half";
  return "Standard";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("User not found");
    }
    throw new Error(`Sleeper API returned ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchSleeperUser(username: string): Promise<SleeperUser> {
  const response = await fetch(`${SLEEPER_API}/user/${username}`);
  if (!response.ok) {
    throw new Error("User not found");
  }
  const raw = await response.json() as SleeperUserRaw;
  if (!raw || !raw.user_id) {
    throw new Error("User not found");
  }
  return {
    userId: raw.user_id,
    username: raw.username,
    displayName: raw.display_name || raw.username,
    avatar: raw.avatar,
  };
}

export async function fetchSleeperLeagues(
  userId: string,
  season: string = "2026"
): Promise<SleeperLeagueSummary[]> {
  const raw = await fetchJson<SleeperLeagueRaw[]>(
    `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`
  );
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  const dynastyOnly = raw.filter((lg) =>
    lg.settings?.type === 2
  );
  return dynastyOnly.map((lg) => ({
    leagueId: lg.league_id,
    name: lg.name,
    season: lg.season,
    totalRosters: lg.total_rosters,
    rosterPositions: lg.roster_positions || [],
    scoringFormat: deriveScoringFormat(lg.scoring_settings),
    format: deriveFormat(lg.roster_positions || []),
    status: lg.status,
  }));
}

function isPlayersCacheValid(): boolean {
  try {
    const stat = fs.statSync(PLAYERS_CACHE_PATH);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

export async function getSleeperPlayers(): Promise<Record<string, SleeperPlayerRaw>> {
  if (isPlayersCacheValid()) {
    try {
      return JSON.parse(fs.readFileSync(PLAYERS_CACHE_PATH, "utf-8"));
    } catch {}
  }

  console.log("[Sleeper] Fetching full player database...");
  const raw = await fetchJson<Record<string, SleeperPlayerRaw>>(
    `${SLEEPER_API}/players/nfl`
  );
  fs.writeFileSync(PLAYERS_CACHE_PATH, JSON.stringify(raw), "utf-8");
  console.log("[Sleeper] Player database cached.");
  return raw;
}

export async function fetchSleeperLeagueFull(leagueId: string, userId: string) {
  const [leagueRaw, rostersRaw, usersRaw, tradedPicksRaw, playersDb] =
    await Promise.all([
      fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
      fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
      fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`),
      fetchJson<SleeperTradedPickRaw[]>(`${SLEEPER_API}/league/${leagueId}/traded_picks`),
      getSleeperPlayers(),
    ]);

  const usersMap = new Map<string, SleeperLeagueUserRaw>();
  for (const u of usersRaw) {
    usersMap.set(u.user_id, u);
  }

  const rosterIdToOwner = new Map<number, string>();
  for (const r of rostersRaw) {
    if (r.owner_id) {
      rosterIdToOwner.set(r.roster_id, r.owner_id);
    }
  }

  const validPositions = new Set(["QB", "RB", "WR", "TE"]);
  const defaultMetrics = {
    overall: 0,
    starters: 0,
    depth: 0,
    youth: 0,
    picks: 0,
    qb: 0,
    rb: 0,
    wr: 0,
    te: 0,
    contenderWindowYears: 0,
  };

  const pickYears = [2025, 2026, 2027, 2028];
  const pickRounds = [1, 2, 3, 4];

  const teams = rostersRaw.map((roster) => {
    const ownerUser = roster.owner_id ? usersMap.get(roster.owner_id) : null;
    const teamId = `roster_${roster.roster_id}`;
    const teamName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      `Team ${roster.roster_id}`;
    const ownerName = ownerUser?.display_name || `Owner ${roster.roster_id}`;

    const starterSet = new Set(roster.starters || []);
    const rosterPlayers = (roster.players || [])
      .map((pid) => {
        const pData = playersDb[pid];
        if (!pData) return null;
        const pos = pData.fantasy_positions?.[0] || pData.position;
        if (!validPositions.has(pos)) return null;
        return {
          id: pid,
          name: pData.full_name || `${pData.first_name} ${pData.last_name}`,
          pos: pos as "QB" | "RB" | "WR" | "TE",
          age: pData.age || 0,
          value: 0,
          team: pData.team || "FA",
          starter: starterSet.has(pid),
          sleeperId: pid,
        };
      })
      .filter(Boolean);

    const ownedPicks: Array<{
      year: number;
      round: number;
      ownerTeamId: string;
      value: number;
    }> = [];

    for (const year of pickYears) {
      for (const round of pickRounds) {
        ownedPicks.push({
          year,
          round,
          ownerTeamId: teamId,
          value: 0,
        });
      }
    }

    for (const tp of tradedPicksRaw) {
      const tpYear = parseInt(tp.season, 10);
      if (!pickYears.includes(tpYear)) continue;

      const fromTeamId = `roster_${tp.previous_owner_id}`;
      const toTeamId = `roster_${tp.owner_id}`;

      if (fromTeamId === teamId) {
        const idx = ownedPicks.findIndex(
          (p) => p.year === tpYear && p.round === tp.round
        );
        if (idx !== -1) {
          ownedPicks.splice(idx, 1);
        }
      }

      if (toTeamId === teamId) {
        ownedPicks.push({
          year: tpYear,
          round: tp.round,
          ownerTeamId: teamId,
          value: 0,
        });
      }
    }

    return {
      id: teamId,
      name: teamName,
      owner: ownerName,
      roster: rosterPlayers,
      picks: ownedPicks,
      metrics: { ...defaultMetrics },
    };
  });

  const format = deriveFormat(leagueRaw.roster_positions || []);
  const scoringFormat = deriveScoringFormat(leagueRaw.scoring_settings);

  const userTeamId = rostersRaw.find((r) => r.owner_id === userId);
  const userTeamIdStr = userTeamId ? `roster_${userTeamId.roster_id}` : null;

  return {
    league: {
      id: leagueRaw.league_id,
      name: leagueRaw.name,
      platform: "sleeper",
      scoringFormat: `${scoringFormat} ${format}`,
      teams,
    },
    userTeamId: userTeamIdStr,
    format,
    scoringFormat,
  };
}
