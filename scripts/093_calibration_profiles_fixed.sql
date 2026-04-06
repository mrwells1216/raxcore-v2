-- Calibration profiles table for bias correction derived from training samples
-- This adds new columns to support segmented calibration

-- First, add the new columns if they don't exist
ALTER TABLE calibration_profiles
  ADD COLUMN IF NOT EXISTS profile_key TEXT,
  ADD COLUMN IF NOT EXISTS profile_type TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS rack_type TEXT,
  ADD COLUMN IF NOT EXISTS sample_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_bias NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_bias NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_mae NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_mae NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_multiplier NUMERIC DEFAULT 1.0;

-- Create unique constraint on profile_key if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'calibration_profiles_profile_key_key'
  ) THEN
    ALTER TABLE calibration_profiles ADD CONSTRAINT calibration_profiles_profile_key_key UNIQUE (profile_key);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_profile_type
  ON calibration_profiles(profile_type);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_state
  ON calibration_profiles(state);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_rack_type
  ON calibration_profiles(rack_type);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_is_active
  ON calibration_profiles(is_active);
