-- League Activity Monitoring tables (Commissioner Command).
-- Idempotent: safe to run repeatedly. Column names match the drizzle
-- definitions in shared/schema.ts (snake_case). Run with:
--   node -e '...read+exec...'  or  psql "$DATABASE_URL" -f scripts/createActivityTables.sql
-- NOTE: the alerts dedupe key uses NULLS NOT DISTINCT (Postgres 15+) so the
-- single league-level alert per (season,week,type) upserts instead of dupes.

CREATE TABLE IF NOT EXISTS commissioner_activity_snapshots (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  total_transactions INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  total_waivers INTEGER DEFAULT 0,
  total_free_agent_moves INTEGER DEFAULT 0,
  total_lineup_changes INTEGER DEFAULT 0,
  total_empty_starter_slots INTEGER DEFAULT 0,
  active_manager_count INTEGER DEFAULT 0,
  inactive_manager_count INTEGER DEFAULT 0,
  league_activity_score INTEGER DEFAULT 0,
  league_activity_label TEXT DEFAULT 'unknown',
  raw_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT commissioner_activity_snapshots_key UNIQUE (league_id, season, week)
);
CREATE INDEX IF NOT EXISTS commissioner_activity_snapshots_league_idx
  ON commissioner_activity_snapshots (league_id);

CREATE TABLE IF NOT EXISTS commissioner_manager_activity (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  owner_id TEXT,
  manager_name TEXT,
  team_name TEXT,
  transactions_count INTEGER DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  waiver_count INTEGER DEFAULT 0,
  free_agent_count INTEGER DEFAULT 0,
  adds_count INTEGER DEFAULT 0,
  drops_count INTEGER DEFAULT 0,
  lineup_changed BOOLEAN DEFAULT FALSE,
  lineup_change_count INTEGER DEFAULT 0,
  empty_starter_slots INTEGER DEFAULT 0,
  last_transaction_ts BIGINT,
  last_lineup_change_ts BIGINT,
  weeks_since_transaction INTEGER,
  weeks_since_lineup_change INTEGER,
  activity_score INTEGER DEFAULT 0,
  inactivity_risk_score INTEGER DEFAULT 0,
  activity_label TEXT DEFAULT 'unknown',
  flags JSONB DEFAULT '[]'::jsonb,
  raw_roster JSONB DEFAULT '{}'::jsonb,
  raw_matchup JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT commissioner_manager_activity_key UNIQUE (league_id, season, week, roster_id)
);
CREATE INDEX IF NOT EXISTS commissioner_manager_activity_league_idx
  ON commissioner_manager_activity (league_id);

CREATE TABLE IF NOT EXISTS commissioner_activity_events (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER,
  owner_id TEXT,
  event_type TEXT NOT NULL,
  event_title TEXT NOT NULL,
  event_description TEXT,
  transaction_id TEXT,
  related_player_ids JSONB DEFAULT '[]'::jsonb,
  related_roster_ids JSONB DEFAULT '[]'::jsonb,
  event_ts BIGINT,
  severity TEXT DEFAULT 'info',
  raw_event JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_activity_events_league_week_idx
  ON commissioner_activity_events (league_id, season, week);
CREATE INDEX IF NOT EXISTS commissioner_activity_events_txn_idx
  ON commissioner_activity_events (transaction_id);

CREATE TABLE IF NOT EXISTS commissioner_activity_alerts (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER,
  roster_id INTEGER,
  owner_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  CONSTRAINT commissioner_activity_alerts_dedupe_key UNIQUE NULLS NOT DISTINCT
    (league_id, season, week, roster_id, alert_type)
);
CREATE INDEX IF NOT EXISTS commissioner_activity_alerts_league_idx
  ON commissioner_activity_alerts (league_id);
CREATE INDEX IF NOT EXISTS commissioner_activity_alerts_status_idx
  ON commissioner_activity_alerts (status);

CREATE TABLE IF NOT EXISTS commissioner_activity_settings (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL UNIQUE,
  inactive_transaction_weeks INTEGER DEFAULT 3,
  inactive_lineup_weeks INTEGER DEFAULT 2,
  unchanged_lineup_weeks INTEGER DEFAULT 2,
  flag_empty_starters BOOLEAN DEFAULT TRUE,
  flag_no_transactions BOOLEAN DEFAULT TRUE,
  flag_unchanged_lineups BOOLEAN DEFAULT TRUE,
  flag_low_league_activity BOOLEAN DEFAULT TRUE,
  low_activity_score_threshold INTEGER DEFAULT 40,
  inactive_manager_score_threshold INTEGER DEFAULT 60,
  ignore_lineup_checks_in_offseason BOOLEAN DEFAULT TRUE,
  ignore_lineup_checks_for_best_ball BOOLEAN DEFAULT TRUE,
  include_trades_in_activity_score BOOLEAN DEFAULT TRUE,
  include_waivers_in_activity_score BOOLEAN DEFAULT TRUE,
  include_free_agent_moves_in_activity_score BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
