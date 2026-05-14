/**
 * Phase 52: Structured Supervision Types
 * 
 * Type definitions for the supervision system that captures and structures
 * learning signals from reverse-engineering, structural solving, benchmarks,
 * and admin confirmations.
 */

// ============================================================================
// SUPERVISION TYPE ENUMS
// ============================================================================

export type SupervisionType =
  | 'official_score_submitted'
  | 'official_measurement_breakdown_submitted'
  | 'reverse_pass_improved_result'
  | 'reverse_pass_found_scale_issue'
  | 'reverse_pass_found_asymmetry_issue'
  | 'structural_solver_corrected_topology'
  | 'multi_view_inconsistency'
  | 'benchmark_failure_cluster'
  | 'confidence_overclaim'
  | 'confidence_underclaim'
  | 'interval_miss'
  | 'segment_regression_detected'
  | 'admin_confirmed_failure_cause'
  | 'admin_rejected_failure_cause'
  | 'hard_case_promoted_for_learning'
  | 'abnormal_points_reported'  // Phase 54

export type FailureCauseLabel =
  | 'scale_reference_failure'
  | 'weak_front_reference'
  | 'weak_side_reference'
  | 'beam_tip_misread'
  | 'tine_occlusion'
  | 'tine_topology_confusion'
  | 'asymmetry_perspective_confound'
  | 'left_right_association_error'
  | 'weak_multi_view_agreement'
  | 'crop_or_occlusion_failure'
  | 'lighting_quality_failure'
  | 'confidence_overestimate'
  | 'confidence_underestimate'
  | 'segment_calibration_miss'
  | 'structural_solver_overcorrection'
  | 'abnormal_points_unscored'  // Phase 54: User reported abnormal points not in current scoring

export type LabelStatus = 'pending' | 'confirmed' | 'rejected' | 'needs_review'

export type LearningActionType =
  | 'calibration_adjustment_candidate'
  | 'segment_refinement_candidate'
  | 'protected_segment_candidate'
  | 'shadow_test_recommendation'
  | 'benchmark_pack_candidate'
  | 'data_gap_priority_candidate'
  | 'fine_tuning_label_candidate'
  | 'ui_guidance_candidate'

export type LearningActionStatus = 'pending' | 'approved' | 'rejected' | 'implemented' | 'archived' | 'applied'

export type MitigationStatus = 'unaddressed' | 'in_progress' | 'mitigated' | 'wont_fix'

export type SupervisionSource = 'auto' | 'reverse_pass' | 'structural_solver' | 'conflict_engine' | 'benchmark' | 'admin'

export type LabelSource = 'auto' | 'admin-confirmed' | 'benchmark-derived' | 'reverse-pass-derived'

export type ConfidenceSignalType = 
  | 'interval_miss' 
  | 'overclaim' 
  | 'underclaim' 
  | 'accurate_high_confidence' 
  | 'accurate_low_confidence'

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface SupervisionEventRow {
  id: string
  supervision_type: SupervisionType
  source: SupervisionSource
  confidence: number
  label_status: LabelStatus
  prediction_id: string | null
  buck_id: string | null
  reverse_run_id: string | null
  structural_hypothesis_run_id: string | null
  evaluation_run_id: string | null
  benchmark_run_id: string | null
  variant_id: string | null
  confirmed_by_user_id: string | null
  confirmed_at: string | null
  metadata_json: SupervisionMetadata
  delta_gross: number | null
  delta_net: number | null
  delta_confidence: number | null
  created_at: string
  updated_at: string
}

export interface SupervisionLabelRow {
  id: string
  supervision_event_id: string
  label: FailureCauseLabel
  confidence: number
  source: LabelSource
  evidence_summary: string | null
  status: LabelStatus
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
}

export interface SupervisionEvidenceRow {
  id: string
  supervision_event_id: string
  evidence_type: string
  evidence_data: Record<string, unknown>
  strength: number
  source_image_id: string | null
  source_hypothesis_candidate_id: string | null
  created_at: string
}

export interface SupervisionFeedbackRow {
  id: string
  supervision_event_id: string
  user_id: string
  feedback_type: 'confirm' | 'reject' | 'override' | 'note'
  override_label: FailureCauseLabel | null
  override_confidence: number | null
  notes: string | null
  created_at: string
}

export interface HardCasePatternRow {
  id: string
  pattern_name: string
  pattern_definition: PatternDefinition
  description: string | null
  examples_count: number
  severity: number
  associated_labels: FailureCauseLabel[]
  segment_distribution: SegmentDistribution
  mitigation_status: MitigationStatus
  mitigation_notes: string | null
  candidate_variants_helping: string[]
  candidate_variants_hurting: string[]
  created_at: string
  updated_at: string
}

export interface HardCasePatternExampleRow {
  id: string
  pattern_id: string
  prediction_id: string | null
  buck_id: string | null
  match_confidence: number
  matching_features: Record<string, unknown>
  error_gross: number | null
  error_net: number | null
  created_at: string
}

export interface LearningActionRow {
  id: string
  action_type: LearningActionType
  supervision_event_ids: string[]
  hard_case_pattern_id: string | null
  action_description: string
  action_params: LearningActionParams
  priority: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  estimated_impact: EstimatedImpact
  status: LearningActionStatus
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_notes: string | null
  implemented_at: string | null
  implementation_notes: string | null
  created_at: string
  updated_at: string
}

export interface SupervisionSegmentStatsRow {
  id: string
  segment_type: string
  segment_value: string
  total_events: number
  confirmed_events: number
  rejected_events: number
  label_distribution: Record<FailureCauseLabel, number>
  avg_confidence: number | null
  overclaim_rate: number | null
  underclaim_rate: number | null
  interval_miss_rate: number | null
  computed_at: string
}

export interface ConfidenceLearningSignalRow {
  id: string
  prediction_id: string
  signal_type: ConfidenceSignalType
  predicted_confidence: number | null
  predicted_error_band_low: number | null
  predicted_error_band_high: number | null
  actual_error: number | null
  was_within_interval: boolean | null
  state: string | null
  rack_type: string | null
  source_type: string | null
  image_count: number | null
  created_at: string
}

export interface SupervisionExportReadinessRow {
  id: string
  supervision_event_id: string | null
  hard_case_pattern_id: string | null
  ready_for_weak_label: boolean
  ready_for_confirmed_label: boolean
  ready_for_fine_tuning: boolean
  ready_for_benchmark_pack: boolean
  training_quality_score: number | null
  export_metadata: Record<string, unknown>
  last_exported_at: string | null
  export_batch_id: string | null
  created_at: string
  updated_at: string
}

// ============================================================================
// METADATA AND PARAMS TYPES
// ============================================================================

export interface SupervisionMetadata {
  // Context about what triggered this event
  trigger_context?: string
  
  // Measurement changes
  original_measurements?: Record<string, number | null>
  corrected_measurements?: Record<string, number | null>
  
  // Error analysis
  original_error_gross?: number
  corrected_error_gross?: number
  improvement_percent?: number
  
  // Cross-view data
  cross_view_disagreement_score?: number
  rejected_views?: number[]
  
  // Structural solving data
  winning_hypothesis_type?: string
  topology_changes?: string[]
  
  // Benchmark data
  benchmark_pack_id?: string
  affected_example_count?: number
  regression_amount?: number
  
  // Admin notes
  admin_notes?: string
  
  // Any additional context
  [key: string]: unknown
}

export interface PatternDefinition {
  // Conditions that define this pattern
  conditions: PatternCondition[]
  
  // Logical operator for conditions
  operator: 'AND' | 'OR'
  
  // Optional description of what this pattern represents
  pattern_description?: string
}

export interface PatternCondition {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains'
  value: string | number | boolean | string[]
}

export interface SegmentDistribution {
  state?: Record<string, number>
  rack_type?: Record<string, number>
  source_type?: Record<string, number>
  image_count_tier?: Record<string, number>
}

export interface LearningActionParams {
  // For calibration adjustments
  target_segment?: string
  adjustment_type?: string
  suggested_value?: number
  
  // For segment refinement
  segment_definition?: Record<string, unknown>
  
  // For protected segment
  protection_level?: string
  threshold_adjustment?: number
  
  // For shadow test
  variant_ids?: string[]
  test_duration_days?: number
  
  // For benchmark pack
  example_ids?: string[]
  pack_name?: string
  
  // For data gap
  gap_description?: string
  priority_score?: number
  
  // For fine-tuning
  label_type?: string
  label_confidence?: number
  
  // For UI guidance
  guidance_type?: string
  guidance_message?: string
  target_condition?: string
  
  [key: string]: unknown
}

export interface EstimatedImpact {
  affected_segments?: string[]
  expected_improvement?: {
    metric: string
    current_value: number
    expected_value: number
    improvement_percent: number
  }[]
  affected_prediction_count?: number
  risk_level?: 'low' | 'medium' | 'high'
}

// ============================================================================
// VIEW TYPES (with aggregated data)
// ============================================================================

export interface SupervisionEventWithLabels extends SupervisionEventRow {
  labels: Array<{
    id: string
    label: FailureCauseLabel
    confidence: number
    source: LabelSource
    status: LabelStatus
  }>
  label_count: number
  evidence_count: number
  feedback_count: number
}

export interface HardCasePatternSummary extends HardCasePatternRow {
  actual_example_count: number
  avg_error_gross: number | null
  max_error_gross: number | null
  helping_variants_count: number | null
  hurting_variants_count: number | null
}

export interface LearningActionDashboard extends LearningActionRow {
  reviewer_name: string | null
  hard_case_pattern_name: string | null
  supervision_event_count: number | null
}

// ============================================================================
// SERVICE INPUT/OUTPUT TYPES
// ============================================================================

export interface CreateSupervisionEventInput {
  supervision_type: SupervisionType
  source: SupervisionSource
  confidence?: number
  prediction_id?: string
  buck_id?: string
  reverse_run_id?: string
  structural_hypothesis_run_id?: string
  evaluation_run_id?: string
  benchmark_run_id?: string
  variant_id?: string
  metadata_json?: SupervisionMetadata
  delta_gross?: number
  delta_net?: number
  delta_confidence?: number
  labels?: Array<{
    label: FailureCauseLabel
    confidence: number
    source: LabelSource
    evidence_summary?: string
  }>
  evidence?: Array<{
    evidence_type: string
    evidence_data: Record<string, unknown>
    strength: number
    source_image_id?: string
  }>
}

export interface UpdateSupervisionLabelInput {
  status?: LabelStatus
  confidence?: number
  review_notes?: string
}

export interface CreateHardCasePatternInput {
  pattern_name: string
  pattern_definition: PatternDefinition
  description?: string
  severity?: number
  associated_labels?: FailureCauseLabel[]
}

export interface CreateLearningActionInput {
  action_type: LearningActionType
  supervision_event_ids?: string[]
  hard_case_pattern_id?: string
  action_description: string
  action_params?: LearningActionParams
  priority?: 'low' | 'medium' | 'high' | 'critical'
  confidence?: number
  estimated_impact?: EstimatedImpact
}

export interface SupervisionQueryFilters {
  supervision_type?: SupervisionType | SupervisionType[]
  source?: SupervisionSource | SupervisionSource[]
  label_status?: LabelStatus | LabelStatus[]
  prediction_id?: string
  buck_id?: string
  date_from?: string
  date_to?: string
  state?: string
  rack_type?: string
  min_confidence?: number
  has_labels?: boolean
  limit?: number
  offset?: number
}

export interface HardCasePatternQueryFilters {
  mitigation_status?: MitigationStatus | MitigationStatus[]
  min_severity?: number
  min_examples?: number
  associated_label?: FailureCauseLabel
  limit?: number
  offset?: number
}

export interface LearningActionQueryFilters {
  action_type?: LearningActionType | LearningActionType[]
  status?: LearningActionStatus | LearningActionStatus[]
  priority?: string | string[]
  hard_case_pattern_id?: string
  limit?: number
  offset?: number
}

// ============================================================================
// DASHBOARD AND ANALYTICS TYPES
// ============================================================================

export interface SupervisionDashboardStats {
  total_events: number
  events_by_type: Record<SupervisionType, number>
  events_by_source: Record<SupervisionSource, number>
  events_by_status: Record<LabelStatus, number>
  recent_events_count: number
  pending_review_count: number
  top_failure_causes: Array<{
    label: FailureCauseLabel
    count: number
    confirmed_count: number
  }>
  hard_case_patterns_count: number
  learning_actions_pending: number
}

export interface SupervisionTrend {
  date: string
  total_events: number
  confirmed_events: number
  reverse_pass_events: number
  structural_solver_events: number
  benchmark_events: number
  admin_events: number
}

export interface SegmentSupervisionSummary {
  segment_type: string
  segment_value: string
  total_events: number
  top_failure_causes: Array<{
    label: FailureCauseLabel
    count: number
  }>
  overclaim_rate: number | null
  underclaim_rate: number | null
  interval_miss_rate: number | null
  suggested_actions_count: number
}

export interface CaseSupervisionTrail {
  prediction_id: string
  buck_id: string | null
  original_score: {
    gross: number | null
    net: number | null
    confidence: number | null
  }
  supervision_events: SupervisionEventWithLabels[]
  reverse_pass_outcomes: Array<{
    run_id: string
    best_hypothesis_type: string | null
    delta_gross: number | null
    delta_net: number | null
    completed_at: string | null
  }>
  structural_solving_outcomes: Array<{
    run_id: string
    winning_candidate_type: string | null
    primary_reason: string | null
    delta_gross: number | null
    delta_net: number | null
    completed_at: string | null
  }>
  inferred_failure_causes: Array<{
    label: FailureCauseLabel
    confidence: number
    source: LabelSource
    status: LabelStatus
  }>
  confirmation_history: SupervisionFeedbackRow[]
  associated_hard_case_patterns: Array<{
    pattern_id: string
    pattern_name: string
    match_confidence: number
  }>
  suggested_learning_actions: LearningActionRow[]
}

// ============================================================================
// EXPORT/TRAINING READINESS TYPES
// ============================================================================

export interface ExportBatch {
  batch_id: string
  export_type: 'weak_labels' | 'confirmed_labels' | 'fine_tuning' | 'benchmark_pack'
  item_count: number
  exported_at: string
  metadata: Record<string, unknown>
}

export interface TrainingDataCandidate {
  supervision_event_id?: string
  hard_case_pattern_id?: string
  prediction_id?: string
  buck_id?: string
  labels: Array<{
    label: FailureCauseLabel
    confidence: number
    is_confirmed: boolean
  }>
  training_quality_score: number
  export_ready: boolean
}
