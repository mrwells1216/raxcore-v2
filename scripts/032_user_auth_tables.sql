-- Phase 32: User Auth & Library Tables
-- This migration adds user profiles, updates bucks table with user_id, and sets up RLS

-- ============================================
-- 1. PROFILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- 2. AUTO-CREATE PROFILE ON SIGNUP TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. ADD USER_ID TO BUCKS TABLE
-- ============================================
ALTER TABLE bucks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add session_id column for guest tracking (to claim bucks later)
ALTER TABLE bucks ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_bucks_user_id ON bucks(user_id);
CREATE INDEX IF NOT EXISTS idx_bucks_session_id ON bucks(session_id);

-- ============================================
-- 4. RLS FOR BUCKS TABLE
-- ============================================
ALTER TABLE bucks ENABLE ROW LEVEL SECURITY;

-- Allow public read (guest scoring needs to view results)
DROP POLICY IF EXISTS "bucks_public_read" ON bucks;
CREATE POLICY "bucks_public_read" ON bucks FOR SELECT USING (true);

-- Allow anyone to insert (guest scoring)
DROP POLICY IF EXISTS "bucks_public_insert" ON bucks;
CREATE POLICY "bucks_public_insert" ON bucks FOR INSERT WITH CHECK (true);

-- Allow user to update their own bucks or unclaimed bucks
DROP POLICY IF EXISTS "bucks_user_update" ON bucks;
CREATE POLICY "bucks_user_update" ON bucks FOR UPDATE USING (
  auth.uid() = user_id 
  OR user_id IS NULL
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Allow user to delete their own bucks
DROP POLICY IF EXISTS "bucks_user_delete" ON bucks;
CREATE POLICY "bucks_user_delete" ON bucks FOR DELETE USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- ============================================
-- 5. UPDATE TIMESTAMP TRIGGER FOR PROFILES
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
