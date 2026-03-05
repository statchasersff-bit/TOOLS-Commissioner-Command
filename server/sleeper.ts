import fs from "fs";
import path from "path";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";

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
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    ppts?: number;
    ppts_decimal?: number;
    fpts_decimal?: number;
    [key: string]: any;
  };
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
    lg.settings?.type === 2 && lg.settings?.best_ball !== 1
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
      ownerId: roster.owner_id || undefined,
      roster: rosterPlayers,
      picks: ownedPicks,
      metrics: { ...defaultMetrics },
    };
  });

  const format = deriveFormat(leagueRaw.roster_positions || []);
  const scoringFormat = deriveScoringFormat(leagueRaw.scoring_settings);

  const userTeamId = rostersRaw.find((r) => r.owner_id === userId);
  const userTeamIdStr = userTeamId ? `roster_${userTeamId.roster_id}` : null;

  const starterPositions = (leagueRaw.roster_positions || []).filter(
    (p: string) => p !== "BN" && p !== "IR"
  );

  return {
    league: {
      id: leagueRaw.league_id,
      name: leagueRaw.name,
      platform: "sleeper",
      scoringFormat: `${scoringFormat} ${format}`,
      teams,
      rosterPositions: starterPositions,
      format,
    },
    userTeamId: userTeamIdStr,
    format,
    scoringFormat,
  };
}

export interface PortfolioSummaryData {
  totalWins: number;
  totalLosses: number;
  totalTies: number;
  winRate: number;
  leagueRecords: Array<{
    leagueId: string;
    leagueName: string;
    wins: number;
    losses: number;
    ties: number;
    standing: number;
    totalRosters: number;
    format: string;
    redraftRank: number;
    dynastyRank: number;
    maxPfRank: number;
    playoffOdds: number;
  }>;
  contenderCount: number;
  middleCount: number;
  rebuildCount: number;
  playoffTeams: number;
  avgRank: number;
  playerExposure: Array<{
    playerId: string;
    name: string;
    pos: string;
    team: string;
    leagueCount: number;
    exposure: number;
  }>;
  lineupAlerts: Array<{
    leagueId: string;
    leagueName: string;
    issues: Array<{
      slot: string;
      reason: string;
      playerName?: string;
    }>;
  }>;
}

export async function fetchPortfolioSummary(
  userId: string,
  leagueSummaries: SleeperLeagueSummary[]
): Promise<PortfolioSummaryData> {
  const playersDb = await getSleeperPlayers();
  const validPositions = new Set(["QB", "RB", "WR", "TE"]);

  let fcValuesSf: Record<string, number> = {};
  let fcValues1Qb: Record<string, number> = {};
  let fcRedraftSf: Record<string, number> = {};
  let fcRedraft1Qb: Record<string, number> = {};
  try {
    const [sfData, oqbData, sfRedraft, oqbRedraft] = await Promise.all([
      getFantasyCalcValues("sf"),
      getFantasyCalcValues("1qb"),
      getFantasyCalcRedraftValues("sf"),
      getFantasyCalcRedraftValues("1qb"),
    ]);
    fcValuesSf = sfData.valuesBySleeperId;
    fcValues1Qb = oqbData.valuesBySleeperId;
    fcRedraftSf = sfRedraft.valuesBySleeperId;
    fcRedraft1Qb = oqbRedraft.valuesBySleeperId;
  } catch (err) {
    console.error("Failed to fetch FantasyCalc values for portfolio:", err);
  }

  const playerExposureMap = new Map<string, { name: string; pos: string; team: string; count: number }>();
  const leagueRecords: PortfolioSummaryData["leagueRecords"] = [];
  const lineupAlerts: PortfolioSummaryData["lineupAlerts"] = [];
  let totalWins = 0, totalLosses = 0, totalTies = 0;
  let contenderCount = 0, middleCount = 0, rebuildCount = 0, playoffTeams = 0;
  let totalRank = 0;

  const fetchPromises = leagueSummaries.map(async (ls) => {
    try {
      const [rostersRaw, leagueRaw] = await Promise.all([
        fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${ls.leagueId}/rosters`),
        fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${ls.leagueId}`),
      ]);

      const userRoster = rostersRaw.find((r) => r.owner_id === userId);
      if (!userRoster) return;

      const wins = userRoster.settings?.wins ?? 0;
      const losses = userRoster.settings?.losses ?? 0;
      const ties = userRoster.settings?.ties ?? 0;

      const sortedByWins = [...rostersRaw].sort((a, b) => {
        const aW = a.settings?.wins ?? 0;
        const bW = b.settings?.wins ?? 0;
        if (bW !== aW) return bW - aW;
        const aFpts = a.settings?.fpts ?? 0;
        const bFpts = b.settings?.fpts ?? 0;
        return bFpts - aFpts;
      });
      const standing = sortedByWins.findIndex((r) => r.roster_id === userRoster.roster_id) + 1;
      const total = rostersRaw.length;
      const playoffSlots = Math.max(Math.floor(total / 2), 1);

      const isSf = ls.format === "SF";
      const fcDynasty = isSf ? fcValuesSf : fcValues1Qb;
      const fcRedraft = isSf ? fcRedraftSf : fcRedraft1Qb;

      const hasDynastyValues = Object.keys(fcDynasty).length > 0;
      let dynastyRank = 0;
      if (hasDynastyValues) {
        const rosterValues = rostersRaw.map((r) => {
          const totalValue = (r.players || []).reduce((sum, pid) => sum + (fcDynasty[pid] || 0), 0);
          return { rosterId: r.roster_id, totalValue };
        });
        rosterValues.sort((a, b) => b.totalValue - a.totalValue);
        dynastyRank = rosterValues.findIndex((r) => r.rosterId === userRoster.roster_id) + 1;
      }

      const hasRedraftValues = Object.keys(fcRedraft).length > 0;
      let redraftRank = 0;
      if (hasRedraftValues) {
        const rosterValues = rostersRaw.map((r) => {
          const totalValue = (r.players || []).reduce((sum, pid) => sum + (fcRedraft[pid] || 0), 0);
          return { rosterId: r.roster_id, totalValue };
        });
        rosterValues.sort((a, b) => b.totalValue - a.totalValue);
        redraftRank = rosterValues.findIndex((r) => r.rosterId === userRoster.roster_id) + 1;
      }

      const hasPpts = rostersRaw.some((r) => (r.settings?.ppts ?? 0) > 0);
      let maxPfRank = 0;
      if (hasPpts) {
        const rosterMaxPf = rostersRaw.map((r) => {
          const ppts = (r.settings?.ppts ?? 0) + (r.settings?.ppts_decimal ?? 0) / 100;
          return { rosterId: r.roster_id, ppts };
        });
        rosterMaxPf.sort((a, b) => b.ppts - a.ppts);
        maxPfRank = rosterMaxPf.findIndex((r) => r.rosterId === userRoster.roster_id) + 1;
      }

      const totalGamesPlayed = wins + losses + ties;
      let playoffOdds: number;
      if (total <= 1) {
        playoffOdds = 100;
      } else if (totalGamesPlayed === 0) {
        playoffOdds = Math.round((playoffSlots / total) * 100);
      } else {
        const standingPct = (total - standing) / (total - 1);
        const gamesWeight = Math.min(totalGamesPlayed / 14, 1);
        const rawOdds = standingPct * gamesWeight + (playoffSlots / total) * (1 - gamesWeight);
        playoffOdds = Math.min(99, Math.max(1, Math.round(rawOdds * 100)));
      }

      leagueRecords.push({
        leagueId: ls.leagueId,
        leagueName: ls.name,
        wins,
        losses,
        ties,
        standing,
        totalRosters: total,
        format: ls.format,
        redraftRank,
        dynastyRank,
        maxPfRank,
        playoffOdds,
      });

      totalWins += wins;
      totalLosses += losses;
      totalTies += ties;
      totalRank += standing;

      if (standing <= 3) contenderCount++;
      else if (standing <= Math.ceil(total * 0.7)) middleCount++;
      else rebuildCount++;

      if (standing <= playoffSlots) playoffTeams++;

      for (const pid of userRoster.players || []) {
        const pData = playersDb[pid];
        if (!pData) continue;
        const pos = pData.fantasy_positions?.[0] || pData.position;
        if (!validPositions.has(pos)) continue;
        const existing = playerExposureMap.get(pid);
        if (existing) {
          existing.count++;
        } else {
          playerExposureMap.set(pid, {
            name: pData.full_name || `${pData.first_name} ${pData.last_name}`,
            pos,
            team: pData.team || "FA",
            count: 1,
          });
        }
      }

      const issues: Array<{ slot: string; reason: string; playerName?: string }> = [];
      const starters = userRoster.starters || [];
      const rosterPositions = leagueRaw.roster_positions || [];

      for (let i = 0; i < starters.length; i++) {
        const slotName = rosterPositions[i] || `SLOT ${i + 1}`;
        if (slotName === "BN") continue;
        const pid = starters[i];
        if (!pid || pid === "0") {
          issues.push({ slot: slotName, reason: "Empty" });
          continue;
        }
        const pData = playersDb[pid];
        if (pData) {
          const injuryStatus = (pData as any).injury_status;
          if (injuryStatus === "Out") issues.push({ slot: slotName, reason: "OUT", playerName: pData.full_name });
          else if (injuryStatus === "IR") issues.push({ slot: slotName, reason: "IR", playerName: pData.full_name });
          else if (injuryStatus === "Doubtful") issues.push({ slot: slotName, reason: "Doubtful", playerName: pData.full_name });
        }
      }

      if (issues.length > 0) {
        lineupAlerts.push({
          leagueId: ls.leagueId,
          leagueName: ls.name,
          issues,
        });
      }
    } catch (err) {
      console.error(`Portfolio summary: error fetching league ${ls.leagueId}:`, err);
    }
  });

  await Promise.all(fetchPromises);

  const totalGames = totalWins + totalLosses + totalTies;
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const avgRank = leagueRecords.length > 0 ? parseFloat((totalRank / leagueRecords.length).toFixed(1)) : 0;

  const totalLeagues = leagueSummaries.length;
  const playerExposure = Array.from(playerExposureMap.entries())
    .map(([playerId, data]) => ({
      playerId,
      name: data.name,
      pos: data.pos,
      team: data.team,
      leagueCount: data.count,
      exposure: Math.round((data.count / totalLeagues) * 100),
    }))
    .sort((a, b) => b.leagueCount - a.leagueCount)
    .slice(0, 20);

  return {
    totalWins,
    totalLosses,
    totalTies,
    winRate,
    leagueRecords: leagueRecords.sort((a, b) => a.standing - b.standing),
    contenderCount,
    middleCount,
    rebuildCount,
    playoffTeams,
    avgRank,
    playerExposure,
    lineupAlerts,
  };
}

export async function detectLiveDrafts(userId: string) {
  const leagues = await fetchJson<SleeperLeagueRaw[]>(
    `${SLEEPER_API}/user/${userId}/leagues/nfl/2026`
  );
  if (!leagues || !Array.isArray(leagues)) return [];

  const results: { leagueId: string; leagueName: string; draftId: string; status: string; type: string; season: string; rounds: number; teams: number; picksMade: number; totalPicks: number }[] = [];

  const checks = leagues.map(async (lg) => {
    try {
      const drafts = await fetchJson<any[]>(`${SLEEPER_API}/league/${lg.league_id}/drafts`);
      if (!drafts || drafts.length === 0) return;
      for (const d of drafts) {
        if (d.status === "drafting") {
          const rounds = d.settings?.rounds || 4;
          const teams = d.settings?.teams || lg.total_rosters || 12;
          let picksMade = 0;
          try {
            const picks = await fetchJson<any[]>(`${SLEEPER_API}/draft/${d.draft_id}/picks`);
            picksMade = (picks || []).filter((p: any) => p.player_id).length;
          } catch {}
          results.push({
            leagueId: lg.league_id,
            leagueName: lg.name,
            draftId: d.draft_id,
            status: d.status,
            type: d.type || "snake",
            season: d.season,
            rounds,
            teams,
            picksMade,
            totalPicks: rounds * teams,
          });
        }
      }
    } catch {}
  });

  await Promise.all(checks);
  return results;
}

export async function fetchDraftBoard(leagueId: string) {
  const draftsRaw = await fetchJson<any[]>(`${SLEEPER_API}/league/${leagueId}/drafts`);
  if (!draftsRaw || draftsRaw.length === 0) {
    return { draft: null, picks: [], players: {} as Record<string, { name: string; pos: string; team: string }>, draftSlots: [] as { slot: number; rosterId: number; displayName: string }[], error: "No drafts found for this league" };
  }

  const draft = draftsRaw[0];
  const draftId = draft.draft_id;

  const [picksRaw, playersDb, leagueUsers] = await Promise.all([
    fetchJson<any[]>(`${SLEEPER_API}/draft/${draftId}/picks`),
    getSleeperPlayers(),
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`).catch(() => [] as SleeperLeagueUserRaw[]),
  ]);

  const userNameMap = new Map<string, string>();
  for (const u of (leagueUsers || [])) {
    userNameMap.set(u.user_id, u.metadata?.team_name || u.display_name || u.user_id);
  }

  const slotToRosterId: Record<number, number> = draft.slot_to_roster_id || {};
  const draftOrder: Record<string, number> = draft.draft_order || {};

  const rosterIdToUserId = new Map<number, string>();
  for (const [userId, slot] of Object.entries(draftOrder)) {
    const rosterId = slotToRosterId[slot as any];
    if (rosterId) rosterIdToUserId.set(rosterId, userId);
  }

  const numTeams = draft.settings?.teams || Object.keys(slotToRosterId).length || 12;
  const rounds = draft.settings?.rounds || 4;

  const draftSlots: { slot: number; rosterId: number; displayName: string }[] = [];
  for (let s = 1; s <= numTeams; s++) {
    const rosterId = slotToRosterId[s] || s;
    const userId = rosterIdToUserId.get(rosterId);
    const displayName = userId ? (userNameMap.get(userId) || `Team ${s}`) : `Team ${s}`;
    draftSlots.push({ slot: s, rosterId, displayName });
  }

  const picks = (picksRaw || []).map((p: any) => ({
    round: p.round,
    pickNo: p.pick_no,
    draftSlot: p.draft_slot || 0,
    rosterId: p.roster_id,
    playerId: p.player_id,
    playerName: p.metadata?.first_name && p.metadata?.last_name
      ? `${p.metadata.first_name} ${p.metadata.last_name}`
      : playersDb[p.player_id]
        ? `${playersDb[p.player_id].first_name} ${playersDb[p.player_id].last_name}`
        : `Unknown`,
    pos: p.metadata?.position || playersDb[p.player_id]?.position || "??",
    team: p.metadata?.team || playersDb[p.player_id]?.team || "FA",
  }));

  const pickedPlayerIds = new Set(picks.map((p: any) => p.playerId).filter(Boolean));

  const playerMap: Record<string, { name: string; pos: string; team: string }> = {};
  for (const [id, p] of Object.entries(playersDb)) {
    if (!p.position || !["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    if (p.active === false && !pickedPlayerIds.has(id)) continue;
    playerMap[id] = {
      name: `${p.first_name} ${p.last_name}`,
      pos: p.position,
      team: p.team || "FA",
    };
  }

  return {
    draft: {
      draftId,
      status: draft.status,
      type: draft.type,
      rounds,
      teams: numTeams,
      season: draft.season,
      leagueName: draft.metadata?.name || "",
    },
    picks,
    players: playerMap,
    draftSlots,
    error: null,
  };
}

export async function fetchCrossLeagueTrades(
  userId: string,
  currentLeagueId: string,
  currentRosterPlayerIds: string[]
) {
  const RATE_MS = 350;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const leagues = await fetchJson<SleeperLeagueRaw[]>(
    `${SLEEPER_API}/user/${userId}/leagues/nfl/2026`
  );
  if (!leagues || !Array.isArray(leagues)) return { trades: [], leaguesScanned: 0 };

  const otherLeagues = leagues.filter(
    (lg) => lg.league_id !== currentLeagueId && lg.settings?.type === 2 && lg.settings?.best_ball !== 1
  );

  const playersDb = await getSleeperPlayers();
  const currentRosterSet = new Set(currentRosterPlayerIds);
  const results: Array<{
    playerName: string;
    playerId: string;
    pos: string;
    team: string;
    leagueName: string;
    leagueId: string;
    tradedTo: string;
    timestamp: number;
  }> = [];

  for (const lg of otherLeagues.slice(0, 8)) {
    await sleep(RATE_MS);

    let rostersRaw: any[] | null = null;
    let usersRaw: any[] | null = null;
    try {
      [rostersRaw, usersRaw] = await Promise.all([
        fetchJson<any[]>(`${SLEEPER_API}/league/${lg.league_id}/rosters`),
        fetchJson<any[]>(`${SLEEPER_API}/league/${lg.league_id}/users`),
      ]);
    } catch {
      continue;
    }
    if (!rostersRaw || !usersRaw) continue;

    const userRoster = rostersRaw.find((r: any) => r.owner_id === userId);
    if (!userRoster) continue;

    const userRosterId = userRoster.roster_id;
    const ownerMap = new Map<number, string>();
    for (const r of rostersRaw) {
      const u = usersRaw.find((u: any) => u.user_id === r.owner_id);
      ownerMap.set(r.roster_id, u?.display_name || u?.username || `Roster ${r.roster_id}`);
    }

    for (let round = 1; round <= 18; round++) {
      await sleep(RATE_MS);
      let txns: any[] | null = null;
      try {
        txns = await fetchJson<any[]>(`${SLEEPER_API}/league/${lg.league_id}/transactions/${round}`);
      } catch {
        continue;
      }
      if (!txns) continue;

      const completedTrades = txns.filter(
        (t: any) => t.type === "trade" && t.status === "complete" && t.roster_ids?.includes(userRosterId)
      );

      for (const trade of completedTrades) {
        if (!trade.drops) continue;
        const droppedByUser = Object.entries(trade.drops)
          .filter(([, rosterId]) => rosterId === userRosterId)
          .map(([playerId]) => playerId);

        for (const pid of droppedByUser) {
          if (currentRosterSet.has(pid)) {
            const p = playersDb[pid];
            const addedToRosterId = trade.adds?.[pid];
            results.push({
              playerName: p ? `${p.first_name} ${p.last_name}` : `Unknown (${pid})`,
              playerId: pid,
              pos: p?.position || "??",
              team: p?.team || "FA",
              leagueName: lg.name,
              leagueId: lg.league_id,
              tradedTo: ownerMap.get(addedToRosterId) || "Unknown",
              timestamp: trade.status_updated || 0,
            });
          }
        }
      }
    }
  }

  return { trades: results, leaguesScanned: otherLeagues.slice(0, 8).length };
}
