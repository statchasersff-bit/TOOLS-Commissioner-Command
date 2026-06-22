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
 *                Used for portfolio summary, my team, league analyzer, and the
 *                trade Finder / Calculator surfaces.
 *
 *   "full"     — a StatChasers account is logged in AND an authenticated
 *                Sleeper token is attached. Required for action tools:
 *                Lineup Command, My Trades, and the Draft Board.
 *
 * Keys use the existing `<tab>:<sub>` URL convention. Tab-only keys
 * (e.g. "about") match when a sub-tab is not specified.
 *
 * Do NOT scatter access checks throughout components — read from this map
 * via resolveAccess() so the policy lives in one place.
 */

export type AccessRequirement = "public" | "readonly" | "full";

export const MODULE_ACCESS: Record<string, AccessRequirement> = {
  // Command Center (Portfolio tab). The module opens with a Sleeper username;
  // Lineup Command is an action tool that requires a logged-in
  // StatChasers account (full).
  "portfolio:connect": "public", // legacy connect screen — no gate
  "portfolio:portfolio-summary": "readonly",
  "portfolio:finances": "readonly",
  "portfolio:lineup-command": "full",

  // Lineup Integrity — standalone module (cross-league dashboard). A
  // Commissioner Command surface that self-resolves the commissioner's leagues
  // and shows its own connect prompt when none is loaded.
  "lineup-integrity:lineup-integrity": "readonly", // cross-league lineup integrity dashboard
  "lineup-integrity:league-audit": "readonly",     // Weekly audit — needs a league

  // League Analyzer
  "league-analyzer:league-activity": "readonly",    // Transactions live here as a sub-tab
  "league-analyzer:commanders-report": "readonly",

  // Trade Center. Calculator is a league-scoped analytic — it can't render
  // without a loaded league, so it needs at least a connected Sleeper username
  // (readonly).
  "trade-center:trade-calculator": "readonly",      // Calculator
  "trade-center:trade-review": "readonly",          // Review Center — needs a league
  "trade-center:bulk-trade": "readonly",
  "trade-center:bulk-trades": "readonly",

  // Research (league-market). Market Value is league-scoped, so it needs a
  // Sleeper username (readonly). User Search is a self-contained lookup.
  "league-market:user-search": "public",        // self-contained Sleeper lookup
  "league-market:market-value": "readonly",    // needs a league

  // Draft — ADP data is public. The Draft Board (live Sleeper draft tracker) is
  // an action tool requiring a logged-in StatChasers account (full).
  "draft:adp-explorer": "public",
  "draft:player-availability": "public", // ADP-derived (startup + rookie toggle), no league required
  "draft:pick-tracker": "public", // public Sleeper data; self-contained username/league-ID search
  "draft:draft-board":  "full",

  // Static pages
  "about": "public",
  "feedback": "public",
  "redraft-command": "public",
  "manage-account": "public",
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
