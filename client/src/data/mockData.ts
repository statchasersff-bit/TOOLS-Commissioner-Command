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

export function getPositionColor(pos: string): string {
  switch (pos) {
    case "QB": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800";
    case "RB": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
    case "WR": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800";
    case "TE": return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800";
    default: return "bg-muted text-muted-foreground";
  }
}

export function getTeamTier(overall: number): Tier {
  if (overall >= 80) return "Juggernaut";
  if (overall >= 68) return "Contender";
  if (overall >= 55) return "Ascending";
  if (overall >= 42) return "Competitive";
  if (overall >= 30) return "Rebuild";
  if (overall >= 20) return "Directionless";
  return "Taco";
}

export function classifyTeamTier(
  ranks: { power: number; dynasty: number; redraft: number; draft: number },
  totalTeams: number
): Tier {
  const strong = Math.ceil(totalTeams / 3);
  const weak = totalTeams - strong + 1;
  const mid = Math.ceil(totalTeams / 2);
  const top25 = Math.max(1, Math.ceil(totalTeams / 4));
  const { power, dynasty, redraft, draft } = ranks;

  if (power <= top25 && dynasty <= strong && redraft <= strong) return "Juggernaut";
  if (power <= strong && redraft <= mid) return "Contender";
  if (dynasty <= strong && power > strong && power < weak) return "Ascending";
  if (dynasty >= weak && draft >= weak && power >= weak) return "Taco";
  if (redraft >= weak && (dynasty <= mid || draft <= strong)) return "Rebuild";
  if (power >= weak && dynasty > strong && dynasty < weak && draft > strong && draft < weak) return "Directionless";
  if (power > strong && power < weak && dynasty > strong && dynasty < weak) return "Competitive";
  return "Competitive";
}

export function getLeagueTeamTiers(teams: Team[]): Map<string, { tier: Tier; tooltip: string }> {
  const total = teams.length;
  if (total === 0) return new Map();

  const byPower = [...teams].sort((a, b) => (b.metrics?.overall ?? 0) - (a.metrics?.overall ?? 0));
  const byDynasty = [...teams].sort((a, b) => (b.metrics?.depth ?? 0) - (a.metrics?.depth ?? 0));
  const byRedraft = [...teams].sort((a, b) => (b.metrics?.starters ?? 0) - (a.metrics?.starters ?? 0));
  const byDraft = [...teams].sort((a, b) => (b.metrics?.picks ?? 0) - (a.metrics?.picks ?? 0));

  const result = new Map<string, { tier: Tier; tooltip: string }>();

  for (const team of teams) {
    const power = byPower.findIndex(t => t.id === team.id) + 1;
    const dynasty = byDynasty.findIndex(t => t.id === team.id) + 1;
    const redraft = byRedraft.findIndex(t => t.id === team.id) + 1;
    const draft = byDraft.findIndex(t => t.id === team.id) + 1;

    const tier = classifyTeamTier({ power, dynasty, redraft, draft }, total);
    result.set(team.id, { tier, tooltip: getTierTooltip(tier) });
  }

  return result;
}

export function isContenderTier(tier: Tier): boolean {
  return tier === "Juggernaut" || tier === "Contender";
}

export function isRebuilderTier(tier: Tier): boolean {
  return tier === "Rebuild" || tier === "Taco" || tier === "Directionless";
}

export function getTierTooltip(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "League problem. Nobody wants to see this team in the playoffs.";
    case "Contender": return "Built to win this year.";
    case "Ascending": return "The future is bright. Probably a year early.";
    case "Competitive": return "Good roster, not scary.";
    case "Rebuild": return "Playing the long game.";
    case "Directionless": return "The roster construction equivalent of throwing darts.";
    case "Taco": return "Congratulations. You've successfully turned a dynasty team into a seasonal rental.";
  }
}

export function getTierEmoji(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "🏆";
    case "Contender": return "💪";
    case "Ascending": return "📈";
    case "Competitive": return "🎯";
    case "Rebuild": return "🧠";
    case "Directionless": return "🎰";
    case "Taco": return "🤡";
  }
}

export function getTierColor(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "text-[#d4af37] dark:text-[#d4af37]";
    case "Contender": return "text-blue-600 dark:text-blue-400";
    case "Ascending": return "text-emerald-600 dark:text-emerald-400";
    case "Competitive": return "text-amber-600 dark:text-amber-400";
    case "Rebuild": return "text-orange-600 dark:text-orange-400";
    case "Directionless": return "text-purple-600 dark:text-purple-400";
    case "Taco": return "text-red-600 dark:text-red-400";
  }
}

export function getTierBg(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "bg-[#d4af37]/10 dark:bg-[#d4af37]/10";
    case "Contender": return "bg-blue-50 dark:bg-blue-950/30";
    case "Ascending": return "bg-emerald-50 dark:bg-emerald-950/30";
    case "Competitive": return "bg-amber-50 dark:bg-amber-950/30";
    case "Rebuild": return "bg-orange-50 dark:bg-orange-950/30";
    case "Directionless": return "bg-purple-50 dark:bg-purple-950/30";
    case "Taco": return "bg-red-50 dark:bg-red-950/30";
  }
}

export function getTierBorderColor(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "border-[#d4af37]/40";
    case "Contender": return "border-blue-300 dark:border-blue-700";
    case "Ascending": return "border-emerald-300 dark:border-emerald-700";
    case "Competitive": return "border-amber-300 dark:border-amber-700";
    case "Rebuild": return "border-orange-300 dark:border-orange-700";
    case "Directionless": return "border-purple-300 dark:border-purple-700";
    case "Taco": return "border-red-300 dark:border-red-700";
  }
}

export function generateInsights(league: League, userTeamId: string): Insight[] {
  const userTeam = league.teams.find((t) => t.id === userTeamId);
  if (!userTeam) return [];

  const sorted = [...league.teams].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const insights: Insight[] = [];

  const bestWR = [...league.teams].sort((a, b) => b.metrics.wr - a.metrics.wr)[0];
  insights.push({ text: `${bestWR.owner} has the strongest WR room (${bestWR.metrics.wr}).`, type: "positive", category: "league-leaders" });

  const bestQB = [...league.teams].sort((a, b) => b.metrics.qb - a.metrics.qb)[0];
  insights.push({ text: `${bestQB.owner} leads the league in QB value (${bestQB.metrics.qb}).`, type: "positive", category: "league-leaders" });

  const bestDepth = [...league.teams].sort((a, b) => b.metrics.depth - a.metrics.depth)[0];
  insights.push({ text: `${bestDepth.owner} has the deepest roster in the league.`, type: "positive", category: "league-leaders" });

  const bestRB = [...league.teams].sort((a, b) => b.metrics.rb - a.metrics.rb)[0];
  insights.push({ text: `${bestRB.owner} has the strongest RB room (${bestRB.metrics.rb}).`, type: "positive", category: "league-leaders" });

  const youngestTeam = [...league.teams].sort((a, b) => b.metrics.youth - a.metrics.youth)[0];
  insights.push({ text: `${youngestTeam.owner} has the youngest roster — positioned for the future.`, type: "neutral", category: "league-leaders" });

  const mostPicks = [...league.teams].sort((a, b) => b.picks.filter((p) => p.round === 1).length - a.picks.filter((p) => p.round === 1).length)[0];
  const firstRoundCount = mostPicks.picks.filter((p) => p.round === 1).length;
  insights.push({ text: `${mostPicks.owner} owns the most future 1sts (${firstRoundCount}).`, type: "neutral", category: "draft-capital" });

  const mostTotalPicks = [...league.teams].sort((a, b) => b.picks.length - a.picks.length)[0];
  insights.push({ text: `${mostTotalPicks.owner} has the most total draft picks (${mostTotalPicks.picks.length}).`, type: "neutral", category: "draft-capital" });

  const fewestPicks = [...league.teams].sort((a, b) => a.picks.length - b.picks.length)[0];
  if (fewestPicks.picks.length < league.teams[0]?.picks.length) {
    insights.push({ text: `${fewestPicks.owner} has the fewest draft picks (${fewestPicks.picks.length}) — went all-in.`, type: "negative", category: "draft-capital" });
  }

  const oldestContender = sorted.filter((t) => t.metrics.overall >= 65).sort((a, b) => {
    const starters = (t: Team) => t.roster.filter((p) => p.starter);
    const avgAge = (t: Team) => { const s = starters(t); return s.length ? s.reduce((sum, p) => sum + p.age, 0) / s.length : 0; };
    return avgAge(b) - avgAge(a);
  })[0];
  if (oldestContender) {
    const starterAge = oldestContender.roster.filter(p => p.starter);
    const avg = starterAge.length ? (starterAge.reduce((s, p) => s + p.age, 0) / starterAge.length).toFixed(1) : "?";
    insights.push({ text: `${oldestContender.owner} has the oldest contender roster (avg starter age ${avg}).`, type: "negative", category: "contender-analysis" });
  }

  const tierMap = getLeagueTeamTiers(league.teams);
  const rebuildTeams = league.teams.filter((t) => { const ti = tierMap.get(t.id); return ti && isRebuilderTier(ti.tier); });
  if (rebuildTeams.length > 0) {
    insights.push({ text: `${rebuildTeams.length} team(s) in rebuild mode — look for buy-low opportunities.`, type: "neutral", category: "contender-analysis" });
  }

  const juggernauts = league.teams.filter((t) => tierMap.get(t.id)?.tier === "Juggernaut");
  if (juggernauts.length > 0) {
    insights.push({ text: `${juggernauts.length} Juggernaut(s) in this league: ${juggernauts.map(t => t.owner).join(", ")}.`, type: "positive", category: "contender-analysis" });
  }

  const worstTE = [...league.teams].sort((a, b) => a.metrics.te - b.metrics.te)[0];
  insights.push({ text: `${worstTE.owner} has the weakest TE room — a potential trade target.`, type: "negative", category: "trade-opportunities" });

  const worstQB = [...league.teams].sort((a, b) => a.metrics.qb - b.metrics.qb)[0];
  insights.push({ text: `${worstQB.owner} has the weakest QB room — may overpay for a signal-caller.`, type: "negative", category: "trade-opportunities" });

  const worstWR = [...league.teams].sort((a, b) => a.metrics.wr - b.metrics.wr)[0];
  insights.push({ text: `${worstWR.owner} has the weakest WR corps — a buy-low candidate.`, type: "negative", category: "trade-opportunities" });

  if (userTeam.metrics.rb < 50) {
    insights.push({ text: `Your RB room is below league average — consider targeting RB depth.`, type: "negative", category: "your-team" });
  }

  const userTierInfo = tierMap.get(userTeam.id);
  if (userTierInfo && isContenderTier(userTierInfo.tier)) {
    insights.push({ text: `Your team is a ${userTierInfo.tier} — push for a championship window move.`, type: "positive", category: "your-team" });
  } else if (userTierInfo && isRebuilderTier(userTierInfo.tier)) {
    insights.push({ text: `Your team is in ${userTierInfo.tier} mode — accumulate picks and young assets.`, type: "neutral", category: "your-team" });
  }

  if (userTeam.metrics.qb >= 70) {
    insights.push({ text: `Your QB room is a strength (${userTeam.metrics.qb}) — leverage this in trades.`, type: "positive", category: "your-team" });
  }

  const userRank = sorted.findIndex(t => t.id === userTeamId) + 1;
  if (userRank > 0) {
    insights.push({ text: `You're ranked #${userRank} of ${league.teams.length} in overall power score.`, type: userRank <= 3 ? "positive" : userRank <= league.teams.length / 2 ? "neutral" : "negative", category: "your-team" });
  }

  return insights;
}

export const NAV_CONFIG: MainTabConfig[] = [
  {
    id: "portfolio",
    label: "Portfolio",
    subTabs: [
      { id: "connect", label: "Connect" },
      { id: "my-leagues", label: "My Leagues" },
      { id: "portfolio-summary", label: "Portfolio Summary" },
    ],
  },
  {
    id: "dashboard",
    label: "My Team",
    subTabs: [
      { id: "overview", label: "Overview" },
      { id: "roster-breakdown", label: "Roster Breakdown" },
    ],
  },
  {
    id: "league-analyzer",
    label: "League Analyzer",
    subTabs: [
      { id: "power-rankings", label: "Power Rankings" },
      { id: "roster-comparison", label: "Roster Comparison" },
      { id: "league-intelligence", label: "Intel" },
      { id: "league-economy", label: "Economy" },
      { id: "transactions", label: "Transactions" },
    ],
  },
  {
    id: "trade-center",
    label: "Trade Center",
    subTabs: [
      { id: "trade-database", label: "Database" },
      { id: "trade-targets", label: "Targets" },
      { id: "positional-analysis", label: "Finder" },
      { id: "trade-calculator", label: "Calculator" },
      { id: "trade-block", label: "Intel" },
    ],
  },
  {
    id: "league-market",
    label: "Players",
    subTabs: [
      { id: "market-value", label: "Market Value" },
    ],
  },
  {
    id: "live-draft",
    label: "Live Draft",
    subTabs: [
      { id: "draft-board", label: "Draft Board" },
    ],
  },
];
