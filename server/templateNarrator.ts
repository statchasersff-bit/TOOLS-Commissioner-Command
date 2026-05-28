/**
 * Commander's Report — the TEMPLATE NARRATOR.
 *
 * Turns the deterministic engine's RecapResult into a written, funny article
 * WITHOUT any LLM call. Every sentence is composed from real recap fields
 * (counts, awards, chaos score, manager stats, claim headlines), so the prose
 * is grounded by construction — it cannot invent trades, picks, or numbers.
 *
 * A seeded RNG drives word choice and phrase selection so reports vary between
 * leagues/months (and on "Regenerate") while staying deterministic for a given
 * seed. Tone shifts the vocabulary from neutral (commissioner_safe / analyst)
 * to spicy (light_roast / full_chaos) — but the humor always rides on the data,
 * never on personal attacks.
 */
import type { Article, RecapResult, ToneId, Claim, Award } from "./commandersReport";

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

// ── Tone profile ─────────────────────────────────────────────────────────────

interface ToneProfile {
  spicy: boolean; // full_chaos only — the theatrical, sarcastic roast-column voice
  jokes: boolean; // allowed to joke at all (light_roast + full_chaos)
}
const TONE_PROFILE: Record<ToneId, ToneProfile> = {
  commissioner_safe: { spicy: false, jokes: false },
  clean_analyst: { spicy: false, jokes: false },
  light_roast: { spicy: false, jokes: true },
  full_chaos: { spicy: true, jokes: true },
};

// ── Small grammar helpers ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const directionWord = (d: string) =>
  d === "contender" ? "win-now" : d === "rebuild" ? "rebuilding" : "middle-of-the-pack";

function awardByKey(recap: RecapResult, key: string): Award | undefined {
  return recap.awards.find((a) => a.key === key);
}
function claimsOfType(recap: RecapResult, type: Claim["claim_type"]): Claim[] {
  return recap.claims.filter((c) => c.claim_type === type);
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildHeadline(recap: RecapResult, tone: ToneId, rng: Rng): { text: string; claimIds: string[] } {
  const prof = TONE_PROFILE[tone];
  const reach = awardByKey(recap, "biggest_reach");
  const faab = awardByKey(recap, "largest_faab_spend");
  const trade = awardByKey(recap, "best_trade");
  const chaotic = awardByKey(recap, "most_chaotic");
  const ids: string[] = [];
  const cite = (key: string) => ids.push(`award-${key}`);

  // Pick the juiciest available storyline, biased toward spice when allowed.
  if (prof.jokes && reach) {
    cite("biggest_reach");
    const lines = prof.spicy
      ? [
          `${reach.manager} reached ${reach.detail} to draft ${reach.value}, a leap of faith the ADP sheet is still filing a complaint about.`,
          `${reach.manager} saw where ${reach.value} was supposed to go, added ${reach.detail}, and hit the pick anyway — conviction you can't teach and probably shouldn't.`,
        ]
      : [
          `${reach.manager} reached for the future like ADP was a polite suggestion.`,
          `${reach.manager} ran the rookie draft on vibes — and the vibes were expensive.`,
        ];
    return { text: pick(rng, lines), claimIds: ids };
  }
  if (prof.jokes && faab) {
    cite("largest_faab_spend");
    const lines = prof.spicy
      ? [
          `${faab.manager} set ${faab.detail} on fire for ${faab.value} and filed the ashes under "roster construction."`,
          `${faab.manager} spent ${faab.detail} on ${faab.value}, which is less a bid than a public statement.`,
        ]
      : [`${faab.manager} opened the FAAB wallet on ${faab.value} and never looked back.`];
    return { text: pick(rng, lines), claimIds: ids };
  }
  if (prof.jokes && chaotic) {
    cite("most_chaotic");
    return {
      text: prof.spicy
        ? `${chaotic.manager} spent the month auditioning for Most Chaotic Manager and refused to let anyone else read for the part.`
        : `${chaotic.manager} spent the month auditioning for Most Chaotic Manager — and got the part.`,
      claimIds: ids,
    };
  }
  if (trade) {
    cite("best_trade");
    return {
      text: prof.spicy
        ? `${trade.manager} won a trade so quietly the rest of the league is still pretending it didn't happen, ${trade.detail} richer.`
        : prof.jokes
        ? `${trade.manager} quietly won a trade while the rest of the league was busy refreshing the waiver wire.`
        : `${trade.manager} made the month's most lopsided trade, gaining a ${trade.detail}.`,
      claimIds: ids,
    };
  }
  // Fallback: chaos tier.
  ids.push("chaos-league");
  return {
    text: prof.spicy
      ? `${recap.meta.leagueName} posted ${recap.chaosScore.score}/100 on the Chaos Score and earned every single point of it.`
      : prof.jokes
      ? `${recap.meta.leagueName}: ${recap.chaosScore.tier} energy, ${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "trade")}, and a league chat that earned it.`
      : `${recap.period.label} recap for ${recap.meta.leagueName}: ${recap.chaosScore.tier}.`,
    claimIds: ids,
  };
}

function buildOverview(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } {
  const prof = TONE_PROFILE[tone];
  const { tradeRecap, waiverRecap, rookieRecap, chaosScore } = recap;
  const mostActive = awardByKey(recap, "most_active");
  const ids = ["chaos-league"];
  if (mostActive) ids.push("award-most_active");

  const totalMoves = tradeRecap.count + waiverRecap.count + rookieRecap.drafted;
  const opener = prof.spicy
    ? pick(rng, [
        `The smoke has cleared over ${recap.meta.leagueName}, and the wreckage is, frankly, beautiful.`,
        `Pour one out for the group chat: another month has rolled through ${recap.meta.leagueName}, and the notifications never stood a chance.`,
        `Gather around, because the month in ${recap.meta.leagueName} did not happen quietly.`,
      ])
    : prof.jokes
    ? pick(rng, [
        `The past month in ${recap.meta.leagueName} was less of an offseason and more of a group project where a few people did all the work.`,
        `${recap.meta.leagueName} had itself a month — the kind that keeps the group chat employed.`,
        `Another month in the books for ${recap.meta.leagueName}, and the receipts are in.`,
      ])
    : `Here is the ${recap.period.label} summary for ${recap.meta.leagueName}.`;

  const activity =
    totalMoves === 0
      ? prof.spicy
        ? "Except, plot twist: nothing happened at all — no trades, no waivers, no picks. A month so still you could hear the rosters gathering dust."
        : prof.jokes
        ? "It was quiet. Suspiciously quiet. The kind of quiet where Dynasty Command had to dig through the couch cushions for drama."
        : "Activity was minimal across trades, waivers, and the rookie draft."
      : prof.spicy
      ? `By the time the dust settled, ${tradeRecap.count} ${plural(tradeRecap.count, "trade")} had cleared${
          waiverRecap.totalFaab > 0 ? `, $${waiverRecap.totalFaab} of FAAB had evaporated on the wire` : `, the waiver wire had taken ${waiverRecap.count} ${plural(waiverRecap.count, "hit")}`
        }${rookieRecap.drafted > 0 ? `, and ${rookieRecap.drafted} rookie ${plural(rookieRecap.drafted, "pick")} had been added to the list of decisions everyone will relitigate at 1am` : ""}.`
      : `${tradeRecap.count} ${plural(tradeRecap.count, "trade")}, ${waiverRecap.count} waiver/FA ${plural(
          waiverRecap.count,
          "move",
        )}${waiverRecap.totalFaab > 0 ? ` and $${waiverRecap.totalFaab} of FAAB` : ""} changed hands${
          rookieRecap.drafted > 0 ? `, on top of a ${rookieRecap.drafted}-pick rookie draft` : ""
        }.`;

  const chaos = prof.spicy
    ? `The Chaos Score settled at ${chaosScore.score}/100 — officially "${chaosScore.tier}" — and the drivers read like an incident report: ${chaosScore.drivers.join(" ")}`
    : prof.jokes
    ? `The league's Chaos Score landed at ${chaosScore.score}/100 — officially "${chaosScore.tier}." ${chaosScore.drivers.join(" ")}`
    : `League Chaos Score: ${chaosScore.score}/100 (${chaosScore.tier}). ${chaosScore.drivers.join(" ")}`;

  const active = mostActive
    ? prof.spicy
      ? `${mostActive.manager} treated the transaction page like a stress ball, leading everyone with ${mostActive.value}.`
      : prof.jokes
      ? `${mostActive.manager} led the league in moves (${mostActive.value}), proving once again that doing the most is a personality.`
      : `${mostActive.manager} was the most active manager with ${mostActive.value}.`
    : "";

  return {
    title: "League Overview",
    body: [opener, activity, chaos, active].filter(Boolean).join(" "),
    claimIds: ids,
  };
}

function buildRookieSection(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } | null {
  if (recap.rookieRecap.drafted === 0) return null;
  const prof = TONE_PROFILE[tone];
  const reach = awardByKey(recap, "biggest_reach");
  const value = awardByKey(recap, "best_value");
  const rookieClaims = claimsOfType(recap, "rookie_pick").slice(0, 4);
  const ids = rookieClaims.map((c) => c.id);
  if (reach) ids.push("award-biggest_reach");
  if (value) ids.push("award-best_value");

  const parts: string[] = [];
  parts.push(
    prof.spicy
      ? pick(rng, [
          `The rookie draft was ${recap.rookieRecap.drafted} picks of pure self-belief, and at least one of them is going to need a support group by December.`,
          `${recap.rookieRecap.drafted} rookies came off the board, ranging from "sharp" to "what did we just watch," and we have it all on tape.`,
        ])
      : prof.jokes
      ? pick(rng, [
          `The rookie draft brought plenty of confidence, some genuine value, and a few picks that should probably be investigated by a wellness committee.`,
          `${recap.rookieRecap.drafted} rookie picks went off the board, ranging from "sharp" to "what did we just watch."`,
        ])
      : `${recap.rookieRecap.drafted} rookie picks were made this period.`,
  );
  if (value) {
    parts.push(
      prof.spicy
        ? `${value.manager} robbed the room blind, landing ${value.value} (${value.detail}) while everyone else was still scrolling their queue.`
        : prof.jokes
        ? `${value.manager} found the steal of the draft, landing ${value.value} (${value.detail}).`
        : `Best value: ${value.manager} selected ${value.value}, ${value.detail}.`,
    );
  }
  if (reach) {
    parts.push(
      prof.spicy
        ? `On the other end, ${reach.manager} took ${reach.value} a full ${reach.detail} early — less a reach than a hostage negotiation with the draft board.`
        : prof.jokes
        ? `${reach.manager}, meanwhile, reached for ${reach.value} (${reach.detail}) and dared anyone to question it.`
        : `Biggest reach: ${reach.manager} took ${reach.value}, ${reach.detail}.`,
    );
  }
  return { title: "Rookie Draft", body: parts.join(" "), claimIds: ids };
}

function buildTradeSection(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } {
  const prof = TONE_PROFILE[tone];
  if (recap.tradeRecap.count === 0) {
    return {
      title: "Trades",
      body: prof.spicy
        ? "Zero trades. The whole league hoarded its assets like the last lifeboat off a sinking ship and dared someone else to blink first. Nobody blinked."
        : prof.jokes
        ? "The trade market was a ghost town. Everyone clutched their assets like the last slice of pizza and dared someone else to move first."
        : "No trades were completed this period.",
      claimIds: [],
    };
  }
  const tradeClaims = claimsOfType(recap, "trade").slice(0, 3);
  const ids = tradeClaims.map((c) => c.id);
  const top = awardByKey(recap, "best_trade");
  if (top) ids.push("award-best_trade");

  const parts: string[] = [];
  parts.push(
    prof.spicy
      ? pick(rng, [
          `${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "trade")} crossed the wire, and at least one manager is going to wake up at 3am rereading the screen.`,
          `${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "deal")} got done, and not all of them will age like fine wine — some will age like milk.`,
        ])
      : prof.jokes
      ? pick(rng, [
          `${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "trade")} hit the wire, and not all of them will age gracefully.`,
          `The trade market woke up just long enough to produce ${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "deal")}.`,
        ])
      : `${recap.tradeRecap.count} ${plural(recap.tradeRecap.count, "trade")} were completed.`,
  );
  // Lead with the headline claim (most lopsided) verbatim — it's already factual.
  if (tradeClaims[0]) parts.push(tradeClaims[0].headline);
  if (top) {
    parts.push(
      prof.spicy
        ? `${top.manager} walked away with the better end of it (${top.detail}), the kind of edge that makes the other manager start rereading the trade screen to see what they missed.`
        : prof.jokes
        ? `${top.manager} walked away with the clearest edge (${top.detail}).`
        : `${top.manager} gained the most value (${top.detail}).`,
    );
  }
  return { title: "Trades", body: parts.join(" "), claimIds: ids };
}

function buildWaiverSection(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } {
  const prof = TONE_PROFILE[tone];
  if (recap.waiverRecap.count === 0) {
    return {
      title: "Waivers & FAAB",
      body: prof.spicy
        ? "The waiver wire sat there collecting dust. Everyone's either perfectly content or quietly given up, and in dynasty those two wear the exact same jersey."
        : prof.jokes
        ? "Nobody touched the waiver wire. Either everyone is content, or everyone has given up. In dynasty, those look identical."
        : "No waiver or free-agent activity this period.",
      claimIds: [],
    };
  }
  const faab = awardByKey(recap, "largest_faab_spend");
  const waiverClaims = claimsOfType(recap, "waiver");
  // Skip spicy claims that just re-describe the FAAB award's player (avoids
  // saying the same Geno-Smith bid twice in one paragraph).
  const spicyClaims = waiverClaims
    .filter((c) => c.severity === "spicy" && (!faab || !c.headline.includes(faab.value)))
    .slice(0, 2);
  const ids = [...spicyClaims.map((c) => c.id)];
  if (faab) ids.push("award-largest_faab_spend");

  const parts: string[] = [];
  parts.push(
    prof.spicy
      ? `${recap.waiverRecap.count} waiver/FA ${plural(recap.waiverRecap.count, "move")} went through${
          recap.waiverRecap.totalFaab > 0 ? `, with $${recap.waiverRecap.totalFaab} of FAAB lit on fire in the process` : ""
        }.`
      : prof.jokes
      ? `${recap.waiverRecap.count} waiver/FA ${plural(recap.waiverRecap.count, "move")} went through${
          recap.waiverRecap.totalFaab > 0 ? `, with $${recap.waiverRecap.totalFaab} of FAAB set on fire` : ""
        }.`
      : `${recap.waiverRecap.count} waiver/FA ${plural(recap.waiverRecap.count, "move")} were processed${
          recap.waiverRecap.totalFaab > 0 ? `, totaling $${recap.waiverRecap.totalFaab} of FAAB` : ""
        }.`,
  );
  if (faab) {
    parts.push(
      prof.spicy
        ? `${faab.manager} spent ${faab.detail} on ${faab.value}, which reads less like a bid and more like a public cry for help.`
        : prof.jokes
        ? `${faab.manager} made the splashiest bid: ${faab.detail} on ${faab.value}.`
        : `Largest FAAB spend: ${faab.manager}, ${faab.detail} on ${faab.value}.`,
    );
  }
  if (prof.jokes && spicyClaims[0]) parts.push(spicyClaims[0].headline);
  return { title: "Waivers & FAAB", body: parts.join(" "), claimIds: ids };
}

function buildSpotlight(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } | null {
  const prof = TONE_PROFILE[tone];
  // Most chaotic manager with real activity makes the best spotlight.
  const summaries = [...recap.managerSummaries].filter((m) => m.transactions > 0 || m.draftPicks > 0);
  if (summaries.length === 0) return null;
  const star = summaries.sort((a, b) => b.chaosScore - a.chaosScore)[0];
  const ids: string[] = [];
  const chaotic = awardByKey(recap, "most_chaotic");
  if (chaotic && chaotic.manager === star.manager) ids.push("award-most_chaotic");

  const statLine = `${star.transactions} ${plural(star.transactions, "transaction")} (${star.trades} ${plural(
    star.trades,
    "trade",
  )}, ${star.waivers} waiver ${plural(star.waivers, "move")})${star.faabSpent > 0 ? `, $${star.faabSpent} FAAB` : ""}${
    star.draftPicks > 0 ? `, ${star.draftPicks} rookie ${plural(star.draftPicks, "pick")}` : ""
  }`;

  const body = prof.spicy
    ? `Manager of the Month: ${star.manager}. ${statLine}. For a ${directionWord(
        star.direction,
      )} roster, that is ${star.reaches > 0 ? `${star.reaches} draft ${plural(star.reaches, "reach", "reaches")} and ` : ""}a whole lot of activity in search of a plan. We respect the commitment to motion, if not always the direction.`
    : prof.jokes
    ? `Manager of the Month: ${star.manager}. ${statLine}. A ${directionWord(
        star.direction,
      )} team that clearly believes standing still is for cowards.`
    : `Manager spotlight: ${star.manager} — ${statLine}. Roster direction: ${directionWord(star.direction)}.`;

  return { title: "Manager Spotlight", body, claimIds: ids };
}

function buildLookingAhead(recap: RecapResult, tone: ToneId, rng: Rng): { title: string; body: string; claimIds: string[] } {
  const prof = TONE_PROFILE[tone];
  const body = prof.spicy
    ? pick(rng, [
        `Next month, someone overpays, someone gets robbed in broad daylight, and someone declares they're "one move away" while sitting on a ${recap.chaosScore.score} chaos rating. Dynasty Command will be here, taking names.`,
        `The board is set for an encore in ${recap.meta.leagueName}. The receipts never lie, the group chat never sleeps, and we never miss. See you next month.`,
      ])
    : prof.jokes
    ? pick(rng, [
        "Next month brings more trades, more questionable FAAB bids, and at least one move that makes the group chat go quiet for a second. Dynasty Command will be watching, judging, and taking notes.",
        "The board is set for next month. Someone will overpay, someone will steal a deal, and someone will swear they're 'one move away.' See you then.",
      ])
    : `Dynasty Command will compile the next ${recap.meta.leagueName} briefing at the close of the following month.`;
  return { title: "Looking Ahead", body, claimIds: [] };
}

/**
 * A short, punchy line built for the share button / social caption. Returned
 * only for the joke tones (light_roast, full_chaos); the neutral tones get none.
 * Drawn from the juiciest available award so it always rides on a real number.
 */
function buildShareText(recap: RecapResult, tone: ToneId, rng: Rng): string | undefined {
  const prof = TONE_PROFILE[tone];
  if (!prof.jokes) return undefined;

  const faab = awardByKey(recap, "largest_faab_spend");
  const reach = awardByKey(recap, "biggest_reach");
  const trade = awardByKey(recap, "best_trade");
  const chaotic = awardByKey(recap, "most_chaotic");

  if (prof.spicy) {
    if (faab) return `${faab.manager} torched ${faab.detail} on ${faab.value}. The Commander's Report kept the receipts.`;
    if (reach) return `${reach.manager} reached ${reach.detail} for ${reach.value}. Full receipts inside.`;
    if (trade) return `${trade.manager} fleeced the league for ${trade.detail}. Don't take our word for it — read it.`;
    if (chaotic) return `${chaotic.manager} ran the month's chaos. ${recap.meta.leagueName} hit ${recap.chaosScore.score}/100 — somebody had to write it down.`;
    return `${recap.meta.leagueName} clocked ${recap.chaosScore.score}/100 on the Chaos Score. The Commander's Report has thoughts.`;
  }

  // light_roast — same idea, softer.
  if (trade) return `${trade.manager} won the month's best trade (${trade.detail}). The full ${recap.meta.leagueName} report is in.`;
  if (faab) return `${faab.manager} made the month's splashiest bid: ${faab.detail} on ${faab.value}. Read the full report.`;
  if (reach) return `${reach.manager} made the boldest pick of the rookie draft: ${reach.value}. See the full report.`;
  return `The ${recap.period.label} ${recap.meta.leagueName} report is in — Chaos Score ${recap.chaosScore.score}/100.`;
}

// ── Entry point ────────────────────────────────────────────────────────────────

/**
 * Build a written article from a recap, deterministically. `seed` controls the
 * random phrasing — pass a stable string for reproducible output, or vary it
 * (e.g. append a timestamp) to "reroll" on regenerate.
 */
export function narrateReportTemplate(recap: RecapResult, tone: ToneId, seed: string): Article {
  const rng = makeRng(seed);
  const headline = buildHeadline(recap, tone, rng);
  const shareText = buildShareText(recap, tone, rng);

  const sectionBuilders = [
    buildOverview(recap, tone, rng),
    buildRookieSection(recap, tone, rng),
    buildTradeSection(recap, tone, rng),
    buildWaiverSection(recap, tone, rng),
    buildSpotlight(recap, tone, rng),
    buildLookingAhead(recap, tone, rng),
  ];

  const sections = sectionBuilders
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({ title: s.title, body: s.body, claimIds: s.claimIds }));

  return { headline: headline.text, shareText, sections };
}

/** Stable identifier for the "model" field shown in the UI. */
export const TEMPLATE_NARRATOR_ID = "dynasty-command-recap-engine";
