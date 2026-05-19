/**
 * Mock projection data for the Start/Sit Compare tab.
 *
 * Shape mirrors what a real backend feed would deliver so the UI components
 * (StartSitPlayerCard, ProjectionSourceRows, PlayerWeeklyProfileDrawer) and
 * useWeeklyPlayerProjections hook can stay unchanged when real sources are
 * wired in.
 */

export type ProjectionSourceName =
  | "StatChasers"
  | "Sleeper"
  | "FanDuel"
  | "DraftKings"
  | "CBS Sports";

export const PROJECTION_SOURCES: ProjectionSourceName[] = [
  "StatChasers",
  "Sleeper",
  "FanDuel",
  "DraftKings",
  "CBS Sports",
];

export interface ProjectionSource {
  source: ProjectionSourceName;
  projectedPoints: number | null;
  rank?: number;
  lastUpdated?: string;
}

export interface MockMatchup {
  opponent: string;
  opponentRankVsPos: number | null;
  impliedTeamTotal: number | null;
  gameEnvironment: string | null;
  weather: string | null;
  injuryStatus: string | null;
  gameTime: string | null;
}

export interface MockTrends {
  last3Games: (number | null)[];
  last5Games: (number | null)[];
  usageTrend: string | null;
  snapShareTrend: string | null;
  touchesTrend: string | null;
}

export interface MockPlayerWeekly {
  playerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  team: string;
  opponent: string;
  week: number;
  image?: string;
  projections: ProjectionSource[];
  matchup: MockMatchup;
  trends: MockTrends;
  roleStability?: "stable" | "mixed" | "volatile";
}

const NOW = "2025-09-12T14:00:00Z";

export const MOCK_START_SIT_PLAYERS: MockPlayerWeekly[] = [
  {
    playerId: "mock_8112",
    name: "Garrett Wilson",
    position: "WR",
    team: "NYJ",
    opponent: "BUF",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 15.8, rank: 12, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 14.9, rank: 14, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 15.2, rank: 13, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 16.1, rank: 11, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 14.6, rank: 15, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs BUF",
      opponentRankVsPos: 18,
      impliedTeamTotal: 21.5,
      gameEnvironment: "Dome / neutral",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [16.2, 13.4, 17.8],
      last5Games: [16.2, 13.4, 17.8, 12.1, 14.9],
      usageTrend: "Target leader, 28% target share",
      snapShareTrend: "91% snaps last 3",
      touchesTrend: "9.3 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_9509",
    name: "Zay Flowers",
    position: "WR",
    team: "BAL",
    opponent: "KC",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 13.4, rank: 22, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 12.9, rank: 24, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 13.0, rank: 23, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 13.8, rank: 21, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 12.7, rank: 25, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs KC",
      opponentRankVsPos: 9,
      impliedTeamTotal: 24.0,
      gameEnvironment: "Outdoor",
      weather: "72°F, light wind",
      injuryStatus: "Healthy",
      gameTime: "Thu 8:20 PM ET",
    },
    trends: {
      last3Games: [11.5, 14.2, 12.6],
      last5Games: [11.5, 14.2, 12.6, 15.3, 10.4],
      usageTrend: "Steady WR1 role",
      snapShareTrend: "86% snaps last 3",
      touchesTrend: "8.1 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_9485",
    name: "Rashee Rice",
    position: "WR",
    team: "KC",
    opponent: "BAL",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 14.5, rank: 18, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 13.7, rank: 19, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 14.0, rank: 18, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 15.2, rank: 16, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: null,             lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs BAL",
      opponentRankVsPos: 14,
      impliedTeamTotal: 26.5,
      gameEnvironment: "Outdoor",
      weather: "72°F, light wind",
      injuryStatus: "Questionable",
      gameTime: "Thu 8:20 PM ET",
    },
    trends: {
      last3Games: [13.8, 16.4, 12.0],
      last5Games: [13.8, 16.4, 12.0, 14.7, 11.2],
      usageTrend: "Slot dominant, growing red zone share",
      snapShareTrend: "78% snaps last 3",
      touchesTrend: "7.8 targets/g",
    },
    roleStability: "mixed",
  },
  {
    playerId: "mock_4046",
    name: "Patrick Mahomes",
    position: "QB",
    team: "KC",
    opponent: "BAL",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 22.4, rank: 3, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 21.6, rank: 4, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 22.1, rank: 3, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 23.0, rank: 2, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 21.2, rank: 4, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs BAL",
      opponentRankVsPos: 12,
      impliedTeamTotal: 26.5,
      gameEnvironment: "Outdoor",
      weather: "72°F, light wind",
      injuryStatus: "Healthy",
      gameTime: "Thu 8:20 PM ET",
    },
    trends: {
      last3Games: [24.1, 19.8, 26.2],
      last5Games: [24.1, 19.8, 26.2, 22.0, 18.6],
      usageTrend: "Elite usage, 38 attempts/g",
      snapShareTrend: "100% snaps",
      touchesTrend: "38 att/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_6786",
    name: "Josh Allen",
    position: "QB",
    team: "BUF",
    opponent: "NYJ",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 24.8, rank: 1, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 23.9, rank: 2, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 24.5, rank: 1, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 25.0, rank: 1, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 23.4, rank: 2, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ NYJ",
      opponentRankVsPos: 20,
      impliedTeamTotal: 25.5,
      gameEnvironment: "Outdoor",
      weather: "65°F, partly cloudy",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [27.5, 22.8, 26.0],
      last5Games: [27.5, 22.8, 26.0, 21.3, 25.4],
      usageTrend: "Rushing floor + elite passing volume",
      snapShareTrend: "100% snaps",
      touchesTrend: "34 att + 8 rush/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_10229",
    name: "Bijan Robinson",
    position: "RB",
    team: "ATL",
    opponent: "PIT",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 19.5, rank: 2, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 18.6, rank: 3, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 19.0, rank: 2, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 19.8, rank: 2, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 18.2, rank: 3, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs PIT",
      opponentRankVsPos: 22,
      impliedTeamTotal: 22.0,
      gameEnvironment: "Dome",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [21.0, 17.2, 22.4],
      last5Games: [21.0, 17.2, 22.4, 15.6, 19.8],
      usageTrend: "Bell-cow back, 22 touches/g",
      snapShareTrend: "82% snaps last 3",
      touchesTrend: "19 carries + 4 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_10230",
    name: "Jahmyr Gibbs",
    position: "RB",
    team: "DET",
    opponent: "GB",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 17.6, rank: 5, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 16.4, rank: 7, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 17.1, rank: 6, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 17.9, rank: 5, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 16.1, rank: 8, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ GB",
      opponentRankVsPos: 12,
      impliedTeamTotal: 24.5,
      gameEnvironment: "Outdoor",
      weather: "68°F, clear",
      injuryStatus: "Healthy",
      gameTime: "Sun 4:25 PM ET",
    },
    trends: {
      last3Games: [18.2, 14.4, 20.6],
      last5Games: [18.2, 14.4, 20.6, 16.0, 13.8],
      usageTrend: "Receiving back share + goal-line work",
      snapShareTrend: "62% snaps last 3",
      touchesTrend: "13 carries + 5 targets/g",
    },
    roleStability: "mixed",
  },
  {
    playerId: "mock_7553",
    name: "Justin Jefferson",
    position: "WR",
    team: "MIN",
    opponent: "CHI",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 18.2, rank: 2, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 17.4, rank: 3, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 18.0, rank: 2, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 18.6, rank: 1, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 17.2, rank: 3, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs CHI",
      opponentRankVsPos: 6,
      impliedTeamTotal: 22.0,
      gameEnvironment: "Dome",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [19.8, 16.4, 22.5],
      last5Games: [19.8, 16.4, 22.5, 14.2, 18.6],
      usageTrend: "Locked-in WR1, 30%+ target share",
      snapShareTrend: "94% snaps last 3",
      touchesTrend: "10.6 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_6794",
    name: "CeeDee Lamb",
    position: "WR",
    team: "DAL",
    opponent: "PHI",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 17.1, rank: 5, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 16.2, rank: 6, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 17.0, rank: 5, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 17.4, rank: 5, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 16.0, rank: 7, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs PHI",
      opponentRankVsPos: 11,
      impliedTeamTotal: 23.5,
      gameEnvironment: "Dome",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 8:20 PM ET",
    },
    trends: {
      last3Games: [18.4, 14.6, 19.2],
      last5Games: [18.4, 14.6, 19.2, 16.6, 15.0],
      usageTrend: "Heavy alpha usage, 12 tgts/g",
      snapShareTrend: "93% snaps last 3",
      touchesTrend: "11.6 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_9484",
    name: "Sam LaPorta",
    position: "TE",
    team: "DET",
    opponent: "GB",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 12.6, rank: 2, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 11.8, rank: 3, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 12.2, rank: 2, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 12.8, rank: 2, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 11.5, rank: 3, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ GB",
      opponentRankVsPos: 19,
      impliedTeamTotal: 24.5,
      gameEnvironment: "Outdoor",
      weather: "68°F, clear",
      injuryStatus: "Healthy",
      gameTime: "Sun 4:25 PM ET",
    },
    trends: {
      last3Games: [13.0, 10.6, 14.2],
      last5Games: [13.0, 10.6, 14.2, 8.4, 11.6],
      usageTrend: "Trusted red zone target",
      snapShareTrend: "78% snaps last 3",
      touchesTrend: "6.8 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_4866",
    name: "Travis Kelce",
    position: "TE",
    team: "KC",
    opponent: "BAL",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 11.4, rank: 4, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 10.8, rank: 5, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 11.0, rank: 4, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 11.6, rank: 4, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 10.4, rank: 5, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs BAL",
      opponentRankVsPos: 24,
      impliedTeamTotal: 26.5,
      gameEnvironment: "Outdoor",
      weather: "72°F, light wind",
      injuryStatus: "Healthy",
      gameTime: "Thu 8:20 PM ET",
    },
    trends: {
      last3Games: [12.2, 9.4, 13.0],
      last5Games: [12.2, 9.4, 13.0, 8.6, 10.6],
      usageTrend: "Veteran usage steady, lower air yards",
      snapShareTrend: "84% snaps last 3",
      touchesTrend: "7.0 targets/g",
    },
    roleStability: "mixed",
  },
  {
    playerId: "mock_5849",
    name: "Saquon Barkley",
    position: "RB",
    team: "PHI",
    opponent: "DAL",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 18.4, rank: 3, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 17.8, rank: 4, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 18.0, rank: 4, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 18.6, rank: 3, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 17.6, rank: 4, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ DAL",
      opponentRankVsPos: 16,
      impliedTeamTotal: 24.0,
      gameEnvironment: "Dome",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 8:20 PM ET",
    },
    trends: {
      last3Games: [20.4, 16.6, 19.0],
      last5Games: [20.4, 16.6, 19.0, 15.8, 17.4],
      usageTrend: "Workhorse, 21+ touches/g",
      snapShareTrend: "79% snaps last 3",
      touchesTrend: "18 car + 3 tgts/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_9221",
    name: "Puka Nacua",
    position: "WR",
    team: "LAR",
    opponent: "SEA",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 16.5, rank: 8, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 15.8, rank: 10, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 16.0, rank: 9, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 16.8, rank: 8, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 15.4, rank: 11, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs SEA",
      opponentRankVsPos: 13,
      impliedTeamTotal: 22.5,
      gameEnvironment: "Outdoor",
      weather: "70°F, clear",
      injuryStatus: "Healthy",
      gameTime: "Sun 4:05 PM ET",
    },
    trends: {
      last3Games: [17.4, 13.6, 18.4],
      last5Games: [17.4, 13.6, 18.4, 12.6, 16.8],
      usageTrend: "Heavy target hog, route runner",
      snapShareTrend: "92% snaps last 3",
      touchesTrend: "10.8 targets/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_11631",
    name: "Marvin Harrison Jr.",
    position: "WR",
    team: "ARI",
    opponent: "BUF",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 12.8, rank: 27, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 12.0, rank: 30, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 12.4, rank: 28, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 13.0, rank: 27, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 11.8, rank: 31, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ BUF",
      opponentRankVsPos: 8,
      impliedTeamTotal: 19.0,
      gameEnvironment: "Outdoor",
      weather: "65°F, partly cloudy",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [11.4, 14.2, 10.6],
      last5Games: [11.4, 14.2, 10.6, 12.8, 9.8],
      usageTrend: "Rookie WR1, snap share trending up",
      snapShareTrend: "88% snaps last 3",
      touchesTrend: "8.4 targets/g",
    },
    roleStability: "mixed",
  },
  {
    playerId: "mock_8138",
    name: "Breece Hall",
    position: "RB",
    team: "NYJ",
    opponent: "BUF",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 15.4, rank: 8, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 14.6, rank: 10, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 15.0, rank: 9, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 15.8, rank: 8, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 14.2, rank: 11, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs BUF",
      opponentRankVsPos: 14,
      impliedTeamTotal: 21.5,
      gameEnvironment: "Dome / neutral",
      weather: "—",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [17.2, 12.4, 15.8],
      last5Games: [17.2, 12.4, 15.8, 13.0, 14.6],
      usageTrend: "Lead back + pass-game role",
      snapShareTrend: "71% snaps last 3",
      touchesTrend: "15 car + 4 tgts/g",
    },
    roleStability: "stable",
  },
  {
    playerId: "mock_9492",
    name: "De'Von Achane",
    position: "RB",
    team: "MIA",
    opponent: "JAX",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 16.8, rank: 6, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 15.4, rank: 8, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 16.2, rank: 7, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 17.0, rank: 6, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: 15.0, rank: 9, lastUpdated: NOW },
    ],
    matchup: {
      opponent: "vs JAX",
      opponentRankVsPos: 25,
      impliedTeamTotal: 24.0,
      gameEnvironment: "Outdoor",
      weather: "84°F, humid",
      injuryStatus: "Healthy",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [19.8, 12.0, 18.6],
      last5Games: [19.8, 12.0, 18.6, 11.2, 15.4],
      usageTrend: "Explosive efficiency, mixed volume",
      snapShareTrend: "54% snaps last 3",
      touchesTrend: "12 car + 4 tgts/g",
    },
    roleStability: "volatile",
  },
  {
    playerId: "mock_9229",
    name: "Tank Dell",
    position: "WR",
    team: "HOU",
    opponent: "IND",
    week: 1,
    projections: [
      { source: "StatChasers", projectedPoints: 11.2, rank: 35, lastUpdated: NOW },
      { source: "Sleeper",     projectedPoints: 10.6, rank: 38, lastUpdated: NOW },
      { source: "FanDuel",     projectedPoints: 11.0, rank: 36, lastUpdated: NOW },
      { source: "DraftKings",  projectedPoints: 11.6, rank: 33, lastUpdated: NOW },
      { source: "CBS Sports",  projectedPoints: null,             lastUpdated: NOW },
    ],
    matchup: {
      opponent: "@ IND",
      opponentRankVsPos: 19,
      impliedTeamTotal: 23.0,
      gameEnvironment: "Dome",
      weather: "—",
      injuryStatus: "Questionable",
      gameTime: "Sun 1:00 PM ET",
    },
    trends: {
      last3Games: [10.2, 12.4, 9.6],
      last5Games: [10.2, 12.4, 9.6, 8.4, 13.2],
      usageTrend: "Big-play role, target share declining",
      snapShareTrend: "65% snaps last 3",
      touchesTrend: "6.4 targets/g",
    },
    roleStability: "mixed",
  },
];

/** Look up by id; returns undefined if not present. */
export function findMockPlayer(playerId: string): MockPlayerWeekly | undefined {
  return MOCK_START_SIT_PLAYERS.find((p) => p.playerId === playerId);
}
