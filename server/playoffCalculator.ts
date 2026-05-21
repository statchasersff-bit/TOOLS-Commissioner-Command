/**
 * Playoff Calculator
 *
 * Monte Carlo playoff odds for a Sleeper dynasty league. Uses public Sleeper
 * data (league settings, rosters, matchups, players) layered with FantasyCalc
 * redraft "win-now" starter values to rate each team. No write scopes required.
 *
 * Output shape is consumed by client/src/pages/tabs/PlayoffCalculator.tsx.
 */

import { getFantasyCalcRedraftValues } from "./fantasycalc";
import { getSleeperPlayers } from "./sleeper";

const SLEEPER_API = "https://api.sleeper.app/v1";

// ── Tunables ─────────────────────────────────────────────────────────────────
// RATING_TO_POINTS controls how strongly the 0-100 team rating maps to weekly
// expected points. Larger value = teams converge toward the league-average
// point output, so upsets are more common. Calibrated so that a 40-point
// rating gap (roughly top-tier vs league-average) yields a ~70% per-game win
// probability with the default weekly σ — matches the spec's "favored but
// still upsettable" target.
const RATING_TO_POINTS = 280;
const DEFAULT_STD_DEV = 22;        // per-team per-week σ (PPR baseline)
const SF_STD_DEV_BUMP = 2;         // superflex variance bump
const BESTBALL_STD_DEV_PENALTY = -3;
const MIN_SIMS = 100;
const MAX_SIMS = 25000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

// Box-Muller normal random
function randNormal(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: any;
  status: string;
  settings: any;
}

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
}

interface SleeperLeagueUserRaw {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
}

interface SleeperMatchupRaw {
  roster_id: number;
  matchup_id: number | null;
  points: number;
}

interface TeamState {
  rosterId: number;
  ownerId: string;
  teamName: string;
  ownerName: string;
  avatar: string | null;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
  pointsFor: number;
  pointsAgainst: number;
  winNowScore: number;     // raw FC redraft starter total
  teamRating: number;      // 0-100 normalized rating
  ratingSource: "fantasycalc" | "fallback";
  remainingOpponents: number[]; // roster_id list, in week order
  // simulation accumulators
  finalWinsTotal: number;
  finalPointsForTotal: number;
  madePlayoffs: number;
  firstRoundBye: number;
  semifinals: number;
  finals: number;
  championship: number;
}

export interface PlayoffCalcTeamResult {
  roster_id: number;
  owner_id: string;
  team_name: string;
  owner_name: string;
  avatar: string | null;
  current_wins: number;
  current_losses: number;
  current_ties: number;
  points_for: number;
  points_against: number;
  win_now_score: number;
  team_rating: number;
  rating_source: "fantasycalc" | "fallback";
  remaining_opponents: number[];
  remaining_games: number;
  projected_record: string;
  projected_wins: number;
  projected_losses: number;
  remaining_sos: number;        // avg opponent rating
  expected_wins_remaining: number;
  projected_points_for: number;
  make_playoffs_pct: number;
  first_round_bye_pct: number;
  semifinals_pct: number;
  finals_pct: number;
  championship_pct: number;
  change_since_last_run: number; // server returns 0; client diffs vs localStorage
}

export interface PlayoffCalcMeta {
  totalTeams: number;
  playoffTeams: number;
  byeTeams: number;
  currentWeek: number;
  regularSeasonEndWeek: number;
  remainingGames: number;        // total remaining matchups (pairs, not team-weeks)
  simulations: number;
  scheduleSource: "sleeper" | "synthetic" | "none";
  // Sanity-check sums — should match the expected totals (playoffTeams*100,
  // byeTeams*100, 100) within rounding noise. Returned for the UI/logs.
  playoffPctSum: number;
  byePctSum: number;
  championshipPctSum: number;
  warnings: string[];
}

export interface PlayoffCalcSettings {
  playoffTeams: number;
  byes: number;
  playoffWeekStart: number;
  championshipWeek: number;
  regularSeasonWeeks: number;
  currentWeek: number;
  remainingWeeks: number;
  format: "SF" | "1QB";
  scoringFormat: string;
  isBestBall: boolean;
}

export interface PlayoffCalcResponse {
  league: { id: string; name: string; season: string; totalRosters: number };
  settings: PlayoffCalcSettings;
  simulationCount: number;
  lastUpdated: string;
  teams: PlayoffCalcTeamResult[];
  meta: PlayoffCalcMeta;
}

/**
 * Standard round-robin (circle method) schedule generator. Used when Sleeper
 * hasn't published matchups for the league yet (common pre-season). For an
 * even N, every team plays exactly once per round; for odd N, one team rests
 * each round. We cycle the base rounds if `weeks > N - 1`.
 */
function synthesizeRoundRobin(teamIds: number[], weeks: number): [number, number][][] {
  if (teamIds.length < 2 || weeks <= 0) return [];
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push(-1); // sentinel = bye
  const n = ids.length;
  const baseRounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    baseRounds.push(pairs);
    // Rotate everyone except the fixed first element.
    const rest = ids.slice(1);
    rest.unshift(rest.pop()!);
    for (let i = 1; i < n; i++) ids[i] = rest[i - 1];
  }
  const out: [number, number][][] = [];
  for (let w = 0; w < weeks; w++) out.push(baseRounds[w % baseRounds.length]);
  return out;
}

function deriveFormat(rosterPositions: string[]): "SF" | "1QB" {
  return rosterPositions.includes("SUPER_FLEX") ? "SF" : "1QB";
}

function deriveScoringFormat(scoringSettings: { rec?: number }): string {
  const rec = scoringSettings?.rec ?? 0;
  if (rec === 1) return "PPR";
  if (rec === 0.5) return "Half";
  return "Standard";
}

/**
 * Build the starter set the team would actually play this week given the
 * roster slots. Simple greedy: fill required spots (QB/RB/WR/TE) first, then
 * flex (RB/WR/TE), super_flex (QB-eligible), and any catch-all FLEX. Players
 * without FC redraft values count as 0 (matches what the UI does in the
 * win-now table).
 */
function optimalStarterTotal(
  playerIds: string[],
  rosterPositions: string[],
  valuesBySleeperId: Record<string, number>,
  playersDb: Record<string, any>
): number {
  // Bucket players by position w/ value
  const players = playerIds
    .map((pid) => {
      const p = playersDb[pid];
      if (!p) return null;
      const pos = p.fantasy_positions?.[0] || p.position;
      if (!["QB", "RB", "WR", "TE"].includes(pos)) return null;
      const v = valuesBySleeperId[pid] ?? 0;
      return { pid, pos: pos as "QB" | "RB" | "WR" | "TE", value: v };
    })
    .filter(Boolean) as { pid: string; pos: "QB" | "RB" | "WR" | "TE"; value: number }[];

  players.sort((a, b) => b.value - a.value);

  const used = new Set<string>();
  let total = 0;

  const takeBest = (eligible: (p: typeof players[number]) => boolean) => {
    for (const p of players) {
      if (used.has(p.pid)) continue;
      if (eligible(p)) {
        used.add(p.pid);
        total += p.value;
        return true;
      }
    }
    return false;
  };

  for (const slot of rosterPositions) {
    switch (slot) {
      case "QB": takeBest((p) => p.pos === "QB"); break;
      case "RB": takeBest((p) => p.pos === "RB"); break;
      case "WR": takeBest((p) => p.pos === "WR"); break;
      case "TE": takeBest((p) => p.pos === "TE"); break;
      case "FLEX":
      case "WRRB_FLEX":
      case "REC_FLEX":
        takeBest((p) => p.pos === "RB" || p.pos === "WR" || p.pos === "TE");
        break;
      case "SUPER_FLEX":
        takeBest((p) => p.pos === "QB" || p.pos === "RB" || p.pos === "WR" || p.pos === "TE");
        break;
      // BN / IR / TAXI / DEF / K — skip
      default:
        break;
    }
  }
  return total;
}

/**
 * Fetch all per-week matchup arrays, returning a map week -> matchups.
 * Stops requesting once we've covered up through regularSeasonWeeks.
 */
async function fetchAllMatchups(
  leagueId: string,
  regularSeasonWeeks: number
): Promise<Map<number, SleeperMatchupRaw[]>> {
  const weeks = Array.from({ length: regularSeasonWeeks }, (_, i) => i + 1);
  const results = await Promise.all(
    weeks.map((w) =>
      fetchJson<SleeperMatchupRaw[]>(`${SLEEPER_API}/league/${leagueId}/matchups/${w}`)
        .catch(() => [] as SleeperMatchupRaw[])
    )
  );
  const out = new Map<number, SleeperMatchupRaw[]>();
  weeks.forEach((w, i) => out.set(w, results[i] || []));
  return out;
}

function deriveCurrentWeek(matchupsByWeek: Map<number, SleeperMatchupRaw[]>): number {
  // The "current week" is the first week with no real scores yet.
  // Sleeper returns matchups for all weeks but unplayed weeks have points=0 across the board.
  const weeks = Array.from(matchupsByWeek.keys()).sort((a, b) => a - b);
  for (const w of weeks) {
    const matchups = matchupsByWeek.get(w) || [];
    const anyScore = matchups.some((m) => (m.points ?? 0) > 0);
    if (!anyScore) return w; // first unplayed
  }
  return weeks.length + 1;
}

/**
 * Run a single Monte Carlo trial.
 * Returns per-team final wins, points-for, plus seeding outcome flags.
 */
function simulateOnce(
  teams: TeamState[],
  remainingSchedule: { week: number; pairs: [number, number][] }[],
  weeklyStdDev: number,
  averageRating: number,
  averagePoints: number,
  playoffTeams: number,
  byes: number,
): void {
  // Reset per-trial accumulators
  const winsThisSim: Record<number, number> = {};
  const lossesThisSim: Record<number, number> = {};
  const tiesThisSim: Record<number, number> = {};
  const pfThisSim: Record<number, number> = {};
  for (const t of teams) {
    winsThisSim[t.rosterId] = t.currentWins;
    lossesThisSim[t.rosterId] = t.currentLosses;
    tiesThisSim[t.rosterId] = t.currentTies;
    pfThisSim[t.rosterId] = t.pointsFor;
  }

  for (const wk of remainingSchedule) {
    for (const [aId, bId] of wk.pairs) {
      const a = teams.find((t) => t.rosterId === aId);
      const b = teams.find((t) => t.rosterId === bId);
      if (!a || !b) continue;
      const expA = averagePoints + (a.teamRating - averageRating) * (averagePoints / 100 / RATING_TO_POINTS * 100);
      const expB = averagePoints + (b.teamRating - averageRating) * (averagePoints / 100 / RATING_TO_POINTS * 100);
      const scoreA = randNormal(expA, weeklyStdDev);
      const scoreB = randNormal(expB, weeklyStdDev);
      pfThisSim[aId] += scoreA;
      pfThisSim[bId] += scoreB;
      if (Math.abs(scoreA - scoreB) < 0.01) {
        tiesThisSim[aId] += 1;
        tiesThisSim[bId] += 1;
      } else if (scoreA > scoreB) {
        winsThisSim[aId] += 1;
        lossesThisSim[bId] += 1;
      } else {
        winsThisSim[bId] += 1;
        lossesThisSim[aId] += 1;
      }
    }
  }

  // Seed: wins desc, pf desc, rating desc fallback
  const standings = [...teams].sort((x, y) => {
    const wDiff = (winsThisSim[y.rosterId] + 0.5 * tiesThisSim[y.rosterId]) -
                  (winsThisSim[x.rosterId] + 0.5 * tiesThisSim[x.rosterId]);
    if (wDiff !== 0) return wDiff;
    const pfDiff = pfThisSim[y.rosterId] - pfThisSim[x.rosterId];
    if (pfDiff !== 0) return pfDiff;
    return y.teamRating - x.teamRating;
  });

  const playoffSeeds = standings.slice(0, playoffTeams);
  const byeSeeds = standings.slice(0, byes);

  // Simulate playoff bracket. Re-uses team ratings for matchup probabilities
  // with the same logistic+normal model. For simplicity: head-to-head normal
  // draws each round, single elimination.
  const advance = (a: TeamState, b: TeamState): TeamState => {
    const expA = averagePoints + (a.teamRating - averageRating) * (averagePoints / 100 / RATING_TO_POINTS * 100);
    const expB = averagePoints + (b.teamRating - averageRating) * (averagePoints / 100 / RATING_TO_POINTS * 100);
    const sA = randNormal(expA, weeklyStdDev);
    const sB = randNormal(expB, weeklyStdDev);
    return sA >= sB ? a : b;
  };

  // Bracket simulation.
  //
  // The "semifinal round" is defined as the round-of-4: the round in which
  // exactly four teams remain. For a 4-team playoff that's the opening round,
  // so all four seeds are semifinalists (matching the spec rule that for a
  // 4-team format, make_playoffs_pct == semifinals_pct). For a 6-team playoff
  // with 2 byes, one wildcard round reduces 4 non-bye teams to 2; combined
  // with the 2 bye teams, the round-of-4 is bye_teams + wildcard_winners.
  // For larger brackets we keep reducing the non-bye field one wildcard round
  // at a time until total alive ≤ 4.
  if (playoffSeeds.length > 0) {
    let alive: TeamState[] = playoffSeeds.slice(byes); // non-bye seeds

    const playRound = (field: TeamState[]): TeamState[] => {
      const winners: TeamState[] = [];
      let lo = 0, hi = field.length - 1;
      while (lo < hi) {
        winners.push(advance(field[lo], field[hi]));
        lo++; hi--;
      }
      if (lo === hi) winners.push(field[lo]); // odd man out gets a free pass
      return winners;
    };

    // Wildcard rounds: reduce until bye + alive ≤ 4
    while (byeSeeds.length + alive.length > 4) {
      alive = playRound(alive);
    }

    // The round-of-4 is the semifinal round.
    const semifinalists = [...byeSeeds, ...alive];
    for (const t of semifinalists) t.semifinals += 1;

    // Re-seed semifinalists by original standings (top seed vs lowest, etc.)
    const semiBracket = [...semifinalists].sort(
      (a, b) => standings.indexOf(a) - standings.indexOf(b)
    );
    const finalists = playRound(semiBracket);
    for (const t of finalists) t.finals += 1;

    // Championship round(s) — reduce until one team remains.
    let remaining = finalists;
    while (remaining.length > 1) {
      remaining = playRound(remaining);
    }
    if (remaining[0]) remaining[0].championship += 1;
  }

  // Record made-playoffs / bye / final-record accumulators
  for (const t of teams) {
    t.finalWinsTotal += winsThisSim[t.rosterId];
    t.finalPointsForTotal += pfThisSim[t.rosterId];
  }
  for (const t of playoffSeeds) t.madePlayoffs += 1;
  for (const t of byeSeeds) t.firstRoundBye += 1;
}

export async function computePlayoffCalculator(
  leagueId: string,
  simulationCount: number = 10000
): Promise<PlayoffCalcResponse> {
  const simCount = Math.max(MIN_SIMS, Math.min(MAX_SIMS, Math.floor(simulationCount) || 10000));

  const [leagueRaw, rostersRaw, usersRaw, playersDb] = await Promise.all([
    fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
    fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`),
    getSleeperPlayers(),
  ]);

  const rosterPositions: string[] = leagueRaw.roster_positions || [];
  const format = deriveFormat(rosterPositions);
  const scoringFormat = deriveScoringFormat(leagueRaw.scoring_settings || {});
  const isBestBall = leagueRaw.settings?.best_ball === 1;
  const totalRosters = rostersRaw.length;

  const playoffWeekStart: number = leagueRaw.settings?.playoff_week_start ?? 15;
  const regularSeasonWeeks: number = Math.max(1, playoffWeekStart - 1);
  // Defaults per spec:
  //   12-team → 6 playoffs, 10-team → 6 playoffs (not 5), 8-team → 4 playoffs.
  // Always trust an explicit league.settings.playoff_teams when present.
  let playoffTeams: number = Number(leagueRaw.settings?.playoff_teams) || 0;
  if (!playoffTeams || playoffTeams < 2) {
    if (totalRosters >= 10) playoffTeams = 6;
    else if (totalRosters >= 8) playoffTeams = 4;
    else playoffTeams = Math.max(2, Math.round(totalRosters / 2));
  }
  playoffTeams = Math.min(playoffTeams, totalRosters);
  // Sleeper exposes `playoff_round_type` but byes are derived from playoff_teams.
  // Common case: 6 teams -> top 2 byes. We default by parity unless setting hints otherwise.
  let byes = 0;
  if (playoffTeams === 6) byes = 2;
  else if (playoffTeams === 4) byes = 0;
  else if (playoffTeams >= 8) byes = playoffTeams - 4;
  // championship week: playoff_week_start + (rounds - 1). Most leagues: round=3 → week 17
  const playoffRounds = byes > 0 ? 3 : Math.ceil(Math.log2(Math.max(2, playoffTeams)));
  const championshipWeek = playoffWeekStart + Math.max(2, playoffRounds - 1);

  // Win-now values from FantasyCalc redraft (matches league format)
  const redraft = await getFantasyCalcRedraftValues(format === "SF" ? "sf" : "1qb")
    .catch(() => ({ valuesBySleeperId: {} as Record<string, number> }));
  const winNowMap: Record<string, number> = redraft.valuesBySleeperId || {};

  const userMap = new Map<string, SleeperLeagueUserRaw>();
  for (const u of usersRaw) userMap.set(u.user_id, u);

  // Build team states + win-now scores
  const winNowScores: number[] = [];
  const teams: TeamState[] = rostersRaw.map((r) => {
    const u = r.owner_id ? userMap.get(r.owner_id) : null;
    const winNow = optimalStarterTotal(r.players || [], rosterPositions, winNowMap, playersDb);
    winNowScores.push(winNow);
    const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
    const fptsAgainst = (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100;
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      teamName: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
      ownerName: u?.display_name || `Owner ${r.roster_id}`,
      avatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null,
      currentWins: r.settings?.wins ?? 0,
      currentLosses: r.settings?.losses ?? 0,
      currentTies: r.settings?.ties ?? 0,
      pointsFor: fpts,
      pointsAgainst: fptsAgainst,
      winNowScore: winNow,
      teamRating: 50, // filled in below
      ratingSource: "fantasycalc",
      remainingOpponents: [],
      finalWinsTotal: 0,
      finalPointsForTotal: 0,
      madePlayoffs: 0,
      firstRoundBye: 0,
      semifinals: 0,
      finals: 0,
      championship: 0,
    };
  });

  // Convert win-now -> 0-100 rating, normalized to league. Teams with no
  // win-now score (FantasyCalc miss, empty roster, etc.) fall back to the
  // league-average rating so they still participate fairly in simulations —
  // never silently treated as the league's worst team.
  const validWN = winNowScores.filter((s) => s > 0);
  const minWN = validWN.length > 0 ? Math.min(...validWN) : 0;
  const maxWN = validWN.length > 0 ? Math.max(...validWN) : 0;
  const spanWN = Math.max(1, maxWN - minWN);
  const ratedTeamRatings: number[] = [];
  for (const t of teams) {
    if (t.winNowScore > 0 && validWN.length > 0) {
      const norm = (t.winNowScore - minWN) / spanWN;
      t.teamRating = Math.round(20 + norm * 70);
      t.ratingSource = "fantasycalc";
      ratedTeamRatings.push(t.teamRating);
    } else {
      // Mark for fallback — assigned below once we know the average.
      t.ratingSource = "fallback";
    }
  }
  const fallbackRating = ratedTeamRatings.length > 0
    ? Math.round(ratedTeamRatings.reduce((s, r) => s + r, 0) / ratedTeamRatings.length)
    : 50;
  for (const t of teams) {
    if (t.ratingSource === "fallback") t.teamRating = fallbackRating;
  }
  const averageRating = teams.reduce((s, t) => s + t.teamRating, 0) / teams.length;

  // Fetch all weekly matchups, build remaining schedule
  const matchupsByWeek = await fetchAllMatchups(leagueId, regularSeasonWeeks);
  const currentWeek = deriveCurrentWeek(matchupsByWeek);
  const warnings: string[] = [];

  let remainingSchedule: { week: number; pairs: [number, number][] }[] = [];
  for (let w = currentWeek; w <= regularSeasonWeeks; w++) {
    const ms = matchupsByWeek.get(w) || [];
    const byMatchup = new Map<number, number[]>();
    for (const m of ms) {
      if (m.matchup_id == null) continue;
      const arr = byMatchup.get(m.matchup_id) || [];
      arr.push(m.roster_id);
      byMatchup.set(m.matchup_id, arr);
    }
    const pairs: [number, number][] = [];
    byMatchup.forEach((arr) => {
      if (arr.length === 2) pairs.push([arr[0], arr[1]]);
    });
    if (pairs.length > 0) remainingSchedule.push({ week: w, pairs });
  }

  // ── Schedule source bookkeeping ───────────────────────────────────────────
  // If Sleeper hasn't published the matchup schedule yet (common for leagues
  // that just finished drafting), synthesize a round-robin for the remaining
  // weeks rather than degrading to the binary "season over" branch — which
  // would assign 100%/0% odds based on a 0-0 record sort.
  const anyGamesPlayed = teams.some((t) => t.currentWins + t.currentLosses + t.currentTies > 0);
  let scheduleSource: "sleeper" | "synthetic" | "none" = remainingSchedule.length > 0 ? "sleeper" : "none";
  if (remainingSchedule.length === 0 && !anyGamesPlayed && currentWeek <= regularSeasonWeeks) {
    const teamIds = teams.map((t) => t.rosterId);
    const weeksNeeded = regularSeasonWeeks - currentWeek + 1;
    const synthRounds = synthesizeRoundRobin(teamIds, weeksNeeded);
    remainingSchedule = synthRounds.map((pairs, i) => ({ week: currentWeek + i, pairs }));
    scheduleSource = remainingSchedule.length > 0 ? "synthetic" : "none";
    if (scheduleSource === "synthetic") {
      warnings.push(
        `Sleeper has not published the regular-season schedule yet; using a synthesized round-robin for weeks ${currentWeek}–${regularSeasonWeeks}.`
      );
    }
  }
  if (scheduleSource === "none" && currentWeek <= regularSeasonWeeks) {
    warnings.push(
      `No remaining-schedule data is available for weeks ${currentWeek}–${regularSeasonWeeks}; odds are estimated from current standings only.`
    );
  }

  // Track each team's remaining opponents list for SOS
  for (const wk of remainingSchedule) {
    for (const [a, b] of wk.pairs) {
      const ta = teams.find((t) => t.rosterId === a);
      const tb = teams.find((t) => t.rosterId === b);
      if (ta) ta.remainingOpponents.push(b);
      if (tb) tb.remainingOpponents.push(a);
    }
  }

  // Calibrate league-average per-team weekly points using historic data when present.
  // Fall back to a reasonable default.
  let playedTeamWeeks = 0;
  let playedTotalPoints = 0;
  for (let w = 1; w < currentWeek; w++) {
    const ms = matchupsByWeek.get(w) || [];
    for (const m of ms) {
      if ((m.points ?? 0) > 0) {
        playedTotalPoints += m.points;
        playedTeamWeeks += 1;
      }
    }
  }
  const averagePoints = playedTeamWeeks > 0
    ? playedTotalPoints / playedTeamWeeks
    : (format === "SF" ? 130 : 115);

  // Per-format variance
  let weeklyStdDev = DEFAULT_STD_DEV;
  if (format === "SF") weeklyStdDev += SF_STD_DEV_BUMP;
  if (isBestBall) weeklyStdDev += BESTBALL_STD_DEV_PENALTY;

  // Run Monte Carlo — always simCount iterations, always divide by simCount.
  // When there are no remaining matchups (truly season-over: schedule empty
  // AND games have been played), simulateOnce still runs the playoff bracket
  // from locked standings, so byes/semis/finals/champ are populated normally.
  for (let i = 0; i < simCount; i++) {
    simulateOnce(teams, remainingSchedule, weeklyStdDev, averageRating, averagePoints, playoffTeams, byes);
  }
  const divisor = simCount;

  // Sanity sums for the meta payload + server log. These are computed from
  // raw counters before the per-team rounding below.
  const playoffPctSum = (teams.reduce((s, t) => s + t.madePlayoffs, 0) / divisor) * 100;
  const byePctSum = (teams.reduce((s, t) => s + t.firstRoundBye, 0) / divisor) * 100;
  const championshipPctSum = (teams.reduce((s, t) => s + t.championship, 0) / divisor) * 100;

  // Build per-team results
  const teamResults: PlayoffCalcTeamResult[] = teams.map((t) => {
    const projectedWins = remainingSchedule.length > 0
      ? t.finalWinsTotal / simCount
      : t.currentWins;
    const projectedPF = remainingSchedule.length > 0
      ? t.finalPointsForTotal / simCount
      : t.pointsFor;
    const totalGames = t.currentWins + t.currentLosses + t.currentTies + t.remainingOpponents.length;
    const projectedLosses = Math.max(0, totalGames - projectedWins - t.currentTies);
    const expectedWinsRemaining = projectedWins - t.currentWins;
    const remainingSos = t.remainingOpponents.length > 0
      ? t.remainingOpponents.reduce((s, oppId) => {
          const opp = teams.find((tt) => tt.rosterId === oppId);
          return s + (opp?.teamRating ?? 50);
        }, 0) / t.remainingOpponents.length
      : 0;

    return {
      roster_id: t.rosterId,
      owner_id: t.ownerId,
      team_name: t.teamName,
      owner_name: t.ownerName,
      avatar: t.avatar,
      current_wins: t.currentWins,
      current_losses: t.currentLosses,
      current_ties: t.currentTies,
      points_for: Math.round(t.pointsFor * 100) / 100,
      points_against: Math.round(t.pointsAgainst * 100) / 100,
      win_now_score: Math.round(t.winNowScore),
      team_rating: t.teamRating,
      rating_source: t.ratingSource,
      remaining_opponents: t.remainingOpponents,
      remaining_games: t.remainingOpponents.length,
      projected_record: `${projectedWins.toFixed(1)}-${projectedLosses.toFixed(1)}${t.currentTies > 0 ? `-${t.currentTies}` : ""}`,
      projected_wins: Math.round(projectedWins * 10) / 10,
      projected_losses: Math.round(projectedLosses * 10) / 10,
      remaining_sos: Math.round(remainingSos * 10) / 10,
      expected_wins_remaining: Math.round(expectedWinsRemaining * 10) / 10,
      projected_points_for: Math.round(projectedPF),
      make_playoffs_pct: Math.round((t.madePlayoffs / divisor) * 1000) / 10,
      first_round_bye_pct: Math.round((t.firstRoundBye / divisor) * 1000) / 10,
      semifinals_pct: Math.round((t.semifinals / divisor) * 1000) / 10,
      finals_pct: Math.round((t.finals / divisor) * 1000) / 10,
      championship_pct: Math.round((t.championship / divisor) * 1000) / 10,
      change_since_last_run: 0,
    };
  });

  teamResults.sort((a, b) => b.make_playoffs_pct - a.make_playoffs_pct);

  // ── Sanity checks + debug log ─────────────────────────────────────────────
  // Sums should be very close to playoffTeams*100 / byes*100 / 100 — any large
  // deviation indicates a bracket/seeding bug.
  const remainingGames = remainingSchedule.reduce((s, w) => s + w.pairs.length, 0);
  console.log(
    `[PlayoffCalc] league=${leagueRaw.league_id} teams=${teams.length} playoffTeams=${playoffTeams} byes=${byes} ` +
    `currentWeek=${currentWeek} regSeasonWeeks=${regularSeasonWeeks} remainingGames=${remainingGames} ` +
    `scheduleSource=${scheduleSource} simCount=${simCount}`
  );
  console.log(
    `[PlayoffCalc] sums: mp=${playoffPctSum.toFixed(1)} (expect ${playoffTeams * 100}) ` +
    `bye=${byePctSum.toFixed(1)} (expect ${byes * 100}) ch=${championshipPctSum.toFixed(1)} (expect 100)`
  );
  const sumDeviation = Math.abs(playoffPctSum - playoffTeams * 100);
  if (sumDeviation > 1) {
    warnings.push(`Playoff-odds sum (${playoffPctSum.toFixed(1)}) deviates from expected (${playoffTeams * 100}).`);
  }
  if (process.env.PLAYOFF_CALC_DEBUG === "true") {
    for (const t of teams) {
      console.log(
        `[PlayoffCalc]   ${t.teamName.padEnd(24)} rating=${t.teamRating}(${t.ratingSource}) ` +
        `wn=${Math.round(t.winNowScore).toString().padStart(5)} ` +
        `record=${t.currentWins}-${t.currentLosses}-${t.currentTies} ` +
        `remGames=${t.remainingOpponents.length} ` +
        `avgSimWins=${(t.finalWinsTotal / simCount).toFixed(2)} ` +
        `mp=${(t.madePlayoffs / divisor * 100).toFixed(1)}% ` +
        `bye=${(t.firstRoundBye / divisor * 100).toFixed(1)}% ` +
        `ch=${(t.championship / divisor * 100).toFixed(1)}%`
      );
    }
  }

  return {
    league: {
      id: leagueRaw.league_id,
      name: leagueRaw.name,
      season: leagueRaw.season,
      totalRosters,
    },
    settings: {
      playoffTeams,
      byes,
      playoffWeekStart,
      championshipWeek,
      regularSeasonWeeks,
      currentWeek,
      remainingWeeks: Math.max(0, regularSeasonWeeks - currentWeek + 1),
      format,
      scoringFormat,
      isBestBall,
    },
    simulationCount: simCount,
    lastUpdated: new Date().toISOString(),
    teams: teamResults,
    meta: {
      totalTeams: teams.length,
      playoffTeams,
      byeTeams: byes,
      currentWeek,
      regularSeasonEndWeek: regularSeasonWeeks,
      remainingGames,
      simulations: simCount,
      scheduleSource,
      playoffPctSum: Math.round(playoffPctSum * 10) / 10,
      byePctSum: Math.round(byePctSum * 10) / 10,
      championshipPctSum: Math.round(championshipPctSum * 10) / 10,
      warnings,
    },
  };
}

// ── Weekly matchups ──────────────────────────────────────────────────────────

// Default scale for the logistic win-prob model. With FantasyCalc redraft
// starter totals (typically tens of thousands), a 900-unit gap maps to a
// sigmoid input of ~1.0 → ~73% win-prob for the favorite. Exported so the
// client can pass a tuned value later if we swap in projected points.
export const MATCHUP_WIN_PROB_SCALE = 900;

/**
 * Logistic win probability for team A vs team B given a single-number rating
 * per team (e.g. FantasyCalc-derived win-now starter total). Symmetric, so
 * `calculateMatchupWinProbability(a, b)` + `calculateMatchupWinProbability(b, a)`
 * always sums to 1.
 */
export function calculateMatchupWinProbability(
  teamAWinNow: number,
  teamBWinNow: number,
  scale: number = MATCHUP_WIN_PROB_SCALE,
): number {
  const safeScale = scale > 0 ? scale : MATCHUP_WIN_PROB_SCALE;
  const diff = teamAWinNow - teamBWinNow;
  return 1 / (1 + Math.exp(-diff / safeScale));
}

export interface WeeklyMatchupTeam {
  rosterId: number;
  /** Sleeper user_id of the team owner. Drives the Manager Intel drawer. */
  ownerId: string | null;
  ownerName: string;
  teamName: string;
  avatar: string | null;
  record: string;
  pointsFor: number;        // current matchup score (0 when not yet played)
  winNowScore: number;
  winProbability: number;   // 0..100
}

export type WeeklyMatchupStatus = "upcoming" | "live" | "final";

export interface WeeklyMatchupCard {
  matchupId: number | null;   // null for synthesized matchups (no Sleeper schedule)
  status: WeeklyMatchupStatus;
  isBye: boolean;
  teamA: WeeklyMatchupTeam;
  teamB: WeeklyMatchupTeam | null;
  favoriteRosterId: number | null;
  edgePct: number;            // 0..100, absolute spread between favorite and underdog
  combinedWinNowScore: number;
  scoreA: number;
  scoreB: number;
}

export interface WeeklyMatchupsSummary {
  biggestFavorite: { matchupId: number | null; rosterId: number; winProbability: number } | null;
  closestMatchup: { matchupId: number | null; edgePct: number } | null;
  highestCombinedScore: { matchupId: number | null; combinedWinNowScore: number } | null;
  upsetWatch: { matchupId: number | null; underdogRosterId: number; underdogWinProbability: number } | null;
}

export interface WeeklyMatchupsResponse {
  leagueId: string;
  week: number;
  currentWeek: number;
  regularSeasonWeeks: number;
  scheduleSource: "sleeper" | "synthetic" | "none";
  matchups: WeeklyMatchupCard[];
  summary: WeeklyMatchupsSummary;
  warnings: string[];
}

/**
 * Group raw Sleeper matchups for a single week into roster-pair tuples by
 * `matchup_id`. Roster ids appear in the order returned by Sleeper (usually
 * roster_id order). Single-roster groups are kept so we can render byes.
 */
function groupMatchupsByPairing(ms: SleeperMatchupRaw[]): Map<number, SleeperMatchupRaw[]> {
  const byMatchup = new Map<number, SleeperMatchupRaw[]>();
  for (const m of ms) {
    if (m.matchup_id == null) continue;
    const arr = byMatchup.get(m.matchup_id) || [];
    arr.push(m);
    byMatchup.set(m.matchup_id, arr);
  }
  return byMatchup;
}

export async function computeWeeklyMatchups(
  leagueId: string,
  requestedWeek?: number,
): Promise<WeeklyMatchupsResponse> {
  const [leagueRaw, rostersRaw, usersRaw, playersDb] = await Promise.all([
    fetchJson<SleeperLeagueRaw>(`${SLEEPER_API}/league/${leagueId}`),
    fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${leagueId}/users`),
    getSleeperPlayers(),
  ]);

  const rosterPositions: string[] = leagueRaw.roster_positions || [];
  const format = deriveFormat(rosterPositions);
  const playoffWeekStart: number = leagueRaw.settings?.playoff_week_start ?? 15;
  const regularSeasonWeeks: number = Math.max(1, playoffWeekStart - 1);

  const redraft = await getFantasyCalcRedraftValues(format === "SF" ? "sf" : "1qb")
    .catch(() => ({ valuesBySleeperId: {} as Record<string, number> }));
  const winNowMap: Record<string, number> = redraft.valuesBySleeperId || {};

  const userMap = new Map<string, SleeperLeagueUserRaw>();
  for (const u of usersRaw) userMap.set(u.user_id, u);

  // Per-team static info + win-now score
  const teamInfo = new Map<number, {
    rosterId: number;
    ownerId: string | null;
    ownerName: string;
    teamName: string;
    avatar: string | null;
    record: string;
    winNowScore: number;
  }>();
  for (const r of rostersRaw) {
    const u = r.owner_id ? userMap.get(r.owner_id) : null;
    const wins = r.settings?.wins ?? 0;
    const losses = r.settings?.losses ?? 0;
    const ties = r.settings?.ties ?? 0;
    teamInfo.set(r.roster_id, {
      rosterId: r.roster_id,
      ownerId: r.owner_id || null,
      teamName: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
      ownerName: u?.display_name || `Owner ${r.roster_id}`,
      avatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null,
      record: `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}`,
      winNowScore: optimalStarterTotal(r.players || [], rosterPositions, winNowMap, playersDb),
    });
  }

  const matchupsByWeek = await fetchAllMatchups(leagueId, regularSeasonWeeks);
  const currentWeek = deriveCurrentWeek(matchupsByWeek);

  // Clamp requested week into [1, regularSeasonWeeks]. Default = currentWeek
  // if we're inside the regular season, else Week 1.
  const inRegSeason = currentWeek >= 1 && currentWeek <= regularSeasonWeeks;
  const defaultWeek = inRegSeason ? currentWeek : 1;
  const week = Math.max(1, Math.min(regularSeasonWeeks,
    Math.floor(requestedWeek ?? defaultWeek) || defaultWeek));

  const warnings: string[] = [];
  const rawMatchups = matchupsByWeek.get(week) || [];
  let scheduleSource: "sleeper" | "synthetic" | "none" = rawMatchups.length > 0 ? "sleeper" : "none";

  // If Sleeper hasn't published the schedule, synthesize a round-robin so the
  // weekly view doesn't go blank pre-season.
  let pairs: { matchupId: number | null; rosters: SleeperMatchupRaw[] }[] = [];
  if (rawMatchups.length > 0) {
    const grouped = groupMatchupsByPairing(rawMatchups);
    grouped.forEach((rosters, matchupId) => pairs.push({ matchupId, rosters }));
    // Sort by Sleeper-supplied matchup_id for stable order.
    pairs.sort((a, b) => (a.matchupId ?? 0) - (b.matchupId ?? 0));
  } else if (week >= currentWeek) {
    const teamIds = rostersRaw.map((r) => r.roster_id);
    const synth = synthesizeRoundRobin(teamIds, regularSeasonWeeks);
    const offset = week - 1;
    const round = synth[offset] || [];
    pairs = round.map(([a, b]) => ({
      matchupId: null,
      rosters: [
        { roster_id: a, matchup_id: null, points: 0 } as SleeperMatchupRaw,
        { roster_id: b, matchup_id: null, points: 0 } as SleeperMatchupRaw,
      ],
    }));
    if (pairs.length > 0) {
      scheduleSource = "synthetic";
      warnings.push(
        `Sleeper has not published the schedule yet; showing a synthesized round-robin for week ${week}.`,
      );
    }
  }

  if (pairs.length === 0) {
    warnings.push(`No matchup data available for week ${week}.`);
  }

  const buildTeam = (
    m: SleeperMatchupRaw,
    winProbabilityPct: number,
  ): WeeklyMatchupTeam => {
    const info = teamInfo.get(m.roster_id);
    return {
      rosterId: m.roster_id,
      ownerId: info?.ownerId ?? null,
      ownerName: info?.ownerName || `Owner ${m.roster_id}`,
      teamName: info?.teamName || `Team ${m.roster_id}`,
      avatar: info?.avatar ?? null,
      record: info?.record || "0-0",
      pointsFor: Math.round((m.points ?? 0) * 100) / 100,
      winNowScore: Math.round(info?.winNowScore || 0),
      winProbability: Math.round(winProbabilityPct * 10) / 10,
    };
  };

  const cards: WeeklyMatchupCard[] = pairs.map(({ matchupId, rosters }) => {
    if (rosters.length === 1) {
      const [solo] = rosters;
      const team = buildTeam(solo, 0);
      return {
        matchupId,
        status: "upcoming" as WeeklyMatchupStatus,
        isBye: true,
        teamA: team,
        teamB: null,
        favoriteRosterId: null,
        edgePct: 0,
        combinedWinNowScore: team.winNowScore,
        scoreA: team.pointsFor,
        scoreB: 0,
      };
    }
    const [a, b] = rosters;
    const aInfo = teamInfo.get(a.roster_id);
    const bInfo = teamInfo.get(b.roster_id);
    const probA = calculateMatchupWinProbability(
      aInfo?.winNowScore ?? 0,
      bInfo?.winNowScore ?? 0,
    );
    const teamA = buildTeam(a, probA * 100);
    const teamB = buildTeam(b, (1 - probA) * 100);

    const anyScore = (a.points ?? 0) > 0 || (b.points ?? 0) > 0;
    let status: WeeklyMatchupStatus;
    if (week < currentWeek) status = "final";
    else if (week === currentWeek) status = anyScore ? "live" : "upcoming";
    else status = "upcoming";

    const edgePct = Math.abs(teamA.winProbability - teamB.winProbability);
    const favoriteRosterId = teamA.winProbability >= teamB.winProbability ? a.roster_id : b.roster_id;

    return {
      matchupId,
      status,
      isBye: false,
      teamA,
      teamB,
      favoriteRosterId,
      edgePct: Math.round(edgePct * 10) / 10,
      combinedWinNowScore: teamA.winNowScore + teamB.winNowScore,
      scoreA: teamA.pointsFor,
      scoreB: teamB.pointsFor,
    };
  });

  // ── Summary cards ───────────────────────────────────────────────────────
  const headToHead = cards.filter((c) => !c.isBye && c.teamB);

  const biggestFavoriteCard = [...headToHead].sort((x, y) => {
    const xMax = Math.max(x.teamA.winProbability, x.teamB!.winProbability);
    const yMax = Math.max(y.teamA.winProbability, y.teamB!.winProbability);
    return yMax - xMax;
  })[0];
  const closestCard = [...headToHead].sort((x, y) => x.edgePct - y.edgePct)[0];
  const highestCombinedCard = [...headToHead].sort(
    (x, y) => y.combinedWinNowScore - x.combinedWinNowScore,
  )[0];
  // Upset watch: matchup where the underdog has the highest realistic chance
  // (i.e., closest underdog probability under 50%). Picks matchups where an
  // upset is plausible without just collapsing to "closest matchup".
  const upsetCard = [...headToHead]
    .map((c) => {
      const underdogProb = Math.min(c.teamA.winProbability, c.teamB!.winProbability);
      const underdogRosterId = c.teamA.winProbability < c.teamB!.winProbability
        ? c.teamA.rosterId : c.teamB!.rosterId;
      return { card: c, underdogProb, underdogRosterId };
    })
    .filter((x) => x.underdogProb >= 30 && x.underdogProb < 50)
    .sort((x, y) => y.underdogProb - x.underdogProb)[0];

  const summary: WeeklyMatchupsSummary = {
    biggestFavorite: biggestFavoriteCard
      ? {
          matchupId: biggestFavoriteCard.matchupId,
          rosterId: biggestFavoriteCard.favoriteRosterId!,
          winProbability: Math.max(
            biggestFavoriteCard.teamA.winProbability,
            biggestFavoriteCard.teamB!.winProbability,
          ),
        }
      : null,
    closestMatchup: closestCard
      ? { matchupId: closestCard.matchupId, edgePct: closestCard.edgePct }
      : null,
    highestCombinedScore: highestCombinedCard
      ? {
          matchupId: highestCombinedCard.matchupId,
          combinedWinNowScore: highestCombinedCard.combinedWinNowScore,
        }
      : null,
    upsetWatch: upsetCard
      ? {
          matchupId: upsetCard.card.matchupId,
          underdogRosterId: upsetCard.underdogRosterId,
          underdogWinProbability: upsetCard.underdogProb,
        }
      : null,
  };

  return {
    leagueId,
    week,
    currentWeek,
    regularSeasonWeeks,
    scheduleSource,
    matchups: cards,
    summary,
    warnings,
  };
}
