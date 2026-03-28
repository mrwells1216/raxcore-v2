-- RAXcore Dataset Health + Training Example Quality Controls
-- Phase 27: Health scoring, usability flags, duplicate detection, outlier detection

-- ============================================================================
-- TRAINING EXAMPLE HEALTH FIELDS
-- Add health scoring and usability flags to training_examples
-- ============================================================================

-- Add health score and tier to training_examples
ALTER TABLE public.training_examples 
  ADD COLUMN IF NOT EXISTS health_score NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS health_tier TEXT DEFAULT 'unknown' 
    CHECK (health_tier IN ('excellent', 'good', 'fair', 'poor', 'excluded', 'unknown')),
  ADD COLUMN IF NOT EXISTS health_computed_at TIMESTAMPTZ DEFAULT NULL;

-- Add usability flags
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS usable_for_training BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS usable_for_validation BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_low_quality BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_near_duplicate BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES public.training_examples(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS has_suspect_metadata BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outlier BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason TEXT DEFAULT NULL;

-- Add score source strength (derived from ground_truth.score_source)
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS score_source_strength TEXT DEFAULT 'unknown'
    CHECK (score_source_strength IN ('official', 'verified', 'self_reported', 'estimated', 'unknown'));

-- Add health factors breakdown (for explainability)
ALTER TABLE public.training_examples
  ADD COLUMN IF NOT EXISTS health_factors JSONB DEFAULT NULL;

-- ============================================================================
-- HEALTH REVIEW DECISIONS
-- Track admin decisions on flagged examples
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.health_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_example_id UUID NOT NULL REFERENCES public.training_examples(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approve_training', 'validation_only', 'exclude', 'mark_duplicate', 'needs_more_info', 'defer')),
  previous_usable_for_training BOOLEAN,
  previous_usable_for_validation BOOLEAN,
  decision_reason TEXT,
  decision_notes TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for review decisions
CREATE INDEX IF NOT EXISTS idx_health_review_decisions_example 
  ON public.health_review_decisions(training_example_id);
CREATE INDEX IF NOT EXISTS idx_health_review_decisions_decision 
  ON public.health_review_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_health_review_decisions_decided_at 
  ON public.health_review_decisions(decided_at DESC);

-- ============================================================================
-- DUPLICATE CLUSTERS
-- Group potential duplicates for review
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.duplicate_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_type TEXT NOT NULL CHECK (cluster_type IN ('exact', 'near', 'suspected')),
  cluster_reason TEXT, -- e.g., 'same_buck_id', 'similar_images', 'similar_measurements'
  primary_example_id UUID REFERENCES public.training_examples(id),
  example_count INTEGER DEFAULT 0,
  is_resolved BOOLEAN DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.duplicate_cluster_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES public.duplicate_clusters(id) ON DELETE CASCADE,
  training_example_id UUID NOT NULL REFERENCES public.training_examples(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,4) DEFAULT NULL, -- 0.0000 to 1.0000
  similarity_factors JSONB DEFAULT NULL,
  is_primary BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for duplicate clusters
CREATE INDEX IF NOT EXISTS idx_duplicate_clusters_type ON public.duplicate_clusters(cluster_type);
CREATE INDEX IF NOT EXISTS idx_duplicate_clusters_resolved ON public.duplicate_clusters(is_resolved);
CREATE INDEX IF NOT EXISTS idx_duplicate_cluster_members_cluster ON public.duplicate_cluster_members(cluster_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_cluster_members_example ON public.duplicate_cluster_members(training_example_id);

-- ============================================================================
-- OUTLIER RECORDS
-- Track detected outliers with explanation
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.outlier_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_example_id UUID NOT NULL REFERENCES public.training_examples(id) ON DELETE CASCADE,
  outlier_type TEXT NOT NULL CHECK (outlier_type IN ('score_outlier', 'error_outlier', 'measurement_outlier', 'metadata_outlier', 'correction_instability')),
  severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  outlier_reason TEXT NOT NULL,
  statistical_details JSONB, -- z-scores, percentiles, etc.
  is_resolved BOOLEAN DEFAULT false,
  resolution_action TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for outliers
CREATE INDEX IF NOT EXISTS idx_outlier_records_example ON public.outlier_records(training_example_id);
CREATE INDEX IF NOT EXISTS idx_outlier_records_type ON public.outlier_records(outlier_type);
CREATE INDEX IF NOT EXISTS idx_outlier_records_severity ON public.outlier_records(severity);
CREATE INDEX IF NOT EXISTS idx_outlier_records_resolved ON public.outlier_records(is_resolved);

-- ============================================================================
-- HEALTH COMPUTATION RUNS
-- Track when health scores were computed
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.health_computation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('full', 'incremental', 'single')),
  examples_processed INTEGER DEFAULT 0,
  duplicates_detected INTEGER DEFAULT 0,
  outliers_detected INTEGER DEFAULT 0,
  examples_flagged_for_review INTEGER DEFAULT 0,
  computation_time_ms INTEGER,
  run_config JSONB,
  run_stats JSONB,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_computation_runs_status ON public.health_computation_runs(status);
CREATE INDEX IF NOT EXISTS idx_health_computation_runs_started ON public.health_computation_runs(started_at DESC);

-- ============================================================================
-- INDEXES FOR HEALTH QUERIES ON TRAINING_EXAMPLES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_training_examples_health_tier ON public.training_examples(health_tier);
CREATE INDEX IF NOT EXISTS idx_training_examples_health_score ON public.training_examples(health_score DESC);
CREATE INDEX IF NOT EXISTS idx_training_examples_usable_training ON public.training_examples(usable_for_training) WHERE usable_for_training = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_usable_validation ON public.training_examples(usable_for_validation) WHERE usable_for_validation = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_needs_review ON public.training_examples(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_is_duplicate ON public.training_examples(is_duplicate) WHERE is_duplicate = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_is_outlier ON public.training_examples(is_outlier) WHERE is_outlier = true;
CREATE INDEX IF NOT EXISTS idx_training_examples_low_quality ON public.training_examples(is_low_quality) WHERE is_low_quality = true;

-- ============================================================================
-- VIEWS FOR HEALTH ANALYSIS
-- ============================================================================

-- Dataset health summary view
CREATE OR REPLACE VIEW public.dataset_health_summary AS
SELECT 
  health_tier,
  COUNT(*) as example_count,
  ROUND(AVG(health_score)::numeric, 2) as avg_health_score,
  COUNT(*) FILTER (WHERE usable_for_training = true) as training_eligible,
  COUNT(*) FILTER (WHERE usable_for_validation = true) as validation_eligible,
  COUNT(*) FILTER (WHERE is_low_quality = true) as low_quality_count,
  COUNT(*) FILTER (WHERE is_duplicate = true OR is_near_duplicate = true) as duplicate_count,
  COUNT(*) FILTER (WHERE is_outlier = true) as outlier_count,
  COUNT(*) FILTER (WHERE needs_review = true) as needs_review_count
FROM public.training_examples
GROUP BY health_tier
ORDER BY 
  CASE health_tier
    WHEN 'excellent' THEN 1
    WHEN 'good' THEN 2
    WHEN 'fair' THEN 3
    WHEN 'poor' THEN 4
    WHEN 'excluded' THEN 5
    ELSE 6
  END;

-- Health breakdown by source type view
CREATE OR REPLACE VIEW public.dataset_health_by_source AS
SELECT 
  b.source_type,
  COUNT(*) as example_count,
  ROUND(AVG(te.health_score)::numeric, 2) as avg_health_score,
  COUNT(*) FILTER (WHERE te.health_tier = 'excellent') as excellent_count,
  COUNT(*) FILTER (WHERE te.health_tier = 'good') as good_count,
  COUNT(*) FILTER (WHERE te.health_tier = 'fair') as fair_count,
  COUNT(*) FILTER (WHERE te.health_tier = 'poor') as poor_count,
  COUNT(*) FILTER (WHERE te.usable_for_training = true) as training_eligible
FROM public.training_examples te
JOIN public.predictions p ON te.prediction_id = p.id
JOIN public.bucks b ON p.buck_id = b.id
GROUP BY b.source_type
ORDER BY example_count DESC;

-- Health breakdown by image count view
CREATE OR REPLACE VIEW public.dataset_health_by_image_count AS
SELECT 
  CASE 
    WHEN p.images_used = 1 THEN '1 image'
    WHEN p.images_used = 2 THEN '2 images'
    WHEN p.images_used = 3 THEN '3 images'
    WHEN p.images_used >= 4 THEN '4+ images'
    ELSE 'unknown'
  END as image_count_bucket,
  COUNT(*) as example_count,
  ROUND(AVG(te.health_score)::numeric, 2) as avg_health_score,
  ROUND(AVG(ABS(te.gross_error))::numeric, 2) as avg_abs_error,
  COUNT(*) FILTER (WHERE te.usable_for_training = true) as training_eligible
FROM public.training_examples te
JOIN public.predictions p ON te.prediction_id = p.id
GROUP BY image_count_bucket
ORDER BY 
  CASE image_count_bucket
    WHEN '1 image' THEN 1
    WHEN '2 images' THEN 2
    WHEN '3 images' THEN 3
    WHEN '4+ images' THEN 4
    ELSE 5
  END;

-- ============================================================================
-- TRIGGER: Update updated_at for duplicate_clusters
-- ============================================================================

DROP TRIGGER IF EXISTS update_duplicate_clusters_updated_at ON public.duplicate_clusters;
CREATE TRIGGER update_duplicate_clusters_updated_at 
  BEFORE UPDATE ON public.duplicate_clusters 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.health_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_cluster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlier_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_computation_runs ENABLE ROW LEVEL SECURITY;

-- Allow all for service role (admin-only features)
CREATE POLICY "Allow all for health_review_decisions" ON public.health_review_decisions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for duplicate_clusters" ON public.duplicate_clusters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for duplicate_cluster_members" ON public.duplicate_cluster_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for outlier_records" ON public.outlier_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for health_computation_runs" ON public.health_computation_runs FOR ALL USING (true) WITH CHECK (true);
