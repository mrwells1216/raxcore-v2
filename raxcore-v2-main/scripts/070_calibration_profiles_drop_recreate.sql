-- Drop existing calibration_profiles table if it exists (may be incomplete from failed migration)
DROP TABLE IF EXISTS calibration_profiles CASCADE;

-- Create calibration_profiles table fresh
CREATE TABLE calibration_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  parameters JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for active profile lookup
CREATE INDEX idx_calibration_profiles_active ON calibration_profiles(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE calibration_profiles ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist
DROP POLICY IF EXISTS "calibration_profiles_read_policy" ON calibration_profiles;
DROP POLICY IF EXISTS "calibration_profiles_admin_policy" ON calibration_profiles;

-- Create read policy for all authenticated users
CREATE POLICY "calibration_profiles_read_policy" ON calibration_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Create admin policy for modifications
CREATE POLICY "calibration_profiles_admin_policy" ON calibration_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Insert default profile
INSERT INTO calibration_profiles (name, description, is_active, parameters)
VALUES (
  'Default',
  'Default calibration profile with no adjustments',
  true,
  '{
    "gross_offset": 0,
    "net_offset": 0,
    "confidence_threshold": 50,
    "state_adjustments": {}
  }'::jsonb
);
