-- Phase 49: Multi-View Fusion + Cross-View Geometry Solving
-- This migration creates the schema for multi-image scoring sets

-- Multi-view scoring sets (the parent container for a multi-image solve)
CREATE TABLE IF NOT EXISTS mv_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'fallback_used')),
  method TEXT NOT NULL DEFAULT 'graph_fusion' CHECK (method IN ('graph_fusion', 'weighted_average', 'dominant_view', 'single_view_fallback')),
  image_count INTEGER NOT NULL DEFAULT 0,
  -- Graph quality metrics
  graph_connectivity_score NUMERIC(4,3),
  strongest_subgraph_size INTEGER,
  total_edges INTEGER,
  accepted_edges INTEGER,
  -- Solve quality
  solve_quality_score NUMERIC(4,3),
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  fallback_source_prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  -- Processing metadata
  processing_time_ms INTEGER,
  error_message TEXT,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual views within a multi-view set
CREATE TABLE IF NOT EXISTS mv_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE,
  image_id UUID REFERENCES buck_images(id) ON DELETE SET NULL,
  image_index INTEGER NOT NULL,
  -- Angle classification
  angle_class TEXT NOT NULL CHECK (angle_class IN ('front', 'left', 'right', 'back', 'other')),
  angle_confidence NUMERIC(4,3),
  -- Reference quality for this view
  reference_quality_summary JSONB DEFAULT '{}',
  -- Landmark detection summary
  landmark_summary JSONB DEFAULT '{}',
  landmark_confidence NUMERIC(4,3),
  -- Per-view scoring result
  view_score_summary JSONB DEFAULT '{}',
  view_confidence NUMERIC(4,3),
  -- Trust scores per measurement family
  trust_scores JSONB DEFAULT '{}',
  overall_trust_score NUMERIC(4,3),
  -- Status flags
  is_accepted BOOLEAN NOT NULL DEFAULT TRUE,
  is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pairwise view relationships (edges in the view graph)
CREATE TABLE IF NOT EXISTS mv_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE,
  view_a_id UUID NOT NULL REFERENCES mv_views(id) ON DELETE CASCADE,
  view_b_id UUID NOT NULL REFERENCES mv_views(id) ON DELETE CASCADE,
  -- Match quality metrics
  match_quality NUMERIC(4,3) NOT NULL DEFAULT 0.0,
  inlier_count INTEGER DEFAULT 0,
  -- Geometric consistency between views
  geometric_consistency_score NUMERIC(4,3),
  -- Per-family agreement scores
  spread_agreement NUMERIC(4,3),
  beam_agreement NUMERIC(4,3),
  tine_agreement NUMERIC(4,3),
  mass_agreement NUMERIC(4,3),
  -- Acceptance status
  accepted_for_fusion BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  -- Raw match data
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure no duplicate pairs
  UNIQUE (mv_set_id, view_a_id, view_b_id)
);

-- The final multi-view solution
CREATE TABLE IF NOT EXISTS mv_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE UNIQUE,
  method TEXT NOT NULL CHECK (method IN ('graph_fusion', 'weighted_average', 'dominant_view', 'single_view_fallback', 'hybrid')),
  -- Fused measurement results
  fused_measurements_json JSONB NOT NULL DEFAULT '{}',
  -- Per-family fused estimates with supporting views
  family_fusion_details JSONB DEFAULT '{}',
  -- Uncertainty estimates
  fused_uncertainty_json JSONB DEFAULT '{}',
  -- Disagreement analysis
  disagreement_summary_json JSONB DEFAULT '{}',
  -- Score estimates
  fused_gross_score NUMERIC(6,2),
  fused_net_score NUMERIC(6,2),
  score_confidence NUMERIC(4,3),
  -- Fallback info
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  -- Views that contributed to the solution
  chosen_primary_views_json JSONB DEFAULT '[]',
  secondary_supporting_views_json JSONB DEFAULT '[]',
  rejected_views_json JSONB DEFAULT '[]',
  -- Quality metrics
  solution_quality_score NUMERIC(4,3),
  cross_view_agreement_score NUMERIC(4,3),
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Multi-view benchmark results (for validation)
CREATE TABLE IF NOT EXISTS mv_benchmark_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mv_set_id UUID NOT NULL REFERENCES mv_sets(id) ON DELETE CASCADE,
  benchmark_run_id UUID REFERENCES validation_runs(id) ON DELETE CASCADE,
  -- Ground truth comparison
  ground_truth_gross NUMERIC(6,2),
  ground_truth_net NUMERIC(6,2),
  -- Single-image vs multi-view comparison
  single_image_prediction NUMERIC(6,2),
  single_image_confidence NUMERIC(4,3),
  multi_view_prediction NUMERIC(6,2),
  multi_view_confidence NUMERIC(4,3),
  -- Errors
  single_image_error NUMERIC(6,2),
  multi_view_error NUMERIC(6,2),
  improvement_inches NUMERIC(6,2),
  improvement_percent NUMERIC(5,2),
  -- Per-family improvements
  spread_improvement NUMERIC(5,2),
  beam_improvement NUMERIC(5,2),
  tine_improvement NUMERIC(5,2),
  mass_improvement NUMERIC(5,2),
  -- Metadata
  image_count INTEGER,
  graph_quality NUMERIC(4,3),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_mv_sets_prediction_id ON mv_sets(prediction_id);
CREATE INDEX IF NOT EXISTS idx_mv_sets_buck_id ON mv_sets(buck_id);
CREATE INDEX IF NOT EXISTS idx_mv_sets_status ON mv_sets(status);
CREATE INDEX IF NOT EXISTS idx_mv_sets_created_at ON mv_sets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_views_mv_set_id ON mv_views(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_views_image_id ON mv_views(image_id);
CREATE INDEX IF NOT EXISTS idx_mv_views_is_outlier ON mv_views(is_outlier);
CREATE INDEX IF NOT EXISTS idx_mv_edges_mv_set_id ON mv_edges(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_edges_accepted ON mv_edges(accepted_for_fusion);
CREATE INDEX IF NOT EXISTS idx_mv_solutions_mv_set_id ON mv_solutions(mv_set_id);
CREATE INDEX IF NOT EXISTS idx_mv_benchmark_improvement ON mv_benchmark_results(improvement_inches DESC);

-- Update trigger for mv_sets updated_at
CREATE OR REPLACE FUNCTION update_mv_sets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mv_sets_updated_at ON mv_sets;
CREATE TRIGGER mv_sets_updated_at
  BEFORE UPDATE ON mv_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_mv_sets_updated_at();

-- Add multi-view reference to predictions table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'predictions' AND column_name = 'mv_set_id'
  ) THEN
    ALTER TABLE predictions ADD COLUMN mv_set_id UUID REFERENCES mv_sets(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_predictions_mv_set_id ON predictions(mv_set_id);
  END IF;
END $$;

-- Add multi-view metadata columns to predictions if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'predictions' AND column_name = 'multi_view_fusion_used'
  ) THEN
    ALTER TABLE predictions ADD COLUMN multi_view_fusion_used BOOLEAN DEFAULT FALSE;
    ALTER TABLE predictions ADD COLUMN multi_view_confidence_boost NUMERIC(4,3);
    ALTER TABLE predictions ADD COLUMN multi_view_method TEXT;
  END IF;
END $$;

COMMENT ON TABLE mv_sets IS 'Phase 49: Container for multi-view scoring sets';
COMMENT ON TABLE mv_views IS 'Phase 49: Individual views within a multi-view set';
COMMENT ON TABLE mv_edges IS 'Phase 49: Pairwise relationships between views (graph edges)';
COMMENT ON TABLE mv_solutions IS 'Phase 49: Final fused solution from multi-view analysis';
COMMENT ON TABLE mv_benchmark_results IS 'Phase 49: Benchmark results comparing single vs multi-view scoring';
