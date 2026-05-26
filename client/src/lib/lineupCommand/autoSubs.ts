import { isPlayerLocked, type GameSchedule } from './gameLocking';

export interface AutoSubConfig {
  enabled: boolean;
  allowedPerWeek: number;
  requireLaterStart: boolean;
  raw: any;
}

export interface AutoSubSuggestion {
  player: any & { proj?: number; gameStart?: number };
  proj: number;
  floor?: number;
  reason: string;
}

export interface AutoSubRecommendation {
  starter: any & { proj?: number; gameStart?: number; slot: string };
  suggestions: AutoSubSuggestion[];
}

/**
 * Detect if the league uses Auto-Subs and what the configuration is
 */
export async function getLeagueAutoSubConfig(leagueId: string): Promise<AutoSubConfig> {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
    const league = await res.json();
    const s = league.settings || {};

    const subKeys = Object.keys(s).filter(k => k.toLowerCase().includes('sub'));
    const allowedPerWeek = subKeys
      .map(k => Number(s[k]))
      .find(v => !Number.isNaN(v) && v > 0) || 0;

    const requireLaterStart = !!(
      s.player_autosubs_require_later_start ||
      s.autosubs_require_later_start ||
      s.auto_subs_require_later_start
    );

    return { enabled: allowedPerWeek > 0, allowedPerWeek, requireLaterStart, raw: s };
  } catch (error) {
    console.warn('[AutoSubs] Failed to fetch league auto-sub config:', error);
    return { enabled: false, allowedPerWeek: 0, requireLaterStart: false, raw: {} };
  }
}

/**
 * Check if a bench player is eligible for a starter's slot
 */
export function isEligibleForSlot(benchPos: string, starterSlot: string): boolean {
  const pos = benchPos.toUpperCase();
  const slot = starterSlot.toUpperCase();
  
  if (pos === slot) return true;
  
  if (['FLEX', 'WRT', 'WRTQ', 'REC_FLEX'].includes(slot)) {
    return ['RB', 'WR', 'TE'].includes(pos);
  }
  if (slot === 'RB_WR') return ['RB', 'WR'].includes(pos);
  if (slot === 'RB_WR_TE') return ['RB', 'WR', 'TE'].includes(pos);
  if (['SUPER_FLEX', 'OP'].includes(slot)) return ['QB', 'RB', 'WR', 'TE'].includes(pos);
  
  return false;
}

/**
 * Suggest Auto-Subs for a questionable starter
 */
export function suggestAutoSubs({
  starter,
  bench,
  projections,
  requireLaterStart = false
}: {
  starter: any & { proj?: number; gameStart?: number; slot: string };
  bench: (any & { proj?: number; gameStart?: number })[];
  projections: Record<string, number>;
  requireLaterStart?: boolean;
}): AutoSubSuggestion[] {
  const starterKick = starter.gameStart ?? 0;
  
  return bench
    .filter(p => isEligibleForSlot(p.pos, starter.slot))
    .filter(p => !requireLaterStart || (p.gameStart ?? Infinity) >= starterKick)
    .map(p => {
      const proj = projections[p.player_id] ?? p.proj ?? 0;
      const starterProj = starter.proj ?? projections[starter.player_id] ?? 0;
      const diff = proj - starterProj;
      let reason = `Proj ${proj.toFixed(1)}`;
      if (diff > 0) reason += ` (+${diff.toFixed(1)} vs starter)`;
      return { player: p, proj, floor: proj * 0.7, reason };
    })
    .sort((a, b) => (b.proj - a.proj) || ((b.floor ?? -1) - (a.floor ?? -1)))
    .slice(0, 2);
}

/**
 * Find all questionable starters and suggest auto-subs
 */
export function findAutoSubRecommendations({
  starters,
  bench,
  rosterPositions,
  projections,
  requireLaterStart = false
}: {
  starters: (any & { proj?: number; gameStart?: number })[];
  bench: (any & { proj?: number; gameStart?: number })[];
  rosterPositions: string[];
  projections: Record<string, number>;
  requireLaterStart?: boolean;
}): AutoSubRecommendation[] {
  const recommendations: AutoSubRecommendation[] = [];
  
  starters.forEach((starter, idx) => {
    const status = (starter.injury_status || "").toUpperCase();
    const isQuestionable = status === "Q" || status === "QUESTIONABLE" || status === "D" || status === "DOUBTFUL";
    if (!isQuestionable) return;
    
    const slot = rosterPositions[idx] || 'FLEX';
    const starterWithSlot = { ...starter, slot };
    const suggestions = suggestAutoSubs({ starter: starterWithSlot, bench, projections, requireLaterStart });
    if (suggestions.length > 0) recommendations.push({ starter: starterWithSlot, suggestions });
  });
  
  return recommendations;
}

/**
 * Generate copy-paste instructions for setting auto-sub in Sleeper
 */
export function generateAutoSubInstructions(
  starterName: string,
  slot: string,
  subName: string,
  requireLaterStart: boolean = false
): string {
  return `Sleeper › Lineup › tap "${subName}" › "Set AutoSub" › choose ${starterName} (${slot}). ` +
    `Needs both games unstarted${requireLaterStart ? " and sub cannot be earlier" : ""}.`;
}
