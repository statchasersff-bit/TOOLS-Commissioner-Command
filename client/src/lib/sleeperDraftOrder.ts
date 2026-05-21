// Normalized resolver for Sleeper draft order, current drafter, and pick
// ownership.
//
// Sleeper exposes the same information across several differently-shaped
// fields (draft.draft_order, draft.slot_to_roster_id, league /rosters,
// league /users, draft.picks). Different drafts have different subsets of
// these populated — pre-draft startups often have empty draft_order, rookie
// drafts off-season often have only slot_to_roster_id, and the GraphQL
// get_draft sometimes returns one shape while the REST /draft/{id} returns
// another.
//
// This util collapses all of that into a single resolved view callers can
// consume safely.

export interface SleeperRawDraftLike {
  type?: string | null;
  /** Sleeper raw shape: userId -> 1-indexed slot */
  draft_order?: Record<string, number> | null;
  /** Sleeper raw shape: 1-indexed slot (often string key) -> roster_id */
  slot_to_roster_id?: Record<string | number, number> | null;
  settings?: {
    teams?: number;
    rounds?: number;
    /** 3 means rounds 2 & 3 reversed (third-round reversal). */
    reversal_round?: number;
    type?: string;
  } | null;
  metadata?: {
    type?: string;
    /** Sleeper occasionally surfaces a string flag here */
    reversal_round?: number | string;
  } | null;
}

export interface SleeperLeagueUserLike {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  metadata?: { team_name?: string | null } | null;
}

export interface SleeperRosterLike {
  roster_id: number;
  owner_id: string | null;
  metadata?: { team_name?: string | null } | null;
}

export interface SleeperPickLike {
  /** 1-indexed overall pick number */
  pick_no: number;
  /** user_id of the manager who clicked draft (post-trade if applicable) */
  picked_by?: string | null;
}

export interface NormalizedDraftOrder {
  teams: number;
  rounds: number;
  draftType: string;
  isSnake: boolean;
  isLinear: boolean;
  /** Sleeper third-round-reversal — when true, R2 & R3 both reversed. */
  isThirdRoundReversal: boolean;
  slotToUserId: Record<number, string | null>;
  slotToRosterId: Record<number, number | null>;
  slotToUsername: Record<number, string>;
  userIdToSlot: Record<string, number>;
  rosterIdToSlot: Record<number, number>;
  /** pickNo -> slot (computed; bounded by teams*rounds). */
  pickNoToSlot: Record<number, number>;
  /** pickNo -> user_id (original slot owner, NOT picked_by). */
  pickNoToUserId: Record<number, string | null>;
  /** pickNo -> display username (original slot owner). */
  pickNoToUsername: Record<number, string>;
  currentPickNo: number;
  currentSlot: number;
  currentUserId: string | null;
  currentUsername: string;
  /** Pure helper: pickNo -> slot for arbitrary pick numbers, snake/linear/3RR aware. */
  getSlotForPick: (pickNo: number) => number;
}

const SNAKE_TYPES = new Set(["snake", "snake_3rr"]);
const LINEAR_TYPES = new Set(["linear", "auction"]);

/** Resolve the Sleeper draft `type` string from any of the places Sleeper stores it. */
function resolveDraftType(draft: SleeperRawDraftLike): string {
  const t = (draft.type ?? draft.settings?.type ?? draft.metadata?.type ?? "snake").toLowerCase();
  if (SNAKE_TYPES.has(t)) return "snake";
  if (LINEAR_TYPES.has(t)) return t === "auction" ? "auction" : "linear";
  // Unknown — default to snake. Rookie drafts default linear in Sleeper UI
  // but never default; trust whatever Sleeper sends.
  return t;
}

/** Detect third-round reversal — Sleeper expresses this via settings.reversal_round === 3. */
function detectThirdRoundReversal(draft: SleeperRawDraftLike): boolean {
  const r1 = draft.settings?.reversal_round;
  if (typeof r1 === "number" && r1 === 3) return true;
  const r2 = draft.metadata?.reversal_round;
  if (typeof r2 === "number" && r2 === 3) return true;
  if (typeof r2 === "string" && r2 === "3") return true;
  return false;
}

/** Display-name fallback chain — see spec rule #4. */
function pickUsername(
  user: SleeperLeagueUserLike | null | undefined,
  roster: SleeperRosterLike | null | undefined,
  slot: number,
): string {
  if (user?.username && user.username.trim()) return user.username;
  if (user?.display_name && user.display_name.trim()) return user.display_name;
  const rosterTeamName = roster?.metadata?.team_name;
  if (rosterTeamName && rosterTeamName.trim()) return rosterTeamName;
  // Sleeper users carry their own metadata.team_name as well — last shot.
  const userTeamName = user?.metadata?.team_name;
  if (userTeamName && userTeamName.trim()) return userTeamName;
  return `Team ${slot}`;
}

export interface NormalizeOpts {
  draft: SleeperRawDraftLike | null | undefined;
  leagueUsers?: SleeperLeagueUserLike[] | null;
  leagueRosters?: SleeperRosterLike[] | null;
  picks?: SleeperPickLike[] | null;
  /** Explicit override for the rounds count — falls back to settings.rounds. */
  rounds?: number;
  /** Optional dev flag to print the resolved view to console once. */
  debug?: boolean;
}

export function normalizeSleeperDraftOrder({
  draft,
  leagueUsers,
  leagueRosters,
  picks,
  rounds: roundsOverride,
  debug,
}: NormalizeOpts): NormalizedDraftOrder {
  const safeDraft: SleeperRawDraftLike = draft ?? {};
  const users = leagueUsers ?? [];
  const rosters = leagueRosters ?? [];
  const draftPicks = picks ?? [];

  // Index users / rosters once so the slot loop stays O(teams).
  const userById = new Map<string, SleeperLeagueUserLike>();
  for (const u of users) userById.set(u.user_id, u);
  const rosterById = new Map<number, SleeperRosterLike>();
  const rosterIdToOwnerId = new Map<number, string>();
  for (const r of rosters) {
    rosterById.set(r.roster_id, r);
    if (r.owner_id) rosterIdToOwnerId.set(r.roster_id, r.owner_id);
  }

  // ── Rule 1: invert draft_order (userId -> slot) into slotToUserId.
  const slotToUserId: Record<number, string | null> = {};
  const userIdToSlot: Record<string, number> = {};
  const rawDraftOrder = safeDraft.draft_order ?? {};
  for (const [uid, slotRaw] of Object.entries(rawDraftOrder)) {
    const slot = Number(slotRaw);
    if (!Number.isFinite(slot) || slot <= 0) continue;
    slotToUserId[slot] = uid;
    userIdToSlot[uid] = slot;
  }

  // ── Rule 2: normalize slot_to_roster_id keys to numbers.
  const slotToRosterId: Record<number, number | null> = {};
  const rosterIdToSlot: Record<number, number> = {};
  const rawSlotToRoster = safeDraft.slot_to_roster_id ?? {};
  for (const [slotRaw, rosterIdRaw] of Object.entries(rawSlotToRoster)) {
    const slot = Number(slotRaw);
    const rosterId = Number(rosterIdRaw);
    if (!Number.isFinite(slot) || slot <= 0) continue;
    if (!Number.isFinite(rosterId)) continue;
    slotToRosterId[slot] = rosterId;
    rosterIdToSlot[rosterId] = slot;
  }

  // ── Rule 5: determine team count.
  const teams =
    Number(safeDraft.settings?.teams) ||
    Object.keys(slotToUserId).length ||
    Object.keys(slotToRosterId).length ||
    rosters.length ||
    0;

  // ── Rule 3: fill in slotToUserId from slot_to_roster_id + roster owner
  // when draft_order didn't cover the slot.
  for (let slot = 1; slot <= teams; slot++) {
    if (slotToUserId[slot]) continue;
    const rosterId = slotToRosterId[slot];
    if (rosterId == null) continue;
    const ownerId = rosterIdToOwnerId.get(rosterId);
    if (ownerId) {
      slotToUserId[slot] = ownerId;
      userIdToSlot[ownerId] = slot;
    }
  }

  // Backfill slotToRosterId from user->roster ownership when slot_to_roster_id
  // wasn't provided. This way slotToRosterId is populated whenever we know
  // *who* owns the slot, regardless of which Sleeper field told us.
  if (Object.keys(slotToRosterId).length === 0) {
    const ownerToRosterId = new Map<string, number>();
    for (const r of rosters) {
      if (r.owner_id) ownerToRosterId.set(r.owner_id, r.roster_id);
    }
    for (let slot = 1; slot <= teams; slot++) {
      const uid = slotToUserId[slot];
      if (!uid) continue;
      const rosterId = ownerToRosterId.get(uid);
      if (rosterId != null) {
        slotToRosterId[slot] = rosterId;
        rosterIdToSlot[rosterId] = slot;
      }
    }
  }

  // ── Rule 4: build slotToUsername with the documented fallback chain.
  const slotToUsername: Record<number, string> = {};
  for (let slot = 1; slot <= teams; slot++) {
    const uid = slotToUserId[slot];
    const rosterId = slotToRosterId[slot];
    const user = uid ? userById.get(uid) ?? null : null;
    const roster = rosterId != null ? rosterById.get(rosterId) ?? null : null;
    slotToUsername[slot] = pickUsername(user, roster, slot);
  }

  // ── Rule 6: resolve draft type / snake / linear.
  const draftType = resolveDraftType(safeDraft);
  const isSnake = draftType === "snake";
  const isLinear = draftType === "linear";
  const isThirdRoundReversal = isSnake && detectThirdRoundReversal(safeDraft);

  // ── Rule 7: pickNo -> slot.
  // snake:          R odd → forward, R even → reversed.
  // 3RR:            R1 forward, R2 & R3 reversed, then continue snake
  //                 from R3 (so R4 forward, R5 reversed, …). The pattern
  //                 effectively flips the parity for round >= 4.
  //                 NOTE: TODO — confirm against a real Sleeper 3RR draft
  //                 once we capture one. Sleeper docs are thin here.
  // linear/other:   always forward.
  const getSlotForPick = (pickNo: number): number => {
    if (teams <= 0 || pickNo <= 0) return 0;
    const round = Math.ceil(pickNo / teams);
    const pickInRound = ((pickNo - 1) % teams) + 1;
    if (!isSnake) {
      return pickInRound;
    }
    if (isThirdRoundReversal) {
      if (round === 1) return pickInRound;
      if (round === 2 || round === 3) return teams - pickInRound + 1;
      // round >= 4: continue snake — even rounds forward, odd rounds reversed
      // (R4=forward, R5=reversed, R6=forward, …).
      if (round % 2 === 0) return pickInRound;
      return teams - pickInRound + 1;
    }
    // Standard snake: odd rounds forward, even rounds reversed.
    return round % 2 === 1 ? pickInRound : teams - pickInRound + 1;
  };

  // Resolve rounds from settings, but cap-precompute pickNoToSlot to whatever
  // we know (settings.rounds, override, or just the picks we've seen).
  const rounds =
    Number(roundsOverride) ||
    Number(safeDraft.settings?.rounds) ||
    0;

  const pickNoToSlot: Record<number, number> = {};
  const pickNoToUserId: Record<number, string | null> = {};
  const pickNoToUsername: Record<number, string> = {};
  const totalPrecomputedPicks = teams > 0 ? teams * rounds : 0;
  for (let p = 1; p <= totalPrecomputedPicks; p++) {
    const slot = getSlotForPick(p);
    pickNoToSlot[p] = slot;
    pickNoToUserId[p] = slotToUserId[slot] ?? null;
    pickNoToUsername[p] = slotToUsername[slot] ?? `Team ${slot}`;
  }

  // ── Rule 8: current pick state.
  // picks.length + 1 is the next pick. Cap at total when the draft is full.
  const picksMade = draftPicks.length;
  const totalPicks = totalPrecomputedPicks;
  const currentPickNo = totalPicks > 0 ? Math.min(picksMade + 1, totalPicks) : picksMade + 1;
  const currentSlot = teams > 0 ? getSlotForPick(currentPickNo) : 0;
  const currentUserId = slotToUserId[currentSlot] ?? null;
  const currentUsername = slotToUsername[currentSlot] ?? `Team ${currentSlot}`;

  if (debug) {
    // One-shot dev log so React renders don't spam.
    // eslint-disable-next-line no-console
    console.debug("[normalizeSleeperDraftOrder]", {
      raw_draft_order: rawDraftOrder,
      raw_slot_to_roster_id: rawSlotToRoster,
      teams,
      rounds,
      draftType,
      isSnake,
      isLinear,
      isThirdRoundReversal,
      slotToUserId,
      slotToRosterId,
      slotToUsername,
      currentPickNo,
      currentSlot,
      currentUserId,
      currentUsername,
    });
  }

  return {
    teams,
    rounds,
    draftType,
    isSnake,
    isLinear,
    isThirdRoundReversal,
    slotToUserId,
    slotToRosterId,
    slotToUsername,
    userIdToSlot,
    rosterIdToSlot,
    pickNoToSlot,
    pickNoToUserId,
    pickNoToUsername,
    currentPickNo,
    currentSlot,
    currentUserId,
    currentUsername,
    getSlotForPick,
  };
}
