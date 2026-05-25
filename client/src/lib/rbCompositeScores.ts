/**
 * RB composite-grade engine.
 *
 * Produces five normalized 0-100 grades — Volume, Efficiency, Explosiveness,
 * Receiving, Elusiveness — plus a blended Overall RB Grade. Every input stat is
 * first converted to a percentile rank across the supplied population (never a
 * raw average), so grades are always relative to the RB pool passed in.
 *
 * Each composite is built to capture a DISTINCT trait so the five axes spread
 * cleanly on a radar chart (bellcows score Volume, scat-backs score Receiving,
 * home-run backs score Explosiveness, etc.). Raw counting stats that simply
 * track opportunity (fantasy points, raw yards, TDs) are deliberately excluded
 * from the composites — they live as standalone context columns.
 *
 * Modularity: all the percentile/clamp math lives in ./percentiles (position-
 * agnostic). This file only owns the RB field map + category weights, mirroring
 * the QB engine's shape.
 */
import { percentileColumnAgainst, clampScore, toFiniteNumber as num } from './percentiles';

/**
 * Qualifier for the percentile baseline. Tiny-sample backs would otherwise
 * distort the distribution, so percentiles are ranked against RBs meeting this
 * bar (a real ground game OR a real receiving role). Scores are still produced
 * for everyone — unqualified RBs are just measured against the qualified curve.
 */
export function isQualifiedRb(row: Record<string, unknown>): boolean {
  return num(row.rushAttempts) >= 50 || num(row.targets) >= 25;
}

export interface RbCompositeScores {
  volumeScore: number;
  efficiencyScore: number;
  explosivenessScore: number;
  receivingScore: number;
  elusivenessScore: number;
  overallRBGrade: number;
}

export type RbScoreKey = keyof RbCompositeScores;

/** Display metadata for each grade — drives column labels, tooltips, radar axes. */
export interface RbScoreCategory {
  key: RbScoreKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const RB_SCORE_CATEGORIES: RbScoreCategory[] = [
  {
    key: 'overallRBGrade',
    label: 'Overall',
    shortLabel: 'Overall',
    description:
      'Overall RB Grade (0-100): Volume 25%, Efficiency 20%, Explosiveness 20%, Receiving 20%, Elusiveness 15%. Slightly favors Volume because fantasy RB production is opportunity-driven. Percentile-based vs. qualified RBs.',
  },
  {
    key: 'volumeScore',
    label: 'Volume',
    shortLabel: 'Vol',
    description:
      'Volume (0-100): workload & opportunity — identifies bellcows and high-floor backs. Rush Att 30%, Snap% 20%, Targets 20%, RZ Opp 15%, GL Carries 10%, Routes 5%.',
  },
  {
    key: 'efficiencyScore',
    label: 'Efficiency',
    shortLabel: 'Eff',
    description:
      'Efficiency (0-100): per-touch effectiveness on a rate basis only. Y/C 30%, EPA/Play 25%, YPRR 20%, YBC/Att 15%, Negative-rush rate 10% (inverted). Ranked vs. qualified RBs.',
  },
  {
    key: 'explosivenessScore',
    label: 'Explosiveness',
    shortLabel: 'Exp',
    description:
      'Explosiveness (0-100): home-run ability & big-play upside. Explosive% 25%, Breakaway% 20%, 10+ 20%, 20+ 15%, 30+ 10%, Longest Rush 5%, Longest Rush TD 5%.',
  },
  {
    key: 'receivingScore',
    label: 'Receiving',
    shortLabel: 'Rec',
    description:
      'Receiving (0-100): pass-game value & PPR upside. Targets 20%, Target Share% 20%, Receptions 15%, Rec Yds 15%, Y/R 10%, Rec YAC 10%, YPRR 5%, Rec TDs 5%.',
  },
  {
    key: 'elusivenessScore',
    label: 'Elusiveness',
    shortLabel: 'Elu',
    description:
      'Elusiveness (0-100): self-created yardage & tackle-breaking. Broken Tackles 25%, Broken-tackle rate 25%, YAC/Att 25%, Tackle-eluded rate 15%, Rec YAC 5%, Fumble rate 5% (inverted).',
  },
];

/** Ordered grade keys (overall first) for sorting menus, radar axes, etc. */
export const RB_SCORE_KEYS: RbScoreKey[] = RB_SCORE_CATEGORIES.map(c => c.key);

type RbRow = Record<string, unknown>;

// Safe rate helpers — return 0 when the denominator is 0 so divide-by-zero rows
// sink to the bottom of the curve rather than throwing or spiking.
const negativeRushRate = (r: RbRow) => { const a = num(r.rushAttempts); return a > 0 ? num(r.rushAttForNegativeYards) / a : 0; };
const fumbleRate = (r: RbRow) => { const a = num(r.rushAttempts); return a > 0 ? num(r.fumbles) / a : 0; };
// Broken tackles per attempt — invert the "attempts per broken tackle" rate so
// higher = breaks tackles more often. 0 attempts/brk-tkl (never broke one) → 0.
const brokenTackleRate = (r: RbRow) => { const x = num(r.rushAttemptsPerBrokenTackle); return x > 0 ? 1 / x : 0; };

/**
 * Compute composite grades for a population of RB rows. Pass the full RB pool
 * (not a filtered/sorted subset). Percentiles are ranked against the QUALIFIED
 * subset (see {@link isQualifiedRb}) so low-volume backs don't define the
 * distribution, but every row still receives a score.
 */
export function computeRbCompositeScores<T extends RbRow>(rows: T[]): RbCompositeScores[] {
  if (!rows.length) return [];

  // Baseline = qualified RBs (falls back to all rows if none qualify).
  const baseline = rows.filter(isQualifiedRb);

  // Percentile array per input stat (aligned to `rows`), ranked vs. the
  // qualified baseline. "lowerIsBetter" stats are pre-inverted here.
  const pcol = (accessor: (r: RbRow) => number, direction: 'higherIsBetter' | 'lowerIsBetter' = 'higherIsBetter') =>
    percentileColumnAgainst<RbRow, RbRow>(rows, accessor, baseline, direction);

  const p = {
    // Volume
    rushAttempts: pcol(r => num(r.rushAttempts)),
    snapPct: pcol(r => num(r.snapPct)),
    targets: pcol(r => num(r.targets)),
    redZoneOpportunities: pcol(r => num(r.redZoneOpportunities)),
    goalLineCarries: pcol(r => num(r.goalLineCarries)),
    routes: pcol(r => num(r.routes)),

    // Efficiency (rate stats only)
    yardsPerCarry: pcol(r => num(r.yardsPerCarry)),
    epaPerPlay: pcol(r => num(r.epaPerPlay)),
    yardsPerRouteRun: pcol(r => num(r.yardsPerRouteRun)),
    yardsBeforeContactPerAttempt: pcol(r => num(r.yardsBeforeContactPerAttempt)),
    negativeRushRate: pcol(negativeRushRate, 'lowerIsBetter'),

    // Explosiveness
    explosiveRunPct: pcol(r => num(r.explosiveRunPct)),
    breakawayRunPct: pcol(r => num(r.breakawayRunPct)),
    rushes10Plus: pcol(r => num(r.rushes10Plus)),
    rushes20Plus: pcol(r => num(r.rushes20Plus)),
    rushes30Plus: pcol(r => num(r.rushes30Plus)),
    longestRush: pcol(r => num(r.longestRush)),
    longestRushTouchdown: pcol(r => num(r.longestRushTouchdown)),

    // Receiving
    targetSharePct: pcol(r => num(r.targetSharePct)),
    receptions: pcol(r => num(r.receptions)),
    receivingYards: pcol(r => num(r.receivingYards)),
    yardsPerReception: pcol(r => num(r.yardsPerReception)),
    receivingYardsAfterCatch: pcol(r => num(r.receivingYardsAfterCatch)),
    receivingTouchdowns: pcol(r => num(r.receivingTouchdowns)),

    // Elusiveness
    brokenTackles: pcol(r => num(r.brokenTackles)),
    brokenTackleRate: pcol(brokenTackleRate),
    yardsAfterContactPerAttempt: pcol(r => num(r.yardsAfterContactPerAttempt)),
    tackleEludedRate: pcol(r => num(r.tackleEludedRate)),
    fumbleRate: pcol(fumbleRate, 'lowerIsBetter'),
  };

  return rows.map((_, i) => {
    const volumeScore = clampScore(
      p.rushAttempts[i] * 0.30 +
        p.snapPct[i] * 0.20 +
        p.targets[i] * 0.20 +
        p.redZoneOpportunities[i] * 0.15 +
        p.goalLineCarries[i] * 0.10 +
        p.routes[i] * 0.05,
    );

    const efficiencyScore = clampScore(
      p.yardsPerCarry[i] * 0.30 +
        p.epaPerPlay[i] * 0.25 +
        p.yardsPerRouteRun[i] * 0.20 +
        p.yardsBeforeContactPerAttempt[i] * 0.15 +
        p.negativeRushRate[i] * 0.10,
    );

    const explosivenessScore = clampScore(
      p.explosiveRunPct[i] * 0.25 +
        p.breakawayRunPct[i] * 0.20 +
        p.rushes10Plus[i] * 0.20 +
        p.rushes20Plus[i] * 0.15 +
        p.rushes30Plus[i] * 0.10 +
        p.longestRush[i] * 0.05 +
        p.longestRushTouchdown[i] * 0.05,
    );

    const receivingScore = clampScore(
      p.targets[i] * 0.20 +
        p.targetSharePct[i] * 0.20 +
        p.receptions[i] * 0.15 +
        p.receivingYards[i] * 0.15 +
        p.yardsPerReception[i] * 0.10 +
        p.receivingYardsAfterCatch[i] * 0.10 +
        p.yardsPerRouteRun[i] * 0.05 +
        p.receivingTouchdowns[i] * 0.05,
    );

    const elusivenessScore = clampScore(
      p.brokenTackles[i] * 0.25 +
        p.brokenTackleRate[i] * 0.25 +
        p.yardsAfterContactPerAttempt[i] * 0.25 +
        p.tackleEludedRate[i] * 0.15 +
        p.receivingYardsAfterCatch[i] * 0.05 +
        p.fumbleRate[i] * 0.05,
    );

    const overallRBGrade = clampScore(
      volumeScore * 0.25 +
        efficiencyScore * 0.20 +
        explosivenessScore * 0.20 +
        receivingScore * 0.20 +
        elusivenessScore * 0.15,
    );

    return {
      volumeScore,
      efficiencyScore,
      explosivenessScore,
      receivingScore,
      elusivenessScore,
      overallRBGrade,
    };
  });
}
