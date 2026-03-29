-- RAXcore Phase 43: Retraining Readiness Pack + Dataset Export + Offline Evaluation Harness
-- Enables structured dataset exports, candidate model evaluation, and retraining readiness assessment

-- ============================================================================
-- EXPORT PACKS
-- Define reusable dataset export configurations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.export_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Filter configuration
  filters JSONB NOT NULL DEFAULT '{}',
  -- filters structure:
  -- {
  --   "training_eligible_only": true,
  --   "min_health_score": 60,
  --   "health_tiers": ["excellent", "good"],
  --   "states": ["Iowa", "Wisconsin"],
  --   "rack_types": ["typical"],
  --   "source_types": ["mounted_photo", "harvest_photo"],
  --   "min_verified_score_strength": "verified",
  --   "exclude_duplicates": true,
  --   "exclude_outliers": true,
  --   "segment_ids": ["uuid1", "uuid2"],
  --   "benchmark_pack_id": "uuid"
  -- }
  
  -- Train/val/test split configuration
  split_config JSONB DEFAULT '{
    "train_ratio": 0.7,
    "validation_ratio": 0.15,
    "test_ratio": 0.15,
    "split_seed": 42,
    "stratify_by": ["state", "rack_type"],
    "prevent_near_duplicate_leakage": true
  }',
  
  -- Export format preferences
  export_formats TEXT[] DEFAULT ARRAY['json', 'csv'],
  include_image_urls BOOLEAN DEFAULT true,
  include_segment_context BOOLEAN DEFAULT true,
  include_health_metadata BOOLEAN DEFAULT true,
  
  -- Data gap targeting (for active learning)
  targets_data_gap TEXT, -- e.g., 'trail_cam_weak', 'western_live', 'small_frame'
  gap_priority INTEGER DEFAULT 0, -- higher = more important for filling gaps
  
  -- Status
  is_archived BOOLEAN DEFAULT false,
  example_count INTEGER DEFAULT 0,
  last_computed_at TIMESTAMPTZ,
  
  -- Audit
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_packs_archived ON public.export_packs(is_archived);
CREATE INDEX IF NOT EXISTS idx_export_packs_gap ON public.export_packs(targets_data_gap);

-- ============================================================================
-- EXPORT PACK EXAMPLES
-- Persisted list of examples included in each pack (with split assignment)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.export_pack_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_pack_id UUID NOT NULL REFERENCES public.export_packs(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL REFERENCES public.training_examples(id) ON DELETE CASCADE,
  
  -- Split assignment
  split_assignment TEXT NOT NULL CHECK (split_assignment IN ('train', 'validation', 'test')),
  
  -- Snapshot of key data at export time
  ground_truth_gross NUMERIC(6,2),
  ground_truth_net NUMERIC(6,2),
  health_score NUMERIC(5,2),
  health_tier TEXT,
  state TEXT,
  rack_type TEXT,
  source_type TEXT,
  segment_ids UUID[],
  
  added_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(export_pack_id, training_example_id)
);

CREATE INDEX IF NOT EXISTS idx_export_pack_examples_pack ON public.export_pack_examples(export_pack_id);
CREATE INDEX IF NOT EXISTS idx_export_pack_examples_split ON public.export_pack_examples(split_assignment);

-- ============================================================================
-- EXPORT RUNS
-- Track each time an export pack is exported
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.export_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_pack_id UUID NOT NULL REFERENCES public.export_packs(id) ON DELETE CASCADE,
  
  -- Export details
  format TEXT NOT NULL CHECK (format IN ('json', 'csv', 'both')),
  example_count INTEGER NOT NULL DEFAULT 0,
  train_count INTEGER DEFAULT 0,
  validation_count INTEGER DEFAULT 0,
  test_count INTEGER DEFAULT 0,
  
  -- File references (if stored)
  export_file_path TEXT,
  export_file_size_bytes INTEGER,
  
  -- Export metadata
  export_config JSONB,
  run_notes TEXT,
  
  -- Audit
  exported_by TEXT,
  exported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_runs_pack ON public.export_runs(export_pack_id);

-- ============================================================================
-- CANDIDATE MODEL REGISTRY
-- Track offline candidate model runs for comparison
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.candidate_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  
  -- What was this model trained on
  export_pack_id UUID REFERENCES public.export_packs(id),
  training_approach TEXT, -- e.g., 'fine_tuned_gpt4v', 'custom_cnn', 'ensemble'
  training_notes TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'evaluated', 'promoted', 'rejected', 'archived')),
  
  -- Summary metrics (computed after evaluation)
  metrics_summary JSONB,
  -- {
  --   "avg_gross_error": 5.2,
  --   "avg_net_error": 4.8,
  --   "within_5_inches_percent": 65,
  --   "within_10_inches_percent": 88,
  --   "confidence_calibration_error": 0.08,
  --   "sample_count": 150
  -- }
  
  -- Comparison to production
  comparison_to_production JSONB,
  -- {
  --   "gross_error_delta": -0.8,
  --   "net_error_delta": -0.5,
  --   "improvement_percent": 12.5,
  --   "regressed_segments": [],
  --   "improved_segments": ["trail_cam", "live_deer"]
  -- }
  
  -- Audit
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_candidate_models_status ON public.candidate_models(status);
CREATE INDEX IF NOT EXISTS idx_candidate_models_pack ON public.candidate_models(export_pack_id);

-- ============================================================================
-- CANDIDATE MODEL PREDICTIONS
-- Store predictions from candidate models for evaluation
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.candidate_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_model_id UUID NOT NULL REFERENCES public.candidate_models(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL REFERENCES public.training_examples(id) ON DELETE CASCADE,
  
  -- Predictions
  predicted_gross NUMERIC(6,2),
  predicted_net NUMERIC(6,2),
  confidence_percent NUMERIC(5,2),
  
  -- Computed errors (vs ground truth)
  gross_error NUMERIC(6,2),
  net_error NUMERIC(6,2),
  abs_gross_error NUMERIC(6,2),
  abs_net_error NUMERIC(6,2),
  
  -- Optional: per-measurement predictions
  measurements JSONB,
  
  -- Import metadata
  imported_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(candidate_model_id, training_example_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_predictions_model ON public.candidate_predictions(candidate_model_id);
CREATE INDEX IF NOT EXISTS idx_candidate_predictions_example ON public.candidate_predictions(training_example_id);

-- ============================================================================
-- OFFLINE EVALUATION RUNS
-- Track evaluation harness runs comparing models
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.offline_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- What's being evaluated
  candidate_model_id UUID REFERENCES public.candidate_models(id),
  export_pack_id UUID REFERENCES public.export_packs(id),
  
  -- Baseline comparison
  baseline_type TEXT DEFAULT 'production' CHECK (baseline_type IN ('production', 'candidate', 'historical')),
  baseline_model_version_id UUID REFERENCES public.model_versions(id),
  
  -- Results
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  
  -- Overall metrics
  candidate_metrics JSONB,
  baseline_metrics JSONB,
  comparison_summary JSONB,
  -- {
  --   "candidate_avg_gross_error": 5.2,
  --   "baseline_avg_gross_error": 6.0,
  --   "improvement_inches": 0.8,
  --   "improvement_percent": 13.3,
  --   "candidate_within_5": 65,
  --   "baseline_within_5": 58,
  --   "recommendation": "promote" | "investigate" | "reject"
  -- }
  
  -- Per-segment results
  segment_results JSONB,
  -- {
  --   "by_state": { "Iowa": {...}, "Wisconsin": {...} },
  --   "by_source_type": { "trail_cam": {...}, "mounted_photo": {...} },
  --   "by_rack_type": { "typical": {...}, "non-typical": {...} }
  -- }
  
  -- Measurement-family breakdown
  measurement_family_results JSONB,
  -- {
  --   "spread": { "candidate_mae": 2.1, "baseline_mae": 2.5 },
  --   "beam": { "candidate_mae": 3.2, "baseline_mae": 3.8 },
  --   "tine": { "candidate_mae": 1.8, "baseline_mae": 2.1 }
  -- }
  
  -- Confidence calibration
  confidence_calibration_results JSONB,
  
  -- Audit
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_evaluation_runs_status ON public.offline_evaluation_runs(status);
CREATE INDEX IF NOT EXISTS idx_offline_evaluation_runs_candidate ON public.offline_evaluation_runs(candidate_model_id);

-- ============================================================================
-- RETRAINING READINESS ASSESSMENTS
-- Periodic assessments of dataset readiness for retraining
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retraining_readiness_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Overall readiness
  overall_readiness_score NUMERIC(5,2), -- 0-100
  overall_readiness_tier TEXT CHECK (overall_readiness_tier IN ('ready', 'almost_ready', 'needs_work', 'not_ready')),
  
  -- Component scores
  scores JSONB NOT NULL,
  -- {
  --   "total_verified_examples": { "value": 450, "score": 85, "weight": 0.15 },
  --   "health_distribution": { "excellent": 120, "good": 200, "fair": 80, "poor": 30, "excluded": 20, "score": 75, "weight": 0.15 },
  --   "duplicate_rate": { "value": 0.03, "score": 95, "weight": 0.10 },
  --   "outlier_rate": { "value": 0.02, "score": 97, "weight": 0.10 },
  --   "segment_coverage": { "covered": 12, "total": 15, "score": 80, "weight": 0.10 },
  --   "measurement_family_coverage": { ... },
  --   "state_coverage": { "covered": 35, "total": 50, "high_output_coverage": 0.9, "score": 88, "weight": 0.10 },
  --   "source_type_coverage": { ... },
  --   "image_quality_coverage": { ... }
  -- }
  
  -- Gaps and recommendations
  gaps JSONB,
  -- [
  --   { "area": "trail_cam_coverage", "severity": "high", "current": 25, "recommended": 75, "message": "Trail cam examples significantly underrepresented" },
  --   { "area": "western_states", "severity": "medium", "current": 15, "recommended": 40, "message": "Need more examples from MT, WY, CO" }
  -- ]
  
  recommendations TEXT[],
  
  -- Audit
  assessed_at TIMESTAMPTZ DEFAULT now(),
  assessed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_retraining_readiness_assessed ON public.retraining_readiness_assessments(assessed_at DESC);

-- ============================================================================
-- ADD RETRAINING FIELDS TO TRAINING_EXAMPLES
-- ============================================================================

ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS retraining_eligible BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retraining_priority INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_export_pack_id UUID REFERENCES public.export_packs(id),
  ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_training_examples_retraining ON public.training_examples(retraining_eligible) WHERE retraining_eligible = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_priority ON public.training_examples(retraining_priority DESC);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Dataset coverage summary for retraining readiness
CREATE OR REPLACE VIEW public.dataset_coverage_summary AS
WITH state_counts AS (
  SELECT 
    b.state,
    COUNT(*) as example_count,
    COUNT(*) FILTER (WHERE te.usable_for_training = true) as training_eligible,
    AVG(te.health_score) as avg_health
  FROM public.training_examples te
  JOIN public.predictions p ON te.prediction_id = p.id
  JOIN public.bucks b ON p.buck_id = b.id
  GROUP BY b.state
),
source_counts AS (
  SELECT 
    b.source_type,
    COUNT(*) as example_count,
    COUNT(*) FILTER (WHERE te.usable_for_training = true) as training_eligible,
    AVG(te.health_score) as avg_health
  FROM public.training_examples te
  JOIN public.predictions p ON te.prediction_id = p.id
  JOIN public.bucks b ON p.buck_id = b.id
  GROUP BY b.source_type
),
rack_counts AS (
  SELECT 
    b.rack_type,
    COUNT(*) as example_count,
    COUNT(*) FILTER (WHERE te.usable_for_training = true) as training_eligible,
    AVG(te.health_score) as avg_health
  FROM public.training_examples te
  JOIN public.predictions p ON te.prediction_id = p.id
  JOIN public.bucks b ON p.buck_id = b.id
  GROUP BY b.rack_type
)
SELECT 
  'summary' as coverage_type,
  jsonb_build_object(
    'total_examples', (SELECT COUNT(*) FROM public.training_examples),
    'training_eligible', (SELECT COUNT(*) FROM public.training_examples WHERE usable_for_training = true),
    'states_covered', (SELECT COUNT(*) FROM state_counts),
    'source_types_covered', (SELECT COUNT(*) FROM source_counts WHERE source_type IS NOT NULL)
  ) as summary;

-- Export pack summary view
CREATE OR REPLACE VIEW public.export_packs_with_stats AS
SELECT 
  ep.*,
  COUNT(epe.id) as computed_example_count,
  COUNT(epe.id) FILTER (WHERE epe.split_assignment = 'train') as train_count,
  COUNT(epe.id) FILTER (WHERE epe.split_assignment = 'validation') as validation_count,
  COUNT(epe.id) FILTER (WHERE epe.split_assignment = 'test') as test_count
FROM public.export_packs ep
LEFT JOIN public.export_pack_examples epe ON ep.id = epe.export_pack_id
GROUP BY ep.id;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_export_packs_updated_at ON public.export_packs;
CREATE TRIGGER update_export_packs_updated_at 
  BEFORE UPDATE ON public.export_packs 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_candidate_models_updated_at ON public.candidate_models;
CREATE TRIGGER update_candidate_models_updated_at 
  BEFORE UPDATE ON public.candidate_models 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- RLS POLICIES (Admin-only tables)
-- ============================================================================

ALTER TABLE public.export_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_pack_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retraining_readiness_assessments ENABLE ROW LEVEL SECURITY;

-- Allow all for authenticated (admin features protected at app level)
CREATE POLICY "Allow all for export_packs" ON public.export_packs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for export_pack_examples" ON public.export_pack_examples FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for export_runs" ON public.export_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for candidate_models" ON public.candidate_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for candidate_predictions" ON public.candidate_predictions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for offline_evaluation_runs" ON public.offline_evaluation_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for retraining_readiness_assessments" ON public.retraining_readiness_assessments FOR ALL TO authenticated USING (true) WITH CHECK (true);
