-- ============================================================================
-- Calibration Profiles Table
-- ============================================================================
-- Creates the calibration_profiles table for storing scoring model calibration
-- parameters. This table is optional but eliminates startup warnings.
-- ============================================================================

-- Create calibration_profiles table if not exists
CREATE TABLE IF NOT EXISTS calibration_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  name TEXT NOT NULL,
  description TEXT,
  
  -- Model association
  model_version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
  
  -- Status
  is_active BOOLEAN DEFAULT false,
  
  -- Calibration parameters (stored as JSONB for flexibility)
  -- Typical structure:
  -- {
  --   "score_multiplier": 1.0,
  --   "confidence_threshold": 0.7,
  --   "measurement_adjustments": { "inside_spread": 0, "main_beam": 0, ... }
  -- }
  parameters JSONB DEFAULT '{}',
  
  -- Validation metrics from test runs
  validation_metrics JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for active profile lookup
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_active 
  ON calibration_profiles(is_active) WHERE is_active = true;

-- Create index for model version lookup
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_model_version 
  ON calibration_profiles(model_version_id);

-- Add RLS policies
ALTER TABLE calibration_profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read calibration profiles
CREATE POLICY IF NOT EXISTS "calibration_profiles_read_policy"
  ON calibration_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access
CREATE POLICY IF NOT EXISTS "calibration_profiles_service_policy"
  ON calibration_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Insert a default profile if none exists
INSERT INTO calibration_profiles (name, description, is_active, parameters)
SELECT 
  'Default',
  'Default calibration profile with no adjustments',
  true,
  '{
    "score_multiplier": 1.0,
    "confidence_threshold": 0.7,
    "measurement_adjustments": {}
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM calibration_profiles LIMIT 1);

-- Update function to keep updated_at current
CREATE OR REPLACE FUNCTION update_calibration_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS calibration_profiles_updated_at ON calibration_profiles;
CREATE TRIGGER calibration_profiles_updated_at
  BEFORE UPDATE ON calibration_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_calibration_profiles_updated_at();
