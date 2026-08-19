ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS per_image_consensus JSONB;
