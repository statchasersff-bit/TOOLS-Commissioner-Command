export function isDynastyLeague(lg: any): boolean {
  // Check settings.type as numeric enum (Sleeper's primary dynasty indicator)
  // 0 = redraft, 1 = keeper, 2 = dynasty
  const leagueType = Number(lg?.settings?.type);
  if (leagueType === 2 || leagueType === 1) return true; // Dynasty or Keeper

  // Check for keeper settings (actual keeper slots configured)
  const keepers = lg?.settings?.keeper_count ?? lg?.settings?.keepers ?? 0;
  if (keepers > 0) return true;

  // Legacy check: some older leagues may use string type
  const settingsType = String(lg?.settings?.type ?? "").toLowerCase();
  if (settingsType === "dynasty" || settingsType === "keeper") return true;

  // Fallback: Check name and description for dynasty/keeper keywords (case-insensitive)
  const name = `${lg?.name ?? ""} ${lg?.metadata?.description ?? ""}`.toLowerCase();
  
  // Match full words: "dynasty" or "keeper"
  if (name.includes("dynasty") || name.includes("keeper")) return true;
  
  // Match common dynasty abbreviations: "D" followed by number (e.g., "D10", "D12", "D13")
  // Use word boundary to avoid false positives
  if (/\bd\d+\b/i.test(name)) return true;

  return false;
}