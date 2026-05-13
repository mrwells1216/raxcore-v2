-- Phase 20: Calibration Profiles & Model Version Audit Trail
-- Run this migration to add calibration controls and rollback support

-- Calibration profiles table
CREATE TABLE IF NOT EXISTS calibration_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  model_version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
  
  -- Correction weights (0.0 to 2.0, 1.0 = default)
  spread_correction_weight DECIMAL(4,2) DEFAULT 1.0 CHECK (spread_correction_weight >= 0 AND spread_correction_weight <= 2),
  beam_correction_weight DECIMAL(4,2) DEFAULT 1.0 CHECK (beam_correction_weight >= 0 AND beam_correction_weight <= 2),
  tine_correction_weight DECIMAL(4,2) DEFAULT 1.0 CHECK (tine_correction_weight >= 0 AND tine_correction_weight <= 2),
  mass_correction_weight DECIMAL(4,2) DEFAULT 1.0 CHECK (mass_correction_weight >= 0 AND mass_correction_weight <= 2),
  deduction_correction_weight DECIMAL(4,2) DEFAULT 1.0 CHECK (deduction_correction_weight >= 0 AND deduction_correction_weight <= 2),
  
  -- Confidence and learning
  confidence_scaling DECIMAL(4,2) DEFAULT 1.0 CHECK (confidence_scaling >= 0.5 AND confidence_scaling <= 1.5),
  learning_correction_strength DECIMAL(4,2) DEFAULT 1.0 CHECK (learning_correction_strength >= 0 AND learning_correction_strength <= 2),
  
  -- Caps (max correction amounts in inches)
  max_total_correction DECIMAL(5,2) DEFAULT 8.0 CHECK (max_total_correction >= 1 AND max_total_correction <= 15),
  max_spread_correction DECIMAL(4,2) DEFAULT 3.0 CHECK (max_spread_correction >= 0.5 AND max_spread_correction <= 6),
  max_beam_correction DECIMAL(4,2) DEFAULT 4.0 CHECK (max_beam_correction >= 0.5 AND max_beam_correction <= 8),
  max_tine_correction DECIMAL(4,2) DEFAULT 2.0 CHECK (max_tine_correction >= 0.5 AND max_tine_correction <= 4),
  max_mass_correction DECIMAL(4,2) DEFAULT 1.0 CHECK (max_mass_correction >= 0.2 AND max_mass_correction <= 2),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Calibration changes audit trail
CREATE TABLE IF NOT EXISTS calibration_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibration_profile_id UUID REFERENCES calibration_profiles(id) ON DELETE SET NULL,
  model_version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN (
    'calibration_created',
    'calibration_updated',
    'calibration_activated',
    'calibration_deactivated',
    'model_activated',
    'model_rollback'
  )),
  old_values JSONB,
  new_values JSONB,
  changed_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model activation events (for rollback tracking)
CREATE TABLE IF NOT EXISTS model_activation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version_id UUID NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
  previous_model_version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
  calibration_profile_id UUID REFERENCES calibration_profiles(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  activated_by TEXT,
  reason TEXT,
  is_rollback BOOLEAN DEFAULT false
);

-- Add calibration_profile_id and calibration_snapshot to predictions for historical tracking
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS calibration_profile_id UUID REFERENCES calibration_profiles(id) ON DELETE SET NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS calibration_snapshot JSONB;

-- Add last_activated_at to model_versions
ALTER TABLE model_versions
ADD COLUMN IF NOT EXISTS last_activated_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_model_version ON calibration_profiles(model_version_id);
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_active ON calibration_profiles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_calibration_changes_profile ON calibration_changes(calibration_profile_id);
CREATE INDEX IF NOT EXISTS idx_calibration_changes_model ON calibration_changes(model_version_id);
CREATE INDEX IF NOT EXISTS idx_calibration_changes_created ON calibration_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_activation_events_model ON model_activation_events(model_version_id);
CREATE INDEX IF NOT EXISTS idx_model_activation_events_activated ON model_activation_events(activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_calibration ON predictions(calibration_profile_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_calibration_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS calibration_profiles_updated_at ON calibration_profiles;
CREATE TRIGGER calibration_profiles_updated_at
  BEFORE UPDATE ON calibration_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_calibration_profiles_updated_at();

-- Create default calibration profile
INSERT INTO calibration_profiles (
  name,
  description,
  is_active,
  spread_correction_weight,
  beam_correction_weight,
  tine_correction_weight,
  mass_correction_weight,
  deduction_correction_weight,
  confidence_scaling,
  learning_correction_strength,
  max_total_correction,
  max_spread_correction,
  max_beam_correction,
  max_tine_correction,
  max_mass_correction
) VALUES (
  'Default Profile',
  'System default calibration profile with balanced correction weights.',
  true,
  1.0, 1.0, 1.0, 1.0, 1.0,
  1.0, 1.0,
  8.0, 3.0, 4.0, 2.0, 1.0
) ON CONFLICT DO NOTHING;
