-- Phase 48: Scoring Variants Sandbox + Shadow Scoring + Promotion Gates
-- Migration for scoring variant registry, shadow scoring, and offline evaluation

-- ============================================================================
-- SCORING VARIANTS REGISTRY
-- ============================================================================

-- The core variant registry - tracks all scoring configurations
CREATE TABLE IF NOT EXISTS scoring_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  version_tag TEXT NOT NULL,
  
  -- Variant type
  variant_type TEXT NOT NULL CHECK (variant_type IN ('model', 'pipeline', 'calibration', 'hybrid')),
  
  -- Status flags
  is_production BOOLEAN NOT NULL DEFAULT FALSE,
  is_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Linked entities (at least one required for non-pipeline variants)
  model_version_id UUID REFERENCES model_versions(id),
  calibration_profile_id UUID REFERENCES calibration_profiles(id),
  
  -- Pipeline configuration (JSON blob for flexibility)
  pipeline_config JSONB DEFAULT '{}',
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure unique version tags
  UNIQUE(version_tag)
);

-- Ensure only one production variant at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoring_variants_single_production 
  ON scoring_variants (is_production) WHERE is_production = TRUE;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_scoring_variants_status ON scoring_variants (is_production, is_candidate, is_archived);
CREATE INDEX IF NOT EXISTS idx_scoring_variants_type ON scoring_variants (variant_type);

-- ============================================================================
-- SHADOW SCORING RESULTS
-- ============================================================================

-- Stores shadow scoring results alongside production predictions
CREATE TABLE IF NOT EXISTS shadow_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to production prediction
  production_prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  production_variant_id UUID REFERENCES scoring_variants(id),
  
  -- Shadow variant that produced this
  shadow_variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Shadow prediction results
  predicted_gross NUMERIC(10,2),
  predicted_net NUMERIC(10,2),
  confidence_percent NUMERIC(5,2),
  error_band_low NUMERIC(10,2),
  error_band_high NUMERIC(10,2),
  
  -- Measurements (same structure as main predictions)
  measurements JSONB,
  
  -- Processing metadata
  processing_time_ms INTEGER,
  
  -- Difference from production
  gross_diff NUMERIC(10,2),
  net_diff NUMERIC(10,2),
  confidence_diff NUMERIC(5,2),
  
  -- Family-level differences (Phase 47 integration)
  spread_diff NUMERIC(10,2),
  beam_diff NUMERIC(10,2),
  tine_diff NUMERIC(10,2),
  mass_diff NUMERIC(10,2),
  
  -- Confidence interval differences (Phase 47)
  confidence_interval_summary JSONB,
  
  -- Geometry consistency (Phase 45)
  geometry_consistency_score NUMERIC(5,4),
  geometry_consistency_diff NUMERIC(5,4),
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_predictions_production ON shadow_predictions (production_prediction_id);
CREATE INDEX IF NOT EXISTS idx_shadow_predictions_variant ON shadow_predictions (shadow_variant_id);
CREATE INDEX IF NOT EXISTS idx_shadow_predictions_created ON shadow_predictions (created_at);

-- ============================================================================
-- OFFLINE EVALUATION RUNS
-- ============================================================================

-- Tracks offline evaluation runs against datasets
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What we're evaluating
  variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Dataset source
  dataset_type TEXT NOT NULL CHECK (dataset_type IN ('export_pack', 'benchmark_pack', 'custom')),
  export_pack_id UUID REFERENCES export_packs(id),
  benchmark_pack_id UUID REFERENCES benchmark_packs(id),
  
  -- Configuration
  config JSONB DEFAULT '{}',
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Progress
  total_examples INTEGER NOT NULL DEFAULT 0,
  processed_examples INTEGER NOT NULL DEFAULT 0,
  
  -- Overall metrics
  metrics JSONB,
  
  -- Family-level metrics (spread, beam, tine, mass)
  family_metrics JSONB,
  
  -- Segment-level breakdown
  segment_metrics JSONB,
  
  -- Confidence calibration metrics
  confidence_calibration JSONB,
  
  -- Interval coverage (Phase 47)
  interval_coverage JSONB,
  
  -- Geometry consistency correlation (Phase 45)
  geometry_consistency_metrics JSONB,
  
  -- Failure clusters
  failure_clusters JSONB,
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Link to durable job if async
  job_id UUID REFERENCES durable_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_variant ON evaluation_runs (variant_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_status ON evaluation_runs (status);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created ON evaluation_runs (created_at DESC);

-- Individual evaluation results (for reproducibility)
CREATE TABLE IF NOT EXISTS evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  
  -- Source example
  training_example_id UUID REFERENCES training_examples(id),
  buck_id UUID REFERENCES bucks(id),
  
  -- Ground truth
  ground_truth_gross NUMERIC(10,2),
  ground_truth_net NUMERIC(10,2),
  
  -- Prediction
  predicted_gross NUMERIC(10,2),
  predicted_net NUMERIC(10,2),
  confidence_percent NUMERIC(5,2),
  
  -- Errors
  error_gross NUMERIC(10,2),
  error_net NUMERIC(10,2),
  abs_error_gross NUMERIC(10,2),
  abs_error_net NUMERIC(10,2),
  
  -- Family-level errors
  spread_error NUMERIC(10,2),
  beam_error NUMERIC(10,2),
  tine_error NUMERIC(10,2),
  mass_error NUMERIC(10,2),
  
  -- Interval coverage
  within_interval BOOLEAN,
  interval_width NUMERIC(10,2),
  
  -- Geometry
  geometry_consistency_score NUMERIC(5,4),
  
  -- Segment info
  state TEXT,
  rack_type TEXT,
  source_type TEXT,
  segment_id TEXT,
  
  -- Processing
  processing_time_ms INTEGER,
  
  -- Full result snapshot for debugging
  result_snapshot JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_results_run ON evaluation_results (evaluation_run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_results_example ON evaluation_results (training_example_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_results_segment ON evaluation_results (state, rack_type, source_type);

-- ============================================================================
-- VARIANT COMPARISONS
-- ============================================================================

-- Structured comparison between production and candidate
CREATE TABLE IF NOT EXISTS variant_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The two variants being compared
  production_variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  candidate_variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Linked evaluation runs
  production_evaluation_run_id UUID REFERENCES evaluation_runs(id),
  candidate_evaluation_run_id UUID REFERENCES evaluation_runs(id),
  
  -- Comparison dataset
  dataset_type TEXT NOT NULL,
  export_pack_id UUID REFERENCES export_packs(id),
  benchmark_pack_id UUID REFERENCES benchmark_packs(id),
  
  -- Overall comparison metrics
  sample_count INTEGER NOT NULL DEFAULT 0,
  
  -- Error comparison
  production_mae_gross NUMERIC(10,4),
  candidate_mae_gross NUMERIC(10,4),
  mae_improvement NUMERIC(10,4),
  mae_improvement_percent NUMERIC(6,2),
  
  production_median_error NUMERIC(10,4),
  candidate_median_error NUMERIC(10,4),
  
  -- Tail error comparison (worst cases)
  production_p95_error NUMERIC(10,4),
  candidate_p95_error NUMERIC(10,4),
  p95_improvement NUMERIC(10,4),
  
  production_max_error NUMERIC(10,4),
  candidate_max_error NUMERIC(10,4),
  
  -- Confidence calibration comparison
  production_calibration_score NUMERIC(5,4),
  candidate_calibration_score NUMERIC(5,4),
  calibration_improvement NUMERIC(5,4),
  
  -- Interval coverage comparison
  production_interval_coverage NUMERIC(5,4),
  candidate_interval_coverage NUMERIC(5,4),
  interval_coverage_change NUMERIC(5,4),
  
  -- Geometry consistency comparison
  production_geometry_correlation NUMERIC(5,4),
  candidate_geometry_correlation NUMERIC(5,4),
  
  -- Win/loss/tie breakdown
  examples_improved INTEGER NOT NULL DEFAULT 0,
  examples_regressed INTEGER NOT NULL DEFAULT 0,
  examples_unchanged INTEGER NOT NULL DEFAULT 0,
  improvement_rate NUMERIC(5,4),
  
  -- Segment-level comparisons
  segment_comparisons JSONB,
  
  -- Family-level comparisons
  family_comparisons JSONB,
  
  -- Regression clusters
  regression_clusters JSONB,
  
  -- Improvement clusters
  improvement_clusters JSONB,
  
  -- Confidence in improvement
  confidence_in_improvement NUMERIC(5,4),
  improvement_confidence_tier TEXT CHECK (improvement_confidence_tier IN ('very_high', 'high', 'medium', 'low', 'very_low')),
  
  -- Promotion recommendation signal (NOT final decision)
  promotion_signal TEXT CHECK (promotion_signal IN ('strongly_recommend', 'recommend', 'neutral', 'caution', 'do_not_promote')),
  promotion_signal_reasons JSONB,
  
  -- Summary
  summary_text TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_comparisons_variants ON variant_comparisons (production_variant_id, candidate_variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_comparisons_created ON variant_comparisons (created_at DESC);

-- ============================================================================
-- PROMOTION GATES
-- ============================================================================

-- Promotion gate criteria definitions
CREATE TABLE IF NOT EXISTS promotion_gate_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Criteria type
  criteria_type TEXT NOT NULL CHECK (criteria_type IN ('hard_fail', 'soft_warning', 'informational')),
  
  -- Metric and threshold
  metric_name TEXT NOT NULL,
  comparison_operator TEXT NOT NULL CHECK (comparison_operator IN ('<=', '>=', '<', '>', '=', '!=')),
  threshold_value NUMERIC(10,4) NOT NULL,
  threshold_unit TEXT,
  
  -- Scope
  applies_to_segments JSONB, -- null = all segments
  applies_to_families JSONB, -- null = all families
  
  -- Active
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Ordering
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default promotion gate criteria
INSERT INTO promotion_gate_criteria (name, description, criteria_type, metric_name, comparison_operator, threshold_value, threshold_unit, sort_order)
VALUES
  ('MAE Regression', 'Candidate MAE must not be worse than production by more than 0.5 inches', 'hard_fail', 'mae_improvement', '>=', -0.5, 'inches', 1),
  ('P95 Error Regression', 'Candidate P95 error must not be worse than production by more than 2 inches', 'hard_fail', 'p95_improvement', '>=', -2.0, 'inches', 2),
  ('Confidence Calibration', 'Confidence calibration must not degrade by more than 5%', 'hard_fail', 'calibration_improvement', '>=', -0.05, 'ratio', 3),
  ('Interval Coverage', 'Interval coverage must not drop by more than 3%', 'hard_fail', 'interval_coverage_change', '>=', -0.03, 'ratio', 4),
  ('No Major Segment Regression', 'No segment should regress by more than 2 inches MAE', 'hard_fail', 'max_segment_regression', '<=', 2.0, 'inches', 5),
  ('Improvement Rate', 'At least 40% of examples should improve or stay same', 'soft_warning', 'improvement_rate', '>=', 0.4, 'ratio', 10),
  ('Tail Error Improvement', 'P95 error should ideally improve', 'soft_warning', 'p95_improvement', '>', 0, 'inches', 11),
  ('Overall MAE Improvement', 'Overall MAE should ideally improve', 'informational', 'mae_improvement', '>', 0, 'inches', 20)
ON CONFLICT DO NOTHING;

-- Promotion gate evaluations
CREATE TABLE IF NOT EXISTS promotion_gate_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What we're evaluating
  variant_comparison_id UUID NOT NULL REFERENCES variant_comparisons(id),
  candidate_variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Overall result
  overall_status TEXT NOT NULL CHECK (overall_status IN ('eligible', 'needs_review', 'rejected')),
  
  -- Individual gate results
  gate_results JSONB NOT NULL,
  
  -- Counts
  hard_fail_count INTEGER NOT NULL DEFAULT 0,
  soft_warning_count INTEGER NOT NULL DEFAULT 0,
  
  -- Summary
  status_reason TEXT,
  detailed_summary JSONB,
  
  -- Audit
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_by UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_gate_evaluations_comparison ON promotion_gate_evaluations (variant_comparison_id);
CREATE INDEX IF NOT EXISTS idx_promotion_gate_evaluations_candidate ON promotion_gate_evaluations (candidate_variant_id);
CREATE INDEX IF NOT EXISTS idx_promotion_gate_evaluations_status ON promotion_gate_evaluations (overall_status);

-- ============================================================================
-- VARIANT PROMOTION HISTORY
-- ============================================================================

-- Track all promotion decisions and actions
CREATE TABLE IF NOT EXISTS variant_promotion_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The variant being promoted or rejected
  variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Decision
  action TEXT NOT NULL CHECK (action IN ('promoted', 'rejected', 'rollback', 'archived')),
  
  -- Linked gate evaluation
  gate_evaluation_id UUID REFERENCES promotion_gate_evaluations(id),
  
  -- Previous production variant (for rollback reference)
  previous_production_variant_id UUID REFERENCES scoring_variants(id),
  
  -- Decision context
  decision_reason TEXT,
  decision_notes TEXT,
  
  -- Metrics at time of decision
  metrics_snapshot JSONB,
  
  -- Audit
  decided_by UUID REFERENCES profiles(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_promotion_history_variant ON variant_promotion_history (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_promotion_history_action ON variant_promotion_history (action);
CREATE INDEX IF NOT EXISTS idx_variant_promotion_history_decided ON variant_promotion_history (decided_at DESC);

-- ============================================================================
-- SHADOW SCORING CONFIGURATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS shadow_scoring_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Which candidate variant to shadow
  candidate_variant_id UUID NOT NULL REFERENCES scoring_variants(id),
  
  -- Sampling configuration
  sampling_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1 CHECK (sampling_rate >= 0 AND sampling_rate <= 1),
  
  -- Segment targeting (null = all segments)
  target_states JSONB,
  target_rack_types JSONB,
  target_source_types JSONB,
  
  -- Active
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Rate limits
  max_per_hour INTEGER DEFAULT 100,
  max_per_day INTEGER DEFAULT 1000,
  
  -- Counters
  shadow_count_today INTEGER NOT NULL DEFAULT 0,
  shadow_count_hour INTEGER NOT NULL DEFAULT 0,
  last_reset_hour TIMESTAMPTZ,
  last_reset_day TIMESTAMPTZ,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_scoring_config_enabled ON shadow_scoring_config (is_enabled) WHERE is_enabled = TRUE;

-- ============================================================================
-- ADD VARIANT TRACKING TO PREDICTIONS
-- ============================================================================

-- Add variant_id column to predictions table
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES scoring_variants(id);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS pipeline_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS config_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_predictions_variant ON predictions (variant_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get active production variant
CREATE OR REPLACE FUNCTION get_production_variant()
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM scoring_variants
  WHERE is_production = TRUE
  LIMIT 1;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to safely promote a variant
CREATE OR REPLACE FUNCTION promote_variant(
  p_variant_id UUID,
  p_decided_by UUID DEFAULT NULL,
  p_decision_reason TEXT DEFAULT NULL,
  p_gate_evaluation_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_previous_id UUID;
  v_result JSONB;
BEGIN
  -- Get current production variant
  SELECT id INTO v_previous_id
  FROM scoring_variants
  WHERE is_production = TRUE;
  
  -- Demote current production (if exists)
  IF v_previous_id IS NOT NULL THEN
    UPDATE scoring_variants
    SET is_production = FALSE,
        updated_at = NOW()
    WHERE id = v_previous_id;
  END IF;
  
  -- Promote new variant
  UPDATE scoring_variants
  SET is_production = TRUE,
      is_candidate = FALSE,
      updated_at = NOW()
  WHERE id = p_variant_id;
  
  -- Record history
  INSERT INTO variant_promotion_history (
    variant_id,
    action,
    gate_evaluation_id,
    previous_production_variant_id,
    decision_reason,
    decided_by,
    decided_at
  ) VALUES (
    p_variant_id,
    'promoted',
    p_gate_evaluation_id,
    v_previous_id,
    p_decision_reason,
    p_decided_by,
    NOW()
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'promoted_variant_id', p_variant_id,
    'previous_production_variant_id', v_previous_id
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to rollback to a previous variant
CREATE OR REPLACE FUNCTION rollback_variant(
  p_target_variant_id UUID,
  p_decided_by UUID DEFAULT NULL,
  p_decision_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_current_id UUID;
  v_result JSONB;
BEGIN
  -- Get current production variant
  SELECT id INTO v_current_id
  FROM scoring_variants
  WHERE is_production = TRUE;
  
  IF v_current_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No current production variant');
  END IF;
  
  IF v_current_id = p_target_variant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target is already production');
  END IF;
  
  -- Demote current
  UPDATE scoring_variants
  SET is_production = FALSE,
      updated_at = NOW()
  WHERE id = v_current_id;
  
  -- Restore target
  UPDATE scoring_variants
  SET is_production = TRUE,
      is_candidate = FALSE,
      is_archived = FALSE,
      updated_at = NOW()
  WHERE id = p_target_variant_id;
  
  -- Record rollback
  INSERT INTO variant_promotion_history (
    variant_id,
    action,
    previous_production_variant_id,
    decision_reason,
    decided_by,
    decided_at
  ) VALUES (
    p_target_variant_id,
    'rollback',
    v_current_id,
    p_decision_reason,
    p_decided_by,
    NOW()
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'rolled_back_to', p_target_variant_id,
    'rolled_back_from', v_current_id
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for variants with stats
CREATE OR REPLACE VIEW scoring_variants_with_stats AS
SELECT 
  sv.*,
  mv.version_name as model_version_name,
  cp.name as calibration_profile_name,
  (SELECT COUNT(*) FROM predictions WHERE variant_id = sv.id) as prediction_count,
  (SELECT COUNT(*) FROM shadow_predictions WHERE shadow_variant_id = sv.id) as shadow_prediction_count,
  (SELECT COUNT(*) FROM evaluation_runs WHERE variant_id = sv.id) as evaluation_run_count,
  (SELECT COUNT(*) FROM evaluation_runs WHERE variant_id = sv.id AND status = 'completed') as completed_evaluation_count
FROM scoring_variants sv
LEFT JOIN model_versions mv ON sv.model_version_id = mv.id
LEFT JOIN calibration_profiles cp ON sv.calibration_profile_id = cp.id;

-- View for recent comparisons with status
CREATE OR REPLACE VIEW recent_variant_comparisons AS
SELECT 
  vc.*,
  sv_prod.name as production_variant_name,
  sv_prod.version_tag as production_version_tag,
  sv_cand.name as candidate_variant_name,
  sv_cand.version_tag as candidate_version_tag,
  pge.overall_status as gate_status,
  pge.hard_fail_count,
  pge.soft_warning_count
FROM variant_comparisons vc
JOIN scoring_variants sv_prod ON vc.production_variant_id = sv_prod.id
JOIN scoring_variants sv_cand ON vc.candidate_variant_id = sv_cand.id
LEFT JOIN promotion_gate_evaluations pge ON pge.variant_comparison_id = vc.id
ORDER BY vc.created_at DESC;
