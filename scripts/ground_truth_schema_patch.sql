-- ============================================================================
-- SAFE PATCH: Ground Truth Scores - Add Missing Measurement Columns
-- Adds detailed tine (G1-G4) and circumference (H1-H4) measurement columns
-- expected by the training submission API
-- ============================================================================

-- Add official_score column (alias for official_gross, used by training API)
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS official_score NUMERIC(6,2) NULL;

-- Add main beam measurements
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS main_beam_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS main_beam_right NUMERIC(6,2) NULL;

-- Add inside spread
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS inside_spread NUMERIC(6,2) NULL;

-- Add point counts
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS points_left INTEGER NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS points_right INTEGER NULL;

-- Add G tine measurements (G1-G4 left and right)
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g1_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g1_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g2_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g2_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g3_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g3_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g4_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS g4_right NUMERIC(6,2) NULL;

-- Add H circumference measurements (H1-H4 left and right)
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h1_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h1_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h2_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h2_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h3_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h3_right NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h4_left NUMERIC(6,2) NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS h4_right NUMERIC(6,2) NULL;

-- Add scoring method and notes columns
ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS scoring_method TEXT NULL;

ALTER TABLE public.ground_truth_scores
  ADD COLUMN IF NOT EXISTS scorer_notes TEXT NULL;

-- Add unique constraint on buck_id for upsert support (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'ground_truth_scores_buck_id_key'
  ) THEN
    ALTER TABLE public.ground_truth_scores
      ADD CONSTRAINT ground_truth_scores_buck_id_key UNIQUE (buck_id);
  END IF;
END $$;

-- Sync official_score with official_gross for existing records
UPDATE public.ground_truth_scores
SET official_score = official_gross
WHERE official_score IS NULL AND official_gross IS NOT NULL;

-- Create trigger to keep official_score and official_gross in sync
CREATE OR REPLACE FUNCTION public.sync_official_scores()
RETURNS TRIGGER AS $$
BEGIN
  -- If official_score is set but official_gross is not, copy to official_gross
  IF NEW.official_score IS NOT NULL AND NEW.official_gross IS NULL THEN
    NEW.official_gross := NEW.official_score;
  END IF;
  -- If official_gross is set but official_score is not, copy to official_score
  IF NEW.official_gross IS NOT NULL AND NEW.official_score IS NULL THEN
    NEW.official_score := NEW.official_gross;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_official_scores_trigger ON public.ground_truth_scores;
CREATE TRIGGER sync_official_scores_trigger
  BEFORE INSERT OR UPDATE ON public.ground_truth_scores
  FOR EACH ROW EXECUTE FUNCTION public.sync_official_scores();
