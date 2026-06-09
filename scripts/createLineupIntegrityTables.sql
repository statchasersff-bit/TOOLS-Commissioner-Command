-- Lineup Integrity & Anti-Tanking tables (Commissioner Command).
-- Idempotent: safe to run repeatedly. Column names match the drizzle
-- definitions in shared/schema.ts (snake_case).

CREATE TABLE IF NOT EXISTS commissioner_lineup_checks (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  owner_id TEXT,
  manager_name TEXT,
  team_name TEXT,
  starters JSONB DEFAULT '[]'::jsonb,
  bench_players JSONB DEFAULT '[]'::jsonb,
  all_players JSONB DEFAULT '[]'::jsonb,
  empty_starter_slots INTEGER DEFAULT 0,
  bye_starters INTEGER DEFAULT 0,
  inactive_starters INTEGER DEFAULT 0,
  ir_starters INTEGER DEFAULT 0,
  doubtful_starters INTEGER DEFAULT 0,
  suspicious_benchings INTEGER DEFAULT 0,
  optimality_gap NUMERIC DEFAULT 0,
  optimality_gap_pct NUMERIC DEFAULT 0,
  projected_starter_points NUMERIC DEFAULT 0,
  projected_optimal_points NUMERIC DEFAULT 0,
  lineup_integrity_score INTEGER DEFAULT 100,
  tanking_risk_score INTEGER DEFAULT 0,
  risk_label TEXT DEFAULT 'low',
  review_status TEXT DEFAULT 'none',
  flags JSONB DEFAULT '[]'::jsonb,
  raw_matchup JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT commissioner_lineup_checks_roster_week_key UNIQUE (league_id, season, week, roster_id)
);
CREATE INDEX IF NOT EXISTS commissioner_lineup_checks_league_week_idx
  ON commissioner_lineup_checks (league_id, season, week);
CREATE INDEX IF NOT EXISTS commissioner_lineup_checks_review_idx
  ON commissioner_lineup_checks (review_status);

CREATE TABLE IF NOT EXISTS commissioner_lineup_player_checks (
  id SERIAL PRIMARY KEY,
  lineup_check_id INTEGER REFERENCES commissioner_lineup_checks(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  team TEXT,
  lineup_slot TEXT,
  is_starter BOOLEAN DEFAULT FALSE,
  is_bench BOOLEAN DEFAULT FALSE,
  injury_status TEXT,
  active_status TEXT,
  is_on_bye BOOLEAN DEFAULT FALSE,
  is_inactive BOOLEAN DEFAULT FALSE,
  is_ir BOOLEAN DEFAULT FALSE,
  is_doubtful BOOLEAN DEFAULT FALSE,
  projection NUMERIC DEFAULT 0,
  player_value NUMERIC DEFAULT 0,
  rank_score NUMERIC DEFAULT 0,
  better_bench_option BOOLEAN DEFAULT FALSE,
  better_bench_player_id TEXT,
  better_bench_player_name TEXT,
  value_gap_vs_bench NUMERIC DEFAULT 0,
  projection_gap_vs_bench NUMERIC DEFAULT 0,
  flags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commissioner_lineup_player_checks_check_idx
  ON commissioner_lineup_player_checks (lineup_check_id);

CREATE TABLE IF NOT EXISTS commissioner_lineup_alerts (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  lineup_check_id INTEGER REFERENCES commissioner_lineup_checks(id) ON DELETE CASCADE,
  roster_id INTEGER NOT NULL,
  owner_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_action TEXT,
  status TEXT DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  acknowledged_at TIMESTAMP,
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS commissioner_lineup_alerts_league_week_idx
  ON commissioner_lineup_alerts (league_id, season, week);
CREATE INDEX IF NOT EXISTS commissioner_lineup_alerts_status_idx
  ON commissioner_lineup_alerts (status);

CREATE TABLE IF NOT EXISTS commissioner_lineup_strikes (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  owner_id TEXT,
  manager_name TEXT,
  team_name TEXT,
  strike_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB DEFAULT '{}'::jsonb,
  commissioner_user_id TEXT,
  commissioner_notes TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS commissioner_lineup_strikes_league_idx
  ON commissioner_lineup_strikes (league_id, season);
CREATE INDEX IF NOT EXISTS commissioner_lineup_strikes_roster_idx
  ON commissioner_lineup_strikes (league_id, roster_id);

CREATE TABLE IF NOT EXISTS commissioner_lineup_settings (
  id SERIAL PRIMARY KEY,
  league_id TEXT NOT NULL UNIQUE,
  enable_empty_slot_checks BOOLEAN DEFAULT TRUE,
  enable_bye_starter_checks BOOLEAN DEFAULT TRUE,
  enable_inactive_starter_checks BOOLEAN DEFAULT TRUE,
  enable_suspicious_benching_checks BOOLEAN DEFAULT TRUE,
  enable_tanking_risk_checks BOOLEAN DEFAULT TRUE,
  suspicious_benching_value_gap NUMERIC DEFAULT 1500,
  suspicious_benching_projection_gap NUMERIC DEFAULT 6,
  optimality_gap_warning NUMERIC DEFAULT 12,
  optimality_gap_critical NUMERIC DEFAULT 25,
  repeat_issue_weeks INTEGER DEFAULT 2,
  strike_after_repeat_issues INTEGER DEFAULT 2,
  playoff_integrity_start_week INTEGER DEFAULT 10,
  ignore_lineup_checks_in_offseason BOOLEAN DEFAULT TRUE,
  ignore_lineup_checks_for_best_ball BOOLEAN DEFAULT TRUE,
  auto_create_alerts BOOLEAN DEFAULT TRUE,
  auto_create_strikes BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
