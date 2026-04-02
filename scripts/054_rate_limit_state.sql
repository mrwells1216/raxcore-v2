-- Phase 54: Add missing rate_limit_state table
-- Safe migration - uses IF NOT EXISTS throughout

-- ============================================================================
-- RATE LIMIT STATE TABLE
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

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE rate_limit_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access to rate_limit_state" ON rate_limit_state;
END $$;

CREATE POLICY "Service role has full access to rate_limit_state"
  ON rate_limit_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

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
  v_window_end timestamptz;
BEGIN
  -- Calculate window end based on type
  CASE p_window_type
    WHEN 'minute' THEN v_window_end := p_window_start + INTERVAL '1 minute';
    WHEN 'hour' THEN v_window_end := p_window_start + INTERVAL '1 hour';
    WHEN 'day' THEN v_window_end := p_window_start + INTERVAL '1 day';
    WHEN 'month' THEN v_window_end := p_window_start + INTERVAL '1 month';
    ELSE v_window_end := p_window_start + INTERVAL '10 seconds'; -- burst
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

COMMENT ON TABLE rate_limit_state IS 'Tracks current rate limit windows for each client';
