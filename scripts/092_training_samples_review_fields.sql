-- Add review completeness and official status fields to training_samples
ALTER TABLE training_samples
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_completeness integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_gross numeric,
  ADD COLUMN IF NOT EXISTS reviewed_net numeric;

-- Add unique constraint on prediction_id for upsert support
ALTER TABLE training_samples
  ADD CONSTRAINT training_samples_prediction_id_unique UNIQUE (prediction_id);

-- Add index for querying official scores
CREATE INDEX IF NOT EXISTS idx_training_samples_official 
  ON training_samples (is_official) 
  WHERE is_official = true;

-- Add index for completeness filtering
CREATE INDEX IF NOT EXISTS idx_training_samples_completeness 
  ON training_samples (review_completeness);
