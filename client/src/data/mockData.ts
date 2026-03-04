import type { League, Team, Player, Pick, TeamMetrics, Tier, MainTabConfig, Insight } from "../types";

const playerNames: Record<string, string[]> = {
  QB: ["Patrick Mahomes", "Josh Allen", "Lamar Jackson", "Joe Burrow", "Jalen Hurts", "Justin Herbert", "Tua Tagovailoa", "CJ Stroud", "Anthony Richardson", "Dak Prescott", "Jordan Love", "Brock Purdy", "Kyler Murray", "Trevor Lawrence", "Caleb Williams", "Drake Maye", "Jayden Daniels", "Sam Darnold", "Baker Mayfield", "Geno Smith", "Russell Wilson", "Kirk Cousins", "Aaron Rodgers", "Matthew Stafford"],
  RB: ["Breece Hall", "Bijan Robinson", "Jahmyr Gibbs", "Jonathan Taylor", "Saquon Barkley", "Josh Jacobs", "De'Von Achane", "Kyren Williams", "Derrick Henry", "James Cook", "Isiah Pacheco", "Kenneth Walker III", "Travis Etienne", "Aaron Jones", "Joe Mixon", "Alvin Kamara", "Nick Chubb", "Rachaad White", "David Montgomery", "Najee Harris", "Javonte Williams", "Rhamondre Stevenson", "Chuba Hubbard", "Tony Pollard"],
  WR: ["Ja'Marr Chase", "Tyreek Hill", "CeeDee Lamb", "Amon-Ra St. Brown", "Justin Jefferson", "A.J. Brown", "Garrett Wilson", "Davante Adams", "Stefon Diggs", "DK Metcalf", "Chris Olave", "Drake London", "Deebo Samuel", "Mike Evans", "Tee Higgins", "Brandon Aiyuk", "Jaylen Waddle", "DeVonta Smith", "Nico Collins", "Puka Nacua", "Zay Flowers", "Marvin Harrison Jr.", "Rome Odunze", "Malik Nabers", "Rashee Rice", "Tank Dell", "George Pickens", "Keenan Allen", "DJ Moore", "Courtland Sutton", "Terry McLaurin", "Michael Pittman Jr.", "Christian Watson", "Jaxon Smith-Njigba", "Quentin Johnston", "Brian Thomas Jr."],
  TE: ["Travis Kelce", "Sam LaPorta", "Trey McBride", "Mark Andrews", "George Kittle", "T.J. Hockenson", "Dallas Goedert", "Kyle Pitts", "David Njoku", "Jake Ferguson", "Dalton Kincaid", "Evan Engram", "Pat Freiermuth", "Cole Kmet", "Brock Bowers", "Isaiah Likely"],
};

const nflTeams = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"];

const ownerNames = ["Mak", "Kevin", "Tyler", "Jordan", "Marcus", "Alex", "Chris", "Ryan", "Nick", "Dave", "Mike", "Sam"];
const teamNames = ["Dynasty Destroyers", "Gridiron Kings", "Future Champions", "Trade Sharks", "Rebuild Nation", "Youth Movement", "Pick Hoarders", "Win Now Warriors", "Balanced Beasts", "Sleeper Agents", "Draft Day Demons", "Point Chasers"];

function randomBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function generatePlayers(teamId: string, tierLevel: number): Player[] {
  const players: Player[] = [];
  const positionCounts = { QB: 2, RB: 4, WR: 5, TE: 2 };
  const usedNames = new Set<string>();

  for (const [pos, count] of Object.entries(positionCounts)) {
    const pool = playerNames[pos].filter((n) => !usedNames.has(n));
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const name = pool.splice(idx, 1)[0];
      usedNames.add(name);
      const ageBase = pos === "QB" ? 26 : pos === "RB" ? 24 : pos === "WR" ? 25 : 26;
      const age = ageBase + Math.floor(Math.random() * 8) - 2;
      const valueBase = tierLevel > 70 ? 40 : tierLevel > 50 ? 25 : 15;
      const value = Math.max(5, valueBase + Math.floor(Math.random() * 40) - 15);
      players.push({
        id: `${teamId}-${pos}-${i}`,
        name,
        pos: pos as Player["pos"],
        age: Math.max(21, Math.min(35, age)),
        value,
        team: nflTeams[Math.floor(Math.random() * nflTeams.length)],
        starter: i < (pos === "QB" ? 1 : pos === "RB" ? 2 : pos === "WR" ? 3 : 1),
      });
    }
  }
  return players;
}

function generatePicks(teamId: string, pickCount: number): Pick[] {
  const picks: Pick[] = [];
  const years = [2025, 2026, 2027];
  const ranges: Pick["projectedRange"][] = ["Early", "Mid", "Late"];
  for (let i = 0; i < pickCount; i++) {
    const year = years[Math.floor(Math.random() * years.length)];
    const round = Math.floor(Math.random() * 4) + 1;
    const range = ranges[Math.floor(Math.random() * ranges.length)];
    const valueMap: Record<number, number> = { 1: 80, 2: 50, 3: 30, 4: 15 };
    const rangeMultiplier = range === "Early" ? 1.3 : range === "Mid" ? 1.0 : 0.7;
    picks.push({
      year,
      round,
      ownerTeamId: teamId,
      projectedRange: range,
      value: Math.round(valueMap[round] * rangeMultiplier),
    });
  }
  return picks;
}

function generateTeam(index: number): Team {
  const id = `team-${index + 1}`;
  const tierLevels = [88, 82, 78, 75, 70, 65, 60, 55, 48, 42, 38, 30];
  const tierLevel = tierLevels[index];
  const pickCount = index < 4 ? 3 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 5);
  const roster = generatePlayers(id, tierLevel);
  const picks = generatePicks(id, pickCount);

  const starterAvgAge = roster.filter((p) => p.starter).reduce((s, p) => s + p.age, 0) / roster.filter((p) => p.starter).length;
  const youthScore = Math.max(0, Math.min(100, 100 - (starterAvgAge - 23) * 8));

  const metrics: TeamMetrics = {
    overall: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 10) - 5)),
    starters: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 12) - 4)),
    depth: Math.max(10, Math.min(99, tierLevel - 10 + Math.floor(Math.random() * 20))),
    youth: Math.round(youthScore),
    picks: Math.max(10, Math.min(99, picks.reduce((s, p) => s + p.value, 0) / 3)),
    qb: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 20) - 10)),
    rb: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 20) - 10)),
    wr: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 20) - 10)),
    te: Math.max(10, Math.min(99, tierLevel + Math.floor(Math.random() * 20) - 10)),
    contenderWindowYears: index < 3 ? 4 : index < 6 ? 3 : index < 9 ? 2 : 1,
  };

  return {
    id,
    name: teamNames[index],
    owner: ownerNames[index],
    roster,
    picks,
    metrics,
  };
}

let cachedLeagues: League[] | null = null;

export function getLeagues(): League[] {
  if (cachedLeagues) return cachedLeagues;

  const teams = Array.from({ length: 12 }, (_, i) => generateTeam(i));
  cachedLeagues = [
    {
      id: "league-1",
      name: "Dynasty Legends League",
      platform: "Sleeper",
      scoringFormat: "PPR",
      teams,
    },
    {
      id: "league-2",
      name: "Keeper Kings",
      platform: "Sleeper",
      scoringFormat: "Half PPR",
      teams: Array.from({ length: 12 }, (_, i) => generateTeam(i)),
    },
  ];
  return cachedLeagues;
}

export function getTeamTier(overall: number): Tier {
  if (overall >= 80) return "Elite";
  if (overall >= 65) return "Contender";
  if (overall >= 45) return "Competitive";
  return "Rebuild";
}

export function getTierColor(tier: Tier): string {
  switch (tier) {
    case "Elite": return "text-emerald-600 dark:text-emerald-400";
    case "Contender": return "text-blue-600 dark:text-blue-400";
    case "Competitive": return "text-amber-600 dark:text-amber-400";
    case "Rebuild": return "text-red-600 dark:text-red-400";
  }
}

export function getTierBg(tier: Tier): string {
  switch (tier) {
    case "Elite": return "bg-emerald-50 dark:bg-emerald-950/30";
    case "Contender": return "bg-blue-50 dark:bg-blue-950/30";
    case "Competitive": return "bg-amber-50 dark:bg-amber-950/30";
    case "Rebuild": return "bg-red-50 dark:bg-red-950/30";
  }
}

export function generateInsights(league: League, userTeamId: string): Insight[] {
  const userTeam = league.teams.find((t) => t.id === userTeamId);
  if (!userTeam) return [];

  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const insights: Insight[] = [];

  const bestWR = [...league.teams].sort((a, b) => b.metrics.wr - a.metrics.wr)[0];
  insights.push({ text: `${bestWR.owner} has the strongest WR room in the league (${bestWR.metrics.wr} score).`, type: "positive" });

  const mostPicks = [...league.teams].sort((a, b) => b.picks.filter((p) => p.round === 1).length - a.picks.filter((p) => p.round === 1).length)[0];
  const firstRoundCount = mostPicks.picks.filter((p) => p.round === 1).length;
  insights.push({ text: `${mostPicks.owner} owns the most future 1sts (${firstRoundCount}).`, type: "neutral" });

  const oldestContender = sorted.filter((t) => t.metrics.overall >= 65).sort((a, b) => {
    const aAge = a.roster.filter((p) => p.starter).reduce((s, p) => s + p.age, 0) / a.roster.filter((p) => p.starter).length;
    const bAge = b.roster.filter((p) => p.starter).reduce((s, p) => s + p.age, 0) / b.roster.filter((p) => p.starter).length;
    return bAge - aAge;
  })[0];
  if (oldestContender) {
    insights.push({ text: `${oldestContender.owner} is the oldest contender roster.`, type: "negative" });
  }

  const bestQB = [...league.teams].sort((a, b) => b.metrics.qb - a.metrics.qb)[0];
  insights.push({ text: `${bestQB.owner} leads the league in QB value (${bestQB.metrics.qb}).`, type: "positive" });

  const bestDepth = [...league.teams].sort((a, b) => b.metrics.depth - a.metrics.depth)[0];
  insights.push({ text: `${bestDepth.owner} has the deepest roster in the league.`, type: "positive" });

  const worstTE = [...league.teams].sort((a, b) => a.metrics.te - b.metrics.te)[0];
  insights.push({ text: `${worstTE.owner} has the weakest TE room -- a potential trade target.`, type: "negative" });

  const youngestTeam = [...league.teams].sort((a, b) => b.metrics.youth - a.metrics.youth)[0];
  insights.push({ text: `${youngestTeam.owner} has the youngest roster -- positioned for the future.`, type: "neutral" });

  const rebuildTeams = league.teams.filter((t) => t.metrics.overall < 45);
  if (rebuildTeams.length > 0) {
    insights.push({ text: `${rebuildTeams.length} team(s) are in full rebuild mode -- look for buy-low opportunities.`, type: "neutral" });
  }

  if (userTeam.metrics.rb < 50) {
    insights.push({ text: `Your RB room is below league average -- consider targeting RB depth.`, type: "negative" });
  }

  if (userTeam.metrics.overall >= 75) {
    insights.push({ text: `Your team is in the top tier -- push for a championship window move.`, type: "positive" });
  }

  return insights;
}

export const NAV_CONFIG: MainTabConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    subTabs: [
      { id: "overview", label: "Overview" },
      { id: "snapshot", label: "League Snapshot" },
      { id: "key-insights", label: "Key Insights" },
    ],
  },
  {
    id: "league-analyzer",
    label: "League Analyzer",
    subTabs: [
      { id: "power-rankings", label: "Power Rankings" },
      { id: "tier-breakdown", label: "Tier Breakdown" },
      { id: "roster-comparison", label: "Roster Comparison" },
    ],
  },
  {
    id: "team-breakdown",
    label: "Team Breakdown",
    subTabs: [
      { id: "roster-strength", label: "Roster Strength" },
      { id: "age-curve", label: "Age Curve" },
      { id: "depth-chart", label: "Depth Chart" },
    ],
  },
  {
    id: "trade-center",
    label: "Trade Center",
    subTabs: [
      { id: "trade-finder", label: "Trade Finder" },
      { id: "trade-targets", label: "Trade Targets" },
      { id: "trade-block", label: "Trade Block Scanner" },
    ],
  },
  {
    id: "draft-capital",
    label: "Draft Capital",
    subTabs: [
      { id: "pick-value", label: "Pick Value" },
      { id: "pick-distribution", label: "Pick Distribution" },
    ],
  },
  {
    id: "league-market",
    label: "League Market",
    subTabs: [
      { id: "positional-surplus", label: "Positional Surplus" },
      { id: "market-value", label: "Market Value" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    subTabs: [
      { id: "team-insights", label: "Team Insights" },
      { id: "league-trends", label: "League Trends" },
    ],
  },
];
