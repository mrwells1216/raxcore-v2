-- Phase 57: Fix RLS policies for usage_records table
-- usage_records is internal server bookkeeping - only service_role should have access
-- Safe migration - drops existing policies first

-- Ensure RLS is enabled
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Service role full access usage_records" ON usage_records;
DROP POLICY IF EXISTS "Users can view own usage" ON usage_records;
DROP POLICY IF EXISTS "Allow insert for all" ON usage_records;
DROP POLICY IF EXISTS "Allow update for all" ON usage_records;

-- Create service role policy for internal server-side operations
-- This is the ONLY policy - no user-facing access to usage_records
CREATE POLICY "Service role full access usage_records" 
  ON usage_records 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- Verify policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'usage_records' 
    AND policyname = 'Service role full access usage_records'
  ) THEN
    RAISE EXCEPTION 'Policy was not created successfully';
  END IF;
END $$;

COMMENT ON TABLE usage_records IS 'Internal usage tracking - service_role access only';
