-- Trade Review Center (Commissioner decision-support) — Phase 1 tables.
-- Idempotent: safe to run repeatedly. Mirrors shared/schema.ts definitions.

CREATE TABLE IF NOT EXISTS commissioner_trades (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  sleeper_transaction_id TEXT NOT NULL UNIQUE,
  season TEXT,
  week INTEGER,
  status TEXT,
  type TEXT DEFAULT 'trade',
  created_ts BIGINT,
  status_updated_ts BIGINT,
  roster_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  consenter_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_transaction JSONB NOT NULL,
  total_value_by_roster JSONB NOT NULL DEFAULT '{}'::jsonb,
  value_diff_abs NUMERIC DEFAULT 0,
  value_diff_pct NUMERIC DEFAULT 0,
  risk_score INTEGER DEFAULT 0,
  fairness_score INTEGER DEFAULT 100,
  review_status TEXT DEFAULT 'unreviewed',
  summary TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_trades_league_idx ON commissioner_trades (league_id);
CREATE INDEX IF NOT EXISTS commissioner_trades_review_idx ON commissioner_trades (review_status);

CREATE TABLE IF NOT EXISTS commissioner_trade_assets (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES commissioner_trades(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  position TEXT,
  team TEXT,
  pick_season TEXT,
  pick_round INTEGER,
  pick_original_roster_id INTEGER,
  faab_amount NUMERIC,
  from_roster_id INTEGER,
  to_roster_id INTEGER,
  asset_value NUMERIC DEFAULT 0,
  asset_value_source TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_trade_assets_trade_idx ON commissioner_trade_assets (trade_id);

CREATE TABLE IF NOT EXISTS commissioner_trade_flags (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES commissioner_trades(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_trade_flags_trade_idx ON commissioner_trade_flags (trade_id);

CREATE TABLE IF NOT EXISTS commissioner_trade_reviews (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES commissioner_trades(id) ON DELETE CASCADE,
  reviewer_user_id TEXT,
  review_status TEXT NOT NULL,
  notes TEXT,
  decision_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_trade_reviews_trade_idx ON commissioner_trade_reviews (trade_id);

CREATE TABLE IF NOT EXISTS commissioner_manager_trade_stats (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  roster_id_a INTEGER NOT NULL,
  roster_id_b INTEGER NOT NULL,
  trade_count INTEGER DEFAULT 0,
  last_trade_ts BIGINT,
  total_value_moved NUMERIC DEFAULT 0,
  avg_value_diff_pct NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT commissioner_manager_trade_stats_pair_key UNIQUE (league_id, roster_id_a, roster_id_b)
);
