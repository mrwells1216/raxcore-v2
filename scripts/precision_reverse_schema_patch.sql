-- ============================================================================
-- SAFE PATCH: Precision Pass / Reverse Engineering Schema
-- Ensures all required tables exist for reverse_runs, hypothesis_candidates,
-- hypothesis_evaluations, error_decompositions
-- ============================================================================

-- First ensure profiles table has correct id type for FK references
-- The original profiles table uses TEXT id, so we reference as TEXT

-- Create reverse_runs table if not exists
CREATE TABLE IF NOT EXISTS public.reverse_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  buck_id UUID NULL REFERENCES public.bucks(id) ON DELETE SET NULL,
  
  -- Use TEXT for user_id to match profiles table
  requested_by_user_id TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'precision_pass' CHECK (mode IN ('precision_pass')),
  
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','cancelled')),
  
  -- Snapshots and configuration
  baseline_snapshot JSONB NULL,
  settings JSONB NULL,
  
  -- Outputs
  best_hypothesis_id UUID NULL,
  best_summary JSONB NULL,
  best_prediction_id UUID NULL REFERENCES public.predictions(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL
);

-- Indexes for reverse_runs
CREATE INDEX IF NOT EXISTS idx_reverse_runs_prediction_id ON public.reverse_runs(prediction_id);
CREATE INDEX IF NOT EXISTS idx_reverse_runs_status ON public.reverse_runs(status);
CREATE INDEX IF NOT EXISTS idx_reverse_runs_created_at ON public.reverse_runs(created_at DESC);

-- Hypothesis candidates table
CREATE TABLE IF NOT EXISTS public.hypothesis_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reverse_run_id UUID NOT NULL REFERENCES public.reverse_runs(id) ON DELETE CASCADE,
  
  hypothesis_rank INT NOT NULL DEFAULT 0,
  hypothesis_type TEXT NOT NULL
    CHECK (hypothesis_type IN ('noop','scale','spread','beam','tine','mass','deduction','swap_sides','combo')),
  
  params JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_candidates_run ON public.hypothesis_candidates(reverse_run_id);
CREATE INDEX IF NOT EXISTS idx_hypothesis_candidates_rank ON public.hypothesis_candidates(reverse_run_id, hypothesis_rank);

-- Hypothesis evaluations table
CREATE TABLE IF NOT EXISTS public.hypothesis_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES public.hypothesis_candidates(id) ON DELETE CASCADE,
  
  total_score NUMERIC(10,3) NOT NULL,
  geometry_score NUMERIC(10,3) NOT NULL,
  change_penalty NUMERIC(10,3) NOT NULL,
  plausibility_penalty NUMERIC(10,3) NOT NULL,
  
  predicted_gross NUMERIC(6,1) NULL,
  predicted_net NUMERIC(6,1) NULL,
  delta_gross NUMERIC(6,1) NULL,
  delta_net NUMERIC(6,1) NULL,
  est_error_band_width NUMERIC(6,2) NULL,
  
  flags JSONB NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_evals_candidate ON public.hypothesis_evaluations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_hypothesis_evals_score ON public.hypothesis_evaluations(total_score DESC);

-- Error decomposition table
CREATE TABLE IF NOT EXISTS public.error_decompositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reverse_run_id UUID NOT NULL REFERENCES public.reverse_runs(id) ON DELETE CASCADE,
  
  causes JSONB NOT NULL,
  primary_cause TEXT NULL,
  confirmed_causes JSONB NULL,
  confirmed_by TEXT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_decompositions_run ON public.error_decompositions(reverse_run_id);

-- Optional columns on predictions for precision pass linkage
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS is_precision_pass BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS precision_parent_prediction_id UUID NULL;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS reverse_run_id UUID NULL;

-- Enable RLS
ALTER TABLE public.reverse_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hypothesis_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hypothesis_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_decompositions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Allow all for reverse_runs" ON public.reverse_runs;
CREATE POLICY "Allow all for reverse_runs" ON public.reverse_runs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for hypothesis_candidates" ON public.hypothesis_candidates;
CREATE POLICY "Allow all for hypothesis_candidates" ON public.hypothesis_candidates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for hypothesis_evaluations" ON public.hypothesis_evaluations;
CREATE POLICY "Allow all for hypothesis_evaluations" ON public.hypothesis_evaluations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for error_decompositions" ON public.error_decompositions;
CREATE POLICY "Allow all for error_decompositions" ON public.error_decompositions FOR ALL USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON public.reverse_runs TO anon, authenticated, service_role;
GRANT ALL ON public.hypothesis_candidates TO anon, authenticated, service_role;
GRANT ALL ON public.hypothesis_evaluations TO anon, authenticated, service_role;
GRANT ALL ON public.error_decompositions TO anon, authenticated, service_role;
