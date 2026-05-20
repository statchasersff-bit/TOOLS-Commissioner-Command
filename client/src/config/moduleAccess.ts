/**
 * Centralized access requirements for Dynasty Command modules.
 *
 * Three levels, ordered weakest → strongest:
 *
 *   "public"   — anyone, no Sleeper or StatChasers identity required.
 *                Use only for modules that don't need a user (about, feedback,
 *                legal pages, public draft ADP).
 *
 *   "readonly" — a Sleeper username must be connected. This may be a
 *                StatChasers-account-linked Sleeper account (full mode) or a
 *                read-only public-API connection (no StatChasers login).
 *                Used for portfolio, my team, league analyzer, research.
 *
 *   "full"     — a StatChasers account is logged in AND an authenticated
 *                Sleeper token is attached. Required for action tools that
 *                mutate Sleeper state (lineup, waiver, trade actions).
 *
 * Keys use the existing `<tab>:<sub>` URL convention. Tab-only keys
 * (e.g. "about") match when a sub-tab is not specified.
 *
 * Do NOT scatter access checks throughout components — read from this map
 * via resolveAccess() so the policy lives in one place.
 */

export type AccessRequirement = "public" | "readonly" | "full";

export const MODULE_ACCESS: Record<string, AccessRequirement> = {
  // Command Center (Portfolio tab)
  "portfolio:connect": "public", // legacy connect screen — no gate
  "portfolio:portfolio-summary": "readonly",
  "portfolio:lineup-command": "full",
  "portfolio:waiver-command": "full",

  // My Team
  "dashboard:my-team": "readonly",
  "dashboard:share-team": "readonly",

  // League Analyzer
  "league-analyzer:power-rankings": "readonly",
  "league-analyzer:roster-comparison": "readonly",
  "league-analyzer:playoff-calculator": "readonly",
  "league-analyzer:transactions": "readonly",

  // Trade Center — entire module is full per spec
  "trade-center:trade-sync": "full",
  "trade-center:trade-database": "full",
  "trade-center:positional-analysis": "full",
  "trade-center:trade-calculator": "full",
  "trade-center:bulk-trade": "full",
  "trade-center:trade-block": "full",

  // Research (league-market)
  "league-market:analysis": "readonly",
  "league-market:market-value": "readonly",
  "league-market:compare-players": "readonly",

  // Draft — public ADP data + Sleeper draft tracker. Both require at
  // most a Sleeper username for the live tracker (which itself prompts
  // for a Sleeper connection on click), so the module-level requirement
  // is readonly. The Draft Board's inner Sleeper-token gate lives
  // inside the LiveDraft view.
  "draft:adp-explorer": "public",
  "draft:draft-board":  "readonly",

  // Static pages
  "about": "public",
  "feedback": "public",
  "terms": "public",
  "privacy": "public",
  "cookies": "public",
};

/** Default when a tab/sub is not in the map — fall back to readonly. */
const DEFAULT_ACCESS: AccessRequirement = "readonly";

/**
 * Resolve the access requirement for a tab/sub pair. Looks up
 * `<tab>:<sub>` first, then `<tab>` alone (for tab-only entries like
 * "about"), then falls back to DEFAULT_ACCESS.
 */
export function resolveAccess(tab: string, sub?: string): AccessRequirement {
  if (sub) {
    const key = `${tab}:${sub}`;
    if (key in MODULE_ACCESS) return MODULE_ACCESS[key];
  }
  if (tab in MODULE_ACCESS) return MODULE_ACCESS[tab];
  return DEFAULT_ACCESS;
}

/** Ordering helper: is `have` sufficient to satisfy `need`? */
const RANK: Record<AccessRequirement, number> = {
  public: 0,
  readonly: 1,
  full: 2,
};

export function satisfies(have: AccessRequirement, need: AccessRequirement): boolean {
  return RANK[have] >= RANK[need];
}
