/**
 * Central abbreviation dictionary so stat/column labels shorten consistently
 * everywhere in Commissioner Command. Two tiers:
 *   - `columnAbbreviations`        — used at tablet / small-laptop widths
 *   - `mobileColumnAbbreviations`  — ultra-short, used at small-mobile widths
 *
 * Keys are the canonical full label. Lookups are case-insensitive and also try
 * a normalized form, so callers can pass "Target Share" or "target share".
 */
export const columnAbbreviations: Record<string, string> = {
  "Average Draft Position": "ADP",
  "Trade Value": "Value",
  "Dynasty Value": "Dynasty",
  "Win-Now Value": "Win-Now",
  "Projected Points": "Proj.",
  "Projection": "Proj.",
  "Points Per Game": "PPG",
  "Fantasy Points": "FP",
  "Expected Fantasy Points": "xFP",
  "Fantasy Points Over Expected": "FPOE",
  "Targets": "Tgts",
  "Target Share": "Tgt %",
  "Air Yards": "Air Yds",
  "Air Yards Share": "Air %",
  "Snap Share": "Snap %",
  "Snap Count": "Snaps",
  "Route Participation": "Route %",
  "Yards Per Route Run": "YPRR",
  "Weighted Opportunity Rating": "WOPR",
  "Red Zone Touches": "RZ",
  "Goal Line Carries": "GL",
  "Rush Attempts": "Att",
  "Carries": "Att",
  "Receptions": "Rec",
  "Receiving Yards": "Rec Yds",
  "Rushing Yards": "Rush Yds",
  "Total Touchdowns": "TD",
  "Touchdowns": "TD",
  "Roster Percentage": "Roster %",
  "Rostered": "Roster %",
  "Start Percentage": "Start %",
  "Win Rate": "Win %",
  "Playoff Rate": "PO %",
  "Championship Rate": "Champ %",
  "League Count": "Lg Count",
  "Manager Count": "Mgr Count",
  "Transaction Count": "Txn Count",
  "Position": "Pos",
  "Team": "Tm",
  "Record": "Rec",
  "Points For": "PF",
  "Points Against": "PA",
};

export const mobileColumnAbbreviations: Record<string, string> = {
  "Trade Value": "Val",
  "Projected Points": "Proj",
  "Target Share": "Tgt",
  "Snap Share": "Snap",
  "Roster Percentage": "R%",
  "Start Percentage": "S%",
  "League Count": "Lg",
  "Transaction Count": "Txn",
  "Average Draft Position": "ADP",
  "Points Per Game": "PPG",
  "Position": "Pos",
  "Team": "Tm",
};

function lookup(table: Record<string, string>, label: string): string | undefined {
  if (table[label]) return table[label];
  // Case-insensitive fallback.
  const lower = label.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return table[key];
  }
  return undefined;
}

/**
 * Abbreviate a full label for the given width.
 *   width < 480  → mobile dictionary (falls back to standard, then full)
 *   width < 1024 → standard dictionary (falls back to full)
 *   else         → full label unchanged
 */
export function abbreviateLabel(label: string, width: number): string {
  if (width > 0 && width < 480) {
    return lookup(mobileColumnAbbreviations, label) ?? lookup(columnAbbreviations, label) ?? label;
  }
  if (width > 0 && width < 1024) {
    return lookup(columnAbbreviations, label) ?? label;
  }
  return label;
}

/** Plain lookups for callers that already know which tier they want. */
export function shortLabel(label: string): string {
  return lookup(columnAbbreviations, label) ?? label;
}
export function mobileLabel(label: string): string {
  return lookup(mobileColumnAbbreviations, label) ?? lookup(columnAbbreviations, label) ?? label;
}
