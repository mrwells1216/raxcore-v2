-- Phase 30: Usage Tracking + Cost Controls + Release Readiness
-- Adds tables for tracking API usage, rate limiting, and release readiness checks

-- ============================================================================
-- USAGE TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Request identification
  request_id text NOT NULL,
  session_id text DEFAULT NULL,
  buck_id uuid REFERENCES bucks(id) ON DELETE SET NULL,
  prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,
  
  -- Endpoint and method
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  
  -- Client identification (for rate limiting)
  client_ip text DEFAULT NULL,
  client_fingerprint text DEFAULT NULL,
  user_agent text DEFAULT NULL,
  
  -- Usage metrics
  images_submitted integer NOT NULL DEFAULT 0,
  images_processed integer NOT NULL DEFAULT 0,
  vision_calls integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  used_fallback boolean NOT NULL DEFAULT FALSE,
  
  -- Timing
  request_start_at timestamptz NOT NULL DEFAULT now(),
  request_end_at timestamptz DEFAULT NULL,
  processing_time_ms integer DEFAULT NULL,
  vision_time_ms integer DEFAULT NULL,
  
  -- Status
  status text NOT NULL DEFAULT 'pending',
  error_type text DEFAULT NULL,
  error_message text DEFAULT NULL,
  
  -- Cost approximation (in millicents - 1/1000 of a cent)
  estimated_cost_mc integer DEFAULT 0,
  
  -- Model info
  model_version_id uuid REFERENCES model_versions(id) ON DELETE SET NULL,
  vision_model text DEFAULT NULL,
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_request_id ON usage_records(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_session_id ON usage_records(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_records_client_ip ON usage_records(client_ip) WHERE client_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_endpoint ON usage_records(endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_records_status ON usage_records(status);

COMMENT ON TABLE usage_records IS 'Detailed usage records for API requests, used for rate limiting and cost tracking';
COMMENT ON COLUMN usage_records.estimated_cost_mc IS 'Estimated cost in millicents (1/1000 cent). 100000 = $1.00';

-- ============================================================================
-- RATE LIMIT CONFIG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  config_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT FALSE,
  
  -- Per-minute limits
  requests_per_minute integer NOT NULL DEFAULT 10,
  images_per_minute integer NOT NULL DEFAULT 40,
  
  -- Per-hour limits
  requests_per_hour integer NOT NULL DEFAULT 100,
  images_per_hour integer NOT NULL DEFAULT 400,
  
  -- Per-day limits
  requests_per_day integer NOT NULL DEFAULT 500,
  images_per_day integer NOT NULL DEFAULT 2000,
  
  -- Monthly soft limits (warnings, not hard blocks)
  monthly_request_soft_limit integer DEFAULT 10000,
  monthly_image_soft_limit integer DEFAULT 40000,
  monthly_cost_soft_limit_cents integer DEFAULT 10000, -- $100 default
  
  -- Request-level limits
  max_images_per_request integer NOT NULL DEFAULT 6,
  max_retries_per_request integer NOT NULL DEFAULT 2,
  request_timeout_ms integer NOT NULL DEFAULT 60000,
  
  -- Burst protection
  burst_window_seconds integer NOT NULL DEFAULT 10,
  max_burst_requests integer NOT NULL DEFAULT 5,
  
  -- Duplicate protection
  duplicate_check_window_seconds integer NOT NULL DEFAULT 30,
  
  created_by text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default config
INSERT INTO rate_limit_config (config_name, is_active)
VALUES ('default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

COMMENT ON TABLE rate_limit_config IS 'Configurable rate limits for production safeguards';

-- ============================================================================
-- RATE LIMIT STATE TABLE (for tracking current usage windows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  client_key text NOT NULL,
  window_type text NOT NULL, -- 'minute', 'hour', 'day', 'month', 'burst'
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  
  -- Counts
  request_count integer NOT NULL DEFAULT 0,
  image_count integer NOT NULL DEFAULT 0,
  estimated_cost_mc integer NOT NULL DEFAULT 0,
  
  -- Tracking
  last_request_at timestamptz DEFAULT now(),
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE (client_key, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_state_client_key ON rate_limit_state(client_key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_window_end ON rate_limit_state(window_end);

-- Cleanup function for expired windows
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limit_windows()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_state WHERE window_end < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Atomic increment function for rate limit state
CREATE OR REPLACE FUNCTION increment_rate_limit_state(
  p_client_key text,
  p_window_type text,
  p_window_start timestamptz,
  p_request_count integer,
  p_image_count integer,
  p_cost_mc integer
) RETURNS rate_limit_state AS $$
DECLARE
  result rate_limit_state;
  window_end timestamptz;
BEGIN
  -- Calculate window end based on type
  CASE p_window_type
    WHEN 'minute' THEN window_end := p_window_start + INTERVAL '1 minute';
    WHEN 'hour' THEN window_end := p_window_start + INTERVAL '1 hour';
    WHEN 'day' THEN window_end := p_window_start + INTERVAL '1 day';
    WHEN 'month' THEN window_end := p_window_start + INTERVAL '1 month';
    ELSE window_end := p_window_start + INTERVAL '10 seconds'; -- burst
  END CASE;

  INSERT INTO rate_limit_state (
    client_key, window_type, window_start, window_end,
    request_count, image_count, estimated_cost_mc, last_request_at
  ) VALUES (
    p_client_key, p_window_type, p_window_start, window_end,
    p_request_count, p_image_count, p_cost_mc, NOW()
  )
  ON CONFLICT (client_key, window_type, window_start)
  DO UPDATE SET
    request_count = rate_limit_state.request_count + p_request_count,
    image_count = rate_limit_state.image_count + p_image_count,
    estimated_cost_mc = rate_limit_state.estimated_cost_mc + p_cost_mc,
    last_request_at = NOW(),
    updated_at = NOW()
  RETURNING * INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE rate_limit_state IS 'Tracks current rate limit windows for each client';

-- ============================================================================
-- COST ESTIMATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Model/provider info
  provider text NOT NULL,
  model text NOT NULL,
  
  -- Cost per operation (in millicents)
  cost_per_image_mc integer NOT NULL DEFAULT 0,
  cost_per_request_mc integer NOT NULL DEFAULT 0,
  cost_per_1k_tokens_input_mc integer NOT NULL DEFAULT 0,
  cost_per_1k_tokens_output_mc integer NOT NULL DEFAULT 0,
  
  -- Effective date range
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz DEFAULT NULL,
  
  is_active boolean NOT NULL DEFAULT TRUE,
  notes text DEFAULT NULL,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert Gemini 2.0 Flash cost estimate
INSERT INTO cost_estimates (provider, model, cost_per_image_mc, cost_per_request_mc, notes)
VALUES ('google', 'gemini-2.0-flash-001', 13, 5, 'Gemini 2.0 Flash vision - approx $0.00018 per image')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE cost_estimates IS 'Cost estimates for different vision models/providers';

-- ============================================================================
-- RELEASE READINESS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS release_readiness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What we're checking
  model_version_id uuid REFERENCES model_versions(id) ON DELETE SET NULL,
  calibration_profile_id uuid REFERENCES calibration_profiles(id) ON DELETE SET NULL,
  benchmark_run_id uuid REFERENCES benchmark_runs(id) ON DELETE SET NULL,
  
  -- Check results
  check_name text NOT NULL,
  check_category text NOT NULL, -- 'accuracy', 'runtime', 'calibration', 'data_quality', 'cost'
  check_passed boolean NOT NULL,
  check_value numeric DEFAULT NULL,
  check_threshold numeric DEFAULT NULL,
  check_details jsonb DEFAULT NULL,
  severity text NOT NULL DEFAULT 'info', -- 'info', 'warning', 'blocker'
  
  -- Context
  checked_at timestamptz DEFAULT now(),
  checked_by text DEFAULT NULL,
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_release_readiness_model ON release_readiness_checks(model_version_id);
CREATE INDEX IF NOT EXISTS idx_release_readiness_calibration ON release_readiness_checks(calibration_profile_id);
CREATE INDEX IF NOT EXISTS idx_release_readiness_category ON release_readiness_checks(check_category);
CREATE INDEX IF NOT EXISTS idx_release_readiness_checked_at ON release_readiness_checks(checked_at);

COMMENT ON TABLE release_readiness_checks IS 'Results of release readiness checks for model/calibration promotion';

-- ============================================================================
-- PRODUCTION CONFIG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  config_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT FALSE,
  
  -- Image limits
  max_images_per_request integer NOT NULL DEFAULT 6,
  min_images_per_request integer NOT NULL DEFAULT 1,
  
  -- Retry limits
  max_retries integer NOT NULL DEFAULT 2,
  retry_delay_base_ms integer NOT NULL DEFAULT 1000,
  retry_delay_max_ms integer NOT NULL DEFAULT 5000,
  
  -- Timeout limits
  total_timeout_ms integer NOT NULL DEFAULT 60000,
  single_call_timeout_ms integer NOT NULL DEFAULT 30000,
  
  -- Correction caps
  max_learning_correction_inches numeric(4,1) NOT NULL DEFAULT 8.0,
  max_measurement_correction_percent numeric(4,2) NOT NULL DEFAULT 0.15,
  
  -- Confidence bounds
  min_confidence_percent integer NOT NULL DEFAULT 15,
  max_confidence_percent integer NOT NULL DEFAULT 95,
  
  -- Error band bounds
  min_error_band_inches numeric(4,1) NOT NULL DEFAULT 3.0,
  max_error_band_inches numeric(4,1) NOT NULL DEFAULT 25.0,
  
  -- Fallback behavior
  fallback_enabled boolean NOT NULL DEFAULT TRUE,
  fallback_confidence_penalty numeric(4,1) NOT NULL DEFAULT 15.0,
  fallback_error_band_widening numeric(4,2) NOT NULL DEFAULT 1.3,
  
  -- Feature flags
  vision_scoring_enabled boolean NOT NULL DEFAULT TRUE,
  learning_correction_enabled boolean NOT NULL DEFAULT TRUE,
  two_pass_scoring_enabled boolean NOT NULL DEFAULT TRUE,
  
  created_by text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default production config
INSERT INTO production_config (config_name, is_active)
VALUES ('default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

COMMENT ON TABLE production_config IS 'Production safety configuration with bounded defaults';

-- ============================================================================
-- DAILY USAGE SUMMARY VIEW
-- ============================================================================

CREATE OR REPLACE VIEW daily_usage_summary AS
SELECT
  DATE_TRUNC('day', created_at) AS date,
  COUNT(*) AS total_requests,
  SUM(images_submitted) AS total_images_submitted,
  SUM(images_processed) AS total_images_processed,
  SUM(vision_calls) AS total_vision_calls,
  SUM(retry_count) AS total_retries,
  COUNT(*) FILTER (WHERE used_fallback) AS fallback_count,
  COUNT(*) FILTER (WHERE status = 'success') AS success_count,
  COUNT(*) FILTER (WHERE status = 'error') AS error_count,
  COUNT(*) FILTER (WHERE error_type = 'timeout') AS timeout_count,
  COUNT(*) FILTER (WHERE error_type = 'rate_limit') AS rate_limit_count,
  AVG(processing_time_ms) FILTER (WHERE processing_time_ms IS NOT NULL) AS avg_processing_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time_ms) 
    FILTER (WHERE processing_time_ms IS NOT NULL) AS p95_processing_ms,
  SUM(COALESCE(estimated_cost_mc, 0)) AS total_cost_mc,
  COUNT(DISTINCT client_ip) AS unique_clients
FROM usage_records
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

COMMENT ON VIEW daily_usage_summary IS 'Daily aggregated usage metrics for admin reporting';

-- ============================================================================
-- HOURLY USAGE SUMMARY VIEW
-- ============================================================================

CREATE OR REPLACE VIEW hourly_usage_summary AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS request_count,
  SUM(images_processed) AS image_count,
  SUM(vision_calls) AS vision_calls,
  COUNT(*) FILTER (WHERE used_fallback) AS fallback_count,
  SUM(COALESCE(estimated_cost_mc, 0)) AS cost_mc,
  AVG(processing_time_ms) FILTER (WHERE processing_time_ms IS NOT NULL) AS avg_processing_ms,
  COUNT(DISTINCT client_ip) AS unique_clients
FROM usage_records
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

COMMENT ON VIEW hourly_usage_summary IS 'Hourly usage for recent monitoring';

-- ============================================================================
-- MONTHLY COST SUMMARY VIEW
-- ============================================================================

CREATE OR REPLACE VIEW monthly_cost_summary AS
SELECT
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*) AS total_requests,
  SUM(images_processed) AS total_images,
  SUM(vision_calls) AS total_vision_calls,
  SUM(COALESCE(estimated_cost_mc, 0)) AS total_cost_mc,
  ROUND(SUM(COALESCE(estimated_cost_mc, 0))::numeric / 100, 2) AS total_cost_cents,
  ROUND(SUM(COALESCE(estimated_cost_mc, 0))::numeric / 100000, 2) AS total_cost_dollars,
  COUNT(DISTINCT client_ip) AS unique_clients
FROM usage_records
WHERE created_at >= NOW() - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

COMMENT ON VIEW monthly_cost_summary IS 'Monthly cost summary for budgeting';

-- ============================================================================
-- RELEASE READINESS SUMMARY VIEW
-- ============================================================================

CREATE OR REPLACE VIEW release_readiness_summary AS
SELECT
  rc.model_version_id,
  mv.version_name AS model_name,
  rc.calibration_profile_id,
  cp.name AS calibration_name,
  rc.benchmark_run_id,
  
  -- Check counts
  COUNT(*) AS total_checks,
  COUNT(*) FILTER (WHERE rc.check_passed) AS passed_checks,
  COUNT(*) FILTER (WHERE NOT rc.check_passed) AS failed_checks,
  COUNT(*) FILTER (WHERE NOT rc.check_passed AND rc.severity = 'blocker') AS blocker_count,
  COUNT(*) FILTER (WHERE NOT rc.check_passed AND rc.severity = 'warning') AS warning_count,
  
  -- Category breakdown
  COUNT(*) FILTER (WHERE rc.check_category = 'accuracy' AND NOT rc.check_passed) AS accuracy_failures,
  COUNT(*) FILTER (WHERE rc.check_category = 'runtime' AND NOT rc.check_passed) AS runtime_failures,
  COUNT(*) FILTER (WHERE rc.check_category = 'calibration' AND NOT rc.check_passed) AS calibration_failures,
  COUNT(*) FILTER (WHERE rc.check_category = 'data_quality' AND NOT rc.check_passed) AS data_quality_failures,
  COUNT(*) FILTER (WHERE rc.check_category = 'cost' AND NOT rc.check_passed) AS cost_failures,
  
  -- Overall status
  CASE
    WHEN COUNT(*) FILTER (WHERE NOT rc.check_passed AND rc.severity = 'blocker') > 0 THEN 'blocked'
    WHEN COUNT(*) FILTER (WHERE NOT rc.check_passed AND rc.severity = 'warning') > 0 THEN 'warnings'
    WHEN COUNT(*) FILTER (WHERE NOT rc.check_passed) > 0 THEN 'issues'
    ELSE 'ready'
  END AS status,
  
  MAX(rc.checked_at) AS last_checked_at

FROM release_readiness_checks rc
LEFT JOIN model_versions mv ON rc.model_version_id = mv.id
LEFT JOIN calibration_profiles cp ON rc.calibration_profile_id = cp.id
GROUP BY rc.model_version_id, mv.version_name, rc.calibration_profile_id, cp.name, rc.benchmark_run_id
ORDER BY MAX(rc.checked_at) DESC;

COMMENT ON VIEW release_readiness_summary IS 'Summary of release readiness status for model/calibration combinations';

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_usage_records_date_endpoint 
  ON usage_records (DATE_TRUNC('day', created_at), endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_records_client_date 
  ON usage_records (client_ip, DATE_TRUNC('hour', created_at)) 
  WHERE client_ip IS NOT NULL;
