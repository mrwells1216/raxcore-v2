/**
 * Phase 51: Structural Rack Hypothesis Solving
 * Type definitions for landmark-level and topology-level reverse engineering
 */

import type { Measurements, AngleType, MeasurementFamily, LandmarksDetected } from '@/lib/types'
import type { AllLandmarkId, LandmarkPoint45 } from '@/lib/vision/landmarks/types'

// ============================================================================
// ENUMS AND STATUS TYPES
// ============================================================================

export type StructuralRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AnalysisMode = 'structural' | 'hybrid' | 'measurement_only'

export type StructuralCandidateType =
  | 'baseline_structure'
  | 'spread_anchor_shift'
  | 'beam_tip_reassignment'
  | 'tine_topology_variant'
  | 'asymmetry_rebalanced'
  | 'occlusion_recovery_variant'
  | 'left_right_association_variant'
  | 'combo_structure_variant'

export type AsymmetryCause =
  | 'real_asymmetry'
  | 'perspective_induced'
  | 'missing_visibility'
  | 'landmark_error'
  | 'mixed'
  | 'unknown'

export type StructuralChangeReason =
  | 'beam_tip_reassigned_due_to_cross_view_conflict'
  | 'spread_anchor_shift_due_to_front_reference_conflict'
  | 'tine_topology_reordered_due_to_occlusion'
  | 'asymmetry_reinterpreted_as_perspective'
  | 'left_right_landmark_association_corrected'
  | 'occlusion_recovered_from_alternate_view'
  | 'tine_grouping_corrected'
  | 'mass_progression_normalized'
  | 'beam_continuity_enforced'
  | 'spread_reference_conflict_resolved'

// ============================================================================
// TOPOLOGY INTERPRETATION
// ============================================================================

export interface BeamPathPoint {
  landmarkId: AllLandmarkId
  position: { x: number; y: number }
  confidence: number
  sourceImageIndex: number
}

export interface TineSequenceItem {
  tineId: string // e.g., 'g1', 'g2', etc.
  basePosition: { x: number; y: number } | null
  tipPosition: { x: number; y: number } | null
  confidence: number
  isVisible: boolean
  isOccluded: boolean
  expectedPosition: number // 0-1 along beam
  sourceImageIndices: number[]
}

export interface SpreadAnchorInterpretation {
  leftAnchorLandmark: AllLandmarkId | null
  rightAnchorLandmark: AllLandmarkId | null
  leftPosition: { x: number; y: number } | null
  rightPosition: { x: number; y: number } | null
  anchorType: 'burr_to_burr' | 'beam_inner' | 'inferred' | 'uncertain'
  confidence: number
  sourceImageIndex: number
}

export interface MassProgressionItem {
  circumferenceId: string // e.g., 'h1', 'h2', etc.
  value: number | null
  expectedProgression: 'decreasing' | 'increasing' | 'stable'
  plausibilityScore: number
}

export interface AsymmetryInterpretation {
  overallAsymmetryPercent: number
  beamAsymmetryPercent: number
  tineAsymmetryPercent: number
  massAsymmetryPercent: number
  cause: AsymmetryCause
  causeConfidence: number
  viewsSupporting: number
  viewsContradicting: number
  shouldApplyDeduction: boolean
  suggestedDeductionAdjustment: number
}

export interface TopologyInterpretation {
  beamPathLeft: BeamPathPoint[]
  beamPathRight: BeamPathPoint[]
  beamContinuityScore: number
  
  tineSequenceLeft: TineSequenceItem[]
  tineSequenceRight: TineSequenceItem[]
  tineOrderingConfidence: number
  missingTinesLeft: string[]
  missingTinesRight: string[]
  
  spreadAnchor: SpreadAnchorInterpretation
  
  massProgressionLeft: MassProgressionItem[]
  massProgressionRight: MassProgressionItem[]
  
  asymmetry: AsymmetryInterpretation
}

// ============================================================================
// STRUCTURAL PARAMETERS
// ============================================================================

export interface LandmarkOverride {
  landmarkId: AllLandmarkId
  originalPosition: { x: number; y: number } | null
  newPosition: { x: number; y: number }
  confidence: number
  reason: string
}

export interface StructuralParams {
  // Landmark-level overrides
  landmarkOverrides?: LandmarkOverride[]
  
  // Spread anchor adjustment
  spreadAnchorShift?: {
    leftDelta: { x: number; y: number }
    rightDelta: { x: number; y: number }
    reason: string
  }
  
  // Beam tip reassignment
  beamTipReassignment?: {
    side: 'left' | 'right' | 'both'
    newTipLandmarks: Partial<Record<AllLandmarkId, { x: number; y: number }>>
    reason: string
  }
  
  // Tine topology
  tineTopologyVariant?: {
    reorderedTinesLeft?: string[]
    reorderedTinesRight?: string[]
    occludedTines?: string[]
    recoveredTines?: string[]
    reason: string
  }
  
  // Asymmetry rebalancing
  asymmetryRebalance?: {
    targetSymmetry: number // 0 = fully asymmetric, 1 = fully symmetric
    family: 'beam' | 'tine' | 'mass' | 'all'
    reason: string
  }
  
  // Left/right association
  leftRightAssociationFix?: {
    swappedLandmarks: Array<{ left: AllLandmarkId; right: AllLandmarkId }>
    reason: string
  }
  
  // Occlusion recovery
  occlusionRecovery?: {
    recoveredLandmarks: AllLandmarkId[]
    sourceViewIndex: number
    reason: string
  }
  
  // Notes for debugging
  notes?: string[]
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface StructuralHypothesisRunRow {
  id: string
  prediction_id: string
  buck_id: string | null
  reverse_run_id: string | null
  requested_by_user_id: string | null
  analysis_mode: AnalysisMode
  structural_mode_enabled: boolean
  status: StructuralRunStatus
  baseline_structure: Record<string, unknown> | null
  baseline_landmarks: Record<string, unknown> | null
  baseline_topology: TopologyInterpretation | null
  winning_candidate_id: string | null
  winning_structure: Record<string, unknown> | null
  winning_topology: TopologyInterpretation | null
  structural_change_reasons: StructuralChangeReason[] | null
  primary_structural_reason: StructuralChangeReason | null
  confidence_shift_reason: string | null
  baseline_gross: number | null
  baseline_net: number | null
  final_gross: number | null
  final_net: number | null
  gross_delta: number | null
  net_delta: number | null
  settings: Record<string, unknown> | null
  processing_time_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
}

export interface StructuralHypothesisCandidateRow {
  id: string
  structural_run_id: string
  candidate_rank: number
  candidate_type: StructuralCandidateType
  structural_params: StructuralParams
  landmark_overrides: LandmarkOverride[] | null
  topology_interpretation: TopologyInterpretation | null
  affected_families: MeasurementFamily[] | null
  generation_reason: string | null
  triggering_signals: string[] | null
  created_at: string
}

export interface StructuralHypothesisEvaluationRow {
  id: string
  candidate_id: string
  total_score: number
  candidate_rank_final: number | null
  is_winning_candidate: boolean
  geometry_consistency_score: number | null
  cross_view_consistency_score: number | null
  landmark_agreement_score: number | null
  family_plausibility_score: number | null
  asymmetry_plausibility_score: number | null
  structural_simplicity_score: number | null
  baseline_deviation_penalty: number | null
  uncertainty_reduction_benefit: number | null
  per_view_support: Record<number, ViewSupportScore> | null
  views_supporting: number | null
  views_contradicting: number | null
  predicted_measurements: Measurements | null
  predicted_gross: number | null
  predicted_net: number | null
  reason_summary: string | null
  evaluation_flags: string[] | null
  computed_at: string
}

export interface ViewSupportScore {
  imageIndex: number
  angleType: AngleType
  supportScore: number
  landmarkAgreement: number
  structureAgreement: number
  contradictionReasons: string[]
}

export interface StructuralTopologySnapshotRow {
  id: string
  structural_run_id: string
  candidate_id: string | null
  snapshot_type: 'baseline' | 'candidate' | 'winner'
  beam_path_left: BeamPathPoint[] | null
  beam_path_right: BeamPathPoint[] | null
  beam_continuity_score: number | null
  tine_sequence_left: TineSequenceItem[] | null
  tine_sequence_right: TineSequenceItem[] | null
  tine_ordering_confidence: number | null
  missing_tines_left: string[] | null
  missing_tines_right: string[] | null
  spread_anchor_interpretation: SpreadAnchorInterpretation | null
  spread_anchor_confidence: number | null
  mass_progression_left: MassProgressionItem[] | null
  mass_progression_right: MassProgressionItem[] | null
  asymmetry_interpretation: AsymmetryInterpretation | null
  asymmetry_cause: AsymmetryCause | null
  asymmetry_magnitude: number | null
  created_at: string
}

// ============================================================================
// INPUT/OUTPUT TYPES
// ============================================================================

export interface StructuralSolvingInput {
  predictionId: string
  buckId: string
  userId: string
  
  // Current scoring data
  baseMeasurements: Measurements
  baseGross: number
  baseNet: number
  baseConfidence: number
  
  // Landmark and view data
  perImageLandmarks: {
    imageIndex: number
    angleType: AngleType
    landmarks: LandmarksDetected
    landmarkConfidence: number
    referenceQuality: number
  }[]
  
  // Cross-view conflict data (from Phase 49.5)
  crossViewConflict?: {
    disagreementScore: number
    highDisagreementFamilies: MeasurementFamily[]
    reverseEngineeringRecommended: boolean
    rejectedViews: Array<{ imageIndex: number; reason: string }>
  } | null
  
  // Multi-view data (from Phase 49)
  multiViewData?: {
    viewGraphConnectivity: number
    familyAgreement: Record<MeasurementFamily, number>
    dominantViewPerFamily: Record<MeasurementFamily, number>
  } | null
  
  // Configuration
  settings?: StructuralSolvingSettings
}

export interface StructuralSolvingSettings {
  maxCandidates: number
  maxEvaluationDepth: number
  maxRuntimeMs: number
  candidatePruningThreshold: number
  requireDisagreementTrigger: boolean
  minDisagreementForStructural: number
  adminOnlyMode: boolean
}

export const DEFAULT_STRUCTURAL_SETTINGS: StructuralSolvingSettings = {
  maxCandidates: 12,
  maxEvaluationDepth: 3,
  maxRuntimeMs: 30000,
  candidatePruningThreshold: 0.3,
  requireDisagreementTrigger: true,
  minDisagreementForStructural: 0.15,
  adminOnlyMode: false,
}

export interface StructuralSolvingResult {
  structuralRunId: string
  status: StructuralRunStatus
  
  // Winning structure
  winningCandidate: StructuralHypothesisCandidateRow | null
  winningEvaluation: StructuralHypothesisEvaluationRow | null
  winningTopology: TopologyInterpretation | null
  
  // Changes from baseline
  structuralChangeReasons: StructuralChangeReason[]
  primaryReason: StructuralChangeReason | null
  confidenceShiftReason: string | null
  
  // Measurement impact
  finalMeasurements: Measurements
  finalGross: number
  finalNet: number
  grossDelta: number
  netDelta: number
  
  // All candidates (for debugging)
  allCandidates: StructuralHypothesisCandidateRow[]
  allEvaluations: StructuralHypothesisEvaluationRow[]
  
  // Processing info
  processingTimeMs: number
  candidatesGenerated: number
  candidatesEvaluated: number
}

export interface StructuralRunDetail {
  run: StructuralHypothesisRunRow
  candidates: StructuralHypothesisCandidateRow[]
  evaluations: Record<string, StructuralHypothesisEvaluationRow>
  baselineTopology: StructuralTopologySnapshotRow | null
  winningTopology: StructuralTopologySnapshotRow | null
}
