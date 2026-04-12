-- 070_calibration_profiles_clean.sql
-- Creates calibration_profiles table from scratch

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS calibration_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  parameters JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

-- Create index for active profiles
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_active 
ON calibration_profiles(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE calibration_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "calibration_profiles_read_policy" ON calibration_profiles;
DROP POLICY IF EXISTS "calibration_profiles_write_policy" ON calibration_profiles;

-- Create read policy (anyone can read)
CREATE POLICY "calibration_profiles_read_policy" 
ON calibration_profiles FOR SELECT 
USING (true);

-- Create write policy (only admins can write)
CREATE POLICY "calibration_profiles_write_policy" 
ON calibration_profiles FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_admin = true
  )
);

-- Insert default profile if none exists
INSERT INTO calibration_profiles (name, description, is_active, parameters)
SELECT 
  'default',
  'Default calibration profile with no adjustments',
  true,
  '{
    "gross_offset": 0,
    "net_offset": 0,
    "confidence_floor": 50,
    "confidence_ceiling": 95
  }'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM calibration_profiles WHERE is_active = true
);
