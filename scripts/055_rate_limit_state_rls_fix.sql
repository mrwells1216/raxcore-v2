-- STRICT PATCH: Fix rate_limit_state RLS for server-side scoring
-- Run this if scoring fails with: "new row violates row-level security policy for table rate_limit_state"

-- Ensure RLS is enabled
ALTER TABLE rate_limit_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists (safe)
DROP POLICY IF EXISTS "Service role full access rate_limit_state" ON rate_limit_state;

-- Create service role policy for internal server-side operations
CREATE POLICY "Service role full access rate_limit_state" 
  ON rate_limit_state 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- Verify policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'rate_limit_state' 
    AND policyname = 'Service role full access rate_limit_state'
  ) THEN
    RAISE EXCEPTION 'Policy was not created successfully';
  END IF;
END $$;
