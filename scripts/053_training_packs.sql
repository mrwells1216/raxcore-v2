-- ============================================================================
-- Phase 53: Training Pack Generation System
-- ============================================================================
-- This migration creates the infrastructure for structured supervision export,
-- training pack composition, auxiliary labels, and candidate model integration.
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Training pack types for different use cases
CREATE TYPE training_pack_type AS ENUM (
  'baseline_supervision_pack',    -- General supervision events
  'reverse_pass_pack',            -- Focused on reverse engineering outcomes
  'structural_solver_pack',       -- Focused on structural hypothesis outcomes
  'hard_case_pack',               -- Hard-case patterns only
  'confidence_failure_pack',      -- High-confidence misses
  'segment_specific_pack',        -- Segment-specific training
  'candidate_finetune_pack',      -- For candidate model fine-tuning
  'benchmark_holdout_pack'        -- Reserved for benchmark holdout
);

-- Pack status lifecycle
CREATE TYPE training_pack_status AS ENUM (
  'draft',      -- Being composed, not finalized
  'ready',      -- Finalized, ready for export
  'exported',   -- Has been exported at least once
  'archived'    -- No longer active
);

-- Split assignment for reproducibility
CREATE TYPE training_split_type AS ENUM (
  'train',
  'validation',
  'test',
  'benchmark_holdout'
);

-- Auxiliary label types (machine-readable for training)
CREATE TYPE auxiliary_label_type AS ENUM (
  -- From supervision failure causes
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
  -- Composite/derived labels
  'reverse_pass_changed_result',
  'structural_solver_changed_result',
  'hard_case_pattern_membership',
  'benchmark_regression_signal'
);

-- Auxiliary label source
CREATE TYPE auxiliary_label_source AS ENUM (
  'auto',       -- Automatically inferred from supervision
  'admin',      -- Manually added/confirmed by admin
  'benchmark',  -- From benchmark system
  'reverse',    -- From reverse engineering
  'structural'  -- From structural solver
);

-- Auxiliary label status
CREATE TYPE auxiliary_label_status AS ENUM (
  'pending',    -- Not yet confirmed
  'confirmed',  -- Confirmed as correct
  'rejected'    -- Rejected as incorrect
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Main training pack registry
CREATE TABLE IF NOT EXISTS training_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  pack_type training_pack_type NOT NULL,
  status training_pack_status NOT NULL DEFAULT 'draft',
  
  -- Configuration
  filter_config_json JSONB DEFAULT '{}',     -- Filters used to select items
  source_summary_json JSONB DEFAULT '{}',    -- Summary of sources (events, patterns, etc.)
  export_summary_json JSONB DEFAULT NULL,    -- Summary from last export
  
  -- Optional variant linkage
  variant_id UUID REFERENCES candidate_models(id) ON DELETE SET NULL,
  
  -- Split configuration
  split_seed INTEGER,
  split_config_json JSONB DEFAULT '{"train": 0.7, "validation": 0.15, "test": 0.10, "benchmark_holdout": 0.05}',
  
  -- Counts (denormalized for performance)
  item_count INTEGER DEFAULT 0,
  train_count INTEGER DEFAULT 0,
  validation_count INTEGER DEFAULT 0,
  test_count INTEGER DEFAULT 0,
  holdout_count INTEGER DEFAULT 0,
  
  -- Audit
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Training pack items (predictions with supervision artifacts)
CREATE TABLE IF NOT EXISTS training_pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pack membership
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  
  -- Core references
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE SET NULL,
  
  -- Split assignment
  split_assignment training_split_type NOT NULL DEFAULT 'train',
  
  -- Supervision linkage (array of event IDs)
  supervision_event_ids UUID[] DEFAULT '{}',
  
  -- Artifact linkage
  reverse_run_id UUID REFERENCES reverse_runs(id) ON DELETE SET NULL,
  structural_hypothesis_run_id UUID REFERENCES structural_hypothesis_runs(id) ON DELETE SET NULL,
  
  -- Cached artifact summary for fast access
  artifact_summary_json JSONB DEFAULT '{}',
  
  -- Quality metrics
  confidence_score FLOAT,                    -- Model's confidence at prediction time
  item_quality_score FLOAT,                  -- Computed quality for training
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(training_pack_id, prediction_id)
);

-- Auxiliary labels for machine-readable export
CREATE TABLE IF NOT EXISTS auxiliary_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Optional linkage to supervision label
  supervision_label_id UUID REFERENCES supervision_labels(id) ON DELETE SET NULL,
  
  -- Required linkage to pack item
  training_pack_item_id UUID NOT NULL REFERENCES training_pack_items(id) ON DELETE CASCADE,
  
  -- Label details
  auxiliary_label_type auxiliary_label_type NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.5,
  source auxiliary_label_source NOT NULL DEFAULT 'auto',
  status auxiliary_label_status NOT NULL DEFAULT 'pending',
  
  -- Evidence/metadata
  evidence_json JSONB DEFAULT '{}',
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pack generation job tracking (extends existing job system)
CREATE TABLE IF NOT EXISTS training_pack_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pack reference
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  
  -- Job details
  job_type TEXT NOT NULL,                    -- e.g., 'resolve_items', 'assign_splits'
  status TEXT NOT NULL DEFAULT 'pending',    -- pending, running, completed, failed
  
  -- Progress
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  
  -- Results
  result_json JSONB DEFAULT NULL,
  error_message TEXT,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Export manifests (stored for reproducibility)
CREATE TABLE IF NOT EXISTS training_pack_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pack reference
  training_pack_id UUID NOT NULL REFERENCES training_packs(id) ON DELETE CASCADE,
  
  -- Export details
  format TEXT NOT NULL DEFAULT 'json',       -- json, csv
  scope TEXT NOT NULL DEFAULT 'full',        -- full, filtered
  filter_json JSONB DEFAULT NULL,
  
  -- Manifest storage
  manifest_blob_url TEXT,                    -- URL to exported manifest file
  manifest_summary_json JSONB DEFAULT '{}',  -- Quick summary stats
  
  -- Counts at export time
  exported_item_count INTEGER DEFAULT 0,
  exported_label_count INTEGER DEFAULT 0,
  
  -- Audit
  exported_by UUID,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Training packs
CREATE INDEX IF NOT EXISTS idx_training_packs_type ON training_packs(pack_type);
CREATE INDEX IF NOT EXISTS idx_training_packs_status ON training_packs(status);
CREATE INDEX IF NOT EXISTS idx_training_packs_variant ON training_packs(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_packs_created ON training_packs(created_at DESC);

-- Training pack items
CREATE INDEX IF NOT EXISTS idx_training_pack_items_pack ON training_pack_items(training_pack_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_split ON training_pack_items(training_pack_id, split_assignment);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_confidence ON training_pack_items(training_pack_id, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_quality ON training_pack_items(training_pack_id, item_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_prediction ON training_pack_items(prediction_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_items_buck ON training_pack_items(buck_id) WHERE buck_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_pack_items_reverse ON training_pack_items(reverse_run_id) WHERE reverse_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_pack_items_structural ON training_pack_items(structural_hypothesis_run_id) WHERE structural_hypothesis_run_id IS NOT NULL;

-- Auxiliary labels
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_pack_item ON auxiliary_labels(training_pack_item_id);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_type ON auxiliary_labels(auxiliary_label_type);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_status ON auxiliary_labels(status);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_confidence ON auxiliary_labels(training_pack_item_id, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_auxiliary_labels_supervision ON auxiliary_labels(supervision_label_id) WHERE supervision_label_id IS NOT NULL;

-- Jobs
CREATE INDEX IF NOT EXISTS idx_training_pack_jobs_pack ON training_pack_jobs(training_pack_id);
CREATE INDEX IF NOT EXISTS idx_training_pack_jobs_status ON training_pack_jobs(status);

-- Exports
CREATE INDEX IF NOT EXISTS idx_training_pack_exports_pack ON training_pack_exports(training_pack_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE training_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE auxiliary_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_pack_exports ENABLE ROW LEVEL SECURITY;

-- Policies for training_packs
CREATE POLICY "Service role has full access to training_packs"
  ON training_packs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_packs"
  ON training_packs
  FOR SELECT
  TO authenticated
  USING (true);

-- Policies for training_pack_items
CREATE POLICY "Service role has full access to training_pack_items"
  ON training_pack_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_items"
  ON training_pack_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Policies for auxiliary_labels
CREATE POLICY "Service role has full access to auxiliary_labels"
  ON auxiliary_labels
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read auxiliary_labels"
  ON auxiliary_labels
  FOR SELECT
  TO authenticated
  USING (true);

-- Policies for training_pack_jobs
CREATE POLICY "Service role has full access to training_pack_jobs"
  ON training_pack_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_jobs"
  ON training_pack_jobs
  FOR SELECT
  TO authenticated
  USING (true);

-- Policies for training_pack_exports
CREATE POLICY "Service role has full access to training_pack_exports"
  ON training_pack_exports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read training_pack_exports"
  ON training_pack_exports
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update training_pack counts
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

-- Trigger to automatically update pack counts
CREATE TRIGGER training_pack_items_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON training_pack_items
  FOR EACH ROW
  EXECUTE FUNCTION update_training_pack_counts();

-- Function to deterministically assign split based on buck_id and seed
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
  -- Compute deterministic hash from buck_id and seed
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
-- UPDATE CANDIDATE_MODELS TABLE
-- ============================================================================

-- Add training pack linkage to candidate_models if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_models' AND column_name = 'training_pack_ids'
  ) THEN
    ALTER TABLE candidate_models ADD COLUMN training_pack_ids UUID[] DEFAULT '{}';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'candidate_models' AND column_name = 'pack_composition_strategy'
  ) THEN
    ALTER TABLE candidate_models ADD COLUMN pack_composition_strategy TEXT;
  END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE training_packs IS 'Registry of training packs for model fine-tuning and evaluation';
COMMENT ON TABLE training_pack_items IS 'Individual items in a training pack with supervision artifacts';
COMMENT ON TABLE auxiliary_labels IS 'Machine-readable labels derived from supervision events';
COMMENT ON TABLE training_pack_jobs IS 'Job tracking for pack generation pipelines';
COMMENT ON TABLE training_pack_exports IS 'Export history and manifest storage';

COMMENT ON COLUMN training_packs.pack_type IS 'Type of pack: baseline, reverse_pass, hard_case, etc.';
COMMENT ON COLUMN training_packs.filter_config_json IS 'JSON filters used to select items for this pack';
COMMENT ON COLUMN training_packs.split_seed IS 'Seed for deterministic train/val/test split';
COMMENT ON COLUMN training_pack_items.supervision_event_ids IS 'Array of supervision event IDs linked to this item';
COMMENT ON COLUMN training_pack_items.artifact_summary_json IS 'Cached summary of reverse/structural/supervision artifacts';
COMMENT ON COLUMN auxiliary_labels.auxiliary_label_type IS 'Machine-readable label type for training';
