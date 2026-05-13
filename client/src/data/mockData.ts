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
  if (overall >= 60) return "Win-Now";
  if (overall >= 40) return "Future Powerhouse";
  if (overall >= 20) return "Pick Hoarder";
  return "Taco";
}

export interface TierDebugFlags {
  redTop10: boolean;
  redTop25: boolean;
  redTop33: boolean;
  redTop50: boolean;
  redBottom10: boolean;
  redBottom25: boolean;
  redBottom33: boolean;
  redBottom50: boolean;
  dynTop10: boolean;
  dynTop25: boolean;
  dynTop33: boolean;
  dynTop50: boolean;
  dynBottom10: boolean;
  dynBottom25: boolean;
  dynBottom50: boolean;
  pcksTop10: boolean;
  pcksTop25: boolean;
  pcksTop33: boolean;
  pcksTop50: boolean;
  pcksBottom25: boolean;
  pcksBottom50: boolean;
}

export interface TierResult {
  tier: Tier;
  tierDescription: string;
  debug: TierDebugFlags;
}

const TIER_DESCRIPTIONS: Record<Tier, string> = {
  "Taco": "Bottom-tier in current strength, dynasty value, and draft capital.",
  "Juggernaut": "Elite current strength with a strong long-term foundation.",
  "Future Powerhouse": "Loaded with elite long-term roster value, positioned to dominate for years.",
  "Pick Hoarder": "Built around future rookie picks more than current competitive strength.",
  "Win-Now": "Strong current roster, but long-term value and draft capital have been sacrificed.",
  "Contender": "A strong current team with enough long-term value to stay competitive.",
  "Rebuilder": "Not built to win right now, but positioned to improve through long-term assets.",
  "Weak / Directionless": "Lacking both current strength and a clear long-term advantage.",
  "Pretender": "A solid, playoff-caliber team without the elite edge to be a true contender.",
  "Balanced": "A middle-of-the-pack profile without an extreme dynasty archetype.",
};

function getTierFlags(
  ranks: { redraft: number; dynasty: number; draft: number },
  totalTeams: number
): TierDebugFlags {
  const top10 = Math.max(1, Math.ceil(totalTeams * 0.10));
  const top25 = Math.max(1, Math.ceil(totalTeams * 0.25));
  const top33 = Math.max(1, Math.ceil(totalTeams * 0.33));
  const top50 = Math.max(1, Math.ceil(totalTeams * 0.50));
  const bottom50Count = Math.max(1, Math.ceil(totalTeams * 0.50));
  const bottom25Count = Math.max(1, Math.ceil(totalTeams * 0.25));
  const bottom50Start = totalTeams - bottom50Count + 1;
  const bottom25Start = totalTeams - bottom25Count + 1;

  const bottom10Count = Math.max(1, Math.ceil(totalTeams * 0.10));
  const bottom10Start = totalTeams - bottom10Count + 1;
  const bottom33Count = Math.max(1, Math.ceil(totalTeams * 0.33));
  const bottom33Start = totalTeams - bottom33Count + 1;

  const { redraft, dynasty, draft } = ranks;

  return {
    redTop10: redraft <= top10,
    redTop25: redraft <= top25,
    redTop33: redraft <= top33,
    redTop50: redraft <= top50,
    redBottom10: redraft >= bottom10Start,
    redBottom25: redraft >= bottom25Start,
    redBottom33: redraft >= bottom33Start,
    redBottom50: redraft >= bottom50Start,
    dynTop10: dynasty <= top10,
    dynTop25: dynasty <= top25,
    dynTop33: dynasty <= top33,
    dynTop50: dynasty <= top50,
    dynBottom10: dynasty >= bottom10Start,
    dynBottom25: dynasty >= bottom25Start,
    dynBottom50: dynasty >= bottom50Start,
    pcksTop10: draft <= top10,
    pcksTop25: draft <= top25,
    pcksTop33: draft <= top33,
    pcksTop50: draft <= top50,
    pcksBottom25: draft >= bottom25Start,
    pcksBottom50: draft >= bottom50Start,
  };
}

export function classifyTeamTier(
  ranks: { power: number; dynasty: number; redraft: number; draft: number },
  totalTeams: number
): TierResult {
  const flags = getTierFlags(ranks, totalTeams);

  if (
    (flags.redBottom25 && flags.dynBottom25 && flags.pcksBottom25) ||
    (flags.redBottom10 && flags.dynBottom10)
  ) {
    return { tier: "Taco", tierDescription: TIER_DESCRIPTIONS["Taco"], debug: flags };
  }

  if (
    (flags.redTop25 && flags.dynTop25) ||
    (flags.redTop25 && flags.dynTop50 && flags.pcksTop25)
  ) {
    return { tier: "Juggernaut", tierDescription: TIER_DESCRIPTIONS["Juggernaut"], debug: flags };
  }

  if (
    (flags.dynTop25 && flags.pcksTop25) ||
    (flags.dynTop10 && flags.redTop50) ||
    (flags.dynTop10 && flags.pcksTop50)
  ) {
    return { tier: "Future Powerhouse", tierDescription: TIER_DESCRIPTIONS["Future Powerhouse"], debug: flags };
  }

  if (flags.pcksTop25 && flags.redBottom25 && flags.dynBottom50) {
    return { tier: "Pick Hoarder", tierDescription: TIER_DESCRIPTIONS["Pick Hoarder"], debug: flags };
  }

  if (flags.redTop33 && flags.dynBottom50 && flags.pcksBottom50) {
    return { tier: "Win-Now", tierDescription: TIER_DESCRIPTIONS["Win-Now"], debug: flags };
  }

  if (flags.redTop50 && flags.dynTop33) {
    return { tier: "Contender", tierDescription: TIER_DESCRIPTIONS["Contender"], debug: flags };
  }

  if (flags.redTop33 && flags.dynTop50) {
    return { tier: "Pretender", tierDescription: TIER_DESCRIPTIONS["Pretender"], debug: flags };
  }

  if (flags.redBottom33 && (flags.pcksTop50 || flags.dynTop50)) {
    return { tier: "Rebuilder", tierDescription: TIER_DESCRIPTIONS["Rebuilder"], debug: flags };
  }

  return { tier: "Balanced", tierDescription: TIER_DESCRIPTIONS["Balanced"], debug: flags };
}

export function getLeagueTeamTiers(teams: Team[]): Map<string, { tier: Tier; tooltip: string; tierDescription: string; debug: TierDebugFlags }> {
  const total = teams.length;
  if (total === 0) return new Map();

  const byPower = [...teams].sort((a, b) => (b.metrics?.overall ?? 0) - (a.metrics?.overall ?? 0));
  const byDynasty = [...teams].sort((a, b) => (b.metrics?.depth ?? 0) - (a.metrics?.depth ?? 0));
  const byRedraft = [...teams].sort((a, b) => (b.metrics?.starters ?? 0) - (a.metrics?.starters ?? 0));
  const byDraft = [...teams].sort((a, b) => (b.metrics?.picks ?? 0) - (a.metrics?.picks ?? 0));

  const result = new Map<string, { tier: Tier; tooltip: string; tierDescription: string; debug: TierDebugFlags }>();

  for (const team of teams) {
    const power = byPower.findIndex(t => t.id === team.id) + 1;
    const dynasty = byDynasty.findIndex(t => t.id === team.id) + 1;
    const redraft = byRedraft.findIndex(t => t.id === team.id) + 1;
    const draft = byDraft.findIndex(t => t.id === team.id) + 1;

    const tierResult = classifyTeamTier({ power, dynasty, redraft, draft }, total);
    result.set(team.id, {
      tier: tierResult.tier,
      tooltip: tierResult.tierDescription,
      tierDescription: tierResult.tierDescription,
      debug: tierResult.debug,
    });
  }

  return result;
}

function computePercentile(values: number[], val: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = sorted.findIndex(v => v >= val);
  if (idx === -1) return 100;
  return Math.round((idx / sorted.length) * 100);
}

export function computeNowScore(teams: Team[], team: Team): number {
  const allStarters = teams.map(t => t.metrics.starters);
  return computePercentile(allStarters, team.metrics.starters);
}

export function computeFutureScore(teams: Team[], team: Team): number {
  const allDynasty = teams.map(t => t.metrics.depth);
  const allDraft = teams.map(t => t.metrics.picks);
  const dynastyPct = computePercentile(allDynasty, team.metrics.depth);
  const draftPct = computePercentile(allDraft, team.metrics.picks);
  return Math.round(0.7 * dynastyPct + 0.3 * draftPct);
}

export function getDynastyWindowLabel(now: number, future: number, avgNow: number, avgFuture: number): string {
  if (now >= avgNow && future >= avgFuture) return "Dynasty Death Star";
  if (now >= avgNow && future < avgFuture) return "Win-Now Kings";
  if (now < avgNow && future >= avgFuture) return "Rebuild With Ammo";
  return "Rebuild Hell";
}

export function getDynastyWindowSubtitle(label: string): string {
  switch (label) {
    case "Dynasty Death Star": return "High Now + High Future";
    case "Win-Now Kings": return "High Now + Low Future";
    case "Rebuild With Ammo": return "Low Now + High Future";
    case "Rebuild Hell": return "Low Now + Low Future";
    default: return "";
  }
}

export function getDynastyWindowColor(label: string): string {
  switch (label) {
    case "Dynasty Death Star": return "text-[#d4af37]";
    case "Win-Now Kings": return "text-red-400";
    case "Rebuild With Ammo": return "text-emerald-400";
    case "Rebuild Hell": return "text-slate-400";
    default: return "text-muted-foreground";
  }
}

export function isContenderTier(tier: Tier): boolean {
  return tier === "Juggernaut" || tier === "Win-Now" || tier === "Contender" || tier === "Pretender";
}

export function isRebuilderTier(tier: Tier): boolean {
  return tier === "Future Powerhouse" || tier === "Pick Hoarder" || tier === "Taco" || tier === "Rebuilder" || tier === "Weak / Directionless";
}

export function getTierTooltip(tier: Tier): string {
  return TIER_DESCRIPTIONS[tier];
}

export function getTierEmoji(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "🏆";
    case "Win-Now": return "💪";
    case "Future Powerhouse": return "📈";
    case "Pick Hoarder": return "🎰";
    case "Taco": return "🤡";
    case "Contender": return "🔥";
    case "Pretender": return "🎭";
    case "Rebuilder": return "🔨";
    case "Weak / Directionless": return "😶";
    case "Balanced": return "⚖️";
  }
}

export function getTierColor(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "text-[#d4af37] dark:text-[#d4af37]";
    case "Win-Now": return "text-blue-600 dark:text-blue-400";
    case "Future Powerhouse": return "text-emerald-600 dark:text-emerald-400";
    case "Pick Hoarder": return "text-purple-600 dark:text-purple-400";
    case "Taco": return "text-red-600 dark:text-red-400";
    case "Contender": return "text-amber-600 dark:text-amber-400";
    case "Pretender": return "text-sky-600 dark:text-sky-400";
    case "Rebuilder": return "text-orange-600 dark:text-orange-400";
    case "Weak / Directionless": return "text-rose-600 dark:text-rose-400";
    case "Balanced": return "text-slate-600 dark:text-slate-400";
  }
}

export function getTierBg(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "bg-[#d4af37]/10 dark:bg-[#d4af37]/10";
    case "Win-Now": return "bg-blue-50 dark:bg-blue-950/30";
    case "Future Powerhouse": return "bg-emerald-50 dark:bg-emerald-950/30";
    case "Pick Hoarder": return "bg-purple-50 dark:bg-purple-950/30";
    case "Taco": return "bg-red-50 dark:bg-red-950/30";
    case "Contender": return "bg-amber-50 dark:bg-amber-950/30";
    case "Pretender": return "bg-sky-50 dark:bg-sky-950/30";
    case "Rebuilder": return "bg-orange-50 dark:bg-orange-950/30";
    case "Weak / Directionless": return "bg-rose-50 dark:bg-rose-950/30";
    case "Balanced": return "bg-slate-50 dark:bg-slate-900/30";
  }
}

export function getTierBorderColor(tier: Tier): string {
  switch (tier) {
    case "Juggernaut": return "border-[#d4af37]/40";
    case "Win-Now": return "border-blue-300 dark:border-blue-700";
    case "Future Powerhouse": return "border-emerald-300 dark:border-emerald-700";
    case "Pick Hoarder": return "border-purple-300 dark:border-purple-700";
    case "Taco": return "border-red-300 dark:border-red-700";
    case "Contender": return "border-amber-300 dark:border-amber-700";
    case "Pretender": return "border-sky-300 dark:border-sky-700";
    case "Rebuilder": return "border-orange-300 dark:border-orange-700";
    case "Weak / Directionless": return "border-rose-300 dark:border-rose-700";
    case "Balanced": return "border-slate-300 dark:border-slate-700";
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
  insights.push({ text: `${youngestTeam.owner} has the youngest roster, positioned for the future.`, type: "neutral", category: "league-leaders" });

  const mostPicks = [...league.teams].sort((a, b) => b.picks.filter((p) => p.round === 1).length - a.picks.filter((p) => p.round === 1).length)[0];
  const firstRoundCount = mostPicks.picks.filter((p) => p.round === 1).length;
  insights.push({ text: `${mostPicks.owner} owns the most future 1sts (${firstRoundCount}).`, type: "neutral", category: "draft-capital" });

  const mostTotalPicks = [...league.teams].sort((a, b) => b.picks.length - a.picks.length)[0];
  insights.push({ text: `${mostTotalPicks.owner} has the most total draft picks (${mostTotalPicks.picks.length}).`, type: "neutral", category: "draft-capital" });

  const fewestPicks = [...league.teams].sort((a, b) => a.picks.length - b.picks.length)[0];
  if (fewestPicks.picks.length < league.teams[0]?.picks.length) {
    insights.push({ text: `${fewestPicks.owner} has the fewest draft picks (${fewestPicks.picks.length}), went all-in.`, type: "negative", category: "draft-capital" });
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
    insights.push({ text: `${rebuildTeams.length} team(s) in rebuild mode. Look for buy-low opportunities.`, type: "neutral", category: "contender-analysis" });
  }

  const juggernauts = league.teams.filter((t) => tierMap.get(t.id)?.tier === "Juggernaut");
  if (juggernauts.length > 0) {
    insights.push({ text: `${juggernauts.length} Juggernaut(s) in this league: ${juggernauts.map(t => t.owner).join(", ")}.`, type: "positive", category: "contender-analysis" });
  }

  const worstTE = [...league.teams].sort((a, b) => a.metrics.te - b.metrics.te)[0];
  insights.push({ text: `${worstTE.owner} has the weakest TE room, a potential trade target.`, type: "negative", category: "trade-opportunities" });

  const worstQB = [...league.teams].sort((a, b) => a.metrics.qb - b.metrics.qb)[0];
  insights.push({ text: `${worstQB.owner} has the weakest QB room, may overpay for a signal-caller.`, type: "negative", category: "trade-opportunities" });

  const worstWR = [...league.teams].sort((a, b) => a.metrics.wr - b.metrics.wr)[0];
  insights.push({ text: `${worstWR.owner} has the weakest WR corps, a buy-low candidate.`, type: "negative", category: "trade-opportunities" });

  if (userTeam.metrics.rb < 50) {
    insights.push({ text: `Your RB room is below league average. Consider targeting RB depth.`, type: "negative", category: "your-team" });
  }

  const userTierInfo = tierMap.get(userTeam.id);
  if (userTierInfo && isContenderTier(userTierInfo.tier)) {
    insights.push({ text: `Your team is a ${userTierInfo.tier}. Push for a championship window move.`, type: "positive", category: "your-team" });
  } else if (userTierInfo && isRebuilderTier(userTierInfo.tier)) {
    insights.push({ text: `Your team is in ${userTierInfo.tier} mode. Accumulate picks and young assets.`, type: "neutral", category: "your-team" });
  }

  if (userTeam.metrics.qb >= 70) {
    insights.push({ text: `Your QB room is a strength (${userTeam.metrics.qb}). Leverage this in trades.`, type: "positive", category: "your-team" });
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
    label: "Command Center",
    subTabs: [
      { id: "connect", label: "Connect" },
      { id: "lineup-command", label: "Lineup Command" },
      { id: "portfolio-summary", label: "My Portfolio" },
      { id: "waiver-command", label: "Waiver Command" },
    ],
  },
  {
    id: "dashboard",
    label: "My Team",
    subTabs: [
      { id: "my-team", label: "My Team" },
      { id: "field-view", label: "Field View" },
      { id: "share-team", label: "Share My Team" },
      { id: "league-roi", label: "Finances" },
    ],
  },
  {
    id: "league-analyzer",
    label: "League Analyzer",
    subTabs: [
      { id: "power-rankings", label: "Rankings" },
      { id: "roster-comparison", label: "Compare" },
      { id: "league-economy", label: "Economy" },
      { id: "transactions", label: "Transactions" },
    ],
  },
  {
    id: "trade-center",
    label: "Trade Center",
    subTabs: [
      { id: "trade-database", label: "Database" },
      { id: "positional-analysis", label: "Finder" },
      { id: "trade-calculator", label: "Calculator" },
      { id: "trade-block", label: "Intel" },
    ],
  },
  {
    id: "league-market",
    label: "Research",
    subTabs: [
      { id: "analysis", label: "Analysis" },
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
