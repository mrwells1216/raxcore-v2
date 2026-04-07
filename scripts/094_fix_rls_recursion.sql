-- Migration: Fix RLS infinite recursion on profiles table
-- Problem: policies on profiles that query profiles cause recursion
-- Solution: Create a SECURITY DEFINER function to bypass RLS when checking admin status

-- ============================================
-- 1. CREATE ADMIN CHECK FUNCTION (SECURITY DEFINER)
-- ============================================
-- This function runs with the privileges of the function owner (postgres)
-- and bypasses RLS, preventing the recursion loop

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- ============================================
-- 2. FIX PROFILES TABLE POLICIES
-- ============================================
-- Drop the problematic recursive admin select policy
DROP POLICY IF EXISTS "profiles_admin_select" ON profiles;

-- The existing policies are fine:
-- - profiles_select_own: auth.uid() = id (direct comparison, no recursion)
-- - profiles_insert_own: auth.uid() = id (direct comparison, no recursion)  
-- - profiles_update_own: auth.uid() = id (direct comparison, no recursion)

-- Add admin select policy using the safe function
CREATE POLICY "profiles_admin_select" ON profiles FOR SELECT 
  USING (public.is_admin());

-- ============================================
-- 3. FIX BUCKS TABLE POLICIES
-- ============================================
-- Drop existing policies that reference profiles
DROP POLICY IF EXISTS "bucks_admin_all" ON bucks;
DROP POLICY IF EXISTS "bucks_user_update" ON bucks;
DROP POLICY IF EXISTS "bucks_user_delete" ON bucks;

-- Recreate admin policy using safe function
CREATE POLICY "bucks_admin_all" ON bucks FOR ALL 
  USING (public.is_admin());

-- Recreate user update policy (from 032_user_auth_tables.sql)
CREATE POLICY "bucks_user_update" ON bucks FOR UPDATE USING (
  auth.uid() = user_id 
  OR user_id IS NULL
  OR public.is_admin()
);

-- Recreate user delete policy
CREATE POLICY "bucks_user_delete" ON bucks FOR DELETE USING (
  auth.uid() = user_id
  OR public.is_admin()
);

-- ============================================
-- 4. FIX BUCK_IMAGES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "buck_images_admin_all" ON buck_images;

CREATE POLICY "buck_images_admin_all" ON buck_images FOR ALL 
  USING (public.is_admin());

-- ============================================
-- 5. FIX PREDICTIONS TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "predictions_admin_all" ON predictions;

CREATE POLICY "predictions_admin_all" ON predictions FOR ALL 
  USING (public.is_admin());

-- ============================================
-- 6. FIX GROUND_TRUTH_SCORES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "ground_truth_admin_all" ON ground_truth_scores;

CREATE POLICY "ground_truth_admin_all" ON ground_truth_scores FOR ALL 
  USING (public.is_admin());

-- ============================================
-- 7. FIX TRAINING_EXAMPLES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "training_examples_admin_all" ON training_examples;

CREATE POLICY "training_examples_admin_all" ON training_examples FOR ALL 
  USING (public.is_admin());

-- ============================================
-- 8. FIX MODEL_VERSIONS TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "model_versions_admin_write" ON model_versions;

CREATE POLICY "model_versions_admin_write" ON model_versions FOR ALL 
  USING (public.is_admin());

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
BEGIN
  -- Verify the function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'is_admin' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE EXCEPTION 'is_admin() function was not created';
  END IF;
  
  RAISE NOTICE 'RLS recursion fix applied successfully';
END $$;
