-- Photo context on official score sheet images.
--
-- Camera position (image_type) and what the photo is OF are independent axes:
-- a buck can have trail-cam photos of the live deer and mounted photos after
-- harvest, from any angle. Keeping both in one column meant a value like
-- "mounted" told us nothing about the angle, which is exactly what the
-- per-angle accuracy run needs.
--
-- Nullable so existing rows are unaffected.
ALTER TABLE public.official_score_images
  ADD COLUMN IF NOT EXISTS image_context TEXT;
