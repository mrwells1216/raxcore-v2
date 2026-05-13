-- RutAI / XRacks Core Tables
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Model versions table
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

INSERT INTO model_versions (version_name, description, is_active)
VALUES ('v1.0.0-beta', 'Initial beta model using anatomical scaling references', true)
ON CONFLICT (version_name) DO NOTHING;

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bucks table
CREATE TABLE IF NOT EXISTS bucks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  rack_type TEXT NOT NULL CHECK (rack_type IN ('typical', 'non-typical')),
  harvest_method TEXT CHECK (harvest_method IN ('bow', 'rifle', 'muzzleloader', 'crossbow', 'other', NULL)),
  source_type TEXT CHECK (source_type IN ('live_deer', 'mount', 'trail_cam', 'harvest_photo', 'other')),
  ears_fully_visible BOOLEAN,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Buck images table
CREATE TABLE IF NOT EXISTS buck_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  angle_type TEXT CHECK (angle_type IN ('front', 'left', 'right', 'back', 'other')),
  capture_method TEXT CHECK (capture_method IN ('camera', 'upload')),
  file_type TEXT,
  file_size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  quality_score DECIMAL(3,2),
  landmarks_detected JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Predictions table
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  model_version_id UUID REFERENCES model_versions(id),
  predicted_gross DECIMAL(5,1),
  predicted_net DECIMAL(5,1),
  confidence_percent DECIMAL(4,1),
  error_band_low DECIMAL(5,1),
  error_band_high DECIMAL(5,1),
  measurements JSONB,
  landmarks JSONB,
  state_calibration JSONB,
  processing_time_ms INTEGER,
  images_used INTEGER,
  angle_diversity_score DECIMAL(3,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ground truth scores table
CREATE TABLE IF NOT EXISTS ground_truth_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  official_gross DECIMAL(5,1),
  official_net DECIMAL(5,1),
  score_source TEXT CHECK (score_source IN ('official_scorer', 'self_measured', 'user_reported', 'estimated')),
  scorer_name TEXT,
  scoring_organization TEXT,
  is_typical BOOLEAN,
  harvest_year INTEGER,
  verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training examples table
CREATE TABLE IF NOT EXISTS training_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  ground_truth_id UUID NOT NULL REFERENCES ground_truth_scores(id) ON DELETE CASCADE,
  gross_error DECIMAL(5,1),
  net_error DECIMAL(5,1),
  abs_gross_error DECIMAL(5,1),
  abs_net_error DECIMAL(5,1),
  verified_for_training BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  quality_flags JSONB,
  target_model_version TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bucks_user_id ON bucks(user_id);
CREATE INDEX IF NOT EXISTS idx_bucks_state ON bucks(state);
CREATE INDEX IF NOT EXISTS idx_bucks_status ON bucks(status);
CREATE INDEX IF NOT EXISTS idx_buck_images_buck_id ON buck_images(buck_id);
CREATE INDEX IF NOT EXISTS idx_predictions_buck_id ON predictions(buck_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_buck_id ON ground_truth_scores(buck_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_verified ON training_examples(verified_for_training);
