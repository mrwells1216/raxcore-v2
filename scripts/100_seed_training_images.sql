-- Seed training images table for WI-4 (Roboflow and other external datasets).
-- These images have detection labels (bounding boxes) but NOT B&C scores.
-- Used for object-detection benchmarking, not regression scoring.

CREATE TABLE IF NOT EXISTS public.seed_training_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  bbox        JSONB,
  class_name  TEXT,
  license     TEXT,
  attribution TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_training_source ON public.seed_training_images(source);

ALTER TABLE public.seed_training_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read" ON public.seed_training_images FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ));
