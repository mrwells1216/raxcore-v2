-- STRICT PATCH: Add missing columns to public.predictions
-- Columns expected by lib/storage/service.ts createPrediction():
--   buck_id, model_version_id, estimated_score, score_range_low, score_range_high,
--   confidence, main_beam_left, main_beam_right, inside_spread, points_left,
--   points_right, mass_estimate, tine_lengths, circumferences, raw_ai_response, intake_quality
-- This patch adds columns missing from the original 001_core_tables.sql schema

-- Add estimated_score column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS estimated_score DECIMAL(5,1);

-- Add score_range_low column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS score_range_low DECIMAL(5,1);

-- Add score_range_high column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS score_range_high DECIMAL(5,1);

-- Add confidence column (different from confidence_percent)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS confidence DECIMAL(4,2);

-- Add main_beam_left column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS main_beam_left DECIMAL(4,1);

-- Add main_beam_right column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS main_beam_right DECIMAL(4,1);

-- Add inside_spread column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS inside_spread DECIMAL(4,1);

-- Add points_left column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS points_left INTEGER;

-- Add points_right column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS points_right INTEGER;

-- Add mass_estimate column
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS mass_estimate DECIMAL(4,1);

-- Add tine_lengths column (JSONB for array of tine measurements)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS tine_lengths JSONB;

-- Add circumferences column (JSONB for H1-H4 measurements)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS circumferences JSONB;

-- Add raw_ai_response column (stores full AI response for debugging)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS raw_ai_response JSONB;

-- Add intake_quality column (stores intake quality assessment)
ALTER TABLE public.predictions 
ADD COLUMN IF NOT EXISTS intake_quality JSONB;

-- Verify critical columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'circumferences') THEN
    RAISE EXCEPTION 'circumferences column was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'estimated_score') THEN
    RAISE EXCEPTION 'estimated_score column was not created';
  END IF;
END $$;
