-- Phase 41: Segmented Calibration Tables
-- Migration for calibration_segments, calibration_values, segment_metrics, prediction_segment_log

-- ============================================================================
-- 1. CALIBRATION_SEGMENTS
-- Core segment definitions with hierarchical structure
-- ============================================================================

CREATE TABLE IF NOT EXISTS calibration_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES calibration_segments(id) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 5),
  segment_type TEXT NOT NULL DEFAULT 'general',
  conditions JSONB NOT NULL DEFAULT '{}',
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  stability_score NUMERIC(4,3) NOT NULL DEFAULT 0.0 CHECK (stability_score >= 0 AND stability_score <= 1),
  activation_weight NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (activation_weight >= 0 AND activation_weight <= 2),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for hierarchical queries
CREATE INDEX IF NOT EXISTS idx_calibration_segments_parent ON calibration_segments(parent_id);
CREATE INDEX IF NOT EXISTS idx_calibration_segments_level ON calibration_segments(level);
CREATE INDEX IF NOT EXISTS idx_calibration_segments_enabled ON calibration_segments(enabled);
CREATE INDEX IF NOT EXISTS idx_calibration_segments_type ON calibration_segments(segment_type);

-- ============================================================================
-- 2. CALIBRATION_VALUES
-- Per-segment, per-measurement-type calibration parameters
-- ============================================================================

CREATE TABLE IF NOT EXISTS calibration_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES calibration_segments(id) ON DELETE CASCADE,
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('spread', 'beam', 'tine', 'mass', 'deduction')),
  multiplier NUMERIC(6,4) NOT NULL DEFAULT 1.0 CHECK (multiplier >= 0.1 AND multiplier <= 3.0),
  bias NUMERIC(6,2) NOT NULL DEFAULT 0.0 CHECK (bias >= -20 AND bias <= 20),
  confidence_adjustment NUMERIC(5,2) NOT NULL DEFAULT 0.0 CHECK (confidence_adjustment >= -30 AND confidence_adjustment <= 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(segment_id, measurement_type)
);

-- Index for fast lookups by segment
CREATE INDEX IF NOT EXISTS idx_calibration_values_segment ON calibration_values(segment_id);

-- ============================================================================
-- 3. SEGMENT_METRICS
-- Rolling performance metrics per segment for data-quality gating
-- ============================================================================

CREATE TABLE IF NOT EXISTS segment_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES calibration_segments(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_gross_error NUMERIC(8,3),
  avg_abs_gross_error NUMERIC(8,3),
  avg_net_error NUMERIC(8,3),
  avg_abs_net_error NUMERIC(8,3),
  confidence_calib_error NUMERIC(6,3),
  regression_flagged BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for time-ordered metrics per segment
CREATE INDEX IF NOT EXISTS idx_segment_metrics_segment_time ON segment_metrics(segment_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_segment_metrics_evaluated ON segment_metrics(evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_segment_metrics_regression ON segment_metrics(regression_flagged) WHERE regression_flagged = true;

-- ============================================================================
-- 4. PREDICTION_SEGMENT_LOG
-- Audit log for which segments were used in each prediction
-- ============================================================================

CREATE TABLE IF NOT EXISTS prediction_segment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  buck_id UUID REFERENCES bucks(id) ON DELETE SET NULL,
  trace_id TEXT,
  segment_ids UUID[] NOT NULL DEFAULT '{}',
  blend_weights NUMERIC[] NOT NULL DEFAULT '{}',
  calibration_deltas JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookups by prediction/buck
CREATE INDEX IF NOT EXISTS idx_prediction_segment_log_prediction ON prediction_segment_log(prediction_id);
CREATE INDEX IF NOT EXISTS idx_prediction_segment_log_buck ON prediction_segment_log(buck_id);
CREATE INDEX IF NOT EXISTS idx_prediction_segment_log_created ON prediction_segment_log(created_at DESC);
-- GIN index for segment_ids array containment queries
CREATE INDEX IF NOT EXISTS idx_prediction_segment_log_segments ON prediction_segment_log USING GIN(segment_ids);

-- ============================================================================
-- 5. SEED GLOBAL SEGMENT
-- Every system needs a global (level 0) fallback segment with identity values
-- ============================================================================

INSERT INTO calibration_segments (
  name, 
  description, 
  parent_id, 
  level, 
  segment_type, 
  conditions, 
  sample_size, 
  stability_score, 
  activation_weight, 
  enabled
)
SELECT 
  'Global', 
  'Global fallback segment with identity calibration (multiplier=1, bias=0)', 
  NULL, 
  0, 
  'global', 
  '{}', 
  9999, 
  1.0, 
  1.0, 
  true
WHERE NOT EXISTS (
  SELECT 1 FROM calibration_segments WHERE level = 0 AND segment_type = 'global'
);

-- Insert identity calibration values for the global segment
INSERT INTO calibration_values (segment_id, measurement_type, multiplier, bias, confidence_adjustment)
SELECT 
  cs.id,
  mt.measurement_type,
  1.0,
  0.0,
  0.0
FROM calibration_segments cs
CROSS JOIN (
  VALUES ('spread'), ('beam'), ('tine'), ('mass'), ('deduction')
) AS mt(measurement_type)
WHERE cs.level = 0 AND cs.segment_type = 'global'
ON CONFLICT (segment_id, measurement_type) DO NOTHING;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- Admin-only write access, read access for authenticated users
-- ============================================================================

ALTER TABLE calibration_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_segment_log ENABLE ROW LEVEL SECURITY;

-- Read policies (all authenticated users can read)
CREATE POLICY "calibration_segments_select_authenticated" ON calibration_segments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "calibration_values_select_authenticated" ON calibration_values
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "segment_metrics_select_authenticated" ON segment_metrics
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prediction_segment_log_select_authenticated" ON prediction_segment_log
  FOR SELECT TO authenticated USING (true);

-- Write policies (require is_admin in profile)
-- For insert/update/delete, check if user is admin
CREATE POLICY "calibration_segments_insert_admin" ON calibration_segments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "calibration_segments_update_admin" ON calibration_segments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "calibration_segments_delete_admin" ON calibration_segments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "calibration_values_insert_admin" ON calibration_values
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "calibration_values_update_admin" ON calibration_values
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "calibration_values_delete_admin" ON calibration_values
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "segment_metrics_insert_admin" ON segment_metrics
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "segment_metrics_update_admin" ON segment_metrics
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "segment_metrics_delete_admin" ON segment_metrics
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- prediction_segment_log is insert-only from server (service role), read-only for users
CREATE POLICY "prediction_segment_log_insert_service" ON prediction_segment_log
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Allow authenticated users to insert (for server actions using user context)
CREATE POLICY "prediction_segment_log_insert_authenticated" ON prediction_segment_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 7. UPDATED_AT TRIGGER
-- Auto-update the updated_at timestamp on row changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calibration_segments_updated_at ON calibration_segments;
CREATE TRIGGER calibration_segments_updated_at
  BEFORE UPDATE ON calibration_segments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS calibration_values_updated_at ON calibration_values;
CREATE TRIGGER calibration_values_updated_at
  BEFORE UPDATE ON calibration_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
