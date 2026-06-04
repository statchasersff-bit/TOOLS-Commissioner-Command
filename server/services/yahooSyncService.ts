import { and, eq, desc, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  fantasyLeagues,
  fantasyTeams,
  fantasyRosterPlayers,
  fantasySyncRuns,
  type FantasySyncRun,
} from "@shared/schema";
import { YahooFantasyClient } from "./yahooFantasyClient";
import { getConnection, setConnectionStatus } from "./platformConnections";
import { mapForeignPlayer, rememberMapping } from "./playerMapping";
import { leagueKeyFromTeamKey, type ParsedLeague, type ParsedTeam } from "./yahooParser";

const PLATFORM = "yahoo" as const;

export interface SyncResult {
  runId: number;
  status: "success" | "error";
  leaguesSynced: number;
  teamsSynced: number;
  playersSynced: number;
  unmappedPlayers: number;
  errorMessage?: string;
}

/**
 * Full read-only Yahoo sync for one user:
 *   1. load connection → 2. fetch user's NFL teams → 3. derive league keys
 *   → 4. upsert leagues (+settings) → 5. upsert teams → 6. fetch + upsert
 *   the user's roster (Phase 1) → 7. map players to canonical ids, recording
 *   unmapped ones for review. Each step is wrapped so a single league/team
 *   failure doesn't abort the whole run. Progress is recorded in
 *   `fantasy_sync_runs`.
 */
export async function runYahooSync(userId: string): Promise<SyncResult> {
  const [run] = await db
    .insert(fantasySyncRuns)
    .values({ userId, platform: PLATFORM, status: "running" })
    .returning();

  let leaguesSynced = 0;
  let teamsSynced = 0;
  let playersSynced = 0;
  let unmappedPlayers = 0;

  try {
    const conn = await getConnection(userId, PLATFORM);
    if (!conn) throw new Error("No Yahoo connection for user");
    await setConnectionStatus(userId, PLATFORM, "syncing");

    const client = new YahooFantasyClient(userId);
    const userTeams = await client.getUserNflTeams();

    // Group the user's own teams by league key.
    const teamsByLeague = new Map<string, ParsedTeam>();
    for (const t of userTeams) {
      const lk = t.leagueKey ?? leagueKeyFromTeamKey(t.teamKey);
      if (lk) teamsByLeague.set(lk, t);
    }

    for (const [leagueKey, ownTeam] of Array.from(teamsByLeague.entries())) {
      try {
        // League + settings.
        const [league, settings] = await Promise.all([
          client.getLeague(leagueKey),
          client.getLeagueSettings(leagueKey).catch(() => null),
        ]);
        await upsertLeague(userId, leagueKey, league, settings?.raw ?? null, settings ?? null);
        leaguesSynced++;

        // All teams in the league (so My Team / League Analyzer / Power Rankings
        // can render the full standings, not just the user's own team).
        const leagueTeams = await client.getLeagueTeams(leagueKey).catch(() => [ownTeam]);
        const teamList = leagueTeams.length ? leagueTeams : [ownTeam];
        for (const team of teamList) {
          await upsertTeam(userId, leagueKey, team);
          teamsSynced++;
        }

        // Rosters. Phase 1 guarantees the user's own roster; fetch others best-effort.
        for (const team of teamList) {
          try {
            const roster = await client.getTeamRoster(team.teamKey);
            const counts = await upsertRoster(userId, leagueKey, team.teamKey, roster);
            playersSynced += counts.players;
            unmappedPlayers += counts.unmapped;
          } catch (rosterErr: any) {
            // Don't fail the league over one unreadable roster (e.g. another
            // manager's private team). The user's own roster is what matters.
            console.warn(
              `[yahooSync] roster fetch failed for ${team.teamKey}: ${rosterErr?.message ?? rosterErr}`,
            );
          }
        }
      } catch (leagueErr: any) {
        console.error(`[yahooSync] league ${leagueKey} failed: ${leagueErr?.message ?? leagueErr}`);
      }
    }

    await db
      .update(fantasySyncRuns)
      .set({
        status: "success",
        completedAt: new Date(),
        leaguesSynced,
        teamsSynced,
        playersSynced,
        unmappedPlayers,
      })
      .where(eq(fantasySyncRuns.id, run.id));
    await setConnectionStatus(userId, PLATFORM, "connected");

    return { runId: run.id, status: "success", leaguesSynced, teamsSynced, playersSynced, unmappedPlayers };
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    await db
      .update(fantasySyncRuns)
      .set({ status: "error", completedAt: new Date(), errorMessage, leaguesSynced, teamsSynced, playersSynced, unmappedPlayers })
      .where(eq(fantasySyncRuns.id, run.id));
    // needs_reconnect is set by the client on auth failures; otherwise mark error.
    const conn = await getConnection(userId, PLATFORM);
    if (conn && conn.status !== "needs_reconnect") {
      await setConnectionStatus(userId, PLATFORM, "error", errorMessage);
    }
    return { runId: run.id, status: "error", leaguesSynced, teamsSynced, playersSynced, unmappedPlayers, errorMessage };
  }
}

export async function getLatestSyncRun(userId: string): Promise<FantasySyncRun | null> {
  const rows = await db
    .select()
    .from(fantasySyncRuns)
    .where(and(eq(fantasySyncRuns.userId, userId), eq(fantasySyncRuns.platform, PLATFORM)))
    .orderBy(desc(fantasySyncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertLeague(
  userId: string,
  leagueKey: string,
  league: ParsedLeague | null,
  rawSettings: Record<string, any> | null,
  parsedSettings: { rosterPositions?: any; scoringType?: string | null } | null,
): Promise<void> {
  const settings = {
    rosterPositions: parsedSettings?.rosterPositions ?? null,
    scoringType: parsedSettings?.scoringType ?? league?.scoringType ?? null,
    raw: rawSettings ?? undefined,
  };
  const values = {
    userId,
    platform: PLATFORM,
    leagueKey,
    platformLeagueId: league?.leagueId ?? null,
    name: league?.name ?? null,
    season: league?.season ?? null,
    gameCode: league?.gameCode ?? "nfl",
    numTeams: league?.numTeams ?? null,
    scoringType: league?.scoringType ?? null,
    isFinished: league?.isFinished ?? false,
    url: league?.url ?? null,
    logoUrl: league?.logoUrl ?? null,
    settings,
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  const existing = await db
    .select({ id: fantasyLeagues.id })
    .from(fantasyLeagues)
    .where(and(eq(fantasyLeagues.userId, userId), eq(fantasyLeagues.platform, PLATFORM), eq(fantasyLeagues.leagueKey, leagueKey)))
    .limit(1);
  if (existing[0]) {
    await db.update(fantasyLeagues).set(values).where(eq(fantasyLeagues.id, existing[0].id));
  } else {
    await db.insert(fantasyLeagues).values(values);
  }
}

async function upsertTeam(userId: string, leagueKey: string, team: ParsedTeam): Promise<void> {
  const values = {
    userId,
    platform: PLATFORM,
    leagueKey,
    teamKey: team.teamKey,
    platformTeamId: team.teamId ?? null,
    name: team.name ?? null,
    managerName: team.managerName ?? null,
    managerPlatformUserId: team.managerGuid ?? null,
    isOwnedByUser: team.isOwnedByUser,
    logoUrl: team.logoUrl ?? null,
    rank: team.rank ?? null,
    wins: team.wins ?? null,
    losses: team.losses ?? null,
    ties: team.ties ?? null,
    pointsFor: team.pointsFor ?? null,
    pointsAgainst: team.pointsAgainst ?? null,
    raw: team.raw ?? null,
    updatedAt: new Date(),
  };
  const existing = await db
    .select({ id: fantasyTeams.id })
    .from(fantasyTeams)
    .where(and(eq(fantasyTeams.userId, userId), eq(fantasyTeams.platform, PLATFORM), eq(fantasyTeams.teamKey, team.teamKey)))
    .limit(1);
  if (existing[0]) {
    await db.update(fantasyTeams).set(values).where(eq(fantasyTeams.id, existing[0].id));
  } else {
    await db.insert(fantasyTeams).values(values);
  }
}

async function upsertRoster(
  userId: string,
  leagueKey: string,
  teamKey: string,
  roster: Array<{ playerKey: string; playerId: string | null; name: string | null; position: string | null; nflTeam: string | null; selectedPosition: string | null; status: string | null; raw: Record<string, any> }>,
): Promise<{ players: number; unmapped: number }> {
  // Replace the team's current (week=null) roster wholesale — cleanest way to
  // reflect drops/adds without diffing.
  await db
    .delete(fantasyRosterPlayers)
    .where(
      and(
        eq(fantasyRosterPlayers.platform, PLATFORM),
        eq(fantasyRosterPlayers.teamKey, teamKey),
        isNull(fantasyRosterPlayers.week),
      ),
    );

  let players = 0;
  let unmapped = 0;
  for (const p of roster) {
    const foreign = {
      platformPlayerId: p.playerKey || p.playerId || "",
      name: p.name,
      position: p.position,
      nflTeam: p.nflTeam,
    };
    const map = await mapForeignPlayer(PLATFORM, foreign);
    await rememberMapping(PLATFORM, foreign, map);
    if (!map.canonicalPlayerId) unmapped++;
    await db.insert(fantasyRosterPlayers).values({
      userId,
      platform: PLATFORM,
      leagueKey,
      teamKey,
      week: null,
      platformPlayerId: foreign.platformPlayerId,
      playerName: p.name ?? null,
      position: p.position ?? null,
      nflTeam: p.nflTeam ?? null,
      selectedPosition: p.selectedPosition ?? null,
      status: p.status ?? null,
      canonicalPlayerId: map.canonicalPlayerId,
      mapMethod: map.method,
      mapConfidence: map.confidence,
      raw: p.raw ?? null,
    });
    players++;
  }
  return { players, unmapped };
}
