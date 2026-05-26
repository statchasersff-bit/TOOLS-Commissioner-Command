// League-aware scoring for StatChasers

type NumRec = Record<string, number | undefined>;
export type LeagueScoring = Record<string, number | undefined>;

// safe getter with a default
const g = (s: LeagueScoring, k: string, d = 0) =>
  typeof s?.[k] === "number" ? (s[k] as number) : d;

/**
 * Points Allowed bracket award (DST).
 * Adds the LEAGUE'S bracket bonus/penalty for the given pts_allowed.
 */
function paBracketPoints(pa: number, scoring: LeagueScoring) {
  if (pa <= 0)  return g(scoring, "def_pa_0", 0);
  if (pa <= 6)  return g(scoring, "def_pa_1_6", 0);
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

  // TE premium
  if (position?.toUpperCase() === "TE" && rec > 0) {
    pts += rec * g(scoring, "bonus_rec_te", 0);
  }

  return pts;
}

/** Kickers (K) */
export function scoreK(stats: NumRec, scoring: LeagueScoring) {
  return (
    (stats.xpm ?? 0)       * g(scoring, "xpm", 1) +
    (stats.xpa ?? 0)       * g(scoring, "xpa", 0) +
    (stats.fgm_0_19 ?? 0)  * g(scoring, "fgm_0_19", 3) +
    (stats.fgm_20_29 ?? 0) * g(scoring, "fgm_20_29", 3) +
    (stats.fgm_30_39 ?? 0) * g(scoring, "fgm_30_39", 3) +
    (stats.fgm_40_49 ?? 0) * g(scoring, "fgm_40_49", 4) +
    (stats.fgm_50p ?? 0)   * g(scoring, "fgm_50p", 5)
  );
}

/** Defense/Special Teams (DEF/DST) */
export function scoreDST(stats: NumRec, scoring: LeagueScoring) {
  const pa = stats.pts_allowed ?? Number.NaN;

  let pts =
    (stats.sacks ?? 0)       * g(scoring, "def_sack", 1) +
    (stats.defs_int ?? 0)    * g(scoring, "def_int", 2) +
    (stats.defs_fum_rec ?? 0)* g(scoring, "def_fum_rec", 2) +
    (stats.defs_td ?? 0)     * g(scoring, "def_td", 6) +
    (stats.safety ?? 0)      * g(scoring, "def_sfty", 2) +
    (stats.blk_kick ?? 0)    * g(scoring, "def_blk_kick", 2) +
    (stats.ret_td ?? 0)      * g(scoring, "st_td", 6);

  if (Number.isFinite(pa)) pts += paBracketPoints(pa, scoring);
  return pts;
}

/**
 * Router: compute league-adjusted projection from stat columns.
 * Falls back to `fallbackTotal` if no helpful stats provided.
 */
export function scoreByLeague(
  pos: string,
  stats: NumRec,
  scoring: LeagueScoring,
  fallbackTotal?: number
) {
  const P = (pos || "").toUpperCase();
  if (P === "K") return fallbackTotal ?? 0;
  if (P === "DEF" || P === "DST" || P === "D/ST") return fallbackTotal ?? 0;

  const off = scoreOff(stats, scoring, pos);
  return (isFinite(off) && off !== 0) ? off : (fallbackTotal ?? 0);
}
