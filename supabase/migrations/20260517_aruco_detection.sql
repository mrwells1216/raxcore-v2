-- Migration: Add aruco_detection_metadata column to predictions
-- Stores the full ArUco marker detection result (corners, pixelsPerInch,
-- confidence, warnings) when the user submitted with reference_type =
-- 'aruco_marker'. Used to evaluate real-world detection accuracy and
-- decide whether the OpenCV.js bundle is worth shipping later.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS aruco_detection_metadata JSONB;

-- Analytics index: predictions where an ArUco marker was actually detected
CREATE INDEX IF NOT EXISTS idx_predictions_aruco_detected
  ON public.predictions ((aruco_detection_metadata->>'detected'))
  WHERE aruco_detection_metadata IS NOT NULL;
