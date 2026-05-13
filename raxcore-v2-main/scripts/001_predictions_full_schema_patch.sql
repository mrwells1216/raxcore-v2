-- STRICT PATCH: Align public.predictions with current scoring code
-- Code expects columns that don't exist in original schema
-- This patch adds all missing columns expected by createPrediction()

-- Add estimated_score (main score output)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS estimated_score DECIMAL(5,1);

-- Add score range columns
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS score_range_low DECIMAL(5,1);

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS score_range_high DECIMAL(5,1);

-- Add confidence (code uses 'confidence', schema had 'confidence_percent')
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS confidence DECIMAL(4,2);

-- Add measurement breakdown columns
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS main_beam_left DECIMAL(4,1);

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS main_beam_right DECIMAL(4,1);

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS inside_spread DECIMAL(4,1);

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS points_left INTEGER;

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS points_right INTEGER;

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS mass_estimate DECIMAL(4,1);

-- Add JSONB columns for detailed measurements
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS tine_lengths JSONB;

ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS circumferences JSONB;

-- Add raw AI response storage
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS raw_ai_response JSONB;

-- Add intake quality metadata
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS intake_quality JSONB;

-- Create index on estimated_score for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_predictions_estimated_score 
ON public.predictions(estimated_score DESC NULLS LAST);

-- Verify critical columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'predictions' 
    AND column_name = 'estimated_score'
  ) THEN
    RAISE EXCEPTION 'estimated_score column was not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'predictions' 
    AND column_name = 'circumferences'
  ) THEN
    RAISE EXCEPTION 'circumferences column was not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'predictions' 
    AND column_name = 'confidence'
  ) THEN
    RAISE EXCEPTION 'confidence column was not created';
  END IF;
END $$;
