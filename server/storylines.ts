/**
 * Commander's Report — STORYLINE ENGINE.
 *
 * The recap engine (commandersReport.ts) grades raw league activity into
 * structured rows + claims. This module turns those into a *ranked storyline
 * package*: it runs every storyline detector over the month's data, scores each
 * candidate on how roastable it is, and returns the top 6-8. That package — not
 * the category recaps — is what the narrator builds the article from, so the
 * roast reads like a column that walks down the month's biggest stories rather
 * than a "League Overview / Trades / Waivers" summary.
 *
 * Every storyline carries the exact data points behind it (and the recap
 * `claimIds` they came from), so the prose stays auditable: the narrator can
 * only talk about managers, players, positions, and numbers that appear here.
 */
import type { ManagerSummary, TradeRow } from "./commandersReport";

// ── Storyline taxonomy ────────────────────────────────────────────────────────

export type StorylineType =
  | "rookie_reach"
  | "massive_rookie_reach"
  | "rookie_value"
  | "rookie_pick_hoarder"
  | "position_collector"
  | "ghost_owner"
  | "pick_downgrade_trade"
  | "mystery_box_trade"
  | "old_name_faab"
  | "faab_overpay"
  | "roster_churn_theater"
  | "confusing_aggression";

/**
 * One ranked storyline. The first block is the structured payload handed to the
 * narrator; the trailing fields are internal ranking bookkeeping.
 */
export interface Storyline {
  storyline_type: StorylineType;
  manager: string;
  involved_players: string[];
  involved_picks: string[];
  /** Positions actually known for the involved players ("QB"/"RB"/"WR"/"TE"). */
  positions: string[];
  /** Derived archetypes (e.g. "rookie WR", "aging RB") — only when position is known. */
  player_archetypes: string[];
  /** The hard numbers behind the storyline; the narrator may quote these, nothing else. */
  data_points: Record<string, string | number | null>;
  why_it_matters: string;
  suggested_roast_angle: string;
  /** True when this storyline is dramatic + self-contained enough to open the column. */
  safe_for_opening: boolean;
  /** True when this storyline sets up a good "Looking Ahead" callback. */
  good_for_callback: boolean;

  // ── Internal ranking (not part of the narrator contract) ──────────────────
  /** Recap claim ids backing this storyline, for the Data Receipts UI. */
  claimIds: string[];
  /** Composite rank score; higher = more roastable. */
  score: number;
  scoreBreakdown: Record<string, number>;
}

// ── Enriched inputs (built by commandersReport.buildRecap) ───────────────────

export interface SLRookiePick {
  manager: string;
  player: string;
  playerId: string;
  position: string; // "QB" | "RB" | "WR" | "TE" | "?"
  pickNo: number;
  pickLabel: string; // "2.07"
  round: number;
  adpPick: number | null;
  delta: number | null; // +ve = picked later than ADP (value); -ve = ahead (reach)
  classification: string;
  marketRank: number | null; // FantasyCalc dynasty overall rank
  value: number | null; // FantasyCalc dynasty value
  age: number | null;
}

export interface SLTradeSide {
  manager: string;
  players: string[];
  picks: string[]; // received, e.g. "2026 R1"
  faab: number;
  value: number;
  playerValue: number;
  pickValue: number; // value of picks received
  receivedRounds: number[];
  sentPicks: string[]; // picks shipped out, e.g. "2027 R3"
  sentPickValue: number;
  sentRounds: number[];
}

export interface SLTrade {
  id: string;
  sides: SLTradeSide[];
  winner: string | null;
  loser: string | null;
  lopsidedness: number;
  grade: string;
  mysteryBox: TradeRow["mysteryBox"];
}

export interface SLWaiver {
  id: string; // matching recap claim id ("waiver-<ts>-<playerId>")
  manager: string;
  player: string;
  playerId: string;
  position: string;
  faab: number;
  spendPct: number;
  addedValue: number;
  classification: string;
  age: number | null;
  marketRank: number | null;
  redraftValue: number | null;
}

export interface StorylineInput {
  leagueName: string;
  format: string;
  faabBudget: number;
  rookiePicks: SLRookiePick[];
  trades: SLTrade[];
  waivers: SLWaiver[];
  managerSummaries: ManagerSummary[];
  /** Median value of a rostered player — the yardstick for "low dynasty value". */
  leagueMedianValue: number;
  /** Managers with a real handle (not a "Team N" / "Owner N" / "Unknown" placeholder). */
  realManagers: Set<string>;
}

// ── Archetype / naming helpers ────────────────────────────────────────────────

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/** Age past which an offensive skill player reads as a "veteran" for name-value jokes. */
const VETERAN_AGE = 29;

/**
 * Derive a light, defensible player archetype from known fields only. Returns
 * null when the position is unknown so the narrator never invents one. We only
 * lean on position, age, and dynasty value/rank — all real data points.
 */
export function deriveArchetype(opts: {
  position: string;
  age: number | null;
  value: number | null;
  marketRank: number | null;
  isRookie: boolean;
}): string | null {
  const pos = opts.position?.toUpperCase();
  if (!pos || !SKILL_POSITIONS.has(pos)) return null;
  if (opts.isRookie) return `rookie ${pos}`;
  if (opts.age != null && opts.age >= VETERAN_AGE) return `aging ${pos}`;
  if (opts.marketRank != null && opts.marketRank > 0) {
    if (opts.marketRank <= 24) return `high-end ${pos}`;
    if (opts.marketRank <= 75) return `mid-tier ${pos}`;
    return `deep-roster ${pos}`;
  }
  return pos.toLowerCase() === pos ? pos : `${pos} option`;
}

/** Whether a player is old enough that age / name-value jokes are fair game. */
export function isVeteranAge(age: number | null): boolean {
  return age != null && age >= VETERAN_AGE;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)));

// ── Detectors ─────────────────────────────────────────────────────────────────
// Each detector emits zero or more candidate storylines. Thresholds match the
// spec; tone lives in `suggested_roast_angle`, never in raw transaction syntax.

const REACH_DELTA = -6; // 6+ picks ahead of ADP
const MASSIVE_REACH_DELTA = -10; // 10+ picks ahead of ADP
const VALUE_DELTA = 8; // 8+ picks after ADP
const HOARDER_PICKS = 7;
const CHURN_MOVES = 8;
const CONFUSING_MOVES = 6;

function rookiePickStoryline(p: SLRookiePick): Storyline | null {
  if (p.delta == null) return null;
  const archetype = deriveArchetype({
    position: p.position,
    age: p.age,
    value: p.value,
    marketRank: p.marketRank,
    isRookie: true,
  });
  const positions = SKILL_POSITIONS.has(p.position?.toUpperCase?.() ?? "") ? [p.position.toUpperCase()] : [];
  const base = {
    manager: p.manager,
    involved_players: [p.player],
    involved_picks: [p.pickLabel],
    positions,
    player_archetypes: archetype ? [archetype] : [],
    claimIds: [`rookie-${p.pickLabel}-${p.playerId}`],
  };
  const dp: Record<string, string | number | null> = {
    player: p.player,
    position: positions[0] ?? null,
    pick: p.pickLabel,
    adpPick: p.adpPick,
    adpDelta: p.delta,
    round: p.round,
    marketRank: p.marketRank,
    archetype,
  };

  if (p.delta <= MASSIVE_REACH_DELTA) {
    return {
      ...base,
      storyline_type: "massive_rookie_reach",
      data_points: dp,
      why_it_matters: `${p.player} was still on the board for another ${Math.abs(p.delta)} picks by ADP, and ${p.manager} grabbed him anyway.`,
      suggested_roast_angle: `A reach this large isn't a draft pick, it's a dare. ${p.manager} saw the consensus and decided the consensus was the problem.`,
      safe_for_opening: true,
      good_for_callback: true,
      score: 0,
      scoreBreakdown: {},
    };
  }
  if (p.delta <= REACH_DELTA) {
    return {
      ...base,
      storyline_type: "rookie_reach",
      data_points: dp,
      why_it_matters: `${p.manager} spent pick ${p.pickLabel} on ${p.player}, roughly ${Math.abs(p.delta)} picks ahead of where the market had him.`,
      suggested_roast_angle: `${p.manager} could have waited and let the board come to him; instead he paid a convenience fee to be early.`,
      safe_for_opening: true,
      good_for_callback: true,
      score: 0,
      scoreBreakdown: {},
    };
  }
  if (p.delta >= VALUE_DELTA) {
    return {
      ...base,
      storyline_type: "rookie_value",
      data_points: dp,
      why_it_matters: `${p.player} slid ${p.delta} picks past ADP before ${p.manager} finally scooped him at ${p.pickLabel}.`,
      suggested_roast_angle: `Give credit, but the backhanded kind: ${p.manager} looked smart mostly because everyone else forgot to draft the guy.`,
      safe_for_opening: false,
      good_for_callback: false,
      score: 0,
      scoreBreakdown: {},
    };
  }
  return null;
}

function rookieHoarderStoryline(s: ManagerSummary): Storyline | null {
  if (s.draftPicks < HOARDER_PICKS) return null;
  return {
    storyline_type: "rookie_pick_hoarder",
    manager: s.manager,
    involved_players: [],
    involved_picks: [],
    positions: [],
    player_archetypes: [],
    data_points: { rookiePicks: s.draftPicks, reaches: s.reaches, valuePicks: s.valuePicks, direction: s.direction },
    why_it_matters: `${s.manager} made ${s.draftPicks} rookie picks, a haul better measured by the pound than by the player.`,
    suggested_roast_angle: `${s.manager} collected rookie picks like spare change and pocket lint, betting that volume covers for a plan.`,
    safe_for_opening: false,
    good_for_callback: true,
    claimIds: [],
    score: 0,
    scoreBreakdown: {},
  };
}

function positionCollectorStoryline(manager: string, picks: SLRookiePick[]): Storyline | null {
  const byPos = new Map<string, SLRookiePick[]>();
  for (const p of picks) {
    const pos = p.position?.toUpperCase?.() ?? "";
    if (!SKILL_POSITIONS.has(pos)) continue;
    byPos.set(pos, [...(byPos.get(pos) ?? []), p]);
  }
  const qbs = byPos.get("QB") ?? [];
  const tes = byPos.get("TE") ?? [];
  // 3+ at any one position, or 2+ QBs, or 2+ TEs.
  const tripled = Array.from(byPos.entries()).find(([, arr]) => arr.length >= 3);
  let triggerPos: string | null = null;
  let count = 0;
  if (tripled) {
    triggerPos = tripled[0];
    count = tripled[1].length;
  } else if (qbs.length >= 2) {
    triggerPos = "QB";
    count = qbs.length;
  } else if (tes.length >= 2) {
    triggerPos = "TE";
    count = tes.length;
  }
  if (!triggerPos) return null;
  const involved = (byPos.get(triggerPos) ?? []).map((p) => p.player);
  return {
    storyline_type: "position_collector",
    manager,
    involved_players: involved,
    involved_picks: (byPos.get(triggerPos) ?? []).map((p) => p.pickLabel),
    positions: [triggerPos],
    player_archetypes: [],
    data_points: { position: triggerPos, count, players: involved.join(", ") || null },
    why_it_matters: `${manager} drafted ${count} ${triggerPos}s, as if a position can be solved by sheer repetition.`,
    suggested_roast_angle: `${manager} isn't building a roster at ${triggerPos}, he's starting a support group for it.`,
    safe_for_opening: false,
    good_for_callback: false,
    claimIds: [],
    score: 0,
    scoreBreakdown: {},
  };
}

function ghostOwnerStoryline(s: ManagerSummary): Storyline | null {
  const ghost = s.draftPicks <= 1 && s.trades === 0 && s.waivers <= 1;
  if (!ghost) return null;
  return {
    storyline_type: "ghost_owner",
    manager: s.manager,
    involved_players: [],
    involved_picks: [],
    positions: [],
    player_archetypes: [],
    data_points: { rookiePicks: s.draftPicks, trades: s.trades, waivers: s.waivers, transactions: s.transactions },
    why_it_matters: `${s.manager} barely touched the roster all month: ${s.draftPicks} rookie pick(s), ${s.trades} trades, ${s.waivers} waiver move(s).`,
    suggested_roast_angle: `${s.manager} watched the entire offseason happen from outside the window, fogging up the glass.`,
    safe_for_opening: false,
    good_for_callback: false,
    claimIds: [],
    score: 0,
    scoreBreakdown: {},
  };
}

function pickDowngradeStoryline(t: SLTrade): Storyline | null {
  // Look for a side that shipped more pick value than it got back, while picks
  // dominated the deal (so it's a true "paid to move backward", not a star-for-picks swap).
  for (const side of t.sides) {
    const sentDominatesByPicks = side.sentPickValue > 0 && side.sentPicks.length > 0;
    const picksHeavy = side.pickValue + side.sentPickValue > side.playerValue;
    if (!sentDominatesByPicks || !picksHeavy) continue;
    const lostPickValue = side.sentPickValue - side.pickValue;
    if (lostPickValue <= 0) continue;
    // "moved backward": the best round they gave up is earlier (smaller number)
    // than the best round they got back.
    const bestSent = side.sentRounds.length ? Math.min(...side.sentRounds) : 99;
    const bestRecv = side.receivedRounds.length ? Math.min(...side.receivedRounds) : 99;
    const movedBackward = bestSent < bestRecv;
    if (lostPickValue < 200 && !movedBackward) continue;
    return {
      storyline_type: "pick_downgrade_trade",
      manager: side.manager,
      involved_players: [],
      involved_picks: uniq([...side.sentPicks, ...side.picks]),
      positions: [],
      player_archetypes: [],
      data_points: {
        sentPicks: side.sentPicks.join(", ") || null,
        receivedPicks: side.picks.join(", ") || null,
        lostPickValue: Math.round(lostPickValue),
        movedBackward: movedBackward ? "yes" : "no",
        grade: t.grade,
      },
      why_it_matters: `${side.manager} sent out ${side.sentPicks.join(", ") || "draft capital"} and got back ${side.picks.join(", ") || "less"}, a net downgrade in pick value.`,
      suggested_roast_angle: `${side.manager} paid a premium to move backward, the draft-pick equivalent of trading down and tipping the dealer.`,
      safe_for_opening: false,
      good_for_callback: true,
      claimIds: [t.id],
      score: 0,
      scoreBreakdown: {},
    };
  }
  return null;
}

function mysteryBoxStoryline(t: SLTrade): Storyline | null {
  const mb = t.mysteryBox;
  if (!mb) return null;
  return {
    storyline_type: "mystery_box_trade",
    manager: mb.victim,
    involved_players: uniq([mb.stud, ...mb.package]),
    involved_picks: [],
    positions: [],
    player_archetypes: [],
    data_points: { stud: mb.stud, studValue: mb.studValue, package: mb.package.join(", "), grade: t.grade },
    why_it_matters: `${mb.victim} shipped a proven asset in ${mb.stud} for a package of ${mb.package.join(", ")}, none of it a comparable piece.`,
    suggested_roast_angle: `${mb.victim} traded a boat for three mystery boxes, on the theory that one mystery box might one day contain a boat.`,
    safe_for_opening: true,
    good_for_callback: true,
    claimIds: [t.id],
    score: 0,
    scoreBreakdown: {},
  };
}

function oldNameFaabStoryline(w: SLWaiver, medianValue: number): Storyline | null {
  if (w.faab <= 0) return null;
  if (!isVeteranAge(w.age)) return null;
  // "Name value much higher than current dynasty value": an aging player whose
  // dynasty value sits below the league's median rostered player, yet still drew
  // real FAAB — and ideally whose redraft value outstrips his dynasty value
  // (still useful now, no future).
  const lowDynastyValue = medianValue > 0 ? w.addedValue < medianValue : true;
  const nameOutstripsDynasty = w.redraftValue != null && w.redraftValue > w.addedValue * 1.25;
  if (!lowDynastyValue && !nameOutstripsDynasty) return null;
  const positions = SKILL_POSITIONS.has(w.position?.toUpperCase?.() ?? "") ? [w.position.toUpperCase()] : [];
  return {
    storyline_type: "old_name_faab",
    manager: w.manager,
    involved_players: [w.player],
    involved_picks: [],
    positions,
    player_archetypes: positions.length ? [`aging ${positions[0]}`] : [],
    data_points: {
      player: w.player,
      faab: w.faab,
      spendPct: round1(w.spendPct * 100),
      age: w.age,
      dynastyValue: w.addedValue,
      redraftValue: w.redraftValue,
    },
    why_it_matters: `${w.manager} spent $${w.faab} FAAB on ${w.player}, a name worth more in memory than in current dynasty value.`,
    suggested_roast_angle: `${w.manager} is hoarding names that sounded great in 2021 and paying 2021 prices to do it.`,
    safe_for_opening: false,
    good_for_callback: true,
    claimIds: [w.id],
    score: 0,
    scoreBreakdown: {},
  };
}

function faabOverpayStoryline(w: SLWaiver, faabBudget: number): Storyline | null {
  if (w.faab <= 0) return null;
  // Overpay = bid is steep relative to the player's value, the budget, or both.
  // ~50 value pts per FAAB $ is the league-neutral "fair" yardstick.
  const fairValue = w.faab * 50;
  const valueOverpay = w.addedValue < fairValue * 0.6;
  const budgetOverpay = w.spendPct >= 0.25;
  if (!valueOverpay && !budgetOverpay) return null;
  const positions = SKILL_POSITIONS.has(w.position?.toUpperCase?.() ?? "") ? [w.position.toUpperCase()] : [];
  return {
    storyline_type: "faab_overpay",
    manager: w.manager,
    involved_players: [w.player],
    involved_picks: [],
    positions,
    player_archetypes: [],
    data_points: {
      player: w.player,
      faab: w.faab,
      spendPct: round1(w.spendPct * 100),
      budgetTotal: faabBudget,
      addedValue: w.addedValue,
      classification: w.classification,
    },
    why_it_matters: `${w.manager} put $${w.faab} (${Math.round(w.spendPct * 100)}% of the budget) on ${w.player}, well past what the player's value justifies.`,
    suggested_roast_angle: `That's not a waiver bid, it's a flare gun fired into the offseason night, equal parts need and lack of impulse control.`,
    safe_for_opening: true,
    good_for_callback: true,
    claimIds: [w.id],
    score: 0,
    scoreBreakdown: {},
  };
}

function rosterChurnStoryline(s: ManagerSummary): Storyline | null {
  if (s.waivers < CHURN_MOVES) return null;
  return {
    storyline_type: "roster_churn_theater",
    manager: s.manager,
    involved_players: [],
    involved_picks: [],
    positions: [],
    player_archetypes: [],
    data_points: { waivers: s.waivers, faabSpent: s.faabSpent, transactions: s.transactions, direction: s.direction },
    why_it_matters: `${s.manager} ran ${s.waivers} waiver/free-agent moves, a roster in a permanent state of being shaken.`,
    suggested_roast_angle: `${s.manager} keeps shaking the roster until something useful falls out, and so far it's mostly been more shaking.`,
    safe_for_opening: false,
    good_for_callback: false,
    claimIds: [],
    score: 0,
    scoreBreakdown: {},
  };
}

function confusingAggressionStoryline(s: ManagerSummary): Storyline | null {
  // Not individually extreme, but the pattern is odd: lots of activity that
  // doesn't square with the team's apparent direction.
  if (s.transactions < CONFUSING_MOVES) return null;
  const contenderChurning = s.direction === "contender" && s.waivers >= 4;
  const rebuildSpending = s.direction === "rebuild" && s.faabSpent > 0 && s.waivers >= 3;
  const mixedSignals = s.reaches >= 1 && s.valuePicks >= 1;
  if (!contenderChurning && !rebuildSpending && !mixedSignals) return null;
  return {
    storyline_type: "confusing_aggression",
    manager: s.manager,
    involved_players: [],
    involved_picks: [],
    positions: [],
    player_archetypes: [],
    data_points: {
      transactions: s.transactions,
      trades: s.trades,
      waivers: s.waivers,
      faabSpent: s.faabSpent,
      reaches: s.reaches,
      valuePicks: s.valuePicks,
      direction: s.direction,
    },
    why_it_matters: `${s.manager} made ${s.transactions} moves that don't add up to a single plan: a ${s.direction} on paper, something else in practice.`,
    suggested_roast_angle: `No single move trips the alarm, but collectively the vibes are under investigation.`,
    safe_for_opening: false,
    good_for_callback: false,
    claimIds: [],
    score: 0,
    scoreBreakdown: {},
  };
}

// ── Candidate generation ──────────────────────────────────────────────────────

function buildCandidates(input: StorylineInput): Storyline[] {
  const out: Storyline[] = [];

  // Rookie pick storylines (reach / massive reach / value).
  for (const p of input.rookiePicks) {
    const s = rookiePickStoryline(p);
    if (s) out.push(s);
  }

  // Per-manager rookie aggregates: hoarder + position collector.
  const picksByManager = new Map<string, SLRookiePick[]>();
  for (const p of input.rookiePicks) {
    picksByManager.set(p.manager, [...(picksByManager.get(p.manager) ?? []), p]);
  }
  for (const [manager, picks] of Array.from(picksByManager)) {
    const collector = positionCollectorStoryline(manager, picks);
    if (collector) out.push(collector);
  }

  // Per-manager summary storylines: hoarder, ghost, churn, confusing aggression.
  for (const s of input.managerSummaries) {
    const hoarder = rookieHoarderStoryline(s);
    if (hoarder) out.push(hoarder);
    const ghost = ghostOwnerStoryline(s);
    if (ghost) out.push(ghost);
    const churn = rosterChurnStoryline(s);
    if (churn) out.push(churn);
    const confusing = confusingAggressionStoryline(s);
    if (confusing) out.push(confusing);
  }

  // Trade storylines: mystery box + pick downgrade.
  for (const t of input.trades) {
    const mb = mysteryBoxStoryline(t);
    if (mb) out.push(mb);
    const downgrade = pickDowngradeStoryline(t);
    if (downgrade) out.push(downgrade);
  }

  // Waiver storylines: old-name FAAB + FAAB overpay.
  for (const w of input.waivers) {
    const oldName = oldNameFaabStoryline(w, input.leagueMedianValue);
    if (oldName) out.push(oldName);
    const overpay = faabOverpayStoryline(w, input.faabBudget);
    if (overpay) out.push(overpay);
  }

  return out;
}

// ── Ranking ─────────────────────────────────────────────────────────────────
// Score each candidate on the spec's criteria so the selector can pass the most
// roastable 6-8 to the narrator.

const COMEDY_BASE: Record<StorylineType, number> = {
  massive_rookie_reach: 10,
  mystery_box_trade: 9,
  faab_overpay: 8,
  old_name_faab: 8,
  rookie_reach: 7,
  pick_downgrade_trade: 7,
  position_collector: 7,
  rookie_pick_hoarder: 6,
  roster_churn_theater: 6,
  ghost_owner: 5,
  rookie_value: 5,
  confusing_aggression: 4,
};

const SEVERITY_BASE: Record<StorylineType, number> = {
  massive_rookie_reach: 10,
  mystery_box_trade: 8,
  pick_downgrade_trade: 7,
  faab_overpay: 7,
  rookie_reach: 6,
  old_name_faab: 5,
  rookie_pick_hoarder: 5,
  position_collector: 5,
  roster_churn_theater: 5,
  rookie_value: 4,
  confusing_aggression: 3,
  ghost_owner: 3,
};

function scoreOne(s: Storyline, input: StorylineInput): Storyline {
  const b: Record<string, number> = {};

  // Severity + comedy: the two biggest levers.
  b.severity = SEVERITY_BASE[s.storyline_type] ?? 3;
  b.comedy = COMEDY_BASE[s.storyline_type] ?? 3;

  // Manager name relevance — a real handle roasts better than "Team 7".
  b.nameRelevance = input.realManagers.has(s.manager) ? 3 : 0;

  // Asset / player name value — a marquee player or big value swing carries the joke.
  const marketRank = typeof s.data_points.marketRank === "number" ? s.data_points.marketRank : null;
  const studValue = typeof s.data_points.studValue === "number" ? s.data_points.studValue : null;
  let assetScore = 0;
  if (marketRank != null && marketRank > 0) assetScore = marketRank <= 24 ? 4 : marketRank <= 75 ? 2 : 1;
  if (studValue != null) assetScore = Math.max(assetScore, studValue >= 6000 ? 4 : studValue >= 3000 ? 3 : 1);
  if (s.involved_players.length >= 3) assetScore += 1;
  b.assetName = assetScore;

  // Value lost/gained — bigger magnitude, bigger story.
  const adpDelta = typeof s.data_points.adpDelta === "number" ? Math.abs(s.data_points.adpDelta) : 0;
  const lostPickValue = typeof s.data_points.lostPickValue === "number" ? s.data_points.lostPickValue : 0;
  const faab = typeof s.data_points.faab === "number" ? s.data_points.faab : 0;
  b.magnitude = Math.min(5, adpDelta / 4 + lostPickValue / 600 + faab / 20);

  // Contradiction with team direction — doing the opposite of your build is funny.
  const direction = s.data_points.direction;
  let contradiction = 0;
  if (direction === "contender" && (s.storyline_type === "rookie_pick_hoarder" || s.storyline_type === "ghost_owner")) {
    contradiction = 2;
  }
  if (direction === "rebuild" && (s.storyline_type === "old_name_faab" || s.storyline_type === "faab_overpay")) {
    contradiction = 2;
  }
  if (s.storyline_type === "confusing_aggression") contradiction = 2;
  b.contradiction = contradiction;

  // Unusual behavior pattern — the aggregate/per-manager pattern detectors.
  b.unusual =
    s.storyline_type === "position_collector" ||
    s.storyline_type === "rookie_pick_hoarder" ||
    s.storyline_type === "roster_churn_theater" ||
    s.storyline_type === "confusing_aggression"
      ? 2
      : 0;

  // Callback potential — sets up "Looking Ahead".
  b.callback = s.good_for_callback ? 2 : 0;

  const score = Object.values(b).reduce((x, y) => x + y, 0);
  return { ...s, score: round1(score), scoreBreakdown: b };
}

// ── Selection ─────────────────────────────────────────────────────────────────

const MIN_STORYLINES = 6;
const MAX_STORYLINES = 8;
const PER_TYPE_CAP = 2; // avoid five near-identical "rookie reach" paragraphs

/**
 * Rank every candidate and return the top 6-8, with light diversity control so a
 * single hyperactive storyline type can't crowd out the rest of the column.
 */
export function rankStorylines(input: StorylineInput): Storyline[] {
  const scored = buildCandidates(input)
    .map((s) => scoreOne(s, input))
    .sort((a, b) => b.score - a.score);

  if (scored.length <= MIN_STORYLINES) return scored;

  const typeCount = new Map<StorylineType, number>();
  const selected: Storyline[] = [];
  // One paragraph per underlying event: a single trade can trigger both
  // mystery_box and pick_downgrade, and a single waiver both faab_overpay and
  // old_name_faab — keep only the higher-scored angle of each. Keyed by the
  // primary recap claim id (trades/waivers have one; manager-level storylines
  // have none and are deduped by type via the per-type cap instead).
  const seenEvents = new Set<string>();
  const eventKey = (s: Storyline): string | null => s.claimIds[0] ?? null;

  // First pass: respect the per-type cap and one-per-event.
  for (const s of scored) {
    if (selected.length >= MAX_STORYLINES) break;
    const key = eventKey(s);
    if (key && seenEvents.has(key)) continue;
    const n = typeCount.get(s.storyline_type) ?? 0;
    if (n >= PER_TYPE_CAP) continue;
    typeCount.set(s.storyline_type, n + 1);
    if (key) seenEvents.add(key);
    selected.push(s);
  }
  // Second pass: if the cap left us short of the minimum, backfill by score
  // (still one-per-event).
  if (selected.length < MIN_STORYLINES) {
    for (const s of scored) {
      if (selected.length >= MIN_STORYLINES) break;
      if (selected.includes(s)) continue;
      const key = eventKey(s);
      if (key && seenEvents.has(key)) continue;
      if (key) seenEvents.add(key);
      selected.push(s);
    }
  }
  return selected.slice(0, MAX_STORYLINES);
}

/** Convenience: does the package contain at least one opening-safe storyline? */
export function hasOpeningStoryline(storylines: Storyline[]): boolean {
  return storylines.some((s) => s.safe_for_opening);
}
