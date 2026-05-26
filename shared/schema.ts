import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, boolean, timestamp, serial, jsonb, index } from "drizzle-orm/pg-core";
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

// Weekly snapshots of a roster's high-level value composition, used to power
// the GM Dashboard's "Team Trajectory" chart. Granularity is intentionally
// daily; the client gates writes via snapshotDate so spamming the endpoint
// doesn't create noisy duplicates.
export const teamValueSnapshots = pgTable("team_value_snapshots", {
  id: serial("id").primaryKey(),
  leagueId: varchar("league_id", { length: 32 }).notNull(),
  rosterId: integer("roster_id").notNull(),
  // YYYY-MM-DD — one row per (league, roster, day) per the unique key below.
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  dynastyValue: integer("dynasty_value").notNull().default(0),
  winNowValue: integer("win_now_value").notNull().default(0),
  pickValue: integer("pick_value").notNull().default(0),
  starterStrength: integer("starter_strength").notNull().default(0),
  // Stored * 10 to keep this an integer column. avgAge = 26.4 → 264.
  avgAgeX10: integer("avg_age_x10").notNull().default(0),
  capturedAt: timestamp("captured_at").defaultNow(),
});

export const insertTeamValueSnapshotSchema = createInsertSchema(teamValueSnapshots).omit({
  id: true,
  capturedAt: true,
});
export type InsertTeamValueSnapshot = z.infer<typeof insertTeamValueSnapshotSchema>;
export type TeamValueSnapshot = typeof teamValueSnapshots.$inferSelect;

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
  // Personalization. Phase 1 stores the favorite NFL team abbreviation
  // directly on the user row; if more prefs accumulate later this can move
  // to a dedicated user_preferences table without changing the API shape.
  favoriteNflTeam: varchar("favorite_nfl_team", { length: 5 }),
  // Subscription state — gates Sleeper write actions on the write-access
  // domain. `status` mirrors Stripe vocabulary so the eventual webhook can
  // write through unchanged:
  //   "inactive" — default; never subscribed or subscription ended.
  //   "trialing" — in trial; treated as active for entitlement.
  //   "active" — paid and current.
  //   "past_due" — payment failed; grace period. Treated as inactive for
  //     write entitlement (server blocks writes) but UI may show a
  //     soft warning.
  //   "canceled" / "incomplete" / "incomplete_expired" / "unpaid" —
  //     inactive.
  subscriptionStatus: varchar("subscription_status", { length: 20 }).notNull().default("inactive"),
  // Plan identifier (e.g. "pro_monthly", "pro_yearly"). Free-form so we
  // don't couple the schema to a specific pricing plan name.
  subscriptionPlan: varchar("subscription_plan", { length: 32 }),
  // When the *current* paid period ends. While `subscriptionStatus` is the
  // primary truth, this lets us catch the rare case of a webhook missing
  // the cancel event — we treat a status that says active but with an
  // expired `currentPeriodEnd` as inactive.
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end"),
  // Reference to the upstream billing record. Nullable until first subscribe.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
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
  // Kept for backward compat; the authoritative classification now lives in
  // the `rookieMode` column below.
  directlyDraftedRookies: boolean("directly_drafted_rookies").notNull().default(false),
  // "direct_rookies" | "rookie_picks" | "mixed" | "unknown". Computed at
  // ingestion from the pick mix (see classifyDraftRookieMode). Drives the
  // Rookie Picks vs Direct Rookies filter on the ADP Explorer.
  rookieMode: text("rookie_mode").notNull().default("unknown"),
  // True when this draft has been excluded from ADP calculations — set when
  // it contains defensive players / IDP picks (IDP drafts have very
  // different ADP behavior and shouldn't be mixed with standard data) or a
  // real kicker outside of the rookie-pick-placeholder pattern.
  excludedFromAdp: boolean("excluded_from_adp").notNull().default(false),
  exclusionReason: text("exclusion_reason"),
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
  // Year the picked player entered the NFL — derived at ingest time from
  // either the pick's metadata.years (when Sleeper supplies it) or from
  // draftSeason - playerDb[pid].years_exp. Null when neither signal is
  // available (e.g. placeholder picks, unknown players). Lets us filter
  // Direct Rookies by class year (2026 vs returning players, etc).
  rookieYear: integer("rookie_year"),
}, (table) => ({
  // draft_picks is keyed by draft_id everywhere (pick pulls, EXISTS/NOT EXISTS
  // guards in buildDraftWhere, per-draft histograms). Without this index those
  // all seq-scan the ~1M-row table; with it they use index scans / semi-joins.
  draftIdIdx: index("draft_picks_draft_id_idx").on(table.draftId),
}));

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

// Manager Intel — cached per (user, league, season) so the modal isn't
// re-aggregating dozens of Sleeper API calls on every open. The payload is
// stored as a single JSON blob; we never query it by field, only refresh it.
export const managerIntelCache = pgTable("manager_intel_cache", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  leagueId: varchar("league_id", { length: 32 }).notNull().default(""),
  season: varchar("season", { length: 10 }).notNull(),
  payload: jsonb("payload").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export type ManagerIntelCache = typeof managerIntelCache.$inferSelect;

// ── ADP crawl pipeline ───────────────────────────────────────────────────────
// Seeds are the operator's "I trust this entry point" list — usernames /
// user_ids / league_ids / draft_ids that we explicitly want to expand from.
// adp_crawl_queue is the work-in-progress: every seed fans out into a handful
// of queue rows (one per league, one per draft, etc.) which the worker
// drains under the global rate limit. adp_crawl_log keeps an audit trail so
// the admin tools can show "how much did the last run pull in".

export const adpCrawlSeeds = pgTable("adp_crawl_seeds", {
  id: serial("id").primaryKey(),
  seedType: varchar("seed_type", { length: 20 }).notNull(),
  seedValue: text("seed_value").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
  lastCrawledAt: timestamp("last_crawled_at"),
});

export const adpCrawlQueue = pgTable("adp_crawl_queue", {
  id: serial("id").primaryKey(),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: text("target_id").notNull(),
  season: varchar("season", { length: 10 }),
  priority: integer("priority").notNull().default(50),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
  // Set when this item was enqueued by the passive crawler for a specific
  // Sleeper user (depth-1 from their leagues on login). NULL for admin /
  // operator seeds. Threaded through processUser → processLeague →
  // processDraft so each item produced by a passive crawl can be linked back
  // to its originating adp_user_crawl_events row for counter updates and
  // completion detection.
  seedSleeperUserId: varchar("seed_sleeper_user_id", { length: 32 }),
});

export const adpCrawlLog = pgTable("adp_crawl_log", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 30 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  message: text("message"),
  draftsFound: integer("drafts_found").notNull().default(0),
  draftsIngested: integer("drafts_ingested").notNull().default(0),
  picksIngested: integer("picks_ingested").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type AdpCrawlSeed = typeof adpCrawlSeeds.$inferSelect;
export type AdpCrawlQueueItem = typeof adpCrawlQueue.$inferSelect;
export type AdpCrawlLogEntry = typeof adpCrawlLog.$inferSelect;

// ── Passive ADP enrichment events ────────────────────────────────────────────
// One row per "user connected their Sleeper account → kick off a depth-1
// crawl" event. Doubles as audit log AND cooldown table — enqueueSleeperUser
// reads the most recent row for a sleeper_user_id and decides whether to skip
// (cooldown), retry (failed > 24h ago), or fresh-crawl (>7d since complete).
//
// Counters are incremented as the worker processes queue items tagged with
// this event's sleeper_user_id (via adp_crawl_queue.seed_sleeper_user_id).
// status transitions: queued → running → complete|failed|skipped.

export const adpUserCrawlEvents = pgTable("adp_user_crawl_events", {
  id: serial("id").primaryKey(),
  sleeperUserId: varchar("sleeper_user_id", { length: 32 }).notNull(),
  sleeperUsername: text("sleeper_username"),
  // Origin tag so audit views can distinguish where a passive crawl was
  // kicked off from. "user_login_depth1" = authed /api/sc-auth/connect-sleeper.
  // "readonly_connect_depth1" = anonymous header-bar Sleeper username connect.
  // "admin_recrawl" = operator-forced via the admin panel.
  source: varchar("source", { length: 32 }).notNull().default("user_login_depth1"),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  queuedItems: integer("queued_items").notNull().default(0),
  leaguesScanned: integer("leagues_scanned").notNull().default(0),
  draftsFound: integer("drafts_found").notNull().default(0),
  draftsAdded: integer("drafts_added").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type AdpUserCrawlEvent = typeof adpUserCrawlEvents.$inferSelect;

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
