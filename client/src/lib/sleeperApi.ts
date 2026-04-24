import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalcApi";

const SLEEPER_API = "https://api.sleeper.app/v1";
const PLAYERS_CACHE_KEY = "sc-sleeper-players";
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
  active?: boolean;
  injury_status?: string;
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
  const raw = (await response.json()) as SleeperUserRaw;
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
  const dynastyOnly = raw.filter(
    (lg) => lg.settings?.type === 2 && lg.settings?.best_ball !== 1
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

let playersPromise: Promise<Record<string, SleeperPlayerRaw>> | null = null;

export async function getSleeperPlayers(): Promise<Record<string, SleeperPlayerRaw>> {
  if (playersPromise) return playersPromise;

  try {
    const raw = localStorage.getItem(PLAYERS_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached._cachedAt < CACHE_TTL_MS) {
        return cached.data as Record<string, SleeperPlayerRaw>;
      }
    }
  } catch {}

  playersPromise = fetchJson<Record<string, SleeperPlayerRaw>>(
    `${SLEEPER_API}/players/nfl`
  ).then((data) => {
    try {
      localStorage.setItem(
        PLAYERS_CACHE_KEY,
        JSON.stringify({ data, _cachedAt: Date.now() })
      );
    } catch {}
    playersPromise = null;
    return data;
  }).catch((err) => {
    playersPromise = null;
    throw err;
  });

  return playersPromise;
}

export async function fetchSleeperLeagueFull(leagueId: string, userId: string) {
  const [leagueRaw, rostersRaw, usersRaw, tradedPicksRaw, playersDb, draftsRaw] =
    await Promise.all([
      fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
      fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
      fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`),
      fetchJson<SleeperTradedPickRaw[]>(`${SLEEPER_API}/league/${leagueId}/traded_picks`),
      getSleeperPlayers(),
      fetchJson<any[]>(`${SLEEPER_API}/league/${leagueId}/drafts`).catch(() => [] as any[]),
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

  const rosterIdToSlot2026 = new Map<number, number>();
  if (draftsRaw && Array.isArray(draftsRaw)) {
    const draft2026 = draftsRaw.find((d: any) => d.season === "2026");
    if (draft2026) {
      const slotToRoster: Record<string, number> = draft2026.slot_to_roster_id || {};
      if (Object.keys(slotToRoster).length > 0) {
        for (const [slotStr, rosterId] of Object.entries(slotToRoster)) {
          rosterIdToSlot2026.set(rosterId, parseInt(slotStr, 10));
        }
      } else {
        const draftOrder: Record<string, number> = draft2026.draft_order || {};
        if (Object.keys(draftOrder).length > 0) {
          const ownerToRoster = new Map<string, number>();
          for (const r of rostersRaw) {
            if (r.owner_id) ownerToRoster.set(r.owner_id, r.roster_id);
          }
          for (const [userId, slot] of Object.entries(draftOrder)) {
            const rosterId = ownerToRoster.get(userId);
            if (rosterId !== undefined) {
              rosterIdToSlot2026.set(rosterId, slot);
            }
          }
        }
      }
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

  const pickYears = [2026, 2027, 2028];
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
      originalRosterId: number;
      pickSlot?: number;
      value: number;
    }> = [];

    for (const year of pickYears) {
      for (const round of pickRounds) {
        const slot = year === 2026 ? rosterIdToSlot2026.get(roster.roster_id) : undefined;
        ownedPicks.push({
          year,
          round,
          ownerTeamId: teamId,
          originalRosterId: roster.roster_id,
          pickSlot: slot,
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
          (p) => p.year === tpYear && p.round === tp.round && p.originalRosterId === tp.roster_id
        );
        if (idx !== -1) {
          ownedPicks.splice(idx, 1);
        }
      }

      if (toTeamId === teamId) {
        const slot = tpYear === 2026 ? rosterIdToSlot2026.get(tp.roster_id) : undefined;
        ownedPicks.push({
          year: tpYear,
          round: tp.round,
          ownerTeamId: teamId,
          originalRosterId: tp.roster_id,
          pickSlot: slot,
          value: 0,
        });
      }
    }

    const avatarId = ownerUser?.avatar || null;
    const avatarUrl = avatarId
      ? `https://sleepercdn.com/avatars/thumbs/${avatarId}`
      : null;

    return {
      id: teamId,
      name: teamName,
      owner: ownerName,
      ownerId: roster.owner_id || undefined,
      avatar: avatarUrl,
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

  const playerExposureMap = new Map<
    string,
    { name: string; pos: string; team: string; count: number }
  >();
  const leagueRecords: PortfolioSummaryData["leagueRecords"] = [];
  const lineupAlerts: PortfolioSummaryData["lineupAlerts"] = [];
  let totalWins = 0,
    totalLosses = 0,
    totalTies = 0;
  let contenderCount = 0,
    middleCount = 0,
    rebuildCount = 0,
    playoffTeams = 0;
  let totalRank = 0;

  const fetchPromises = leagueSummaries.map(async (ls) => {
    try {
      const [rostersRaw, leagueRaw] = await Promise.all([
        fetchJson<SleeperRosterRaw[]>(
          `${SLEEPER_API}/league/${ls.leagueId}/rosters`
        ),
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
      const standing =
        sortedByWins.findIndex((r) => r.roster_id === userRoster.roster_id) + 1;
      const total = rostersRaw.length;
      const playoffSlots = Math.max(Math.floor(total / 2), 1);

      const isSf = ls.format === "SF";
      const fcDynasty = isSf ? fcValuesSf : fcValues1Qb;
      const fcRedraft = isSf ? fcRedraftSf : fcRedraft1Qb;

      const hasDynastyValues = Object.keys(fcDynasty).length > 0;
      let dynastyRank = 0;
      if (hasDynastyValues) {
        const rosterValues = rostersRaw.map((r) => {
          const totalValue = (r.players || []).reduce(
            (sum, pid) => sum + (fcDynasty[pid] || 0),
            0
          );
          return { rosterId: r.roster_id, totalValue };
        });
        rosterValues.sort((a, b) => b.totalValue - a.totalValue);
        dynastyRank =
          rosterValues.findIndex(
            (r) => r.rosterId === userRoster.roster_id
          ) + 1;
      }

      const hasRedraftValues = Object.keys(fcRedraft).length > 0;
      let redraftRank = 0;
      if (hasRedraftValues) {
        const rosterValues = rostersRaw.map((r) => {
          const totalValue = (r.players || []).reduce(
            (sum, pid) => sum + (fcRedraft[pid] || 0),
            0
          );
          return { rosterId: r.roster_id, totalValue };
        });
        rosterValues.sort((a, b) => b.totalValue - a.totalValue);
        redraftRank =
          rosterValues.findIndex(
            (r) => r.rosterId === userRoster.roster_id
          ) + 1;
      }

      const hasPpts = rostersRaw.some((r) => (r.settings?.ppts ?? 0) > 0);
      let maxPfRank = 0;
      if (hasPpts) {
        const rosterMaxPf = rostersRaw.map((r) => {
          const ppts =
            (r.settings?.ppts ?? 0) + (r.settings?.ppts_decimal ?? 0) / 100;
          return { rosterId: r.roster_id, ppts };
        });
        rosterMaxPf.sort((a, b) => b.ppts - a.ppts);
        maxPfRank =
          rosterMaxPf.findIndex(
            (r) => r.rosterId === userRoster.roster_id
          ) + 1;
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
        const rawOdds =
          standingPct * gamesWeight + (playoffSlots / total) * (1 - gamesWeight);
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
            name:
              pData.full_name || `${pData.first_name} ${pData.last_name}`,
            pos,
            team: pData.team || "FA",
            count: 1,
          });
        }
      }

      const issues: Array<{
        slot: string;
        reason: string;
        playerName?: string;
      }> = [];
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
        const pData = playersDb[pid] as any;
        if (pData) {
          const injuryStatus = pData.injury_status;
          if (injuryStatus === "Out")
            issues.push({
              slot: slotName,
              reason: "OUT",
              playerName: pData.full_name,
            });
          else if (injuryStatus === "IR")
            issues.push({
              slot: slotName,
              reason: "IR",
              playerName: pData.full_name,
            });
          else if (injuryStatus === "Doubtful")
            issues.push({
              slot: slotName,
              reason: "Doubtful",
              playerName: pData.full_name,
            });
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
      console.error(
        `Portfolio summary: error fetching league ${ls.leagueId}:`,
        err
      );
    }
  });

  await Promise.all(fetchPromises);

  const totalGames = totalWins + totalLosses + totalTies;
  const winRate =
    totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const avgRank =
    leagueRecords.length > 0
      ? parseFloat((totalRank / leagueRecords.length).toFixed(1))
      : 0;

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

  const results: {
    leagueId: string;
    leagueName: string;
    draftId: string;
    status: string;
    type: string;
    season: string;
    rounds: number;
    teams: number;
    picksMade: number;
    totalPicks: number;
  }[] = [];

  const checks = leagues.map(async (lg) => {
    try {
      const drafts = await fetchJson<any[]>(
        `${SLEEPER_API}/league/${lg.league_id}/drafts`
      );
      if (!drafts || drafts.length === 0) return;
      for (const d of drafts) {
        if (d.status === "drafting") {
          const rounds = d.settings?.rounds || 4;
          const teams = d.settings?.teams || lg.total_rosters || 12;
          let picksMade = 0;
          try {
            const picks = await fetchJson<any[]>(
              `${SLEEPER_API}/draft/${d.draft_id}/picks`
            );
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
  const draftsRaw = await fetchJson<any[]>(
    `${SLEEPER_API}/league/${leagueId}/drafts`
  );
  if (!draftsRaw || draftsRaw.length === 0) {
    return {
      draft: null,
      picks: [],
      players: {} as Record<string, { name: string; pos: string; team: string }>,
      draftSlots: [] as { slot: number; rosterId: number; displayName: string }[],
      error: "No drafts found for this league",
    };
  }

  const draft = draftsRaw[0];
  const draftId = draft.draft_id;

  const [picksRaw, playersDb, leagueUsers] = await Promise.all([
    fetchJson<any[]>(`${SLEEPER_API}/draft/${draftId}/picks`),
    getSleeperPlayers(),
    fetchJson<SleeperLeagueUserRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/users`
    ).catch(() => [] as SleeperLeagueUserRaw[]),
  ]);

  const userNameMap = new Map<string, string>();
  for (const u of leagueUsers || []) {
    userNameMap.set(
      u.user_id,
      u.metadata?.team_name || u.display_name || u.user_id
    );
  }

  const slotToRosterId: Record<number, number> =
    draft.slot_to_roster_id || {};
  const draftOrder: Record<string, number> = draft.draft_order || {};

  const rosterIdToUserId = new Map<number, string>();
  for (const [uId, slot] of Object.entries(draftOrder)) {
    const rosterId = slotToRosterId[slot as any];
    if (rosterId) rosterIdToUserId.set(rosterId, uId);
  }

  const numTeams =
    draft.settings?.teams || Object.keys(slotToRosterId).length || 12;
  const rounds = draft.settings?.rounds || 4;

  const draftSlots: { slot: number; rosterId: number; displayName: string }[] =
    [];
  for (let s = 1; s <= numTeams; s++) {
    const rosterId = slotToRosterId[s] || s;
    const uId = rosterIdToUserId.get(rosterId);
    const displayName = uId
      ? userNameMap.get(uId) || `Team ${s}`
      : `Team ${s}`;
    draftSlots.push({ slot: s, rosterId, displayName });
  }

  const picks = (picksRaw || []).map((p: any) => ({
    round: p.round,
    pickNo: p.pick_no,
    draftSlot: p.draft_slot || 0,
    rosterId: p.roster_id,
    playerId: p.player_id,
    playerName:
      p.metadata?.first_name && p.metadata?.last_name
        ? `${p.metadata.first_name} ${p.metadata.last_name}`
        : playersDb[p.player_id]
          ? `${playersDb[p.player_id].first_name} ${playersDb[p.player_id].last_name}`
          : `Unknown`,
    pos:
      p.metadata?.position || playersDb[p.player_id]?.position || "??",
    team: p.metadata?.team || playersDb[p.player_id]?.team || "FA",
    pickedAt: typeof p.picked_at === "number" ? p.picked_at : null,
  }));

  const pickedPlayerIds = new Set(
    picks.map((p: any) => p.playerId).filter(Boolean)
  );

  const playerMap: Record<string, { name: string; pos: string; team: string }> =
    {};
  for (const [id, p] of Object.entries(playersDb)) {
    if (!p.position || !["QB", "RB", "WR", "TE"].includes(p.position))
      continue;
    if ((p as any).active === false && !pickedPlayerIds.has(id)) continue;
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

export interface CrossLeagueTradeResult {
  leagueName: string;
  leagueId: string;
  timestamp: number;
  sent: Array<{ name: string; playerId: string; pos: string; nflTeam: string }>;
  received: Array<{ name: string; playerId: string; pos: string; nflTeam: string }>;
  sentPicks: string[];
  receivedPicks: string[];
  tradePartner: string;
}

export async function fetchCrossLeagueTrades(userId: string) {
  const RATE_MS = 300;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THREE_MONTHS_MS;

  const seasons = ["2025", "2026"];
  let allLeaguesRaw: SleeperLeagueRaw[] = [];
  for (const season of seasons) {
    const raw = await fetchJson<SleeperLeagueRaw[]>(
      `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`
    );
    if (raw && Array.isArray(raw)) allLeaguesRaw.push(...raw);
  }

  const seenIds = new Set<string>();
  const leagues = allLeaguesRaw.filter((lg) => {
    if (seenIds.has(lg.league_id)) return false;
    seenIds.add(lg.league_id);
    return lg.settings?.type === 2 && lg.settings?.best_ball !== 1;
  });

  if (leagues.length === 0) return { trades: [], leaguesScanned: 0 };

  const playersDb = await getSleeperPlayers();
  const results: CrossLeagueTradeResult[] = [];
  let scanned = 0;

  for (const lg of leagues.slice(0, 15)) {
    scanned++;
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

    const weekPromises = [];
    for (let week = 1; week <= 18; week++) {
      weekPromises.push(
        fetchJson<any[]>(`${SLEEPER_API}/league/${lg.league_id}/transactions/${week}`).catch(() => [])
      );
    }

    await sleep(RATE_MS);
    const weekResults = await Promise.all(weekPromises);
    const allTxns = weekResults.flat().filter(Boolean);

    const completedTrades = allTxns.filter(
      (t: any) =>
        t.type === "trade" &&
        t.status === "complete" &&
        t.roster_ids?.includes(userRosterId) &&
        (t.status_updated || 0) >= cutoff
    );

    for (const trade of completedTrades) {
      const sent: CrossLeagueTradeResult["sent"] = [];
      const received: CrossLeagueTradeResult["received"] = [];
      const sentPicks: string[] = [];
      const receivedPicks: string[] = [];
      let partnerId: number | null = null;

      for (const rid of trade.roster_ids || []) {
        if (rid !== userRosterId) { partnerId = rid; break; }
      }

      if (trade.drops) {
        for (const [pid, rosterId] of Object.entries(trade.drops)) {
          if ((rosterId as number) === userRosterId) {
            const p = playersDb[pid];
            sent.push({
              name: p ? `${p.first_name} ${p.last_name}` : `Unknown (${pid})`,
              playerId: pid,
              pos: p?.position || "??",
              nflTeam: p?.team || "FA",
            });
          }
        }
      }

      if (trade.adds) {
        for (const [pid, rosterId] of Object.entries(trade.adds)) {
          if ((rosterId as number) === userRosterId) {
            const p = playersDb[pid];
            received.push({
              name: p ? `${p.first_name} ${p.last_name}` : `Unknown (${pid})`,
              playerId: pid,
              pos: p?.position || "??",
              nflTeam: p?.team || "FA",
            });
          }
        }
      }

      if (trade.draft_picks) {
        for (const pick of trade.draft_picks) {
          const label = `${pick.season} Round ${pick.round}`;
          if (pick.previous_owner_id === userRosterId) {
            sentPicks.push(label);
          } else if (pick.owner_id === userRosterId) {
            receivedPicks.push(label);
          }
        }
      }

      if (sent.length === 0 && received.length === 0 && sentPicks.length === 0 && receivedPicks.length === 0) continue;

      results.push({
        leagueName: lg.name,
        leagueId: lg.league_id,
        timestamp: trade.status_updated || 0,
        sent,
        received,
        sentPicks,
        receivedPicks,
        tradePartner: partnerId ? (ownerMap.get(partnerId) || "Unknown") : "Unknown",
      });
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return { trades: results, leaguesScanned: scanned };
}

export async function fetchLeagueTransactions(leagueId: string) {
  const players = await getSleeperPlayers();
  const [leagueRaw, rostersRaw, usersRaw] = await Promise.all([
    fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
    fetchJson<SleeperRosterRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/rosters`
    ),
    fetchJson<SleeperLeagueUserRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/users`
    ),
  ]);

  const rosterOwnerMap = new Map<number, string>();
  const ownerNameMap = new Map<string, string>();
  for (const u of usersRaw) {
    ownerNameMap.set(
      u.user_id,
      u.metadata?.team_name || u.display_name || u.user_id
    );
  }
  for (const r of rostersRaw) {
    rosterOwnerMap.set(
      r.roster_id,
      ownerNameMap.get(r.owner_id) || `Team ${r.roster_id}`
    );
  }

  const totalWeeks = 18;
  const allTransactions: any[] = [];

  const weekPromises = [];
  for (let week = 1; week <= totalWeeks; week++) {
    weekPromises.push(
      fetchJson<any[]>(
        `${SLEEPER_API}/league/${leagueId}/transactions/${week}`
      )
        .then((txns) => txns.map((t: any) => ({ ...t, week })))
        .catch(() => [])
    );
  }
  const weekResults = await Promise.all(weekPromises);
  for (const txns of weekResults) {
    allTransactions.push(...txns);
  }

  allTransactions.sort(
    (a, b) => (b.status_updated || 0) - (a.status_updated || 0)
  );

  const formatted = allTransactions
    .filter((t: any) => t.status === "complete")
    .map((t: any) => {
      const type: string = t.type;
      const timestamp = t.status_updated || t.created;
      const week = t.week;

      const adds: Array<{
        playerId: string;
        name: string;
        pos: string;
        team: string;
        rosterId: number;
        teamName: string;
      }> = [];
      const drops: Array<{
        playerId: string;
        name: string;
        pos: string;
        team: string;
        rosterId: number;
        teamName: string;
      }> = [];
      const draftPicks: Array<{
        season: string;
        round: number;
        fromTeam: string;
        toTeam: string;
      }> = [];

      if (t.adds) {
        for (const [pid, rid] of Object.entries(t.adds)) {
          const p = players[pid];
          adds.push({
            playerId: pid,
            name: p?.full_name || pid,
            pos: p?.position || "?",
            team: p?.team || "FA",
            rosterId: rid as number,
            teamName:
              rosterOwnerMap.get(rid as number) || `Team ${rid}`,
          });
        }
      }

      if (t.drops) {
        for (const [pid, rid] of Object.entries(t.drops)) {
          const p = players[pid];
          drops.push({
            playerId: pid,
            name: p?.full_name || pid,
            pos: p?.position || "?",
            team: p?.team || "FA",
            rosterId: rid as number,
            teamName:
              rosterOwnerMap.get(rid as number) || `Team ${rid}`,
          });
        }
      }

      if (t.draft_picks && Array.isArray(t.draft_picks)) {
        for (const dp of t.draft_picks) {
          draftPicks.push({
            season: dp.season,
            round: dp.round,
            fromTeam:
              rosterOwnerMap.get(dp.previous_owner_id) ||
              `Team ${dp.previous_owner_id}`,
            toTeam:
              rosterOwnerMap.get(dp.owner_id) || `Team ${dp.owner_id}`,
          });
        }
      }

      const rosterIds = new Set<number>();
      if (t.roster_ids)
        t.roster_ids.forEach((r: number) => rosterIds.add(r));
      const involvedTeams = [...rosterIds].map((rid) => ({
        rosterId: rid,
        teamName: rosterOwnerMap.get(rid) || `Team ${rid}`,
      }));

      return { type, timestamp, week, adds, drops, draftPicks, involvedTeams };
    });

  return {
    transactions: formatted,
    leagueName: leagueRaw.name,
    totalRosters: leagueRaw.total_rosters,
  };
}
