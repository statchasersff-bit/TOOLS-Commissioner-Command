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

export type ValueSourceId = "ktc" | "fantasycalc" | "dynastyprocess" | "market-avg" | "statchasers";

export interface ValueSourceOption {
  id: ValueSourceId;
  label: string;
  description: string;
  active: boolean;
}

export type InsightType = "positive" | "neutral" | "negative";

export interface Insight {
  text: string;
  type: InsightType;
}
