/**
 * Yahoo Fantasy API response parser — the ONE place that understands Yahoo's
 * deeply-nested, weakly-typed JSON shape. Everything else in the codebase
 * consumes the normalized `Parsed*` structures below and never touches raw
 * Yahoo objects.
 *
 * Yahoo's quirks this module isolates:
 *   1. Collections are "count"-keyed objects: { count: 2, "0": {...}, "1": {...} }
 *      rather than arrays.
 *   2. Entity metadata arrives as an ARRAY of mostly single-key objects that
 *      must be merged: [ {team_key}, {team_id}, {name}, ... ].
 *   3. Entities interleave metadata and sub-resources: team = [ [meta...], { roster } ].
 *   4. Even with ?format=json, numbers arrive as strings ("12", "0").
 */

// ── Normalized output shapes ──────────────────────────────────────────────────

export interface ParsedGame {
  gameKey: string | null;
  gameCode: string | null;
  season: string | null;
}

export interface ParsedLeague {
  leagueKey: string;
  leagueId: string | null;
  name: string | null;
  season: string | null;
  gameCode: string;
  numTeams: number | null;
  scoringType: string | null;
  isFinished: boolean;
  url: string | null;
  logoUrl: string | null;
  raw: Record<string, any>;
}

export interface ParsedTeam {
  teamKey: string;
  teamId: string | null;
  leagueKey: string | null;
  name: string | null;
  managerName: string | null;
  managerGuid: string | null;
  logoUrl: string | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pointsFor: string | null;
  pointsAgainst: string | null;
  isOwnedByUser: boolean;
  raw: Record<string, any>;
}

export interface ParsedRosterPlayer {
  playerKey: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  nflTeam: string | null;
  selectedPosition: string | null;
  status: string | null;
  raw: Record<string, any>;
}

export interface ParsedLeagueSettings {
  rosterPositions: Array<{ position: string; count: number; type?: string }>;
  scoringType: string | null;
  statCategories: Array<{ statId: number; name: string; displayName?: string }>;
  raw: Record<string, any>;
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

function isObject(v: any): v is Record<string, any> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Unwrap the top-level `fantasy_content` envelope if present. */
function root(content: any): Record<string, any> {
  if (isObject(content) && isObject(content.fantasy_content)) return content.fantasy_content;
  return isObject(content) ? content : {};
}

/** Convert a Yahoo "count"-keyed collection object into an array of entries. */
export function collectionToArray(node: any): any[] {
  if (Array.isArray(node)) return node;
  if (!isObject(node)) return [];
  const out: any[] = [];
  for (const k of Object.keys(node)) {
    if (k === "count") continue;
    if (/^\d+$/.test(k)) out.push(node[k]);
  }
  return out;
}

/**
 * Flatten Yahoo's metadata arrays (and nested arrays) into a single plain
 * object. Single-key objects are merged; later keys win. Non-array nested
 * objects are assigned as-is (we don't recurse into sub-resources here).
 */
export function mergeMeta(node: any): Record<string, any> {
  const acc: Record<string, any> = {};
  const visit = (n: any) => {
    if (Array.isArray(n)) {
      for (const e of n) visit(e);
      return;
    }
    if (isObject(n)) {
      for (const [k, v] of Object.entries(n)) acc[k] = v;
    }
  };
  visit(node);
  return acc;
}

/** Depth-bounded search for the first occurrence of `key`. */
function deepFind(node: any, key: string, depth = 6): any {
  if (depth < 0 || node == null) return undefined;
  if (Array.isArray(node)) {
    for (const e of node) {
      const r = deepFind(e, key, depth - 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (isObject(node)) {
    if (key in node) return node[key];
    for (const k of Object.keys(node)) {
      const r = deepFind(node[k], key, depth - 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function toNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

/** "423.l.12345.t.6" → "423.l.12345"; null if not a team key. */
export function leagueKeyFromTeamKey(teamKey: string | null | undefined): string | null {
  if (!teamKey) return null;
  const m = /^(.*\.l\.\d+)\.t\.\d+$/.exec(teamKey);
  return m ? m[1] : null;
}

function logoFrom(merged: Record<string, any>, key: string): string | null {
  const logos = collectionToArray(merged[key]);
  for (const l of logos) {
    const m = mergeMeta(l[key.replace(/s$/, "")] ?? l);
    if (m.url) return str(m.url);
  }
  const single = merged[key]?.[key.replace(/s$/, "")];
  if (single?.url) return str(single.url);
  return null;
}

// ── Entity parsers ────────────────────────────────────────────────────────────

function parseTeamMeta(merged: Record<string, any>, loginGuid?: string | null): ParsedTeam {
  const teamKey = str(merged.team_key) ?? "";
  let managerName: string | null = null;
  let managerGuid: string | null = null;
  let isOwned = false;
  const managers = collectionToArray(merged.managers);
  for (const mgr of managers) {
    const m = mergeMeta(mgr.manager ?? mgr);
    if (managerName == null) managerName = str(m.nickname);
    if (managerGuid == null) managerGuid = str(m.guid);
    if (m.is_current_login === "1" || m.is_current_login === 1) isOwned = true;
    if (loginGuid && str(m.guid) === loginGuid) isOwned = true;
  }
  const standings = mergeMeta(merged.team_standings);
  const outcome = mergeMeta(standings.outcome_totals);
  return {
    teamKey,
    teamId: str(merged.team_id),
    leagueKey: leagueKeyFromTeamKey(teamKey),
    name: str(merged.name),
    managerName,
    managerGuid,
    logoUrl: logoFrom(merged, "team_logos"),
    rank: toNum(standings.rank),
    wins: toNum(outcome.wins),
    losses: toNum(outcome.losses),
    ties: toNum(outcome.ties),
    pointsFor: str(standings.points_for) ?? str(merged.team_points?.total) ?? null,
    pointsAgainst: str(standings.points_against) ?? null,
    isOwnedByUser: isOwned,
    raw: merged,
  };
}

function parseLeagueMeta(merged: Record<string, any>): ParsedLeague {
  const leagueKey = str(merged.league_key) ?? "";
  return {
    leagueKey,
    leagueId: str(merged.league_id),
    name: str(merged.name),
    season: str(merged.season),
    gameCode: str(merged.game_code) ?? "nfl",
    numTeams: toNum(merged.num_teams),
    scoringType: str(merged.scoring_type),
    isFinished: merged.is_finished === "1" || merged.is_finished === 1,
    url: str(merged.url),
    logoUrl: str(merged.logo_url),
    raw: merged,
  };
}

function parsePlayerMeta(merged: Record<string, any>): ParsedRosterPlayer {
  const name = mergeMeta(merged.name);
  const selected = mergeMeta(merged.selected_position);
  return {
    playerKey: str(merged.player_key) ?? "",
    playerId: str(merged.player_id),
    name: str(name.full),
    position: str(merged.display_position) ?? str(merged.primary_position) ?? null,
    nflTeam: str(merged.editorial_team_abbr) ?? str(merged.editorial_team_full_name) ?? null,
    selectedPosition: str(selected.position),
    status: str(merged.status) ?? null,
    raw: merged,
  };
}

// ── Public top-level parsers ──────────────────────────────────────────────────

export function parseGame(content: any): ParsedGame {
  const fc = root(content);
  const merged = mergeMeta(fc.game);
  return {
    gameKey: str(merged.game_key),
    gameCode: str(merged.game_code),
    season: str(merged.season),
  };
}

/**
 * Parse `/users;use_login=1/games;game_keys=nfl/teams` → the logged-in user's
 * NFL teams (one per league they manage). Derives the league key from each
 * team key so the sync service can enumerate leagues without a second call.
 */
export function parseUserTeams(content: any, loginGuid?: string | null): ParsedTeam[] {
  const fc = root(content);
  const teams: ParsedTeam[] = [];
  for (const u of collectionToArray(fc.users)) {
    const userMerged = mergeMeta(u.user);
    const guid = loginGuid ?? str(userMerged.guid);
    for (const g of collectionToArray(userMerged.games)) {
      const gameMerged = mergeMeta(g.game);
      for (const t of collectionToArray(gameMerged.teams)) {
        const teamMerged = mergeMeta(t.team);
        if (!teamMerged.team_key) continue;
        teams.push(parseTeamMeta(teamMerged, guid));
      }
    }
  }
  return teams;
}

/**
 * Parse `/users;use_login=1/games;game_keys=nfl/leagues` → leagues. Returns []
 * if the call only carried teams; sync derives leagues from team keys as a
 * fallback.
 */
export function parseUserLeagues(content: any): ParsedLeague[] {
  const fc = root(content);
  const leagues: ParsedLeague[] = [];
  for (const u of collectionToArray(fc.users)) {
    const userMerged = mergeMeta(u.user);
    for (const g of collectionToArray(userMerged.games)) {
      const gameMerged = mergeMeta(g.game);
      for (const l of collectionToArray(gameMerged.leagues)) {
        const leagueMerged = mergeMeta(l.league);
        if (!leagueMerged.league_key) continue;
        leagues.push(parseLeagueMeta(leagueMerged));
      }
    }
  }
  return leagues;
}

export function parseLeague(content: any): ParsedLeague | null {
  const fc = root(content);
  const merged = mergeMeta(fc.league);
  if (!merged.league_key) return null;
  return parseLeagueMeta(merged);
}

export function parseLeagueSettings(content: any): ParsedLeagueSettings {
  const fc = root(content);
  const settingsNode = deepFind(fc.league, "settings");
  const merged = mergeMeta(settingsNode);
  const rosterPositions = collectionToArray(merged.roster_positions).map((rp) => {
    const m = mergeMeta(rp.roster_position ?? rp);
    return {
      position: str(m.position) ?? "",
      count: toNum(m.count) ?? 0,
      type: str(m.position_type) ?? undefined,
    };
  });
  const statCategories = collectionToArray(deepFind(merged.stat_categories, "stats")).map((s) => {
    const m = mergeMeta(s.stat ?? s);
    return {
      statId: toNum(m.stat_id) ?? -1,
      name: str(m.name) ?? "",
      displayName: str(m.display_name) ?? undefined,
    };
  });
  return {
    rosterPositions,
    scoringType: str(merged.scoring_type) ?? str(mergeMeta(fc.league).scoring_type) ?? null,
    statCategories,
    raw: merged,
  };
}

export function parseLeagueTeams(content: any, loginGuid?: string | null): ParsedTeam[] {
  const fc = root(content);
  const teamsNode = deepFind(fc.league, "teams");
  const out: ParsedTeam[] = [];
  for (const t of collectionToArray(teamsNode)) {
    const merged = mergeMeta(t.team);
    if (!merged.team_key) continue;
    out.push(parseTeamMeta(merged, loginGuid));
  }
  return out;
}

export function parseTeamRoster(content: any): ParsedRosterPlayer[] {
  const fc = root(content);
  const playersNode = deepFind(fc.team, "players");
  const out: ParsedRosterPlayer[] = [];
  for (const p of collectionToArray(playersNode)) {
    const merged = mergeMeta(p.player);
    if (!merged.player_key) continue;
    out.push(parsePlayerMeta(merged));
  }
  return out;
}

/** Minimal transaction parse — Phase 1 read-only; returns raw merged rows. */
export function parseLeagueTransactions(content: any): Array<Record<string, any>> {
  const fc = root(content);
  const txNode = deepFind(fc.league, "transactions");
  return collectionToArray(txNode).map((t) => mergeMeta(t.transaction));
}
