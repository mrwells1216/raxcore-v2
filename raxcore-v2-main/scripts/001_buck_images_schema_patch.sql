-- STRICT PATCH: Add missing columns to public.buck_images
-- Code expects: buck_id, image_url, image_type, display_order
-- Schema has: buck_id, storage_path, public_url, angle_type, capture_method, etc.
-- This patch adds: image_url, image_type, display_order

-- Add image_url column (primary URL used by scoring code)
ALTER TABLE public.buck_images 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add image_type column (type classification: user_upload, etc.)
ALTER TABLE public.buck_images 
ADD COLUMN IF NOT EXISTS image_type TEXT;

-- Add display_order column (ordering for image display)
ALTER TABLE public.buck_images 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Create index on display_order for efficient ordering
CREATE INDEX IF NOT EXISTS idx_buck_images_display_order 
ON public.buck_images(buck_id, display_order);

-- Backfill image_url from public_url for existing rows
UPDATE public.buck_images 
SET image_url = public_url 
WHERE image_url IS NULL AND public_url IS NOT NULL;

-- Verify columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buck_images' AND column_name = 'display_order') THEN
    RAISE EXCEPTION 'display_order column was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buck_images' AND column_name = 'image_url') THEN
    RAISE EXCEPTION 'image_url column was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buck_images' AND column_name = 'image_type') THEN
    RAISE EXCEPTION 'image_type column was not created';
  END IF;
END $$;
