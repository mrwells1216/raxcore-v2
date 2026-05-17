-- Migration: Add crop_box_metadata column to predictions
-- Stores per-image crop region data when the user drew an antler crop box
-- before scoring. Used to analyze whether cropped-image predictions yield
-- better accuracy than uncropped ones.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS crop_box_metadata JSONB;

-- Analytics index: predictions that used a user-drawn crop on any image
CREATE INDEX IF NOT EXISTS idx_predictions_crop_box_metadata
  ON public.predictions ((crop_box_metadata IS NOT NULL))
  WHERE crop_box_metadata IS NOT NULL;
