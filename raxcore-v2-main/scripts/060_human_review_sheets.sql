-- ============================================================================
-- Human Review Score Sheets Table
-- Stores human-reviewed/corrected measurement breakdowns for training truth
-- ============================================================================

-- Create the human_review_sheets table
CREATE TABLE IF NOT EXISTS human_review_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  
  -- Review metadata
  reviewer_type TEXT NOT NULL DEFAULT 'human' CHECK (reviewer_type IN ('human', 'expert', 'automated')),
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'final', 'archived')),
  
  -- Original AI measurements (preserved for comparison)
  ai_score_sheet JSONB,
  ai_gross_score NUMERIC(6,2),
  ai_net_score NUMERIC(6,2),
  ai_confidence NUMERIC(5,2),
  
  -- Corrected human measurements
  corrected_score_sheet JSONB,
  corrected_gross_score NUMERIC(6,2),
  corrected_net_score NUMERIC(6,2),
  
  -- Flat corrected measurements for easy querying
  corrected_inside_spread NUMERIC(5,2),
  corrected_main_beam_left NUMERIC(5,2),
  corrected_main_beam_right NUMERIC(5,2),
  corrected_g1_left NUMERIC(5,2),
  corrected_g1_right NUMERIC(5,2),
  corrected_g2_left NUMERIC(5,2),
  corrected_g2_right NUMERIC(5,2),
  corrected_g3_left NUMERIC(5,2),
  corrected_g3_right NUMERIC(5,2),
  corrected_g4_left NUMERIC(5,2),
  corrected_g4_right NUMERIC(5,2),
  corrected_g5_left NUMERIC(5,2),
  corrected_g5_right NUMERIC(5,2),
  corrected_h1_left NUMERIC(5,2),
  corrected_h1_right NUMERIC(5,2),
  corrected_h2_left NUMERIC(5,2),
  corrected_h2_right NUMERIC(5,2),
  corrected_h3_left NUMERIC(5,2),
  corrected_h3_right NUMERIC(5,2),
  corrected_h4_left NUMERIC(5,2),
  corrected_h4_right NUMERIC(5,2),
  corrected_abnormal_points NUMERIC(5,2),
  corrected_deductions NUMERIC(5,2),
  
  -- Classification
  rack_type TEXT CHECK (rack_type IN ('typical', 'non-typical')),
  main_frame_points INTEGER,
  abnormal_point_count INTEGER DEFAULT 0,
  
  -- Notes and metadata
  review_notes TEXT,
  measurement_notes JSONB, -- Per-measurement notes/flags
  
  -- Training metadata
  is_training_truth BOOLEAN DEFAULT FALSE,
  training_weight NUMERIC(3,2) DEFAULT 1.0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_human_review_sheets_buck_id ON human_review_sheets(buck_id);
CREATE INDEX IF NOT EXISTS idx_human_review_sheets_prediction_id ON human_review_sheets(prediction_id);
CREATE INDEX IF NOT EXISTS idx_human_review_sheets_status ON human_review_sheets(review_status);
CREATE INDEX IF NOT EXISTS idx_human_review_sheets_training ON human_review_sheets(is_training_truth) WHERE is_training_truth = TRUE;
CREATE INDEX IF NOT EXISTS idx_human_review_sheets_final ON human_review_sheets(review_status) WHERE review_status = 'final';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_human_review_sheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_human_review_sheets_updated_at ON human_review_sheets;
CREATE TRIGGER trigger_human_review_sheets_updated_at
  BEFORE UPDATE ON human_review_sheets
  FOR EACH ROW
  EXECUTE FUNCTION update_human_review_sheets_updated_at();

-- Enable RLS
ALTER TABLE human_review_sheets ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now, can restrict later)
DROP POLICY IF EXISTS human_review_sheets_select_policy ON human_review_sheets;
CREATE POLICY human_review_sheets_select_policy ON human_review_sheets
  FOR SELECT USING (true);

DROP POLICY IF EXISTS human_review_sheets_insert_policy ON human_review_sheets;
CREATE POLICY human_review_sheets_insert_policy ON human_review_sheets
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS human_review_sheets_update_policy ON human_review_sheets;
CREATE POLICY human_review_sheets_update_policy ON human_review_sheets
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS human_review_sheets_delete_policy ON human_review_sheets;
CREATE POLICY human_review_sheets_delete_policy ON human_review_sheets
  FOR DELETE USING (true);

-- Comment
COMMENT ON TABLE human_review_sheets IS 'Human-reviewed and corrected score sheets for training truth. Preserves both AI and corrected values for comparison.';
