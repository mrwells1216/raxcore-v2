-- Classroom (RAXam / RAXrs) — CLAUDE.md §3.30
-- Classroom scoring runs are saved as normal predictions but flagged so the UI
-- can mark them with an asterisk, and the feature toggles / variable overrides
-- used for the run are persisted for later review and learning analysis.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS is_classroom_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS experiment_config JSONB,
  ADD COLUMN IF NOT EXISTS features_used JSONB;

-- Optional learned multipliers on calibration profiles (additive bias already
-- exists). Multiplicative scale defaults to 1 so existing rows are unchanged.
ALTER TABLE public.calibration_profiles
  ADD COLUMN IF NOT EXISTS gross_multiplier NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS net_multiplier NUMERIC NOT NULL DEFAULT 1;
