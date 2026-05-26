import type { AutoSubConfig } from './autoSubs';

export interface LeagueSummaryWithAutoSub {
  autoSubConfig?: AutoSubConfig;
  [key: string]: any;
}

export interface GlobalAutoSubSettings {
  isUniform: boolean;
  enabled: boolean;
  allowedPerWeek: number;
  requireLaterStart: boolean;
}

/**
 * Detect if all leagues have the same auto-sub settings
 */
export function detectGlobalAutoSubSettings(leagues: LeagueSummaryWithAutoSub[]): GlobalAutoSubSettings {
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
 */
export function shouldShowAutoSubChip(
  league: LeagueSummaryWithAutoSub,
  globalSettings: GlobalAutoSubSettings
): boolean {
  const config = league.autoSubConfig;
  if (!config) return false;
  if (!globalSettings.isUniform) return true;
  if (!config.enabled) return true;
  if (config.allowedPerWeek !== globalSettings.allowedPerWeek) return true;
  return false;
}

/**
 * Get the display text for auto-sub chip
 */
export function getAutoSubChipText(league: LeagueSummaryWithAutoSub): string {
  const config = league.autoSubConfig;
  if (!config) return '';
  if (!config.enabled) return 'Auto-subs OFF';
  return `Auto-subs • ${config.allowedPerWeek}/wk`;
}

/**
 * Determine chip variant (neutral or warning)
 */
export function getAutoSubChipVariant(league: LeagueSummaryWithAutoSub): 'neutral' | 'warn' {
  const config = league.autoSubConfig;
  if (!config || !config.enabled) return 'warn';
  return 'neutral';
}
