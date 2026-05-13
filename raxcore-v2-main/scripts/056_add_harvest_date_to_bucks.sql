-- Phase 56: Add harvest_date column to bucks table (if missing)
-- Safe migration - no-op if column already exists
-- 
-- NOTES:
-- - If this migration has already been applied elsewhere, the ALTER will no-op
-- - If schema mismatch persists after migration, PostgREST may need a schema cache reload
-- - To reload PostgREST schema cache: restart the Supabase project or wait ~60 seconds
-- - If using wrong project/env, the column still won't appear

-- Add harvest_date column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'bucks' 
    AND column_name = 'harvest_date'
  ) THEN
    ALTER TABLE public.bucks ADD COLUMN harvest_date date;
    COMMENT ON COLUMN public.bucks.harvest_date IS 'Optional harvest date for the buck';
  END IF;
END $$;

-- Verify column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'bucks' 
    AND column_name = 'harvest_date'
  ) THEN
    RAISE WARNING 'harvest_date column was not created - check permissions';
  ELSE
    RAISE NOTICE 'harvest_date column exists on bucks table';
  END IF;
END $$;
