-- Phase 49.5: Cross-View Conflict Engine Schema
-- Adds support for storing cross-view conflict analysis results

-- Add phase_495_metadata column to predictions table
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS phase_495_metadata JSONB DEFAULT NULL;

-- Add cross_view_conflict_summary columns for quick filtering
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS cross_view_disagreement_count INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS cross_view_reverse_engineering_recommended BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS cross_view_fusion_confidence NUMERIC(4,3) DEFAULT NULL;

-- Create index for filtering predictions with conflict issues
CREATE INDEX IF NOT EXISTS idx_predictions_cross_view_conflict 
ON predictions (cross_view_reverse_engineering_recommended, cross_view_disagreement_count)
WHERE cross_view_disagreement_count IS NOT NULL;

-- Create index for finding predictions with high disagreement
CREATE INDEX IF NOT EXISTS idx_predictions_high_disagreement
ON predictions (cross_view_fusion_confidence)
WHERE cross_view_fusion_confidence IS NOT NULL AND cross_view_fusion_confidence < 0.5;

-- Add comment documenting the phase_495_metadata structure
COMMENT ON COLUMN predictions.phase_495_metadata IS 'Phase 49.5 cross-view conflict analysis metadata. Contains: crossViewConflict (perFamilyResiduals, viewTrustScores, disagreementClassifications, fusionStrategies, rejectedViews, conflictSummary), enhancedFusionUsed, phase495_version, processed_at';

-- Create table for tracking cross-view conflict patterns for model improvement
CREATE TABLE IF NOT EXISTS cross_view_conflict_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pattern identification
  pattern_type TEXT NOT NULL, -- 'scale_reference_conflict', 'perspective_distortion', etc.
  measurement_family TEXT NOT NULL, -- 'spread', 'beam', 'tine', 'mass', 'deduction'
  
  -- Pattern statistics
  occurrence_count INTEGER DEFAULT 1,
  avg_disagreement_score NUMERIC(4,3),
  avg_error_when_averaged NUMERIC(6,2), -- Actual error when naive averaging was used
  avg_error_when_dominant NUMERIC(6,2), -- Actual error when dominant view was used
  
  -- Context patterns
  angle_combination TEXT[], -- e.g., ['front', 'left'] or ['left', 'right']
  source_type_pattern TEXT,
  
  -- Resolution recommendations
  recommended_strategy TEXT, -- 'dominant_view', 'weighted_average', 'flag_for_review'
  confidence_in_recommendation NUMERIC(4,3),
  
  -- Timestamps
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_family CHECK (measurement_family IN ('spread', 'beam', 'tine', 'mass', 'deduction')),
  CONSTRAINT valid_strategy CHECK (recommended_strategy IN ('dominant_view', 'weighted_average', 'highest_trust', 'flagged_for_review'))
);

-- Create unique constraint on pattern identification
CREATE UNIQUE INDEX IF NOT EXISTS idx_conflict_patterns_unique
ON cross_view_conflict_patterns (pattern_type, measurement_family, angle_combination);

-- Create table for tracking reverse engineering recommendations
CREATE TABLE IF NOT EXISTS reverse_engineering_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Trigger information
  trigger_reason TEXT NOT NULL,
  trigger_families TEXT[] NOT NULL,
  disagreement_score NUMERIC(4,3),
  
  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'in_review', 'resolved', 'dismissed'
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_status CHECK (status IN ('pending', 'in_review', 'resolved', 'dismissed'))
);

-- Index for finding pending reverse engineering items
CREATE INDEX IF NOT EXISTS idx_re_queue_pending
ON reverse_engineering_queue (status, created_at)
WHERE status = 'pending';

-- Create metrics table for tracking conflict analysis effectiveness
CREATE TABLE IF NOT EXISTS conflict_analysis_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Volume metrics
  total_predictions_analyzed INTEGER DEFAULT 0,
  predictions_with_conflict INTEGER DEFAULT 0,
  predictions_with_high_disagreement INTEGER DEFAULT 0,
  
  -- Accuracy metrics (when ground truth available)
  naive_fusion_mae NUMERIC(6,2),
  conflict_aware_fusion_mae NUMERIC(6,2),
  improvement_percent NUMERIC(5,2),
  
  -- Strategy distribution
  weighted_average_count INTEGER DEFAULT 0,
  dominant_view_count INTEGER DEFAULT 0,
  highest_trust_count INTEGER DEFAULT 0,
  flagged_for_review_count INTEGER DEFAULT 0,
  
  -- Reverse engineering
  re_recommended_count INTEGER DEFAULT 0,
  re_resolved_count INTEGER DEFAULT 0,
  re_improved_accuracy_count INTEGER DEFAULT 0,
  
  -- Timestamps
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_period CHECK (period_end > period_start)
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_conflict_metrics_period
ON conflict_analysis_metrics (period_start, period_end);

-- Add trigger to update updated_at on reverse_engineering_queue
CREATE OR REPLACE FUNCTION update_re_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_re_queue_updated_at ON reverse_engineering_queue;
CREATE TRIGGER trg_re_queue_updated_at
  BEFORE UPDATE ON reverse_engineering_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_re_queue_updated_at();

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON cross_view_conflict_patterns TO authenticated;
-- GRANT SELECT, INSERT, UPDATE ON reverse_engineering_queue TO authenticated;
-- GRANT SELECT, INSERT ON conflict_analysis_metrics TO authenticated;
