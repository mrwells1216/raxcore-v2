-- Phase 28: Training Influence Weighting + Safe Learning Boundaries
-- Adds influence weights, drift detection, and bounded correction tracking

-- ============================================================================
-- 1. INFLUENCE WEIGHT COLUMNS ON TRAINING_EXAMPLES
-- ============================================================================

-- Add influence weight columns to training_examples
ALTER TABLE training_examples
ADD COLUMN IF NOT EXISTS influence_weight DECIMAL(4,3) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS influence_factors JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS influence_computed_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS training_eligibility_reason TEXT DEFAULT NULL;

-- Index for influence weight queries
CREATE INDEX IF NOT EXISTS idx_training_examples_influence_weight 
ON training_examples(influence_weight) 
WHERE influence_weight IS NOT NULL;

-- Index for training-eligible examples with influence
CREATE INDEX IF NOT EXISTS idx_training_examples_eligible_influence 
ON training_examples(influence_weight, health_score) 
WHERE usable_for_training = true AND influence_weight > 0;

-- ============================================================================
-- 2. LEARNING CORRECTION LOG TABLE
-- ============================================================================

-- Track every learning correction applied for drift detection and debugging
CREATE TABLE IF NOT EXISTS learning_correction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Target buck being scored
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  
  -- Correction details
  gross_correction DECIMAL(5,2) NOT NULL,
  net_correction DECIMAL(5,2),
  confidence_boost DECIMAL(4,2),
  
  -- Aggregation method used
  aggregation_method TEXT NOT NULL DEFAULT 'weighted_mean',
  
  -- Safety caps applied
  pre_cap_gross_correction DECIMAL(5,2),
  cap_applied BOOLEAN DEFAULT FALSE,
  cap_reason TEXT,
  
  -- Examples that contributed
  contributing_examples_count INTEGER NOT NULL DEFAULT 0,
  highly_similar_count INTEGER DEFAULT 0,
  total_influence_weight DECIMAL(6,3),
  
  -- Similarity breakdown
  avg_similarity DECIMAL(4,3),
  max_similarity DECIMAL(4,3),
  min_similarity DECIMAL(4,3),
  
  -- Direction tracking for drift detection
  correction_direction TEXT CHECK (correction_direction IN ('increase', 'decrease', 'mixed', 'none')),
  
  -- Per-measurement corrections (for detailed analysis)
  measurement_corrections JSONB,
  
  -- Contributing example details (for admin visibility)
  influential_examples JSONB,
  
  -- Scenario context
  scenario_context JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for drift detection queries
CREATE INDEX IF NOT EXISTS idx_correction_log_direction 
ON learning_correction_log(correction_direction, created_at DESC);

-- Index for buck-specific correction history
CREATE INDEX IF NOT EXISTS idx_correction_log_buck 
ON learning_correction_log(buck_id, created_at DESC);

-- Index for time-based analysis
CREATE INDEX IF NOT EXISTS idx_correction_log_created 
ON learning_correction_log(created_at DESC);

-- ============================================================================
-- 3. DRIFT DETECTION TABLE
-- ============================================================================

-- Track detected drift patterns for safety
CREATE TABLE IF NOT EXISTS drift_detection_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Drift type and severity
  drift_type TEXT NOT NULL CHECK (drift_type IN (
    'directional_bias',      -- Consistently pushing in one direction
    'magnitude_drift',       -- Corrections getting larger over time
    'measurement_drift',     -- Specific measurement being overcorrected
    'scenario_drift',        -- Drift in specific scenarios
    'confidence_divergence'  -- Corrections diverging from vision confidence
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  -- Detection details
  detection_window_hours INTEGER NOT NULL,
  samples_analyzed INTEGER NOT NULL,
  
  -- Metrics
  drift_metrics JSONB NOT NULL,
  -- Example: {
  --   "positive_corrections": 45,
  --   "negative_corrections": 12,
  --   "bias_ratio": 3.75,
  --   "avg_correction_magnitude": 4.2,
  --   "affected_measurement": "inside_spread",
  --   "scenario": "trail_cam"
  -- }
  
  -- Actions taken
  action_taken TEXT CHECK (action_taken IN (
    'none',
    'reduced_learning_strength',
    'increased_evidence_threshold',
    'flagged_for_review',
    'temporarily_disabled'
  )),
  action_details JSONB,
  
  -- Status
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for unresolved drift alerts
CREATE INDEX IF NOT EXISTS idx_drift_detection_unresolved 
ON drift_detection_log(is_resolved, severity, detected_at DESC) 
WHERE is_resolved = false;

-- ============================================================================
-- 4. INFLUENCE CONFIGURATION TABLE
-- ============================================================================

-- Store influence weighting configuration (admin-editable)
CREATE TABLE IF NOT EXISTS influence_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT FALSE,
  
  -- Weight factors (how much each factor contributes to influence)
  weight_factors JSONB NOT NULL DEFAULT '{
    "health_score": 0.25,
    "verification_strength": 0.20,
    "image_quality": 0.15,
    "metadata_completeness": 0.10,
    "error_stability": 0.15,
    "similarity_bonus": 0.15
  }',
  
  -- Safety caps
  safety_caps JSONB NOT NULL DEFAULT '{
    "max_per_example_influence": 0.25,
    "max_total_correction_inches": 8.0,
    "max_per_measurement_correction_percent": 0.15,
    "min_examples_for_correction": 3,
    "min_total_influence_weight": 0.5
  }',
  
  -- Drift protection settings
  drift_protection JSONB NOT NULL DEFAULT '{
    "enabled": true,
    "directional_bias_threshold": 3.0,
    "magnitude_drift_threshold": 1.5,
    "detection_window_hours": 168,
    "min_samples_for_detection": 50,
    "auto_reduce_strength_on_drift": true,
    "strength_reduction_factor": 0.5
  }',
  
  -- Eligibility rules
  eligibility_rules JSONB NOT NULL DEFAULT '{
    "require_usable_for_training": true,
    "min_health_score": 30,
    "exclude_outliers": true,
    "exclude_duplicates": true,
    "low_quality_weight_multiplier": 0.3
  }',
  
  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO influence_config (config_name, is_active) 
VALUES ('default', true)
ON CONFLICT (config_name) DO NOTHING;

-- Ensure only one active config
CREATE UNIQUE INDEX IF NOT EXISTS idx_influence_config_active 
ON influence_config(is_active) WHERE is_active = true;

-- ============================================================================
-- 5. CORRECTION CONTRIBUTION TRACKING
-- ============================================================================

-- Track which examples contributed to each correction (for explainability)
CREATE TABLE IF NOT EXISTS correction_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Links
  correction_log_id UUID NOT NULL REFERENCES learning_correction_log(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL REFERENCES training_examples(id) ON DELETE CASCADE,
  
  -- Contribution details
  similarity_score DECIMAL(4,3) NOT NULL,
  influence_weight DECIMAL(4,3) NOT NULL,
  effective_weight DECIMAL(4,3) NOT NULL, -- similarity * influence
  
  -- What this example contributed
  error_contribution DECIMAL(5,2) NOT NULL, -- The error value this example pushed toward
  weighted_contribution DECIMAL(5,2) NOT NULL, -- error * effective_weight
  
  -- Similarity breakdown
  similarity_factors JSONB,
  -- Example: {
  --   "state_match": true,
  --   "rack_type_match": true,
  --   "frame_size_similarity": 0.9,
  --   "source_type_match": false,
  --   "image_count_similarity": 0.8
  -- }
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding contributions by example
CREATE INDEX IF NOT EXISTS idx_correction_contributions_example 
ON correction_contributions(training_example_id);

-- Index for finding contributions by correction
CREATE INDEX IF NOT EXISTS idx_correction_contributions_log 
ON correction_contributions(correction_log_id);

-- ============================================================================
-- 6. VIEWS FOR ADMIN VISIBILITY
-- ============================================================================

-- View: Recent corrections with details
CREATE OR REPLACE VIEW v_recent_corrections AS
SELECT 
  lcl.id,
  lcl.buck_id,
  b.name as buck_name,
  lcl.gross_correction,
  lcl.net_correction,
  lcl.correction_direction,
  lcl.contributing_examples_count,
  lcl.avg_similarity,
  lcl.total_influence_weight,
  lcl.cap_applied,
  lcl.cap_reason,
  lcl.created_at,
  lcl.influential_examples
FROM learning_correction_log lcl
LEFT JOIN bucks b ON lcl.buck_id = b.id
ORDER BY lcl.created_at DESC;

-- View: Drift detection summary
CREATE OR REPLACE VIEW v_drift_summary AS
SELECT 
  drift_type,
  severity,
  COUNT(*) as occurrence_count,
  COUNT(*) FILTER (WHERE is_resolved = false) as unresolved_count,
  MAX(detected_at) as last_detected,
  jsonb_agg(DISTINCT action_taken) FILTER (WHERE action_taken IS NOT NULL) as actions_taken
FROM drift_detection_log
WHERE detected_at > NOW() - INTERVAL '30 days'
GROUP BY drift_type, severity
ORDER BY unresolved_count DESC, severity DESC;

-- View: Example influence summary
CREATE OR REPLACE VIEW v_example_influence_summary AS
SELECT 
  te.id as training_example_id,
  te.influence_weight,
  te.health_score,
  te.health_tier,
  te.usable_for_training,
  te.verified_for_training,
  gt.score_source,
  b.state,
  b.rack_type,
  COUNT(cc.id) as times_contributed,
  AVG(cc.effective_weight) as avg_effective_weight,
  SUM(ABS(cc.weighted_contribution)) as total_influence_magnitude
FROM training_examples te
LEFT JOIN ground_truth_scores gt ON te.id = gt.training_example_id
LEFT JOIN bucks b ON te.buck_id = b.id
LEFT JOIN correction_contributions cc ON te.id = cc.training_example_id
GROUP BY te.id, te.influence_weight, te.health_score, te.health_tier, 
         te.usable_for_training, te.verified_for_training, gt.score_source,
         b.state, b.rack_type;

-- ============================================================================
-- 7. FUNCTIONS FOR DRIFT DETECTION
-- ============================================================================

-- Function to calculate directional bias
CREATE OR REPLACE FUNCTION calculate_directional_bias(window_hours INTEGER DEFAULT 168)
RETURNS TABLE (
  positive_count BIGINT,
  negative_count BIGINT,
  neutral_count BIGINT,
  bias_ratio DECIMAL,
  avg_positive_magnitude DECIMAL,
  avg_negative_magnitude DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE gross_correction > 0.5) as positive_count,
    COUNT(*) FILTER (WHERE gross_correction < -0.5) as negative_count,
    COUNT(*) FILTER (WHERE ABS(gross_correction) <= 0.5) as neutral_count,
    CASE 
      WHEN COUNT(*) FILTER (WHERE gross_correction < -0.5) > 0 
      THEN COUNT(*) FILTER (WHERE gross_correction > 0.5)::DECIMAL / 
           COUNT(*) FILTER (WHERE gross_correction < -0.5)::DECIMAL
      ELSE 999.0
    END as bias_ratio,
    AVG(gross_correction) FILTER (WHERE gross_correction > 0.5) as avg_positive_magnitude,
    AVG(ABS(gross_correction)) FILTER (WHERE gross_correction < -0.5) as avg_negative_magnitude
  FROM learning_correction_log
  WHERE created_at > NOW() - (window_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE learning_correction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE drift_detection_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE influence_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE correction_contributions ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admin read learning_correction_log" ON learning_correction_log
  FOR SELECT USING (true);
  
CREATE POLICY "System insert learning_correction_log" ON learning_correction_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin read drift_detection_log" ON drift_detection_log
  FOR SELECT USING (true);
  
CREATE POLICY "System manage drift_detection_log" ON drift_detection_log
  FOR ALL USING (true);

CREATE POLICY "Admin read influence_config" ON influence_config
  FOR SELECT USING (true);
  
CREATE POLICY "Admin manage influence_config" ON influence_config
  FOR ALL USING (true);

CREATE POLICY "Admin read correction_contributions" ON correction_contributions
  FOR SELECT USING (true);
  
CREATE POLICY "System insert correction_contributions" ON correction_contributions
  FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 9. TRIGGER TO UPDATE TIMESTAMPS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_influence_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_influence_config_updated ON influence_config;
CREATE TRIGGER trigger_influence_config_updated
  BEFORE UPDATE ON influence_config
  FOR EACH ROW
  EXECUTE FUNCTION update_influence_config_timestamp();
