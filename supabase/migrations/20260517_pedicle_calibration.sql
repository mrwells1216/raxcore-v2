-- Migration: Add pedicle_calibration_metadata column to predictions
-- Stores the user-placed pedicle calibration dot positions, computed
-- pixelsPerInch, and whether the user provided a known spacing value
-- (vs. relying on the 4.5" anatomical average). Used to analyse how
-- often the feature is used and whether user-confirmed placement
-- beats AI-only anatomical priors.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS pedicle_calibration_metadata JSONB;

-- Analytics index: predictions with a confirmed pedicle calibration
CREATE INDEX IF NOT EXISTS idx_predictions_pedicle_source
  ON public.predictions ((pedicle_calibration_metadata->>'source'))
  WHERE pedicle_calibration_metadata IS NOT NULL;
