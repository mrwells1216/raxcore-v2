-- xRack Training Memory Schema
-- Phase 1: Core tables for verified training memory system

-- Model versions table
CREATE TABLE IF NOT EXISTS public.model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  training_data_count INTEGER DEFAULT 0,
  avg_gross_error NUMERIC(6,2),
  avg_net_error NUMERIC(6,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Buck submissions table
CREATE TABLE IF NOT EXISTS public.bucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  rack_type TEXT NOT NULL CHECK (rack_type IN ('typical', 'non-typical')),
  harvest_method TEXT CHECK (harvest_method IN ('archery', 'rifle', 'muzzleloader', 'crossbow', 'shotgun', 'found', 'other')),
  source_type TEXT CHECK (source_type IN ('harvest_photo', 'trail_cam', 'shed', 'mounted', 'score_sheet', 'other')),
  capture_device TEXT CHECK (capture_device IN ('iphone', 'android', 'dslr', 'trail_cam', 'scanner', 'unknown')),
  ears_fully_visible BOOLEAN DEFAULT true,
  harvest_year INTEGER,
  main_frame_points INTEGER,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Buck images table
CREATE TABLE IF NOT EXISTS public.buck_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  angle_type TEXT NOT NULL CHECK (angle_type IN ('front', 'left', 'right', 'back', 'other')),
  capture_method TEXT DEFAULT 'upload',
  file_type TEXT,
  file_size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  quality_score NUMERIC(5,2),
  landmarks_detected JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI predictions table
CREATE TABLE IF NOT EXISTS public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  model_version_id UUID REFERENCES public.model_versions(id),
  predicted_gross NUMERIC(6,2),
  predicted_net NUMERIC(6,2),
  confidence_percent NUMERIC(5,2),
  error_band_low NUMERIC(6,2),
  error_band_high NUMERIC(6,2),
  measurements JSONB,
  landmarks JSONB,
  state_calibration JSONB,
  processing_time_ms INTEGER,
  images_used INTEGER,
  angle_diversity_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ground truth scores table
CREATE TABLE IF NOT EXISTS public.ground_truth_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  official_gross NUMERIC(6,2),
  official_net NUMERIC(6,2),
  score_source TEXT DEFAULT 'self_measured' CHECK (score_source IN ('official_scorer', 'self_measured', 'taxidermist', 'score_sheet', 'other')),
  scorer_name TEXT,
  scoring_organization TEXT,
  is_typical BOOLEAN,
  harvest_year INTEGER,
  verified BOOLEAN DEFAULT false,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Training examples table (links predictions to ground truth)
CREATE TABLE IF NOT EXISTS public.training_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  ground_truth_id UUID NOT NULL REFERENCES public.ground_truth_scores(id) ON DELETE CASCADE,
  gross_error NUMERIC(6,2),
  net_error NUMERIC(6,2),
  abs_gross_error NUMERIC(6,2),
  abs_net_error NUMERIC(6,2),
  verified_for_training BOOLEAN DEFAULT false,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  quality_flags JSONB,
  target_model_version UUID REFERENCES public.model_versions(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bucks_user_id ON public.bucks(user_id);
CREATE INDEX IF NOT EXISTS idx_bucks_state ON public.bucks(state);
CREATE INDEX IF NOT EXISTS idx_bucks_status ON public.bucks(status);
CREATE INDEX IF NOT EXISTS idx_bucks_created_at ON public.bucks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buck_images_buck_id ON public.buck_images(buck_id);
CREATE INDEX IF NOT EXISTS idx_predictions_buck_id ON public.predictions(buck_id);
CREATE INDEX IF NOT EXISTS idx_predictions_model_version ON public.predictions(model_version_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_buck_id ON public.ground_truth_scores(buck_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_verified ON public.training_examples(verified_for_training);
CREATE INDEX IF NOT EXISTS idx_training_examples_prediction ON public.training_examples(prediction_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_ground_truth ON public.training_examples(ground_truth_id);

-- Insert default model version if none exists
INSERT INTO public.model_versions (version_name, description, is_active, training_data_count)
SELECT 'xrack-v1', 'xRack scorer with verified-learning memory loop', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.model_versions WHERE is_active = true);

-- Insert default admin profile if none exists
INSERT INTO public.profiles (id, display_name, is_admin)
SELECT 'admin', 'Admin', true
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = 'admin');

-- Enable Row Level Security
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buck_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ground_truth_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all operations for service role (API routes use service role key)
-- These policies allow public access since the app doesn't have user auth yet
CREATE POLICY "Allow all for model_versions" ON public.model_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for bucks" ON public.bucks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for buck_images" ON public.buck_images FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for predictions" ON public.predictions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for ground_truth_scores" ON public.ground_truth_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for training_examples" ON public.training_examples FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_bucks_updated_at ON public.bucks;
CREATE TRIGGER update_bucks_updated_at BEFORE UPDATE ON public.bucks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_ground_truth_updated_at ON public.ground_truth_scores;
CREATE TRIGGER update_ground_truth_updated_at BEFORE UPDATE ON public.ground_truth_scores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_model_versions_updated_at ON public.model_versions;
CREATE TRIGGER update_model_versions_updated_at BEFORE UPDATE ON public.model_versions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
