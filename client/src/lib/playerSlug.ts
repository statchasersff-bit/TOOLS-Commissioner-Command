/**
 * Player URL slugs for /players/:playerId.
 *
 * Slug shape: `bijan-robinson-ATL-RB` (name-TEAM-POS). The route param accepts
 * either a slug OR a raw Sleeper id (numeric, or a DEF abbreviation like "ATL"),
 * and `resolvePlayerId` maps it back to the canonical Sleeper id using the
 * Sleeper player DB (Record<id, raw>).
 */

const NUMERIC = /^\d+$/;

function rawName(p: any): string {
  return (
    p?.full_name ||
    `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() ||
    ""
  );
}

/** Build a shareable slug. Name is lowercased/hyphenated; team & pos uppercased. */
export function toPlayerSlug(name?: string, team?: string | null, pos?: string | null): string {
  const n = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parts: string[] = [];
  if (n) parts.push(n);
  if (team) parts.push(String(team).toUpperCase());
  if (pos) parts.push(String(pos).toUpperCase());
  return parts.join("-") || (name || "");
}

/** Slug straight from a Sleeper DB row keyed by id, or null if unknown. */
export function slugForId(db: Record<string, any> | null, id: string): string | null {
  const p = db?.[id];
  if (!p) return null;
  return toPlayerSlug(rawName(p), p.team, p.position);
}

/**
 * Resolve a route param (slug or id) to a canonical Sleeper id.
 * Returns null when a slug can't be matched (caller renders not-found).
 */
export function resolvePlayerId(param: string, db: Record<string, any> | null): string | null {
  if (!param) return null;
  if (NUMERIC.test(param)) return param;          // numeric Sleeper id
  if (db && db[param]) return param;              // direct non-numeric id (e.g. DEF "ATL")
  if (!db) return null;                           // need the DB to resolve a slug

  const target = param.toLowerCase();

  // Exact name-team-pos slug match.
  for (const id in db) {
    const p = db[id];
    if (!p) continue;
    if (toPlayerSlug(rawName(p), p.team, p.position).toLowerCase() === target) return id;
  }

  // Name-only fallback (handles team changes since the URL was generated).
  const nameOnly = target.replace(/-(?:[a-z]{2,4})-(?:qb|rb|wr|te|k|def)$/i, "");
  for (const id in db) {
    const p = db[id];
    if (!p) continue;
    if (toPlayerSlug(rawName(p)).toLowerCase() === nameOnly) return id;
  }

  return null;
}
