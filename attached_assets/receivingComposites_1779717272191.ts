/**
 * Shared receiving composite-grade engine (WR + TE).
 *
 * WR and TE share the SAME five-category framework — Volume, Efficiency,
 * Explosiveness, Hands, Elusiveness, plus a blended Overall grade — for UI /
 * radar / sorting consistency. They differ ONLY in their weighting philosophy:
 * a position supplies its own per-stat weights, qualifier, and overall blend.
 *
 * Architecture: one engine, two configs. All percentile ranking, inversion of
 * "lower is better" stats, and derived-stat preprocessing live here once; the
 * WR/TE configs below are pure data. Mirrors ./percentiles for the shared math.
 */
import { percentileColumnAgainst, clampScore, toFiniteNumber as num } from './percentiles';

type Row = Record<string, unknown>;

// Stats where a lower raw value is better — percentiles are inverted for these.
const INVERTED = new Set(['drops', 'dropPct', 'interceptionsWhenTargeted', 'fumbles']);

// Derived stats (not present as a raw column). Everything else reads num(row[key]).
const DERIVED: Record<string, (r: Row) => number> = {
  // Receiving yards per target — efficiency independent of catch volume.
  recYardsPerTarget: r => { const t = num(r.targets); return t > 0 ? num(r.receivingYards) / t : 0; },
};
const accessorFor = (stat: string) => DERIVED[stat] ?? ((r: Row) => num(r[stat]));

/** stat key → weight within one composite. Weights should sum to 1. */
type Weights = Record<string, number>;

export interface ReceivingConfig {
  position: string;
  /** Field name the Overall grade is written to (e.g. 'overallWRGrade'). */
  overallKey: string;
  /** Percentile-baseline qualifier — low-sample players don't define the curve. */
  qualify: (row: Row) => boolean;
  weights: {
    volume: Weights;
    efficiency: Weights;
    explosiveness: Weights;
    hands: Weights;
    elusiveness: Weights;
  };
  /** Blend of the five composites into the Overall grade (should sum to 1). */
  overall: { volume: number; efficiency: number; explosiveness: number; hands: number; elusiveness: number };
}

export interface ReceivingScoreCategory {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * Compute the five composites + Overall for a population of receiver rows.
 * Percentiles are ranked against the QUALIFIED subset (per config.qualify) so
 * low-volume players don't define the distribution, but every row gets a score.
 */
export function buildReceivingComposites<T extends Row>(config: ReceivingConfig, rows: T[]): Array<Record<string, number>> {
  if (!rows.length) return [];
  const baseline = rows.filter(config.qualify);

  // Percentile-rank every stat referenced by any composite, once.
  const stats = new Set<string>();
  for (const comp of Object.values(config.weights)) for (const k of Object.keys(comp)) stats.add(k);
  const pmap: Record<string, number[]> = {};
  for (const stat of stats) {
    const dir = INVERTED.has(stat) ? 'lowerIsBetter' : 'higherIsBetter';
    pmap[stat] = percentileColumnAgainst<Row, Row>(rows, accessorFor(stat), baseline, dir);
  }

  const combine = (w: Weights, i: number) => {
    let s = 0;
    for (const stat in w) s += pmap[stat][i] * w[stat];
    return s;
  };

  const o = config.overall;
  return rows.map((_, i) => {
    const volumeScore = clampScore(combine(config.weights.volume, i));
    const efficiencyScore = clampScore(combine(config.weights.efficiency, i));
    const explosivenessScore = clampScore(combine(config.weights.explosiveness, i));
    const handsScore = clampScore(combine(config.weights.hands, i));
    const elusivenessScore = clampScore(combine(config.weights.elusiveness, i));
    const overall = clampScore(
      volumeScore * o.volume +
        efficiencyScore * o.efficiency +
        explosivenessScore * o.explosiveness +
        handsScore * o.hands +
        elusivenessScore * o.elusiveness,
    );
    return {
      volumeScore,
      efficiencyScore,
      explosivenessScore,
      handsScore,
      elusivenessScore,
      [config.overallKey]: overall,
    };
  });
}

// ---------------------------------------------------------------------------
// WR config — earning and converting targets drive WR fantasy value, so Volume
// & Efficiency are weighted heaviest; Explosiveness/Elusiveness carry real
// weight (deep threats, YAC monsters).
// ---------------------------------------------------------------------------
export const WR_RECEIVING_CONFIG: ReceivingConfig = {
  position: 'WR',
  overallKey: 'overallWRGrade',
  qualify: row => num(row.targets) >= 40 || num(row.routes) >= 150,
  weights: {
    volume: {
      targets: 0.25, targetSharePct: 0.20, wopr: 0.15, routes: 0.15,
      targetsPerRouteRun: 0.10, airYardsSharePct: 0.10, redZoneTargets: 0.03, endZoneTargets: 0.02,
    },
    efficiency: {
      yardsPerRouteRun: 0.30, epaPerPlay: 0.20, successRate: 0.20, catchPct: 0.10,
      yardsPerReception: 0.10, recYardsPerTarget: 0.05, yardsBeforeCatchPerReception: 0.05,
    },
    explosiveness: {
      airYardsPerTarget: 0.25, airYardsPerReception: 0.20, receptions20Plus: 0.20,
      receptions30Plus: 0.15, receptions40Plus: 0.10, receptions50Plus: 0.05, longestReception: 0.05,
    },
    // Contested-catch% is unavailable in the feed (all null), so it's omitted
    // and the remaining weights are renormalized to sum to 1.
    hands: {
      catchPct: 0.40, catchableTargets: 0.20, drops: 0.20, dropPct: 0.15, interceptionsWhenTargeted: 0.05,
    },
    // Yards-after-contact/reception is unavailable in the feed (all null), so it's
    // omitted and the remaining weights renormalized.
    elusiveness: {
      avoidedTackleRate: 0.40, brokenTackles: 0.30, yardsAfterCatchPerReception: 0.25, fumbles: 0.05,
    },
  },
  overall: { volume: 0.25, efficiency: 0.25, explosiveness: 0.20, hands: 0.15, elusiveness: 0.15 },
};

// ---------------------------------------------------------------------------
// TE config — TE value is driven by opportunity, reliability and efficiency far
// more than pure explosiveness/YAC, so Volume/Hands are up-weighted and
// Explosiveness/Elusiveness down-weighted vs. WR.
// ---------------------------------------------------------------------------
export const TE_RECEIVING_CONFIG: ReceivingConfig = {
  position: 'TE',
  overallKey: 'overallTEGrade',
  qualify: row => num(row.targets) >= 25 || num(row.routes) >= 100,
  weights: {
    volume: {
      targets: 0.25, routes: 0.20, targetSharePct: 0.20, wopr: 0.15,
      targetsPerRouteRun: 0.10, redZoneTargets: 0.05, endZoneTargets: 0.05,
    },
    efficiency: {
      yardsPerRouteRun: 0.35, epaPerPlay: 0.20, successRate: 0.20, catchPct: 0.10,
      recYardsPerTarget: 0.10, yardsBeforeCatchPerReception: 0.05,
    },
    explosiveness: {
      airYardsPerTarget: 0.30, airYardsPerReception: 0.25, receptions20Plus: 0.20,
      receptions30Plus: 0.10, receptions40Plus: 0.10, longestReception: 0.05,
    },
    // Contested-catch% is unavailable in the feed (all null), so it's omitted
    // and the remaining weights renormalized to sum to 1.
    hands: {
      catchPct: 0.45, catchableTargets: 0.20, drops: 0.20, dropPct: 0.075, interceptionsWhenTargeted: 0.075,
    },
    // Yards-after-contact/reception is unavailable in the feed (all null), so it's
    // omitted and the remaining weights renormalized.
    elusiveness: {
      avoidedTackleRate: 0.40, brokenTackles: 0.35, yardsAfterCatchPerReception: 0.20, fumbles: 0.05,
    },
  },
  overall: { volume: 0.30, efficiency: 0.25, hands: 0.20, explosiveness: 0.15, elusiveness: 0.10 },
};

// ---------------------------------------------------------------------------
// WR public surface (matches the QB/RB engine shape used by the table).
// ---------------------------------------------------------------------------
export const WR_SCORE_CATEGORIES: ReceivingScoreCategory[] = [
  {
    key: 'overallWRGrade', label: 'Overall', shortLabel: 'Overall',
    description: 'Overall WR Grade (0-100): Volume 25%, Efficiency 25%, Explosiveness 20%, Hands 15%, Elusiveness 15%. Slightly favors earning & converting targets. Percentile-based vs. qualified WRs.',
  },
  {
    key: 'volumeScore', label: 'Volume', shortLabel: 'Vol',
    description: 'Volume (0-100): offensive role & opportunity — identifies alpha target-earners. Targets 25%, Target Share% 20%, WOPR 15%, Routes 15%, TPRR 10%, AY Share% 10%, RZ TGT 3%, EZ TGT 2%.',
  },
  {
    key: 'efficiencyScore', label: 'Efficiency', shortLabel: 'Eff',
    description: 'Efficiency (0-100): per-route & per-target effectiveness, rate stats only. YPRR 30%, EPA/Play 20%, Success% 20%, Catch% 10%, Y/R 10%, Rec Yds/TGT 5%, YBC/R 5%. Ranked vs. qualified WRs.',
  },
  {
    key: 'explosivenessScore', label: 'Explosiveness', shortLabel: 'Exp',
    description: 'Explosiveness (0-100): vertical threat & big-play upside. AY/TGT 25%, AY/Rec 20%, 20+ 20%, 30+ 15%, 40+ 10%, 50+ 5%, Longest Rec 5%.',
  },
  {
    key: 'handsScore', label: 'Hands', shortLabel: 'Hnd',
    description: 'Hands (0-100): reliability & catch consistency. Catch% 40%, Catchable TGT 20%, Drops 20% (inv), Drop% 15% (inv), INT-when-targeted 5% (inv).',
  },
  {
    key: 'elusivenessScore', label: 'Elusiveness', shortLabel: 'Elu',
    description: 'Elusiveness (0-100): YAC creation & tackle-breaking. Avoided-tackle% 40%, Broken Tackles 30%, YAC/R 25%, Fumbles 5% (inv).',
  },
];

// ---------------------------------------------------------------------------
// TE public surface — same categories, TE-optimized weighting (see descriptions).
// ---------------------------------------------------------------------------
export const TE_SCORE_CATEGORIES: ReceivingScoreCategory[] = [
  {
    key: 'overallTEGrade', label: 'Overall', shortLabel: 'Overall',
    description: 'Overall TE Grade (0-100): Volume 30%, Efficiency 25%, Hands 20%, Explosiveness 15%, Elusiveness 10%. Weighted for TE value — opportunity, reliability & efficiency over pure explosiveness. Percentile-based vs. qualified TEs.',
  },
  {
    key: 'volumeScore', label: 'Volume', shortLabel: 'Vol',
    description: 'Volume (0-100): offensive role & opportunity — paramount for TEs. Targets 25%, Routes 20%, Target Share% 20%, WOPR 15%, TPRR 10%, RZ TGT 5%, EZ TGT 5%.',
  },
  {
    key: 'efficiencyScore', label: 'Efficiency', shortLabel: 'Eff',
    description: 'Efficiency (0-100): per-route/per-target effectiveness, rate stats only. YPRR 35%, EPA/Play 20%, Success% 20%, Catch% 10%, Rec Yds/TGT 10%, YBC/R 5%. Ranked vs. qualified TEs.',
  },
  {
    key: 'explosivenessScore', label: 'Explosiveness', shortLabel: 'Exp',
    description: 'Explosiveness (0-100): downfield & big-play ability (weighted lighter for TEs). AY/TGT 30%, AY/Rec 25%, 20+ 20%, 30+ 10%, 40+ 10%, Longest Rec 5%.',
  },
  {
    key: 'handsScore', label: 'Hands', shortLabel: 'Hnd',
    description: 'Hands (0-100): reliability & catch consistency — weighted heavier for TEs. Catch% 45%, Catchable TGT 20%, Drops 20% (inv), Drop% 7.5% (inv), INT-when-targeted 7.5% (inv).',
  },
  {
    key: 'elusivenessScore', label: 'Elusiveness', shortLabel: 'Elu',
    description: 'Elusiveness (0-100): YAC & tackle-breaking. Avoided-tackle% 40%, Broken Tackles 35%, YAC/R 20%, Fumbles 5% (inv).',
  },
];

export const WR_SCORE_KEYS = WR_SCORE_CATEGORIES.map(c => c.key);
export const TE_SCORE_KEYS = TE_SCORE_CATEGORIES.map(c => c.key);

export const isQualifiedWr = (row: Record<string, unknown>): boolean => WR_RECEIVING_CONFIG.qualify(row);
export const isQualifiedTe = (row: Record<string, unknown>): boolean => TE_RECEIVING_CONFIG.qualify(row);

export const computeWrCompositeScores = <T extends Row>(rows: T[]) => buildReceivingComposites(WR_RECEIVING_CONFIG, rows);
export const computeTeCompositeScores = <T extends Row>(rows: T[]) => buildReceivingComposites(TE_RECEIVING_CONFIG, rows);
