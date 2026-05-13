-- Phase 23: Smart Second-Pass Scoring Schema Updates
-- Adds columns for two-pass scoring metadata to predictions, validation_results, and validation_runs

-- ============================================================================
-- PREDICTIONS TABLE
-- ============================================================================

-- Add two-pass metadata column
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS two_pass_metadata JSONB DEFAULT NULL;

-- Add quick-access columns for common queries
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS second_pass_ran BOOLEAN DEFAULT false;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS self_check_stability TEXT DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS self_check_stability_score NUMERIC(5,2) DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS final_selection_method TEXT DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS first_pass_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS second_pass_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS pass_difference NUMERIC(6,1) DEFAULT NULL;

-- Create index for second pass analysis
CREATE INDEX IF NOT EXISTS idx_predictions_second_pass_ran 
ON predictions(second_pass_ran) WHERE second_pass_ran = true;

CREATE INDEX IF NOT EXISTS idx_predictions_stability 
ON predictions(self_check_stability) WHERE self_check_stability IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_selection_method 
ON predictions(final_selection_method) WHERE final_selection_method IS NOT NULL;

-- ============================================================================
-- VALIDATION_RESULTS TABLE
-- ============================================================================

-- Add columns for tracking first vs second pass errors
ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS first_pass_predicted_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS first_pass_predicted_net NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS first_pass_error_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS first_pass_error_net NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_predicted_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_predicted_net NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_error_gross NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_error_net NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_ran BOOLEAN DEFAULT false;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS final_selection_method TEXT DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS second_pass_improved BOOLEAN DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS improvement_amount NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS self_check_stability TEXT DEFAULT NULL;

ALTER TABLE validation_results 
ADD COLUMN IF NOT EXISTS self_check_issues JSONB DEFAULT NULL;

-- Create indexes for second pass analysis
CREATE INDEX IF NOT EXISTS idx_validation_results_second_pass 
ON validation_results(second_pass_ran) WHERE second_pass_ran = true;

CREATE INDEX IF NOT EXISTS idx_validation_results_improved 
ON validation_results(second_pass_improved) WHERE second_pass_improved IS NOT NULL;

-- ============================================================================
-- VALIDATION_RUNS TABLE
-- ============================================================================

-- Add aggregate metrics for second pass performance
ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS first_pass_only_mae_gross NUMERIC(6,2) DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS with_second_pass_mae_gross NUMERIC(6,2) DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS second_pass_improvement NUMERIC(6,2) DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS second_pass_trigger_rate NUMERIC(5,2) DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS second_pass_selection_breakdown JSONB DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS second_pass_issue_breakdown JSONB DEFAULT NULL;

ALTER TABLE validation_runs 
ADD COLUMN IF NOT EXISTS stability_distribution JSONB DEFAULT NULL;

-- ============================================================================
-- TRAINING_EXAMPLES TABLE
-- ============================================================================

-- Add columns for tracking second pass training data
ALTER TABLE training_examples 
ADD COLUMN IF NOT EXISTS two_pass_metadata JSONB DEFAULT NULL;

ALTER TABLE training_examples 
ADD COLUMN IF NOT EXISTS first_pass_error NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE training_examples 
ADD COLUMN IF NOT EXISTS second_pass_error NUMERIC(6,1) DEFAULT NULL;

ALTER TABLE training_examples 
ADD COLUMN IF NOT EXISTS final_selection_method TEXT DEFAULT NULL;

ALTER TABLE training_examples 
ADD COLUMN IF NOT EXISTS second_pass_improved BOOLEAN DEFAULT NULL;

-- ============================================================================
-- SECOND_PASS_ANALYTICS TABLE (NEW)
-- ============================================================================

-- Create table for detailed second pass analytics
CREATE TABLE IF NOT EXISTS second_pass_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time window
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  window_type TEXT NOT NULL DEFAULT 'daily', -- 'hourly', 'daily', 'weekly'
  
  -- Volume metrics
  total_predictions INTEGER DEFAULT 0,
  second_pass_triggered INTEGER DEFAULT 0,
  trigger_rate NUMERIC(5,2) DEFAULT NULL,
  
  -- Error metrics
  first_pass_mae NUMERIC(6,2) DEFAULT NULL,
  with_second_pass_mae NUMERIC(6,2) DEFAULT NULL,
  mae_improvement NUMERIC(6,2) DEFAULT NULL,
  mae_improvement_percent NUMERIC(5,2) DEFAULT NULL,
  
  -- Selection breakdown
  first_pass_selections INTEGER DEFAULT 0,
  second_pass_selections INTEGER DEFAULT 0,
  blend_weighted_selections INTEGER DEFAULT 0,
  blend_conservative_selections INTEGER DEFAULT 0,
  
  -- Stability breakdown
  stable_count INTEGER DEFAULT 0,
  uncertain_count INTEGER DEFAULT 0,
  unstable_count INTEGER DEFAULT 0,
  
  -- Issue type frequency
  issue_type_counts JSONB DEFAULT NULL,
  
  -- Scenario analysis
  best_improvement_scenarios JSONB DEFAULT NULL,
  worst_improvement_scenarios JSONB DEFAULT NULL,
  
  -- Processing time
  avg_first_pass_time_ms NUMERIC(8,2) DEFAULT NULL,
  avg_second_pass_time_ms NUMERIC(8,2) DEFAULT NULL,
  avg_total_time_ms NUMERIC(8,2) DEFAULT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_second_pass_analytics_window 
ON second_pass_analytics(window_start, window_end);

CREATE INDEX IF NOT EXISTS idx_second_pass_analytics_type 
ON second_pass_analytics(window_type);

-- ============================================================================
-- SELF_CHECK_ISSUES TABLE (NEW)
-- ============================================================================

-- Create table for tracking self-check issue patterns
CREATE TABLE IF NOT EXISTS self_check_issue_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Issue details
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT,
  affected_measurements TEXT[],
  suggested_action TEXT,
  metadata JSONB DEFAULT NULL,
  
  -- Context
  state TEXT,
  rack_type TEXT,
  image_count INTEGER,
  angle_diversity NUMERIC(4,2),
  confidence_percent INTEGER,
  
  -- Outcome tracking
  second_pass_triggered BOOLEAN DEFAULT false,
  second_pass_improved BOOLEAN DEFAULT NULL,
  final_error_gross NUMERIC(6,1) DEFAULT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_self_check_issue_log_type 
ON self_check_issue_log(issue_type);

CREATE INDEX IF NOT EXISTS idx_self_check_issue_log_severity 
ON self_check_issue_log(severity);

CREATE INDEX IF NOT EXISTS idx_self_check_issue_log_prediction 
ON self_check_issue_log(prediction_id);

CREATE INDEX IF NOT EXISTS idx_self_check_issue_log_created 
ON self_check_issue_log(created_at);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN predictions.two_pass_metadata IS 'Phase 23: Full two-pass scoring metadata as JSONB';
COMMENT ON COLUMN predictions.second_pass_ran IS 'Phase 23: Whether second pass was triggered';
COMMENT ON COLUMN predictions.self_check_stability IS 'Phase 23: Self-check stability level (stable/uncertain/unstable)';
COMMENT ON COLUMN predictions.final_selection_method IS 'Phase 23: Final result selection method';

COMMENT ON COLUMN validation_results.first_pass_error_gross IS 'Phase 23: Error using first pass only';
COMMENT ON COLUMN validation_results.second_pass_error_gross IS 'Phase 23: Error using second pass only';
COMMENT ON COLUMN validation_results.second_pass_improved IS 'Phase 23: Whether second pass reduced error';

COMMENT ON TABLE second_pass_analytics IS 'Phase 23: Aggregated analytics for second-pass scoring performance';
COMMENT ON TABLE self_check_issue_log IS 'Phase 23: Log of self-check issues for pattern analysis';
