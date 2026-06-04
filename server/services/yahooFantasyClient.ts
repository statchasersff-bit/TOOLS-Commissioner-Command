/**
 * Yahoo Fantasy API client stub.
 * Full implementation pending Yahoo developer app approval.
 */
import type { ParsedLeague, ParsedTeam } from "./yahooParser";

type RosterPlayer = {
  playerKey: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  nflTeam: string | null;
  selectedPosition: string | null;
  status: string | null;
  raw: Record<string, any>;
};

type LeagueSettings = {
  rosterPositions?: any;
  scoringType?: string | null;
  raw: Record<string, any> | null;
};

export class YahooFantasyClient {
  constructor(private userId: string) {}

  async getUserNflTeams(): Promise<ParsedTeam[]> {
    throw new Error("[YahooFantasyClient] Yahoo integration not configured.");
  }
  async getLeague(_k: string): Promise<ParsedLeague | null> {
    throw new Error("[YahooFantasyClient] Yahoo integration not configured.");
  }
  async getLeagueSettings(_k: string): Promise<LeagueSettings | null> {
    throw new Error("[YahooFantasyClient] Yahoo integration not configured.");
  }
  async getLeagueTeams(_k: string): Promise<ParsedTeam[]> {
    throw new Error("[YahooFantasyClient] Yahoo integration not configured.");
  }
  async getTeamRoster(_k: string): Promise<RosterPlayer[]> {
    throw new Error("[YahooFantasyClient] Yahoo integration not configured.");
  }
}
