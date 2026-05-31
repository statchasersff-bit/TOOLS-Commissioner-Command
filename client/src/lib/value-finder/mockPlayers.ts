// Sample player pool for the Value Finder.
//
// This is a self-contained dataset so the page is fully functional and
// demo-ready without a backend. It is intentionally shaped to exercise every
// tab (market gaps, production/usage buys, trend quadrants, contender/rebuilder
// fits). Swap `getValueFinderPlayers()` for a ValueModel-backed loader to wire
// real data — every consumer reads through that function.
//
// Conventions:
//  - *Share fields are fractions (0–1).
//  - redZone/goalLine/targets fields are raw counts.
//  - marketValueChange* / *Trend fields are percent changes for the window.
//  - Per-source values (fantasyCalc/ktc/custom/dynastyCommand) let the value
//    source filter actually change the comparison.

import type { ValueFinderPlayer } from "./types";

export const MOCK_VALUE_FINDER_PLAYERS: ValueFinderPlayer[] = [
  // ── QBs ─────────────────────────────────────────────────────────────────
  {
    playerId: "qb-jdaniels", playerName: "Jayden Daniels", position: "QB", team: "WAS", age: 24, season: 2025,
    fantasyCalcValue: 8200, ktcValue: 8050, customValue: 8400, dynastyCommandValue: 8300,
    projectedPoints: 360, pointsPerGame: 22.4, gamesPlayed: 16, fantasyPoints: 358, vor: 92,
    passAttempts: 530, dropbacks: 560, designedRushAttempts: 130, teamPassRate: 0.58, fantasyPointsPerGame: 22.4,
    marketValueChange7d: 1.5, marketValueChange30d: 4.2, marketValueChange90d: 9.0, productionTrend: 6.0, usageTrend: 5.5, roleTrend: 5.0, adpChange30d: -3,
    rosterRate: 99, startRate: 96, benchRate: 3, leagueExposure: 41,
  },
  {
    playerId: "qb-jallen", playerName: "Josh Allen", position: "QB", team: "BUF", age: 29, season: 2025,
    fantasyCalcValue: 7600, ktcValue: 7900, customValue: 7500, dynastyCommandValue: 7700,
    projectedPoints: 372, pointsPerGame: 24.1, gamesPlayed: 17, fantasyPoints: 410, vor: 110,
    passAttempts: 560, dropbacks: 600, designedRushAttempts: 95, teamPassRate: 0.6, fantasyPointsPerGame: 24.1,
    marketValueChange7d: -0.5, marketValueChange30d: -1.0, marketValueChange90d: -2.5, productionTrend: 3.0, usageTrend: 1.0, roleTrend: 0.5, adpChange30d: 1,
    rosterRate: 99, startRate: 97, benchRate: 2, leagueExposure: 38,
  },
  {
    playerId: "qb-cstroud", playerName: "C.J. Stroud", position: "QB", team: "HOU", age: 24, season: 2025,
    fantasyCalcValue: 6400, ktcValue: 6600, customValue: 6300, dynastyCommandValue: 6900,
    projectedPoints: 318, pointsPerGame: 19.6, gamesPlayed: 16, fantasyPoints: 314, vor: 58,
    passAttempts: 540, dropbacks: 575, designedRushAttempts: 35, teamPassRate: 0.61, fantasyPointsPerGame: 19.6,
    marketValueChange7d: -1.0, marketValueChange30d: -4.0, marketValueChange90d: -8.0, productionTrend: -2.0, usageTrend: 1.5, roleTrend: 1.0, adpChange30d: 4,
    rosterRate: 98, startRate: 88, benchRate: 10, leagueExposure: 33,
  },
  {
    playerId: "qb-bnix", playerName: "Bo Nix", position: "QB", team: "DEN", age: 25, season: 2025,
    fantasyCalcValue: 4200, ktcValue: 3900, customValue: 4400, dynastyCommandValue: 4800,
    projectedPoints: 300, pointsPerGame: 18.8, gamesPlayed: 16, fantasyPoints: 301, vor: 44,
    passAttempts: 510, dropbacks: 540, designedRushAttempts: 70, teamPassRate: 0.56, fantasyPointsPerGame: 18.8,
    marketValueChange7d: 2.0, marketValueChange30d: 6.5, marketValueChange90d: 14.0, productionTrend: 8.0, usageTrend: 7.0, roleTrend: 6.5, adpChange30d: -6,
    rosterRate: 92, startRate: 78, benchRate: 20, leagueExposure: 24,
  },
  {
    playerId: "qb-dprescott", playerName: "Dak Prescott", position: "QB", team: "DAL", age: 32, season: 2025,
    fantasyCalcValue: 2600, ktcValue: 2400, customValue: 2700, dynastyCommandValue: 3100,
    projectedPoints: 296, pointsPerGame: 19.3, gamesPlayed: 15, fantasyPoints: 290, vor: 40,
    passAttempts: 540, dropbacks: 560, designedRushAttempts: 25, teamPassRate: 0.62, fantasyPointsPerGame: 19.3,
    marketValueChange7d: -0.5, marketValueChange30d: -2.0, marketValueChange90d: -5.0, productionTrend: 1.0, usageTrend: 0.0, roleTrend: -0.5, adpChange30d: 2,
    rosterRate: 84, startRate: 70, benchRate: 28, leagueExposure: 17,
  },
  {
    playerId: "qb-arodgers", playerName: "Aaron Rodgers", position: "QB", team: "PIT", age: 41, season: 2025,
    fantasyCalcValue: 900, ktcValue: 850, customValue: 900, dynastyCommandValue: 650,
    projectedPoints: 250, pointsPerGame: 16.0, gamesPlayed: 15, fantasyPoints: 240, vor: 8,
    passAttempts: 500, dropbacks: 520, designedRushAttempts: 8, teamPassRate: 0.59, fantasyPointsPerGame: 16.0,
    marketValueChange7d: -2.0, marketValueChange30d: -6.0, marketValueChange90d: -15.0, productionTrend: -4.0, usageTrend: -3.0, roleTrend: -3.0, adpChange30d: 8,
    rosterRate: 55, startRate: 40, benchRate: 55, leagueExposure: 9,
  },

  // ── RBs ─────────────────────────────────────────────────────────────────
  {
    playerId: "rb-jgibbs", playerName: "Jahmyr Gibbs", position: "RB", team: "DET", age: 23, season: 2025,
    fantasyCalcValue: 7800, ktcValue: 8000, customValue: 7700, dynastyCommandValue: 8100,
    projectedPoints: 290, pointsPerGame: 19.5, gamesPlayed: 16, fantasyPoints: 312, vor: 88,
    snapShare: 0.62, rushAttemptShare: 0.58, targetShare: 0.14, opportunityShare: 0.66, routeShare: 0.55,
    redZoneTouches: 48, goalLineTouches: 14, targetsPerRouteRun: 0.18,
    marketValueChange7d: 1.0, marketValueChange30d: 3.0, marketValueChange90d: 6.0, productionTrend: 4.0, usageTrend: 3.5, roleTrend: 3.0, adpChange30d: -2,
    rosterRate: 99, startRate: 95, benchRate: 4, leagueExposure: 40,
  },
  {
    playerId: "rb-brobinson", playerName: "Bijan Robinson", position: "RB", team: "ATL", age: 24, season: 2025,
    fantasyCalcValue: 8000, ktcValue: 8200, customValue: 7900, dynastyCommandValue: 8000,
    projectedPoints: 300, pointsPerGame: 20.1, gamesPlayed: 17, fantasyPoints: 342, vor: 96,
    snapShare: 0.78, rushAttemptShare: 0.72, targetShare: 0.13, opportunityShare: 0.8, routeShare: 0.6,
    redZoneTouches: 58, goalLineTouches: 18, targetsPerRouteRun: 0.16,
    marketValueChange7d: 0.5, marketValueChange30d: 1.5, marketValueChange90d: 3.0, productionTrend: 3.0, usageTrend: 2.0, roleTrend: 2.0, adpChange30d: -1,
    rosterRate: 99, startRate: 96, benchRate: 3, leagueExposure: 42,
  },
  {
    playerId: "rb-jjacobs", playerName: "Josh Jacobs", position: "RB", team: "GB", age: 27, season: 2025,
    fantasyCalcValue: 4200, ktcValue: 4000, customValue: 4300, dynastyCommandValue: 5000,
    projectedPoints: 262, pointsPerGame: 17.5, gamesPlayed: 16, fantasyPoints: 280, vor: 60,
    snapShare: 0.7, rushAttemptShare: 0.68, targetShare: 0.1, opportunityShare: 0.72, routeShare: 0.5,
    redZoneTouches: 52, goalLineTouches: 20, targetsPerRouteRun: 0.12,
    marketValueChange7d: -0.5, marketValueChange30d: -1.5, marketValueChange90d: -3.0, productionTrend: 2.0, usageTrend: 1.0, roleTrend: 0.5, adpChange30d: 3,
    rosterRate: 95, startRate: 86, benchRate: 12, leagueExposure: 28,
  },
  {
    playerId: "rb-kwalker", playerName: "Kenneth Walker III", position: "RB", team: "SEA", age: 25, season: 2025,
    fantasyCalcValue: 3600, ktcValue: 3800, customValue: 3500, dynastyCommandValue: 3300,
    projectedPoints: 220, pointsPerGame: 15.7, gamesPlayed: 14, fantasyPoints: 220, vor: 38,
    snapShare: 0.55, rushAttemptShare: 0.52, targetShare: 0.09, opportunityShare: 0.58, routeShare: 0.4,
    redZoneTouches: 34, goalLineTouches: 10, targetsPerRouteRun: 0.11,
    marketValueChange7d: -1.5, marketValueChange30d: -4.0, marketValueChange90d: -7.0, productionTrend: -3.0, usageTrend: -2.5, roleTrend: -3.0, adpChange30d: 5,
    rosterRate: 90, startRate: 72, benchRate: 26, leagueExposure: 21,
  },
  {
    playerId: "rb-tbigsby", playerName: "Tank Bigsby", position: "RB", team: "JAX", age: 24, season: 2025,
    fantasyCalcValue: 1400, ktcValue: 1250, customValue: 1500, dynastyCommandValue: 2100,
    projectedPoints: 150, pointsPerGame: 11.5, gamesPlayed: 13, fantasyPoints: 150, vor: 14,
    snapShare: 0.42, rushAttemptShare: 0.46, targetShare: 0.06, opportunityShare: 0.48, routeShare: 0.28,
    redZoneTouches: 26, goalLineTouches: 12, targetsPerRouteRun: 0.08,
    marketValueChange7d: 2.5, marketValueChange30d: 8.0, marketValueChange90d: 16.0, productionTrend: 6.0, usageTrend: 9.0, roleTrend: 9.5, adpChange30d: -7,
    rosterRate: 62, startRate: 40, benchRate: 58, leagueExposure: 12,
  },
  {
    playerId: "rb-ekamara", playerName: "Alvin Kamara", position: "RB", team: "NO", age: 30, season: 2025,
    fantasyCalcValue: 1800, ktcValue: 1700, customValue: 1900, dynastyCommandValue: 1500,
    projectedPoints: 210, pointsPerGame: 15.0, gamesPlayed: 14, fantasyPoints: 210, vor: 30,
    snapShare: 0.66, rushAttemptShare: 0.5, targetShare: 0.16, opportunityShare: 0.62, routeShare: 0.6,
    redZoneTouches: 30, goalLineTouches: 8, targetsPerRouteRun: 0.18,
    marketValueChange7d: -1.0, marketValueChange30d: -3.0, marketValueChange90d: -9.0, productionTrend: -1.0, usageTrend: -1.5, roleTrend: -2.0, adpChange30d: 4,
    rosterRate: 80, startRate: 64, benchRate: 34, leagueExposure: 16,
  },
  {
    playerId: "rb-bhall", playerName: "Breece Hall", position: "RB", team: "NYJ", age: 24, season: 2025,
    fantasyCalcValue: 5200, ktcValue: 5400, customValue: 5100, dynastyCommandValue: 4700,
    projectedPoints: 240, pointsPerGame: 16.4, gamesPlayed: 16, fantasyPoints: 252, vor: 46,
    snapShare: 0.6, rushAttemptShare: 0.55, targetShare: 0.13, opportunityShare: 0.64, routeShare: 0.52,
    redZoneTouches: 32, goalLineTouches: 7, targetsPerRouteRun: 0.15,
    marketValueChange7d: -1.0, marketValueChange30d: -2.5, marketValueChange90d: -5.0, productionTrend: -0.5, usageTrend: -1.0, roleTrend: -1.5, adpChange30d: 2,
    rosterRate: 96, startRate: 84, benchRate: 14, leagueExposure: 27,
  },

  // ── WRs ─────────────────────────────────────────────────────────────────
  {
    playerId: "wr-jchase", playerName: "Ja'Marr Chase", position: "WR", team: "CIN", age: 25, season: 2025,
    fantasyCalcValue: 9500, ktcValue: 9600, customValue: 9400, dynastyCommandValue: 9500,
    projectedPoints: 320, pointsPerGame: 21.3, gamesPlayed: 17, fantasyPoints: 362, vor: 120,
    routeShare: 0.92, targetShare: 0.31, airYardsShare: 0.38, targetsPerRouteRun: 0.32, redZoneTargets: 26, snapShare: 0.93,
    marketValueChange7d: 0.5, marketValueChange30d: 1.0, marketValueChange90d: 2.0, productionTrend: 2.0, usageTrend: 1.5, roleTrend: 1.0, adpChange30d: 0,
    rosterRate: 100, startRate: 98, benchRate: 1, leagueExposure: 44,
  },
  {
    playerId: "wr-jjefferson", playerName: "Justin Jefferson", position: "WR", team: "MIN", age: 26, season: 2025,
    fantasyCalcValue: 8800, ktcValue: 9000, customValue: 8700, dynastyCommandValue: 8900,
    projectedPoints: 310, pointsPerGame: 20.7, gamesPlayed: 16, fantasyPoints: 331, vor: 108,
    routeShare: 0.9, targetShare: 0.3, airYardsShare: 0.4, targetsPerRouteRun: 0.3, redZoneTargets: 22, snapShare: 0.92,
    marketValueChange7d: 0.0, marketValueChange30d: 0.5, marketValueChange90d: 1.0, productionTrend: 1.0, usageTrend: 1.0, roleTrend: 0.5, adpChange30d: 0,
    rosterRate: 100, startRate: 97, benchRate: 2, leagueExposure: 43,
  },
  {
    playerId: "wr-mnabers", playerName: "Malik Nabers", position: "WR", team: "NYG", age: 22, season: 2025,
    fantasyCalcValue: 8400, ktcValue: 8200, customValue: 8500, dynastyCommandValue: 8800,
    projectedPoints: 280, pointsPerGame: 18.7, gamesPlayed: 15, fantasyPoints: 281, vor: 78,
    routeShare: 0.88, targetShare: 0.32, airYardsShare: 0.36, targetsPerRouteRun: 0.29, redZoneTargets: 18, snapShare: 0.9,
    marketValueChange7d: 1.5, marketValueChange30d: 5.0, marketValueChange90d: 11.0, productionTrend: 6.0, usageTrend: 6.5, roleTrend: 6.0, adpChange30d: -4,
    rosterRate: 99, startRate: 92, benchRate: 7, leagueExposure: 39,
  },
  {
    playerId: "wr-dlondon", playerName: "Drake London", position: "WR", team: "ATL", age: 24, season: 2025,
    fantasyCalcValue: 6600, ktcValue: 6400, customValue: 6700, dynastyCommandValue: 7400,
    projectedPoints: 270, pointsPerGame: 18.0, gamesPlayed: 16, fantasyPoints: 288, vor: 70,
    routeShare: 0.89, targetShare: 0.29, airYardsShare: 0.35, targetsPerRouteRun: 0.27, redZoneTargets: 20, snapShare: 0.91,
    marketValueChange7d: 0.5, marketValueChange30d: 2.0, marketValueChange90d: 4.0, productionTrend: 5.0, usageTrend: 4.5, roleTrend: 4.0, adpChange30d: -3,
    rosterRate: 98, startRate: 90, benchRate: 9, leagueExposure: 34,
  },
  {
    playerId: "wr-dsmith", playerName: "DeVonta Smith", position: "WR", team: "PHI", age: 27, season: 2025,
    fantasyCalcValue: 4400, ktcValue: 4600, customValue: 4300, dynastyCommandValue: 4900,
    projectedPoints: 230, pointsPerGame: 15.3, gamesPlayed: 16, fantasyPoints: 245, vor: 44,
    routeShare: 0.85, targetShare: 0.24, airYardsShare: 0.3, targetsPerRouteRun: 0.24, redZoneTargets: 16, snapShare: 0.88,
    marketValueChange7d: 0.0, marketValueChange30d: -1.0, marketValueChange90d: -2.0, productionTrend: 1.5, usageTrend: 1.0, roleTrend: 1.0, adpChange30d: 1,
    rosterRate: 96, startRate: 82, benchRate: 16, leagueExposure: 26,
  },
  {
    playerId: "wr-cgodwin", playerName: "Chris Godwin", position: "WR", team: "TB", age: 29, season: 2025,
    fantasyCalcValue: 2200, ktcValue: 2000, customValue: 2300, dynastyCommandValue: 2900,
    projectedPoints: 215, pointsPerGame: 15.4, gamesPlayed: 14, fantasyPoints: 215, vor: 38,
    routeShare: 0.82, targetShare: 0.26, airYardsShare: 0.27, targetsPerRouteRun: 0.26, redZoneTargets: 14, snapShare: 0.85,
    marketValueChange7d: -0.5, marketValueChange30d: -2.0, marketValueChange90d: -6.0, productionTrend: 0.5, usageTrend: 0.0, roleTrend: -0.5, adpChange30d: 3,
    rosterRate: 85, startRate: 70, benchRate: 28, leagueExposure: 18,
  },
  {
    playerId: "wr-rodunze", playerName: "Rome Odunze", position: "WR", team: "CHI", age: 23, season: 2025,
    fantasyCalcValue: 3800, ktcValue: 3600, customValue: 3900, dynastyCommandValue: 4500,
    projectedPoints: 200, pointsPerGame: 13.3, gamesPlayed: 15, fantasyPoints: 200, vor: 28,
    routeShare: 0.8, targetShare: 0.22, airYardsShare: 0.33, targetsPerRouteRun: 0.21, redZoneTargets: 12, snapShare: 0.84,
    marketValueChange7d: 1.0, marketValueChange30d: 4.0, marketValueChange90d: 9.0, productionTrend: 3.0, usageTrend: 6.0, roleTrend: 6.5, adpChange30d: -5,
    rosterRate: 90, startRate: 64, benchRate: 34, leagueExposure: 22,
  },
  {
    playerId: "wr-jaddison", playerName: "Jordan Addison", position: "WR", team: "MIN", age: 23, season: 2025,
    fantasyCalcValue: 3400, ktcValue: 3500, customValue: 3300, dynastyCommandValue: 3100,
    projectedPoints: 195, pointsPerGame: 13.9, gamesPlayed: 14, fantasyPoints: 195, vor: 26,
    routeShare: 0.78, targetShare: 0.2, airYardsShare: 0.28, targetsPerRouteRun: 0.2, redZoneTargets: 10, snapShare: 0.8,
    marketValueChange7d: 2.0, marketValueChange30d: 5.5, marketValueChange90d: 10.0, productionTrend: 1.0, usageTrend: 1.5, roleTrend: 1.0, adpChange30d: -4,
    rosterRate: 88, startRate: 60, benchRate: 38, leagueExposure: 19,
  },
  {
    playerId: "wr-mevans", playerName: "Mike Evans", position: "WR", team: "TB", age: 32, season: 2025,
    fantasyCalcValue: 2400, ktcValue: 2200, customValue: 2500, dynastyCommandValue: 2900,
    projectedPoints: 235, pointsPerGame: 16.8, gamesPlayed: 14, fantasyPoints: 235, vor: 46,
    routeShare: 0.83, targetShare: 0.25, airYardsShare: 0.34, targetsPerRouteRun: 0.25, redZoneTargets: 22, snapShare: 0.86,
    marketValueChange7d: -0.5, marketValueChange30d: -2.0, marketValueChange90d: -5.0, productionTrend: 1.0, usageTrend: 0.0, roleTrend: -1.0, adpChange30d: 3,
    rosterRate: 82, startRate: 72, benchRate: 26, leagueExposure: 17,
  },

  // ── TEs ─────────────────────────────────────────────────────────────────
  {
    playerId: "te-bbowers", playerName: "Brock Bowers", position: "TE", team: "LV", age: 23, season: 2025,
    fantasyCalcValue: 6800, ktcValue: 7000, customValue: 6700, dynastyCommandValue: 7100,
    projectedPoints: 250, pointsPerGame: 16.7, gamesPlayed: 17, fantasyPoints: 284, vor: 96,
    routeShare: 0.88, targetShare: 0.27, airYardsShare: 0.26, targetsPerRouteRun: 0.26, redZoneTargets: 18, snapShare: 0.9,
    marketValueChange7d: 1.0, marketValueChange30d: 3.0, marketValueChange90d: 7.0, productionTrend: 4.0, usageTrend: 4.0, roleTrend: 3.5, adpChange30d: -2,
    rosterRate: 99, startRate: 95, benchRate: 4, leagueExposure: 38,
  },
  {
    playerId: "te-tmcbride", playerName: "Trey McBride", position: "TE", team: "ARI", age: 26, season: 2025,
    fantasyCalcValue: 5600, ktcValue: 5800, customValue: 5500, dynastyCommandValue: 5900,
    projectedPoints: 235, pointsPerGame: 15.7, gamesPlayed: 16, fantasyPoints: 251, vor: 80,
    routeShare: 0.86, targetShare: 0.26, airYardsShare: 0.22, targetsPerRouteRun: 0.25, redZoneTargets: 14, snapShare: 0.88,
    marketValueChange7d: 0.5, marketValueChange30d: 1.5, marketValueChange90d: 3.0, productionTrend: 3.0, usageTrend: 2.5, roleTrend: 2.0, adpChange30d: -1,
    rosterRate: 98, startRate: 90, benchRate: 9, leagueExposure: 31,
  },
  {
    playerId: "te-skikko", playerName: "Sam LaPorta", position: "TE", team: "DET", age: 24, season: 2025,
    fantasyCalcValue: 4200, ktcValue: 4400, customValue: 4100, dynastyCommandValue: 4700,
    projectedPoints: 200, pointsPerGame: 13.3, gamesPlayed: 15, fantasyPoints: 200, vor: 52,
    routeShare: 0.8, targetShare: 0.2, airYardsShare: 0.2, targetsPerRouteRun: 0.21, redZoneTargets: 12, snapShare: 0.85,
    marketValueChange7d: -0.5, marketValueChange30d: -1.5, marketValueChange90d: -3.0, productionTrend: 0.5, usageTrend: 0.5, roleTrend: 0.0, adpChange30d: 2,
    rosterRate: 96, startRate: 80, benchRate: 18, leagueExposure: 24,
  },
  {
    playerId: "te-gkittle", playerName: "George Kittle", position: "TE", team: "SF", age: 31, season: 2025,
    fantasyCalcValue: 2600, ktcValue: 2400, customValue: 2700, dynastyCommandValue: 3200,
    projectedPoints: 215, pointsPerGame: 15.4, gamesPlayed: 14, fantasyPoints: 215, vor: 64,
    routeShare: 0.78, targetShare: 0.21, airYardsShare: 0.24, targetsPerRouteRun: 0.27, redZoneTargets: 13, snapShare: 0.82,
    marketValueChange7d: -0.5, marketValueChange30d: -2.0, marketValueChange90d: -5.0, productionTrend: 1.0, usageTrend: 0.0, roleTrend: -0.5, adpChange30d: 3,
    rosterRate: 88, startRate: 76, benchRate: 22, leagueExposure: 19,
  },
  {
    playerId: "te-cloveland", playerName: "Colston Loveland", position: "TE", team: "CHI", age: 22, season: 2025,
    fantasyCalcValue: 1600, ktcValue: 1450, customValue: 1700, dynastyCommandValue: 2200,
    projectedPoints: 130, pointsPerGame: 9.3, gamesPlayed: 14, fantasyPoints: 130, vor: 18,
    routeShare: 0.66, targetShare: 0.15, airYardsShare: 0.18, targetsPerRouteRun: 0.16, redZoneTargets: 8, snapShare: 0.7,
    marketValueChange7d: 2.0, marketValueChange30d: 7.0, marketValueChange90d: 13.0, productionTrend: 3.0, usageTrend: 8.0, roleTrend: 8.5, adpChange30d: -6,
    rosterRate: 60, startRate: 30, benchRate: 68, leagueExposure: 11,
  },
];

/**
 * Returns the player pool for the Value Finder. Currently the bundled sample
 * set; replace the body with a ValueModel-backed loader to wire real data.
 */
export function getValueFinderPlayers(): ValueFinderPlayer[] {
  return MOCK_VALUE_FINDER_PLAYERS;
}
