import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, boolean, timestamp, serial, jsonb, numeric, index, unique } from "drizzle-orm/pg-core";
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
  bestBall: boolean("best_ball").notNull().default(false),
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
  // Per-manager dues tracking (commissioner League Treasury). Schemaless jsonb
  // so prize/payment shapes can evolve without a migration. Older rows predate
  // this column and default to an empty array.
  payments: jsonb("payments").notNull().default([]),
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

/** League include/exclude delta relative to each league's `eligibleByDefault`. */
export interface UserLeaguePrefs {
  added: string[];
  removed: string[];
}

/**
 * Per-account UI/session preferences, persisted so they survive a new deploy
 * origin (where per-origin localStorage is empty). Stored as a single JSONB blob
 * on the user row — additive and nullable, so existing rows read as `{}`. Each
 * field is optional; the client merges these over its localStorage fallback.
 */
export interface UserPreferences {
  theme?: "light" | "x-mode" | "my_team";
  activeLeagueId?: string | null;
  leaguePrefs?: UserLeaguePrefs;
}

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
  // Per-account UI/session preferences (theme, active league, league filters).
  // JSONB so new prefs can be added without a migration. Nullable; absent = {}.
  preferences: jsonb("preferences").$type<UserPreferences>(),
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

// ── Platform adapter layer ────────────────────────────────────────────────────
// Multi-platform fantasy integration. Sleeper continues to use the legacy
// `sc_connected_accounts` + Sleeper-specific code paths; new platforms (Yahoo
// first) connect through `platform_connections` and feed the normalized
// `fantasy_*` tables below. Read-only Commissioner Command modules consume the
// normalized model so they are agnostic to which platform supplied the data.
//
// SECURITY: OAuth tokens live here AES-256-GCM-encrypted (see
// server/services/tokenCrypto.ts) and are NEVER serialized to the client.

export const platformConnections = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  platformUserId: text("platform_user_id"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes"),
  status: varchar("status", { length: 20 }).notNull().default("connected"),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  byUserPlatform: index("platform_connections_user_platform_idx").on(t.userId, t.platform),
}));

export const fantasyLeagues = pgTable("fantasy_leagues", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  leagueKey: text("league_key").notNull(),
  platformLeagueId: text("platform_league_id"),
  name: text("name"),
  season: varchar("season", { length: 10 }),
  gameCode: varchar("game_code", { length: 10 }).notNull().default("nfl"),
  numTeams: integer("num_teams"),
  scoringType: varchar("scoring_type", { length: 24 }),
  isFinished: boolean("is_finished").notNull().default(false),
  url: text("url"),
  logoUrl: text("logo_url"),
  settings: jsonb("settings").$type<Record<string, any>>(),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqByUserKey: index("fantasy_leagues_user_key_idx").on(t.userId, t.platform, t.leagueKey),
}));

export const fantasyTeams = pgTable("fantasy_teams", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  leagueKey: text("league_key").notNull(),
  teamKey: text("team_key").notNull(),
  platformTeamId: text("platform_team_id"),
  name: text("name"),
  managerName: text("manager_name"),
  managerPlatformUserId: text("manager_platform_user_id"),
  isOwnedByUser: boolean("is_owned_by_user").notNull().default(false),
  logoUrl: text("logo_url"),
  rank: integer("rank"),
  wins: integer("wins"),
  losses: integer("losses"),
  ties: integer("ties"),
  pointsFor: text("points_for"),
  pointsAgainst: text("points_against"),
  raw: jsonb("raw").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  byLeague: index("fantasy_teams_league_idx").on(t.userId, t.platform, t.leagueKey),
  uniqTeam: index("fantasy_teams_team_key_idx").on(t.userId, t.platform, t.teamKey),
}));

export const fantasyRosterPlayers = pgTable("fantasy_roster_players", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  leagueKey: text("league_key").notNull(),
  teamKey: text("team_key").notNull(),
  week: integer("week"),
  platformPlayerId: text("platform_player_id").notNull(),
  playerName: text("player_name"),
  position: varchar("position", { length: 10 }),
  nflTeam: varchar("nfl_team", { length: 10 }),
  selectedPosition: varchar("selected_position", { length: 12 }),
  status: varchar("status", { length: 20 }),
  canonicalPlayerId: varchar("canonical_player_id", { length: 24 }),
  mapMethod: varchar("map_method", { length: 16 }).notNull().default("unmapped"),
  mapConfidence: integer("map_confidence").notNull().default(0),
  raw: jsonb("raw").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  byTeam: index("fantasy_roster_players_team_idx").on(t.teamKey, t.week),
  byUnmapped: index("fantasy_roster_players_unmapped_idx").on(t.userId, t.mapMethod),
}));

export const playerExternalIds = pgTable("player_external_ids", {
  id: serial("id").primaryKey(),
  canonicalPlayerId: varchar("canonical_player_id", { length: 24 }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  platformPlayerId: text("platform_player_id").notNull(),
  playerName: text("player_name"),
  position: varchar("position", { length: 10 }),
  nflTeam: varchar("nfl_team", { length: 10 }),
  source: varchar("source", { length: 24 }).notNull().default("auto_exact"),
  confidence: integer("confidence").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqPlatformId: index("player_external_ids_platform_id_idx").on(t.platform, t.platformPlayerId),
  byCanonical: index("player_external_ids_canonical_idx").on(t.canonicalPlayerId),
}));

export const fantasySyncRuns = pgTable("fantasy_sync_runs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  leaguesSynced: integer("leagues_synced").notNull().default(0),
  teamsSynced: integer("teams_synced").notNull().default(0),
  playersSynced: integer("players_synced").notNull().default(0),
  unmappedPlayers: integer("unmapped_players").notNull().default(0),
}, (t) => ({
  byUser: index("fantasy_sync_runs_user_idx").on(t.userId, t.platform, t.startedAt),
}));

export type PlatformConnection = typeof platformConnections.$inferSelect;
export type FantasyLeague = typeof fantasyLeagues.$inferSelect;
export type FantasyTeam = typeof fantasyTeams.$inferSelect;
export type FantasyRosterPlayer = typeof fantasyRosterPlayers.$inferSelect;
export type PlayerExternalId = typeof playerExternalIds.$inferSelect;
export type FantasySyncRun = typeof fantasySyncRuns.$inferSelect;

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
}, (table) => ({
  // ADP reads (computeAdp → buildDraftWhere) filter the drafts table by these
  // equality columns on every cold compute, then range-scan draftDate for the
  // date-windowed Draft Command queries. Without these the ~24k-row drafts
  // table is seq-scanned per request, and date-range computes (which never hit
  // a precomputed snapshot) are the slow queries that pin pool connections for
  // 9–36s and saturate the pool. Equality columns first, range column last so
  // the planner can use the composite for both the filter and the date window.
  adpFilterIdx: index("drafts_adp_filter_idx").on(
    table.status, table.excludedFromAdp, table.leagueMode, table.draftType, table.season,
  ),
  draftDateIdx: index("drafts_draft_date_idx").on(table.draftDate),
}));

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

// ── Commander's Report ─────────────────────────────────────────────────────
// One row per (league, season, month, tone). `recap` is the deterministic
// engine output (computed on first GET, no LLM). `article`/`model`/`generatedBy`
// /`generatedAt` are filled only when a user explicitly generates the narrated
// prose via POST /generate.
export const commandersReports = pgTable("commanders_reports", {
  id: serial("id").primaryKey(),
  leagueId: varchar("league_id", { length: 32 }).notNull(),
  season: varchar("season", { length: 10 }).notNull(),
  month: integer("month").notNull(),
  tone: varchar("tone", { length: 32 }).notNull(),
  recap: jsonb("recap").notNull(),
  article: jsonb("article"),
  model: varchar("model", { length: 64 }),
  // Stores the SC user id (a 36-char UUID from gen_random_uuid()), so this must
  // be wider than the 32-char ids used elsewhere — a varchar(32) here overflowed.
  generatedBy: varchar("generated_by", { length: 64 }),
  generatedAt: timestamp("generated_at"),
  // Public read-only share. Null = not shared; set to a URL-safe random token
  // when a user enables sharing, cleared on revoke.
  shareToken: varchar("share_token", { length: 32 }),
  sharedAt: timestamp("shared_at"),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
}, (table) => ({
  lookupIdx: index("commanders_reports_lookup_idx").on(
    table.leagueId, table.season, table.month, table.tone,
  ),
  shareTokenIdx: index("commanders_reports_share_token_idx").on(table.shareToken),
}));

export type CommandersReport = typeof commandersReports.$inferSelect;

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

// ── Unified scheduled crawler ─────────────────────────────────────────────
// Audit trail for the scheduled crawler that gathers BOTH trades and drafts.
// Each run picks one random seed user (from the pool of users who entered a
// username, or their league-mates), expands depth-1 across their leagues up to
// a randomized per-run cap, and ingests recent trades + startup/rookie drafts.
export const unifiedCrawlRuns = pgTable("unified_crawl_runs", {
  id: serial("id").primaryKey(),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  seedUserId: varchar("seed_user_id", { length: 32 }),
  seedUsername: text("seed_username"),
  leagueCapTarget: integer("league_cap_target").notNull().default(0),
  leaguesDiscovered: integer("leagues_discovered").notNull().default(0),
  leaguesScanned: integer("leagues_scanned").notNull().default(0),
  tradesInserted: integer("trades_inserted").notNull().default(0),
  draftsIngested: integer("drafts_ingested").notNull().default(0),
  membersDiscovered: integer("members_discovered").notNull().default(0),
  message: text("message"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type UnifiedCrawlRun = typeof unifiedCrawlRuns.$inferSelect;

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

// ── Portfolio Timeline (asset ledger) ────────────────────────────────────────
// Reconstructs a manager's dynasty portfolio value over time as an asset
// ledger: every player and rookie pick is an asset that's acquired, held, and
// disposed. Historical *ownership* is reconstructed from Sleeper (drafts,
// traded picks, trades, waivers); historical *values* are estimated from
// playerValueSnapshots + pick value history with a confidence label.

// One open/closed ownership period for a single asset (player or pick) in one
// league. Repeated ownership of the same asset produces SEPARATE rows.
export const assetPositions = pgTable("asset_positions", {
  id: serial("id").primaryKey(),
  sleeperUserId: varchar("sleeper_user_id", { length: 32 }).notNull(),
  leagueId: varchar("league_id", { length: 32 }).notNull(),
  rosterId: integer("roster_id"),
  assetType: varchar("asset_type", { length: 8 }).notNull(), // "player" | "pick"
  // Stable key, e.g. "player_6786" or "pick_2026_round1_origRoster123".
  assetKey: varchar("asset_key", { length: 80 }).notNull(),
  playerId: varchar("player_id", { length: 20 }),
  playerName: text("player_name"),
  pickSeason: integer("pick_season"),
  pickRound: integer("pick_round"),
  pickOriginalRosterId: integer("pick_original_roster_id"),
  pickSlot: integer("pick_slot"),
  pickBucket: varchar("pick_bucket", { length: 8 }), // early | mid | late | unknown
  acquiredDate: varchar("acquired_date", { length: 10 }).notNull(), // YYYY-MM-DD
  acquiredMethod: varchar("acquired_method", { length: 24 }).notNull(),
  disposedDate: varchar("disposed_date", { length: 10 }),
  disposedMethod: varchar("disposed_method", { length: 24 }),
  acquisitionValue: integer("acquisition_value").notNull().default(0),
  costBasis: integer("cost_basis").notNull().default(0),
  sourceEventId: integer("source_event_id"),
  rawSourceId: varchar("raw_source_id", { length: 64 }),
  isCurrent: boolean("is_current").notNull().default(true),
  confidence: varchar("confidence", { length: 16 }).notNull().default("estimated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("asset_positions_user_idx").on(table.sleeperUserId),
  userLeagueIdx: index("asset_positions_user_league_idx").on(table.sleeperUserId, table.leagueId),
  assetKeyIdx: index("asset_positions_asset_key_idx").on(table.assetKey),
  currentIdx: index("asset_positions_current_idx").on(table.sleeperUserId, table.isCurrent),
}));

// Meaningful events that move portfolio value (trades, waivers, drafts, etc.).
export const portfolioEvents = pgTable("portfolio_events", {
  id: serial("id").primaryKey(),
  sleeperUserId: varchar("sleeper_user_id", { length: 32 }).notNull(),
  leagueId: varchar("league_id", { length: 32 }),
  rosterId: integer("roster_id"),
  eventDate: varchar("event_date", { length: 10 }).notNull(), // YYYY-MM-DD
  eventType: varchar("event_type", { length: 24 }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  valueBefore: integer("value_before"),
  valueAfter: integer("value_after"),
  valueSent: integer("value_sent"),
  valueReceived: integer("value_received"),
  netDelta: integer("net_delta").notNull().default(0),
  rosterValueDelta: integer("roster_value_delta").notNull().default(0),
  pickValueDelta: integer("pick_value_delta").notNull().default(0),
  costBasisDelta: integer("cost_basis_delta").notNull().default(0),
  // Structured detail (sent/received asset lists) for the UI event card.
  detail: jsonb("detail"),
  rawTransactionId: varchar("raw_transaction_id", { length: 64 }),
  rawDraftId: varchar("raw_draft_id", { length: 64 }),
  confidence: varchar("confidence", { length: 16 }).notNull().default("estimated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("portfolio_events_user_idx").on(table.sleeperUserId),
  userDateIdx: index("portfolio_events_user_date_idx").on(table.sleeperUserId, table.eventDate),
}));

// Calculated portfolio value per (user, league, date). Aggregated across
// leagues at query time for the total-portfolio line.
export const portfolioValueSnapshots = pgTable("portfolio_value_snapshots", {
  id: serial("id").primaryKey(),
  sleeperUserId: varchar("sleeper_user_id", { length: 32 }).notNull(),
  leagueId: varchar("league_id", { length: 32 }).notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  rosterValue: integer("roster_value").notNull().default(0),
  pickValue: integer("pick_value").notNull().default(0),
  totalValue: integer("total_value").notNull().default(0),
  costBasis: integer("cost_basis").notNull().default(0),
  unrealizedGain: integer("unrealized_gain").notNull().default(0),
  realizedGain: integer("realized_gain").notNull().default(0),
  assetCount: integer("asset_count").notNull().default(0),
  confidence: varchar("confidence", { length: 16 }).notNull().default("estimated"),
  calculationVersion: integer("calculation_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userDateIdx: index("portfolio_snapshots_user_date_idx").on(table.sleeperUserId, table.snapshotDate),
  userLeagueDateIdx: index("portfolio_snapshots_user_league_date_idx").on(table.sleeperUserId, table.leagueId, table.snapshotDate),
}));

// Historical rookie-pick values (bucketed and/or exact slot). Player value
// history reuses the existing playerValueSnapshots table.
export const pickValueHistory = pgTable("pick_value_history", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  round: integer("round").notNull(),
  pickSlot: integer("pick_slot"), // exact overall/slot if known
  slotBucket: varchar("slot_bucket", { length: 8 }).notNull().default("mid"), // early|mid|late|unknown
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  value: integer("value").notNull().default(0),
  leagueFormat: varchar("league_format", { length: 8 }), // sf | 1qb
  scoringFormat: varchar("scoring_format", { length: 8 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  lookupIdx: index("pick_value_history_lookup_idx").on(table.season, table.round, table.slotBucket, table.snapshotDate),
}));

export type AssetPosition = typeof assetPositions.$inferSelect;
export type PortfolioEvent = typeof portfolioEvents.$inferSelect;
export type PortfolioValueSnapshot = typeof portfolioValueSnapshots.$inferSelect;
export type PickValueHistory = typeof pickValueHistory.$inferSelect;

// ── Product analytics: sessions + page views ─────────────────────────────────
// Lightweight first-party usage tracking so we can answer "who used the tool,
// for how long, on which pages, and did they connect Sleeper". Two tables:
//   • analytics_sessions  — one row per browser visit (sessionStorage id). Holds
//     the identity we learn during the visit (SC account id, set server-side
//     from the auth cookie; Sleeper user/username, sent by the client on
//     connect) plus the duration window (started_at → last_seen_at) maintained
//     by heartbeats. visitor_id (localStorage) ties repeat visits together.
//   • analytics_page_views — one row per route change, ts + path.
// Connected-token status is NOT stored here; it's derived at report time by
// joining sc_user_id / sleeper_user_id against sc_connected_accounts so the
// untrusted client can never assert write-access.
export const analyticsSessions = pgTable("analytics_sessions", {
  // Client-generated, opaque. Per browser tab/visit (sessionStorage).
  sessionId: varchar("session_id", { length: 40 }).primaryKey(),
  // Persistent across visits in the same browser (localStorage). Lets us count
  // returning visitors without an account.
  visitorId: varchar("visitor_id", { length: 40 }),
  // Authoritative — written server-side from the auth cookie/JWT, never trusted
  // from the request body. Null for anonymous visitors.
  scUserId: varchar("sc_user_id"),
  // Learned client-side once a Sleeper username resolves (read-only connect or
  // the authed connect flow). Username is a public handle, not a credential.
  sleeperUserId: varchar("sleeper_user_id", { length: 32 }),
  sleeperUsername: text("sleeper_username"),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  pageviewCount: integer("pageview_count").notNull().default(0),
}, (t) => ({
  visitorIdx: index("analytics_sessions_visitor_idx").on(t.visitorId),
  scUserIdx: index("analytics_sessions_sc_user_idx").on(t.scUserId),
  sleeperIdx: index("analytics_sessions_sleeper_idx").on(t.sleeperUserId),
  lastSeenIdx: index("analytics_sessions_last_seen_idx").on(t.lastSeenAt),
}));

export const analyticsPageViews = pgTable("analytics_page_views", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 40 }).notNull(),
  // Normalized in-app route, e.g. "/draft/availability". Player/manager ids are
  // collapsed to ":id" client-side to keep cardinality low.
  path: text("path").notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
}, (t) => ({
  sessionIdx: index("analytics_page_views_session_idx").on(t.sessionId),
  tsIdx: index("analytics_page_views_ts_idx").on(t.ts),
}));

export type AnalyticsSession = typeof analyticsSessions.$inferSelect;
export type AnalyticsPageView = typeof analyticsPageViews.$inferSelect;

// ── League Activity Monitoring (Commissioner Command) ─────────────────────────
// Phase 1: scan Sleeper for transactions, rosters, users, and matchups; compute
// per-manager and league-wide activity / inactivity-risk scores; raise alerts so
// a commissioner can see at a glance which managers and leagues need attention.
// DECISION-SUPPORT only — never writes back to Sleeper or messages managers.
// See server/services/commissionerActivity/.

// One row per league/season/week scan summarizing league-wide activity.
export const commissionerActivitySnapshots = pgTable("commissioner_activity_snapshots", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  totalTransactions: integer("total_transactions").default(0),
  totalTrades: integer("total_trades").default(0),
  totalWaivers: integer("total_waivers").default(0),
  totalFreeAgentMoves: integer("total_free_agent_moves").default(0),
  totalLineupChanges: integer("total_lineup_changes").default(0),
  totalEmptyStarterSlots: integer("total_empty_starter_slots").default(0),

  activeManagerCount: integer("active_manager_count").default(0),
  inactiveManagerCount: integer("inactive_manager_count").default(0),

  leagueActivityScore: integer("league_activity_score").default(0),
  leagueActivityLabel: text("league_activity_label").default("unknown"),

  rawSummary: jsonb("raw_summary").default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: unique("commissioner_activity_snapshots_key").on(t.leagueId, t.season, t.week),
  leagueIdx: index("commissioner_activity_snapshots_league_idx").on(t.leagueId),
}));

// One row per manager (roster) per league/season/week.
export const commissionerManagerActivity = pgTable("commissioner_manager_activity", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  rosterId: integer("roster_id").notNull(),
  ownerId: text("owner_id"),
  managerName: text("manager_name"),
  teamName: text("team_name"),

  transactionsCount: integer("transactions_count").default(0),
  tradesCount: integer("trades_count").default(0),
  waiverCount: integer("waiver_count").default(0),
  freeAgentCount: integer("free_agent_count").default(0),
  addsCount: integer("adds_count").default(0),
  dropsCount: integer("drops_count").default(0),

  lineupChanged: boolean("lineup_changed").default(false),
  lineupChangeCount: integer("lineup_change_count").default(0),
  emptyStarterSlots: integer("empty_starter_slots").default(0),

  lastTransactionTs: bigint("last_transaction_ts", { mode: "number" }),
  lastLineupChangeTs: bigint("last_lineup_change_ts", { mode: "number" }),

  weeksSinceTransaction: integer("weeks_since_transaction"),
  weeksSinceLineupChange: integer("weeks_since_lineup_change"),

  activityScore: integer("activity_score").default(0),
  inactivityRiskScore: integer("inactivity_risk_score").default(0),
  activityLabel: text("activity_label").default("unknown"),

  flags: jsonb("flags").default(sql`'[]'::jsonb`),

  rawRoster: jsonb("raw_roster").default(sql`'{}'::jsonb`),
  rawMatchup: jsonb("raw_matchup").default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: unique("commissioner_manager_activity_key").on(t.leagueId, t.season, t.week, t.rosterId),
  leagueIdx: index("commissioner_manager_activity_league_idx").on(t.leagueId),
}));

// Detailed normalized activity events (trades, waivers, FA moves, lineup events).
export const commissionerActivityEvents = pgTable("commissioner_activity_events", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  rosterId: integer("roster_id"),
  ownerId: text("owner_id"),

  eventType: text("event_type").notNull(),
  eventTitle: text("event_title").notNull(),
  eventDescription: text("event_description"),

  transactionId: text("transaction_id"),
  relatedPlayerIds: jsonb("related_player_ids").default(sql`'[]'::jsonb`),
  relatedRosterIds: jsonb("related_roster_ids").default(sql`'[]'::jsonb`),

  eventTs: bigint("event_ts", { mode: "number" }),
  severity: text("severity").default("info"),

  rawEvent: jsonb("raw_event").default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  leagueWeekIdx: index("commissioner_activity_events_league_week_idx").on(t.leagueId, t.season, t.week),
  txnIdx: index("commissioner_activity_events_txn_idx").on(t.transactionId),
}));

// Unresolved (and historical) alerts for commissioner action.
export const commissionerActivityAlerts = pgTable("commissioner_activity_alerts", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week"),

  rosterId: integer("roster_id"),
  ownerId: text("owner_id"),

  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull(),

  title: text("title").notNull(),
  description: text("description").notNull(),

  // open | acknowledged | resolved | dismissed
  status: text("status").default("open"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  leagueIdx: index("commissioner_activity_alerts_league_idx").on(t.leagueId),
  statusIdx: index("commissioner_activity_alerts_status_idx").on(t.status),
  // One alert per (league, season, week, roster, alertType) so re-scans update
  // rather than duplicate.
  dedupe: unique("commissioner_activity_alerts_dedupe_key").on(
    t.leagueId, t.season, t.week, t.rosterId, t.alertType,
  ),
}));

// League-level activity thresholds (one row per league).
export const commissionerActivitySettings = pgTable("commissioner_activity_settings", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull().unique(),

  inactiveTransactionWeeks: integer("inactive_transaction_weeks").default(3),
  inactiveLineupWeeks: integer("inactive_lineup_weeks").default(2),
  unchangedLineupWeeks: integer("unchanged_lineup_weeks").default(2),

  flagEmptyStarters: boolean("flag_empty_starters").default(true),
  flagNoTransactions: boolean("flag_no_transactions").default(true),
  flagUnchangedLineups: boolean("flag_unchanged_lineups").default(true),
  flagLowLeagueActivity: boolean("flag_low_league_activity").default(true),

  lowActivityScoreThreshold: integer("low_activity_score_threshold").default(40),
  inactiveManagerScoreThreshold: integer("inactive_manager_score_threshold").default(60),

  ignoreLineupChecksInOffseason: boolean("ignore_lineup_checks_in_offseason").default(true),
  ignoreLineupChecksForBestBall: boolean("ignore_lineup_checks_for_best_ball").default(true),
  includeTradesInActivityScore: boolean("include_trades_in_activity_score").default(true),
  includeWaiversInActivityScore: boolean("include_waivers_in_activity_score").default(true),
  includeFreeAgentMovesInActivityScore: boolean("include_free_agent_moves_in_activity_score").default(true),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CommissionerActivitySnapshot = typeof commissionerActivitySnapshots.$inferSelect;
export type InsertCommissionerActivitySnapshot = typeof commissionerActivitySnapshots.$inferInsert;
export type CommissionerManagerActivity = typeof commissionerManagerActivity.$inferSelect;
export type InsertCommissionerManagerActivity = typeof commissionerManagerActivity.$inferInsert;
export type CommissionerActivityEvent = typeof commissionerActivityEvents.$inferSelect;
export type InsertCommissionerActivityEvent = typeof commissionerActivityEvents.$inferInsert;
export type CommissionerActivityAlert = typeof commissionerActivityAlerts.$inferSelect;
export type InsertCommissionerActivityAlert = typeof commissionerActivityAlerts.$inferInsert;
export type CommissionerActivitySettings = typeof commissionerActivitySettings.$inferSelect;
export type InsertCommissionerActivitySettings = typeof commissionerActivitySettings.$inferInsert;

// ── Trade Review Center (Commissioner decision-support) ───────────────────────
// Phase 1 of the Trade Review Center: ingest Sleeper trade transactions, store
// them locally, normalize the assets moved (players / picks / FAAB), score value
// + risk, raise review flags, and let a commissioner record review decisions and
// notes. This is a DECISION-SUPPORT system only — nothing here approves, rejects,
// reverses, or writes back to Sleeper. See server/services/commissionerTrades/.

// One row per Sleeper trade transaction (deduped on sleeperTransactionId).
export const commissionerTrades = pgTable("commissioner_trades", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  // Sleeper's transaction_id — the natural unique key used to ignore re-ingests.
  sleeperTransactionId: text("sleeper_transaction_id").notNull().unique(),
  season: text("season"),
  week: integer("week"),
  // Sleeper transaction status ("complete", etc).
  status: text("status"),
  type: text("type").default("trade"),
  // Sleeper epoch-millis timestamps (created / status_updated).
  createdTs: bigint("created_ts", { mode: "number" }),
  statusUpdatedTs: bigint("status_updated_ts", { mode: "number" }),
  // Roster ids involved + the roster ids that consented (Sleeper consenter_ids).
  rosterIds: jsonb("roster_ids").notNull().default(sql`'[]'::jsonb`),
  consenterIds: jsonb("consenter_ids").notNull().default(sql`'[]'::jsonb`),
  // The raw Sleeper transaction, kept verbatim for re-parsing / audit.
  rawTransaction: jsonb("raw_transaction").notNull(),
  // Computed value received by each roster, keyed by roster id (string).
  totalValueByRoster: jsonb("total_value_by_roster").notNull().default(sql`'{}'::jsonb`),
  valueDiffAbs: numeric("value_diff_abs").default("0"),
  valueDiffPct: numeric("value_diff_pct").default("0"),
  riskScore: integer("risk_score").default(0),
  fairnessScore: integer("fairness_score").default(100),
  // unreviewed | reviewed | watchlist | disputed | no_action
  reviewStatus: text("review_status").default("unreviewed"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  leagueIdx: index("commissioner_trades_league_idx").on(t.leagueId),
  reviewIdx: index("commissioner_trades_review_idx").on(t.reviewStatus),
}));

// One row per player / pick / FAAB asset moved within a trade.
export const commissionerTradeAssets = pgTable("commissioner_trade_assets", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id")
    .notNull()
    .references(() => commissionerTrades.id, { onDelete: "cascade" }),
  leagueId: text("league_id").notNull(),
  // player | pick | faab
  assetType: text("asset_type").notNull(),
  playerId: text("player_id"),
  playerName: text("player_name"),
  position: text("position"),
  team: text("team"),
  pickSeason: text("pick_season"),
  pickRound: integer("pick_round"),
  pickOriginalRosterId: integer("pick_original_roster_id"),
  faabAmount: numeric("faab_amount"),
  fromRosterId: integer("from_roster_id"),
  toRosterId: integer("to_roster_id"),
  assetValue: numeric("asset_value").default("0"),
  // Where the value came from: "fantasycalc" | "pick_table" | "faab" | "fallback"
  assetValueSource: text("asset_value_source"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tradeIdx: index("commissioner_trade_assets_trade_idx").on(t.tradeId),
}));

// Review flags raised for a trade (lopsided, future pick, repeat partner, etc).
export const commissionerTradeFlags = pgTable("commissioner_trade_flags", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id")
    .notNull()
    .references(() => commissionerTrades.id, { onDelete: "cascade" }),
  flagType: text("flag_type").notNull(),
  // info | low | medium | high | critical
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tradeIdx: index("commissioner_trade_flags_trade_idx").on(t.tradeId),
}));

// Audit log of commissioner review decisions + notes for a trade.
export const commissionerTradeReviews = pgTable("commissioner_trade_reviews", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id")
    .notNull()
    .references(() => commissionerTrades.id, { onDelete: "cascade" }),
  reviewerUserId: text("reviewer_user_id"),
  reviewStatus: text("review_status").notNull(),
  notes: text("notes"),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  tradeIdx: index("commissioner_trade_reviews_trade_idx").on(t.tradeId),
}));

// Aggregated manager-to-manager trade history. The pair is normalized so the
// lower roster id is always rosterIdA — one row per unordered pair per league.
export const commissionerManagerTradeStats = pgTable("commissioner_manager_trade_stats", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  rosterIdA: integer("roster_id_a").notNull(),
  rosterIdB: integer("roster_id_b").notNull(),
  tradeCount: integer("trade_count").default(0),
  lastTradeTs: bigint("last_trade_ts", { mode: "number" }),
  totalValueMoved: numeric("total_value_moved").default("0"),
  avgValueDiffPct: numeric("avg_value_diff_pct").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  pairUnique: unique("commissioner_manager_trade_stats_pair_key").on(t.leagueId, t.rosterIdA, t.rosterIdB),
}));

export type CommissionerTrade = typeof commissionerTrades.$inferSelect;
export type InsertCommissionerTrade = typeof commissionerTrades.$inferInsert;
export type CommissionerTradeAsset = typeof commissionerTradeAssets.$inferSelect;
export type CommissionerTradeFlag = typeof commissionerTradeFlags.$inferSelect;
export type CommissionerTradeReview = typeof commissionerTradeReviews.$inferSelect;
export type CommissionerManagerTradeStat = typeof commissionerManagerTradeStats.$inferSelect;

// ── Lineup Integrity & Anti-Tanking (Commissioner decision-support) ───────────
// Phase 1: scan weekly Sleeper matchups/rosters, detect empty/bye/inactive/IR
// starters and suspicious benchings, estimate an optimal lineup, score lineup
// integrity + tanking risk, raise alerts, and let a commissioner record notes,
// strikes, and decisions. DECISION-SUPPORT ONLY — nothing here changes lineups,
// messages managers, or alters standings. Neutral language by design: the
// system surfaces "potential signals", never accusations. See
// server/services/lineupIntegrity/.

// One lineup check per roster per week.
export const commissionerLineupChecks = pgTable("commissioner_lineup_checks", {
  id: serial("id").primaryKey(),

  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  rosterId: integer("roster_id").notNull(),
  ownerId: text("owner_id"),
  managerName: text("manager_name"),
  teamName: text("team_name"),

  starters: jsonb("starters").default(sql`'[]'::jsonb`),
  benchPlayers: jsonb("bench_players").default(sql`'[]'::jsonb`),
  allPlayers: jsonb("all_players").default(sql`'[]'::jsonb`),

  emptyStarterSlots: integer("empty_starter_slots").default(0),
  byeStarters: integer("bye_starters").default(0),
  inactiveStarters: integer("inactive_starters").default(0),
  irStarters: integer("ir_starters").default(0),
  doubtfulStarters: integer("doubtful_starters").default(0),
  questionableStarters: integer("questionable_starters").default(0),

  suspiciousBenchings: integer("suspicious_benchings").default(0),
  optimalityGap: numeric("optimality_gap").default("0"),
  optimalityGapPct: numeric("optimality_gap_pct").default("0"),

  projectedStarterPoints: numeric("projected_starter_points").default("0"),
  projectedOptimalPoints: numeric("projected_optimal_points").default("0"),

  lineupIntegrityScore: integer("lineup_integrity_score").default(100),
  tankingRiskScore: integer("tanking_risk_score").default(0),

  // low | medium | high | critical (tanking) — stored as a quick filter label.
  riskLabel: text("risk_label").default("low"),
  // none | needs_review | reviewed | warning_sent | strike_issued | dismissed | resolved
  reviewStatus: text("review_status").default("none"),

  flags: jsonb("flags").default(sql`'[]'::jsonb`),
  rawMatchup: jsonb("raw_matchup").default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  leagueWeekIdx: index("commissioner_lineup_checks_league_week_idx").on(t.leagueId, t.season, t.week),
  reviewIdx: index("commissioner_lineup_checks_review_idx").on(t.reviewStatus),
  rosterWeekUnique: unique("commissioner_lineup_checks_roster_week_key").on(t.leagueId, t.season, t.week, t.rosterId),
}));

// One row per evaluated starter/bench player within a lineup check.
export const commissionerLineupPlayerChecks = pgTable("commissioner_lineup_player_checks", {
  id: serial("id").primaryKey(),

  lineupCheckId: integer("lineup_check_id")
    .references(() => commissionerLineupChecks.id, { onDelete: "cascade" }),

  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  rosterId: integer("roster_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name"),
  position: text("position"),
  team: text("team"),

  lineupSlot: text("lineup_slot"),
  isStarter: boolean("is_starter").default(false),
  isBench: boolean("is_bench").default(false),

  injuryStatus: text("injury_status"),
  activeStatus: text("active_status"),
  isOnBye: boolean("is_on_bye").default(false),
  isInactive: boolean("is_inactive").default(false),
  isIr: boolean("is_ir").default(false),
  isDoubtful: boolean("is_doubtful").default(false),

  projection: numeric("projection").default("0"),
  playerValue: numeric("player_value").default("0"),
  rankScore: numeric("rank_score").default("0"),

  betterBenchOption: boolean("better_bench_option").default(false),
  betterBenchPlayerId: text("better_bench_player_id"),
  betterBenchPlayerName: text("better_bench_player_name"),
  valueGapVsBench: numeric("value_gap_vs_bench").default("0"),
  projectionGapVsBench: numeric("projection_gap_vs_bench").default("0"),

  flags: jsonb("flags").default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  checkIdx: index("commissioner_lineup_player_checks_check_idx").on(t.lineupCheckId),
}));

// Actionable alerts derived from lineup checks.
export const commissionerLineupAlerts = pgTable("commissioner_lineup_alerts", {
  id: serial("id").primaryKey(),

  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  lineupCheckId: integer("lineup_check_id")
    .references(() => commissionerLineupChecks.id, { onDelete: "cascade" }),

  rosterId: integer("roster_id").notNull(),
  ownerId: text("owner_id"),

  // empty_starter | bye_starter | inactive_starter | ir_starter | doubtful_starter
  // | suspicious_benching | large_optimality_gap | repeat_lineup_issue
  // | potential_tanking | playoff_integrity
  alertType: text("alert_type").notNull(),
  // info | low | medium | high | critical
  severity: text("severity").notNull(),

  title: text("title").notNull(),
  description: text("description").notNull(),

  suggestedAction: text("suggested_action"),

  // open | acknowledged | resolved | dismissed
  status: text("status").default("open"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  leagueWeekIdx: index("commissioner_lineup_alerts_league_week_idx").on(t.leagueId, t.season, t.week),
  statusIdx: index("commissioner_lineup_alerts_status_idx").on(t.status),
}));

// Official commissioner warnings / strikes issued to a manager.
export const commissionerLineupStrikes = pgTable("commissioner_lineup_strikes", {
  id: serial("id").primaryKey(),

  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),

  rosterId: integer("roster_id").notNull(),
  ownerId: text("owner_id"),
  managerName: text("manager_name"),
  teamName: text("team_name"),

  // empty_lineup | invalid_starter | repeat_issue | tanking_review | manual
  strikeType: text("strike_type").notNull(),
  // info | low | medium | high | critical
  severity: text("severity").notNull(),

  reason: text("reason").notNull(),
  evidence: jsonb("evidence").default(sql`'{}'::jsonb`),

  commissionerUserId: text("commissioner_user_id"),
  commissionerNotes: text("commissioner_notes"),

  // active | overturned | resolved | expired
  status: text("status").default("active"),

  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  leagueIdx: index("commissioner_lineup_strikes_league_idx").on(t.leagueId, t.season),
  rosterIdx: index("commissioner_lineup_strikes_roster_idx").on(t.leagueId, t.rosterId),
}));

// League-level lineup integrity rules / thresholds.
export const commissionerLineupSettings = pgTable("commissioner_lineup_settings", {
  id: serial("id").primaryKey(),

  leagueId: text("league_id").notNull().unique(),

  enableEmptySlotChecks: boolean("enable_empty_slot_checks").default(true),
  enableByeStarterChecks: boolean("enable_bye_starter_checks").default(true),
  // Legacy master toggle for OUT/IR/doubtful, kept for backward compatibility.
  // The three granular toggles below default to this when their own column is
  // unset, so a league that disabled the master still has them all off.
  enableInactiveStarterChecks: boolean("enable_inactive_starter_checks").default(true),
  enableOutStarterChecks: boolean("enable_out_starter_checks"),
  enableIrStarterChecks: boolean("enable_ir_starter_checks"),
  enableDoubtfulStarterChecks: boolean("enable_doubtful_starter_checks"),
  enableQuestionableStarterChecks: boolean("enable_questionable_starter_checks"),
  enableUnchangedLineupChecks: boolean("enable_unchanged_lineup_checks").default(false),
  enableSuspiciousBenchingChecks: boolean("enable_suspicious_benching_checks").default(true),
  enableTankingRiskChecks: boolean("enable_tanking_risk_checks").default(true),

  suspiciousBenchingValueGap: numeric("suspicious_benching_value_gap").default("1500"),
  suspiciousBenchingProjectionGap: numeric("suspicious_benching_projection_gap").default("6"),
  optimalityGapWarning: numeric("optimality_gap_warning").default("12"),
  optimalityGapCritical: numeric("optimality_gap_critical").default("25"),

  repeatIssueWeeks: integer("repeat_issue_weeks").default(2),
  strikeAfterRepeatIssues: integer("strike_after_repeat_issues").default(2),

  playoffIntegrityStartWeek: integer("playoff_integrity_start_week").default(10),

  ignoreLineupChecksInOffseason: boolean("ignore_lineup_checks_in_offseason").default(true),
  ignoreLineupChecksForBestBall: boolean("ignore_lineup_checks_for_best_ball").default(true),
  ignoreEliminatedTeams: boolean("ignore_eliminated_teams").default(false),

  autoCreateAlerts: boolean("auto_create_alerts").default(true),
  autoCreateStrikes: boolean("auto_create_strikes").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Commissioner action audit trail for lineup-integrity issues. One row per
// action taken (or system event) against a specific issue, so a commissioner
// has a defensible record if a manager later disputes a decision.
export const commissionerLineupAuditLog = pgTable("commissioner_lineup_audit_log", {
  id: serial("id").primaryKey(),

  leagueId: text("league_id").notNull(),
  season: text("season").notNull(),
  week: integer("week").notNull(),
  rosterId: integer("roster_id"),

  // Links back to the originating lineup check + (optionally) a specific
  // issue/alert so the audit log can be scoped to one issue in the drawer.
  lineupCheckId: integer("lineup_check_id"),
  // Stable client-side issue key (e.g. "checkId:slot:playerId") so multiple
  // distinct issues on the same team keep separate trails.
  issueKey: text("issue_key"),

  // Machine action: detected | message_copied | note_added | marked_resolved |
  // ignored_week | escalated | reopened
  action: text("action").notNull(),
  // "System" for automated events, otherwise the commissioner's display name.
  actor: text("actor").notNull().default("Commissioner"),
  actorUserId: text("actor_user_id"),
  note: text("note"),

  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  leagueWeekIdx: index("commissioner_lineup_audit_league_week_idx").on(t.leagueId, t.season, t.week),
  issueIdx: index("commissioner_lineup_audit_issue_idx").on(t.lineupCheckId),
}));

export type CommissionerLineupCheck = typeof commissionerLineupChecks.$inferSelect;
export type InsertCommissionerLineupCheck = typeof commissionerLineupChecks.$inferInsert;
export type CommissionerLineupAuditLog = typeof commissionerLineupAuditLog.$inferSelect;
export type InsertCommissionerLineupAuditLog = typeof commissionerLineupAuditLog.$inferInsert;
export type CommissionerLineupPlayerCheck = typeof commissionerLineupPlayerChecks.$inferSelect;
export type InsertCommissionerLineupPlayerCheck = typeof commissionerLineupPlayerChecks.$inferInsert;
export type CommissionerLineupAlert = typeof commissionerLineupAlerts.$inferSelect;
export type InsertCommissionerLineupAlert = typeof commissionerLineupAlerts.$inferInsert;
export type CommissionerLineupStrike = typeof commissionerLineupStrikes.$inferSelect;
export type InsertCommissionerLineupStrike = typeof commissionerLineupStrikes.$inferInsert;
export type CommissionerLineupSettings = typeof commissionerLineupSettings.$inferSelect;
export type InsertCommissionerLineupSettings = typeof commissionerLineupSettings.$inferInsert;

// ──────────────────────────────────────────────────────────────────────────────
// Dispersal Draft (Draft module → Dispersal Draft tab)
//
// A commissioner-run draft of orphan-team assets: create a room, add assets,
// share a private link, managers claim slots, and a live board updates in real
// time over Socket.io. Ported from a standalone app; tables are namespaced
// `dispersal_*` to avoid colliding with the existing `drafts` / `draft_picks`
// tables above. Auth is bridged to StatChasers accounts via `creatorUserId`
// while the original share-code + commissioner-token model is retained.
// ──────────────────────────────────────────────────────────────────────────────

export const dispersalRooms = pgTable("dispersal_rooms", {
  id: serial("id").primaryKey(),
  // StatChasers account that created the room (auth bridge). Null for legacy/
  // anonymous rooms; commissioner actions also accept the commissioner token.
  creatorUserId: varchar("creator_user_id"),
  leagueName: text("league_name").notNull(),
  shareCode: text("share_code").notNull().unique(),
  commissionerToken: text("commissioner_token").notNull(),
  numOrphanSlots: integer("num_orphan_slots").notNull(),
  draftFormat: text("draft_format").notNull().default("snake"),
  timeBankSeconds: integer("time_bank_seconds"),
  isLocked: boolean("is_locked").notNull().default(false),
  currentTurnStartedAt: timestamp("current_turn_started_at", { withTimezone: true }),
  dailyPauseStart: text("daily_pause_start"),
  dailyPauseEnd: text("daily_pause_end"),
  pauseTimezone: text("pause_timezone").default("America/New_York"),
  sleeperLeagueId: text("sleeper_league_id"),
  status: text("status").notNull().default("setup"),
  currentPickNumber: integer("current_pick_number").notNull().default(0),
  currentRound: integer("current_round").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dispersalParticipants = pgTable("dispersal_participants", {
  id: serial("id").primaryKey(),
  draftRoomId: integer("draft_room_id")
    .notNull()
    .references(() => dispersalRooms.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  isCommissioner: boolean("is_commissioner").notNull().default(false),
  draftPosition: integer("draft_position"),
  orphanTeamName: text("orphan_team_name"),
  sleeperAvatarId: text("sleeper_avatar_id"),
  timeBankRemainingSeconds: integer("time_bank_remaining_seconds"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dispersalAssets = pgTable("dispersal_assets", {
  id: serial("id").primaryKey(),
  draftRoomId: integer("draft_room_id")
    .notNull()
    .references(() => dispersalRooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  position: text("position"),
  team: text("team"),
  notes: text("notes"),
  isDrafted: boolean("is_drafted").notNull().default(false),
  draftedByParticipantId: integer("drafted_by_participant_id").references(
    () => dispersalParticipants.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dispersalPicks = pgTable("dispersal_picks", {
  id: serial("id").primaryKey(),
  draftRoomId: integer("draft_room_id")
    .notNull()
    .references(() => dispersalRooms.id, { onDelete: "cascade" }),
  participantId: integer("participant_id")
    .notNull()
    .references(() => dispersalParticipants.id),
  assetId: integer("asset_id")
    .notNull()
    .references(() => dispersalAssets.id),
  pickNumber: integer("pick_number").notNull(),
  round: integer("round").notNull(),
  pickedAt: timestamp("picked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dispersalChatMessages = pgTable("dispersal_chat_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id")
    .notNull()
    .references(() => dispersalRooms.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("user"),
  participantId: integer("participant_id").references(
    () => dispersalParticipants.id,
    { onDelete: "set null" },
  ),
  senderName: text("sender_name").notNull(),
  message: text("message").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  reactions: jsonb("reactions").$type<Record<string, number[]>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DispersalRoom = typeof dispersalRooms.$inferSelect;
export type InsertDispersalRoom = typeof dispersalRooms.$inferInsert;
export type DispersalParticipant = typeof dispersalParticipants.$inferSelect;
export type InsertDispersalParticipant = typeof dispersalParticipants.$inferInsert;
export type DispersalAsset = typeof dispersalAssets.$inferSelect;
export type InsertDispersalAsset = typeof dispersalAssets.$inferInsert;
export type DispersalPick = typeof dispersalPicks.$inferSelect;
export type InsertDispersalPick = typeof dispersalPicks.$inferInsert;
export type DispersalChatMessage = typeof dispersalChatMessages.$inferSelect;
export type InsertDispersalChatMessage = typeof dispersalChatMessages.$inferInsert;

// ─── League Profile: Rulebook / Bylaws ─────────────────────────────────────────
// One bylaw document per league. Sections + their notes/pins live in `sections`
// (jsonb) and each save snapshots the full sections array into `versionHistory`
// so the commissioner has an audit trail without a separate row per revision.
// Search and section ordering are handled client-side over `sections`.
export const leagueBylaws = pgTable("league_bylaws", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull().unique(),
  commissionerUserId: text("commissioner_user_id"),
  currentVersion: integer("current_version").notNull().default(1),
  // [{ sectionId, key, title, body, pinned, order, notes: [{id,text,author,createdAt}] }]
  sections: jsonb("sections").notNull().default(sql`'[]'::jsonb`),
  // [{ version, sections, savedBy, savedAt, note }]
  versionHistory: jsonb("version_history").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLeagueBylawsSchema = createInsertSchema(leagueBylaws).omit({ id: true, updatedAt: true });
export type InsertLeagueBylaws = z.infer<typeof insertLeagueBylawsSchema>;
export type LeagueBylaws = typeof leagueBylaws.$inferSelect;

// ─── League Profile: unified Commissioner Log ──────────────────────────────────
// Broader than commissionerLineupStrikes (which stays the system-of-record for
// lineup strikes). The Log view MERGES these manual entries with strike rows on
// the client. Categories/severities/statuses are free text validated at the API.
export const commissionerLog = pgTable("commissioner_log", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  season: text("season").notNull().default("2026"),

  rosterId: integer("roster_id"),
  ownerId: text("owner_id"),
  managerName: text("manager_name"),
  teamName: text("team_name"),

  // lineup_strike | payment_issue | inactivity_flag | trade_concern |
  // tanking_concern | behavior_issue | rule_violation | warning | manual_note
  category: text("category").notNull(),
  // info | warning | strike | serious | removal_risk
  severity: text("severity").notNull().default("info"),
  // open | watching | resolved | escalated
  status: text("status").notNull().default("open"),

  linkedRuleSectionId: text("linked_rule_section_id"),
  note: text("note"),
  resolution: text("resolution"),
  evidenceUrl: text("evidence_url"),
  // Free-form reference to a related activity event / trade id.
  activityRef: text("activity_ref"),

  commissionerUserId: text("commissioner_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  leagueIdx: index("commissioner_log_league_idx").on(t.leagueId, t.season),
  rosterIdx: index("commissioner_log_roster_idx").on(t.leagueId, t.rosterId),
}));

export const insertCommissionerLogSchema = createInsertSchema(commissionerLog).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommissionerLog = z.infer<typeof insertCommissionerLogSchema>;
export type CommissionerLog = typeof commissionerLog.$inferSelect;

// ─── League Profile: Draft pick notes / protections ────────────────────────────
// Lightweight per-pick annotations keyed by the pick's identity (original owner
// + season + round). Pick OWNERSHIP/movement comes from Sleeper + the existing
// commissionerTradeAssets table; this only stores commissioner notes.
export const leaguePickNotes = pgTable("league_pick_notes", {
  id: serial("id").primaryKey(),
  leagueId: text("league_id").notNull(),
  pickSeason: text("pick_season").notNull(),
  round: integer("round").notNull(),
  originalRosterId: integer("original_roster_id").notNull(),
  note: text("note"),
  protection: text("protection"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  pickUnique: unique("league_pick_notes_pick_unique").on(t.leagueId, t.pickSeason, t.round, t.originalRosterId),
}));

export const insertLeaguePickNoteSchema = createInsertSchema(leaguePickNotes).omit({ id: true, updatedAt: true });
export type InsertLeaguePickNote = z.infer<typeof insertLeaguePickNoteSchema>;
export type LeaguePickNote = typeof leaguePickNotes.$inferSelect;
