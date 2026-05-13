-- ============================================================================
-- Script 055: Training Correction Layer (FIXED)
-- Phase 55: Enriched training_examples fields + correction_profiles table
--
-- Safe to run multiple times (all ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enrich training_examples with explicit scored-field columns
--    (Many of these were previously buried in JSONB or derived on the fly.)
-- ----------------------------------------------------------------------------

-- Link back to the prediction that produced the estimate
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES public.predictions(id) ON DELETE SET NULL;

-- Contextual metadata snapshot at time of prediction
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS rack_type TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS image_count INTEGER,
  ADD COLUMN IF NOT EXISTS confidence_label TEXT CHECK (confidence_label IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN DEFAULT false;

-- Predicted values at time of scoring (snapshot — never updated after creation)
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS predicted_gross NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_net NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_deductions NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_range_low NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_range_high NUMERIC(6,2);

-- Actual (ground-truth) values submitted by the user
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS actual_gross NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS actual_net NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS actual_deductions NUMERIC(6,2);

-- Signed error fields: actual - predicted (positive = AI underestimated)
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS error_gross NUMERIC(6,2)
    GENERATED ALWAYS AS (actual_gross - predicted_gross) STORED,
  ADD COLUMN IF NOT EXISTS error_net NUMERIC(6,2)
    GENERATED ALWAYS AS (actual_net - predicted_net) STORED,
  ADD COLUMN IF NOT EXISTS deduction_error NUMERIC(6,2)
    GENERATED ALWAYS AS (actual_deductions - predicted_deductions) STORED;

-- Absolute error (unsigned) for quick sorting/filtering
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS absolute_error NUMERIC(6,2)
    GENERATED ALWAYS AS (ABS(actual_gross - predicted_gross)) STORED;

-- Confidence bucket (0-25, 26-50, 51-75, 76-100) for profile grouping
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS confidence_bucket TEXT
    CHECK (confidence_bucket IN ('0-25', '26-50', '51-75', '76-100'));

-- Image count bucket for profile grouping
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS image_count_bucket TEXT
    CHECK (image_count_bucket IN ('1', '2', '3+'));

-- Indices for bucket lookups used by the correction engine
CREATE INDEX IF NOT EXISTS idx_te_state ON public.training_examples(state)
  WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_rack_type ON public.training_examples(rack_type)
  WHERE rack_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_source_type ON public.training_examples(source_type)
  WHERE source_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_image_count_bucket ON public.training_examples(image_count_bucket)
  WHERE image_count_bucket IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_fallback_used ON public.training_examples(fallback_used)
  WHERE fallback_used = true;
CREATE INDEX IF NOT EXISTS idx_te_confidence_bucket ON public.training_examples(confidence_bucket)
  WHERE confidence_bucket IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_te_prediction_id ON public.training_examples(prediction_id)
  WHERE prediction_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. correction_profiles table
--    Pre-computed bucket statistics used by the live correction engine.
--    Refreshed by a background job / admin action.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.correction_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bucket dimension columns (one or more will be non-null per profile)
  bucket_type TEXT NOT NULL
    CHECK (bucket_type IN ('state', 'rack_type', 'source_type', 'image_count', 'fallback_used', 'confidence_bucket')),
  bucket_value TEXT NOT NULL,

  -- Statistics over verified examples in this bucket
  example_count INTEGER NOT NULL DEFAULT 0,
  avg_error_gross NUMERIC(7,3),
  avg_error_net NUMERIC(7,3),
  avg_abs_error NUMERIC(7,3),
  overestimate_rate NUMERIC(5,4),   -- fraction of examples where predicted > actual
  underestimate_rate NUMERIC(5,4),  -- fraction of examples where predicted < actual
  std_dev_error NUMERIC(7,3),       -- standard deviation of error_gross

  -- Metadata
  min_examples_met BOOLEAN GENERATED ALWAYS AS (example_count >= 5) STORED,
  computed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Unique per bucket dimension + value
  UNIQUE (bucket_type, bucket_value)
);

CREATE INDEX IF NOT EXISTS idx_correction_profiles_bucket ON public.correction_profiles(bucket_type, bucket_value);
CREATE INDEX IF NOT EXISTS idx_correction_profiles_usable ON public.correction_profiles(bucket_type, example_count)
  WHERE example_count >= 5;

-- RLS: allow all (service role key used by API routes)
-- FIXED: PostgreSQL doesn't support CREATE POLICY IF NOT EXISTS
ALTER TABLE public.correction_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for correction_profiles" ON public.correction_profiles;
CREATE POLICY "Allow all for correction_profiles"
  ON public.correction_profiles FOR ALL USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 3. Refresh function: rebuild correction_profiles from current verified data
--    Call this from the admin refresh endpoint.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_correction_profiles()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Clear existing profiles
  DELETE FROM public.correction_profiles;

  -- Insert state-level profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'state',
    state,
    COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND(
      (COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4
    ),
    ROUND(
      (COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4
    ),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true
    AND error_gross IS NOT NULL
    AND state IS NOT NULL
  GROUP BY state;

  -- Insert rack_type profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'rack_type', rack_type, COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND((COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND((COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true AND error_gross IS NOT NULL AND rack_type IS NOT NULL
  GROUP BY rack_type;

  -- Insert source_type profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'source_type', source_type, COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND((COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND((COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true AND error_gross IS NOT NULL AND source_type IS NOT NULL
  GROUP BY source_type;

  -- Insert image_count bucket profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'image_count', image_count_bucket, COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND((COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND((COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true AND error_gross IS NOT NULL AND image_count_bucket IS NOT NULL
  GROUP BY image_count_bucket;

  -- Insert fallback_used profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'fallback_used',
    CASE WHEN fallback_used THEN 'true' ELSE 'false' END,
    COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND((COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND((COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true AND error_gross IS NOT NULL AND fallback_used IS NOT NULL
  GROUP BY fallback_used;

  -- Insert confidence_bucket profiles
  INSERT INTO public.correction_profiles (
    bucket_type, bucket_value, example_count,
    avg_error_gross, avg_error_net, avg_abs_error,
    overestimate_rate, underestimate_rate, std_dev_error, computed_at
  )
  SELECT
    'confidence_bucket', confidence_bucket, COUNT(*)::INTEGER,
    ROUND(AVG(error_gross)::NUMERIC, 3),
    ROUND(AVG(error_net)::NUMERIC, 3),
    ROUND(AVG(absolute_error)::NUMERIC, 3),
    ROUND((COUNT(*) FILTER (WHERE error_gross < 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND((COUNT(*) FILTER (WHERE error_gross > 0))::NUMERIC / NULLIF(COUNT(*), 0), 4),
    ROUND(STDDEV(error_gross)::NUMERIC, 3),
    now()
  FROM public.training_examples
  WHERE verified_for_training = true AND error_gross IS NOT NULL AND confidence_bucket IS NOT NULL
  GROUP BY confidence_bucket;
END;
$$;
