-- xRack Enhanced Scoring Fields
-- Phase 8: Detailed landmarks, learning summary, and multi-image fusion

-- Add enhanced landmark fields to predictions
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS detailed_landmarks JSONB;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS learning_summary JSONB;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS fusion_result JSONB;

-- Add similarity matching metadata to training_examples
ALTER TABLE public.training_examples ADD COLUMN IF NOT EXISTS similarity_features JSONB;
ALTER TABLE public.training_examples ADD COLUMN IF NOT EXISTS match_quality TEXT CHECK (match_quality IN ('none', 'weak', 'moderate', 'strong'));

-- Add buck metadata fields if missing for similarity matching
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS capture_device TEXT CHECK (capture_device IN ('iphone', 'android', 'digital_camera', 'photo_of_photo', 'vintage_photo', 'unknown'));
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS main_frame_points INTEGER;
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS harvest_year INTEGER;

-- Add property_id and primary_pin_id to bucks for mapping integration
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS primary_pin_id UUID;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_bucks_property_id ON public.bucks(property_id);
CREATE INDEX IF NOT EXISTS idx_bucks_capture_device ON public.bucks(capture_device);
CREATE INDEX IF NOT EXISTS idx_training_examples_match_quality ON public.training_examples(match_quality);

-- Update comments
COMMENT ON COLUMN public.predictions.detailed_landmarks IS 'Enhanced landmark detection data including ear, eye, burr, beam, and tine positions';
COMMENT ON COLUMN public.predictions.learning_summary IS 'Summary of how verified training examples influenced this prediction';
COMMENT ON COLUMN public.predictions.fusion_result IS 'Multi-image fusion result showing measurement sources and conflicts resolved';
COMMENT ON COLUMN public.training_examples.similarity_features IS 'Features used for similarity matching with other examples';
COMMENT ON COLUMN public.training_examples.match_quality IS 'Quality of similarity match: none, weak, moderate, or strong';
