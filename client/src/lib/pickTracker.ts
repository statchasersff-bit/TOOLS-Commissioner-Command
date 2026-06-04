// StatChasers Pick Tracker — core data + algorithm.
//
// Tracks rookie draft picks in Sleeper dynasty leagues derived from the order
// in which kickers (position K) were taken during the league's startup draft.
// The Nth kicker drafted anywhere in the league becomes rookie pick
// round=floor((N-1)/teams)+1, slot=((N-1)%teams)+1 (e.g. the 13th kicker in a
// 12-team league = 2.01), assigned to whichever team drafted that kicker.
//
// The whole computation runs client-side against the public Sleeper API,
// reusing the cached players map from sleeperApi.ts. This mirrors the
// standalone Pick Tracker spec (§5) faithfully.

import { getSleeperPlayers } from "./sleeperApi";

const SLEEPER_API = "https://api.sleeper.app/v1";

// ── Sleeper raw shapes (only the fields we use) ───────────────────────────────

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  status: string;
  draft_id?: string | null;
  total_rosters?: number;
}
interface SleeperRosterRaw {
  roster_id: number;
  owner_id?: string | null;
}
interface SleeperLeagueUserRaw {
  user_id: string;
  display_name?: string | null;
  avatar?: string | null;
  metadata?: { team_name?: string };
}
interface SleeperDraftRaw {
  draft_id: string;
  league_id: string;
  type: string;
  status: string;
  season: string;
  start_time?: number | null;
  created?: number | null;
  draft_order?: Record<string, number> | null;
}
interface SleeperPickRaw {
  pick_no: number;
  round: number;
  roster_id: number;
  player_id: string;
  picked_by?: string | null;
  metadata?: { position?: string };
}

// ── App output types (§4) ─────────────────────────────────────────────────────

export interface TeamPicks {
  rosterId: number;
  teamName: string;
  ownerName: string;
  avatar?: string | null;
  rookiePicks: string[]; // e.g. ["1.03","2.01"]
}

export interface RookiePickLedgerEntry {
  rookiePick: string; // "1.03"
  rookieRound: number; // 1
  index: number; // global kicker order (1-based)
  rosterId: number;
  teamName: string;
  ownerName: string;
  avatar?: string | null;
  playerId: string;
  playerName: string; // the kicker who was drafted
  playerTeam?: string | null; // NFL team of the kicker
  startupPickNumber: number; // overall pick_no in startup draft
  startupRound: number;
  startupRoundPick: string; // "5.04" (round.pickInRound)
}

export interface NextPickInfo {
  rookiePick: string;
  rookieRound: number;
  onTheClockTeam: string | null;
  onTheClockOwner: string | null;
  nextStartupPick: string | null; // next startup "round.slot" to be made
}

export interface PickTrackerData {
  leagueName: string;
  leagueId: string;
  draftStatus: string; // "pre_draft" | "drafting" | "complete"
  kickersDrafted: number;
  teams: TeamPicks[];
  rookiePickLedger: RookiePickLedgerEntry[];
  lastUpdated: string; // ISO timestamp
  nextPick: NextPickInfo | null;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;

async function fetchJson<T>(url: string): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      if (res.status === 404) throw new Error("Not found");
      throw new Error(`Sleeper API returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function avatarUrl(hash: string | null | undefined): string | null {
  return hash ? `https://sleepercdn.com/avatars/thumbs/${hash}` : null;
}

// ── §5a. Choosing which draft to use ──────────────────────────────────────────

export function selectStartupDraft(drafts: SleeperDraftRaw[]): SleeperDraftRaw | null {
  if (!drafts || drafts.length === 0) return null;
  if (drafts.length === 1) return drafts[0];

  const newest = (a: SleeperDraftRaw, b: SleeperDraftRaw) =>
    (b.created ?? b.start_time ?? 0) - (a.created ?? a.start_time ?? 0);

  // Prefer an explicit startup/snake/linear draft.
  const preferred = drafts
    .filter((d) => ["startup", "snake", "linear"].includes((d.type || "").toLowerCase()))
    .sort(newest);
  if (preferred.length) return preferred[0];

  // Else prefer any non-rookie draft, newest first.
  const nonRookie = drafts.filter((d) => (d.type || "").toLowerCase() !== "rookie").sort(newest);
  if (nonRookie.length) return nonRookie[0];

  // Else fall back to the newest draft overall.
  return [...drafts].sort(newest)[0];
}

// ── §5b. Computing pick assignments ───────────────────────────────────────────

function rookieSlotFor(kickerIndex: number, teamCount: number): { round: number; slot: number; label: string } {
  const round = Math.floor((kickerIndex - 1) / teamCount) + 1;
  const slot = ((kickerIndex - 1) % teamCount) + 1;
  return { round, slot, label: `${round}.${String(slot).padStart(2, "0")}` };
}

export function computePickTrackerData(
  league: SleeperLeagueRaw,
  users: SleeperLeagueUserRaw[],
  rosters: SleeperRosterRaw[],
  draft: SleeperDraftRaw,
  picks: SleeperPickRaw[],
  players: Record<string, { position?: string | null; first_name?: string | null; last_name?: string | null; team?: string | null }>,
): PickTrackerData {
  const userMap = new Map<string, SleeperLeagueUserRaw>();
  for (const u of users) userMap.set(u.user_id, u);

  const rosterToOwner = new Map<number, SleeperLeagueUserRaw | undefined>();
  for (const r of rosters) rosterToOwner.set(r.roster_id, r.owner_id ? userMap.get(r.owner_id) : undefined);

  function getTeamInfo(rosterId: number): { teamName: string; ownerName: string; avatar: string | null } {
    const u = rosterToOwner.get(rosterId);
    const teamName = u?.metadata?.team_name || u?.display_name || "Unknown Team";
    const ownerName = u?.display_name || "Unknown Owner";
    return { teamName, ownerName, avatar: avatarUrl(u?.avatar) };
  }

  const teamCount = rosters.length || league.total_rosters || 12;

  const sorted = [...picks].sort((a, b) => a.pick_no - b.pick_no);

  const ledger: RookiePickLedgerEntry[] = [];
  const picksByRoster = new Map<number, string[]>();
  const usedPickNumbers = new Set<number>();
  let kickerIndex = 0;

  for (const pick of sorted) {
    usedPickNumbers.add(pick.pick_no);
    const position = players[pick.player_id]?.position || pick.metadata?.position || "";
    if (position !== "K") continue;

    kickerIndex += 1;
    const { round, label } = rookieSlotFor(kickerIndex, teamCount);

    const info = getTeamInfo(pick.roster_id);
    const p = players[pick.player_id];
    const playerName =
      p && (p.first_name || p.last_name)
        ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
        : "Unknown Player";
    const startupRoundPick = `${pick.round}.${String(((pick.pick_no - 1) % teamCount) + 1).padStart(2, "0")}`;

    ledger.push({
      rookiePick: label,
      rookieRound: round,
      index: kickerIndex,
      rosterId: pick.roster_id,
      teamName: info.teamName,
      ownerName: info.ownerName,
      avatar: info.avatar,
      playerId: pick.player_id,
      playerName,
      playerTeam: p?.team ?? null,
      startupPickNumber: pick.pick_no,
      startupRound: pick.round,
      startupRoundPick,
    });

    const arr = picksByRoster.get(pick.roster_id) ?? [];
    arr.push(label);
    picksByRoster.set(pick.roster_id, arr);
  }

  // teams[]: every roster, with its assigned rookie picks.
  const teams: TeamPicks[] = rosters.map((r) => {
    const info = getTeamInfo(r.roster_id);
    return {
      rosterId: r.roster_id,
      teamName: info.teamName,
      ownerName: info.ownerName,
      avatar: info.avatar,
      rookiePicks: picksByRoster.get(r.roster_id) ?? [],
    };
  });
  // Sort by pick count desc, then by first pick string asc (no picks sort last).
  teams.sort((a, b) => {
    if (b.rookiePicks.length !== a.rookiePicks.length) return b.rookiePicks.length - a.rookiePicks.length;
    const af = a.rookiePicks[0] ?? "9.99";
    const bf = b.rookiePicks[0] ?? "9.99";
    return af.localeCompare(bf);
  });

  // nextPick (only while the draft is ongoing).
  let nextPick: NextPickInfo | null = null;
  if (draft.status !== "complete") {
    const next = rookieSlotFor(kickerIndex + 1, teamCount);

    // Next startup pick number = smallest pick_no (from 1) not already made.
    let nextStartupNo = 1;
    while (usedPickNumbers.has(nextStartupNo)) nextStartupNo += 1;
    const nextStartupRound = Math.floor((nextStartupNo - 1) / teamCount) + 1;
    const nextStartupSlot = ((nextStartupNo - 1) % teamCount) + 1;
    const nextStartupPick = `${nextStartupRound}.${String(nextStartupSlot).padStart(2, "0")}`;

    // Resolve the on-the-clock team via draft_order (user_id -> draft slot).
    let onTheClockTeam: string | null = null;
    let onTheClockOwner: string | null = null;
    if (draft.draft_order) {
      const onClockUserId = Object.entries(draft.draft_order).find(([, slot]) => slot === nextStartupSlot)?.[0];
      if (onClockUserId) {
        const u = userMap.get(onClockUserId);
        if (u) {
          onTheClockTeam = u.metadata?.team_name || u.display_name || "Unknown Team";
          onTheClockOwner = u.display_name || "Unknown Owner";
        }
      }
    }

    nextPick = {
      rookiePick: next.label,
      rookieRound: next.round,
      onTheClockTeam,
      onTheClockOwner,
      nextStartupPick,
    };
  }

  return {
    leagueName: league.name,
    leagueId: league.league_id,
    draftStatus: draft.status,
    kickersDrafted: kickerIndex,
    teams,
    rookiePickLedger: ledger,
    lastUpdated: new Date().toISOString(),
    nextPick,
  };
}

// ── Public fetch entry point (client-side compute path) ───────────────────────

export async function fetchPickTrackerData(leagueId: string): Promise<PickTrackerData> {
  const league = await fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`);
  if (!league || !league.league_id) throw new Error("League not found");

  const drafts = await fetchJson<SleeperDraftRaw[]>(`${SLEEPER_API}/league/${leagueId}/drafts`).catch(
    () => [] as SleeperDraftRaw[],
  );
  const draft = selectStartupDraft(drafts);
  if (!draft) throw new Error("No startup draft found for this league");

  const [users, rosters, picks, players] = await Promise.all([
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`).catch(() => []),
    fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`).catch(() => []),
    fetchJson<SleeperPickRaw[]>(`${SLEEPER_API}/draft/${draft.draft_id}/picks`).catch(() => []),
    getSleeperPlayers(),
  ]);

  return computePickTrackerData(league, users, rosters, draft, picks, players as any);
}

// ── Pick tier (medal) helper ──────────────────────────────────────────────────

export function getPickTier(round: number): "pick-gold" | "pick-silver" | "pick-bronze" | "pick-iron" {
  if (round === 1) return "pick-gold";
  if (round === 2) return "pick-silver";
  if (round === 3) return "pick-bronze";
  return "pick-iron";
}
