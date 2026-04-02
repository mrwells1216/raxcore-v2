-- Phase 54: Abnormal/Irregular Points Capture Layer
-- Safe migration - adds columns for capturing abnormal point signals

-- ============================================================================
-- ADD ABNORMAL POINT COLUMNS TO BUCKS TABLE
-- ============================================================================

-- Irregular points present indicator (yes/no/unsure)
ALTER TABLE public.bucks 
ADD COLUMN IF NOT EXISTS irregular_points_present TEXT 
CHECK (irregular_points_present IN ('yes', 'no', 'unsure', NULL));

-- Non-typical traits present indicator (yes/no/unsure)  
ALTER TABLE public.bucks
ADD COLUMN IF NOT EXISTS non_typical_traits_present TEXT
CHECK (non_typical_traits_present IN ('yes', 'no', 'unsure', NULL));

-- Estimated count of irregular/abnormal points
ALTER TABLE public.bucks
ADD COLUMN IF NOT EXISTS estimated_irregular_points_count INTEGER
CHECK (estimated_irregular_points_count IS NULL OR estimated_irregular_points_count >= 0);

-- Free-text notes about abnormal points
ALTER TABLE public.bucks
ADD COLUMN IF NOT EXISTS abnormal_point_notes TEXT;

-- Array of abnormal point tags (drop_tine, sticker_point, etc.)
ALTER TABLE public.bucks
ADD COLUMN IF NOT EXISTS abnormal_point_tags TEXT[];

-- Add constraint to validate tag values (soft validation via application layer)
COMMENT ON COLUMN public.bucks.abnormal_point_tags IS 
'Valid tags: drop_tine, sticker_point, split_tine, extra_abnormal_growth, palmation_like_growth, kicker_point, inline_point, unknown_abnormality';

-- ============================================================================
-- ADD INDEX FOR QUERYING ABNORMAL BUCKS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bucks_irregular_points 
ON public.bucks(irregular_points_present) 
WHERE irregular_points_present IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bucks_non_typical_traits
ON public.bucks(non_typical_traits_present)
WHERE non_typical_traits_present IS NOT NULL;

-- GIN index for array containment queries on tags
CREATE INDEX IF NOT EXISTS idx_bucks_abnormal_tags_gin
ON public.bucks USING GIN (abnormal_point_tags)
WHERE abnormal_point_tags IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  -- Verify columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bucks' AND column_name = 'irregular_points_present'
  ) THEN
    RAISE EXCEPTION 'irregular_points_present column was not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bucks' AND column_name = 'abnormal_point_tags'
  ) THEN
    RAISE EXCEPTION 'abnormal_point_tags column was not created';
  END IF;
  
  RAISE NOTICE 'Phase 54: Abnormal points columns added successfully';
END $$;
