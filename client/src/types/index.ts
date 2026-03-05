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
  projectedRange?: "Early" | "Mid" | "Late";
  value: number;
}

export interface Team {
  id: string;
  name: string;
  owner: string;
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
}

export type Tier = "Elite" | "Contender" | "Competitive" | "Rebuild";

export interface TabConfig {
  id: string;
  label: string;
}

export interface MainTabConfig extends TabConfig {
  subTabs: TabConfig[];
}

export type ValueSourceId = "fantasycalc" | "ktc" | "dlf" | "custom";

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
