-- ============================================================================
-- PHASE 49: MULTI-VIEW FUSION DATA MODEL
-- ============================================================================
-- This migration creates the data model for multi-image fusion scoring.
-- Tables: mv_sets, mv_views, mv_edges, mv_solution

-- ============================================================================
-- MULTI-VIEW SETS (Main container for a multi-image scoring request)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'building_graph', 'scoring_pairs', 'fusing_families', 
    'solving_geometry', 'completed', 'failed', 'fallback_used'
  )),
  
  -- Method and configuration
  method TEXT NOT NULL DEFAULT 'graph_fusion' CHECK (method IN (
    'graph_fusion', 'weighted_average', 'best_single', 'ransac_fusion'
  )),
  
  -- Image count and quality
  image_count INTEGER NOT NULL DEFAULT 0,
  accepted_view_count INTEGER DEFAULT 0,
  rejected_view_count INTEGER DEFAULT 0,
  
  -- Graph quality metrics
  graph_connectivity_score REAL,
  strongest_subgraph_size INTEGER,
  
  -- Processing metadata
  processing_time_ms INTEGER,
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for mv_sets
CREATE INDEX IF NOT EXISTS idx_mv_sets_prediction ON mv_sets(prediction_id);
CREATE INDEX IF NOT EXISTS idx_mv_sets_buck ON mv_sets(buck_id);
CREATE INDEX IF NOT EXISTS idx_mv_sets_user ON mv_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_mv_sets_status ON mv_sets(status);
CREATE INDEX IF NOT EXISTS idx_mv_sets_created ON mv_sets(created_at DESC);

-- ============================================================================
-- MULTI-VIEW VIEWS (Individual images in the set)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE,
  
  -- Image reference
  buck_image_id UUID REFERENCES buck_images(id) ON DELETE SET NULL,
  image_index INTEGER NOT NULL,
  
  -- Angle classification
  angle_class TEXT NOT NULL CHECK (angle_class IN (
    'front', 'left', 'right', 'back', 'front_left', 'front_right', 'unknown'
  )),
  angle_confidence REAL,
  
  -- Reference quality summary
  reference_quality_score REAL,
  ear_reference_quality TEXT CHECK (ear_reference_quality IN ('strong', 'moderate', 'weak', 'none')),
  has_scale_reference BOOLEAN DEFAULT FALSE,
  
  -- Landmark summary
  landmark_count INTEGER DEFAULT 0,
  landmark_confidence_avg REAL,
  key_landmarks_detected TEXT[], -- Array of detected landmark keys
  
  -- View scoring summary
  view_overall_score REAL,
  spread_contribution_score REAL,
  beam_contribution_score REAL,
  tine_contribution_score REAL,
  mass_contribution_score REAL,
  
  -- Per-family measurements from this view
  view_measurements JSONB,
  
  -- Acceptance status
  is_accepted BOOLEAN DEFAULT TRUE,
  rejection_reason TEXT,
  is_primary_view BOOLEAN DEFAULT FALSE,
  
  -- Outlier detection
  is_outlier BOOLEAN DEFAULT FALSE,
  outlier_score REAL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for mv_views
CREATE INDEX IF NOT EXISTS idx_mv_views_set ON mv_views(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_views_image ON mv_views(buck_image_id);
CREATE INDEX IF NOT EXISTS idx_mv_views_angle ON mv_views(angle_class);
CREATE INDEX IF NOT EXISTS idx_mv_views_accepted ON mv_views(is_accepted);

-- ============================================================================
-- MULTI-VIEW EDGES (Pairwise view relationships)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE,
  
  -- View pair
  view_a_id UUID NOT NULL REFERENCES mv_views(id) ON DELETE CASCADE,
  view_b_id UUID NOT NULL REFERENCES mv_views(id) ON DELETE CASCADE,
  
  -- Match quality metrics
  match_quality REAL NOT NULL DEFAULT 0,
  landmark_overlap_score REAL,
  reference_compatibility_score REAL,
  angle_complementarity_score REAL,
  geometric_plausibility_score REAL,
  
  -- Inlier analysis
  inlier_count INTEGER DEFAULT 0,
  outlier_count INTEGER DEFAULT 0,
  inlier_ratio REAL,
  
  -- Geometric consistency
  geometric_consistency_score REAL,
  scale_agreement_score REAL,
  structure_agreement_score REAL,
  
  -- Family-level agreement
  spread_agreement_score REAL,
  beam_agreement_score REAL,
  tine_agreement_score REAL,
  mass_agreement_score REAL,
  
  -- Acceptance for fusion
  accepted_for_fusion BOOLEAN DEFAULT FALSE,
  rejection_reason TEXT,
  edge_weight REAL DEFAULT 1.0, -- Weight for graph algorithms
  
  -- Additional metadata
  metadata JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure unique pairs (order-independent)
  CONSTRAINT unique_view_pair UNIQUE (mv_set_id, view_a_id, view_b_id)
);

-- Indexes for mv_edges
CREATE INDEX IF NOT EXISTS idx_mv_edges_set ON mv_edges(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_edges_view_a ON mv_edges(view_a_id);
CREATE INDEX IF NOT EXISTS idx_mv_edges_view_b ON mv_edges(view_b_id);
CREATE INDEX IF NOT EXISTS idx_mv_edges_accepted ON mv_edges(accepted_for_fusion);
CREATE INDEX IF NOT EXISTS idx_mv_edges_quality ON mv_edges(match_quality DESC);

-- ============================================================================
-- MULTI-VIEW SOLUTION (Final fused result)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_solution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE UNIQUE,
  
  -- Solution method
  method TEXT NOT NULL CHECK (method IN (
    'full_graph_fusion', 'subgraph_fusion', 'dominant_view', 
    'weighted_blend', 'single_view_fallback', 'ransac_consensus'
  )),
  
  -- Fused measurements
  fused_measurements JSONB NOT NULL,
  
  -- Per-family fusion details
  family_fusion_details JSONB, -- Per-family: views used, weights, disagreement
  
  -- Fused uncertainty
  fused_uncertainty JSONB,
  gross_error_band_low REAL,
  gross_error_band_high REAL,
  net_error_band_low REAL,
  net_error_band_high REAL,
  
  -- Disagreement summary
  disagreement_summary JSONB,
  max_family_disagreement REAL,
  avg_family_disagreement REAL,
  high_disagreement_families TEXT[],
  
  -- Fallback information
  fallback_used BOOLEAN DEFAULT FALSE,
  fallback_reason TEXT,
  fallback_source_view_id UUID REFERENCES mv_views(id),
  
  -- Primary views chosen
  chosen_primary_views JSONB, -- Per-family primary view selections
  
  -- Quality metrics
  solution_confidence REAL,
  solution_quality_tier TEXT CHECK (solution_quality_tier IN (
    'excellent', 'good', 'fair', 'poor', 'fallback'
  )),
  
  -- Comparison with single-view
  improvement_vs_single_view REAL, -- Expected error reduction %
  
  -- Processing info
  processing_time_ms INTEGER,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for mv_solution
CREATE INDEX IF NOT EXISTS idx_mv_solution_set ON mv_solution(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_solution_method ON mv_solution(method);
CREATE INDEX IF NOT EXISTS idx_mv_solution_fallback ON mv_solution(fallback_used);
CREATE INDEX IF NOT EXISTS idx_mv_solution_quality ON mv_solution(solution_quality_tier);

-- ============================================================================
-- MULTI-VIEW FAMILY SUPPORT (Per-family view contributions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_family_support (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_solution_id UUID NOT NULL REFERENCES mv_solution(id) ON DELETE CASCADE,
  
  -- Family identification
  family TEXT NOT NULL CHECK (family IN ('spread', 'beam', 'tine', 'mass', 'asymmetry')),
  
  -- Primary supporting view
  primary_view_id UUID REFERENCES mv_views(id),
  primary_view_weight REAL,
  primary_view_measurement REAL,
  
  -- Secondary supporting views
  secondary_view_ids UUID[],
  secondary_view_weights REAL[],
  secondary_view_measurements REAL[],
  
  -- Fused family estimate
  fused_estimate REAL,
  fused_uncertainty REAL,
  
  -- Disagreement metrics
  disagreement_score REAL,
  max_deviation REAL,
  std_deviation REAL,
  
  -- Quality assessment
  support_quality TEXT CHECK (support_quality IN ('strong', 'moderate', 'weak', 'insufficient')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_family_per_solution UNIQUE (mv_solution_id, family)
);

-- Indexes for mv_family_support
CREATE INDEX IF NOT EXISTS idx_mv_family_solution ON mv_family_support(mv_solution_id);
CREATE INDEX IF NOT EXISTS idx_mv_family_type ON mv_family_support(family);
CREATE INDEX IF NOT EXISTS idx_mv_family_quality ON mv_family_support(support_quality);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Update mv_sets.updated_at on changes
CREATE OR REPLACE FUNCTION update_mv_sets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mv_sets_updated_at ON mv_sets;
CREATE TRIGGER trigger_mv_sets_updated_at
  BEFORE UPDATE ON mv_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_mv_sets_updated_at();

-- Function to compute view pair canonical ordering
CREATE OR REPLACE FUNCTION canonical_view_pair(view_a UUID, view_b UUID)
RETURNS TABLE(first_view UUID, second_view UUID) AS $$
BEGIN
  IF view_a < view_b THEN
    RETURN QUERY SELECT view_a, view_b;
  ELSE
    RETURN QUERY SELECT view_b, view_a;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE mv_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mv_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE mv_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mv_solution ENABLE ROW LEVEL SECURITY;
ALTER TABLE mv_family_support ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access on mv_sets" ON mv_sets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on mv_views" ON mv_views
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on mv_edges" ON mv_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on mv_solution" ON mv_solution
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on mv_family_support" ON mv_family_support
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can view their own multi-view sets
CREATE POLICY "Users can view own mv_sets" ON mv_sets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE mv_sets IS 'Multi-view fusion scoring sets - container for multi-image scoring requests';
COMMENT ON TABLE mv_views IS 'Individual views/images within a multi-view set';
COMMENT ON TABLE mv_edges IS 'Pairwise relationships between views in a multi-view set';
COMMENT ON TABLE mv_solution IS 'Final fused solution from multi-view scoring';
COMMENT ON TABLE mv_family_support IS 'Per-family view contributions to the fused solution';
