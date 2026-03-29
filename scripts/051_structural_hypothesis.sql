-- Phase 51: Structural Rack Hypothesis Solving
-- Schema for landmark-level and topology-level reverse engineering

-- ============================================================================
-- STRUCTURAL HYPOTHESIS RUNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS structural_hypothesis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  buck_id UUID REFERENCES bucks(id) ON DELETE SET NULL,
  reverse_run_id UUID REFERENCES reverse_runs(id) ON DELETE SET NULL,
  requested_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Run configuration
  analysis_mode TEXT NOT NULL DEFAULT 'structural' CHECK (analysis_mode IN ('structural', 'hybrid', 'measurement_only')),
  structural_mode_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Baseline snapshot (structural interpretation from scoring)
  baseline_structure JSONB,
  baseline_landmarks JSONB,
  baseline_topology JSONB,
  
  -- Results
  winning_candidate_id UUID,
  winning_structure JSONB,
  winning_topology JSONB,
  structural_change_reasons TEXT[],
  primary_structural_reason TEXT,
  confidence_shift_reason TEXT,
  
  -- Scoring deltas
  baseline_gross DECIMAL(10,2),
  baseline_net DECIMAL(10,2),
  final_gross DECIMAL(10,2),
  final_net DECIMAL(10,2),
  gross_delta DECIMAL(10,2),
  net_delta DECIMAL(10,2),
  
  -- Timing and metadata
  settings JSONB,
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_structural_runs_prediction ON structural_hypothesis_runs(prediction_id);
CREATE INDEX IF NOT EXISTS idx_structural_runs_buck ON structural_hypothesis_runs(buck_id);
CREATE INDEX IF NOT EXISTS idx_structural_runs_status ON structural_hypothesis_runs(status);
CREATE INDEX IF NOT EXISTS idx_structural_runs_created ON structural_hypothesis_runs(created_at DESC);

-- ============================================================================
-- STRUCTURAL HYPOTHESIS CANDIDATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS structural_hypothesis_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structural_run_id UUID NOT NULL REFERENCES structural_hypothesis_runs(id) ON DELETE CASCADE,
  
  -- Candidate ranking
  candidate_rank INTEGER NOT NULL,
  
  -- Candidate type
  candidate_type TEXT NOT NULL CHECK (candidate_type IN (
    'baseline_structure',
    'spread_anchor_shift',
    'beam_tip_reassignment',
    'tine_topology_variant',
    'asymmetry_rebalanced',
    'occlusion_recovery_variant',
    'left_right_association_variant',
    'combo_structure_variant'
  )),
  
  -- Structural parameters (the actual hypothesis)
  structural_params JSONB NOT NULL,
  
  -- Derived landmark positions
  landmark_overrides JSONB,
  
  -- Topology interpretation
  topology_interpretation JSONB,
  
  -- Measurement family effects
  affected_families TEXT[],
  
  -- Generation metadata
  generation_reason TEXT,
  triggering_signals TEXT[],
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structural_cand_run ON structural_hypothesis_candidates(structural_run_id);
CREATE INDEX IF NOT EXISTS idx_structural_cand_type ON structural_hypothesis_candidates(candidate_type);
CREATE INDEX IF NOT EXISTS idx_structural_cand_rank ON structural_hypothesis_candidates(structural_run_id, candidate_rank);

-- ============================================================================
-- STRUCTURAL HYPOTHESIS EVALUATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS structural_hypothesis_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES structural_hypothesis_candidates(id) ON DELETE CASCADE,
  
  -- Overall scoring
  total_score DECIMAL(10,4) NOT NULL,
  candidate_rank_final INTEGER,
  is_winning_candidate BOOLEAN NOT NULL DEFAULT false,
  
  -- Component scores
  geometry_consistency_score DECIMAL(10,4),
  cross_view_consistency_score DECIMAL(10,4),
  landmark_agreement_score DECIMAL(10,4),
  family_plausibility_score DECIMAL(10,4),
  asymmetry_plausibility_score DECIMAL(10,4),
  structural_simplicity_score DECIMAL(10,4),
  baseline_deviation_penalty DECIMAL(10,4),
  uncertainty_reduction_benefit DECIMAL(10,4),
  
  -- Per-view support
  per_view_support JSONB,
  views_supporting INTEGER,
  views_contradicting INTEGER,
  
  -- Predicted measurements
  predicted_measurements JSONB,
  predicted_gross DECIMAL(10,2),
  predicted_net DECIMAL(10,2),
  
  -- Explanation
  reason_summary TEXT,
  evaluation_flags TEXT[],
  
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structural_eval_cand ON structural_hypothesis_evaluations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_structural_eval_winning ON structural_hypothesis_evaluations(is_winning_candidate) WHERE is_winning_candidate = true;
CREATE INDEX IF NOT EXISTS idx_structural_eval_score ON structural_hypothesis_evaluations(total_score DESC);

-- ============================================================================
-- STRUCTURAL TOPOLOGY SNAPSHOTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS structural_topology_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structural_run_id UUID NOT NULL REFERENCES structural_hypothesis_runs(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES structural_hypothesis_candidates(id) ON DELETE SET NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('baseline', 'candidate', 'winner')),
  
  -- Beam topology
  beam_path_left JSONB,
  beam_path_right JSONB,
  beam_continuity_score DECIMAL(10,4),
  
  -- Tine topology
  tine_sequence_left JSONB,
  tine_sequence_right JSONB,
  tine_ordering_confidence DECIMAL(10,4),
  missing_tines_left TEXT[],
  missing_tines_right TEXT[],
  
  -- Spread anchors
  spread_anchor_interpretation JSONB,
  spread_anchor_confidence DECIMAL(10,4),
  
  -- Mass progression
  mass_progression_left JSONB,
  mass_progression_right JSONB,
  
  -- Asymmetry interpretation
  asymmetry_interpretation JSONB,
  asymmetry_cause TEXT CHECK (asymmetry_cause IN (
    'real_asymmetry',
    'perspective_induced',
    'missing_visibility',
    'landmark_error',
    'mixed',
    'unknown'
  )),
  asymmetry_magnitude DECIMAL(10,4),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topology_snap_run ON structural_topology_snapshots(structural_run_id);
CREATE INDEX IF NOT EXISTS idx_topology_snap_type ON structural_topology_snapshots(snapshot_type);

-- ============================================================================
-- STRUCTURAL JOBS (links to durable_jobs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS structural_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structural_run_id UUID NOT NULL REFERENCES structural_hypothesis_runs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES durable_jobs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  job_stage TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(structural_run_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_structural_jobs_run ON structural_jobs(structural_run_id);
CREATE INDEX IF NOT EXISTS idx_structural_jobs_job ON structural_jobs(job_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE structural_hypothesis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE structural_hypothesis_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE structural_hypothesis_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE structural_topology_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE structural_jobs ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin full access to structural_hypothesis_runs"
  ON structural_hypothesis_runs FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin full access to structural_hypothesis_candidates"
  ON structural_hypothesis_candidates FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin full access to structural_hypothesis_evaluations"
  ON structural_hypothesis_evaluations FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin full access to structural_topology_snapshots"
  ON structural_topology_snapshots FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin full access to structural_jobs"
  ON structural_jobs FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can view their own runs
CREATE POLICY "Users can view own structural_hypothesis_runs"
  ON structural_hypothesis_runs FOR SELECT
  TO authenticated
  USING (requested_by_user_id = auth.uid());

-- Users can view candidates for their own runs
CREATE POLICY "Users can view candidates for own runs"
  ON structural_hypothesis_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structural_hypothesis_runs
      WHERE id = structural_run_id AND requested_by_user_id = auth.uid()
    )
  );

-- Users can view evaluations for their own runs
CREATE POLICY "Users can view evaluations for own runs"
  ON structural_hypothesis_evaluations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structural_hypothesis_candidates c
      JOIN structural_hypothesis_runs r ON c.structural_run_id = r.id
      WHERE c.id = candidate_id AND r.requested_by_user_id = auth.uid()
    )
  );

-- Users can view topology snapshots for their own runs
CREATE POLICY "Users can view topology snapshots for own runs"
  ON structural_topology_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structural_hypothesis_runs
      WHERE id = structural_run_id AND requested_by_user_id = auth.uid()
    )
  );

-- Service role bypass for all tables
CREATE POLICY "Service role bypass structural_hypothesis_runs"
  ON structural_hypothesis_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role bypass structural_hypothesis_candidates"
  ON structural_hypothesis_candidates FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role bypass structural_hypothesis_evaluations"
  ON structural_hypothesis_evaluations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role bypass structural_topology_snapshots"
  ON structural_topology_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role bypass structural_jobs"
  ON structural_jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- ADD STRUCTURAL MODE FIELDS TO REVERSE_RUNS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reverse_runs' AND column_name = 'structural_mode'
  ) THEN
    ALTER TABLE reverse_runs ADD COLUMN structural_mode TEXT DEFAULT 'disabled' CHECK (structural_mode IN ('disabled', 'enabled', 'required'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reverse_runs' AND column_name = 'structural_run_id'
  ) THEN
    ALTER TABLE reverse_runs ADD COLUMN structural_run_id UUID REFERENCES structural_hypothesis_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- ADD STRUCTURAL FIELDS TO PREDICTIONS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'predictions' AND column_name = 'structural_metadata'
  ) THEN
    ALTER TABLE predictions ADD COLUMN structural_metadata JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'predictions' AND column_name = 'structural_solving_used'
  ) THEN
    ALTER TABLE predictions ADD COLUMN structural_solving_used BOOLEAN DEFAULT false;
  END IF;
END $$;
