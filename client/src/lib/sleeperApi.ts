import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalcApi";
import { buildOptimalStarterIds } from "./lineupUtils";
import { normalizeSleeperDraftOrder, type NormalizedDraftOrder } from "./sleeperDraftOrder";
import { FeatureDisabledError, showFeatureDisabled } from "@/components/FeatureDisabledDialog";

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
  draft_id?: string | null;
  settings: any;
}

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  taxi?: string[] | null;
  reserve?: string[] | null;
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
  username?: string;
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
  ownership?: { owned_pct?: number; waiver_pickup_pct?: number };
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
  draftId: string | null;
  avatar: string | null;
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
  const dynastyOnly = raw.filter((lg) => {
    if (lg.settings?.type !== 2) return false;
    if (lg.status === "inactive") return false;
    if (lg.status === "pre_draft" && !lg.draft_id) return false;
    return true;
  });

  // Keep only leagues where the user owns a roster AND has players on it
  // (excludes pre-draft leagues where the startup draft hasn't happened yet)
  const rosterChecks = await Promise.all(
    dynastyOnly.map(async (lg) => {
      try {
        const rosters = await fetchJson<SleeperRosterRaw[]>(
          `${SLEEPER_API}/league/${lg.league_id}/rosters`
        );
        const userRoster = rosters.find((r) => r.owner_id === userId);
        if (!userRoster) return null;
        // Skip undrafted leagues — user has a roster slot but no players yet
        if (!userRoster.players || userRoster.players.length === 0) return null;
        return lg;
      } catch {
        return lg; // on error, keep the league rather than silently hide it
      }
    })
  );

  const withTeam = rosterChecks.filter((lg): lg is SleeperLeagueRaw => lg !== null);

  return withTeam.map((lg) => ({
    leagueId: lg.league_id,
    name: lg.name,
    season: lg.season,
    totalRosters: lg.total_rosters,
    rosterPositions: lg.roster_positions || [],
    scoringFormat: deriveScoringFormat(lg.scoring_settings),
    format: deriveFormat(lg.roster_positions || []),
    status: lg.status,
    draftId: lg.draft_id ?? null,
    avatar: (lg as any).avatar ?? null,
    isBestBall: lg.settings?.best_ball === 1,
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

  // Build a map of year -> draft status so we can skip years whose rookie draft is done
  const draftStatusByYear = new Map<number, string>();
  if (draftsRaw && Array.isArray(draftsRaw)) {
    for (const d of draftsRaw) {
      const yr = parseInt(d.season, 10);
      if (!isNaN(yr)) draftStatusByYear.set(yr, d.status || "");
    }
  }

  // Determine pick years dynamically: skip years whose draft is already complete
  const leagueSeason = parseInt((leagueRaw as any).season || "2026", 10);
  const pickYears: number[] = [];
  for (let yr = leagueSeason; pickYears.length < 3; yr++) {
    if (draftStatusByYear.get(yr) !== "complete") pickYears.push(yr);
  }
  const pickRounds = [1, 2, 3, 4];

  // Build slot map for the earliest non-complete pick year (the upcoming rookie draft)
  const slotPickYear = pickYears[0];
  const rosterIdToSlotCurrent = new Map<number, number>();
  if (draftsRaw && Array.isArray(draftsRaw)) {
    const upcomingDraft = draftsRaw.find((d: any) => parseInt(d.season, 10) === slotPickYear);
    if (upcomingDraft) {
      const slotToRoster: Record<string, number> = upcomingDraft.slot_to_roster_id || {};
      if (Object.keys(slotToRoster).length > 0) {
        for (const [slotStr, rosterId] of Object.entries(slotToRoster)) {
          rosterIdToSlotCurrent.set(rosterId as number, parseInt(slotStr, 10));
        }
      } else {
        const draftOrder: Record<string, number> = upcomingDraft.draft_order || {};
        if (Object.keys(draftOrder).length > 0) {
          const ownerToRoster = new Map<string, number>();
          for (const r of rostersRaw) {
            if (r.owner_id) ownerToRoster.set(r.owner_id, r.roster_id);
          }
          for (const [uid, slot] of Object.entries(draftOrder)) {
            const rosterId = ownerToRoster.get(uid);
            if (rosterId !== undefined) rosterIdToSlotCurrent.set(rosterId, slot as number);
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
    windowStartOffset: 0,
  };

  const teams = rostersRaw.map((roster) => {
    const ownerUser = roster.owner_id ? usersMap.get(roster.owner_id) : null;
    const teamId = `roster_${roster.roster_id}`;
    const teamName =
      ownerUser?.metadata?.team_name ||
      ownerUser?.display_name ||
      `Team ${roster.roster_id}`;
    const ownerName = ownerUser?.display_name || `Owner ${roster.roster_id}`;

    const starterSet = new Set(roster.starters || []);
    const taxiSet = new Set(roster.taxi ?? []);
    const reserveSet = new Set(roster.reserve ?? []);
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
          onTaxi: taxiSet.has(pid),
          onReserve: reserveSet.has(pid),
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
        const slot = year === slotPickYear ? rosterIdToSlotCurrent.get(roster.roster_id) : undefined;
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
        const slot = tpYear === slotPickYear ? rosterIdToSlotCurrent.get(tp.roster_id) : undefined;
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

  const rawPositions: string[] = leagueRaw.roster_positions || [];
  const starterPositions = rawPositions.filter(
    (p: string) => p !== "BN" && p !== "IR" && p !== "TAXI"
  );
  const benchSlots = rawPositions.filter((p: string) => p === "BN").length;
  const taxiSlots = rawPositions.filter((p: string) => p === "TAXI").length;
  const irSlots   = rawPositions.filter((p: string) => p === "IR").length;
  const tePremium: number = leagueRaw.scoring_settings?.bonus_rec_te ?? 0;

  const playoffTeams: number = leagueRaw.settings?.playoff_teams
    ?? Math.max(2, Math.round((rostersRaw?.length ?? 12) / 3));
  const regularSeasonWeeks: number = leagueRaw.settings?.playoff_week_start
    ? Math.max(1, leagueRaw.settings.playoff_week_start - 1)
    : 14;

  return {
    league: {
      id: leagueRaw.league_id,
      name: leagueRaw.name,
      platform: "sleeper",
      scoringFormat: `${scoringFormat} ${format}`,
      teams,
      rosterPositions: starterPositions,
      format,
      playoffTeams,
      regularSeasonWeeks,
      totalRosters: leagueRaw.total_rosters,
      benchSlots,
      taxiSlots,
      irSlots,
      tePremium,
      scoringSettings: (leagueRaw.scoring_settings ?? {}) as Record<string, number>,
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
    avatar: string | null;
    wins: number;
    losses: number;
    ties: number;
    totalGamesPlayed: number;
    standing: number;
    totalRosters: number;
    format: string;
    scoringFormat: string;
    redraftRank: number;
    dynastyRank: number;
    pfRank: number;
    maxPfRank: number;
    playoffOdds: number;
    isBestBall: boolean;
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

      // Skip empty/orphan leagues — no players means no real team has been drafted
      const userPlayers = userRoster.players || [];
      if (userPlayers.length === 0) return;

      // Skip leagues where the majority of rosters are unclaimed (orphan pools)
      const ownedRosters = rostersRaw.filter((r) => r.owner_id !== null).length;
      if (ownedRosters < Math.ceil(rostersRaw.length / 2)) return;

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
      // Greedy optimal-lineup redraft rank — same algorithm as ValueModelContext.optimizeLineup
      let redraftRank = 0;
      if (hasRedraftValues) {
        const rp: string[] = leagueRaw.roster_positions || [];
        const rosterValues = rostersRaw.map((r) => {
          const starterIds = buildOptimalStarterIds(
            r.players || [],
            (id) => playersDb[id]?.position ?? null,
            (id) => fcRedraft[id] ?? 0,
            rp
          );
          const value = [...starterIds].reduce((s, id) => s + (fcRedraft[id] ?? 0), 0);
          return { rosterId: r.roster_id, value };
        });
        rosterValues.sort((a, b) => b.value - a.value);
        redraftRank = rosterValues.findIndex((r) => r.rosterId === userRoster.roster_id) + 1 || 0;
      }
      // redraftStarterRank uses same greedy-optimal logic (used for playoff% talent score)
      const redraftStarterRank = redraftRank;

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

      // Actual points-scored (PF) rank — based on fpts accumulated this season
      const rosterPf = rostersRaw.map((r) => {
        const pf = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
        return { rosterId: r.roster_id, pf };
      });
      const hasPf = rosterPf.some((r) => r.pf > 0);
      let pfRank = 0;
      if (hasPf) {
        rosterPf.sort((a, b) => b.pf - a.pf);
        pfRank = rosterPf.findIndex((r) => r.rosterId === userRoster.roster_id) + 1 || 0;
      }

      // Actual playoff slots from Sleeper settings; fall back to ~1/3 of league
      const playoffSlots = leagueRaw.settings?.playoff_teams
        ?? Math.max(2, Math.round(total / 3));

      const totalGamesPlayed = wins + losses + ties;
      // Regular season length: week before playoffs start, default 14
      const regularSeasonGames = leagueRaw.settings?.playoff_week_start
        ? Math.max(1, leagueRaw.settings.playoff_week_start - 1)
        : 14;
      const seasonProgress = Math.min(totalGamesPlayed / regularSeasonGames, 1);

      // --- Standing score ---
      // In a playoff spot → 0.55–0.95 based on comfort margin above the cutline
      // Out of a playoff spot → 0.05–0.45 based on how close to the bubble
      let standingScore: number;
      if (total <= 1) {
        standingScore = 1;
      } else if (standing <= playoffSlots) {
        const comfortMargin = playoffSlots > 1
          ? (playoffSlots - standing) / (playoffSlots - 1)
          : 1;
        standingScore = 0.55 + comfortMargin * 0.40;
      } else {
        const spotsBack = standing - playoffSlots;
        const maxSpotsBack = Math.max(1, total - playoffSlots);
        standingScore = 0.45 * (1 - spotsBack / maxSpotsBack);
      }

      // --- Talent score (redraft starter rank) ---
      // Same shape as standing score but based on projected talent vs cutline
      let talentScore: number;
      if (redraftStarterRank === 0 || total <= 1) {
        // No talent data — use base rate
        talentScore = playoffSlots / total;
      } else if (redraftStarterRank <= playoffSlots) {
        const comfortMargin = playoffSlots > 1
          ? (playoffSlots - redraftStarterRank) / (playoffSlots - 1)
          : 1;
        talentScore = 0.55 + comfortMargin * 0.40;
      } else {
        const spotsBack = redraftStarterRank - playoffSlots;
        const maxSpotsBack = Math.max(1, total - playoffSlots);
        talentScore = 0.45 * (1 - spotsBack / maxSpotsBack);
      }

      // --- Blend: early season = talent-heavy, late season = standing-heavy ---
      // standingWeight: 0.15 (week 0) → 0.85 (week 14+)
      const standingWeight = 0.15 + 0.70 * seasonProgress;
      const talentWeight = 1 - standingWeight;
      const rawOdds = standingWeight * standingScore + talentWeight * talentScore;
      const playoffOdds = Math.min(99, Math.max(1, Math.round(rawOdds * 100)));

      leagueRecords.push({
        leagueId: ls.leagueId,
        leagueName: ls.name,
        avatar: ls.avatar
          ? `https://sleepercdn.com/avatars/thumbs/${ls.avatar}`
          : null,
        wins,
        losses,
        ties,
        totalGamesPlayed,
        standing,
        totalRosters: total,
        format: ls.format,
        scoringFormat: ls.scoringFormat,
        redraftRank,
        dynastyRank,
        pfRank,
        maxPfRank,
        playoffOdds,
        isBestBall: ls.isBestBall ?? false,
      });

      totalWins += wins;
      totalLosses += losses;
      totalTies += ties;
      totalRank += standing;

      // Bucket leagues by win-now starter rank percentile, not standing.
      // Top 30% = contender, middle 31–69% = middle, bottom 30% = rebuild.
      // Leagues without a win-now rank yet (redraftRank=0) are excluded
      // from all three buckets so totals never lie.
      if (redraftRank > 0 && total > 0) {
        const winNowPct = redraftRank / total;
        if (winNowPct <= 0.30) contenderCount++;
        else if (winNowPct <= 0.70) middleCount++;
        else rebuildCount++;
      }

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

      // Best ball leagues auto-optimize; no lineup alerts needed
      if (issues.length > 0 && !ls.isBestBall) {
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
    .slice(0, 100);

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

/**
 * Infer the draft category. Sleeper's `metadata.type` is the source of truth
 * when present ("rookie"/"startup"). When missing (older drafts often have
 * blank metadata), fall back to a league + round-count heuristic:
 *   - dynasty league + 3-6 rounds → rookie
 *   - dynasty league + 20+ rounds → startup
 *   - rounds 7-19 in dynasty → ambiguous, classify as startup (mid-sized
 *     drafts are almost always startup re-drafts after a league reset)
 * Returns "unknown" when we have no league or round data to work with.
 */
function inferDraftCategory(
  d: { metadata?: { type?: string }; settings?: { rounds?: number } },
  leagueIsDynasty: boolean,
): "rookie" | "startup" | "supplemental" | "unknown" {
  const meta = (d.metadata?.type ?? "").toString().toLowerCase().trim();
  if (meta === "rookie") return "rookie";
  if (meta === "startup") return "startup";
  if (meta === "supplemental") return "supplemental";
  if (meta === "redraft") return "startup";

  const rounds = d.settings?.rounds ?? 0;
  if (!leagueIsDynasty) return "unknown";
  if (rounds >= 3 && rounds <= 6) return "rookie";
  if (rounds >= 20) return "startup";
  if (rounds >= 7 && rounds < 20) return "startup";
  return "unknown";
}

function isLeagueDynasty(lg: { settings?: any }): boolean {
  // Sleeper marks dynasty via settings.type === 2 (dynasty) vs 0 (redraft) / 1
  // (keeper). Some older payloads omit the flag, in which case we default to
  // dynasty since this app is dynasty-focused.
  const t = lg.settings?.type;
  if (t === 2) return true;
  if (t === 0 || t === 1) return false;
  return true;
}

export async function detectLiveDrafts(userId: string) {
  const leagues = await fetchJson<SleeperLeagueRaw[]>(
    `${SLEEPER_API}/user/${userId}/leagues/nfl/2026`
  );
  if (!leagues || !Array.isArray(leagues)) return [];

  const results: {
    leagueId: string;
    leagueName: string;
    leagueAvatar: string | null;
    draftId: string;
    status: string;
    type: string;
    draftCategory: string;
    season: string;
    rounds: number;
    teams: number;
    picksMade: number;
    totalPicks: number;
    startTime: number | null;
    draftOrderSet: boolean;
  }[] = [];

  const checks = leagues.map(async (lg) => {
    try {
      const drafts = await fetchJson<any[]>(
        `${SLEEPER_API}/league/${lg.league_id}/drafts`
      );
      if (!drafts || drafts.length === 0) return;
      const leagueIsDynasty = isLeagueDynasty(lg as any);
      for (const d of drafts) {
        // Include drafting (LIVE), paused (LIVE), and pre_draft (UPCOMING).
        // Skip complete drafts and any unknown statuses.
        const status = (d.status ?? "").toLowerCase();
        if (
          status !== "drafting" &&
          status !== "paused" &&
          status !== "pre_draft"
        ) {
          continue;
        }

        const rounds = d.settings?.rounds || 4;
        const teams = d.settings?.teams || lg.total_rosters || 12;
        let picksMade = 0;
        // For pre_draft we skip the picks call — there shouldn't be any, and
        // it saves one round-trip per upcoming draft on a multi-league scan.
        if (status !== "pre_draft") {
          try {
            const picks = await fetchJson<any[]>(
              `${SLEEPER_API}/draft/${d.draft_id}/picks`
            );
            picksMade = (picks || []).filter((p: any) => p.player_id).length;
          } catch {}
        }

        // Sleeper's start_time is unix ms. Treat 0 / missing as "not set".
        const rawStart = typeof d.start_time === "number" ? d.start_time : null;
        const startTime = rawStart && rawStart > 0 ? rawStart : null;
        const draftOrderSet = !!d.draft_order && Object.keys(d.draft_order).length > 0;
        const category = inferDraftCategory(d, leagueIsDynasty);

        results.push({
          leagueId: lg.league_id,
          leagueName: lg.name,
          leagueAvatar: (lg as any).avatar ?? null,
          draftId: d.draft_id,
          status,
          type: d.type || "snake",
          draftCategory: category,
          season: d.season,
          rounds,
          teams,
          picksMade,
          totalPicks: rounds * teams,
          startTime,
          draftOrderSet,
        });
      }
    } catch {}
  });

  await Promise.all(checks);
  return results;
}

export async function fetchDraftBoard(leagueId: string, specificDraftId?: string) {
  let draft: any;
  let draftId: string;

  if (specificDraftId) {
    // Load the specific draft directly — avoids picking the wrong draft
    // when a league has multiple drafts (e.g. startup + rookie).
    draft = await fetchJson<any>(`${SLEEPER_API}/draft/${specificDraftId}`);
    if (!draft) {
      return {
        draft: null, picks: [],
        players: {} as Record<string, { name: string; pos: string; team: string }>,
        draftSlots: [] as { slot: number; rosterId: number; displayName: string; avatar: string | null }[],
        pickOwners: [] as Array<{
          round: number; slot: number; originalRosterId: number; currentRosterId: number;
          isTraded: boolean; currentUserId: string | null; currentDisplayName: string;
          currentAvatar: string | null; originalDisplayName: string; originalAvatar: string | null;
        }>,
        error: "Draft not found",
      };
    }
    draftId = specificDraftId;
  } else {
    const draftsRaw = await fetchJson<any[]>(
      `${SLEEPER_API}/league/${leagueId}/drafts`
    );
    if (!draftsRaw || draftsRaw.length === 0) {
      return {
        draft: null, picks: [],
        players: {} as Record<string, { name: string; pos: string; team: string }>,
        draftSlots: [] as { slot: number; rosterId: number; displayName: string; avatar: string | null }[],
        pickOwners: [] as Array<{
          round: number; slot: number; originalRosterId: number; currentRosterId: number;
          isTraded: boolean; currentUserId: string | null; currentDisplayName: string;
          currentAvatar: string | null; originalDisplayName: string; originalAvatar: string | null;
        }>,
        error: "No drafts found for this league",
      };
    }
    draft = draftsRaw[0];
    draftId = draft.draft_id;
  }

  // Also fetch league rosters — `draft.draft_order` is empty pre-draft and
  // sometimes incomplete on freshly created live drafts, so we fall back
  // to roster ownership to resolve every slot to a real Sleeper user.
  //
  // traded_picks is the source of truth for "who currently owns pick X.Y"
  // before the pick has been made. Without it the board defaults every
  // upcoming pick to the original slot, which is wrong any time a pick
  // has changed hands. After the pick is made Sleeper records the actual
  // picker on the pick record itself, so traded_picks only matters for
  // unmade picks; we still surface it for both cases so the UI can flag
  // traded picks with a "via [Original]" indicator.
  const [picksRaw, playersDb, leagueUsers, leagueRosters, tradedPicksRaw] = await Promise.all([
    fetchJson<any[]>(`${SLEEPER_API}/draft/${draftId}/picks`),
    getSleeperPlayers(),
    fetchJson<SleeperLeagueUserRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/users`
    ).catch(() => [] as SleeperLeagueUserRaw[]),
    fetchJson<SleeperRosterRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/rosters`
    ).catch(() => [] as SleeperRosterRaw[]),
    fetchJson<SleeperTradedPickRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/traded_picks`
    ).catch(() => [] as SleeperTradedPickRaw[]),
  ]);

  // Username priority for slot display:
  //   1. username (Sleeper handle — the canonical identity)
  //   2. display_name (user-set display name)
  //   3. metadata.team_name (chosen team name, e.g. "Mak's Tigers")
  //   4. user_id as last resort
  // "Team N" is reserved for slots where no user data exists at all.
  // Avatar map carries the Sleeper avatar HASH (not a URL); consumers prefix
  // with `https://sleepercdn.com/avatars/thumbs/{hash}` when rendering.
  const userNameMap = new Map<string, string>();
  const userAvatarMap = new Map<string, string | null>();
  for (const u of leagueUsers || []) {
    userNameMap.set(
      u.user_id,
      u.username || u.display_name || u.metadata?.team_name || u.user_id
    );
    userAvatarMap.set(u.user_id, u.avatar ?? null);
  }

  const slotToRosterId: Record<number, number> =
    draft.slot_to_roster_id || {};
  const draftOrder: Record<string, number> = draft.draft_order || {};

  // Two independent ways to learn "who owns this roster slot":
  //   A) draft.draft_order maps user → draft slot (set once order is drawn).
  //   B) league rosters carry owner_id directly (always populated for any
  //      rostered league — including pre-draft startups).
  // We compose both: try (A) first, fall back to (B). The merge guarantees
  // a username for every slot as long as ANY of the two has data.
  const rosterIdToUserId = new Map<number, string>();
  // Pass B (lower priority): rosters → owner. Set first so A can override.
  for (const r of leagueRosters || []) {
    if (r.roster_id != null && r.owner_id) {
      rosterIdToUserId.set(r.roster_id, r.owner_id);
    }
  }
  // Pass A (higher priority): draft_order → slot → rosterId → user.
  for (const [uId, slot] of Object.entries(draftOrder)) {
    const rosterId = slotToRosterId[slot as any];
    if (rosterId) rosterIdToUserId.set(rosterId, uId);
  }

  const numTeams =
    draft.settings?.teams || Object.keys(slotToRosterId).length || (leagueRosters?.length ?? 12);
  const rounds = draft.settings?.rounds || 4;

  const draftSlots: { slot: number; rosterId: number; displayName: string; avatar: string | null }[] =
    [];
  for (let s = 1; s <= numTeams; s++) {
    const rosterId = slotToRosterId[s] || s;
    const uId = rosterIdToUserId.get(rosterId);
    const displayName = uId
      ? userNameMap.get(uId) || `Team ${s}`
      : `Team ${s}`;
    const avatar = uId ? userAvatarMap.get(uId) ?? null : null;
    draftSlots.push({ slot: s, rosterId, displayName, avatar });
  }

  // ── Per-(round, slot) current pick ownership ────────────────────────────
  // Sleeper returns `traded_picks` as a flat list of ALL pick transactions
  // for a season. Each entry is keyed by (season, round, roster_id) where
  // roster_id is the ORIGINAL owner. We walk the list in order and the
  // last entry for any (round, original) tuple wins, mirroring Sleeper's
  // own resolution logic.
  const draftSeason = String(draft.season ?? "");
  const currentOwnerByRoundOriginal = new Map<string, number>();
  for (const tp of tradedPicksRaw || []) {
    if (String(tp.season) !== draftSeason) continue;
    currentOwnerByRoundOriginal.set(`${tp.round}-${tp.roster_id}`, tp.owner_id);
  }

  const slotResolved = (rosterId: number) => {
    const uId = rosterIdToUserId.get(rosterId);
    return {
      displayName: uId ? userNameMap.get(uId) || `Roster ${rosterId}` : `Roster ${rosterId}`,
      avatar: uId ? userAvatarMap.get(uId) ?? null : null,
      userId: uId ?? null,
    };
  };

  const pickOwners: Array<{
    round: number;
    slot: number;
    originalRosterId: number;
    currentRosterId: number;
    isTraded: boolean;
    currentUserId: string | null;
    currentDisplayName: string;
    currentAvatar: string | null;
    originalDisplayName: string;
    originalAvatar: string | null;
  }> = [];
  for (let r = 1; r <= rounds; r++) {
    for (let s = 1; s <= numTeams; s++) {
      const originalRosterId = slotToRosterId[s] || s;
      const traded = currentOwnerByRoundOriginal.get(`${r}-${originalRosterId}`);
      const currentRosterId = traded ?? originalRosterId;
      const cur = slotResolved(currentRosterId);
      const orig = slotResolved(originalRosterId);
      pickOwners.push({
        round: r,
        slot: s,
        originalRosterId,
        currentRosterId,
        isTraded: currentRosterId !== originalRosterId,
        currentUserId: cur.userId,
        currentDisplayName: cur.displayName,
        currentAvatar: cur.avatar,
        originalDisplayName: orig.displayName,
        originalAvatar: orig.avatar,
      });
    }
  }

  // ── Generic timestamp extractor ──────────────────────────────────────────
  // Checks every known and speculative timestamp field on a pick object.
  // Returns the first valid millisecond-epoch number, or null.
  function getPickTimestamp(p: any): number | null {
    const candidates: any[] = [
      p.picked_at,
      p.created_at,
      p.updated_at,
      p.timestamp,
      p.draft_time,
      p.clock,
      p.time,
      p.metadata?.picked_at,
      p.metadata?.timestamp,
      p.metadata?.created_at,
      p.metadata?.updated_at,
      p.metadata?.clock,
      p.metadata?.time,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      if (typeof c === "number" && c > 1_000_000_000_000) return c; // ms epoch
      if (typeof c === "number" && c > 1_000_000_000) return c * 1000; // s epoch → ms
      if (typeof c === "string") {
        const n = Number(c);
        if (!isNaN(n) && n > 1_000_000_000_000) return n;
        if (!isNaN(n) && n > 1_000_000_000) return n * 1000;
        const d = Date.parse(c);
        if (!isNaN(d)) return d;
      }
    }
    return null;
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
    pickedAt: getPickTimestamp(p),
    // is_autopick (with k) is the most-reported community field — checked first.
    // Falls back through other variants Sleeper has used historically.
    isAutoPick: !!(
      p.metadata?.is_autopick ||
      p.is_autopick ||
      p.metadata?.is_auto ||
      p.is_auto ||
      p.picked_by_auto ||
      p.auto_pick ||
      p.metadata?.auto
    ),
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

  // Detect draft category: use explicit metadata.type first, then fall back to rounds rule
  // Rounds ≤ 6 → rookie draft; Rounds > 6 → startup draft
  let draftCategory = draft.metadata?.type || "";
  if (!draftCategory || draftCategory === "snake" || draftCategory === "linear") {
    if (rounds <= 6) {
      draftCategory = "rookie";
    } else {
      draftCategory = "startup";
    }
  }

  // Sleeper's pick timer is in seconds. We surface it here so the live
  // draft room can compute a real MM:SS countdown without re-fetching.
  const pickTimerSeconds = typeof draft.settings?.pick_timer === "number"
    ? draft.settings.pick_timer
    : 0;
  const lastPickedMs = (() => {
    const v = draft.last_picked;
    if (typeof v !== "number") return null;
    return v > 1_000_000_000_000 ? v : v > 1_000_000_000 ? v * 1000 : null;
  })();

  return {
    draft: {
      draftId,
      status: draft.status,
      type: draft.type,
      draftCategory,
      rounds,
      teams: numTeams,
      season: draft.season,
      leagueName: draft.metadata?.name || "",
      startTime: typeof draft.start_time === "number" ? draft.start_time : null,
      pickTimer: pickTimerSeconds,
      lastPicked: lastPickedMs,
    },
    picks,
    players: playerMap,
    draftSlots,
    // Per-(round, slot) current owner with traded-pick metadata. The
    // consumer keys by `${round}-${slot}` to resolve "who currently owns
    // pick X.Y" even when picks have been traded away from their
    // original slot owner.
    pickOwners,
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
    return lg.settings?.type === 2;
  });

  if (leagues.length === 0) return { trades: [], leaguesScanned: 0 };

  const playersDb = await getSleeperPlayers();
  const results: CrossLeagueTradeResult[] = [];
  let scanned = 0;

  for (const lg of leagues.slice(0, 25)) {
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
    for (let week = 0; week <= 21; week++) {
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
          const isStartup = pick.round > 5;
          const label = isStartup
            ? `${pick.season} Startup R${pick.round}`
            : `${pick.season} Round ${pick.round}`;
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
  const [leagueRaw, rostersRaw, usersRaw, draftsRaw] = await Promise.all([
    fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
    fetchJson<SleeperRosterRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/rosters`
    ),
    fetchJson<SleeperLeagueUserRaw[]>(
      `${SLEEPER_API}/league/${leagueId}/users`
    ),
    fetchJson<any[]>(`${SLEEPER_API}/league/${leagueId}/drafts`).catch(() => [] as any[]),
  ]);

  // Build roster-id → 2026 draft slot map
  const rosterIdToSlot2026 = new Map<number, number>();
  if (draftsRaw && Array.isArray(draftsRaw)) {
    const draft2026 = draftsRaw.find((d: any) => d.season === "2026");
    if (draft2026) {
      const slotToRoster: Record<string, number> = draft2026.slot_to_roster_id || {};
      if (Object.keys(slotToRoster).length > 0) {
        for (const [slotStr, rosterId] of Object.entries(slotToRoster)) {
          rosterIdToSlot2026.set(rosterId as number, parseInt(slotStr, 10));
        }
      } else {
        const draftOrder: Record<string, number> = draft2026.draft_order || {};
        const rosterIdToOwner2026 = new Map<number, string>();
        for (const r of rostersRaw) {
          if (r.owner_id) rosterIdToOwner2026.set(r.roster_id, r.owner_id);
        }
        for (const [userId, slot] of Object.entries(draftOrder)) {
          const rid = [...rosterIdToOwner2026.entries()].find(([, uid]) => uid === userId)?.[0];
          if (rid !== undefined) rosterIdToSlot2026.set(rid, slot as number);
        }
      }
    }
  }

  const rosterOwnerMap = new Map<number, string>();
  const ownerNameMap = new Map<string, string>();
  const ownerAvatarMap = new Map<string, string | null>();
  for (const u of usersRaw) {
    ownerNameMap.set(
      u.user_id,
      u.metadata?.team_name || u.display_name || u.user_id
    );
    ownerAvatarMap.set(
      u.user_id,
      u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null
    );
  }
  const rosterAvatarMap = new Map<number, string | null>();
  for (const r of rostersRaw) {
    rosterOwnerMap.set(
      r.roster_id,
      ownerNameMap.get(r.owner_id) || `Team ${r.roster_id}`
    );
    rosterAvatarMap.set(
      r.roster_id,
      ownerAvatarMap.get(r.owner_id) ?? null
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
        originalRosterId?: number;
        pickSlot?: number;
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
          const pickSlot =
            dp.season === "2026" ? rosterIdToSlot2026.get(dp.roster_id) : undefined;
          draftPicks.push({
            season: dp.season,
            round: dp.round,
            fromTeam:
              rosterOwnerMap.get(dp.previous_owner_id) ||
              `Team ${dp.previous_owner_id}`,
            toTeam:
              rosterOwnerMap.get(dp.owner_id) || `Team ${dp.owner_id}`,
            originalRosterId: dp.roster_id,
            pickSlot,
          });
        }
      }

      const rosterIds = new Set<number>();
      if (t.roster_ids)
        t.roster_ids.forEach((r: number) => rosterIds.add(r));
      const involvedTeams = [...rosterIds].map((rid) => ({
        rosterId: rid,
        teamName: rosterOwnerMap.get(rid) || `Team ${rid}`,
        avatar: rosterAvatarMap.get(rid) ?? null,
      }));

      return { type, timestamp, week, adds, drops, draftPicks, involvedTeams };
    });

  const pendingFormatted = allTransactions
    .filter((t: any) => t.status === "pending" && t.type === "trade")
    .map((t: any) => {
      const pAdds: Array<{ playerId: string; name: string; pos: string; team: string; rosterId: number; teamName: string }> = [];
      const pDrops: Array<{ playerId: string; name: string; pos: string; team: string; rosterId: number; teamName: string }> = [];
      const pPicks: Array<{ season: string; round: number; fromTeam: string; toTeam: string; originalRosterId?: number; pickSlot?: number }> = [];
      if (t.adds) {
        for (const [pid, rid] of Object.entries(t.adds)) {
          const p = players[pid];
          pAdds.push({ playerId: pid, name: p?.full_name || pid, pos: p?.position || "?", team: p?.team || "FA", rosterId: rid as number, teamName: rosterOwnerMap.get(rid as number) || `Team ${rid}` });
        }
      }
      if (t.drops) {
        for (const [pid, rid] of Object.entries(t.drops)) {
          const p = players[pid];
          pDrops.push({ playerId: pid, name: p?.full_name || pid, pos: p?.position || "?", team: p?.team || "FA", rosterId: rid as number, teamName: rosterOwnerMap.get(rid as number) || `Team ${rid}` });
        }
      }
      if (t.draft_picks && Array.isArray(t.draft_picks)) {
        for (const dp of t.draft_picks) {
          const pickSlot = dp.season === "2026" ? rosterIdToSlot2026.get(dp.roster_id) : undefined;
          pPicks.push({ season: dp.season, round: dp.round, fromTeam: rosterOwnerMap.get(dp.previous_owner_id) || `Team ${dp.previous_owner_id}`, toTeam: rosterOwnerMap.get(dp.owner_id) || `Team ${dp.owner_id}`, originalRosterId: dp.roster_id, pickSlot });
        }
      }
      const pRosterIds = new Set<number>();
      if (t.roster_ids) t.roster_ids.forEach((r: number) => pRosterIds.add(r));
      const pInvolvedTeams = [...pRosterIds].map((rid) => ({ rosterId: rid, teamName: rosterOwnerMap.get(rid) || `Team ${rid}`, avatar: rosterAvatarMap.get(rid) ?? null }));
      const waiverBudget: Array<{ senderId: number; receiverId: number; amount: number }> =
        (t.waiver_budget || []).map((wb: any) => ({ senderId: wb.sender, receiverId: wb.receiver, amount: wb.amount }));
      return {
        transactionId: t.transaction_id as string,
        leg: (t.leg as number) || 1,
        status: t.status as string,
        creator: (t.creator as string) || "",
        consenterIds: (t.consenter_ids || []) as number[],
        waiverBudget,
        week: t.week as number,
        created: (t.created as number) || 0,
        adds: pAdds,
        drops: pDrops,
        draftPicks: pPicks,
        involvedTeams: pInvolvedTeams,
      };
    });

  return {
    transactions: formatted,
    pendingTrades: pendingFormatted,
    leagueName: leagueRaw.name,
    totalRosters: leagueRaw.total_rosters,
  };
}

export async function fetchLeaguePlayerSettings(
  leagueId: string,
  jwt: string
): Promise<Array<{ league_id: string; metadata: any; player_id: string; settings: any }>> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": jwt,
      "x-sleeper-graphql-op": "league_players",
    },
    body: JSON.stringify({
      query: `query league_players {
        league_players(league_id: "${leagueId}") {
          league_id
          metadata
          player_id
          settings
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "league_players failed");
  return json?.data?.league_players ?? [];
}

// ── roster_draft_picks ────────────────────────────────────────────────────────

export const ROSTER_DRAFT_PICKS_QUERY = `
  query roster_draft_picks($league_id: ID!) {
    roster_draft_picks(league_id: $league_id) {
      roster_id
      season
      round
      owner_id
    }
  }
`;

/** Raw shape returned by the Sleeper roster_draft_picks GraphQL operation. */
export interface SleeperRosterDraftPick {
  /** Original roster the pick was created for. */
  roster_id: number;
  /** Roster that currently owns (holds) this pick. */
  owner_id: number;
  season: string;
  round: number;
}

/** App-normalised pick asset, ready for UI and trade calculator consumption. */
export interface NormalizedDraftPick {
  leagueId: string;
  /** Roster that currently owns the pick. */
  currentRosterId: number;
  /** Original roster the pick came from. */
  originalRosterId: number;
  season: string;
  round: number;
  /** Human-readable label, e.g. "2026 Round 2 (from Roster 10)" */
  label: string;
}

export function normalizeRosterDraftPicks(
  leagueId: string,
  picks: SleeperRosterDraftPick[]
): NormalizedDraftPick[] {
  return picks.map((p) => ({
    leagueId,
    currentRosterId: p.owner_id,    // owner_id = current holder of the pick
    originalRosterId: p.roster_id,  // roster_id = original team the pick belongs to
    season: p.season,
    round: p.round,
    label: p.roster_id === p.owner_id
      ? `${p.season} Round ${p.round}`
      : `${p.season} Round ${p.round} (from Roster ${p.roster_id})`,
  }));
}

export async function fetchRosterDraftPicks(
  leagueId: string,
  jwt: string
): Promise<SleeperRosterDraftPick[]> {
  const data = await sleeperGraphql<{ roster_draft_picks: SleeperRosterDraftPick[] }>(jwt, {
    operationName: "roster_draft_picks",
    variables: { league_id: leagueId },
    query: ROSTER_DRAFT_PICKS_QUERY,
  });
  return data.roster_draft_picks ?? [];
}

// ── Operation registry ────────────────────────────────────────────────────────
// Central reference for all authenticated Sleeper GraphQL operations.

export const SleeperOperations = {
  rosterDraftPicks: {
    key: "rosterDraftPicks",
    operationName: "roster_draft_picks",
    category: "league_assets",
    authRequired: true,
    writeAction: false,
    priority: "high" as const,
  },
  getDraft: {
    key: "getDraft",
    operationName: "get_draft",
    category: "live_draft",
    authRequired: true,
    writeAction: false,
    priority: "high" as const,
  },
  getUserDraftSettings: {
    key: "getUserDraftSettings",
    operationName: "get_user_draft_settings",
    category: "live_draft",
    authRequired: true,
    writeAction: false,
    priority: "low" as const,
  },
  draftQueue: {
    key: "draftQueue",
    operationName: "draft_queue",
    category: "draft_room",
    authRequired: true,
    writeAction: false,
    priority: "medium" as const,
  },
  draftAutopickers: {
    key: "draftAutopickers",
    operationName: "draft_autopickers",
    category: "draft_room",
    authRequired: true,
    writeAction: false,
    priority: "medium" as const,
  },
  updateDraftQueue: {
    key: "updateDraftQueue",
    operationName: "update_draft_queue",
    category: "draft_room",
    authRequired: true,
    writeAction: true,
    priority: "high" as const,
  },
  updateReserve: {
    key: "updateReserve",
    operationName: "roster_update_reserve",
    category: "roster_management",
    authRequired: true,
    writeAction: true,
    priority: "high" as const,
  },
} as const;

export async function rejectTradeOnSleeper(
  leagueId: string,
  transactionId: string,
  leg: number,
  jwt: string
): Promise<any> {
  showFeatureDisabled();
  throw new FeatureDisabledError();
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": jwt,
      "x-sleeper-graphql-op": "reject_trade",
    },
    body: JSON.stringify({
      query: `mutation reject_trade {
        reject_trade(
          league_id: "${leagueId}",
          transaction_id: "${transactionId}",
          leg: ${leg}
        ) {
          adds consenter_ids created creator drops league_id leg
          metadata roster_ids settings status status_updated
          transaction_id type player_map
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Reject trade failed");
  return json?.data?.reject_trade;
}

export async function acceptTradeOnSleeper(
  leagueId: string,
  transactionId: string,
  leg: number,
  jwt: string
): Promise<any> {
  showFeatureDisabled();
  throw new FeatureDisabledError();
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": jwt,
      "x-sleeper-graphql-op": "accept_trade",
    },
    body: JSON.stringify({
      query: `mutation accept_trade {
        accept_trade(
          league_id: "${leagueId}",
          transaction_id: "${transactionId}",
          leg: ${leg}
        ) {
          adds consenter_ids created creator draft_picks drops
          league_id leg metadata roster_ids settings status
          status_updated transaction_id type player_map waiver_budget
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Accept trade failed");
  return json?.data?.accept_trade;
}

export async function sleeperLogin(login: string, password: string): Promise<string> {
  const res = await fetch(`${SLEEPER_API}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password");
  const data = await res.json();
  if (!data.token) throw new Error("Authentication failed. No token returned.");
  return data.token as string;
}

export async function proposeTrade(
  leagueId: string,
  jwt: string,
  args: {
    kAdds: string[];
    vAdds: number[];
    kDrops: string[];
    vDrops: number[];
    draftPicks: Array<{ season: string; round: number; roster_id: number; owner_id: number; previous_owner_id: number }>;
    waiverBudget: Array<{ sender: number; receiver: number; amount: number }>;
    expiresAt: number;
  }
): Promise<any> {
  const { kAdds, vAdds, kDrops, vDrops, draftPicks, waiverBudget, expiresAt } = args;
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": jwt,
      "x-sleeper-graphql-op": "propose_trade",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation propose_trade(
        $k_adds: [String],
        $v_adds: [Int],
        $k_drops: [String],
        $v_drops: [Int]
      ) {
        propose_trade(
          league_id: "${leagueId}",
          draft_picks: ${JSON.stringify(draftPicks)},
          k_adds: $k_adds,
          v_adds: $v_adds,
          k_drops: $k_drops,
          v_drops: $v_drops,
          waiver_budget: ${JSON.stringify(waiverBudget)},
          expires_at: ${expiresAt}
        ) {
          adds consenter_ids created creator drops league_id leg metadata
          roster_ids settings status status_updated transaction_id draft_picks
          type player_map waiver_budget
        }
      }`,
      variables: { k_adds: kAdds, v_adds: vAdds, k_drops: kDrops, v_drops: vDrops },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Propose trade failed");
  return json?.data?.propose_trade;
}

export async function fetchMyDMs(jwt: string): Promise<{
  my_dms: any[];
  dm_single_inbound: any[];
  dm_group_inbound: any[];
}> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "authorization": jwt, "x-sleeper-graphql-op": "my_dms", "content-type": "application/json" },
    body: JSON.stringify({
      query: `query my_dms {
        my_dms(unread: false, limit: 1000) {
          dm_id dm_type hidden_at last_author_avatar last_author_display_name
          last_author_real_name last_author_id last_message_attachment
          last_message_id last_message_text last_message_text_map last_message_time
          last_pinned_message_id last_read_id member_can_invite recent_users title
        }
        dm_single_inbound: inbound_requests(request_type: "dm_single") {
          created request_type requestee_display_name requestee_id requestee_avatar
          requester_display_name requester_id requester_avatar type_description
          type_id type_metadata type_name
        }
        dm_group_inbound: inbound_requests(request_type: "dm_group") {
          created request_type requestee_display_name requestee_id requestee_avatar
          requester_display_name requester_id requester_avatar type_description
          type_id type_metadata type_name
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Fetch DMs failed");
  return {
    my_dms: json?.data?.my_dms ?? [],
    dm_single_inbound: json?.data?.dm_single_inbound ?? [],
    dm_group_inbound: json?.data?.dm_group_inbound ?? [],
  };
}

// ── DM message type ──────────────────────────────────────────────────────────
// State callers should persist per-thread:
//   dm_id, last_message_id, last_read_id, recent_users, last_message_time
// Unread: messages whose message_id > last_read_id (string compare by Sleeper convention)
export interface DmMessage {
  message_id: string;
  author_id: string;
  created: number;
  message: string | null;
  parent_id: string;
  /** Rich text rendering — mention/emoji map keyed by offset */
  text_map: any | null;
  /** Trade cards, images, etc. — attachment_type + attachment data */
  attachment: any | null;
}

/**
 * Fetch the latest messages in a DM thread (no cursor — newest page).
 * Results are returned in ascending (chronological) order.
 */
export async function fetchLatestMessages(dmId: string, jwt: string): Promise<DmMessage[]> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "authorization": jwt, "x-sleeper-graphql-op": "messages", "content-type": "application/json" },
    body: JSON.stringify({
      query: `query messages {
        messages(parent_id: "${dmId}", order_by: "asc") {
          message_id author_id created message parent_id text_map attachment
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Fetch messages failed");
  return json?.data?.messages ?? [];
}

/**
 * Fetch messages older than beforeMessageId — use the earliest loaded
 * message_id as the cursor. Prepend results to the existing list for
 * infinite-scroll chat history. Results returned in ascending order.
 */
export async function fetchOlderMessages(
  dmId: string,
  beforeMessageId: string,
  jwt: string
): Promise<DmMessage[]> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "authorization": jwt, "x-sleeper-graphql-op": "messages", "content-type": "application/json" },
    body: JSON.stringify({
      query: `query messages {
        messages(parent_id: "${dmId}", before: "${beforeMessageId}", order_by: "asc") {
          message_id author_id created message parent_id text_map attachment
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Fetch older messages failed");
  return json?.data?.messages ?? [];
}

export async function getDmByMembers(partnerUserId: string, jwt: string): Promise<any> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "authorization": jwt, "x-sleeper-graphql-op": "get_dm_by_members", "content-type": "application/json" },
    body: JSON.stringify({
      query: `query get_dm_by_members {
        get_dm_by_members(members: ["${partnerUserId}"]) {
          dm_id dm_type hidden_at last_author_avatar last_author_display_name
          last_author_real_name last_author_id last_message_id last_message_text
          last_message_text_map last_message_time last_pinned_message_id last_read_id
          member_can_invite recent_users title
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Get DM failed");
  return json?.data?.get_dm_by_members;
}

export async function sendDmMessage(
  dmId: string,
  message: string,
  jwt: string,
  opts?: {
    parent_type?: string;
    attachment_type?: string;
    k_attachment_data?: string[];
    v_attachment_data?: string[];
  }
): Promise<any> {
  const variables: Record<string, any> = { parent_id: dmId, message };
  if (opts?.parent_type) variables.parent_type = opts.parent_type;
  if (opts?.attachment_type) variables.attachment_type = opts.attachment_type;
  if (opts?.k_attachment_data) variables.k_attachment_data = opts.k_attachment_data;
  if (opts?.v_attachment_data) variables.v_attachment_data = opts.v_attachment_data;

  const hasAttachment = !!opts?.attachment_type;
  const query = hasAttachment
    ? `mutation create_message($parent_id: String, $parent_type: String, $message: String, $attachment_type: String, $k_attachment_data: [String], $v_attachment_data: [String]) {
        create_message(parent_id: $parent_id, parent_type: $parent_type, message: $message, attachment_type: $attachment_type, k_attachment_data: $k_attachment_data, v_attachment_data: $v_attachment_data) {
          message_id author_id created message parent_id
        }
      }`
    : `mutation create_message($parent_id: String, $message: String) {
        create_message(parent_id: $parent_id, message: $message) {
          message_id author_id created message parent_id
        }
      }`;

  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "authorization": jwt, "x-sleeper-graphql-op": "create_message", "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "Send message failed");
  return json?.data?.create_message;
}

export async function claimPlayerOnSleeper(
  leagueId: string,
  rosterId: number,
  addPlayerId: string,
  dropPlayerId: string | null,
  faabBid: number | null,
  waiverType: number,
  token: string
): Promise<void> {
  const isFaab = waiverType === 2;
  const body: any = {
    type: isFaab ? "waiver" : "free_agent",
    status: "complete",
    roster_ids: [rosterId],
    adds: { [addPlayerId]: rosterId },
    drops: dropPlayerId ? { [dropPlayerId]: rosterId } : {},
    draft_picks: [],
  };
  if (isFaab) {
    body.settings = { waiver_bid: faabBid ?? 0, seq: 1 };
  }
  const res = await fetch(`${SLEEPER_API}/league/${leagueId}/transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Transaction failed (${res.status})`);
  }
}

// ── DraftState — normalized from confirmed get_draft GraphQL endpoint ─────────
export interface DraftUser {
  userId: string;
  displayName: string;
  avatar: string | null;
  isBot: boolean;
}

export interface DraftPickNormalized {
  pickNo: number;
  playerId: string;
  /** userId of the manager who made this pick */
  pickedBy: string;
  isKeeper: boolean;
  playerName: string;
  position: string;
  teamAbbr: string;
}

export interface DraftState {
  draftId: string;
  leagueId: string;
  name: string;
  status: "pre_draft" | "drafting" | "complete";
  season: string;
  type: string;
  teams: number;
  rounds: number;
  /** seconds per pick; 0 = no timer */
  pickTimer: number;
  startTime: number | null;
  lastPicked: number | null;
  /** userId → 1-indexed slot number */
  draftOrderByUserId: Record<string, number>;
  /** Raw 1-indexed slot → roster_id from Sleeper. Empty when not yet set. */
  slotToRosterIdRaw: Record<number, number>;
  usersById: Record<string, DraftUser>;
  picks: DraftPickNormalized[];
  /** Fully resolved draft-order view. See sleeperDraftOrder.ts for fields.
   *  Use this for "who is on the clock", board headers, and pickNo→user
   *  lookups — it falls back through slot_to_roster_id + roster owners
   *  when draft_order isn't populated. */
  normalizedOrder: NormalizedDraftOrder;
}

/**
 * Fetch full draft state via confirmed Sleeper GraphQL endpoint.
 * Single round-trip: get_draft + user_drafts_by_draft + draft_picks.
 * Requires JWT (x-sleeper-graphql-op: get_draft).
 *
 * League rosters are fetched in parallel (REST) so the draft-order
 * normalizer can fall through `slot_to_roster_id → roster.owner_id` when
 * Sleeper hasn't populated `draft_order` (common pre-draft state).
 */
export async function fetchDraftState(draftId: string, jwt: string): Promise<DraftState> {
  const graphqlPromise = fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": jwt,
      "x-sleeper-graphql-op": "get_draft",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query get_draft {
        get_draft(sport: "nfl", draft_id: "${draftId}") {
          created draft_id draft_order slot_to_roster_id last_message_time last_message_id
          last_picked league_id metadata season season_type settings sport
          status start_time type
        }
        user_drafts_by_draft(draft_id: "${draftId}") {
          user_id user_display_name user_avatar user_is_bot metadata
        }
        draft_picks(draft_id: "${draftId}") {
          draft_id pick_no player_id picked_by is_keeper metadata reactions
        }
      }`,
    }),
  });

  const res = await graphqlPromise;
  if (!res.ok) throw new Error(`get_draft GraphQL ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || "get_draft failed");

  const raw = json?.data?.get_draft;
  const rawUsers: any[] = json?.data?.user_drafts_by_draft ?? [];
  const rawPicks: any[] = json?.data?.draft_picks ?? [];
  if (!raw) throw new Error("No draft data in response");

  const leagueId: string = raw.league_id;

  // Fetch league users + rosters so the normalizer can chain through
  // slot_to_roster_id → roster.owner_id when draft_order is empty.
  // Errors here aren't fatal — the normalizer degrades gracefully.
  const [leagueUsers, leagueRosters] = await Promise.all([
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`)
      .catch(() => [] as SleeperLeagueUserRaw[]),
    fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`)
      .catch(() => [] as SleeperRosterRaw[]),
  ]);

  const usersById: Record<string, DraftUser> = {};
  for (const u of rawUsers) {
    usersById[u.user_id] = {
      userId: u.user_id,
      displayName: u.user_display_name || u.user_id,
      avatar: u.user_avatar || null,
      isBot: !!u.user_is_bot,
    };
  }
  // Also enrich usersById with any league users that aren't in
  // user_drafts_by_draft (Sleeper sometimes lags). Without this, slot
  // owners resolved via slot_to_roster_id may render with no avatar.
  for (const u of leagueUsers || []) {
    if (!usersById[u.user_id]) {
      usersById[u.user_id] = {
        userId: u.user_id,
        displayName: u.username || u.display_name || u.user_id,
        avatar: u.avatar ?? null,
        isBot: false,
      };
    }
  }

  const draftOrderByUserId: Record<string, number> = raw.draft_order || {};
  const slotToRosterIdRaw: Record<number, number> = {};
  for (const [slotKey, rosterIdRaw] of Object.entries(raw.slot_to_roster_id ?? {})) {
    const slot = Number(slotKey);
    const rosterId = Number(rosterIdRaw);
    if (Number.isFinite(slot) && Number.isFinite(rosterId)) {
      slotToRosterIdRaw[slot] = rosterId;
    }
  }
  const settings = raw.settings || {};
  const teams = settings.teams || 12;
  const rounds = settings.rounds || 4;
  const pickTimer = settings.pick_timer || 0;

  const picks: DraftPickNormalized[] = [...rawPicks]
    .sort((a: any, b: any) => a.pick_no - b.pick_no)
    .map((p: any) => {
      const m = p.metadata || {};
      return {
        pickNo: p.pick_no,
        playerId: p.player_id || "",
        pickedBy: p.picked_by || "",
        isKeeper: !!p.is_keeper,
        playerName: m.player_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || p.player_id || "",
        position: m.position || "",
        teamAbbr: m.team || "",
      };
    });

  const status: DraftState["status"] =
    raw.status === "drafting" ? "drafting" :
    raw.status === "complete" ? "complete" : "pre_draft";

  const normalizedOrder = normalizeSleeperDraftOrder({
    draft: {
      type: raw.type,
      draft_order: raw.draft_order,
      slot_to_roster_id: raw.slot_to_roster_id,
      settings: raw.settings,
      metadata: raw.metadata,
    },
    leagueUsers: leagueUsers ?? [],
    leagueRosters: leagueRosters ?? [],
    picks: picks.map((p) => ({ pick_no: p.pickNo, picked_by: p.pickedBy })),
    rounds,
  });

  return {
    draftId: raw.draft_id,
    leagueId,
    name: raw.metadata?.name || `${raw.season} ${raw.type} Draft`,
    status,
    season: raw.season,
    type: raw.type || "snake",
    teams,
    rounds,
    pickTimer,
    startTime: raw.start_time || null,
    lastPicked: raw.last_picked || null,
    draftOrderByUserId,
    slotToRosterIdRaw,
    usersById,
    picks,
    normalizedOrder,
  };
}

// ── Generic Sleeper GraphQL helper ────────────────────────────────────────────
// All JWT-authenticated GraphQL calls (with variables) go through here.
// The x-sleeper-graphql-op header must match the operationName in the query.
export async function sleeperGraphql<T = any>(
  token: string,
  body: { operationName: string; variables?: Record<string, unknown>; query: string }
): Promise<T> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": token,
      "x-sleeper-graphql-op": body.operationName,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sleeper GraphQL ${body.operationName} ${res.status}`);
  const json = await res.json();
  if (json?.errors?.length) throw new Error(json.errors[0].message || `${body.operationName} failed`);
  return json?.data as T;
}

// ── get_user_draft_settings ───────────────────────────────────────────────────
export const GET_USER_DRAFT_SETTINGS_QUERY = `
  query get_user_draft_settings($draft_id: ID!) {
    get_user_draft_settings(draft_id: $draft_id) {
      draft_id
      allow_pn
      mention_pn
    }
  }
`;

export interface UserDraftSettings {
  draft_id: string;
  /** Whether push notifications are enabled for this draft */
  allow_pn: boolean;
  /** Whether @mention push notifications are enabled */
  mention_pn: boolean;
}

export async function getUserDraftSettings(
  token: string,
  draftId: string
): Promise<UserDraftSettings | null> {
  const data = await sleeperGraphql<{ get_user_draft_settings: UserDraftSettings | null }>(token, {
    operationName: "get_user_draft_settings",
    variables: { draft_id: draftId },
    query: GET_USER_DRAFT_SETTINGS_QUERY,
  });
  return data.get_user_draft_settings ?? null;
}

// ── draft_queue ───────────────────────────────────────────────────────────────

export const DRAFT_QUEUE_QUERY = `
  query draft_queue($draft_id: ID!) {
    draft_queue(draft_id: $draft_id)
  }
`;

export interface SleeperDraftQueueResponse {
  draft_queue: string[];
}

export interface DraftQueuePlayer {
  playerId: string;
  rank: number;
  name?: string;
  position?: string;
  team?: string;
}

/**
 * Enriches raw player-ID queue with player metadata from the Sleeper
 * player map (keyed by player_id).
 */
export function normalizeDraftQueue(
  queue: string[],
  playersById: Record<string, any>
): DraftQueuePlayer[] {
  return queue.map((playerId, index) => {
    const p = playersById[playerId];
    return {
      playerId,
      rank: index + 1,
      name: p?.full_name || (p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : undefined),
      position: p?.position,
      team: p?.team,
    };
  });
}

export async function getDraftQueue(token: string, draftId: string): Promise<string[]> {
  const data = await sleeperGraphql<SleeperDraftQueueResponse>(token, {
    operationName: "draft_queue",
    variables: { draft_id: draftId },
    query: DRAFT_QUEUE_QUERY,
  });
  return data.draft_queue ?? [];
}

// ── draft_autopickers ─────────────────────────────────────────────────────────

export const DRAFT_AUTOPICKERS_QUERY = `
  query draft_autopickers($draft_id: ID!) {
    draft_autopickers(sport: "nfl", draft_id: $draft_id)
  }
`;

export interface SleeperDraftAutopickersResponse {
  draft_autopickers: any[];
}

/**
 * Normalised autopicker entry. Shape of individual items is unknown when the
 * array is empty (captured example returned []). Raw is preserved for
 * forward compatibility once a populated example is captured.
 */
export interface DraftAutopickerStatus {
  raw: any;
  userId?: string;
  rosterId?: number;
  draftSlot?: number;
}

export function normalizeDraftAutopickers(rawAutopickers: any[]): DraftAutopickerStatus[] {
  return (rawAutopickers ?? []).map((item) => ({
    raw: item,
    userId: item?.user_id ?? item?.userId,
    rosterId: item?.roster_id ?? item?.rosterId,
    draftSlot: item?.draft_slot ?? item?.draftSlot ?? item?.slot,
  }));
}

export async function getDraftAutopickers(token: string, draftId: string): Promise<DraftAutopickerStatus[]> {
  const data = await sleeperGraphql<SleeperDraftAutopickersResponse>(token, {
    operationName: "draft_autopickers",
    variables: { draft_id: draftId },
    query: DRAFT_AUTOPICKERS_QUERY,
  });
  return normalizeDraftAutopickers(data.draft_autopickers ?? []);
}

// ── update_draft_queue ────────────────────────────────────────────────────────
// Sleeper update_draft_queue REPLACES the entire queue.
// Always send the full desired player_ids array, not just the changed player.

export const UPDATE_DRAFT_QUEUE_MUTATION = `
  mutation update_draft_queue($draft_id: ID!, $player_ids: [String!]!) {
    update_draft_queue(player_ids: $player_ids, draft_id: $draft_id)
  }
`;

export async function updateDraftQueue(
  token: string,
  draftId: string,
  playerIds: string[]
): Promise<string[]> {
  const data = await sleeperGraphql<{ update_draft_queue: string[] }>(token, {
    operationName: "update_draft_queue",
    variables: { draft_id: draftId, player_ids: playerIds },
    query: UPDATE_DRAFT_QUEUE_MUTATION,
  });
  return data.update_draft_queue ?? [];
}

// ── Queue action helpers ──────────────────────────────────────────────────────

export async function addPlayerToDraftQueue({
  token, draftId, currentQueue, playerId,
}: { token: string; draftId: string; currentQueue: string[]; playerId: string }): Promise<string[]> {
  if (currentQueue.includes(playerId)) return currentQueue;
  return updateDraftQueue(token, draftId, [...currentQueue, playerId]);
}

export async function removePlayerFromDraftQueue({
  token, draftId, currentQueue, playerId,
}: { token: string; draftId: string; currentQueue: string[]; playerId: string }): Promise<string[]> {
  return updateDraftQueue(token, draftId, currentQueue.filter((id) => id !== playerId));
}

export async function reorderDraftQueue({
  token, draftId, nextQueue,
}: { token: string; draftId: string; nextQueue: string[] }): Promise<string[]> {
  return updateDraftQueue(token, draftId, nextQueue);
}
