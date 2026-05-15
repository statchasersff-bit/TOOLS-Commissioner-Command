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
  windowStartOffset: number;
}

export interface Player {
  id: string;
  name: string;
  pos: "QB" | "RB" | "WR" | "TE";
  age: number;
  value: number;
  team: string;
  starter?: boolean;
  onTaxi?: boolean;
  onReserve?: boolean;
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
  avatar?: string | null;
  roster: Player[];
  picks: Pick[];
  metrics: TeamMetrics;
  wins?: number;
  losses?: number;
  ties?: number;
}

export interface League {
  id: string;
  name: string;
  platform: string;
  scoringFormat: string;
  teams: Team[];
  rosterPositions?: string[];
  format?: "SF" | "1QB";
  playoffTeams?: number;
  regularSeasonWeeks?: number;
  totalRosters?: number;
  avatar?: string | null;
  benchSlots?: number;
  taxiSlots?: number;
  irSlots?: number;
  tePremium?: number;
  scoringSettings?: Record<string, number>;
}

export type Tier = "Juggernaut" | "Win-Now" | "Future Powerhouse" | "Pick Hoarder" | "Taco" | "Contender" | "Pretender" | "Rebuilder" | "Weak / Directionless" | "Balanced";

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
  isBestBall?: boolean;
  avatar?: string | null;
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
  slot?: number | null;
  originalOwnerName: string;
  draftType?: string | null;
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
  leagueName: string | null;
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

function ordinalRound(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

export function formatPickLabel(pick: Pick): string {
  return `${pick.year} ${ordinalRound(pick.round)}`;
}
