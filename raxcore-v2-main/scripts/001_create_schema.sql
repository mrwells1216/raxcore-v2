-- RutAI / XRacks Database Schema
-- AI-powered whitetail antler scoring system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Model versions table (for tracking AI model iterations)
CREATE TABLE IF NOT EXISTS model_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  training_data_count INTEGER DEFAULT 0,
  avg_gross_error DECIMAL(5,2),
  avg_net_error DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default model version
INSERT INTO model_versions (version_name, description, is_active)
VALUES ('v1.0.0-beta', 'Initial beta model using anatomical scaling references', true)
ON CONFLICT (version_name) DO NOTHING;

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bucks table (main entity for each submission)
CREATE TABLE IF NOT EXISTS bucks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Required fields
  state TEXT NOT NULL,
  rack_type TEXT NOT NULL CHECK (rack_type IN ('typical', 'non-typical')),
  
  -- Recommended fields
  harvest_method TEXT CHECK (harvest_method IN ('bow', 'rifle', 'muzzleloader', 'crossbow', 'other', NULL)),
  source_type TEXT CHECK (source_type IN ('live_deer', 'mount', 'trail_cam', 'harvest_photo', 'other')),
  ears_fully_visible BOOLEAN,
  
  -- Metadata
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buck images table
CREATE TABLE IF NOT EXISTS buck_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Image data
  storage_path TEXT NOT NULL,
  public_url TEXT,
  
  -- Image metadata
  angle_type TEXT CHECK (angle_type IN ('front', 'left', 'right', 'back', 'other')),
  capture_method TEXT CHECK (capture_method IN ('camera', 'upload')),
  file_type TEXT,
  file_size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  
  -- Quality assessment
  quality_score DECIMAL(3,2),
  landmarks_detected JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Predictions table
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  model_version_id UUID REFERENCES model_versions(id),
  
  -- Score predictions
  predicted_gross DECIMAL(5,1),
  predicted_net DECIMAL(5,1),
  
  -- Confidence metrics
  confidence_percent DECIMAL(4,1),
  error_band_low DECIMAL(5,1),
  error_band_high DECIMAL(5,1),
  
  -- Detailed measurements (in inches)
  measurements JSONB,
  /* measurements structure:
  {
    "inside_spread": 18.5,
    "main_beam_left": 24.0,
    "main_beam_right": 23.5,
    "tines": {
      "g1_left": 4.0, "g1_right": 4.2,
      "g2_left": 9.5, "g2_right": 9.0,
      "g3_left": 8.0, "g3_right": 8.5,
      "g4_left": 5.0, "g4_right": 4.5
    },
    "circumferences": {
      "h1_left": 4.5, "h1_right": 4.5,
      "h2_left": 4.0, "h2_right": 4.0,
      "h3_left": 4.0, "h3_right": 4.0,
      "h4_left": 3.5, "h4_right": 3.5
    },
    "abnormal_points": [],
    "deductions": {
      "asymmetry": 2.5,
      "abnormal_points": 0
    }
  }
  */
  
  -- Scaling references used
  landmarks JSONB,
  /* landmarks structure:
  {
    "ear_length_px": 120,
    "ear_length_ref_inches": 7.5,
    "eye_to_eye_px": 80,
    "eye_to_eye_ref_inches": 6.5,
    "ear_tip_to_tip_px": 200,
    "ear_tip_to_tip_ref_inches": 16.0,
    "pixel_per_inch": 16.0,
    "primary_reference": "ear_length",
    "confidence_by_landmark": {
      "ear_length": 0.92,
      "eye_to_eye": 0.85,
      "ear_tip_to_tip": 0.78
    }
  }
  */
  
  -- State calibration applied
  state_calibration JSONB,
  /* state_calibration structure:
  {
    "state": "Iowa",
    "adjustment_factor": 1.02,
    "reason": "High-output state with larger average deer"
  }
  */
  
  -- Processing metadata
  processing_time_ms INTEGER,
  images_used INTEGER,
  angle_diversity_score DECIMAL(3,2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ground truth scores table (user-submitted real scores)
CREATE TABLE IF NOT EXISTS ground_truth_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  
  -- Actual scores
  official_gross DECIMAL(5,1),
  official_net DECIMAL(5,1),
  
  -- Score verification
  score_source TEXT CHECK (score_source IN ('official_scorer', 'self_measured', 'user_reported', 'estimated')),
  scorer_name TEXT,
  scoring_organization TEXT,
  
  -- Additional context
  is_typical BOOLEAN,
  harvest_year INTEGER,
  
  -- Verification status
  verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training examples table (links predictions to ground truth for model improvement)
CREATE TABLE IF NOT EXISTS training_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  ground_truth_id UUID NOT NULL REFERENCES ground_truth_scores(id) ON DELETE CASCADE,
  
  -- Error metrics
  gross_error DECIMAL(5,1),
  net_error DECIMAL(5,1),
  abs_gross_error DECIMAL(5,1),
  abs_net_error DECIMAL(5,1),
  
  -- Training status
  verified_for_training BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Quality flags
  quality_flags JSONB,
  /* quality_flags structure:
  {
    "high_quality_images": true,
    "multiple_angles": true,
    "landmarks_clear": true,
    "official_score": true,
    "recommended_for_training": true
  }
  */
  
  -- Model version this will train
  target_model_version TEXT,
  
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bucks_user_id ON bucks(user_id);
CREATE INDEX IF NOT EXISTS idx_bucks_state ON bucks(state);
CREATE INDEX IF NOT EXISTS idx_bucks_rack_type ON bucks(rack_type);
CREATE INDEX IF NOT EXISTS idx_bucks_status ON bucks(status);
CREATE INDEX IF NOT EXISTS idx_bucks_created_at ON bucks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_buck_images_buck_id ON buck_images(buck_id);
CREATE INDEX IF NOT EXISTS idx_predictions_buck_id ON predictions(buck_id);
CREATE INDEX IF NOT EXISTS idx_predictions_model_version ON predictions(model_version_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_buck_id ON ground_truth_scores(buck_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_verified ON ground_truth_scores(verified);
CREATE INDEX IF NOT EXISTS idx_training_examples_verified ON training_examples(verified_for_training);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE buck_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ground_truth_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Admin can view all profiles
CREATE POLICY "profiles_admin_select" ON profiles FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Bucks policies (users can manage their own, admins can view all)
CREATE POLICY "bucks_select_own" ON bucks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "bucks_insert_own" ON bucks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "bucks_update_own" ON bucks FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "bucks_delete_own" ON bucks FOR DELETE USING (user_id = auth.uid());

-- Allow anonymous submissions (user_id can be null)
CREATE POLICY "bucks_insert_anon" ON bucks FOR INSERT WITH CHECK (user_id IS NULL);
CREATE POLICY "bucks_select_anon" ON bucks FOR SELECT USING (user_id IS NULL);

-- Admin policies for bucks
CREATE POLICY "bucks_admin_all" ON bucks FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Buck images policies
CREATE POLICY "buck_images_select" ON buck_images FOR SELECT 
  USING (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = buck_images.buck_id AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)));
CREATE POLICY "buck_images_insert" ON buck_images FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = buck_images.buck_id AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)));
CREATE POLICY "buck_images_admin_all" ON buck_images FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Predictions policies
CREATE POLICY "predictions_select" ON predictions FOR SELECT 
  USING (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = predictions.buck_id AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)));
CREATE POLICY "predictions_insert" ON predictions FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = predictions.buck_id));
CREATE POLICY "predictions_admin_all" ON predictions FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Ground truth policies
CREATE POLICY "ground_truth_select" ON ground_truth_scores FOR SELECT 
  USING (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = ground_truth_scores.buck_id AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)));
CREATE POLICY "ground_truth_insert" ON ground_truth_scores FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = ground_truth_scores.buck_id AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)));
CREATE POLICY "ground_truth_update" ON ground_truth_scores FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM bucks WHERE bucks.id = ground_truth_scores.buck_id AND bucks.user_id = auth.uid()));
CREATE POLICY "ground_truth_admin_all" ON ground_truth_scores FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Training examples policies (admin only for management)
CREATE POLICY "training_examples_admin_all" ON training_examples FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "training_examples_select_own" ON training_examples FOR SELECT 
  USING (EXISTS (
    SELECT 1 FROM predictions p 
    JOIN bucks b ON b.id = p.buck_id 
    WHERE p.id = training_examples.prediction_id AND b.user_id = auth.uid()
  ));

-- Model versions policies (read for all, write for admins)
CREATE POLICY "model_versions_select_all" ON model_versions FOR SELECT USING (true);
CREATE POLICY "model_versions_admin_write" ON model_versions FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Create profile trigger for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, is_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data ->> 'is_admin')::boolean, false)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create storage bucket for buck images
INSERT INTO storage.buckets (id, name, public)
VALUES ('buck-images', 'buck-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for buck images
CREATE POLICY "buck_images_storage_select" ON storage.objects FOR SELECT 
  USING (bucket_id = 'buck-images');
CREATE POLICY "buck_images_storage_insert" ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'buck-images');
CREATE POLICY "buck_images_storage_update" ON storage.objects FOR UPDATE 
  USING (bucket_id = 'buck-images');
CREATE POLICY "buck_images_storage_delete" ON storage.objects FOR DELETE 
  USING (bucket_id = 'buck-images');
