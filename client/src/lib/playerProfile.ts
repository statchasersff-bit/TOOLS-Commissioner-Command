/**
 * Player profile resolver — pure data shaping that takes a Sleeper player id
 * plus everything the app already knows (active league roster, value model,
 * Sleeper player DB) and produces the canonical `PlayerProfile` object the
 * Global Player Profile drawer consumes.
 *
 * Kept as a pure function (no hooks) so it's easy to test and so consumers
 * can call it from anywhere. The hook wrapper lives in
 * `useGlobalPlayerProfile.ts`.
 */

import type { League, Player, Team } from "@/types";
import type { RankedPlayer } from "@/contexts/ValueModelContext";

export interface PlayerProfileBasic {
  id: string;
  name: string;
  pos: "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | string;
  team: string;
  age?: number;
  yearsExp?: number;
  height?: string;
  weight?: string;
  injuryStatus?: string;
  active?: boolean;
}

export interface PlayerLeagueContext {
  /** True if rostered by the connected user in the active league. */
  rosteredByUser: boolean;
  /** Roster owner display name (not the user). */
  rosteredByOther: string | null;
  /** Slot context — starter / bench / taxi / IR. */
  rosterSlot: "starter" | "bench" | "taxi" | "ir" | "fa" | "unknown";
  /** Active league name, when one is loaded. */
  leagueName: string | null;
}

export interface FantasyProductionRow {
  season: string;
  team: string;
  games: number | null;
  fantasyPoints: number | null;
  ppg: number | null;
  positionRank: number | null;
  scoringFormat: string | null;
}

export interface AdvancedStatsGroup {
  label: string;
  value: string | number | null;
}

export interface PlayerNewsItem {
  headline: string;
  source: string;
  publishedAt: string;
  summary: string;
  url?: string;
}

export interface PlayerProfile {
  player: PlayerProfileBasic;
  values: {
    dynasty: number | null;
    redraft: number | null;
  };
  ranks: {
    dynastyPositional: number | null;
    redraftPositional: number | null;
  };
  leagueContext: PlayerLeagueContext | null;
  fantasyProduction: FantasyProductionRow[];
  advancedStats: AdvancedStatsGroup[];
  news: PlayerNewsItem[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a synthetic Player so we can call the value-resolver helpers, which
 *  take a Player object. */
function asPlayerForValue(p: PlayerProfileBasic): Player {
  return {
    id: p.id,
    sleeperId: p.id,
    name: p.name,
    pos: (["QB", "RB", "WR", "TE"].includes(p.pos) ? p.pos : "WR") as Player["pos"],
    age: p.age ?? 0,
    value: 0,
    team: p.team,
  };
}

function findInActiveLeague(
  league: League | null,
  playerId: string,
): { team: Team; player: Player } | null {
  if (!league) return null;
  for (const team of league.teams) {
    const player = team.roster.find(
      (p) => p != null && (p.sleeperId === playerId || p.id === playerId),
    );
    if (player) return { team, player };
  }
  return null;
}

/** Look up positional rank inside a value-source-ordered list. */
function positionalRankFromList(
  rankedList: RankedPlayer[],
  player: PlayerProfileBasic,
  byId?: Record<string, number>,
): number | null {
  if (!rankedList?.length) return null;
  // Filter by position to get positional ordering. The list is already
  // sorted by value desc.
  const samePos = rankedList.filter((r) => r.pos === player.pos);
  // Try matching by sleeperId first.
  const idIdx = samePos.findIndex((r) => r.sleeperId === player.id);
  if (idIdx >= 0) return idIdx + 1;

  // Some sources don't carry sleeperId for newer players — try a name match.
  const target = player.name.toLowerCase().trim();
  const nameIdx = samePos.findIndex(
    (r) => r.name.toLowerCase().trim() === target,
  );
  if (nameIdx >= 0) return nameIdx + 1;

  // Last resort: locate via value lookup, then rank by value descending.
  const value = byId?.[player.id];
  if (typeof value === "number" && value > 0) {
    const above = samePos.filter((r) => r.value > value).length;
    return above + 1;
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface GetPlayerProfileInput {
  playerId: string;
  sleeperPlayerDb: Record<string, any> | null;
  activeLeague: League | null;
  currentUserTeamId: string | null;
  getPlayerValue: (player: Player) => number;
  getRedraftValue: (player: Player) => number;
  dynastyPlayerList: RankedPlayer[];
  valuesBySleeperId: Record<string, number>;
  redraftValuesBySleeperId: Record<string, number>;
}

/**
 * Resolve a complete profile snapshot for the drawer.
 *
 * Returns `null` only if no information can be found at all. Callers should
 * still render the drawer shell with the "Player profile unavailable" empty
 * state in that case.
 */
export function getPlayerProfile(input: GetPlayerProfileInput): PlayerProfile | null {
  const {
    playerId,
    sleeperPlayerDb,
    activeLeague,
    currentUserTeamId,
    getPlayerValue,
    getRedraftValue,
    dynastyPlayerList,
    valuesBySleeperId,
    redraftValuesBySleeperId,
  } = input;

  if (!playerId) return null;

  // 1) Try to source basic player info — first from the active-league roster
  //    (already enriched with team/pos/age), then fall back to the Sleeper
  //    player DB.
  let basic: PlayerProfileBasic | null = null;
  let rosterPlayer: Player | null = null;

  const inLeague = findInActiveLeague(activeLeague, playerId);
  if (inLeague) {
    rosterPlayer = inLeague.player;
    basic = {
      id: playerId,
      name: inLeague.player.name,
      pos: inLeague.player.pos,
      team: inLeague.player.team ?? "",
      age: inLeague.player.age,
    };
  }

  // Sleeper DB fallback — also lets us pick up height/weight/exp even when
  // the player is on a roster (the roster slice doesn't carry those).
  const raw = sleeperPlayerDb?.[playerId];
  if (raw) {
    basic = {
      id: playerId,
      name: basic?.name || raw.full_name || `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim() || playerId,
      pos: basic?.pos || raw.position || raw.fantasy_positions?.[0] || "",
      team: basic?.team || raw.team || "",
      age: basic?.age ?? raw.age ?? undefined,
      yearsExp: typeof raw.years_exp === "number" ? raw.years_exp : undefined,
      height: raw.height || undefined,
      weight: raw.weight || undefined,
      injuryStatus: raw.injury_status || undefined,
      active: typeof raw.active === "boolean" ? raw.active : undefined,
    };
  }

  if (!basic) return null;

  // 2) Values via the centralized resolver. We construct a synthetic Player
  //    when we don't have a roster-rich object — the resolver only needs id +
  //    name + pos to do its lookup.
  const playerForValue: Player = rosterPlayer ?? asPlayerForValue(basic);
  const dynastyVal = safeValue(() => getPlayerValue(playerForValue));
  const redraftVal = safeValue(() => getRedraftValue(playerForValue));

  // 3) Positional ranks.
  const dynastyPosRank = positionalRankFromList(dynastyPlayerList, basic, valuesBySleeperId);
  // Redraft list is not maintained separately, but we can synthesize a rank by
  // re-sorting same-position dynasty list by redraft values.
  const redraftPosRank = (() => {
    if (!dynastyPlayerList?.length || !redraftValuesBySleeperId) return null;
    const samePos = dynastyPlayerList
      .filter((r) => r.pos === basic!.pos)
      .map((r) => ({
        sleeperId: r.sleeperId,
        name: r.name,
        v: redraftValuesBySleeperId[r.sleeperId] ?? 0,
      }))
      .sort((a, b) => b.v - a.v);
    const idIdx = samePos.findIndex((r) => r.sleeperId === basic!.id);
    if (idIdx >= 0) return idIdx + 1;
    const target = basic!.name.toLowerCase().trim();
    const nameIdx = samePos.findIndex((r) => r.name.toLowerCase().trim() === target);
    return nameIdx >= 0 ? nameIdx + 1 : null;
  })();

  // 4) League roster context.
  let leagueContext: PlayerLeagueContext | null = null;
  if (activeLeague) {
    if (inLeague) {
      const isUser =
        currentUserTeamId != null && inLeague.team.id === currentUserTeamId;
      const slot = deriveRosterSlot(inLeague.player);
      leagueContext = {
        rosteredByUser: isUser,
        rosteredByOther: isUser ? null : (inLeague.team.owner || inLeague.team.name),
        rosterSlot: slot,
        leagueName: activeLeague.name,
      };
    } else {
      leagueContext = {
        rosteredByUser: false,
        rosteredByOther: null,
        rosterSlot: "fa",
        leagueName: activeLeague.name,
      };
    }
  }

  // 5) Production / advanced / news — all backend-future, return shells.
  const fantasyProduction: FantasyProductionRow[] = [];
  const advancedStats: AdvancedStatsGroup[] = advancedStatsShellForPosition(basic.pos);
  const news: PlayerNewsItem[] = [];

  return {
    player: basic,
    values: { dynasty: dynastyVal, redraft: redraftVal },
    ranks: { dynastyPositional: dynastyPosRank, redraftPositional: redraftPosRank },
    leagueContext,
    fantasyProduction,
    advancedStats,
    news,
  };
}

function safeValue(fn: () => number): number | null {
  try {
    const v = fn();
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    return v;
  } catch {
    return null;
  }
}

function deriveRosterSlot(p: Player): PlayerLeagueContext["rosterSlot"] {
  if (p.onReserve) return "ir";
  if (p.onTaxi) return "taxi";
  if (p.starter) return "starter";
  return "bench";
}

/** Empty placeholder rows so the Advanced tab renders a real shell instead of
 *  a single "coming soon" line. Values stay null; the UI shows "—". */
function advancedStatsShellForPosition(pos: string): AdvancedStatsGroup[] {
  switch (pos) {
    case "QB":
      return [
        { label: "Dropbacks / game", value: null },
        { label: "Yards / attempt", value: null },
        { label: "Deep attempt %", value: null },
        { label: "Red zone att / game", value: null },
        { label: "Rush attempts / game", value: null },
      ];
    case "RB":
      return [
        { label: "Carries / game", value: null },
        { label: "Targets / game", value: null },
        { label: "Red zone touches / game", value: null },
        { label: "Yards after contact", value: null },
        { label: "Breakaway run rate", value: null },
      ];
    case "WR":
    case "TE":
      return [
        { label: "Targets / game", value: null },
        { label: "Receptions / game", value: null },
        { label: "Air yards / game", value: null },
        { label: "Yards / target", value: null },
        { label: "Red zone targets / game", value: null },
      ];
    default:
      return [];
  }
}
