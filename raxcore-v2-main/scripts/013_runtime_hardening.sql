-- Phase 24: Vision/Runtime Hardening + Fallback Reliability
-- Adds columns for tracking runtime metadata, fallback usage, and image validation

-- ============================================================================
-- PREDICTIONS TABLE UPDATES
-- ============================================================================

-- Runtime metadata
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS runtime_total_attempts integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS runtime_successful_attempt integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS runtime_total_time_ms integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS runtime_timed_out boolean DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS runtime_was_retried boolean DEFAULT FALSE;

-- Fallback metadata
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS used_fallback boolean DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS fallback_reason text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS fallback_strategy text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS fallback_confidence_penalty numeric(4,1) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS fallback_error_band_widening numeric(4,2) DEFAULT NULL;

-- Image validation
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS image_validation_valid boolean DEFAULT NULL,
ADD COLUMN IF NOT EXISTS image_validation_valid_count integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS image_validation_total_count integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS image_validation_issue_count integer DEFAULT NULL;

-- Full metadata JSONs (for detailed admin/debug)
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS fallback_metadata jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS runtime_metadata jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS image_validation_issues jsonb DEFAULT NULL;

COMMENT ON COLUMN predictions.used_fallback IS 'Whether fallback scoring was used instead of vision';
COMMENT ON COLUMN predictions.fallback_reason IS 'Reason for fallback (e.g., vision_timeout, vision_provider_error)';
COMMENT ON COLUMN predictions.fallback_strategy IS 'Strategy used for fallback (heuristic_full, heuristic_degraded, etc.)';
COMMENT ON COLUMN predictions.runtime_timed_out IS 'Whether the vision call timed out';

-- ============================================================================
-- RUNTIME ERROR LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS runtime_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,
  buck_id uuid REFERENCES bucks(id) ON DELETE SET NULL,
  
  -- Error classification
  error_type text NOT NULL,
  error_message text,
  retryable boolean DEFAULT FALSE,
  
  -- Attempt info
  attempt_number integer,
  total_attempts integer,
  
  -- Timing
  occurred_at timestamptz DEFAULT now(),
  time_ms integer,
  
  -- Context
  image_count integer,
  valid_image_count integer,
  source_type text,
  
  -- Resolution
  was_recovered boolean DEFAULT FALSE,
  fallback_used boolean DEFAULT FALSE,
  fallback_reason text,
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_error_log_error_type ON runtime_error_log(error_type);
CREATE INDEX IF NOT EXISTS idx_runtime_error_log_occurred_at ON runtime_error_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_runtime_error_log_prediction_id ON runtime_error_log(prediction_id);

COMMENT ON TABLE runtime_error_log IS 'Log of runtime errors during vision scoring for monitoring and debugging';

-- ============================================================================
-- IMAGE VALIDATION LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS image_validation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,
  buck_id uuid REFERENCES bucks(id) ON DELETE SET NULL,
  
  -- Validation summary
  total_images integer NOT NULL,
  valid_images integer NOT NULL,
  validation_passed boolean NOT NULL,
  
  -- Issue breakdown
  issue_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  warning_count integer DEFAULT 0,
  
  -- Common issues
  missing_url_count integer DEFAULT 0,
  invalid_url_count integer DEFAULT 0,
  inaccessible_url_count integer DEFAULT 0,
  unsupported_type_count integer DEFAULT 0,
  duplicate_count integer DEFAULT 0,
  expired_url_count integer DEFAULT 0,
  
  -- Full issues JSON
  issues jsonb DEFAULT NULL,
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_validation_log_validation_passed ON image_validation_log(validation_passed);
CREATE INDEX IF NOT EXISTS idx_image_validation_log_created_at ON image_validation_log(created_at);
CREATE INDEX IF NOT EXISTS idx_image_validation_log_prediction_id ON image_validation_log(prediction_id);

COMMENT ON TABLE image_validation_log IS 'Log of image validation results for monitoring image quality issues';

-- ============================================================================
-- RUNTIME HEALTH METRICS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW runtime_health_metrics AS
SELECT
  DATE_TRUNC('day', p.created_at) AS date,
  COUNT(*) AS total_predictions,
  COUNT(*) FILTER (WHERE p.scoring_method = 'vision' AND NOT COALESCE(p.used_fallback, FALSE)) AS vision_success_count,
  COUNT(*) FILTER (WHERE COALESCE(p.used_fallback, FALSE)) AS fallback_count,
  COUNT(*) FILTER (WHERE COALESCE(p.runtime_timed_out, FALSE)) AS timeout_count,
  COUNT(*) FILTER (WHERE COALESCE(p.runtime_was_retried, FALSE)) AS retry_count,
  
  -- Success rates
  ROUND(
    COUNT(*) FILTER (WHERE p.scoring_method = 'vision' AND NOT COALESCE(p.used_fallback, FALSE))::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS vision_success_rate,
  
  ROUND(
    COUNT(*) FILTER (WHERE COALESCE(p.used_fallback, FALSE))::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS fallback_rate,
  
  ROUND(
    COUNT(*) FILTER (WHERE COALESCE(p.runtime_timed_out, FALSE))::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS timeout_rate,
  
  -- Timing
  AVG(p.runtime_total_time_ms) FILTER (WHERE p.runtime_total_time_ms IS NOT NULL) AS avg_runtime_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p.runtime_total_time_ms) 
    FILTER (WHERE p.runtime_total_time_ms IS NOT NULL) AS p95_runtime_ms,
  
  -- Image validation
  AVG(p.image_validation_valid_count) FILTER (WHERE p.image_validation_valid_count IS NOT NULL) AS avg_valid_images,
  COUNT(*) FILTER (WHERE p.image_validation_valid = FALSE) AS image_validation_failures
  
FROM predictions p
WHERE p.created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', p.created_at)
ORDER BY date DESC;

COMMENT ON VIEW runtime_health_metrics IS 'Daily aggregated metrics for vision runtime health monitoring';

-- ============================================================================
-- FALLBACK REASON BREAKDOWN VIEW
-- ============================================================================

CREATE OR REPLACE VIEW fallback_reason_breakdown AS
SELECT
  p.fallback_reason,
  COUNT(*) AS count,
  ROUND(
    COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1
  ) AS percent_of_fallbacks,
  AVG(p.fallback_confidence_penalty) AS avg_confidence_penalty,
  AVG(p.fallback_error_band_widening) AS avg_error_widening,
  MIN(p.created_at) AS first_occurrence,
  MAX(p.created_at) AS last_occurrence
FROM predictions p
WHERE p.used_fallback = TRUE
  AND p.fallback_reason IS NOT NULL
  AND p.created_at >= NOW() - INTERVAL '30 days'
GROUP BY p.fallback_reason
ORDER BY count DESC;

COMMENT ON VIEW fallback_reason_breakdown IS 'Breakdown of fallback reasons for debugging provider issues';

-- ============================================================================
-- VALIDATION RESULTS UPDATES
-- ============================================================================

ALTER TABLE validation_results
ADD COLUMN IF NOT EXISTS used_fallback boolean DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS fallback_reason text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS runtime_timed_out boolean DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS runtime_total_time_ms integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS image_validation_issues_count integer DEFAULT NULL;

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_predictions_used_fallback ON predictions(used_fallback) WHERE used_fallback = TRUE;
CREATE INDEX IF NOT EXISTS idx_predictions_fallback_reason ON predictions(fallback_reason) WHERE fallback_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_runtime_timed_out ON predictions(runtime_timed_out) WHERE runtime_timed_out = TRUE;
CREATE INDEX IF NOT EXISTS idx_predictions_scoring_method ON predictions(scoring_method);
