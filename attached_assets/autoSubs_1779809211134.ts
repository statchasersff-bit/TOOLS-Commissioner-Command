import { fetchJSON } from './sleeper';
import { PlayerLite } from './types';
import { normalizePos } from './projections';

export interface AutoSubConfig {
  enabled: boolean;
  allowedPerWeek: number;
  requireLaterStart: boolean;
  raw: any;
}

export interface AutoSubSuggestion {
  player: PlayerLite & { proj?: number; gameStart?: number };
  proj: number;
  floor?: number;
  reason: string;
}

export interface AutoSubRecommendation {
  starter: PlayerLite & { proj?: number; gameStart?: number; slot: string };
  suggestions: AutoSubSuggestion[];
}

/**
 * Detect if the league uses Auto-Subs and what the configuration is
 */
export async function getLeagueAutoSubConfig(leagueId: string): Promise<AutoSubConfig> {
  try {
    const league = await fetchJSON<any>(`https://api.sleeper.app/v1/league/${leagueId}`);
    const s = league.settings || {};

    // Heuristic detection (be resilient to key naming)
    const subKeys = Object.keys(s).filter(k => k.toLowerCase().includes('sub'));
    const allowedPerWeek = subKeys
      .map(k => Number(s[k]))
      .find(v => !Number.isNaN(v) && v > 0) || 0;

    const requireLaterStart = !!(
      s.player_autosubs_require_later_start ||
      s.autosubs_require_later_start ||
      s.auto_subs_require_later_start
    );

    return { 
      enabled: allowedPerWeek > 0, 
      allowedPerWeek, 
      requireLaterStart, 
      raw: s 
    };
  } catch (error) {
    console.warn('[AutoSubs] Failed to fetch league auto-sub config:', error);
    return { enabled: false, allowedPerWeek: 0, requireLaterStart: false, raw: {} };
  }
}

/**
 * Check if a bench player is eligible for a starter's slot
 */
export function isEligibleForSlot(benchPlayer: PlayerLite, starterSlot: string): boolean {
  const benchPos = normalizePos(benchPlayer.pos);
  const slotNorm = normalizePos(starterSlot);
  
  // Direct position match
  if (benchPos === slotNorm) return true;
  
  // Flex slot eligibility (expanded to match FA logic)
  if (slotNorm === 'FLEX' || slotNorm === 'WRT' || slotNorm === 'WRTQ' || slotNorm === 'REC_FLEX') {
    return ['RB', 'WR', 'TE'].includes(benchPos);
  }
  
  // RB/WR flex slots
  if (slotNorm === 'RB_WR') {
    return ['RB', 'WR'].includes(benchPos);
  }
  
  // RB/WR/TE flex slots
  if (slotNorm === 'RB_WR_TE') {
    return ['RB', 'WR', 'TE'].includes(benchPos);
  }
  
  // SUPER_FLEX eligibility
  if (slotNorm === 'SUPER_FLEX' || slotNorm === 'OP') {
    return ['QB', 'RB', 'WR', 'TE'].includes(benchPos);
  }
  
  // Check multi-position eligibility
  if (benchPlayer.multiPos) {
    const multiNormalized = benchPlayer.multiPos.map(normalizePos);
    if (multiNormalized.includes(slotNorm)) return true;
    
    // Check flex eligibility for multi-pos players
    if ((slotNorm === 'FLEX' || slotNorm === 'WRT' || slotNorm === 'WRTQ' || slotNorm === 'REC_FLEX') && 
        multiNormalized.some(pos => ['RB', 'WR', 'TE'].includes(pos))) {
      return true;
    }
    
    // RB/WR flex for multi-pos
    if (slotNorm === 'RB_WR' && multiNormalized.some(pos => ['RB', 'WR'].includes(pos))) {
      return true;
    }
    
    // RB/WR/TE flex for multi-pos
    if (slotNorm === 'RB_WR_TE' && multiNormalized.some(pos => ['RB', 'WR', 'TE'].includes(pos))) {
      return true;
    }
    
    // SUPER_FLEX check for multi-pos
    if ((slotNorm === 'SUPER_FLEX' || slotNorm === 'OP') && 
        multiNormalized.some(pos => ['QB', 'RB', 'WR', 'TE'].includes(pos))) {
      return true;
    }
  }
  
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
  starter: PlayerLite & { proj?: number; gameStart?: number; slot: string };
  bench: (PlayerLite & { proj?: number; gameStart?: number })[];
  projections: Record<string, number>;
  requireLaterStart?: boolean;
}): AutoSubSuggestion[] {
  const starterKick = starter.gameStart ?? 0;
  
  const eligible = bench
    .filter(p => isEligibleForSlot(p, starter.slot))
    .filter(p => !requireLaterStart || (p.gameStart ?? Infinity) >= starterKick)
    .map(p => {
      const proj = projections[p.player_id] ?? p.proj ?? 0;
      const starterProj = starter.proj ?? projections[starter.player_id] ?? 0;
      const diff = proj - starterProj;
      
      // Generate reason string
      let reason = `Proj ${proj.toFixed(1)}`;
      if (diff > 0) {
        reason += ` (+${diff.toFixed(1)} vs starter)`;
      }
      if (requireLaterStart && p.gameStart && starter.gameStart) {
        const hoursDiff = (p.gameStart - starter.gameStart) / (1000 * 60 * 60);
        if (hoursDiff > 0) {
          reason += `; plays ${hoursDiff.toFixed(1)}h later`;
        }
      }
      
      return {
        player: p,
        proj,
        floor: proj * 0.7, // Simple floor estimation
        reason
      };
    })
    .sort((a, b) => (b.proj - a.proj) || ((b.floor ?? -1) - (a.floor ?? -1)));

  return eligible.slice(0, 2); // top 1–2 subs
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
  starters: (PlayerLite & { proj?: number; gameStart?: number })[];
  bench: (PlayerLite & { proj?: number; gameStart?: number })[];
  rosterPositions: string[];
  projections: Record<string, number>;
  requireLaterStart?: boolean;
}): AutoSubRecommendation[] {
  const recommendations: AutoSubRecommendation[] = [];
  
  // Iterate through all starters with original index to maintain slot mapping
  starters.forEach((starter, originalIndex) => {
    const status = (starter.injury_status || "").toUpperCase();
    // Check for actual Sleeper injury status codes
    const isQuestionable = status === "Q" || status === "QUESTIONABLE" || status === "D" || status === "DOUBTFUL";
    
    if (!isQuestionable) return;
    
    const slot = rosterPositions[originalIndex] || 'FLEX';
    const starterWithSlot = { ...starter, slot };
    
    const suggestions = suggestAutoSubs({
      starter: starterWithSlot,
      bench,
      projections,
      requireLaterStart
    });
    
    if (suggestions.length > 0) {
      recommendations.push({
        starter: starterWithSlot,
        suggestions
      });
    }
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