-- Phase 47: Segment-Aware Confidence Intervals + Photo Guidance
-- Migration script to add schema support for confidence intervals, family-level uncertainty,
-- and photo recommendation tracking.

-- ============================================================================
-- 1. SEGMENT RESIDUAL PROFILES TABLE
-- Stores pre-computed error statistics per segment for confidence interval calculation
-- ============================================================================

CREATE TABLE IF NOT EXISTS segment_residual_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID REFERENCES calibration_segments(id) ON DELETE CASCADE,
  
  -- Sample statistics
  sample_count INTEGER NOT NULL DEFAULT 0,
  
  -- Gross error statistics
  avg_abs_gross_error NUMERIC(6,2),
  median_abs_gross_error NUMERIC(6,2),
  p25_gross_error NUMERIC(6,2),
  p75_gross_error NUMERIC(6,2),
  p90_gross_error NUMERIC(6,2),
  std_dev_gross NUMERIC(6,2),
  
  -- Net error statistics
  avg_abs_net_error NUMERIC(6,2),
  median_abs_net_error NUMERIC(6,2),
  p90_net_error NUMERIC(6,2),
  
  -- Family-level error data (JSONB for flexibility)
  family_errors JSONB DEFAULT '{}'::jsonb,
  -- Example: { "spread": { "avg": 1.5, "samples": 100 }, "beam": { "avg": 1.2, "samples": 95 } }
  
  -- Interval coverage metrics (how often actual falls within predicted band)
  interval_coverage_50 NUMERIC(5,2), -- % of actuals within 50% band
  interval_coverage_80 NUMERIC(5,2), -- % of actuals within 80% band
  interval_coverage_95 NUMERIC(5,2), -- % of actuals within 95% band
  
  -- Metadata
  computed_from_run_id UUID, -- validation run used
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segment_residual_profiles_segment 
  ON segment_residual_profiles(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_residual_profiles_computed 
  ON segment_residual_profiles(computed_at DESC);

-- ============================================================================
-- 2. ADD CONFIDENCE INTERVAL COLUMNS TO PREDICTIONS TABLE
-- ============================================================================

-- Add new columns for segment-aware confidence intervals
ALTER TABLE predictions 
  ADD COLUMN IF NOT EXISTS confidence_interval_metadata JSONB,
  ADD COLUMN IF NOT EXISTS family_uncertainty JSONB,
  ADD COLUMN IF NOT EXISTS photo_guidance_metadata JSONB,
  ADD COLUMN IF NOT EXISTS interval_profile_used TEXT,
  ADD COLUMN IF NOT EXISTS interval_profile_segment_id UUID,
  ADD COLUMN IF NOT EXISTS calibrated_confidence_tier TEXT,
  ADD COLUMN IF NOT EXISTS weakest_measurement_family TEXT,
  ADD COLUMN IF NOT EXISTS strongest_measurement_family TEXT,
  ADD COLUMN IF NOT EXISTS photo_recommendation_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_recommendation_shown BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS additional_photo_requested BOOLEAN DEFAULT FALSE;

-- Comment the columns
COMMENT ON COLUMN predictions.confidence_interval_metadata IS 'Phase 47: Full confidence interval calculation metadata';
COMMENT ON COLUMN predictions.family_uncertainty IS 'Phase 47: Per-measurement-family uncertainty scores';
COMMENT ON COLUMN predictions.photo_guidance_metadata IS 'Phase 47: Photo recommendation decision data';
COMMENT ON COLUMN predictions.interval_profile_used IS 'Phase 47: segment_specific, parent_fallback, or global_default';
COMMENT ON COLUMN predictions.calibrated_confidence_tier IS 'Phase 47: very_high, high, medium, low, very_low';
COMMENT ON COLUMN predictions.weakest_measurement_family IS 'Phase 47: spread, beam, tine, mass, or deduction';
COMMENT ON COLUMN predictions.photo_recommendation_type IS 'Phase 47: frontal_straight, left_side, etc.';

-- ============================================================================
-- 3. PHOTO GUIDANCE EVENTS TABLE
-- Tracks when photo recommendations were shown and user actions
-- ============================================================================

CREATE TABLE IF NOT EXISTS photo_guidance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Recommendation shown
  recommendation_type TEXT NOT NULL,
  recommended_angle TEXT,
  decision_policy TEXT NOT NULL, -- proceed_current_only, proceed_but_recommend, strongly_recommend
  expected_confidence_improvement INTEGER,
  estimated_benefit TEXT, -- high, medium, low, minimal
  
  -- Recommendation reasoning
  primary_reason TEXT,
  target_family TEXT,
  target_weakness TEXT,
  
  -- User response
  shown_at TIMESTAMPTZ DEFAULT NOW(),
  user_action TEXT, -- added_photo, dismissed, ignored
  user_action_at TIMESTAMPTZ,
  
  -- If they added a photo, did it help?
  post_photo_confidence INTEGER,
  actual_improvement INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_guidance_events_prediction 
  ON photo_guidance_events(prediction_id);
CREATE INDEX IF NOT EXISTS idx_photo_guidance_events_buck 
  ON photo_guidance_events(buck_id);
CREATE INDEX IF NOT EXISTS idx_photo_guidance_events_shown 
  ON photo_guidance_events(shown_at DESC);

-- ============================================================================
-- 4. CONFIDENCE INTERVAL VALIDATION TABLE
-- Tracks how well predicted intervals match actual outcomes
-- ============================================================================

CREATE TABLE IF NOT EXISTS confidence_interval_validation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id UUID,
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  training_example_id UUID,
  
  -- Predicted interval
  predicted_gross NUMERIC(6,2),
  predicted_band_low NUMERIC(6,2),
  predicted_band_high NUMERIC(6,2),
  predicted_band_width NUMERIC(6,2),
  calibrated_confidence_percent INTEGER,
  interval_profile_type TEXT,
  
  -- Actual outcome
  ground_truth_gross NUMERIC(6,2),
  actual_error NUMERIC(6,2),
  
  -- Interval accuracy
  within_band BOOLEAN,
  band_coverage_ratio NUMERIC(5,3), -- actual_error / (band_width/2), <1 means within band
  
  -- Family-level accuracy (if available)
  family_accuracy JSONB,
  
  -- Segment context
  segment_id UUID,
  segment_name TEXT,
  segment_sample_count INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ci_validation_run 
  ON confidence_interval_validation(validation_run_id);
CREATE INDEX IF NOT EXISTS idx_ci_validation_within 
  ON confidence_interval_validation(within_band);
CREATE INDEX IF NOT EXISTS idx_ci_validation_segment 
  ON confidence_interval_validation(segment_id);

-- ============================================================================
-- 5. ADD FAMILY-LEVEL METRICS TO SEGMENT_METRICS
-- ============================================================================

ALTER TABLE segment_metrics
  ADD COLUMN IF NOT EXISTS spread_avg_error NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS beam_avg_error NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS tine_avg_error NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS mass_avg_error NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS deduction_avg_error NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS interval_coverage_80 NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS interval_coverage_95 NUMERIC(5,2);

COMMENT ON COLUMN segment_metrics.spread_avg_error IS 'Phase 47: Average absolute error for spread measurements';
COMMENT ON COLUMN segment_metrics.interval_coverage_80 IS 'Phase 47: % of actuals within 80% confidence band';

-- ============================================================================
-- 6. ADD PHOTO GUIDANCE TRACKING TO VALIDATION RESULTS
-- ============================================================================

ALTER TABLE validation_results
  ADD COLUMN IF NOT EXISTS predicted_band_low NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS predicted_band_high NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS within_predicted_band BOOLEAN,
  ADD COLUMN IF NOT EXISTS calibrated_confidence_tier TEXT,
  ADD COLUMN IF NOT EXISTS weakest_family TEXT,
  ADD COLUMN IF NOT EXISTS photo_recommendation_type TEXT;

-- ============================================================================
-- 7. VIEW FOR INTERVAL CALIBRATION ANALYSIS
-- ============================================================================

CREATE OR REPLACE VIEW confidence_interval_calibration_summary AS
SELECT
  interval_profile_type,
  COALESCE(segment_name, 'Global') AS segment_name,
  COUNT(*) AS sample_count,
  ROUND(AVG(CASE WHEN within_band THEN 1 ELSE 0 END) * 100, 1) AS coverage_percent,
  ROUND(AVG(band_coverage_ratio), 3) AS avg_coverage_ratio,
  ROUND(AVG(predicted_band_width), 1) AS avg_band_width,
  ROUND(AVG(ABS(actual_error)), 1) AS avg_actual_error,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(actual_error)), 1) AS median_actual_error,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ABS(actual_error)), 1) AS p90_actual_error,
  COUNT(*) FILTER (WHERE calibrated_confidence_percent >= 70 AND NOT within_band) AS high_conf_misses,
  COUNT(*) FILTER (WHERE calibrated_confidence_percent < 50 AND within_band) AS low_conf_hits
FROM confidence_interval_validation
WHERE ground_truth_gross IS NOT NULL
GROUP BY interval_profile_type, segment_name
ORDER BY sample_count DESC;

-- ============================================================================
-- 8. VIEW FOR PHOTO GUIDANCE EFFECTIVENESS
-- ============================================================================

CREATE OR REPLACE VIEW photo_guidance_effectiveness AS
SELECT
  recommendation_type,
  decision_policy,
  target_family,
  COUNT(*) AS times_shown,
  COUNT(*) FILTER (WHERE user_action = 'added_photo') AS photos_added,
  COUNT(*) FILTER (WHERE user_action = 'dismissed') AS dismissed,
  ROUND(
    COUNT(*) FILTER (WHERE user_action = 'added_photo')::NUMERIC / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS acceptance_rate,
  ROUND(AVG(expected_confidence_improvement), 1) AS avg_expected_improvement,
  ROUND(AVG(actual_improvement) FILTER (WHERE actual_improvement IS NOT NULL), 1) AS avg_actual_improvement,
  ROUND(
    AVG(actual_improvement - expected_confidence_improvement) FILTER (WHERE actual_improvement IS NOT NULL), 1
  ) AS improvement_delta
FROM photo_guidance_events
GROUP BY recommendation_type, decision_policy, target_family
ORDER BY times_shown DESC;

-- ============================================================================
-- 9. FUNCTION TO COMPUTE SEGMENT RESIDUAL PROFILE
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_segment_residual_profile(
  p_segment_id UUID,
  p_validation_run_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_profile_id UUID;
  v_stats RECORD;
BEGIN
  -- Compute statistics from validation_results matching segment conditions
  WITH segment_results AS (
    SELECT 
      vr.abs_error_gross,
      vr.abs_error_net,
      vr.percent_error_gross
    FROM validation_results vr
    JOIN calibration_segments cs ON cs.id = p_segment_id
    WHERE 
      (p_validation_run_id IS NULL OR vr.run_id = p_validation_run_id)
      AND vr.abs_error_gross IS NOT NULL
      -- Match segment conditions (simplified - real impl would parse conditions)
    LIMIT 2000
  )
  SELECT 
    COUNT(*) AS sample_count,
    AVG(abs_error_gross) AS avg_abs_gross_error,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY abs_error_gross) AS median_abs_gross_error,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY abs_error_gross) AS p25_gross_error,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY abs_error_gross) AS p75_gross_error,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY abs_error_gross) AS p90_gross_error,
    STDDEV(abs_error_gross) AS std_dev_gross,
    AVG(abs_error_net) AS avg_abs_net_error
  INTO v_stats
  FROM segment_results;
  
  -- Insert or update profile
  INSERT INTO segment_residual_profiles (
    segment_id,
    sample_count,
    avg_abs_gross_error,
    median_abs_gross_error,
    p25_gross_error,
    p75_gross_error,
    p90_gross_error,
    std_dev_gross,
    avg_abs_net_error,
    computed_from_run_id,
    computed_at
  ) VALUES (
    p_segment_id,
    COALESCE(v_stats.sample_count, 0),
    v_stats.avg_abs_gross_error,
    v_stats.median_abs_gross_error,
    v_stats.p25_gross_error,
    v_stats.p75_gross_error,
    v_stats.p90_gross_error,
    v_stats.std_dev_gross,
    v_stats.avg_abs_net_error,
    p_validation_run_id,
    NOW()
  )
  ON CONFLICT (segment_id) DO UPDATE SET
    sample_count = EXCLUDED.sample_count,
    avg_abs_gross_error = EXCLUDED.avg_abs_gross_error,
    median_abs_gross_error = EXCLUDED.median_abs_gross_error,
    p25_gross_error = EXCLUDED.p25_gross_error,
    p75_gross_error = EXCLUDED.p75_gross_error,
    p90_gross_error = EXCLUDED.p90_gross_error,
    std_dev_gross = EXCLUDED.std_dev_gross,
    avg_abs_net_error = EXCLUDED.avg_abs_net_error,
    computed_from_run_id = EXCLUDED.computed_from_run_id,
    computed_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_profile_id;
  
  RETURN v_profile_id;
END;
$$ LANGUAGE plpgsql;

-- Add unique constraint for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'segment_residual_profiles_segment_unique'
  ) THEN
    ALTER TABLE segment_residual_profiles 
      ADD CONSTRAINT segment_residual_profiles_segment_unique UNIQUE (segment_id);
  END IF;
END $$;

-- ============================================================================
-- 10. TRIGGER TO UPDATE PREDICTIONS TIMESTAMP
-- ============================================================================

CREATE OR REPLACE FUNCTION update_predictions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'predictions_updated_at_trigger'
  ) THEN
    CREATE TRIGGER predictions_updated_at_trigger
      BEFORE UPDATE ON predictions
      FOR EACH ROW
      EXECUTE FUNCTION update_predictions_updated_at();
  END IF;
END $$;

-- Add updated_at column if missing
ALTER TABLE predictions 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
