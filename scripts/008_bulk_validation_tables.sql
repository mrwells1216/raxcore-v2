-- Phase 19: Bulk Validation & Model Comparison Tables
-- These tables support bulk testing of known-score examples across model versions

-- ============================================================================
-- BULK VALIDATION RUNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bulk_validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_name TEXT NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'single_model' CHECK (run_type IN ('single_model', 'model_comparison')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Model versions
  primary_model_version_id UUID REFERENCES model_versions(id),
  comparison_model_version_ids UUID[] DEFAULT ARRAY[]::UUID[],
  
  -- Calibration profile snapshots for reproducibility
  primary_calibration_profile_id UUID REFERENCES calibration_profiles(id),
  comparison_calibration_profile_ids UUID[] DEFAULT ARRAY[]::UUID[],
  
  -- Filters used for this run
  filters JSONB,
  filter_snapshot TEXT, -- Human-readable snapshot of filters at run time
  
  -- Snapshotted example IDs for reproducibility (source of truth for execution)
  example_ids UUID[] DEFAULT NULL,
  
  -- Progress tracking
  total_examples INTEGER NOT NULL DEFAULT 0,
  processed_examples INTEGER NOT NULL DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Results
  summary_metrics JSONB,
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing runs
CREATE INDEX IF NOT EXISTS idx_bulk_validation_runs_status ON bulk_validation_runs(status);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_runs_created ON bulk_validation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_runs_primary_model ON bulk_validation_runs(primary_model_version_id);

-- ============================================================================
-- BULK VALIDATION RESULTS (per-example results)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bulk_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_validation_runs(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL,
  buck_id UUID,
  
  -- Ground truth
  ground_truth_gross NUMERIC(6,2) NOT NULL,
  ground_truth_net NUMERIC(6,2),
  
  -- Model results stored as JSONB array for flexibility
  model_results JSONB NOT NULL DEFAULT '[]'::JSONB,
  
  -- Metadata for filtering/grouping
  state TEXT,
  rack_type TEXT,
  source_type TEXT,
  image_count INTEGER,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for querying results
CREATE INDEX IF NOT EXISTS idx_bulk_validation_results_run ON bulk_validation_results(bulk_run_id);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_results_example ON bulk_validation_results(training_example_id);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_results_buck ON bulk_validation_results(buck_id);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_results_state ON bulk_validation_results(state);
CREATE INDEX IF NOT EXISTS idx_bulk_validation_results_rack_type ON bulk_validation_results(rack_type);

-- ============================================================================
-- HELPER VIEW: Latest bulk runs with model info
-- ============================================================================

CREATE OR REPLACE VIEW bulk_runs_with_models AS
SELECT 
  bvr.*,
  mv.version_name as primary_model_name,
  mv.is_active as primary_model_active
FROM bulk_validation_runs bvr
LEFT JOIN model_versions mv ON bvr.primary_model_version_id = mv.id;

-- ============================================================================
-- RLS Policies (if using Supabase auth)
-- ============================================================================

ALTER TABLE bulk_validation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_validation_results ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (admin-only feature)
CREATE POLICY "Allow all for authenticated" ON bulk_validation_runs
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON bulk_validation_results
  FOR ALL USING (true);
