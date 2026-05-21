// Acceptance tests for client/src/lib/sleeperDraftOrder.ts.
// Run with: npx tsx scripts/test_normalizeDraftOrder.ts
//
// No test framework is configured in this project; we use plain asserts so
// the tests can be run on demand without adding a runtime dependency.

import assert from "node:assert/strict";
import { normalizeSleeperDraftOrder } from "../client/src/lib/sleeperDraftOrder";

const TEAMS = 12;
const ROUNDS = 5;

const makeUsers = (n = TEAMS) =>
  Array.from({ length: n }, (_, i) => ({
    user_id: `u${i + 1}`,
    username: `manager${i + 1}`,
    display_name: `Manager ${i + 1}`,
    avatar: null,
  }));

const makeRosters = (n = TEAMS) =>
  Array.from({ length: n }, (_, i) => ({
    roster_id: i + 1,
    owner_id: `u${i + 1}`,
  }));

// draft_order: userId -> slot. Random-looking permutation so we know the
// normalizer actually inverts the map rather than passing it through.
const draftOrder = (n = TEAMS): Record<string, number> => {
  const out: Record<string, number> = {};
  // user_i is assigned to slot ((i*7) % 12) + 1 — guarantees a non-identity
  // permutation we can verify.
  for (let i = 1; i <= n; i++) {
    out[`u${i}`] = ((i * 7) % n) + 1;
  }
  return out;
};

function pass(name: string) {
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

function group(name: string, fn: () => void) {
  // eslint-disable-next-line no-console
  console.log(name);
  fn();
}

// ── Linear: 12T ──────────────────────────────────────────────────────────────
group("12-team linear draft", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "linear",
      draft_order: draftOrder(),
      settings: { teams: TEAMS, rounds: ROUNDS },
    },
    leagueUsers: makeUsers(),
    leagueRosters: makeRosters(),
    picks: [],
  });
  assert.equal(r.isLinear, true);
  assert.equal(r.isSnake, false);
  assert.equal(r.teams, TEAMS);
  assert.equal(r.rounds, ROUNDS);
  assert.equal(r.getSlotForPick(1), 1, "pick 1.01 → slot 1");
  assert.equal(r.getSlotForPick(12), 12, "pick 1.12 → slot 12");
  assert.equal(r.getSlotForPick(13), 1, "pick 2.01 → slot 1");
  assert.equal(r.getSlotForPick(24), 12, "pick 2.12 → slot 12");
  pass("slot resolution matches linear expectations");
});

// ── Snake: 12T ───────────────────────────────────────────────────────────────
group("12-team snake draft", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      draft_order: draftOrder(),
      settings: { teams: TEAMS, rounds: ROUNDS },
    },
    leagueUsers: makeUsers(),
    leagueRosters: makeRosters(),
    picks: [],
  });
  assert.equal(r.isSnake, true);
  assert.equal(r.getSlotForPick(1), 1, "pick 1.01 → slot 1");
  assert.equal(r.getSlotForPick(12), 12, "pick 1.12 → slot 12");
  assert.equal(r.getSlotForPick(13), 12, "pick 2.01 → slot 12 (reversed)");
  assert.equal(r.getSlotForPick(24), 1, "pick 2.12 → slot 1 (reversed)");
  assert.equal(r.getSlotForPick(25), 1, "pick 3.01 → slot 1 (forward again)");
  pass("slot resolution matches snake expectations");
});

// ── Current pick after N picks (linear) ──────────────────────────────────────
group("currentPickNo and currentSlot after N picks (linear)", () => {
  const users = makeUsers();
  const rosters = makeRosters();
  const order = draftOrder();

  const makePicks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ pick_no: i + 1 }));

  const after2 = normalizeSleeperDraftOrder({
    draft: { type: "linear", draft_order: order, settings: { teams: TEAMS, rounds: ROUNDS } },
    leagueUsers: users,
    leagueRosters: rosters,
    picks: makePicks(2),
  });
  assert.equal(after2.currentPickNo, 3, "after 2 picks → pick 3 is up");
  assert.equal(after2.currentSlot, 3, "pick 3 in linear → slot 3");

  const after12 = normalizeSleeperDraftOrder({
    draft: { type: "linear", draft_order: order, settings: { teams: TEAMS, rounds: ROUNDS } },
    leagueUsers: users,
    leagueRosters: rosters,
    picks: makePicks(12),
  });
  assert.equal(after12.currentPickNo, 13, "after 12 picks → pick 13 is up");
  assert.equal(after12.currentSlot, 1, "pick 13 in linear → slot 1");

  pass("current pick math matches linear expectations");
});

// ── Headers / username resolution ────────────────────────────────────────────
group("board headers and usernames", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      draft_order: { u_alpha: 1, u_bravo: 2, u_charlie: 3 },
      slot_to_roster_id: { 1: 11, 2: 22, 3: 33 },
      settings: { teams: 3, rounds: 2 },
    },
    leagueUsers: [
      { user_id: "u_alpha", username: "alpha_handle", display_name: "Alpha", avatar: null },
      { user_id: "u_bravo", display_name: "Bravo Mgr", avatar: null }, // no username
      { user_id: "u_charlie", avatar: null, metadata: { team_name: "Charlie's Team" } }, // no username/display_name
    ],
    leagueRosters: [
      { roster_id: 11, owner_id: "u_alpha" },
      { roster_id: 22, owner_id: "u_bravo" },
      { roster_id: 33, owner_id: "u_charlie" },
    ],
    picks: [],
  });
  // Headers (slotToUsername) should never be "Team X" when user mapping exists.
  for (let s = 1; s <= 3; s++) {
    assert.ok(!/^Team \d+$/.test(r.slotToUsername[s]), `slot ${s} should not fall back to "Team N"`);
  }
  assert.equal(r.slotToUsername[1], "alpha_handle", "slot 1 uses username");
  assert.equal(r.slotToUsername[2], "Bravo Mgr", "slot 2 falls back to display_name");
  // metadata.team_name fallback (rule 4 step 3/4)
  assert.equal(r.slotToUsername[3], "Charlie's Team", "slot 3 falls back to team_name");
  pass("username fallback chain works");
});

// ── On-the-clock identity ────────────────────────────────────────────────────
group("currentUserId / currentUsername", () => {
  // Slot 1 = u_alpha. After zero picks, alpha is on the clock.
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      draft_order: { u_alpha: 1, u_bravo: 2 },
      settings: { teams: 2, rounds: 2 },
    },
    leagueUsers: [
      { user_id: "u_alpha", username: "alpha", avatar: null },
      { user_id: "u_bravo", username: "bravo", avatar: null },
    ],
    leagueRosters: [
      { roster_id: 1, owner_id: "u_alpha" },
      { roster_id: 2, owner_id: "u_bravo" },
    ],
    picks: [],
  });
  assert.equal(r.currentPickNo, 1);
  assert.equal(r.currentSlot, 1);
  assert.equal(r.currentUserId, "u_alpha");
  assert.equal(r.currentUsername, "alpha");

  // After 1 pick in snake: pick 2 → slot 2 → bravo.
  const afterOne = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      draft_order: { u_alpha: 1, u_bravo: 2 },
      settings: { teams: 2, rounds: 2 },
    },
    leagueUsers: [
      { user_id: "u_alpha", username: "alpha", avatar: null },
      { user_id: "u_bravo", username: "bravo", avatar: null },
    ],
    leagueRosters: [
      { roster_id: 1, owner_id: "u_alpha" },
      { roster_id: 2, owner_id: "u_bravo" },
    ],
    picks: [{ pick_no: 1 }],
  });
  assert.equal(afterOne.currentSlot, 2);
  assert.equal(afterOne.currentUserId, "u_bravo");
  pass("on-the-clock identity advances correctly");
});

// ── Fallback chain: slot_to_roster_id without draft_order ────────────────────
group("rule 3: slot_to_roster_id → roster.owner_id fallback", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      // draft_order intentionally empty (common pre-draft startup state)
      draft_order: {},
      slot_to_roster_id: { "1": 7, "2": 3, "3": 9 },
      settings: { teams: 3, rounds: 2 },
    },
    leagueUsers: [
      { user_id: "owner_of_7", username: "first", avatar: null },
      { user_id: "owner_of_3", username: "second", avatar: null },
      { user_id: "owner_of_9", username: "third", avatar: null },
    ],
    leagueRosters: [
      { roster_id: 7, owner_id: "owner_of_7" },
      { roster_id: 3, owner_id: "owner_of_3" },
      { roster_id: 9, owner_id: "owner_of_9" },
    ],
    picks: [],
  });
  assert.equal(r.slotToUserId[1], "owner_of_7");
  assert.equal(r.slotToUserId[2], "owner_of_3");
  assert.equal(r.slotToUserId[3], "owner_of_9");
  assert.equal(r.slotToUsername[1], "first");
  assert.equal(r.slotToUsername[2], "second");
  assert.equal(r.slotToUsername[3], "third");
  pass("slot_to_roster_id resolves through rosters");
});

// ── No user mapping at all → Team X is acceptable last resort ────────────────
group("rule 4: Team N only when nothing else resolves", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      // No draft_order, no slot_to_roster_id, no users, no rosters
      settings: { teams: 2, rounds: 1 },
    },
    leagueUsers: [],
    leagueRosters: [],
    picks: [],
  });
  assert.equal(r.slotToUsername[1], "Team 1");
  assert.equal(r.slotToUsername[2], "Team 2");
  pass("Team N fallback applies only when no other source resolves");
});

// ── Third-round reversal ────────────────────────────────────────────────────
group("snake + 3RR", () => {
  const r = normalizeSleeperDraftOrder({
    draft: {
      type: "snake",
      draft_order: draftOrder(),
      settings: { teams: TEAMS, rounds: 6, reversal_round: 3 },
    },
    leagueUsers: makeUsers(),
    leagueRosters: makeRosters(),
    picks: [],
  });
  assert.equal(r.isThirdRoundReversal, true);
  assert.equal(r.getSlotForPick(1), 1, "R1.01 normal");
  assert.equal(r.getSlotForPick(12), 12, "R1.12 normal");
  assert.equal(r.getSlotForPick(13), 12, "R2.01 reversed");
  assert.equal(r.getSlotForPick(24), 1, "R2.12 reversed");
  assert.equal(r.getSlotForPick(25), 12, "R3.01 reversed (3RR)");
  assert.equal(r.getSlotForPick(36), 1, "R3.12 reversed (3RR)");
  assert.equal(r.getSlotForPick(37), 1, "R4.01 forward (back in sync)");
  assert.equal(r.getSlotForPick(48), 12, "R4.12 forward");
  pass("3RR pattern matches the spec");
});

// eslint-disable-next-line no-console
console.log("\nAll acceptance tests passed.");
