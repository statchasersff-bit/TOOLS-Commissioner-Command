// All 32 NFL teams, with brand colors and a tasteful per-team greeting
// subtitle used by the DashboardGreeting card. Colors taken from each team's
// public brand identity; secondary colors lean white/gold/black so they read
// against either light or dark mode without needing per-mode overrides.

export interface NflTeam {
  abbreviation: string;       // e.g. "ATL"
  name: string;               // full name, e.g. "Atlanta Falcons"
  shortName: string;          // mascot, e.g. "Falcons"
  primaryColor: string;       // hex, e.g. "#A71930"
  secondaryColor: string;     // hex
  /** Sleeper hosts NFL team logos by lowercased abbreviation. */
  logoUrl: string;
  /** Greeting subtitle used when this team is the user's favorite. */
  greeting: string;
}

/**
 * Build the standard Sleeper CDN logo URL. Kept centralized so swapping
 * sources later (e.g. self-hosted assets) is a one-line change.
 */
function logoFor(abbr: string): string {
  return `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`;
}

export const NFL_TEAMS: NflTeam[] = [
  { abbreviation: "ARI", name: "Arizona Cardinals",     shortName: "Cardinals",  primaryColor: "#97233F", secondaryColor: "#000000", logoUrl: logoFor("ARI"), greeting: "Rise up, Red Sea. Your command center is ready." },
  { abbreviation: "ATL", name: "Atlanta Falcons",       shortName: "Falcons",    primaryColor: "#A71930", secondaryColor: "#000000", logoUrl: logoFor("ATL"), greeting: "Rise up. Your command center is ready." },
  { abbreviation: "BAL", name: "Baltimore Ravens",      shortName: "Ravens",     primaryColor: "#241773", secondaryColor: "#9E7C0C", logoUrl: logoFor("BAL"), greeting: "Never less. Your command center is ready." },
  { abbreviation: "BUF", name: "Buffalo Bills",         shortName: "Bills",      primaryColor: "#00338D", secondaryColor: "#C60C30", logoUrl: logoFor("BUF"), greeting: "Circle the wagons. Your command center is ready." },
  { abbreviation: "CAR", name: "Carolina Panthers",     shortName: "Panthers",   primaryColor: "#0085CA", secondaryColor: "#101820", logoUrl: logoFor("CAR"), greeting: "Keep pounding. Your command center is ready." },
  { abbreviation: "CHI", name: "Chicago Bears",         shortName: "Bears",      primaryColor: "#0B162A", secondaryColor: "#C83803", logoUrl: logoFor("CHI"), greeting: "Bear down. Your command center is ready." },
  { abbreviation: "CIN", name: "Cincinnati Bengals",    shortName: "Bengals",    primaryColor: "#FB4F14", secondaryColor: "#000000", logoUrl: logoFor("CIN"), greeting: "Who Dey?! Your command center is ready." },
  { abbreviation: "CLE", name: "Cleveland Browns",      shortName: "Browns",     primaryColor: "#311D00", secondaryColor: "#FF3C00", logoUrl: logoFor("CLE"), greeting: "Welcome to the Dawg Pound. Your command center is ready." },
  { abbreviation: "DAL", name: "Dallas Cowboys",        shortName: "Cowboys",    primaryColor: "#003594", secondaryColor: "#869397", logoUrl: logoFor("DAL"), greeting: "How 'bout them Cowboys! Your command center is ready." },
  { abbreviation: "DEN", name: "Denver Broncos",        shortName: "Broncos",    primaryColor: "#FB4F14", secondaryColor: "#002244", logoUrl: logoFor("DEN"), greeting: "United in orange. Your command center is ready." },
  { abbreviation: "DET", name: "Detroit Lions",         shortName: "Lions",      primaryColor: "#0076B6", secondaryColor: "#B0B7BC", logoUrl: logoFor("DET"), greeting: "One Pride. Your command center is ready." },
  { abbreviation: "GB",  name: "Green Bay Packers",     shortName: "Packers",    primaryColor: "#203731", secondaryColor: "#FFB612", logoUrl: logoFor("GB"),  greeting: "Go Pack Go! Your command center is ready." },
  { abbreviation: "HOU", name: "Houston Texans",        shortName: "Texans",     primaryColor: "#03202F", secondaryColor: "#A71930", logoUrl: logoFor("HOU"), greeting: "Bulls on parade. Your command center is ready." },
  { abbreviation: "IND", name: "Indianapolis Colts",    shortName: "Colts",      primaryColor: "#002C5F", secondaryColor: "#A2AAAD", logoUrl: logoFor("IND"), greeting: "For the show. Your command center is ready." },
  { abbreviation: "JAX", name: "Jacksonville Jaguars",  shortName: "Jaguars",    primaryColor: "#006778", secondaryColor: "#D7A22A", logoUrl: logoFor("JAX"), greeting: "DUUUUUVAL! Your command center is ready." },
  { abbreviation: "KC",  name: "Kansas City Chiefs",    shortName: "Chiefs",     primaryColor: "#E31837", secondaryColor: "#FFB81C", logoUrl: logoFor("KC"),  greeting: "Chiefs Kingdom. Your command center is ready." },
  { abbreviation: "LV",  name: "Las Vegas Raiders",     shortName: "Raiders",    primaryColor: "#000000", secondaryColor: "#A5ACAF", logoUrl: logoFor("LV"),  greeting: "Raider Nation. Your command center is ready." },
  { abbreviation: "LAC", name: "Los Angeles Chargers",  shortName: "Chargers",   primaryColor: "#0080C6", secondaryColor: "#FFC20E", logoUrl: logoFor("LAC"), greeting: "Bolt up. Your command center is ready." },
  { abbreviation: "LAR", name: "Los Angeles Rams",      shortName: "Rams",       primaryColor: "#003594", secondaryColor: "#FFA300", logoUrl: logoFor("LAR"), greeting: "Horns up. Your command center is ready." },
  { abbreviation: "MIA", name: "Miami Dolphins",        shortName: "Dolphins",   primaryColor: "#008E97", secondaryColor: "#FC4C02", logoUrl: logoFor("MIA"), greeting: "Fins up! Your command center is ready." },
  { abbreviation: "MIN", name: "Minnesota Vikings",     shortName: "Vikings",    primaryColor: "#4F2683", secondaryColor: "#FFC62F", logoUrl: logoFor("MIN"), greeting: "SKOL! Your command center is ready." },
  { abbreviation: "NE",  name: "New England Patriots",  shortName: "Patriots",   primaryColor: "#002244", secondaryColor: "#C60C30", logoUrl: logoFor("NE"),  greeting: "Do your job. Your command center is ready." },
  { abbreviation: "NO",  name: "New Orleans Saints",    shortName: "Saints",     primaryColor: "#101820", secondaryColor: "#D3BC8D", logoUrl: logoFor("NO"),  greeting: "Who Dat?! Your command center is ready." },
  { abbreviation: "NYG", name: "New York Giants",       shortName: "Giants",     primaryColor: "#0B2265", secondaryColor: "#A71930", logoUrl: logoFor("NYG"), greeting: "G-Men. Your command center is ready." },
  { abbreviation: "NYJ", name: "New York Jets",         shortName: "Jets",       primaryColor: "#125740", secondaryColor: "#FFFFFF", logoUrl: logoFor("NYJ"), greeting: "J-E-T-S — Jets! Jets! Jets! Your command center is ready." },
  { abbreviation: "PHI", name: "Philadelphia Eagles",   shortName: "Eagles",     primaryColor: "#004C54", secondaryColor: "#A5ACAF", logoUrl: logoFor("PHI"), greeting: "Fly, Eagles, Fly. Your command center is ready." },
  { abbreviation: "PIT", name: "Pittsburgh Steelers",   shortName: "Steelers",   primaryColor: "#FFB612", secondaryColor: "#101820", logoUrl: logoFor("PIT"), greeting: "Whatever it takes. Your command center is ready." },
  { abbreviation: "SEA", name: "Seattle Seahawks",      shortName: "Seahawks",   primaryColor: "#002244", secondaryColor: "#69BE28", logoUrl: logoFor("SEA"), greeting: "Uhhhh… Go Hawks? Your command center is ready." },
  { abbreviation: "SF",  name: "San Francisco 49ers",   shortName: "49ers",      primaryColor: "#AA0000", secondaryColor: "#B3995D", logoUrl: logoFor("SF"),  greeting: "Faithful to the Bay. Your command center is ready." },
  { abbreviation: "TB",  name: "Tampa Bay Buccaneers",  shortName: "Buccaneers", primaryColor: "#D50A0A", secondaryColor: "#FF7900", logoUrl: logoFor("TB"),  greeting: "Fire the cannons! Your command center is ready." },
  { abbreviation: "TEN", name: "Tennessee Titans",      shortName: "Titans",     primaryColor: "#0C2340", secondaryColor: "#4B92DB", logoUrl: logoFor("TEN"), greeting: "Titan up! Your command center is ready." },
  { abbreviation: "WAS", name: "Washington Commanders", shortName: "Commanders", primaryColor: "#5A1414", secondaryColor: "#FFB612", logoUrl: logoFor("WAS"), greeting: "Hail to the Commanders! Your command center is ready." },
];

const NFL_TEAM_BY_ABBR: Record<string, NflTeam> = NFL_TEAMS.reduce((acc, t) => {
  acc[t.abbreviation] = t;
  return acc;
}, {} as Record<string, NflTeam>);

/** Lookup by abbreviation. Returns null for unknown or empty abbreviations. */
export function getFavoriteTeamTheme(abbr: string | null | undefined): NflTeam | null {
  if (!abbr) return null;
  return NFL_TEAM_BY_ABBR[abbr.toUpperCase()] ?? null;
}

/** Validate that a string is a known team abbreviation. */
export function isValidNflTeamAbbr(abbr: string | null | undefined): boolean {
  return !!abbr && abbr.toUpperCase() in NFL_TEAM_BY_ABBR;
}

/**
 * Extract the short slogan portion of a greeting — everything before the
 * shared " Your command center is ready." closer. Used by the loading
 * indicators so the favorite-team flavor still feels personal without
 * showing the full sentence on a tiny spinner.
 *
 * "Rise up. Your command center is ready." → "Rise up."
 * "SKOL! Your command center is ready."    → "SKOL!"
 * "Who Dey?! Your command center is ready." → "Who Dey?!"
 */
export function getTeamSlogan(team: NflTeam | null | undefined): string | null {
  if (!team) return null;
  const closer = " Your command center is ready.";
  if (team.greeting.endsWith(closer)) {
    return team.greeting.slice(0, -closer.length).trim();
  }
  // Fallback for greetings that don't use the standard closer: take the
  // first clause up to the first sentence terminator.
  const m = team.greeting.match(/^[^.!?]+[.!?]+/);
  return m ? m[0].trim() : team.greeting.trim();
}
