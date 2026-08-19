ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS user_measurements_metadata JSONB;
