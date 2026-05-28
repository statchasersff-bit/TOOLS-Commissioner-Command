/**
 * Commander's Report — the TEMPLATE NARRATOR.
 *
 * Turns the deterministic engine's RecapResult into a written, funny article
 * WITHOUT any LLM call. Every sentence is composed from real recap fields
 * (awards, manager summaries, trade sides, chaos score), so the prose is
 * grounded by construction — it cannot invent trades, picks, or numbers.
 *
 * The output is NOT a category recap. It is a ranked roast column: it opens on
 * the month's biggest disaster, then walks down the ranked storylines —
 * second-dumbest move, accidental genius (backhanded), the ghosts who did
 * nothing, an optional roastable trade / waiver — and ends with a "Looking
 * Ahead" callback to the opening villain. Storylines with no data are skipped,
 * never forced. A seeded RNG drives phrasing so reports vary on "Regenerate"
 * while staying deterministic for a given seed. The humor always rides on the
 * data, never on personal attacks.
 */
import type { Article, RecapResult, Award, ManagerSummary } from "./commandersReport";

// ── Seeded RNG (xmur3 seed → mulberry32) ─────────────────────────────────────

function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

// ── Small grammar helpers ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

function awardByKey(recap: RecapResult, key: string): Award | undefined {
  return recap.awards.find((a) => a.key === key);
}

// "a, b and c" — Oxford-free natural list join.
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const PICK_ORDINAL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "5": "5th" };
// "2026 R1" → "a 2026 1st" so picks read like prose, not database rows.
function prettyPick(label: string): string {
  const m = label.match(/^(\d{4})\s*R(\d+)$/);
  return m ? `a ${m[1]} ${PICK_ORDINAL[m[2]] ?? `${m[2]}th`}` : label;
}

// Turn one side's received assets into a natural phrase ("Breece Hall",
// "a 2026 1st and a 2027 1st", "$30 FAAB").
function describeHaul(side: { players: string[]; picks: string[]; faab: number }): string {
  const parts: string[] = [];
  if (side.players.length) parts.push(joinAnd(side.players));
  if (side.picks.length) parts.push(joinAnd(side.picks.map(prettyPick)));
  if (side.faab > 0) parts.push(`$${side.faab} FAAB`);
  return parts.length ? joinAnd(parts) : "little more than cap space";
}

// "Carson Beck at 3.11" → "Carson Beck" for cleaner callbacks.
function playerName(awardValue: string): string {
  return awardValue.split(" at ")[0];
}

function summaryOf(recap: RecapResult, manager: string): ManagerSummary | undefined {
  return recap.managerSummaries.find((m) => m.manager === manager);
}

// A manager's month, woven into one phrase: "8 transactions, 7 waiver moves,
// $99 of FAAB, 11 rookie picks, and 3 draft reaches".
function activityProfile(s: ManagerSummary): string {
  const bits = [`${s.transactions} ${plural(s.transactions, "transaction")}`];
  if (s.waivers > 0) bits.push(`${s.waivers} waiver ${plural(s.waivers, "move")}`);
  if (s.faabSpent > 0) bits.push(`$${s.faabSpent} of FAAB`);
  if (s.draftPicks > 0) bits.push(`${s.draftPicks} rookie ${plural(s.draftPicks, "pick")}`);
  if (s.reaches > 0) bits.push(`${s.reaches} draft ${plural(s.reaches, "reach", "reaches")}`);
  return joinAnd(bits);
}

const isGhost = (s: ManagerSummary): boolean => s.transactions === 0 && s.draftPicks === 0;

// Metaphors for the "sold the boat for mystery boxes" trade.
const MB_METAPHORS = [
  "This is the classic mystery box trade: sell the boat, buy a few boxes, and spend the next two years convincing yourself one of them might contain a better boat.",
  "This is the dynasty equivalent of selling your house because someone offered you two tents and a blueprint.",
  "That's not rebuilding so much as turning a dollar into four quarters and insisting the quarters have more upside.",
];

// ── Headline + share caption ────────────────────────────────────────────────

function buildHeadline(recap: RecapResult, rng: Rng): string {
  const reach = awardByKey(recap, "biggest_reach");
  const faab = awardByKey(recap, "largest_faab_spend");
  const trade = awardByKey(recap, "best_trade");
  const chaotic = awardByKey(recap, "most_chaotic");

  if (reach) {
    return pick(rng, [
      `${reach.manager} selected ${reach.value} like a man who saw "average draft position" and thought it was a dare.`,
      `${reach.manager} took ${playerName(reach.value)} ${reach.detail} like he had insider information from a fortune cookie.`,
      `${reach.manager} drafted ${reach.value} with the confidence of a man buying beachfront property in Nebraska.`,
      `${reach.manager} reached ${reach.detail} for ${reach.value}, a leap of faith the ADP sheet is still filing a complaint about.`,
    ]);
  }
  if (faab) return `${faab.manager} set ${faab.detail} on fire for ${faab.value} and called it roster construction.`;
  if (trade) return `${trade.manager} won a trade so quietly the rest of the league is still pretending it didn't happen.`;
  if (chaotic) return `${chaotic.manager} spent the month auditioning for Most Chaotic Manager and refused to let anyone else read for the part.`;
  return `${recap.meta.leagueName} posted ${recap.chaosScore.score}/100 on the Chaos Score and earned every single point of it.`;
}

/** Short, punchy share caption drawn from the juiciest available award. */
function buildShareText(recap: RecapResult): string {
  const reach = awardByKey(recap, "biggest_reach");
  const faab = awardByKey(recap, "largest_faab_spend");
  const trade = awardByKey(recap, "best_trade");
  const chaotic = awardByKey(recap, "most_chaotic");

  if (reach) return `${reach.manager} reached ${reach.detail} for ${reach.value}. The Commander's Report kept the receipts.`;
  if (faab) return `${faab.manager} torched ${faab.detail} on ${faab.value}. Full receipts inside.`;
  if (trade) return `${trade.manager} fleeced the league for ${trade.detail}. Don't take our word for it — read it.`;
  if (chaotic)
    return `${chaotic.manager} ran the month's chaos. ${recap.meta.leagueName} hit ${recap.chaosScore.score}/100 — somebody had to write it down.`;
  return `${recap.meta.leagueName} clocked ${recap.chaosScore.score}/100 on the Chaos Score. The Commander's Report has thoughts.`;
}

// ── Entry point: rank the storylines, then roast them ────────────────────────

type Para = { body: string; claimIds: string[] };

/**
 * Build a written article from a recap, deterministically. `seed` controls the
 * random phrasing — pass a stable string for reproducible output, or vary it
 * (e.g. append a timestamp) to "reroll" on regenerate.
 */
export function narrateReportTemplate(recap: RecapResult, seed: string): Article {
  const rng = makeRng(seed);
  const headline = buildHeadline(recap, rng);
  const shareText = buildShareText(recap);

  const reach = awardByKey(recap, "biggest_reach");
  const faab = awardByKey(recap, "largest_faab_spend");
  const value = awardByKey(recap, "best_value");
  const top = awardByKey(recap, "best_trade");
  const topRow = [...recap.tradeRecap.rows].sort((a, b) => b.lopsidedness - a.lopsidedness)[0];
  const tradeRoastable = !!(
    top &&
    topRow &&
    topRow.winner &&
    topRow.sides.length === 2 &&
    ["Robbery", "Clear Win"].includes(topRow.grade)
  );
  const winnerSide = tradeRoastable ? topRow.sides.find((s) => s.manager === topRow.winner)! : null;
  const loserSide = tradeRoastable ? topRow.sides.find((s) => s.manager !== topRow.winner)! : null;
  // Picks carry only season+round (e.g. "2026 R3"), no slot — so when the same
  // label sits on both sides ("a 2026 3rd for a 2026 3rd"), the literal retelling
  // is meaningless. Fall back to a generic "draft-pick swap" framing in that case
  // while keeping the (value-model-backed) edge and grade.
  const tradeAmbiguous = !!(winnerSide && loserSide && loserSide.picks.some((p) => winnerSide.picks.includes(p)));
  const tradeGiveTake = (): string =>
    tradeAmbiguous
      ? `came out on the wrong end of a draft-pick swap`
      : `pushed ${describeHaul(winnerSide!)} across the table for ${describeHaul(loserSide!)}`;

  // The mystery-box trade (cornerstone shipped out for a pile of upside) is its
  // own archetype, detected in the recap engine and read straight off the row.
  const mb = recap.tradeRecap.rows.find((r) => r.mysteryBox)?.mysteryBox ?? null;

  const paras: Para[] = [];
  let villain: string | null = null;
  let callback: string | null = null;
  let usedFaab = false;
  let usedTrade = false;
  let usedMb = false;

  // 1 ── The villain: the month's worst / funniest decision opens the column.
  if (reach) {
    villain = reach.manager;
    const s = summaryOf(recap, reach.manager);
    const sentences = [
      `We are gathered here today to discuss ${reach.manager}, who turned our league into a one-man case study in what happens with too many rookie picks and not enough adult supervision.`,
      `Taking ${reach.value} a full ${reach.detail} is ${pick(rng, [
        "less a draft pick and more a man trying to prove he can see ghosts in the spreadsheet",
        "the dynasty equivalent of paying full airport prices for a quarterback scratch-off ticket and calling it roster construction",
        "less a reach than a man climbing onto the roof of the draft board to announce that the market simply does not understand his vision",
      ])}.`,
    ];
    if (s && (s.transactions >= 5 || s.faabSpent > 0 || s.reaches > 1)) {
      sentences.push(
        `And it wasn't a one-off: ${activityProfile(s)} is the activity profile of a manager trying to fix a roster by shaking it until loose change falls out.`,
      );
    }
    paras.push({ body: sentences.join(" "), claimIds: ["award-biggest_reach"] });
    callback = `${reach.manager} better hope ${playerName(reach.value)} turns into ${pick(rng, [
      "the kind of player who makes everyone apologize in writing",
      "a dynasty cheat code",
    ])}, because taking him a full ${reach.detail} is the type of decision that follows a manager around like a haunted draft queue. If it hits, this becomes vision. If it doesn't, it becomes the exact receipt Dynasty Command laminates and brings back out when the group chat needs a victim.`;
  } else if (mb) {
    villain = mb.victim;
    usedMb = true;
    usedTrade = true;
    paras.push({
      body: `We are gathered here today to discuss ${mb.victim}, who decided that owning ${mb.stud} was simply too stressful and shipped him out for ${joinAnd(mb.package)} — a package whose best argument is that none of them are old enough to disappoint anyone yet. ${pick(rng, MB_METAPHORS)} ${mb.victim} traded production for imagination, which is great if this league starts handing out points for theoretical upside.`,
      claimIds: ["award-best_trade"],
    });
    callback = `${mb.victim} better hope one of those mystery boxes actually contains a starter, because shipping out ${mb.stud} for a group project is the exact receipt Dynasty Command laminates and brings back out when the group chat needs a victim.`;
  } else if (tradeRoastable) {
    villain = loserSide!.manager;
    usedTrade = true;
    paras.push({
      body: `We are gathered here today to discuss ${loserSide!.manager}, who ${tradeGiveTake()}. Dynasty Command stamped it a ${topRow.grade} for ${winnerSide!.manager} and a ${top!.detail} the other way — the kind of deal that sounds fine until the math walks in wearing gloves and starts dusting for fingerprints.`,
      claimIds: ["award-best_trade"],
    });
    callback = `${loserSide!.manager} better hope those picks never amount to anything, because handing ${winnerSide!.manager} a ${top!.detail} is the type of receipt Dynasty Command laminates for the group chat.`;
  } else if (faab) {
    villain = faab.manager;
    usedFaab = true;
    paras.push({
      body: `We are gathered here today to discuss ${faab.manager}, who spent ${faab.detail} on ${faab.value} as if the waiver wire takes prayers as payment. That isn't a bid so much as a flare gun fired into the offseason night.`,
      claimIds: ["award-largest_faab_spend"],
    });
    callback = `${faab.manager} better hope ${playerName(faab.value)} was worth ${faab.detail}, because that bid is the kind of receipt the group chat brings up every time it needs a cheap laugh.`;
  } else {
    paras.push({
      body: `For once, ${recap.meta.leagueName} kept its hands mostly clean — no draft heists, no FAAB bonfires, no trade-screen crime scenes worth prosecuting. Suspicious, frankly.`,
      claimIds: ["chaos-league"],
    });
  }

  // 2 ── Second-dumbest: a different manager's questionable move (FAAB overpay).
  if (faab && !usedFaab && faab.manager !== villain) {
    usedFaab = true;
    paras.push({
      body: `Then came ${faab.manager}, who spent ${faab.detail} on ${faab.value} as if ${pick(rng, [
        "quarterback stability is something you solve by throwing FAAB into a wishing well",
        "roster depth could be summoned with enough offseason cash and enough hope",
      ])}. Right now that reads less like a bid and more like ${pick(rng, [
        "a public cry for help",
        "buying insurance for a car you don't own yet because you had a dream about traffic",
      ])}.`,
      claimIds: ["award-largest_faab_spend"],
    });
  }

  // 3 ── Accidental genius: a smart move, framed backhanded. If it's the same
  //      manager as the villain, the contradiction is the whole joke.
  if (value) {
    if (value.manager === villain) {
      paras.push({
        body: `In the middle of all this, ${value.manager} somehow also did something smart, which is honestly the most suspicious part of the entire month. Landing ${value.value} a full ${value.detail} was real value — patient, reasonable, almost impressive, which is exactly why it feels like it happened by accident. For one brief moment ${value.manager} looked like the only person in the room reading the board correctly, and then the rest of the month reopened the investigation.`,
        claimIds: ["award-best_value"],
      });
    } else {
      paras.push({
        body: `Somewhere in the wreckage, ${value.manager} accidentally looked competent, landing ${value.value} a full ${value.detail} — not because of any master plan, but because everyone else was too busy faceplanting to notice the value sitting there in plain sight.`,
        claimIds: ["award-best_value"],
      });
    }
  }

  // 4 ── The ghosts: managers who did nothing while the league burned. The
  //      league-wide counts live here, as the backdrop the ghosts ignored.
  const ghosts = recap.managerSummaries.filter(isGhost).map((m) => m.manager);
  if (ghosts.length) {
    const names = joinAnd(ghosts.slice(0, 4)) + (ghosts.length > 4 ? `, and ${ghosts.length - 4} others` : "");
    const { tradeRecap, waiverRecap, rookieRecap } = recap;
    paras.push({
      body: `Then there are the ghosts. While the rest of the league set fire to the transaction feed, ${names} watched ${rookieRecap.drafted} rookie ${plural(rookieRecap.drafted, "pick")}, ${waiverRecap.count} waiver ${plural(waiverRecap.count, "move")}, and ${tradeRecap.count} ${plural(tradeRecap.count, "trade")} drift past like traffic outside a window. In a month this loud, silence isn't discipline — it's patience, paralysis, or someone forgetting they downloaded Sleeper in the first place.`,
      claimIds: ["chaos-league"],
    });
  }

  // 5 ── Optional dumb trade: a mystery-box deal if one exists (the funnier,
  //      more specific story), otherwise a genuinely lopsided trade.
  if (mb && !usedMb) {
    usedMb = true;
    usedTrade = true;
    paras.push({
      body: `The trade market wasn't innocent either. ${mb.victim} decided owning a proven dynasty asset was simply too stressful and shipped ${mb.stud} out for ${joinAnd(mb.package)} — younger pieces whose best argument is that they aren't old enough to disappoint anyone yet. ${pick(rng, MB_METAPHORS)} Maybe one of them hits. Maybe they all become weekly starters. Or maybe ${mb.victim} just traded certainty for a group project and called it roster construction.`,
      claimIds: ["award-best_trade"],
    });
  } else if (tradeRoastable && !usedTrade) {
    usedTrade = true;
    paras.push({
      body: `The trade market wasn't innocent either. ${loserSide!.manager} ${tradeGiveTake()}, letting ${winnerSide!.manager} walk away with a ${top!.detail}. Dynasty Command called it a ${topRow.grade} for ${winnerSide!.manager} — the kind of deal that sounds boring until the math walks in wearing gloves and starts dusting for fingerprints.`,
      claimIds: ["award-best_trade"],
    });
  }

  // 6 ── Optional waiver: only if a FAAB overpay (by someone other than the
  //      villain) hasn't already been spent on a paragraph.
  if (faab && !usedFaab && faab.manager !== villain) {
    usedFaab = true;
    paras.push({
      body: `Over on the waiver wire, ${faab.manager} lit ${faab.detail} on fire for ${faab.value}, which is one way to announce a need and a lack of impulse control in the same transaction.`,
      claimIds: ["award-largest_faab_spend"],
    });
  }

  // 7 ── Looking Ahead: call back to the villain's dumbest idea.
  const lookingAhead =
    callback ??
    pick(rng, [
      `Next month someone overpays, someone gets robbed in broad daylight, and someone swears they're "one move away." Dynasty Command will be here, taking names.`,
      `The board is set for an encore in ${recap.meta.leagueName}. The receipts never lie, the group chat never sleeps, and Dynasty Command never misses. See you next month.`,
    ]);

  const sections = [
    ...paras.map((p) => ({ title: "", body: p.body, claimIds: p.claimIds })),
    { title: "Looking Ahead", body: lookingAhead, claimIds: [] as string[] },
  ];

  return { headline, shareText, sections };
}

/** Stable identifier for the "model" field shown in the UI. */
export const TEMPLATE_NARRATOR_ID = "dynasty-command-recap-engine";
