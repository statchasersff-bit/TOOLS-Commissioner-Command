export function isBestBallLeague(lg: any): boolean {
  // Primary: Sleeper league settings
  const flag = lg?.settings?.best_ball;
  if (flag === 1 || flag === true) return true;

  // Fallback: name/description tags
  const text = `${lg?.name ?? ""} ${lg?.metadata?.description ?? ""}`;
  return /best\s*ball/i.test(text) || /\bBB\b/i.test(text) || /\[(?:REDRAFT|DYNASTY)\s*BB\]/i.test(text);
}