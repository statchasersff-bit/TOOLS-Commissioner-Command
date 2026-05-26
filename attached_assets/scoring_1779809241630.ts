// src/lib/scoring.ts
// Ready-made league-aware scoring for StatChasers

type NumRec = Record<string, number | undefined>;
export type LeagueScoring = Record<string, number | undefined>;

// safe getter with a default
const g = (s: LeagueScoring, k: string, d = 0) =>
  typeof s?.[k] === "number" ? (s[k] as number) : d;

/** Points Allowed bracket award (DST).
 * Adds the LEAGUE'S bracket bonus/penalty for the given pts_allowed.
 * Defaults are 0 so we don't assume a house rule when league omits a bracket.
 */
function paBracketPoints(pa: number, scoring: LeagueScoring) {
  if (pa <= 0) return g(scoring, "def_pa_0", 0);
  if (pa <= 6) return g(scoring, "def_pa_1_6", 0);
  if (pa <= 13) return g(scoring, "def_pa_7_13", 0);
  if (pa <= 20) return g(scoring, "def_pa_14_20", 0);
  if (pa <= 27) return g(scoring, "def_pa_21_27", 0);
  if (pa <= 34) return g(scoring, "def_pa_28_34", 0);
  return g(scoring, "def_pa_35p", 0);
}

/** Offense (QB/RB/WR/TE) */
export function scoreOff(stats: NumRec, scoring: LeagueScoring, position?: string) {
  const passAtt  = stats.pass_att ?? 0;
  const passCmp  = stats.pass_comp ?? 0;
  const passYd   = stats.pass_yd ?? 0;
  const passTd   = stats.pass_td ?? 0;
  const passInt  = stats.pass_int ?? 0;

  const rushAtt  = stats.rush_att ?? 0;
  const rushYd   = stats.rush_yd ?? 0;
  const rushTd   = stats.rush_td ?? 0;

  const rec      = stats.rec ?? 0;
  const recYd    = stats.rec_yd ?? 0;
  const recTd    = stats.rec_td ?? 0;

  const fumLost  = stats.fum_lost ?? 0;
  const twoPt    = stats.two_pt ?? 0;

  let pts =
    passAtt * g(scoring, "pass_att", 0) +
    passCmp * g(scoring, "pass_cmp", 0) +
    passYd  * g(scoring, "pass_yd", 0.04) +
    passTd  * g(scoring, "pass_td", 4) +
    passInt * g(scoring, "pass_int", -1) +
    rushAtt * g(scoring, "rush_att", 0) +
    rushYd  * g(scoring, "rush_yd", 0.1) +
    rushTd  * g(scoring, "rush_td", 6) +
    rec     * g(scoring, "rec", 1) +
    recYd   * g(scoring, "rec_yd", 0.1) +
    recTd   * g(scoring, "rec_td", 6) +
    fumLost * g(scoring, "fum_lost", -2) +
    twoPt   * g(scoring, "two_pt", 2);

  // Add TE premium if applicable
  if (position?.toUpperCase() === "TE" && rec > 0) {
    const tePremium = g(scoring, "bonus_rec_te", 0);
    pts += rec * tePremium;
  }


  return pts;
}

/** Kickers (K) */
export function scoreK(stats: NumRec, scoring: LeagueScoring) {
  const xpm       = stats.xpm ?? 0;
  const xpa       = stats.xpa ?? 0; // used only if league penalizes attempts/misses

  const fgm_0_19  = stats.fgm_0_19 ?? 0;
  const fgm_20_29 = stats.fgm_20_29 ?? 0;
  const fgm_30_39 = stats.fgm_30_39 ?? 0;
  const fgm_40_49 = stats.fgm_40_49 ?? 0;
  const fgm_50p   = stats.fgm_50p ?? 0;

  // Note: some leagues use "xp_miss" for penalties instead of xpa;
  // if you add an xp_miss column later, include it here with g(scoring,"xp_miss", -1).
  return (
    xpm       * g(scoring, "xpm", 1) +
    xpa       * g(scoring, "xpa", 0) +
    fgm_0_19  * g(scoring, "fgm_0_19", 3) +
    fgm_20_29 * g(scoring, "fgm_20_29", 3) +
    fgm_30_39 * g(scoring, "fgm_30_39", 3) +
    fgm_40_49 * g(scoring, "fgm_40_49", 4) +
    fgm_50p   * g(scoring, "fgm_50p", 5)
  );
}

/** Defense/Special Teams (DEF/DST) */
export function scoreDST(stats: NumRec, scoring: LeagueScoring) {
  const sacks   = stats.sacks ?? 0;
  const ints    = stats.defs_int ?? 0;
  const fr      = stats.defs_fum_rec ?? 0;
  const td      = stats.defs_td ?? 0;
  const safety  = stats.safety ?? 0;
  const blk     = stats.blk_kick ?? 0;
  const ret_td  = stats.ret_td ?? 0;
  const pa      = stats.pts_allowed ?? Number.NaN; // optional

  let pts =
    sacks  * g(scoring, "def_sack", 1) +
    ints   * g(scoring, "def_int", 2) +
    fr     * g(scoring, "def_fum_rec", 2) +
    td     * g(scoring, "def_td", 6) +
    safety * g(scoring, "def_sfty", 2) +
    blk    * g(scoring, "def_blk_kick", 2) +
    ret_td * g(scoring, "st_td", 6);

  if (Number.isFinite(pa)) {
    pts += paBracketPoints(pa, scoring);
  }
  return pts;
}

/** Router: compute league-adjusted projection from stat columns;
 * if no helpful stats provided, fall back to `fallbackTotal`.
 */
export function scoreByLeague(
  pos: string,
  stats: NumRec,
  scoring: LeagueScoring,
  fallbackTotal?: number
) {
  const P = (pos || "").toUpperCase();
  
  // For kickers (K) and defenses (DEF), use ONLY the proj column directly
  if (P === "K") return fallbackTotal ?? 0;
  if (P === "DEF" || P === "DST" || P === "D/ST") return fallbackTotal ?? 0;

  const off = scoreOff(stats, scoring, pos);
  return (isFinite(off) && off !== 0) ? off : (fallbackTotal ?? 0);
}