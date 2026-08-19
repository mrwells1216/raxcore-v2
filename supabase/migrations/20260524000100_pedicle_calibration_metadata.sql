-- §4.4 — Pedicle calibration dots (CLAUDE.md §3.23)
-- Stores the user's dot placements + optional measured spacing for the
-- learning flywheel so bias analysis can see angle/state/measurement
-- patterns over time.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS pedicle_calibration_metadata JSONB;
