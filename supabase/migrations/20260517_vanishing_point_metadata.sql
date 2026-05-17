-- Migration: Add vanishing_point_metadata column to predictions
-- Stores detected parallel features + vanishing-point analysis used as
-- a cross-check calibration signal. Lowest-priority source: never
-- overrides LiDAR, ArUco, ruler, pedicle dots, or reference objects.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS vanishing_point_metadata JSONB;

-- Analytics index: predictions with any parallel features detected
CREATE INDEX IF NOT EXISTS idx_predictions_vanishing_point
  ON public.predictions ((vanishing_point_metadata->>'scaleSource'))
  WHERE vanishing_point_metadata IS NOT NULL;
