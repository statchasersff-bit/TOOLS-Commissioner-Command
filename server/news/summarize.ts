/**
 * AI fact-extraction + summarization for curated player news.
 *
 * The model is given ONLY material from an original credited source (a primary
 * feed item, plus an optional excerpt fetched from that same source when robots
 * permit). It returns (a) the structured facts it extracted — kept verbatim in
 * `raw_facts_json` for the audit trail — and (b) ORIGINAL Dynasty Command prose
 * (headline / summary / fantasy impact / category) written from those facts.
 *
 * Hard rules baked into the prompt: never copy or closely paraphrase the source
 * wording, never invent facts not present in the input, and never treat the
 * input as anything other than the named credited source. Discovery-only feeds
 * (e.g. RotoWire) are NEVER passed in here.
 *
 * Requires ANTHROPIC_API_KEY; callers fall back to a link-only `needs_review`
 * item when the key is missing or the call fails.
 */
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

export const NEWS_AI_MODEL = "claude-opus-4-8";

export const NEWS_CATEGORIES = [
  "injury",
  "transaction",
  "depth_chart",
  "practice",
  "quote",
  "performance",
  "other",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** The factual extraction kept in raw_facts_json (audit trail). */
export interface ExtractedFacts {
  injury_status: string | null;
  transaction: string | null;
  coach_quote: string | null;
  expected_timeline: string | null;
  practice_participation: string | null;
  depth_chart_change: string | null;
}

export interface SummaryResult {
  headline: string;
  summary: string;
  fantasyImpact: string;
  category: NewsCategory;
  facts: ExtractedFacts;
  model: string;
}

export interface SummaryInput {
  playerName: string;
  team: string | null;
  position: string | null;
  /** Credited source the material came from (e.g. "ESPN"). */
  sourceName: string;
  /** The source's own headline/title (from its public feed). */
  sourceTitle: string;
  /** The source's own short syndicated summary, if any. */
  sourceSnippet: string | null;
  /** Plain-text excerpt fetched from the source page (robots-permitting), if any. */
  sourceExcerpt: string | null;
}

/** True when the Anthropic key is configured and summarization can run. */
export function isNewsAiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "object",
      additionalProperties: false,
      properties: {
        injury_status: { type: ["string", "null"] },
        transaction: { type: ["string", "null"] },
        coach_quote: { type: ["string", "null"] },
        expected_timeline: { type: ["string", "null"] },
        practice_participation: { type: ["string", "null"] },
        depth_chart_change: { type: ["string", "null"] },
      },
      required: [
        "injury_status",
        "transaction",
        "coach_quote",
        "expected_timeline",
        "practice_participation",
        "depth_chart_change",
      ],
    },
    headline: { type: "string" },
    summary: { type: "string" },
    fantasy_impact: { type: "string" },
    category: { type: "string", enum: NEWS_CATEGORIES as unknown as string[] },
    has_usable_news: { type: "boolean" },
  },
  required: ["facts", "headline", "summary", "fantasy_impact", "category", "has_usable_news"],
} as const;

interface SummaryModelOutput {
  facts: ExtractedFacts;
  headline: string;
  summary: string;
  fantasy_impact: string;
  category: NewsCategory;
  has_usable_news: boolean;
}

// Stable system prompt → prompt-cache hit across items. All per-item data goes
// in the user message after the cache breakpoint.
const SYSTEM_PROMPT = `You are the player-news editor for Dynasty Command, a fantasy/dynasty football product. You turn raw material from a single, named, credited news source into a short ORIGINAL news item for our player pages.

You will be given: the player's name/team/position, the name of the credited SOURCE, and that source's own title plus an optional excerpt of its text.

Your job has two steps:

STEP 1 — EXTRACT FACTS. From the provided source material ONLY, pull the concrete, verifiable facts into these fields (use null when the source doesn't state it):
- injury_status: the named injury and its status (e.g. "hamstring, questionable")
- transaction: signing/trade/release/activation/IR move, if any
- coach_quote: a relevant quote ATTRIBUTED to a coach/GM/player in the source (capture meaning; do not copy long verbatim passages)
- expected_timeline: any return/availability timeline stated
- practice_participation: DNP / limited / full, or practice-squad notes
- depth_chart_change: any starter/role/snap-share change stated

STEP 2 — WRITE ORIGINAL COPY from those facts:
- headline: a concise, original Dynasty Command headline (<= 80 chars). Do NOT reuse the source's headline wording.
- summary: 1-2 plain sentences stating what happened, in your own words.
- fantasy_impact: exactly 1 sentence on the dynasty/fantasy impact (start/sit, role, dynasty value).
- category: one of injury | transaction | depth_chart | practice | quote | performance | other.

ABSOLUTE RULES:
- Write in your OWN words. Never copy or closely paraphrase the source's sentences. No verbatim spans beyond a short attributed quote.
- Never state a fact the source material does not support. Do not speculate beyond the source. If the source is too thin to support a real news item, set has_usable_news=false and still fill the fields as best you can with what little exists.
- Do not mention any source other than the one named. Do not invent a source.
- Be neutral and factual; the fantasy_impact sentence is the only place for light analysis.`;

function buildUserPrompt(input: SummaryInput): string {
  const lines: string[] = [];
  lines.push(`PLAYER: ${input.playerName}${input.position ? ` (${input.position}` : ""}${input.team ? `${input.position ? ", " : " ("}${input.team}` : ""}${input.position || input.team ? ")" : ""}`);
  lines.push(`CREDITED SOURCE: ${input.sourceName}`);
  lines.push("");
  lines.push("=== SOURCE MATERIAL (from the credited source above) ===");
  lines.push(`Title: ${input.sourceTitle}`);
  if (input.sourceSnippet) lines.push(`Summary: ${input.sourceSnippet}`);
  if (input.sourceExcerpt) {
    lines.push("Excerpt:");
    lines.push(input.sourceExcerpt);
  }
  lines.push("=== END SOURCE MATERIAL ===");
  return lines.join("\n");
}

/**
 * Run extraction + summarization. Returns null when the model judges there is no
 * usable news in the material (caller drops the item or routes to review), and
 * throws when the API is unavailable/errors (caller falls back to link-only).
 */
export async function summarizeFromSource(input: SummaryInput): Promise<SummaryResult | null> {
  if (!isNewsAiAvailable()) throw new Error("ANTHROPIC_API_KEY is not configured");

  const response = await client().messages.parse({
    model: NEWS_AI_MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: jsonSchemaOutputFormat(SUMMARY_SCHEMA),
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const out = response.parsed_output as SummaryModelOutput | null;
  if (!out) throw new Error("news summarization returned no parseable output");
  if (!out.has_usable_news) return null;

  const headline = out.headline?.trim();
  const summary = out.summary?.trim();
  if (!headline || !summary) return null;

  return {
    headline,
    summary,
    fantasyImpact: out.fantasy_impact?.trim() || "",
    category: NEWS_CATEGORIES.includes(out.category) ? out.category : "other",
    facts: out.facts,
    model: NEWS_AI_MODEL,
  };
}
