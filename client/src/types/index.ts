export interface TeamMetrics {
  overall: number;
  starters: number;
  depth: number;
  youth: number;
  picks: number;
  qb: number;
  rb: number;
  wr: number;
  te: number;
  contenderWindowYears: number;
}

export interface Player {
  id: string;
  name: string;
  pos: "QB" | "RB" | "WR" | "TE";
  age: number;
  value: number;
  team: string;
  starter?: boolean;
  sleeperId?: string;
}

export interface Pick {
  year: number;
  round: number;
  ownerTeamId: string;
  originalRosterId?: number;
  pickSlot?: number;
  projectedRange?: "Early" | "Mid" | "Late";
  value: number;
}

export interface Team {
  id: string;
  name: string;
  owner: string;
  ownerId?: string;
  roster: Player[];
  picks: Pick[];
  metrics: TeamMetrics;
}

export interface League {
  id: string;
  name: string;
  platform: string;
  scoringFormat: string;
  teams: Team[];
  rosterPositions?: string[];
  format?: "SF" | "1QB";
}

export type Tier = "Juggernaut" | "Win-Now" | "Future Powerhouse" | "Pick Hoarder" | "Taco" | "Balanced";

export interface TabConfig {
  id: string;
  label: string;
}

export interface MainTabConfig extends TabConfig {
  subTabs: TabConfig[];
}

export type ValueSourceId = "fantasycalc" | "ktc" | "dlf" | "flock" | "custom";

export interface ValueSourceOption {
  id: ValueSourceId;
  label: string;
  description: string;
  active: boolean;
}

export type InsightType = "positive" | "neutral" | "negative";

export type InsightCategory = "league-leaders" | "draft-capital" | "contender-analysis" | "trade-opportunities" | "your-team";

export interface Insight {
  text: string;
  type: InsightType;
  category: InsightCategory;
}

export interface SleeperUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface SleeperLeagueSummary {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  rosterPositions: string[];
  scoringFormat: string;
  format: string;
  status: string;
}

export interface TradeAssetPlayer {
  sleeperId: string;
  name: string;
  pos: string;
  age: number;
  team: string;
}

export interface TradeAssetPick {
  season: string;
  round: number;
  originalOwnerName: string;
}

export interface TradeSide {
  rosterId: number;
  teamName: string;
  ownerName: string;
  playersReceived: TradeAssetPlayer[];
  picksReceived: TradeAssetPick[];
}

export interface TradeRecord {
  tradeId: string;
  season: string;
  week: number;
  timestamp: number;
  leagueName: string;
  leagueFormat: string;
  leagueScoringFormat: string;
  leagueTotalRosters: number;
  sides: TradeSide[];
}

export interface CrawlStatus {
  status: "idle" | "running" | "paused" | "completed";
  seedUsername: string | null;
  currentDegree: number;
  maxDegree: number;
  leaguesDiscovered: number;
  leaguesCrawled: number;
  tradesCollected: number;
  usersDiscovered: number;
  startedAt: string | null;
  updatedAt: string | null;
}

export function formatPickLabel(pick: Pick): string {
  if (pick.pickSlot !== undefined && pick.pickSlot > 0) {
    return `${pick.year} ${pick.round}.${String(pick.pickSlot).padStart(2, "0")}`;
  }
  return `${pick.year} Rd ${pick.round}`;
}
