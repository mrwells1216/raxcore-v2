-- Antler crop box metadata
-- Stores per-image crop region + applied padding for each scoring submission.
-- Shape: { "0": CropResult | null, "1": CropResult | null, ... } keyed by
-- submission image index. NULL when the user skipped cropping for that image.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS crop_box_metadata JSONB;
