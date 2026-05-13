-- Phase 50: Reverse-Engineering Precision Pass
-- Creates all tables needed for multi-hypothesis scoring refinement.
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ── 1. reverse_runs ───────────────────────────────────────────────────────────
-- One row per precision-pass invocation for a prediction.

CREATE TABLE IF NOT EXISTS reverse_runs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id           UUID NOT NULL,
  buck_id                 UUID,
  requested_by_user_id    TEXT,
  mode                    TEXT NOT NULL DEFAULT 'precision_pass',

  status                  TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','running','completed','failed','cancelled')),

  -- Snapshot of raw AI scores at the moment the run was created
  baseline_snapshot       JSONB,
  -- Operator-level settings overrides (null = use defaults)
  settings                JSONB,

  -- Result fields (populated on completion)
  best_hypothesis_id      UUID,        -- FK to hypothesis_candidates.id
  best_summary            JSONB,       -- { hypothesis_type, predicted_gross, … }
  best_prediction_id      UUID,        -- optional: points to an auto-generated prediction row

  requested_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  failure_reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_reverse_runs_prediction_id
  ON reverse_runs (prediction_id);

CREATE INDEX IF NOT EXISTS idx_reverse_runs_buck_id
  ON reverse_runs (buck_id);

CREATE INDEX IF NOT EXISTS idx_reverse_runs_status
  ON reverse_runs (status);

-- ── 2. hypothesis_candidates ──────────────────────────────────────────────────
-- Up to 28 candidate hypothesis transformations per run.

CREATE TABLE IF NOT EXISTS hypothesis_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reverse_run_id  UUID NOT NULL REFERENCES reverse_runs (id) ON DELETE CASCADE,
  hypothesis_rank INT  NOT NULL DEFAULT 0,
  hypothesis_type TEXT NOT NULL
                    CHECK (hypothesis_type = ANY(ARRAY[
                      'noop',
                      'scale_up','scale_down',
                      'spread_expand','spread_reduce',
                      'beam_extend','beam_reduce',
                      'tine_extend','tine_reduce',
                      'mass_boost','mass_reduce',
                      'symmetry_beam','symmetry_tine',
                      'deduction_reduce','deduction_increase',
                      'swap_sides','combo',
                      -- legacy compat names stored in older rows
                      'scale','spread','beam','tine','mass','deduction'
                    ]::TEXT[])),
  params          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_candidates_run
  ON hypothesis_candidates (reverse_run_id);

-- ── 3. hypothesis_evaluations ─────────────────────────────────────────────────
-- Scored result for each candidate.

CREATE TABLE IF NOT EXISTS hypothesis_evaluations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES hypothesis_candidates (id) ON DELETE CASCADE,

  -- Composite score used for ranking (higher = better)
  total_score           FLOAT,
  geometry_score        FLOAT,
  change_penalty        FLOAT,
  plausibility_penalty  FLOAT,

  -- Predicted B&C style scores under this hypothesis
  predicted_gross       FLOAT,
  predicted_net         FLOAT,

  -- Deltas from baseline
  delta_gross           FLOAT,
  delta_net             FLOAT,

  -- Optional: estimated error-band width for the corrected score
  est_error_band_width  FLOAT,

  -- Structured flags (e.g. spread_too_wide, extreme_change)
  flags                 JSONB,

  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_evaluations_candidate
  ON hypothesis_evaluations (candidate_id);

-- ── 4. error_decompositions ───────────────────────────────────────────────────
-- Root-cause breakdown of measurement uncertainty per run.

CREATE TABLE IF NOT EXISTS error_decompositions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reverse_run_id  UUID NOT NULL REFERENCES reverse_runs (id) ON DELETE CASCADE,

  -- Array of { cause, weight, evidence[] } objects
  causes          JSONB NOT NULL DEFAULT '[]',
  primary_cause   TEXT,

  -- Optional: human-confirmed subset (populated via admin HITL review)
  confirmed_causes  JSONB,
  confirmed_by      TEXT,
  confirmed_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_decompositions_run
  ON error_decompositions (reverse_run_id);

-- ── 5. reverse_jobs ───────────────────────────────────────────────────────────
-- Bridge table linking reverse_runs to durable_jobs entries.
-- Kept slim — the canonical job lives in durable_jobs.

CREATE TABLE IF NOT EXISTS reverse_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reverse_run_id  UUID NOT NULL REFERENCES reverse_runs (id) ON DELETE CASCADE,
  job_id          UUID,          -- references durable_jobs.id (no FK to allow opt-out)
  job_type        TEXT NOT NULL DEFAULT 'reverse_precision_pass',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reverse_jobs_run
  ON reverse_jobs (reverse_run_id);

-- ── 6. RLS ────────────────────────────────────────────────────────────────────
-- All five tables are service-role only (no direct user access).
-- Enable RLS but add no policies → only service role key can read/write.

ALTER TABLE reverse_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypothesis_candidates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypothesis_evaluations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_decompositions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reverse_jobs            ENABLE ROW LEVEL SECURITY;

-- Allow service-role bypass (Supabase service key always bypasses RLS)
-- No policies needed — service role skips RLS entirely.

DO $$
BEGIN
  RAISE NOTICE 'Phase 50 migration 096 applied: reverse_runs, hypothesis_candidates, hypothesis_evaluations, error_decompositions, reverse_jobs';
END $$;
