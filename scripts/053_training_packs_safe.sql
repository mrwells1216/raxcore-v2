-- ============================================================================
-- Phase 53: Training Pack Generation System (Safe Version)
-- ============================================================================
-- Uses DO blocks with IF NOT EXISTS patterns for idempotent execution
-- ============================================================================

-- ============================================================================
-- ENUMS (with existence checks)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE training_pack_type AS ENUM (
    'baseline_supervision_pack',
    'reverse_pass_pack',
    'structural_solver_pack',
    'hard_case_pack',
    'confidence_failure_pack',
    'segment_specific_pack',
    'candidate_finetune_pack',
    'benchmark_holdout_pack'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE training_pack_status AS ENUM (
    'draft',
    'ready',
    'exported',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE training_split_type AS ENUM (
    'train',
    'validation',
    'test',
    'benchmark_holdout'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auxiliary_label_type AS ENUM (
    'likely_scale_reference_failure',
    'likely_beam_tip_misread',
    'likely_tine_occlusion',
    'likely_angle_distortion',
    'likely_width_estimation_error',
    'likely_mass_deduction_error',
    'likely_confidence_overclaim',
    'likely_confidence_underclaim',
    'likely_multi_view_disagreement',
    'likely_structural_topology_error',
    'likely_input_quality_issue',
    'likely_segment_calibration_miss',
    'reverse_pass_changed_result',
    'structural_solver_changed_result',
    'hard_case_pattern_membership',
    'benchmark_regression_signal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auxiliary_label_source AS ENUM (
    'auto',
    'admin',
    'benchmark',
    'reverse',
    'structural'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auxiliary_label_status AS ENUM (
    'pending',
    'confirmed',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- TABLES (without foreign key constraints for flexibility)
-- ============================================================================

-- Main training pack registry
CREATE TABLE IF NOT EXISTS training_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  pack_type training_pack_type NOT NULL,
  status training_pack_status NOT NULL DEFAULT 'draft',
  filter_config_json JSONB DEFAULT '{}',
  source_summary_json JSONB DEFAULT '{}',
  export_summary_json JSONB DEFAULT NULL,
  variant_id UUID,
  split_seed INTEGER,
  split_config_json JSONB DEFAULT '{"train": 0.7, "validation": 0.15, "test": 0.10, "benchmark_holdout": 0.05}',
  item_count INTEGER DEFAULT 0,
  train_count INTEGER DEFAULT 0,
  validation_count INTEGER DEFAULT 0,
  test_count INTEGER DEFAULT 0,
  holdout_count INTEGER DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Training pack items
CREATE TABLE IF NOT EXISTS training_pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  prediction_id UUID NOT NULL,
  buck_id UUID,
  split_assignment training_split_type NOT NULL DEFAULT 'train',
  supervision_event_ids UUID[] DEFAULT '{}',
  reverse_run_id UUID,
  structural_hypothesis_run_id UUID,
  artifact_summary_json JSONB DEFAULT '{}',
  confidence_score FLOAT,
  item_quality_score FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(training_pack_id, prediction_id)
);

-- Auxiliary labels
CREATE TABLE IF NOT EXISTS auxiliary_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervision_label_id UUID,
  training_pack_item_id UUID NOT NULL REFERENCES training_pack_items(id) ON DELETE CASCADE,
  auxiliary_label_type auxiliary_label_type NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.5,
  source auxiliary_label_source NOT NULL DEFAULT 'auto',
  status auxiliary_label_status NOT NULL DEFAULT 'pending',
  evidence_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pack generation job tracking
CREATE TABLE IF NOT EXISTS training_pack_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  result_json JSONB DEFAULT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Export manifests
CREATE TABLE IF NOT EXISTS training_pack_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'json',
  scope TEXT NOT NULL DEFAULT 'full',
  filter_json JSONB DEFAULT NULL,
  manifest_blob_url TEXT,
  manifest_summary_json JSONB DEFAULT '{}',
  exported_item_count INTEGER DEFAULT 0,
  exported_label_count INTEGER DEFAULT 0,
  exported_by UUID,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Variant to training pack links
CREATE TABLE IF NOT EXISTS variant_training_pack_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL,
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(variant_id, training_pack_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_training_packs_type ON training_packs(pack_type);
CREATE INDEX IF NOT EXISTS idx_training_packs_status ON training_packs(status);
CREATE INDEX IF NOT EXISTS idx_training_packs_variant ON training_packs(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_packs_created ON training_packs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_pack_items_pack ON training_pack_items(training_pack_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_split ON training_pack_items(training_pack_id, split_assignment);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_prediction ON training_pack_items(prediction_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_buck ON training_pack_items(buck_id) WHERE buck_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_pack_item ON auxiliary_labels(training_pack_item_id);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_type ON auxiliary_labels(auxiliary_label_type);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_status ON auxiliary_labels(status);

CREATE INDEX IF NOT EXISTS idx_training_pack_jobs_pack ON training_pack_jobs(training_pack_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_jobs_status ON training_pack_jobs(status);

CREATE INDEX IF NOT EXISTS idx_training_pack_exports_pack ON training_pack_exports(training_pack_id);

CREATE INDEX IF NOT EXISTS idx_variant_training_pack_links_variant ON variant_training_pack_links(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_training_pack_links_pack ON variant_training_pack_links(training_pack_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE training_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE auxiliary_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_training_pack_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then create
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access to training_packs" ON training_packs;
  DROP POLICY IF EXISTS "Authenticated users can read training_packs" ON training_packs;
  DROP POLICY IF EXISTS "Service role has full access to training_pack_items" ON training_pack_items;
  DROP POLICY IF EXISTS "Authenticated users can read training_pack_items" ON training_pack_items;
  DROP POLICY IF EXISTS "Service role has full access to auxiliary_labels" ON auxiliary_labels;
  DROP POLICY IF EXISTS "Authenticated users can read auxiliary_labels" ON auxiliary_labels;
  DROP POLICY IF EXISTS "Service role has full access to training_pack_jobs" ON training_pack_jobs;
  DROP POLICY IF EXISTS "Authenticated users can read training_pack_jobs" ON training_pack_jobs;
  DROP POLICY IF EXISTS "Service role has full access to training_pack_exports" ON training_pack_exports;
  DROP POLICY IF EXISTS "Authenticated users can read training_pack_exports" ON training_pack_exports;
  DROP POLICY IF EXISTS "Service role has full access to variant_training_pack_links" ON variant_training_pack_links;
  DROP POLICY IF EXISTS "Authenticated users can read variant_training_pack_links" ON variant_training_pack_links;
END $$;

CREATE POLICY "Service role has full access to training_packs"
  ON training_packs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_packs"
  ON training_packs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role has full access to training_pack_items"
  ON training_pack_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_items"
  ON training_pack_items FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role has full access to auxiliary_labels"
  ON auxiliary_labels FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read auxiliary_labels"
  ON auxiliary_labels FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role has full access to training_pack_jobs"
  ON training_pack_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_jobs"
  ON training_pack_jobs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role has full access to training_pack_exports"
  ON training_pack_exports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_exports"
  ON training_pack_exports FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role has full access to variant_training_pack_links"
  ON variant_training_pack_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read variant_training_pack_links"
  ON variant_training_pack_links FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Drop and recreate function
DROP FUNCTION IF EXISTS update_training_pack_counts() CASCADE;

CREATE OR REPLACE FUNCTION update_training_pack_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE training_packs SET
      item_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = NEW.training_pack_id),
      train_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = NEW.training_pack_id AND split_assignment = 'train'),
      validation_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = NEW.training_pack_id AND split_assignment = 'validation'),
      test_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = NEW.training_pack_id AND split_assignment = 'test'),
      holdout_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = NEW.training_pack_id AND split_assignment = 'benchmark_holdout'),
      updated_at = NOW()
    WHERE id = NEW.training_pack_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE training_packs SET
      item_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = OLD.training_pack_id),
      train_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = OLD.training_pack_id AND split_assignment = 'train'),
      validation_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = OLD.training_pack_id AND split_assignment = 'validation'),
      test_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = OLD.training_pack_id AND split_assignment = 'test'),
      holdout_count = (SELECT COUNT(*) FROM training_pack_items WHERE training_pack_id = OLD.training_pack_id AND split_assignment = 'benchmark_holdout'),
      updated_at = NOW()
    WHERE id = OLD.training_pack_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS training_pack_items_count_trigger ON training_pack_items;
CREATE TRIGGER training_pack_items_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON training_pack_items
  FOR EACH ROW
  EXECUTE FUNCTION update_training_pack_counts();

-- Deterministic split function
DROP FUNCTION IF EXISTS compute_split_assignment(UUID, INTEGER, FLOAT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION compute_split_assignment(
  p_buck_id UUID,
  p_seed INTEGER,
  p_train_ratio FLOAT DEFAULT 0.7,
  p_validation_ratio FLOAT DEFAULT 0.15,
  p_test_ratio FLOAT DEFAULT 0.10
) RETURNS training_split_type AS $$
DECLARE
  hash_value FLOAT;
BEGIN
  hash_value := (('x' || substring(md5(p_buck_id::text || p_seed::text), 1, 8))::bit(32)::int::FLOAT / 2147483647.0 + 1) / 2;
  
  IF hash_value < p_train_ratio THEN
    RETURN 'train';
  ELSIF hash_value < p_train_ratio + p_validation_ratio THEN
    RETURN 'validation';
  ELSIF hash_value < p_train_ratio + p_validation_ratio + p_test_ratio THEN
    RETURN 'test';
  ELSE
    RETURN 'benchmark_holdout';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE training_packs IS 'Registry of training packs for model fine-tuning and evaluation';
COMMENT ON TABLE training_pack_items IS 'Individual items in a training pack with supervision artifacts';
COMMENT ON TABLE auxiliary_labels IS 'Machine-readable labels derived from supervision events';
COMMENT ON TABLE training_pack_jobs IS 'Job tracking for pack generation pipelines';
COMMENT ON TABLE training_pack_exports IS 'Export history and manifest storage';
COMMENT ON TABLE variant_training_pack_links IS 'Links between model variants and training packs';
