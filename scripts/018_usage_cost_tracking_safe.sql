-- Phase 30: Usage Tracking + Cost Controls + Release Readiness (SAFE VERSION)
-- Removes foreign key dependencies that may not exist yet

-- ============================================================================
-- USAGE TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  session_id text DEFAULT NULL,
  buck_id uuid DEFAULT NULL,
  prediction_id uuid DEFAULT NULL,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  client_ip text DEFAULT NULL,
  client_fingerprint text DEFAULT NULL,
  user_agent text DEFAULT NULL,
  images_submitted integer NOT NULL DEFAULT 0,
  images_processed integer NOT NULL DEFAULT 0,
  vision_calls integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  used_fallback boolean NOT NULL DEFAULT FALSE,
  request_start_at timestamptz NOT NULL DEFAULT now(),
  request_end_at timestamptz DEFAULT NULL,
  processing_time_ms integer DEFAULT NULL,
  vision_time_ms integer DEFAULT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_type text DEFAULT NULL,
  error_message text DEFAULT NULL,
  estimated_cost_mc integer DEFAULT 0,
  model_version_id uuid DEFAULT NULL,
  vision_model text DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_request_id ON usage_records(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_session_id ON usage_records(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_records_client_ip ON usage_records(client_ip) WHERE client_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_endpoint ON usage_records(endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_records_status ON usage_records(status);

-- ============================================================================
-- RATE LIMIT CONFIG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT FALSE,
  requests_per_minute integer NOT NULL DEFAULT 10,
  images_per_minute integer NOT NULL DEFAULT 40,
  requests_per_hour integer NOT NULL DEFAULT 100,
  images_per_hour integer NOT NULL DEFAULT 400,
  requests_per_day integer NOT NULL DEFAULT 500,
  images_per_day integer NOT NULL DEFAULT 2000,
  monthly_request_soft_limit integer DEFAULT 10000,
  monthly_image_soft_limit integer DEFAULT 40000,
  monthly_cost_soft_limit_cents integer DEFAULT 10000,
  max_images_per_request integer NOT NULL DEFAULT 6,
  max_retries_per_request integer NOT NULL DEFAULT 2,
  request_timeout_ms integer NOT NULL DEFAULT 60000,
  burst_window_seconds integer NOT NULL DEFAULT 10,
  max_burst_requests integer NOT NULL DEFAULT 5,
  duplicate_check_window_seconds integer NOT NULL DEFAULT 30,
  created_by text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO rate_limit_config (config_name, is_active)
VALUES ('default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

-- ============================================================================
-- RATE LIMIT STATE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  window_type text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  image_count integer NOT NULL DEFAULT 0,
  estimated_cost_mc integer NOT NULL DEFAULT 0,
  last_request_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_key, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_state_client_key ON rate_limit_state(client_key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_window_end ON rate_limit_state(window_end);

-- ============================================================================
-- RATE LIMIT FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_rate_limit_windows()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_state WHERE window_end < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

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
  v_window_end timestamptz;
BEGIN
  CASE p_window_type
    WHEN 'minute' THEN v_window_end := p_window_start + INTERVAL '1 minute';
    WHEN 'hour' THEN v_window_end := p_window_start + INTERVAL '1 hour';
    WHEN 'day' THEN v_window_end := p_window_start + INTERVAL '1 day';
    WHEN 'month' THEN v_window_end := p_window_start + INTERVAL '1 month';
    ELSE v_window_end := p_window_start + INTERVAL '10 seconds';
  END CASE;

  INSERT INTO rate_limit_state (
    client_key, window_type, window_start, window_end,
    request_count, image_count, estimated_cost_mc, last_request_at
  ) VALUES (
    p_client_key, p_window_type, p_window_start, v_window_end,
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

-- ============================================================================
-- COST ESTIMATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  cost_per_image_mc integer NOT NULL DEFAULT 0,
  cost_per_request_mc integer NOT NULL DEFAULT 0,
  cost_per_1k_tokens_input_mc integer NOT NULL DEFAULT 0,
  cost_per_1k_tokens_output_mc integer NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT TRUE,
  notes text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO cost_estimates (provider, model, cost_per_image_mc, cost_per_request_mc, notes)
VALUES ('google', 'gemini-2.0-flash-001', 13, 5, 'Gemini 2.0 Flash vision')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PRODUCTION CONFIG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT FALSE,
  max_images_per_request integer NOT NULL DEFAULT 6,
  min_images_per_request integer NOT NULL DEFAULT 1,
  max_retries integer NOT NULL DEFAULT 2,
  retry_delay_base_ms integer NOT NULL DEFAULT 1000,
  retry_delay_max_ms integer NOT NULL DEFAULT 5000,
  total_timeout_ms integer NOT NULL DEFAULT 60000,
  single_call_timeout_ms integer NOT NULL DEFAULT 30000,
  max_learning_correction_inches numeric(4,1) NOT NULL DEFAULT 8.0,
  max_measurement_correction_percent numeric(4,2) NOT NULL DEFAULT 0.15,
  min_confidence_percent integer NOT NULL DEFAULT 15,
  max_confidence_percent integer NOT NULL DEFAULT 95,
  min_error_band_inches numeric(4,1) NOT NULL DEFAULT 3.0,
  max_error_band_inches numeric(4,1) NOT NULL DEFAULT 25.0,
  fallback_enabled boolean NOT NULL DEFAULT TRUE,
  fallback_confidence_penalty numeric(4,1) NOT NULL DEFAULT 15.0,
  fallback_error_band_widening numeric(4,2) NOT NULL DEFAULT 1.3,
  vision_scoring_enabled boolean NOT NULL DEFAULT TRUE,
  learning_correction_enabled boolean NOT NULL DEFAULT TRUE,
  two_pass_scoring_enabled boolean NOT NULL DEFAULT TRUE,
  created_by text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO production_config (config_name, is_active)
VALUES ('default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access usage_records" ON usage_records; END $$;
CREATE POLICY "Service role full access usage_records" ON usage_records FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access rate_limit_config" ON rate_limit_config; END $$;
CREATE POLICY "Service role full access rate_limit_config" ON rate_limit_config FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access rate_limit_state" ON rate_limit_state; END $$;
CREATE POLICY "Service role full access rate_limit_state" ON rate_limit_state FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access cost_estimates" ON cost_estimates; END $$;
CREATE POLICY "Service role full access cost_estimates" ON cost_estimates FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access production_config" ON production_config; END $$;
CREATE POLICY "Service role full access production_config" ON production_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_usage_records_date_endpoint 
  ON usage_records (DATE_TRUNC('day', created_at), endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_records_client_date 
  ON usage_records (client_ip, DATE_TRUNC('hour', created_at)) 
  WHERE client_ip IS NOT NULL;
