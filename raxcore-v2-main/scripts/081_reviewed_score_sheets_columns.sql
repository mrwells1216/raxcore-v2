-- ============================================================================
-- Add missing columns to reviewed_score_sheets table
-- Run this after 080_reviewed_score_sheets.sql if table already exists
-- ============================================================================

-- Add extracted score columns for easy querying
ALTER TABLE reviewed_score_sheets 
ADD COLUMN IF NOT EXISTS original_gross NUMERIC(5,2);

ALTER TABLE reviewed_score_sheets 
ADD COLUMN IF NOT EXISTS original_net NUMERIC(5,2);

ALTER TABLE reviewed_score_sheets 
ADD COLUMN IF NOT EXISTS reviewed_gross NUMERIC(5,2);

ALTER TABLE reviewed_score_sheets 
ADD COLUMN IF NOT EXISTS reviewed_net NUMERIC(5,2);

-- Add review status column
ALTER TABLE reviewed_score_sheets 
ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'draft';

-- Add index on review status
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_review_status 
ON reviewed_score_sheets(review_status);

-- Add composite index for training queries
CREATE INDEX IF NOT EXISTS idx_reviewed_score_sheets_training_status 
ON reviewed_score_sheets(is_training_truth, review_status) 
WHERE is_training_truth = TRUE;

COMMENT ON COLUMN reviewed_score_sheets.original_gross IS 'AI original gross score for easy querying';
COMMENT ON COLUMN reviewed_score_sheets.original_net IS 'AI original net score for easy querying';
COMMENT ON COLUMN reviewed_score_sheets.reviewed_gross IS 'Human reviewed gross score for easy querying';
COMMENT ON COLUMN reviewed_score_sheets.reviewed_net IS 'Human reviewed net score for easy querying';
COMMENT ON COLUMN reviewed_score_sheets.review_status IS 'draft, final, or archived';
