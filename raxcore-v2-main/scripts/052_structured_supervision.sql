-- Phase 52: Structured Supervision + Confirmed-Error Learning Loop
-- This migration creates the data model for capturing structured supervision signals
-- from reverse-engineering, structural solving, benchmarks, and admin confirmations.

-- ============================================================================
-- SUPERVISION TYPES ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE supervision_type AS ENUM (
    'official_score_submitted',
    'official_measurement_breakdown_submitted',
    'reverse_pass_improved_result',
    'reverse_pass_found_scale_issue',
    'reverse_pass_found_asymmetry_issue',
    'structural_solver_corrected_topology',
    'benchmark_failure_cluster',
    'confidence_overclaim',
    'confidence_underclaim',
    'interval_miss',
    'segment_regression_detected',
    'admin_confirmed_failure_cause',
    'admin_rejected_failure_cause',
    'hard_case_promoted_for_learning'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- FAILURE CAUSE LABELS ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE failure_cause_label AS ENUM (
    'scale_reference_failure',
    'weak_front_reference',
    'weak_side_reference',
    'beam_tip_misread',
    'tine_occlusion',
    'tine_topology_confusion',
    'asymmetry_perspective_confound',
    'left_right_association_error',
    'weak_multi_view_agreement',
    'crop_or_occlusion_failure',
    'lighting_quality_failure',
    'confidence_overestimate',
    'confidence_underestimate',
    'segment_calibration_miss',
    'structural_solver_overcorrection'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- LABEL STATUS ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE label_status AS ENUM (
    'pending',
    'confirmed',
    'rejected',
    'needs_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- LEARNING ACTION TYPE ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE learning_action_type AS ENUM (
    'calibration_adjustment_candidate',
    'segment_refinement_candidate',
    'protected_segment_candidate',
    'shadow_test_recommendation',
    'benchmark_pack_candidate',
    'data_gap_priority_candidate',
    'fine_tuning_label_candidate',
    'ui_guidance_candidate'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- SUPERVISION_EVENTS TABLE
-- Core table for all supervision signals
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event type and source
  supervision_type supervision_type NOT NULL,
  source TEXT NOT NULL, -- 'auto', 'reverse_pass', 'structural_solver', 'benchmark', 'admin'
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50, -- 0.00 to 1.00
  
  -- Status tracking
  label_status label_status NOT NULL DEFAULT 'pending',
  
  -- Links to related entities
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  buck_id UUID REFERENCES bucks(id) ON DELETE SET NULL,
  reverse_run_id UUID REFERENCES reverse_runs(id) ON DELETE SET NULL,
  structural_hypothesis_run_id UUID REFERENCES structural_hypothesis_runs(id) ON DELETE SET NULL,
  evaluation_run_id UUID REFERENCES evaluation_runs(id) ON DELETE SET NULL,
  benchmark_run_id UUID REFERENCES benchmark_runs(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES candidate_variants(id) ON DELETE SET NULL,
  
  -- User/admin who confirmed/reviewed
  confirmed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  
  -- Rich metadata
  metadata_json JSONB DEFAULT '{}',
  
  -- What changed as a result of this supervision
  delta_gross DECIMAL(5,2),
  delta_net DECIMAL(5,2),
  delta_confidence DECIMAL(5,2),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervision_events_type ON supervision_events(supervision_type);
CREATE INDEX IF NOT EXISTS idx_supervision_events_prediction ON supervision_events(prediction_id) WHERE prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supervision_events_buck ON supervision_events(buck_id) WHERE buck_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supervision_events_status ON supervision_events(label_status);
CREATE INDEX IF NOT EXISTS idx_supervision_events_source ON supervision_events(source);
CREATE INDEX IF NOT EXISTS idx_supervision_events_created ON supervision_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervision_events_confirmed_by ON supervision_events(confirmed_by_user_id) WHERE confirmed_by_user_id IS NOT NULL;

-- ============================================================================
-- SUPERVISION_LABELS TABLE
-- Structured failure cause labels attached to supervision events
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervision_event_id UUID NOT NULL REFERENCES supervision_events(id) ON DELETE CASCADE,
  
  -- The failure cause label
  label failure_cause_label NOT NULL,
  
  -- Label confidence and source
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  source TEXT NOT NULL, -- 'auto', 'admin-confirmed', 'benchmark-derived', 'reverse-pass-derived'
  
  -- Evidence for this label
  evidence_summary TEXT,
  
  -- Status
  status label_status NOT NULL DEFAULT 'pending',
  
  -- Admin review metadata
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervision_labels_event ON supervision_labels(supervision_event_id);
CREATE INDEX IF NOT EXISTS idx_supervision_labels_label ON supervision_labels(label);
CREATE INDEX IF NOT EXISTS idx_supervision_labels_status ON supervision_labels(status);
CREATE INDEX IF NOT EXISTS idx_supervision_labels_source ON supervision_labels(source);

-- ============================================================================
-- SUPERVISION_EVIDENCE TABLE
-- Supporting evidence for supervision events/labels
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervision_event_id UUID NOT NULL REFERENCES supervision_events(id) ON DELETE CASCADE,
  
  -- Evidence type and content
  evidence_type TEXT NOT NULL, -- 'measurement_comparison', 'image_analysis', 'cross_view_conflict', 'benchmark_result', etc.
  evidence_data JSONB NOT NULL DEFAULT '{}',
  
  -- Strength of evidence
  strength DECIMAL(3,2) NOT NULL DEFAULT 0.50, -- 0.00 to 1.00
  
  -- Optional link to source
  source_image_id UUID REFERENCES buck_images(id) ON DELETE SET NULL,
  source_hypothesis_candidate_id UUID,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervision_evidence_event ON supervision_evidence(supervision_event_id);
CREATE INDEX IF NOT EXISTS idx_supervision_evidence_type ON supervision_evidence(evidence_type);

-- ============================================================================
-- SUPERVISION_FEEDBACK TABLE
-- Admin/user feedback on supervision events
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervision_event_id UUID NOT NULL REFERENCES supervision_events(id) ON DELETE CASCADE,
  
  -- Feedback author
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Feedback type
  feedback_type TEXT NOT NULL, -- 'confirm', 'reject', 'override', 'note'
  
  -- Override data (if feedback_type = 'override')
  override_label failure_cause_label,
  override_confidence DECIMAL(3,2),
  
  -- Notes
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervision_feedback_event ON supervision_feedback(supervision_event_id);
CREATE INDEX IF NOT EXISTS idx_supervision_feedback_user ON supervision_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_supervision_feedback_type ON supervision_feedback(feedback_type);

-- ============================================================================
-- HARD_CASE_PATTERNS TABLE
-- Recurring hard-case patterns accumulated over time
-- ============================================================================

CREATE TABLE IF NOT EXISTS hard_case_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pattern definition
  pattern_name TEXT NOT NULL UNIQUE,
  pattern_definition JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  
  -- Pattern statistics
  examples_count INTEGER NOT NULL DEFAULT 0,
  severity DECIMAL(3,2) NOT NULL DEFAULT 0.50, -- 0.00 (low) to 1.00 (high)
  
  -- Associated labels
  associated_labels failure_cause_label[] DEFAULT '{}',
  
  -- Segment distribution
  segment_distribution JSONB DEFAULT '{}', -- { "state": {...}, "rack_type": {...}, "source_type": {...} }
  
  -- Mitigation tracking
  mitigation_status TEXT NOT NULL DEFAULT 'unaddressed', -- 'unaddressed', 'in_progress', 'mitigated', 'wont_fix'
  mitigation_notes TEXT,
  
  -- Candidate variant tracking
  candidate_variants_helping UUID[] DEFAULT '{}',
  candidate_variants_hurting UUID[] DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hard_case_patterns_name ON hard_case_patterns(pattern_name);
CREATE INDEX IF NOT EXISTS idx_hard_case_patterns_severity ON hard_case_patterns(severity DESC);
CREATE INDEX IF NOT EXISTS idx_hard_case_patterns_mitigation ON hard_case_patterns(mitigation_status);
CREATE INDEX IF NOT EXISTS idx_hard_case_patterns_examples ON hard_case_patterns(examples_count DESC);

-- ============================================================================
-- HARD_CASE_PATTERN_EXAMPLES TABLE
-- Links predictions/bucks to hard-case patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS hard_case_pattern_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID NOT NULL REFERENCES hard_case_patterns(id) ON DELETE CASCADE,
  
  -- The example
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  buck_id UUID REFERENCES bucks(id) ON DELETE SET NULL,
  
  -- Match confidence
  match_confidence DECIMAL(3,2) NOT NULL DEFAULT 0.70,
  
  -- Matching features
  matching_features JSONB DEFAULT '{}',
  
  -- Error metrics at time of association
  error_gross DECIMAL(5,2),
  error_net DECIMAL(5,2),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hard_case_examples_pattern ON hard_case_pattern_examples(pattern_id);
CREATE INDEX IF NOT EXISTS idx_hard_case_examples_prediction ON hard_case_pattern_examples(prediction_id) WHERE prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hard_case_examples_buck ON hard_case_pattern_examples(buck_id) WHERE buck_id IS NOT NULL;

-- ============================================================================
-- LEARNING_ACTIONS TABLE
-- Generated learning action suggestions
-- ============================================================================

CREATE TABLE IF NOT EXISTS learning_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Action type
  action_type learning_action_type NOT NULL,
  
  -- Related supervision events
  supervision_event_ids UUID[] DEFAULT '{}',
  hard_case_pattern_id UUID REFERENCES hard_case_patterns(id) ON DELETE SET NULL,
  
  -- Action details
  action_description TEXT NOT NULL,
  action_params JSONB DEFAULT '{}',
  
  -- Priority and confidence
  priority TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  
  -- Impact estimation
  estimated_impact JSONB DEFAULT '{}', -- { "affected_segments": [...], "expected_improvement": {...} }
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'implemented', 'archived'
  
  -- Review tracking
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Implementation tracking
  implemented_at TIMESTAMPTZ,
  implementation_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_actions_type ON learning_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_learning_actions_status ON learning_actions(status);
CREATE INDEX IF NOT EXISTS idx_learning_actions_priority ON learning_actions(priority);
CREATE INDEX IF NOT EXISTS idx_learning_actions_pattern ON learning_actions(hard_case_pattern_id) WHERE hard_case_pattern_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_actions_created ON learning_actions(created_at DESC);

-- ============================================================================
-- SUPERVISION_SEGMENT_STATS TABLE
-- Aggregated supervision statistics by segment
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_segment_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Segment identifiers
  segment_type TEXT NOT NULL, -- 'state', 'rack_type', 'source_type', 'image_count_tier'
  segment_value TEXT NOT NULL,
  
  -- Statistics
  total_events INTEGER NOT NULL DEFAULT 0,
  confirmed_events INTEGER NOT NULL DEFAULT 0,
  rejected_events INTEGER NOT NULL DEFAULT 0,
  
  -- Label distribution
  label_distribution JSONB DEFAULT '{}', -- { "scale_reference_failure": 5, ... }
  
  -- Confidence statistics
  avg_confidence DECIMAL(3,2),
  overclaim_rate DECIMAL(3,2),
  underclaim_rate DECIMAL(3,2),
  
  -- Interval miss rate
  interval_miss_rate DECIMAL(3,2),
  
  -- Last updated
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(segment_type, segment_value)
);

CREATE INDEX IF NOT EXISTS idx_supervision_segment_type ON supervision_segment_stats(segment_type);
CREATE INDEX IF NOT EXISTS idx_supervision_segment_value ON supervision_segment_stats(segment_value);

-- ============================================================================
-- CONFIDENCE_LEARNING_SIGNALS TABLE
-- Signals for improving confidence/interval calibration
-- ============================================================================

CREATE TABLE IF NOT EXISTS confidence_learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related prediction
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  
  -- Signal type
  signal_type TEXT NOT NULL, -- 'interval_miss', 'overclaim', 'underclaim', 'accurate_high_confidence', 'accurate_low_confidence'
  
  -- Predicted vs actual
  predicted_confidence DECIMAL(5,2),
  predicted_error_band_low DECIMAL(5,2),
  predicted_error_band_high DECIMAL(5,2),
  actual_error DECIMAL(5,2),
  
  -- Was interval correct?
  was_within_interval BOOLEAN,
  
  -- Segment info for stratification
  state TEXT,
  rack_type TEXT,
  source_type TEXT,
  image_count INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confidence_signals_prediction ON confidence_learning_signals(prediction_id);
CREATE INDEX IF NOT EXISTS idx_confidence_signals_type ON confidence_learning_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_confidence_signals_state ON confidence_learning_signals(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_confidence_signals_created ON confidence_learning_signals(created_at DESC);

-- ============================================================================
-- SUPERVISION_EXPORT_READINESS TABLE
-- Tracks which supervision data is ready for export/training use
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervision_export_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What is being marked
  supervision_event_id UUID REFERENCES supervision_events(id) ON DELETE CASCADE,
  hard_case_pattern_id UUID REFERENCES hard_case_patterns(id) ON DELETE CASCADE,
  
  -- Export flags
  ready_for_weak_label BOOLEAN NOT NULL DEFAULT FALSE,
  ready_for_confirmed_label BOOLEAN NOT NULL DEFAULT FALSE,
  ready_for_fine_tuning BOOLEAN NOT NULL DEFAULT FALSE,
  ready_for_benchmark_pack BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Quality score for training use
  training_quality_score DECIMAL(3,2),
  
  -- Export metadata
  export_metadata JSONB DEFAULT '{}',
  
  -- Last exported
  last_exported_at TIMESTAMPTZ,
  export_batch_id TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- At least one must be set
  CHECK (supervision_event_id IS NOT NULL OR hard_case_pattern_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_export_readiness_event ON supervision_export_readiness(supervision_event_id) WHERE supervision_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_export_readiness_pattern ON supervision_export_readiness(hard_case_pattern_id) WHERE hard_case_pattern_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_export_readiness_fine_tuning ON supervision_export_readiness(ready_for_fine_tuning) WHERE ready_for_fine_tuning = TRUE;
CREATE INDEX IF NOT EXISTS idx_export_readiness_weak ON supervision_export_readiness(ready_for_weak_label) WHERE ready_for_weak_label = TRUE;

-- ============================================================================
-- UPDATE PREDICTIONS TABLE - Add supervision metadata column
-- ============================================================================

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS supervision_metadata JSONB DEFAULT NULL;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS supervision_event_count INTEGER DEFAULT 0;

ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS hard_case_pattern_ids UUID[] DEFAULT '{}';

-- ============================================================================
-- UPDATE REVERSE_RUNS TABLE - Add supervision event link
-- ============================================================================

ALTER TABLE reverse_runs 
ADD COLUMN IF NOT EXISTS supervision_event_id UUID REFERENCES supervision_events(id) ON DELETE SET NULL;

-- ============================================================================
-- UPDATE STRUCTURAL_HYPOTHESIS_RUNS TABLE - Add supervision event link
-- ============================================================================

ALTER TABLE structural_hypothesis_runs 
ADD COLUMN IF NOT EXISTS supervision_event_id UUID REFERENCES supervision_events(id) ON DELETE SET NULL;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_supervision_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_supervision_events_updated ON supervision_events;
CREATE TRIGGER trigger_supervision_events_updated
  BEFORE UPDATE ON supervision_events
  FOR EACH ROW EXECUTE FUNCTION update_supervision_updated_at();

DROP TRIGGER IF EXISTS trigger_supervision_labels_updated ON supervision_labels;
CREATE TRIGGER trigger_supervision_labels_updated
  BEFORE UPDATE ON supervision_labels
  FOR EACH ROW EXECUTE FUNCTION update_supervision_updated_at();

DROP TRIGGER IF EXISTS trigger_hard_case_patterns_updated ON hard_case_patterns;
CREATE TRIGGER trigger_hard_case_patterns_updated
  BEFORE UPDATE ON hard_case_patterns
  FOR EACH ROW EXECUTE FUNCTION update_supervision_updated_at();

DROP TRIGGER IF EXISTS trigger_learning_actions_updated ON learning_actions;
CREATE TRIGGER trigger_learning_actions_updated
  BEFORE UPDATE ON learning_actions
  FOR EACH ROW EXECUTE FUNCTION update_supervision_updated_at();

DROP TRIGGER IF EXISTS trigger_export_readiness_updated ON supervision_export_readiness;
CREATE TRIGGER trigger_export_readiness_updated
  BEFORE UPDATE ON supervision_export_readiness
  FOR EACH ROW EXECUTE FUNCTION update_supervision_updated_at();

-- ============================================================================
-- HELPER VIEW: supervision_events_with_labels
-- ============================================================================

CREATE OR REPLACE VIEW supervision_events_with_labels AS
SELECT 
  se.*,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'id', sl.id,
      'label', sl.label,
      'confidence', sl.confidence,
      'source', sl.source,
      'status', sl.status
    ))
    FROM supervision_labels sl 
    WHERE sl.supervision_event_id = se.id),
    '[]'::jsonb
  ) as labels,
  (SELECT COUNT(*) FROM supervision_labels sl WHERE sl.supervision_event_id = se.id) as label_count,
  (SELECT COUNT(*) FROM supervision_evidence sev WHERE sev.supervision_event_id = se.id) as evidence_count,
  (SELECT COUNT(*) FROM supervision_feedback sf WHERE sf.supervision_event_id = se.id) as feedback_count
FROM supervision_events se;

-- ============================================================================
-- HELPER VIEW: hard_case_patterns_summary
-- ============================================================================

CREATE OR REPLACE VIEW hard_case_patterns_summary AS
SELECT 
  hcp.*,
  (SELECT COUNT(*) FROM hard_case_pattern_examples hcpe WHERE hcpe.pattern_id = hcp.id) as actual_example_count,
  (SELECT AVG(hcpe.error_gross) FROM hard_case_pattern_examples hcpe WHERE hcpe.pattern_id = hcp.id) as avg_error_gross,
  (SELECT MAX(hcpe.error_gross) FROM hard_case_pattern_examples hcpe WHERE hcpe.pattern_id = hcp.id) as max_error_gross,
  array_length(hcp.candidate_variants_helping, 1) as helping_variants_count,
  array_length(hcp.candidate_variants_hurting, 1) as hurting_variants_count
FROM hard_case_patterns hcp;

-- ============================================================================
-- HELPER VIEW: learning_actions_dashboard
-- ============================================================================

CREATE OR REPLACE VIEW learning_actions_dashboard AS
SELECT 
  la.*,
  (SELECT p.display_name FROM profiles p WHERE p.id = la.reviewed_by_user_id) as reviewer_name,
  hcp.pattern_name as hard_case_pattern_name,
  array_length(la.supervision_event_ids, 1) as supervision_event_count
FROM learning_actions la
LEFT JOIN hard_case_patterns hcp ON hcp.id = la.hard_case_pattern_id;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE supervision_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE hard_case_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE hard_case_pattern_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_segment_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_learning_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_export_readiness ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for supervision tables (internal/admin feature)
CREATE POLICY "Admin full access to supervision_events" ON supervision_events
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to supervision_labels" ON supervision_labels
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to supervision_evidence" ON supervision_evidence
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to supervision_feedback" ON supervision_feedback
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to hard_case_patterns" ON hard_case_patterns
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to hard_case_pattern_examples" ON hard_case_pattern_examples
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to learning_actions" ON learning_actions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to supervision_segment_stats" ON supervision_segment_stats
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to confidence_learning_signals" ON confidence_learning_signals
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access to supervision_export_readiness" ON supervision_export_readiness
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Service role bypass for all tables
CREATE POLICY "Service role bypass supervision_events" ON supervision_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass supervision_labels" ON supervision_labels FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass supervision_evidence" ON supervision_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass supervision_feedback" ON supervision_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass hard_case_patterns" ON hard_case_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass hard_case_pattern_examples" ON hard_case_pattern_examples FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass learning_actions" ON learning_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass supervision_segment_stats" ON supervision_segment_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass confidence_learning_signals" ON confidence_learning_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass supervision_export_readiness" ON supervision_export_readiness FOR ALL TO service_role USING (true) WITH CHECK (true);
