// Value Finder type definitions.
// Behavior per product spec; organization mirrors lib/market/types.ts conventions.

export type Position = "QB" | "RB" | "WR" | "TE";

export type ValueSourceVF = "FantasyCalc" | "KTC" | "Custom" | "Dynasty Command";

export type ValueSignal =
  | "Strong Buy"
  | "Buy"
  | "Fair Value"
  | "Sell"
  | "Strong Sell"
  | "Insufficient Data";

export type SignalTone =
  | "buyStrong"
  | "buy"
  | "neutral"
  | "sell"
  | "sellStrong";

export type ValueArchetype =
  | "Elite Cornerstone"
  | "Productive Veteran Discount"
  | "Expensive Youth Bet"
  | "Breakout Candidate"
  | "Fragile Touchdown Scorer"
  | "Usage-Based Buy"
  | "Role-Based Sell"
  | "High-Upside Stash"
  | "Roster Clogger"
  | "Injury Discount"
  | "Role Riser"
  | "Role Loser";

// Final recommendation label produced by the longevity-aware classifier
// (valueFinderLabels.ts). Buy-side / sell-side / neutral families.
export type ValueLabel =
  // Buy-side
  | "Universal Buy"
  | "Contender Buy"
  | "Rebuilder Buy"
  | "Production Discount"
  | "Usage Buy"
  | "Hidden Riser"
  | "Future Stash"
  | "Win-Now Rental"
  // Sell-side
  | "Universal Sell"
  | "Rebuild Sell"
  | "Contender Sell"
  | "Hype Sell"
  | "Age Cliff Risk"
  | "Weak Usage Sell"
  | "Production Overperformer"
  | "Roster Clogger"
  // Neutral
  | "Fair Value"
  | "Team-Fit Dependent"
  | "Watchlist"
  | "Insufficient Data";

// Which roster archetype a player best helps. Drives the "Best Fit" column.
export type BestFit =
  | "Win-Now"
  | "Rebuild"
  | "Universal"
  | "Team-Fit Dependent"
  | "Avoid";

export type ValueFinderPlayer = {
  playerId: string;
  playerName: string;
  position: Position;
  team?: string;
  age?: number;
  season?: number;

  // Market value
  marketValue?: number;
  marketRank?: number;
  valueSource?: ValueSourceVF;

  // Per-source raw market values (used to switch the active source)
  fantasyCalcValue?: number;
  ktcValue?: number;
  customValue?: number;
  dynastyCommandValue?: number;

  // Internal / calculated value
  modelValue?: number; // alias of dynastyValue (back-compat)
  modelRank?: number;
  dynastyValue?: number;
  productionValue?: number; // production-implied expected value (vs market)
  usageValue?: number; // usage-implied expected value (vs market)
  contenderValue?: number;
  rebuilderValue?: number;

  // Production
  projectedPoints?: number;
  actualPoints?: number;
  pointsPerGame?: number;
  gamesPlayed?: number;
  fantasyPoints?: number;
  fantasyPointsPerGame?: number;
  vor?: number;

  // Usage / role
  snapShare?: number;
  routeShare?: number;
  targetShare?: number;
  airYardsShare?: number;
  rushAttemptShare?: number;
  opportunityShare?: number;
  redZoneTouches?: number;
  redZoneTargets?: number;
  goalLineTouches?: number;
  targetsPerRouteRun?: number;

  // QB-specific usage
  passAttempts?: number;
  dropbacks?: number;
  designedRushAttempts?: number;
  teamPassRate?: number;

  // Trends
  marketValueChange7d?: number;
  marketValueChange30d?: number;
  marketValueChange90d?: number;
  productionTrend?: number;
  usageTrend?: number;
  roleTrend?: number;
  adpChange30d?: number;

  // Sleeper / Dynasty Command league data
  rosterRate?: number;
  startRate?: number;
  benchRate?: number;
  leagueExposure?: number;

  // Derived sub-scores (0–1, position-relative)
  usageScore?: number;
  productionScore?: number;
  longevityScore?: number;
  trendScore?: number;
  marketInsulationScore?: number;

  // Derived signals
  expectedValue?: number; // = productionValue (back-compat)
  gap?: number;
  gapPercent?: number;
  valueFinderScore?: number;
  signal?: ValueSignal;
  tone?: SignalTone;
  archetype?: ValueArchetype;

  // Longevity-aware recommendation (valueFinderLabels.ts)
  buySignals?: string[];
  riskSignals?: string[];
  bestFit?: BestFit;
  finalLabel?: ValueLabel;
};

export type ValueFinderTab =
  | "market-gaps"
  | "production-buys"
  | "usage-buys"
  | "trend-radar"
  | "win-now"
  | "rebuild";

export type AgeRange = "All" | "Under 23" | "23-25" | "26-28" | "29+";
export type SeasonFilter = "2025" | "2024" | "2023" | "All";
export type FormatFilter = "All" | "1QB" | "Superflex" | "TEP";
export type TrendWindow = "7D" | "30D" | "90D";

export interface ValueFinderFilters {
  position: Position | "All";
  format: FormatFilter;
  season: SeasonFilter;
  valueSource: ValueSourceVF;
  ageRange: AgeRange;
  minGamesPlayed: 0 | 4 | 8 | 12;
  minMarketValue?: number;
  search: string;
  trendWindow: TrendWindow;
}

export interface ValueFinderSummary {
  bestBuy: ValueFinderPlayer | null;
  biggestSell: ValueFinderPlayer | null;
  bestWinNowDiscount: ValueFinderPlayer | null;
  bestRebuildTarget: ValueFinderPlayer | null;
  totalPlayers: number;
}

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];
export const POSITIONS_WITH_ALL = ["All", "QB", "RB", "WR", "TE"] as const;

export const VALUE_SOURCES: ValueSourceVF[] = [
  "FantasyCalc",
  "KTC",
  "Custom",
  "Dynasty Command",
];

export const AGE_RANGES: AgeRange[] = ["All", "Under 23", "23-25", "26-28", "29+"];
export const SEASONS: SeasonFilter[] = ["2025", "2024", "2023", "All"];
export const FORMATS: FormatFilter[] = ["All", "1QB", "Superflex", "TEP"];
export const MIN_GAMES: Array<0 | 4 | 8 | 12> = [0, 4, 8, 12];

export const TREND_WINDOWS: Array<{ value: TrendWindow; label: string }> = [
  { value: "7D", label: "7 Days" },
  { value: "30D", label: "30 Days" },
  { value: "90D", label: "90 Days" },
];

// Shared with market feature for visual consistency.
export const POSITION_COLORS: Record<Position, string> = {
  QB: "hsl(280, 65%, 60%)",
  RB: "hsl(150, 60%, 45%)",
  WR: "hsl(210, 70%, 55%)",
  TE: "hsl(30, 80%, 55%)",
};

export const SIGNAL_COLORS: Record<ValueSignal, string> = {
  "Strong Buy": "hsl(150, 70%, 45%)",
  Buy: "hsl(150, 50%, 55%)",
  "Fair Value": "hsl(220, 10%, 55%)",
  Sell: "hsl(30, 80%, 55%)",
  "Strong Sell": "hsl(0, 70%, 55%)",
  "Insufficient Data": "hsl(220, 8%, 45%)",
};

// Tone family for a label — drives badge color + chart point color.
export type LabelTone = "buy" | "sell" | "neutral";

export const LABEL_TONE: Record<ValueLabel, LabelTone> = {
  "Universal Buy": "buy",
  "Contender Buy": "buy",
  "Rebuilder Buy": "buy",
  "Production Discount": "buy",
  "Usage Buy": "buy",
  "Hidden Riser": "buy",
  "Future Stash": "buy",
  "Win-Now Rental": "buy",
  "Universal Sell": "sell",
  "Rebuild Sell": "sell",
  "Contender Sell": "sell",
  "Hype Sell": "sell",
  "Age Cliff Risk": "sell",
  "Weak Usage Sell": "sell",
  "Production Overperformer": "sell",
  "Roster Clogger": "sell",
  "Fair Value": "neutral",
  "Team-Fit Dependent": "neutral",
  Watchlist: "neutral",
  "Insufficient Data": "neutral",
};

// Tailwind class sets per tone, reused by the label badge.
export const LABEL_TONE_STYLES: Record<LabelTone, string> = {
  buy: "bg-emerald-500/12 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/25",
  sell: "bg-red-500/12 text-red-600 dark-any:text-red-400 border-red-500/25",
  neutral: "bg-muted/40 text-muted-foreground border-border",
};

export interface ChartPlayerPoint {
  x: number;
  y: number;
  player: ValueFinderPlayer;
}
