import { and, eq, asc } from "drizzle-orm";
import { db } from "../db";
import {
  fantasyLeagues,
  fantasyTeams,
  fantasyRosterPlayers,
} from "@shared/schema";

/**
 * Read-side of the normalized platform-adapter model. Dynasty Command's
 * read-only modules consume these platform-agnostic shapes so they work
 * identically for Yahoo (and, in future, any platform writing into the
 * fantasy_* tables) without knowing the source.
 *
 * Sleeper continues to load through its own existing client; the frontend
 * merges Sleeper leagues with the normalized leagues returned here.
 */

export interface NormalizedLeague {
  id: string; // stable client id: "<platform>:<leagueKey>"
  platform: string;
  leagueKey: string;
  name: string | null;
  season: string | null;
  numTeams: number | null;
  scoringType: string | null;
  isFinished: boolean;
  logoUrl: string | null;
  lastSyncedAt: string | null;
}

export interface NormalizedTeam {
  teamKey: string;
  platform: string;
  leagueKey: string;
  name: string | null;
  managerName: string | null;
  isOwnedByUser: boolean;
  logoUrl: string | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pointsFor: string | null;
  pointsAgainst: string | null;
}

export interface NormalizedRosterPlayer {
  platformPlayerId: string;
  canonicalPlayerId: string | null; // Sleeper id when mapped
  name: string | null;
  position: string | null;
  nflTeam: string | null;
  selectedPosition: string | null;
  status: string | null;
  mapped: boolean;
}

export async function listNormalizedLeagues(userId: string): Promise<NormalizedLeague[]> {
  const rows = await db
    .select()
    .from(fantasyLeagues)
    .where(eq(fantasyLeagues.userId, userId))
    .orderBy(asc(fantasyLeagues.name));
  return rows.map((l) => ({
    id: `${l.platform}:${l.leagueKey}`,
    platform: l.platform,
    leagueKey: l.leagueKey,
    name: l.name,
    season: l.season,
    numTeams: l.numTeams,
    scoringType: l.scoringType,
    isFinished: l.isFinished,
    logoUrl: l.logoUrl,
    lastSyncedAt: l.lastSyncedAt ? l.lastSyncedAt.toISOString() : null,
  }));
}

export async function listLeagueTeams(
  userId: string,
  platform: string,
  leagueKey: string,
): Promise<NormalizedTeam[]> {
  const rows = await db
    .select()
    .from(fantasyTeams)
    .where(
      and(
        eq(fantasyTeams.userId, userId),
        eq(fantasyTeams.platform, platform),
        eq(fantasyTeams.leagueKey, leagueKey),
      ),
    )
    .orderBy(asc(fantasyTeams.rank));
  return rows.map((t) => ({
    teamKey: t.teamKey,
    platform: t.platform,
    leagueKey: t.leagueKey,
    name: t.name,
    managerName: t.managerName,
    isOwnedByUser: t.isOwnedByUser,
    logoUrl: t.logoUrl,
    rank: t.rank,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
  }));
}

export async function getTeamRoster(
  userId: string,
  platform: string,
  teamKey: string,
): Promise<NormalizedRosterPlayer[]> {
  const rows = await db
    .select()
    .from(fantasyRosterPlayers)
    .where(
      and(
        eq(fantasyRosterPlayers.userId, userId),
        eq(fantasyRosterPlayers.platform, platform),
        eq(fantasyRosterPlayers.teamKey, teamKey),
      ),
    );
  return rows.map((p) => ({
    platformPlayerId: p.platformPlayerId,
    canonicalPlayerId: p.canonicalPlayerId,
    name: p.playerName,
    position: p.position,
    nflTeam: p.nflTeam,
    selectedPosition: p.selectedPosition,
    status: p.status,
    mapped: Boolean(p.canonicalPlayerId),
  }));
}
