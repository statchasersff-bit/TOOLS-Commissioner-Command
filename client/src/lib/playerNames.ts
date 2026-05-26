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
