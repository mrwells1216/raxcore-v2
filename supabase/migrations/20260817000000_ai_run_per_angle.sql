-- Per-angle AI accuracy run (guide buck).
--
-- Stores one entry per attached image: that image scored ON ITS OWN against
-- the sheet's certified measurements. The existing ai_run_result column holds
-- a single all-images-together comparison, which cannot show which camera
-- angles the scorer handles well.
--
-- Shape: { run_at, image_count, scored_count, official_gross, official_net,
--          mae_gross, best_angle, worst_angle, angles: [...] }
ALTER TABLE public.official_score_sheets
  ADD COLUMN IF NOT EXISTS ai_run_per_angle JSONB;
