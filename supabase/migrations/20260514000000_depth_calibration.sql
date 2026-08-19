-- Migration: Add depth_calibration_metadata column to predictions
-- Stores LiDAR depth auto-calibration results from iPhone Portrait Mode HEIC photos.
-- Null when the photo has no embedded depth map (most photos).

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS depth_calibration_metadata JSONB;

-- Index for analytics: find all predictions that used LiDAR calibration
CREATE INDEX IF NOT EXISTS idx_predictions_depth_calibration
  ON public.predictions ((depth_calibration_metadata->>'source'))
  WHERE depth_calibration_metadata IS NOT NULL;
