-- Phase 15: Add intake quality column to predictions table
-- This stores the image set quality assessment for each prediction

-- Add intake_quality column to predictions table
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS intake_quality JSONB DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN predictions.intake_quality IS 'Phase 15: Stores intake quality assessment including tier, score, factors, and recommendations';

-- Create index for querying by intake quality tier
CREATE INDEX IF NOT EXISTS idx_predictions_intake_quality_tier 
ON predictions ((intake_quality->>'tier')) 
WHERE intake_quality IS NOT NULL;

-- Add intake_quality_tier as a generated column for easier filtering
-- ALTER TABLE predictions 
-- ADD COLUMN IF NOT EXISTS intake_quality_tier TEXT 
-- GENERATED ALWAYS AS (intake_quality->>'tier') STORED;
