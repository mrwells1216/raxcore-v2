-- Phase 26: Benchmark Packs + Regression Guardrails
-- Tables to support curated benchmark packs, regression testing, and promotion decisions

-- ============================================================================
-- BENCHMARK PACKS
-- Curated sets of training examples for reproducible release testing
-- ============================================================================

CREATE TABLE IF NOT EXISTS benchmark_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Pack metadata
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_archived BOOLEAN NOT NULL DEFAULT false,
  
  -- Statistics (denormalized for quick display)
  example_count INTEGER NOT NULL DEFAULT 0,
  
  -- Audit fields
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_benchmark_pack_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_packs_archived ON benchmark_packs(is_archived);
CREATE INDEX IF NOT EXISTS idx_benchmark_packs_tags ON benchmark_packs USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_benchmark_packs_created ON benchmark_packs(created_at DESC);

-- ============================================================================
-- BENCHMARK PACK EXAMPLES
-- Many-to-many relationship between packs and training examples
-- ============================================================================

CREATE TABLE IF NOT EXISTS benchmark_pack_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_pack_id UUID NOT NULL REFERENCES benchmark_packs(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL,
  
  -- Snapshot data at time of addition (for stability)
  ground_truth_gross NUMERIC(6,2),
  ground_truth_net NUMERIC(6,2),
  state TEXT,
  rack_type TEXT,
  source_type TEXT,
  
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_pack_example UNIQUE (benchmark_pack_id, training_example_id)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_pack_examples_pack ON benchmark_pack_examples(benchmark_pack_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_pack_examples_example ON benchmark_pack_examples(training_example_id);

-- ============================================================================
-- BENCHMARK RUNS
-- Links benchmark pack execution to bulk validation runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_pack_id UUID NOT NULL REFERENCES benchmark_packs(id) ON DELETE RESTRICT,
  bulk_validation_run_id UUID NOT NULL REFERENCES bulk_validation_runs(id) ON DELETE CASCADE,
  
  -- Context
  run_purpose TEXT, -- 'release_candidate', 'regression_test', 'ad_hoc'
  run_notes TEXT,
  
  -- Models being tested
  active_model_version_id UUID REFERENCES model_versions(id),
  candidate_model_version_id UUID REFERENCES model_versions(id),
  active_calibration_profile_id UUID REFERENCES calibration_profiles(id),
  candidate_calibration_profile_id UUID REFERENCES calibration_profiles(id),
  
  -- Guardrail configuration used
  guardrail_config JSONB,
  
  -- Guardrail results
  guardrail_results JSONB,
  all_guardrails_passed BOOLEAN,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_pack ON benchmark_runs(benchmark_pack_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_bulk ON benchmark_runs(bulk_validation_run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created ON benchmark_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_passed ON benchmark_runs(all_guardrails_passed);

-- ============================================================================
-- PROMOTION DECISIONS
-- Audit log for promotion/rejection decisions
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotion_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_run_id UUID REFERENCES benchmark_runs(id) ON DELETE SET NULL,
  
  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('promote', 'reject', 'defer')),
  decision_reason TEXT,
  decision_notes TEXT,
  
  -- What was being evaluated
  candidate_model_version_id UUID REFERENCES model_versions(id),
  candidate_calibration_profile_id UUID REFERENCES calibration_profiles(id),
  active_model_version_id UUID REFERENCES model_versions(id),
  active_calibration_profile_id UUID REFERENCES calibration_profiles(id),
  
  -- Metrics snapshot at decision time
  metrics_snapshot JSONB,
  guardrail_results JSONB,
  
  -- Audit
  decided_by TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_decisions_decision ON promotion_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_promotion_decisions_candidate ON promotion_decisions(candidate_model_version_id);
CREATE INDEX IF NOT EXISTS idx_promotion_decisions_created ON promotion_decisions(created_at DESC);

-- ============================================================================
-- HELPER VIEW: Benchmark runs with details
-- ============================================================================

CREATE OR REPLACE VIEW benchmark_runs_with_details AS
SELECT 
  br.*,
  bp.name as pack_name,
  bp.example_count as pack_example_count,
  bvr.status as bulk_run_status,
  bvr.total_examples,
  bvr.processed_examples,
  amv.version_name as active_model_name,
  cmv.version_name as candidate_model_name,
  acp.name as active_calibration_name,
  ccp.name as candidate_calibration_name
FROM benchmark_runs br
LEFT JOIN benchmark_packs bp ON br.benchmark_pack_id = bp.id
LEFT JOIN bulk_validation_runs bvr ON br.bulk_validation_run_id = bvr.id
LEFT JOIN model_versions amv ON br.active_model_version_id = amv.id
LEFT JOIN model_versions cmv ON br.candidate_model_version_id = cmv.id
LEFT JOIN calibration_profiles acp ON br.active_calibration_profile_id = acp.id
LEFT JOIN calibration_profiles ccp ON br.candidate_calibration_profile_id = ccp.id;

-- ============================================================================
-- HELPER VIEW: Promotion decision history
-- ============================================================================

CREATE OR REPLACE VIEW promotion_decision_history AS
SELECT 
  pd.*,
  cmv.version_name as candidate_model_name,
  amv.version_name as active_model_name,
  ccp.name as candidate_calibration_name,
  acp.name as active_calibration_name,
  br.benchmark_pack_id,
  bp.name as benchmark_pack_name
FROM promotion_decisions pd
LEFT JOIN model_versions cmv ON pd.candidate_model_version_id = cmv.id
LEFT JOIN model_versions amv ON pd.active_model_version_id = amv.id
LEFT JOIN calibration_profiles ccp ON pd.candidate_calibration_profile_id = ccp.id
LEFT JOIN calibration_profiles acp ON pd.active_calibration_profile_id = acp.id
LEFT JOIN benchmark_runs br ON pd.benchmark_run_id = br.id
LEFT JOIN benchmark_packs bp ON br.benchmark_pack_id = bp.id;

-- ============================================================================
-- TRIGGER: Update benchmark pack example count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_benchmark_pack_example_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE benchmark_packs 
    SET example_count = example_count + 1, updated_at = now()
    WHERE id = NEW.benchmark_pack_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE benchmark_packs 
    SET example_count = example_count - 1, updated_at = now()
    WHERE id = OLD.benchmark_pack_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_pack_example_count ON benchmark_pack_examples;
CREATE TRIGGER trg_update_pack_example_count
AFTER INSERT OR DELETE ON benchmark_pack_examples
FOR EACH ROW EXECUTE FUNCTION update_benchmark_pack_example_count();

-- ============================================================================
-- RLS Policies (admin-only feature)
-- ============================================================================

ALTER TABLE benchmark_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_pack_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON benchmark_packs FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON benchmark_pack_examples FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON benchmark_runs FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON promotion_decisions FOR ALL USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE benchmark_packs IS 'Curated sets of training examples for reproducible release testing';
COMMENT ON TABLE benchmark_pack_examples IS 'Many-to-many relationship between benchmark packs and training examples';
COMMENT ON TABLE benchmark_runs IS 'Links benchmark pack execution to bulk validation runs with guardrail results';
COMMENT ON TABLE promotion_decisions IS 'Audit log for model/calibration promotion decisions';
