-- ============================================================================
-- Reviewed Score Sheets Table
-- Cleaner schema using JSONB for full score sheet storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviewed_score_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships (required)
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Source/authorship
  created_by TEXT,
  source TEXT NOT NULL DEFAULT 'reviewed', -- 'reviewed', 'ai_raw', 'imported', 'expert'
  
  -- Scoring system
  scoring_system TEXT NOT NULL DEFAULT 'boone_and_crockett_typical',
  -- Options: 'boone_and_crockett_typical', 'boone_and_crockett_non_typical', 'pope_and_young', 'sci'
  
  -- The reviewed/corrected score sheet (ScoreSheetPayload JSON)
  sheet_json JSONB NOT NULL,
  
  -- Original AI data for comparison (preserved)
  ai_sheet_json JSONB,
  raw_ai_response JSONB,
  
  -- Notes
  notes TEXT,
  
  -- Training flag
  is_training_truth BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_prediction_id 
  ON reviewed_score_sheets(prediction_id);
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_buck_id 
  ON reviewed_score_sheets(buck_id);
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_training 
  ON reviewed_score_sheets(is_training_truth) WHERE is_training_truth = TRUE;
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_source 
  ON reviewed_score_sheets(source);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_sheet_json 
  ON reviewed_score_sheets USING GIN (sheet_json);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_reviewed_score_sheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_reviewed_score_sheets_updated_at ON reviewed_score_sheets;
CREATE TRIGGER trigger_reviewed_score_sheets_updated_at
  BEFORE UPDATE ON reviewed_score_sheets
  FOR EACH ROW
  EXECUTE FUNCTION update_reviewed_score_sheets_updated_at();

-- Enable RLS
ALTER TABLE reviewed_score_sheets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS reviewed_score_sheets_select_policy ON reviewed_score_sheets;
CREATE POLICY reviewed_score_sheets_select_policy ON reviewed_score_sheets
  FOR SELECT USING (true);

DROP POLICY IF EXISTS reviewed_score_sheets_insert_policy ON reviewed_score_sheets;
CREATE POLICY reviewed_score_sheets_insert_policy ON reviewed_score_sheets
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS reviewed_score_sheets_update_policy ON reviewed_score_sheets;
CREATE POLICY reviewed_score_sheets_update_policy ON reviewed_score_sheets
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS reviewed_score_sheets_delete_policy ON reviewed_score_sheets;
CREATE POLICY reviewed_score_sheets_delete_policy ON reviewed_score_sheets
  FOR DELETE USING (true);

COMMENT ON TABLE reviewed_score_sheets IS 'Reviewed/corrected score sheets for training truth. Uses JSONB for flexibility while preserving AI original for comparison.';
