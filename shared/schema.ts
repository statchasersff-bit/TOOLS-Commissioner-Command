import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, boolean, timestamp, serial, jsonb } from "drizzle-orm/pg-core";
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
  pickSlot: integer("pick_slot"),
  pickOriginalRosterId: integer("pick_original_roster_id"),
  pickOriginalOwnerName: text("pick_original_owner_name"),
  pickDraftType: varchar("pick_draft_type", { length: 20 }),
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

export const financePasswords = pgTable("finance_passwords", {
  sleeperUserId: varchar("sleeper_user_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leagueFinances = pgTable("league_finances", {
  id: serial("id").primaryKey(),
  sleeperUserId: varchar("sleeper_user_id").notNull(),
  leagueId: varchar("league_id").notNull(),
  season: varchar("season", { length: 10 }).notNull().default("2026"),
  buyIn: integer("buy_in").notNull().default(0),
  prizes: jsonb("prizes").notNull().default([]),
  notes: text("notes"),
  isFree: boolean("is_free").notNull().default(false),
  ignored: boolean("ignored").notNull().default(false),
  leagueSafeUrl: text("league_safe_url"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLeagueFinanceSchema = createInsertSchema(leagueFinances).omit({ id: true, updatedAt: true });
export type InsertLeagueFinance = z.infer<typeof insertLeagueFinanceSchema>;
export type LeagueFinance = typeof leagueFinances.$inferSelect;

export type CrawledLeague = typeof crawledLeagues.$inferSelect;
export type CrawledUser = typeof crawledUsers.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type TradeAsset = typeof tradeAssets.$inferSelect;
export type CrawlState = typeof crawlState.$inferSelect;
export type CrawlQueueItem = typeof crawlQueue.$inferSelect;
export type PlayerValueSnapshot = typeof playerValueSnapshots.$inferSelect;

// ── StatChasers Account System ────────────────────────────────────────────────

export const scUsers = pgTable("sc_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  purpose: varchar("purpose", { length: 20 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scConnectedAccounts = pgTable("sc_connected_accounts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  provider: varchar("provider", { length: 20 }).notNull(),
  sleeperUsername: text("sleeper_username"),
  sleeperUserId: text("sleeper_user_id"),
  encryptedToken: text("encrypted_token"),
  connectedAt: timestamp("connected_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ScUser = typeof scUsers.$inferSelect;
export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type ScConnectedAccount = typeof scConnectedAccounts.$inferSelect;

// ── ADP pipeline ─────────────────────────────────────────────────────────────
// Normalized store of completed Sleeper drafts. We collect drafts in the
// background, persist the picks once, and compute cached ADP snapshots from
// our own database rather than hitting Sleeper on every page load.

export const drafts = pgTable("drafts", {
  draftId: varchar("draft_id").primaryKey(),
  leagueId: varchar("league_id"),
  season: varchar("season", { length: 10 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  draftType: varchar("draft_type", { length: 20 }).notNull().default("startup"),
  draftFormat: varchar("draft_format", { length: 20 }).notNull().default("snake"),
  teams: integer("teams").notNull().default(12),
  rounds: integer("rounds").notNull().default(0),
  scoringType: varchar("scoring_type", { length: 10 }).notNull().default("ppr"),
  leagueMode: varchar("league_mode", { length: 12 }).notNull().default("dynasty"),
  superflex: boolean("superflex").notNull().default(false),
  tePremium: boolean("te_premium").notNull().default(false),
  bestBall: boolean("best_ball").notNull().default(false),
  passTd: integer("pass_td").notNull().default(4),
  rosterSize: integer("roster_size").notNull().default(0),
  starterCount: integer("starter_count").notNull().default(0),
  // Sleeper timestamps are unix millis. We pick the canonical draft date as
  // completed_at ?? start_time ?? created_at when ingesting.
  draftDate: timestamp("draft_date"),
  completedAt: bigint("completed_at", { mode: "number" }),
  startTime: bigint("start_time", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }),
  // True when picks include actual rookies (drafted directly), false when the
  // draft enumerates rookie placeholder slots (e.g. "2026 Rookie 1.01").
  directlyDraftedRookies: boolean("directly_drafted_rookies").notNull().default(false),
  ingestedAt: timestamp("ingested_at").defaultNow(),
});

export const draftPicks = pgTable("draft_picks", {
  id: serial("id").primaryKey(),
  draftId: varchar("draft_id").notNull(),
  // Sleeper's pick_no is the canonical 1-based overall pick. This is our
  // ordering source of truth — we never derive it from round*slot.
  pickNo: integer("pick_no").notNull(),
  round: integer("round").notNull(),
  pickInRound: integer("pick_in_round").notNull(),
  draftSlot: integer("draft_slot"),
  rosterId: integer("roster_id"),
  pickedBy: varchar("picked_by"),
  playerId: varchar("player_id"),
  playerName: text("player_name"),
  position: varchar("position", { length: 5 }),
  team: varchar("team", { length: 10 }),
  isRookie: boolean("is_rookie").notNull().default(false),
  isRookiePlaceholder: boolean("is_rookie_placeholder").notNull().default(false),
  rookiePickLabel: text("rookie_pick_label"),
});

// One row per (filter_key, snapshot_date). Stored as a JSON blob so the
// expensive aggregation runs once per refresh and the read path is a single
// keyed lookup.
export const adpSnapshots = pgTable("adp_snapshots", {
  id: serial("id").primaryKey(),
  filterKey: text("filter_key").notNull(),
  filters: jsonb("filters").notNull().default({}),
  rows: jsonb("rows").notNull().default([]),
  draftCount: integer("draft_count").notNull().default(0),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  computedAt: timestamp("computed_at").defaultNow(),
});

export type Draft = typeof drafts.$inferSelect;
export type DraftPick = typeof draftPicks.$inferSelect;
export type AdpSnapshot = typeof adpSnapshots.$inferSelect;

// ── Custom value sets (Value Source Manager) ─────────────────────────────────
// One row per uploaded value set. value_type partitions dynasty vs redraft;
// only one row per (user_id, value_type) should be is_active=true at a time
// — the application enforces this rather than a partial-unique index so
// activating a set just flips the previous active row off.

export const userValueSets = pgTable("user_value_sets", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  valueType: varchar("value_type", { length: 10 }).notNull(),
  name: text("name").notNull(),
  source: varchar("source", { length: 30 }).notNull().default("custom_upload"),
  isActive: boolean("is_active").notNull().default(false),
  totalRows: integer("total_rows").notNull().default(0),
  matchedRows: integer("matched_rows").notNull().default(0),
  unmatchedRows: integer("unmatched_rows").notNull().default(0),
  invalidRows: integer("invalid_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userPlayerValues = pgTable("user_player_values", {
  id: serial("id").primaryKey(),
  valueSetId: integer("value_set_id").notNull(),
  // Sleeper ID when matched, otherwise null + matched=false. We still store
  // unmatched rows so the user can review them in the manage screen.
  playerId: varchar("player_id"),
  playerName: text("player_name").notNull(),
  position: varchar("position", { length: 5 }),
  team: varchar("team", { length: 10 }),
  value: integer("value").notNull().default(0),
  matched: boolean("matched").notNull().default(false),
  matchMethod: varchar("match_method", { length: 20 }),
});

export type UserValueSet = typeof userValueSets.$inferSelect;
export type UserPlayerValue = typeof userPlayerValues.$inferSelect;
