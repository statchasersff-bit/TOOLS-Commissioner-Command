/**
 * Shorten a player's display name to "First-initial. Last-name", preserving
 * compound last names and suffixes:
 *   "CeeDee Lamb"          -> "C. Lamb"
 *   "Bijan Robinson"       -> "B. Robinson"
 *   "Amon-Ra St. Brown"    -> "A. St. Brown"
 *   "Marvin Harrison Jr."  -> "M. Harrison Jr."
 *   "Jaxon Smith-Njigba"   -> "J. Smith-Njigba"
 * Single-token names (e.g. a team defense) are returned unchanged.
 */
export function getShortPlayerName(fullName?: string | null): string {
  if (!fullName) return "";
  const cleaned = fullName.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length === 1) return cleaned;
  const firstName = parts[0];
  const lastNameParts = parts.slice(1);
  return `${firstName.charAt(0)}. ${lastNameParts.join(" ")}`;
}

export type PlayerNameMode = "full" | "initial" | "last";

/**
 * Format a player name at a chosen verbosity:
 *   "full"    → "CeeDee Lamb"        (desktop / tablet)
 *   "initial" → "C. Lamb"            (mobile)        — same as getShortPlayerName
 *   "last"    → "Lamb"               (very small mobile)
 * Single-token names (team defenses) are returned unchanged in every mode.
 * Always pair with `title={fullName}` so the full name stays discoverable.
 */
export function formatPlayerName(name?: string | null, mode: PlayerNameMode = "full"): string {
  if (!name) return "";
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (mode === "full") return cleaned;
  const parts = cleaned.split(" ");
  if (parts.length === 1) return cleaned;
  if (mode === "initial") return getShortPlayerName(cleaned);
  // "last": keep trailing suffix attached (Jr./Sr./II/III) so it stays meaningful.
  const SUFFIXES = new Set(["jr.", "jr", "sr.", "sr", "ii", "iii", "iv", "v"]);
  const last = parts[parts.length - 1];
  if (parts.length >= 3 && SUFFIXES.has(last.toLowerCase())) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}

/**
 * Pick a name mode from an available width (container or viewport):
 *   < 360px → "last", < 640px → "initial", else "full".
 */
export function nameModeForWidth(width: number): PlayerNameMode {
  if (width > 0 && width < 360) return "last";
  if (width > 0 && width < 640) return "initial";
  return "full";
}
