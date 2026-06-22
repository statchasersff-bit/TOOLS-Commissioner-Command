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
    case "WR": return "text-blue-400";
    case "RB": return "text-green-400";
    case "TE": return "text-yellow-400";
    case "QB": return "text-red-400";
    default:   return "text-muted-foreground";
  }
}

/**
 * Tailwind bg color class for the position accent bar.
 */
export function positionBarColor(position: string | null | undefined): string {
  switch (position?.toUpperCase()) {
    case "WR": return "bg-blue-400";
    case "RB": return "bg-green-400";
    case "TE": return "bg-yellow-400";
    case "QB": return "bg-red-400";
    default:   return "bg-muted-foreground/40";
  }
}

/**
 * Tailwind bg + text classes for a position avatar circle.
 */
export function positionAvatarStyle(position: string | null | undefined): string {
  switch (position?.toUpperCase()) {
    case "WR": return "bg-blue-400/15 text-blue-400";
    case "RB": return "bg-green-400/15 text-green-400";
    case "TE": return "bg-yellow-400/15 text-yellow-400";
    case "QB": return "bg-red-400/15 text-red-400";
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
