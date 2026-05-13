-- Migration 095: Add profile_key and segmented calibration columns to calibration_profiles
--
-- Context: The table was created by early migrations (009, 070) without profile_key.
-- Scripts 091 and 093 defined the desired schema but were either not run or ran against
-- a pre-existing table that already had different columns. This migration safely adds
-- every column the calibration lookup code in lib/calibration.ts requires without
-- touching existing rows or constraints.

-- Add missing columns (safe: IF NOT EXISTS is idempotent)
ALTER TABLE calibration_profiles
  ADD COLUMN IF NOT EXISTS profile_key       TEXT,
  ADD COLUMN IF NOT EXISTS profile_type      TEXT,
  ADD COLUMN IF NOT EXISTS state             TEXT,
  ADD COLUMN IF NOT EXISTS rack_type         TEXT,
  ADD COLUMN IF NOT EXISTS sample_count      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_bias        NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_bias          NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_mae         NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_mae           NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_multiplier NUMERIC NOT NULL DEFAULT 1.0;

-- Add unique constraint on profile_key (guarded: only if it does not already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calibration_profiles_profile_key_key'
  ) THEN
    -- Null out any duplicate profile_key values before adding the constraint
    -- (existing rows from old migrations will have NULL profile_key, which is fine
    --  because UNIQUE constraints allow multiple NULLs in PostgreSQL)
    ALTER TABLE calibration_profiles
      ADD CONSTRAINT calibration_profiles_profile_key_key UNIQUE (profile_key);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN
    RAISE NOTICE 'Could not add profile_key unique constraint: %', SQLERRM;
END $$;

-- Indexes for segmented calibration lookups
CREATE INDEX IF NOT EXISTS idx_calibration_profiles_profile_key
  ON calibration_profiles (profile_key)
  WHERE profile_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_profile_type
  ON calibration_profiles (profile_type);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_state
  ON calibration_profiles (state);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_rack_type
  ON calibration_profiles (rack_type);

-- Backfill: mark the existing default row with the 'global' profile_key so the
-- calibration lookup can find it immediately without needing a rebuild run.
UPDATE calibration_profiles
SET
  profile_key  = 'global',
  profile_type = 'global',
  sample_count = COALESCE(sample_count, 0)
WHERE profile_key IS NULL
  AND is_active  = true;
