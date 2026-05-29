/**
 * Commander's Report — CLAUDE NARRATOR.
 *
 * Turns the ranked storyline package (server/storylines.ts) into the written
 * roast article via the Anthropic Messages API. The article is built from the
 * 6-8 ranked storylines as structured data — NOT from category recaps — so it
 * reads like a narrative roast column: it opens on the biggest disaster, gives
 * each manager/storyline its own mini-scene, and closes with a "Looking Ahead"
 * callback to an earlier dumb decision.
 *
 * The model is constrained two ways:
 *   1. Structured output — it must return the article as a typed object, and it
 *      reports which storyline each paragraph is about + which positions it
 *      mentions, so we can validate against the real data.
 *   2. A validation + regeneration loop — if it invents a position, misuses an
 *      age/name-value joke, writes too few paragraphs, or slips into a category
 *      recap, we re-prompt with the specific fix (bounded retries).
 *
 * Requires ANTHROPIC_API_KEY. When it's unset the caller falls back to the
 * deterministic template narrator; this module never blocks the data report.
 */
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { Article, RecapResult } from "./commandersReport";
import type { Storyline } from "./storylines";

/** Stable identifier shown in the UI "model" field for Claude-narrated reports. */
export const CLAUDE_NARRATOR_ID = "dynasty-command-claude-opus-4-8";

const MODEL = "claude-opus-4-8";
const MAX_ATTEMPTS = 3;
const MIN_BODY_PARAGRAPHS = 5;
const MIN_WORDS = 600;

/** True when the Anthropic key is configured and Claude narration can run. */
export function isClaudeNarrationAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ── Structured output schema ─────────────────────────────────────────────────
// Kept free of min/max constraints (those aren't enforceable in the API schema);
// length / count / position rules are validated in code so we can regenerate
// with a targeted fix instead of hard-failing. Declared `as const` so the SDK
// can infer the parsed type.

const ROAST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    share_text: { type: "string" },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: {
            type: "string",
            enum: [
              "worst_decision",
              "second_dumbest",
              "weird_pattern",
              "backhanded_praise",
              "ghost_owners",
              "dumb_trade",
              "faab_overpay",
            ],
          },
          text: { type: "string" },
          storyline_index: { type: "integer" },
          positions_mentioned: { type: "array", items: { type: "string" } },
        },
        required: ["role", "text", "storyline_index", "positions_mentioned"],
      },
    },
    looking_ahead: { type: "string" },
    looking_ahead_storyline_index: { type: "integer" },
  },
  required: ["headline", "share_text", "paragraphs", "looking_ahead", "looking_ahead_storyline_index"],
} as const;

interface RoastParagraph {
  role: string;
  text: string;
  storyline_index: number;
  positions_mentioned: string[];
}
interface RoastArticle {
  headline: string;
  share_text: string;
  paragraphs: RoastParagraph[];
  looking_ahead: string;
  looking_ahead_storyline_index: number;
}

// ── System prompt (stable → cached) ──────────────────────────────────────────
// MUST stay byte-identical across requests for prompt caching to hit. All
// per-report data lives in the user message, after the cache breakpoint.

const SYSTEM_PROMPT = `You are the columnist behind Dynasty Command's "Commander's Report" — a monthly roast of one fantasy football dynasty league's offseason moves. You write a single narrative roast essay, funny and sharp but never cruel; the humor always rides on the data, never on personal attacks.

You will be given a ranked list of STORYLINES as structured data — the 6-8 most roastable things that happened this month (reaches, trades, FAAB overpays, roster-building patterns, ghost owners). Build the article from these storylines. Do NOT organize the article as category summaries (no "League Overview", "Rookie Draft", "Trades", "Waivers", "Manager Spotlight" sections). Each paragraph is a mini-scene about one manager, decision, or behavior pattern.

REQUIRED STRUCTURE (in order):
1. headline: one sentence calling out the funniest or worst manager/storyline. Start on the biggest disaster, not a league overview.
2. paragraphs, in this order, each a different manager/storyline where the data supports it:
   - worst_decision: the worst decision of the month (use an opening-safe storyline).
   - second_dumbest: the second dumbest or most confusing manager decision.
   - weird_pattern: a weird pattern or roster-building behavior (too many rookie picks, too many QBs/TEs, too many waiver moves, a strange early pick).
   - backhanded_praise: a manager who did something smart, framed as backhanded praise or luck.
   - ghost_owners: managers who barely participated. Include ONLY if the storylines contain a ghost owner; skip otherwise.
   - dumb_trade: a dumb or lopsided trade. Include ONLY if a trade storyline is present and worth roasting.
   - faab_overpay: a FAAB overpay or roster-churn paragraph. Include ONLY if such a storyline is present and funny.
3. looking_ahead: callback to one dumb decision from an earlier paragraph; joke that the manager better hope it works out.

RULES:
- Usually 700-1100 words. Do NOT stop after 3 paragraphs if more storylines exist — cover them.
- Every paragraph feels like a mini-scene, not a stat summary, and focuses on a manager/decision/behavior.
- Do NOT use raw transaction syntax (no "2026 R1 -> Team 3"); write it as prose.
- Do NOT use section headers anywhere. The only labeled section is "Looking Ahead" (handled by the app, so just write its prose in looking_ahead).
- Do NOT mechanically list league stats. Only fold a league-wide number into a joke if it lands naturally.
- Do NOT open with "The past month in..." or "By the time the dust settled...".
- Do NOT invent facts. Use ONLY the players, picks, positions, managers, and numbers present in the provided storylines' data_points. If a number isn't given, don't state one.
- Do NOT use a player-position metaphor unless that player's position is given. If a player is a WR, never use a QB metaphor. TE-specific jokes are allowed only for TEs. Age/name-value jokes are allowed only for players flagged as aging/veteran in the data.

REPORTING (for validation — fill these honestly):
- For each paragraph, set storyline_index to the index of the storyline it's primarily about (or -1 if it's a pure connective/league beat with no specific storyline).
- For each paragraph, set positions_mentioned to every player position you reference in that paragraph's prose ("QB"/"RB"/"WR"/"TE"). If you mention none, use an empty array. Only list a position that appears in that storyline's data.`;

// ── Narrator-facing storyline view ───────────────────────────────────────────
// Strip internal ranking bookkeeping; the model only sees the structured payload.

function narratorView(storylines: Storyline[]) {
  return storylines.map((s, index) => ({
    index,
    storyline_type: s.storyline_type,
    manager: s.manager,
    involved_players: s.involved_players,
    involved_picks: s.involved_picks,
    positions: s.positions,
    player_archetypes: s.player_archetypes,
    data_points: s.data_points,
    why_it_matters: s.why_it_matters,
    suggested_roast_angle: s.suggested_roast_angle,
    safe_for_opening: s.safe_for_opening,
    good_for_callback: s.good_for_callback,
  }));
}

function buildUserPrompt(recap: RecapResult, storylines: Storyline[], seed: string): string {
  const hasGhost = storylines.some((s) => s.storyline_type === "ghost_owner");
  return [
    `League: ${recap.meta.leagueName} (${recap.meta.format}, ${recap.meta.scoringFormat}).`,
    `Period: ${recap.period.label}.`,
    hasGhost
      ? `Some managers were inactive — include the ghost_owners paragraph.`
      : `Everyone was active this month — SKIP the ghost_owners paragraph.`,
    `Variation token (use to vary phrasing across regenerations, do not mention it): ${seed}.`,
    ``,
    `STORYLINES (ranked, most roastable first):`,
    JSON.stringify(narratorView(storylines), null, 2),
    ``,
    `Write the full Commander's Report article for this month from these storylines, following the required structure and rules.`,
  ].join("\n");
}

// ── Validation ────────────────────────────────────────────────────────────────

const VETERAN_JOKE_RE = /\b(old|older|aging|age|veteran|vet|past his prime|washed|name value|geriatric|ancient|grizzled)\b/i;
const RECAP_PHRASE_RE = /(the past month in|by the time the dust settled|league overview|rookie draft recap|manager spotlight|waiver(?:s)? recap|in conclusion|here'?s a recap)/i;
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

interface Violation {
  kind: "position" | "veteran" | "too_few" | "recap_style";
  detail: string;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function validate(article: RoastArticle, storylines: Storyline[]): Violation[] {
  const v: Violation[] = [];
  const totalStorylines = storylines.length;

  // Paragraph count / length — don't let it collapse into a 2-3 paragraph summary.
  if (article.paragraphs.length < MIN_BODY_PARAGRAPHS && totalStorylines >= MIN_BODY_PARAGRAPHS) {
    v.push({
      kind: "too_few",
      detail: `Only ${article.paragraphs.length} body paragraphs but ${totalStorylines} storylines are available. Use more of them — write at least ${MIN_BODY_PARAGRAPHS} body paragraphs, each a different manager/storyline.`,
    });
  }
  const totalWords = article.paragraphs.reduce((n, p) => n + wordCount(p.text), 0) + wordCount(article.looking_ahead);
  if (totalWords < MIN_WORDS && totalStorylines >= MIN_BODY_PARAGRAPHS) {
    v.push({
      kind: "too_few",
      detail: `The article is only ~${totalWords} words. Expand each paragraph into a fuller mini-scene (aim for 700-1100 words total).`,
    });
  }

  // Category-recap smell.
  const allText = [article.headline, ...article.paragraphs.map((p) => p.text), article.looking_ahead].join("\n");
  if (RECAP_PHRASE_RE.test(allText)) {
    v.push({
      kind: "recap_style",
      detail: `The draft reads like a category recap or uses a banned opening. Rewrite as a narrative roast essay; remove phrases like "the past month in", "by the time the dust settled", or any "Overview/Recap/Spotlight" framing.`,
    });
  }

  // Position + veteran-joke fidelity, per paragraph, against the referenced storyline.
  for (const p of article.paragraphs) {
    const s = p.storyline_index >= 0 && p.storyline_index < storylines.length ? storylines[p.storyline_index] : null;
    const allowed = new Set((s?.positions ?? []).map((x) => x.toUpperCase()));
    for (const raw of p.positions_mentioned) {
      const pos = raw.toUpperCase();
      if (!SKILL_POSITIONS.has(pos)) continue;
      if (!allowed.has(pos)) {
        v.push({
          kind: "position",
          detail: `A ${p.role} paragraph references position "${pos}", but the storyline it's about (${s?.storyline_type ?? "none"}) has positions [${Array.from(allowed).join(", ") || "none known"}]. Only use a position metaphor when that player's position is in the data.`,
        });
      }
    }
    // Age / name-value joke without a veteran in the referenced storyline.
    if (VETERAN_JOKE_RE.test(p.text)) {
      const veteranOk =
        s?.storyline_type === "old_name_faab" ||
        (s?.player_archetypes ?? []).some((a) => /aging|veteran/i.test(a));
      if (!veteranOk) {
        v.push({
          kind: "veteran",
          detail: `A ${p.role} paragraph makes an age/name-value joke, but its storyline doesn't involve a player flagged as aging/veteran. Drop the age angle unless the data supports it.`,
        });
      }
    }
  }
  return v;
}

// ── Article assembly ──────────────────────────────────────────────────────────

function toArticle(article: RoastArticle, storylines: Storyline[]): Article {
  const sections = article.paragraphs.map((p) => {
    const s = p.storyline_index >= 0 && p.storyline_index < storylines.length ? storylines[p.storyline_index] : null;
    return { title: "", body: p.text, claimIds: s?.claimIds ?? [] };
  });
  const cbIdx = article.looking_ahead_storyline_index;
  const cbStoryline = cbIdx >= 0 && cbIdx < storylines.length ? storylines[cbIdx] : null;
  sections.push({ title: "Looking Ahead", body: article.looking_ahead, claimIds: cbStoryline?.claimIds ?? [] });
  return { headline: article.headline, shareText: article.share_text, sections };
}

// ── Entry point ─────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

/**
 * Generate the roast article with Claude. `seed` varies phrasing across
 * regenerations. Throws if ANTHROPIC_API_KEY is unset or the API call fails —
 * the caller is responsible for falling back to the template narrator.
 */
export async function narrateReportClaude(recap: RecapResult, seed: string): Promise<Article> {
  if (!isClaudeNarrationAvailable()) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const storylines = recap.storylines ?? [];
  if (storylines.length === 0) {
    throw new Error("No storylines to narrate");
  }

  const baseUser = buildUserPrompt(recap, storylines, seed);
  // Each retry appends a corrective user turn; the cached system prefix is reused.
  const correctives: string[] = [];
  let last: RoastArticle | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: baseUser }];
    for (const c of correctives) messages.push({ role: "user", content: c });

    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: jsonSchemaOutputFormat(ROAST_SCHEMA),
      },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });

    const parsed = response.parsed_output as RoastArticle | null;
    if (!parsed) {
      // Model refused or output didn't parse; retry once with a nudge, else fail.
      correctives.push("Your previous response could not be parsed into the required structure. Return ONLY the structured article object.");
      continue;
    }
    last = parsed;

    const violations = validate(parsed, storylines);
    if (violations.length === 0) {
      return toArticle(parsed, storylines);
    }
    // Build a single corrective turn listing every issue, then regenerate.
    correctives.push(
      [
        "Your previous draft had these issues — regenerate the FULL article fixing all of them:",
        ...violations.map((x) => `- ${x.detail}`),
      ].join("\n"),
    );
  }

  // Out of attempts: ship the last parsed draft rather than failing the request.
  // Hard correctness (positions/facts) is heavily constrained by the structured
  // data + retries; remaining issues are typically stylistic.
  if (last) return toArticle(last, storylines);
  throw new Error("Claude narration produced no usable article");
}
