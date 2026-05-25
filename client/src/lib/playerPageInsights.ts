/**
 * Player Page insight generation — deterministic template logic (no AI yet).
 *
 * Produces the dynasty snapshot blurb, strengths/concerns, value tier, and a
 * similar-players list from data the app already has (value, ranks, age,
 * composite scores). Kept pure so it's easy to reason about and test.
 */

import type { RankedPlayer } from "@/contexts/ValueModelContext";
import type { CompositeScore } from "@/lib/playerAdvancedStats";

export type Pos = "QB" | "RB" | "WR" | "TE" | string;

// ── Value tier ───────────────────────────────────────────────────────────────
// Calibrated to FantasyCalc superflex dynasty values.
export function valueTier(value: number | null): string {
  if (value == null || value <= 0) return "Unranked";
  if (value >= 8000) return "Elite Cornerstone";
  if (value >= 6000) return "Franchise Pillar";
  if (value >= 4000) return "High-End Starter";
  if (value >= 2500) return "Solid Starter";
  if (value >= 1200) return "Rotational Piece";
  if (value >= 400) return "Bench Stash";
  return "Deep Flier";
}

// ── Dynasty snapshot blurb ─────────────────────────────────────────────────────
export function dynastySnapshot(input: {
  name: string;
  pos: Pos;
  age?: number;
  dynastyValue: number | null;
  posRank: number | null;
}): string {
  const { name, pos, age, dynastyValue, posRank } = input;
  const tier = valueTier(dynastyValue);
  const rankPhrase = posRank ? `${pos}${posRank}` : `a rotational ${pos}`;
  const isPremium = dynastyValue != null && dynastyValue >= 6000;
  const isStarter = dynastyValue != null && dynastyValue >= 2500;

  // Age outlook by position. RB shelf-life skews younger; QB ages best.
  const young = age != null && age <= (pos === "RB" ? 24 : 25);
  const aging =
    age != null && age >= (pos === "RB" ? 27 : pos === "QB" ? 33 : 30);

  let core: string;
  if (isPremium && young) {
    core = `an ${tier.toLowerCase()} ${pos} (${rankPhrase}) with both immediate production and strong long-term dynasty value. Age, role security, and usage insulate his future value.`;
  } else if (isPremium && aging) {
    core = `a premium win-now ${pos} (${rankPhrase}) whose production still carries elite weekly value, though age introduces gradual long-term risk.`;
  } else if (isStarter && young) {
    core = `a building-block ${pos} (${rankPhrase}) with an ascending profile — the combination of youth and opportunity gives him real upside for dynasty rosters.`;
  } else if (isStarter && aging) {
    core = `a steady win-now contributor (${rankPhrase}) with useful production, but a shortening window and age-related decline risk.`;
  } else if (isStarter) {
    core = `a dependable starting-caliber ${pos} (${rankPhrase}) who provides a reliable weekly floor for contending rosters.`;
  } else if (young) {
    core = `a developmental ${pos} whose dynasty value is driven by youth and projected opportunity rather than established production.`;
  } else {
    core = `a depth ${pos} whose value is matchup- and situation-dependent at this stage of his career.`;
  }

  return `${name} profiles as ${core}`;
}

// ── Strengths / concerns ────────────────────────────────────────────────────────
const COMPOSITE_PHRASES: Record<string, { good: string; bad: string }> = {
  "Volume Score": { good: "Elite dropback and passing volume", bad: "Limited passing volume" },
  "Efficiency Score": { good: "Strong per-play efficiency", bad: "Below-average efficiency" },
  "Accuracy Score": { good: "High accuracy and CPOE", bad: "Accuracy concerns" },
  "Rushing Score": { good: "Valuable rushing production", bad: "Minimal rushing contribution" },
  "Workload Score": { good: "Elite workload and snap share", bad: "Limited workload / committee role" },
  "Receiving Score": { good: "Strong passing-game involvement", bad: "Limited receiving role" },
  "Scoring Opportunity Score": { good: "High red-zone / goal-line usage", bad: "Light scoring-opportunity usage" },
  "Usage Score": { good: "Elite route and target volume", bad: "Low target / route involvement" },
  "Explosiveness Score": { good: "Big-play and downfield ability", bad: "Limited explosiveness" },
  "Scoring Role Score": { good: "Strong red-zone target role", bad: "Weak red-zone involvement" },
  "Route Involvement Score": { good: "High route participation", bad: "Low route participation" },
  "Target Role Score": { good: "Featured target in the offense", bad: "Secondary target role" },
  "Red Zone Score": { good: "Strong red-zone usage", bad: "Limited red-zone usage" },
  "Fantasy Production Score": { good: "Top-tier fantasy production", bad: "Modest fantasy production" },
};

export function strengthsAndConcerns(input: {
  pos: Pos;
  age?: number;
  injuryStatus?: string;
  composites: CompositeScore[];
}): { strengths: string[]; concerns: string[] } {
  const { pos, age, injuryStatus, composites } = input;
  const strengths: string[] = [];
  const concerns: string[] = [];

  for (const c of composites) {
    if (c.score == null) continue;
    const phrases = COMPOSITE_PHRASES[c.label];
    if (!phrases) continue;
    if (c.score >= 75) strengths.push(phrases.good);
    else if (c.score <= 35) concerns.push(phrases.bad);
  }

  // Age-curve concerns by position.
  if (age != null) {
    if (pos === "RB" && age >= 27) concerns.push("RB shelf-life / age-related decline risk");
    else if (pos === "WR" && age >= 30) concerns.push("Advancing age for the position");
    else if (pos === "TE" && age >= 31) concerns.push("Advancing age for the position");
    else if (pos === "QB" && age >= 35) concerns.push("Late-career age risk");
    else if (age <= 23) strengths.push("Young age with long dynasty runway");
  }

  if (injuryStatus && injuryStatus !== "Healthy" && injuryStatus.trim() !== "") {
    concerns.push(`Current status: ${injuryStatus}`);
  }

  // De-dup while preserving order.
  return {
    strengths: Array.from(new Set(strengths)),
    concerns: Array.from(new Set(concerns)),
  };
}

// ── Similar players ─────────────────────────────────────────────────────────────
export interface SimilarPlayer {
  sleeperId: string;
  name: string;
  pos: string;
  team: string;
  value: number;
  age: number;
}

export function similarPlayers(
  list: RankedPlayer[],
  target: { id: string; name: string; pos: string; value: number | null },
  count = 3,
): SimilarPlayer[] {
  if (!list?.length || target.value == null) return [];
  const targetName = target.name.toLowerCase().trim();
  const samePos = list.filter(
    (r) =>
      r.pos === target.pos &&
      r.sleeperId !== target.id &&
      r.name.toLowerCase().trim() !== targetName,
  );
  return samePos
    .map((r) => ({ ...r, dist: Math.abs(r.value - (target.value ?? 0)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map(({ dist, ...rest }) => rest);
}

// ── Dynasty value analysis (Phase 2: buy/sell/hold + age curve + fit) ─────────
export type RecTone = "strong-buy" | "buy" | "hold" | "soft-sell" | "sell" | "contender" | "avoid";

export interface DynastyValueAnalysis {
  recommendation: { badge: string; tone: RecTone; rationale: string };
  ageCurve: { minAge: number; maxAge: number; primeStart: number; primeEnd: number; age: number | null; band: string };
  valueInsulation: { label: "High" | "Moderate" | "Low" | "Unknown"; note: string };
  contenderFit: { label: "Strong" | "Moderate" | "Low"; note: string };
  rebuilderFit: { label: "Strong" | "Moderate" | "Sell"; note: string };
}

interface AgeWindow { minAge: number; maxAge: number; primeStart: number; primeEnd: number; }
function ageWindow(pos: Pos): AgeWindow {
  switch (pos) {
    case "QB": return { minAge: 21, maxAge: 40, primeStart: 26, primeEnd: 33 };
    case "RB": return { minAge: 20, maxAge: 32, primeStart: 23, primeEnd: 26 };
    case "WR": return { minAge: 21, maxAge: 34, primeStart: 24, primeEnd: 29 };
    case "TE": return { minAge: 21, maxAge: 35, primeStart: 25, primeEnd: 30 };
    default: return { minAge: 21, maxAge: 34, primeStart: 24, primeEnd: 29 };
  }
}

export function dynastyValueAnalysis(input: {
  pos: Pos;
  age?: number;
  dynastyValue: number | null;
  redraftValue: number | null;
  posRank: number | null;
  prodScore: number | null;    // Fantasy Production composite (0–100)
  injuryStatus?: string;
}): DynastyValueAnalysis {
  const { pos, age, dynastyValue, redraftValue, posRank, prodScore, injuryStatus } = input;
  const w = ageWindow(pos as Pos);

  const ascending = age != null && age < w.primeStart;
  const prime = age != null && age >= w.primeStart && age <= w.primeEnd;
  const declining = age != null && age > w.primeEnd;
  const band = age == null ? "Unknown" : ascending ? "Ascending" : prime ? "Prime" : age <= w.primeEnd + 2 ? "Late Prime" : "Decline";

  const dv = dynastyValue ?? 0;
  const elite = dv >= 6000;
  const starterPlus = dv >= 2500;
  const productive = prodScore != null ? prodScore >= 60 : (redraftValue != null && redraftValue >= 2500);
  const winNowStrong = redraftValue != null && dynastyValue != null && dynastyValue > 0 && redraftValue >= dynastyValue * 0.85;

  // ── Recommendation (priority-ordered rules) ──
  let badge = "Hold", tone: RecTone = "hold", rationale = "";
  if (dynastyValue == null || dv < 400) {
    badge = "Avoid"; tone = "avoid";
    rationale = "Deep roster flier with minimal dynasty market value — only worth a speculative bench spot.";
  } else if (ascending && starterPlus && !elite) {
    badge = "Strong Buy"; tone = "strong-buy";
    rationale = "Young, ascending value with an established role and still priced below the elite tier — a strong buy-low window.";
  } else if (ascending && elite) {
    badge = "Buy"; tone = "buy";
    rationale = "Young and already elite — acquire before the price climbs further, though it won't come cheap.";
  } else if (prime && elite) {
    badge = "Hold"; tone = "hold";
    rationale = "Elite, fairly-priced cornerstone that's difficult to replace — hold unless you're being overpaid.";
  } else if (prime && starterPlus) {
    badge = "Buy"; tone = "buy";
    rationale = "Productive starter in his prime with a stable role — a reasonable value buy.";
  } else if (declining && productive && winNowStrong) {
    badge = "Contender Target"; tone = "contender";
    rationale = "Older but still highly productive — a strong win-now target for contenders at a discounted dynasty cost.";
  } else if (declining && starterPlus) {
    badge = "Soft Sell"; tone = "soft-sell";
    rationale = "Useful production now, but age and a shortening window argue for selling before the value erodes.";
  } else if (declining) {
    badge = "Sell"; tone = "sell";
    rationale = "Aging profile with limited long-term upside — sell while there's still a market.";
  } else {
    badge = "Hold"; tone = "hold";
    rationale = "A reasonable roster hold at current value — no strong buy or sell signal.";
  }
  if (injuryStatus && injuryStatus !== "Healthy" && injuryStatus.trim() !== "") {
    rationale += ` Note current status: ${injuryStatus}.`;
  }
  if (posRank) {
    rationale += ` Currently ${pos}${posRank} in dynasty value.`;
  }

  // ── Value insulation ──
  let insLabel: DynastyValueAnalysis["valueInsulation"]["label"] = "Unknown";
  let insNote = "";
  if (age == null || dynastyValue == null) {
    insLabel = "Unknown"; insNote = "Not enough data to assess how protected this value is.";
  } else if ((ascending || prime) && starterPlus) {
    insLabel = "High"; insNote = "Youth and a secure role protect this value from rapid decline.";
  } else if (starterPlus || prime) {
    insLabel = "Moderate"; insNote = "Value is reasonably stable but sensitive to role and age changes.";
  } else {
    insLabel = "Low"; insNote = "Value is fragile — age, role, or efficiency swings could erode it quickly.";
  }

  // ── Contender / rebuilder fit ──
  let cFit: DynastyValueAnalysis["contenderFit"];
  if ((productive || winNowStrong) && starterPlus) cFit = { label: "Strong", note: "Provides immediate starting production for a contending roster." };
  else if (starterPlus) cFit = { label: "Moderate", note: "A useful contributor, but not a needle-mover for contenders." };
  else cFit = { label: "Low", note: "Limited immediate impact for a win-now roster." };

  let rFit: DynastyValueAnalysis["rebuilderFit"];
  if (ascending && starterPlus) rFit = { label: "Strong", note: "A long runway makes him a building block to acquire for a rebuild." };
  else if (declining) rFit = { label: "Sell", note: "Likely to lose value before a rebuild window opens — flip for youth or picks." };
  else rFit = { label: "Moderate", note: "Fine to hold, but not a core rebuild asset." };

  return {
    recommendation: { badge, tone, rationale },
    ageCurve: { minAge: w.minAge, maxAge: w.maxAge, primeStart: w.primeStart, primeEnd: w.primeEnd, age: age ?? null, band },
    valueInsulation: { label: insLabel, note: insNote },
    contenderFit: cFit,
    rebuilderFit: rFit,
  };
}

/** Overall dynasty rank = index in the value-sorted full list. */
export function overallDynastyRank(
  list: RankedPlayer[],
  target: { id: string; name: string },
): number | null {
  if (!list?.length) return null;
  const idx = list.findIndex((r) => r.sleeperId === target.id);
  if (idx >= 0) return idx + 1;
  const t = target.name.toLowerCase().trim();
  const nameIdx = list.findIndex((r) => r.name.toLowerCase().trim() === t);
  return nameIdx >= 0 ? nameIdx + 1 : null;
}
