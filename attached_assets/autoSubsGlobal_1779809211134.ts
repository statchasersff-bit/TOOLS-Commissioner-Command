import type { LeagueSummary } from './types';

export interface GlobalAutoSubSettings {
  isUniform: boolean;
  enabled: boolean;
  allowedPerWeek: number;
  requireLaterStart: boolean;
}

/**
 * Detect if all leagues have the same auto-sub settings
 */
export function detectGlobalAutoSubSettings(leagues: LeagueSummary[]): GlobalAutoSubSettings {
  if (leagues.length === 0) {
    return { isUniform: false, enabled: false, allowedPerWeek: 0, requireLaterStart: false };
  }

  const first = leagues[0].autoSubConfig;
  if (!first) {
    return { isUniform: false, enabled: false, allowedPerWeek: 0, requireLaterStart: false };
  }

  const allSame = leagues.every(lg => {
    const config = lg.autoSubConfig;
    if (!config) return false;
    return (
      config.enabled === first.enabled &&
      config.allowedPerWeek === first.allowedPerWeek &&
      config.requireLaterStart === first.requireLaterStart
    );
  });

  return {
    isUniform: allSame,
    enabled: first.enabled,
    allowedPerWeek: first.allowedPerWeek,
    requireLaterStart: first.requireLaterStart,
  };
}

/**
 * Determine if a league should show its auto-sub chip
 * Show chip only when:
 * - Settings vary across leagues (!isUniform)
 * - Auto-subs are OFF for this league
 * - League has different cap than global
 * - League is at or near cap (when pickups data is available)
 */
export function shouldShowAutoSubChip(
  league: LeagueSummary,
  globalSettings: GlobalAutoSubSettings
): boolean {
  const config = league.autoSubConfig;
  
  if (!config) return false;
  
  // If settings vary across leagues, always show
  if (!globalSettings.isUniform) return true;
  
  // If auto-subs are OFF, show warning
  if (!config.enabled) return true;
  
  // If this league has different cap than global, show
  if (config.allowedPerWeek !== globalSettings.allowedPerWeek) return true;
  
  // TODO: When pickups tracking is implemented, show if at cap
  // const atCap = (league.pickupsUsed ?? 0) >= config.allowedPerWeek;
  // if (atCap) return true;
  
  return false;
}

/**
 * Get the display text for auto-sub chip
 */
export function getAutoSubChipText(league: LeagueSummary): string {
  const config = league.autoSubConfig;
  if (!config) return '';
  
  if (!config.enabled) {
    return 'Auto-subs OFF';
  }
  
  // TODO: When pickups tracking is implemented, show used/cap
  // const used = league.pickupsUsed ?? 0;
  // return `Auto-subs • ${used}/${config.allowedPerWeek}`;
  
  return `Auto-subs • ${config.allowedPerWeek}/wk`;
}

/**
 * Determine chip variant (neutral or warning)
 */
export function getAutoSubChipVariant(league: LeagueSummary): 'neutral' | 'warn' {
  const config = league.autoSubConfig;
  if (!config || !config.enabled) return 'warn';
  
  // TODO: When pickups tracking is implemented
  // const atCap = (league.pickupsUsed ?? 0) >= config.allowedPerWeek;
  // if (atCap) return 'warn';
  
  return 'neutral';
}
