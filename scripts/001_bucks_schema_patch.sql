-- STRICT PATCH: Add missing columns to public.bucks
-- Columns expected by lib/storage/service.ts createBuck():
--   session_id, nickname, location, notes, status, harvest_date
-- Columns already in schema: notes, status
-- This patch adds: session_id, nickname, location, harvest_date

-- Add session_id column (links to scoring session)
ALTER TABLE public.bucks 
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add nickname column (user-provided name for the buck)
ALTER TABLE public.bucks 
ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Add location column (where buck was harvested/spotted)
ALTER TABLE public.bucks 
ADD COLUMN IF NOT EXISTS location TEXT;

-- Add harvest_date column (when buck was harvested)
ALTER TABLE public.bucks 
ADD COLUMN IF NOT EXISTS harvest_date DATE;

-- Create index on session_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_bucks_session_id ON public.bucks(session_id);

-- Verify columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bucks' AND column_name = 'session_id') THEN
    RAISE EXCEPTION 'session_id column was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bucks' AND column_name = 'location') THEN
    RAISE EXCEPTION 'location column was not created';
  END IF;
END $$;
