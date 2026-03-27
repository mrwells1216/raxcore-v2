-- Phase 19/20 Patch: Add snapshot columns for reproducible bulk runs
-- This migration adds columns to store example IDs and calibration profile IDs at run creation time

-- Add calibration profile columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'bulk_validation_runs' 
                 AND column_name = 'primary_calibration_profile_id') THEN
    ALTER TABLE bulk_validation_runs 
    ADD COLUMN primary_calibration_profile_id UUID REFERENCES calibration_profiles(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'bulk_validation_runs' 
                 AND column_name = 'comparison_calibration_profile_ids') THEN
    ALTER TABLE bulk_validation_runs 
    ADD COLUMN comparison_calibration_profile_ids UUID[] DEFAULT ARRAY[]::UUID[];
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'bulk_validation_runs' 
                 AND column_name = 'example_ids') THEN
    ALTER TABLE bulk_validation_runs 
    ADD COLUMN example_ids UUID[] DEFAULT NULL;
  END IF;
END $$;

-- Create index on example_ids for efficient lookups
CREATE INDEX IF NOT EXISTS idx_bulk_validation_runs_example_ids 
ON bulk_validation_runs USING GIN (example_ids);

-- Update the view to include new columns
CREATE OR REPLACE VIEW bulk_runs_with_models AS
SELECT 
  bvr.*,
  mv.version_name as primary_model_name,
  mv.is_active as primary_model_active,
  cp.name as primary_calibration_name
FROM bulk_validation_runs bvr
LEFT JOIN model_versions mv ON bvr.primary_model_version_id = mv.id
LEFT JOIN calibration_profiles cp ON bvr.primary_calibration_profile_id = cp.id;
