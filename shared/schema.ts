import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const crawledLeagues = pgTable("crawled_leagues", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  season: varchar("season", { length: 10 }).notNull(),
  totalRosters: integer("total_rosters").notNull().default(0),
  format: varchar("format", { length: 10 }).notNull().default("1QB"),
  scoringFormat: varchar("scoring_format", { length: 20 }).notNull().default("PPR"),
  rosterPositions: text("roster_positions").array(),
  previousLeagueId: varchar("previous_league_id"),
  crawledAt: timestamp("crawled_at").defaultNow(),
  tradeCount: integer("trade_count").notNull().default(0),
});

export const crawledUsers = pgTable("crawled_users", {
  id: varchar("id").primaryKey(),
  username: text("username"),
  displayName: text("display_name"),
  discoveredAt: timestamp("discovered_at").defaultNow(),
  leaguesCrawled: boolean("leagues_crawled").notNull().default(false),
});

export const trades = pgTable("trades", {
  id: varchar("id").primaryKey(),
  leagueId: varchar("league_id").notNull(),
  season: varchar("season", { length: 10 }).notNull(),
  week: integer("week").notNull().default(0),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  rosterIds: integer("roster_ids").array(),
  status: varchar("status", { length: 20 }).notNull().default("complete"),
  leagueName: text("league_name"),
  leagueFormat: varchar("league_format", { length: 10 }),
  leagueScoringFormat: varchar("league_scoring_format", { length: 20 }),
  leagueTotalRosters: integer("league_total_rosters"),
});

export const tradeAssets = pgTable("trade_assets", {
  id: serial("id").primaryKey(),
  tradeId: varchar("trade_id").notNull(),
  rosterId: integer("roster_id").notNull(),
  rosterOwnerName: text("roster_owner_name"),
  rosterTeamName: text("roster_team_name"),
  assetType: varchar("asset_type", { length: 10 }).notNull(),
  playerSleeperId: varchar("player_sleeper_id"),
  playerName: text("player_name"),
  playerPos: varchar("player_pos", { length: 5 }),
  playerTeam: varchar("player_team", { length: 10 }),
  playerAge: integer("player_age"),
  pickSeason: varchar("pick_season", { length: 10 }),
  pickRound: integer("pick_round"),
  pickOriginalRosterId: integer("pick_original_roster_id"),
  pickOriginalOwnerName: text("pick_original_owner_name"),
  direction: varchar("direction", { length: 10 }).notNull(),
});

export const crawlState = pgTable("crawl_state", {
  id: serial("id").primaryKey(),
  status: varchar("status", { length: 20 }).notNull().default("idle"),
  seedUsername: varchar("seed_username"),
  currentDegree: integer("current_degree").notNull().default(0),
  maxDegree: integer("max_degree").notNull().default(4),
  leaguesDiscovered: integer("leagues_discovered").notNull().default(0),
  leaguesCrawled: integer("leagues_crawled").notNull().default(0),
  tradesCollected: integer("trades_collected").notNull().default(0),
  usersDiscovered: integer("users_discovered").notNull().default(0),
  startedAt: timestamp("started_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  errorLog: text("error_log"),
});

export const crawlQueue = pgTable("crawl_queue", {
  id: serial("id").primaryKey(),
  leagueId: varchar("league_id").notNull(),
  degree: integer("degree").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const playerValueSnapshots = pgTable("player_value_snapshots", {
  id: serial("id").primaryKey(),
  sleeperId: varchar("sleeper_id", { length: 20 }).notNull(),
  name: text("name").notNull(),
  pos: varchar("pos", { length: 5 }).notNull(),
  team: varchar("team", { length: 10 }),
  age: integer("age"),
  dynastyValue: integer("dynasty_value").notNull().default(0),
  dynastyValueSf: integer("dynasty_value_sf").notNull().default(0),
  redraftValue: integer("redraft_value").notNull().default(0),
  redraftValueSf: integer("redraft_value_sf").notNull().default(0),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  capturedAt: timestamp("captured_at").defaultNow(),
});

export type CrawledLeague = typeof crawledLeagues.$inferSelect;
export type CrawledUser = typeof crawledUsers.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type TradeAsset = typeof tradeAssets.$inferSelect;
export type CrawlState = typeof crawlState.$inferSelect;
export type CrawlQueueItem = typeof crawlQueue.$inferSelect;
export type PlayerValueSnapshot = typeof playerValueSnapshots.$inferSelect;
