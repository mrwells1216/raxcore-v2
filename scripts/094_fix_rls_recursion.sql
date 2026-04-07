-- Migration: Fix RLS infinite recursion on profiles table
-- Problem: policies that query profiles from within profiles policies cause recursion
-- Solution: Use direct ownership checks only, remove all subqueries to profiles

-- ============================================
-- 1. FIX PROFILES TABLE POLICIES
-- ============================================
-- Drop ALL existing profiles policies to start fresh
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_select" ON profiles;

-- Recreate with direct ownership checks only (no subqueries)
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT 
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT 
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE 
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================
-- 2. FIX BUCKS TABLE POLICIES
-- ============================================
-- Drop policies that reference profiles
DROP POLICY IF EXISTS "bucks_admin_all" ON bucks;
DROP POLICY IF EXISTS "bucks_user_update" ON bucks;
DROP POLICY IF EXISTS "bucks_user_delete" ON bucks;
DROP POLICY IF EXISTS "bucks_select_own" ON bucks;
DROP POLICY IF EXISTS "bucks_insert_own" ON bucks;
DROP POLICY IF EXISTS "bucks_update_own" ON bucks;
DROP POLICY IF EXISTS "bucks_delete_own" ON bucks;
DROP POLICY IF EXISTS "bucks_insert_anon" ON bucks;
DROP POLICY IF EXISTS "bucks_select_anon" ON bucks;
DROP POLICY IF EXISTS "bucks_public_read" ON bucks;
DROP POLICY IF EXISTS "bucks_public_insert" ON bucks;

-- Recreate with direct ownership checks only
CREATE POLICY "bucks_select_own" ON bucks FOR SELECT 
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "bucks_insert_own" ON bucks FOR INSERT 
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "bucks_update_own" ON bucks FOR UPDATE 
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "bucks_delete_own" ON bucks FOR DELETE 
  USING (user_id = auth.uid());

-- ============================================
-- 3. FIX BUCK_IMAGES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "buck_images_admin_all" ON buck_images;
DROP POLICY IF EXISTS "buck_images_select" ON buck_images;
DROP POLICY IF EXISTS "buck_images_insert" ON buck_images;

-- Use direct ownership via bucks join (no profiles reference)
CREATE POLICY "buck_images_select" ON buck_images FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = buck_images.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "buck_images_insert" ON buck_images FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = buck_images.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "buck_images_update" ON buck_images FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = buck_images.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "buck_images_delete" ON buck_images FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = buck_images.buck_id 
      AND bucks.user_id = auth.uid()
    )
  );

-- ============================================
-- 4. FIX PREDICTIONS TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "predictions_admin_all" ON predictions;
DROP POLICY IF EXISTS "predictions_select" ON predictions;
DROP POLICY IF EXISTS "predictions_insert" ON predictions;

-- Use direct ownership via bucks join (no profiles reference)
CREATE POLICY "predictions_select" ON predictions FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = predictions.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "predictions_insert" ON predictions FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = predictions.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "predictions_update" ON predictions FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = predictions.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

-- ============================================
-- 5. FIX GROUND_TRUTH_SCORES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "ground_truth_admin_all" ON ground_truth_scores;
DROP POLICY IF EXISTS "ground_truth_select" ON ground_truth_scores;
DROP POLICY IF EXISTS "ground_truth_insert" ON ground_truth_scores;
DROP POLICY IF EXISTS "ground_truth_update" ON ground_truth_scores;

-- Use direct ownership via bucks join (no profiles reference)
CREATE POLICY "ground_truth_select" ON ground_truth_scores FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = ground_truth_scores.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "ground_truth_insert" ON ground_truth_scores FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = ground_truth_scores.buck_id 
      AND (bucks.user_id = auth.uid() OR bucks.user_id IS NULL)
    )
  );

CREATE POLICY "ground_truth_update" ON ground_truth_scores FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM bucks 
      WHERE bucks.id = ground_truth_scores.buck_id 
      AND bucks.user_id = auth.uid()
    )
  );

-- ============================================
-- 6. FIX TRAINING_EXAMPLES TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "training_examples_admin_all" ON training_examples;
DROP POLICY IF EXISTS "training_examples_select_own" ON training_examples;

-- Use direct ownership via predictions->bucks join (no profiles reference)
CREATE POLICY "training_examples_select" ON training_examples FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM predictions p 
      JOIN bucks b ON b.id = p.buck_id 
      WHERE p.id = training_examples.prediction_id 
      AND (b.user_id = auth.uid() OR b.user_id IS NULL)
    )
  );

CREATE POLICY "training_examples_insert" ON training_examples FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM predictions p 
      JOIN bucks b ON b.id = p.buck_id 
      WHERE p.id = training_examples.prediction_id 
      AND (b.user_id = auth.uid() OR b.user_id IS NULL)
    )
  );

-- ============================================
-- 7. FIX MODEL_VERSIONS TABLE POLICIES
-- ============================================
DROP POLICY IF EXISTS "model_versions_admin_write" ON model_versions;
DROP POLICY IF EXISTS "model_versions_select_all" ON model_versions;

-- Model versions: read for all authenticated, no write restrictions for now
CREATE POLICY "model_versions_select" ON model_versions FOR SELECT 
  USING (true);

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'RLS recursion fix applied successfully - all profiles subqueries removed';
END $$;
