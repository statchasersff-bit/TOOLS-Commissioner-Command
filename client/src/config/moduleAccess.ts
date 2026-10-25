/**
 * Centralized access requirements for Commissioner Command modules.
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
  // Command Center (Portfolio tab). The module opens with a Sleeper username.
  "portfolio:connect": "public", // legacy connect screen — no gate
  "portfolio:portfolio-summary": "readonly",
  "portfolio:finances": "readonly",

  // Lineup Integrity — standalone module (cross-league dashboard). A
  // Commissioner Command surface that self-resolves the commissioner's leagues
  // and shows its own connect prompt when none is loaded.
  "lineup-integrity:lineup-integrity": "readonly", // cross-league lineup integrity dashboard
  "lineup-integrity:league-audit": "readonly",     // Weekly audit — needs a league

  // League Analyzer
  "league-analyzer:league-activity": "readonly",    // Transactions live here as a sub-tab
  "league-analyzer:all-league-scan": "readonly",    // cross-league activity comparison
  "league-analyzer:managers": "readonly",           // cross-league manager directory
  "league-analyzer:commanders-report": "readonly",

  // Trade Center.
  "trade-center:trade-review": "readonly",          // Review Center — needs a league
  "trade-center:bulk-trade": "readonly",
  "trade-center:bulk-trades": "readonly",

  // Tools (draft) — public Sleeper data. The Draft Board (live Sleeper draft
  // tracker) is an action tool requiring a logged-in StatChasers account (full).
  "draft:pick-tracker": "public", // public Sleeper data; self-contained username/league-ID search
  "draft:dispersal-draft": "public", // self-contained: join via share code; creating a room requires login (enforced server-side)
  "draft:draft-board":  "full",
  "draft:user-search": "public",        // self-contained Sleeper lookup
  "draft:collusion-risk": "readonly",   // commissioner tool — scans two users' shared leagues

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
