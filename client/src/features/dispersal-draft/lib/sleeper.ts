/**
 * Extract a Sleeper player thumbnail URL from an asset's notes field.
 * Notes format: "From: Team Name · slpid:{player_id}"
 */
export function sleeperThumb(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/slpid:(\w+)/);
  if (!match) return null;
  return `https://sleepercdn.com/content/nfl/players/thumb/${match[1]}.jpg`;
}

/**
 * Sleeper user avatar thumbnail URL.
 * avatarId comes from SleeperUser.avatar field.
 */
export function sleeperAvatarUrl(avatarId: string | null | undefined): string | null {
  if (!avatarId) return null;
  return `https://sleepercdn.com/avatars/thumbs/${avatarId}`;
}

/**
 * Tailwind text color class for a given NFL position.
 */
export function positionColor(position: string | null | undefined): string {
  switch (position?.toUpperCase()) {
    case "WR": return "text-blue-600 dark-any:text-blue-400";
    case "RB": return "text-emerald-600 dark-any:text-emerald-400";
    case "TE": return "text-amber-600 dark-any:text-amber-400";
    case "QB": return "text-red-600 dark-any:text-red-400";
    default:   return "text-muted-foreground";
  }
}

/**
 * Tailwind bg color class for the position accent bar.
 */
export function positionBarColor(position: string | null | undefined): string {
  switch (position?.toUpperCase()) {
    case "WR": return "bg-blue-500";
    case "RB": return "bg-emerald-500";
    case "TE": return "bg-amber-500";
    case "QB": return "bg-red-500";
    default:   return "bg-muted-foreground/40";
  }
}

/**
 * Tailwind bg + text classes for a position avatar circle.
 */
export function positionAvatarStyle(position: string | null | undefined): string {
  switch (position?.toUpperCase()) {
    case "WR": return "bg-blue-500/15 text-blue-600 dark-any:text-blue-400";
    case "RB": return "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400";
    case "TE": return "bg-amber-500/15 text-amber-600 dark-any:text-amber-400";
    case "QB": return "bg-red-500/15 text-red-600 dark-any:text-red-400";
    default:   return "bg-muted text-muted-foreground";
  }
}

/**
 * Sleeper team logo URL for a given NFL team abbreviation.
 * e.g. "TEN" → https://sleepercdn.com/images/team_logos/nfl/ten.png
 */
export function sleeperTeamLogo(team: string | null | undefined): string | null {
  if (!team) return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
}
