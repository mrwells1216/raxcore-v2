import 'server-only'

/**
 * Phase 52 Activation: Supervision Hooks
 * 
 * Central helper for creating supervision events from core scoring paths:
 * - Reverse precision pass
 * - Cross-view conflict engine
 * - Structural hypothesis solver
 * 
 * Hooks are called AFTER the respective operations complete,
 * only if meaningful change/signal was detected.
 */

import { createSupervisionEvent } from './service'
import type {
  SupervisionType,
  SupervisionSource,
  FailureCauseLabel,
  CreateSupervisionEventInput,
} from './types'

// ============================================================================
// THRESHOLDS FOR MEANINGFUL EVENTS
// ============================================================================

/** Minimum delta (inches) to consider reverse pass meaningful */
const REVERSE_PASS_MIN_DELTA = 0.5

/** Minimum disagreement score to create conflict event */
const CONFLICT_MIN_DISAGREEMENT = 0.15

/** Minimum delta (inches) for structural solver change */
const STRUCTURAL_MIN_DELTA = 0.5

// ============================================================================
// REVERSE PASS HOOK
// ============================================================================

export interface ReversePassHookInput {
  reverseRunId: string
  predictionId: string
  buckId: string
  /** Baseline gross score before reverse pass */
  baselineGross: number
  /** Baseline net score before reverse pass */
  baselineNet: number
  /** Refined gross after reverse pass */
  refinedGross: number
  /** Refined net after reverse pass */
  refinedNet: number
  /** Winning hypothesis type (e.g., 'scale_up', 'swap_sides') */
  winningHypothesisType: string | null
  /** Geometry improvement if available */
  geometryImprovement?: number | null
  /** Error decomposition causes from reverse engine */
  errorDecompositionCauses?: Array<{ cause: string; confidence: number }>
}

/**
 * Hook called after reverse_precision_pass completes.
 * Creates supervision event if the result changed meaningfully from baseline.
 */
export async function onReversePassComplete(
  input: ReversePassHookInput
): Promise<{ created: boolean; eventId?: string }> {
  const grossDelta = input.refinedGross - input.baselineGross
  const netDelta = input.refinedNet - input.baselineNet
  const changeMagnitude = Math.max(Math.abs(grossDelta), Math.abs(netDelta))

  // Only create event if meaningful change occurred
  if (changeMagnitude < REVERSE_PASS_MIN_DELTA) {
    return { created: false }
  }

  // Determine supervision type based on hypothesis
  let supervisionType: SupervisionType = 'reverse_pass_improved_result'
  if (input.winningHypothesisType?.includes('scale')) {
    supervisionType = 'reverse_pass_found_scale_issue'
  } else if (input.winningHypothesisType?.includes('asymmetry') || input.winningHypothesisType?.includes('swap')) {
    supervisionType = 'reverse_pass_found_asymmetry_issue'
  }

  // Map error decomposition causes to supervision labels
  const labels: CreateSupervisionEventInput['labels'] = []
  if (input.errorDecompositionCauses) {
    for (const cause of input.errorDecompositionCauses) {
      const mappedLabel = mapCauseToFailureLabel(cause.cause)
      if (mappedLabel) {
        labels.push({
          label: mappedLabel,
          confidence: cause.confidence,
          source: 'reverse-pass-derived',
        })
      }
    }
  }

  // Infer labels from hypothesis type if none from decomposition
  if (labels.length === 0 && input.winningHypothesisType) {
    const inferredLabel = inferLabelFromHypothesis(input.winningHypothesisType)
    if (inferredLabel) {
      labels.push({
        label: inferredLabel,
        confidence: 0.7,
        source: 'reverse-pass-derived',
      })
    }
  }

  const event = await createSupervisionEvent({
    supervision_type: supervisionType,
    source: 'reverse_pass',
    confidence: 0.75,
    prediction_id: input.predictionId,
    buck_id: input.buckId ?? undefined,
    reverse_run_id: input.reverseRunId,
    delta_gross: grossDelta,
    delta_net: netDelta,
    metadata_json: {
      baseline_gross: input.baselineGross,
      baseline_net: input.baselineNet,
      refined_gross: input.refinedGross,
      refined_net: input.refinedNet,
      change_magnitude: changeMagnitude,
      winning_hypothesis_type: input.winningHypothesisType,
      inferred_cause: labels[0]?.label ?? null,
      geometry_improvement: input.geometryImprovement ?? null,
      error_decomposition_causes: input.errorDecompositionCauses,
    },
    labels,
  })

  return { created: true, eventId: event.id }
}

// ============================================================================
// CONFLICT ENGINE HOOK
// ============================================================================

export interface ConflictEngineHookInput {
  predictionId: string
  buckId?: string
  /** Overall disagreement score (0-1) */
  disagreementScore: number
  /** Measurement families with high disagreement */
  highDisagreementFamilies: string[]
  /** Dominant views used for fusion */
  dominantViews?: Array<{ family: string; viewIndex: number }>
  /** Rejected/outlier views */
  rejectedViews?: Array<{ imageIndex: number; reason: string }>
  /** Disagreement classification labels */
  disagreementClassifications?: Array<{
    family: string
    primaryType: string
    explanation: string
    reverseEngineeringRecommended: boolean
  }>
}

/**
 * Hook called when multi-view conflict engine detects meaningful disagreement.
 * Only creates event above a meaningful threshold.
 */
export async function onConflictDetected(
  input: ConflictEngineHookInput
): Promise<{ created: boolean; eventId?: string }> {
  // Don't spam events for tiny disagreements
  if (input.disagreementScore < CONFLICT_MIN_DISAGREEMENT) {
    return { created: false }
  }

  // Must have at least one high-disagreement family to be meaningful
  if (input.highDisagreementFamilies.length === 0) {
    return { created: false }
  }

  // Map disagreement classifications to supervision labels
  const labels: CreateSupervisionEventInput['labels'] = []
  if (input.disagreementClassifications) {
    for (const dc of input.disagreementClassifications) {
      const mappedLabel = mapDisagreementTypeToFailureLabel(dc.primaryType)
      if (mappedLabel) {
        labels.push({
          label: mappedLabel,
          confidence: 0.7,
          source: 'auto',
          evidence_summary: dc.explanation,
        })
      }
    }
  }

  // Infer labels from high-disagreement families if none mapped
  if (labels.length === 0) {
    for (const family of input.highDisagreementFamilies.slice(0, 2)) {
      const inferredLabel = inferLabelFromFamily(family)
      if (inferredLabel) {
        labels.push({
          label: inferredLabel,
          confidence: 0.6,
          source: 'auto',
        })
      }
    }
  }

  const event = await createSupervisionEvent({
    supervision_type: 'multi_view_inconsistency',
    source: 'conflict_engine',
    confidence: Math.min(0.9, 0.5 + input.disagreementScore),
    prediction_id: input.predictionId,
    buck_id: input.buckId ?? undefined,
    metadata_json: {
      disagreement_score: input.disagreementScore,
      affected_measurement_families: input.highDisagreementFamilies,
      dominant_views: input.dominantViews ?? null,
      rejected_views: input.rejectedViews?.map(v => v.imageIndex) ?? undefined,
      rejected_view_reasons: input.rejectedViews?.map(v => v.reason) ?? undefined,
      disagreement_classifications: input.disagreementClassifications ?? null,
    },
    labels,
  })

  return { created: true, eventId: event.id }
}

// ============================================================================
// STRUCTURAL SOLVER HOOK
// ============================================================================

export interface StructuralSolverHookInput {
  structuralRunId: string
  predictionId: string
  buckId: string
  /** Baseline gross before structural solving */
  baselineGross: number
  /** Baseline net before structural solving */
  baselineNet: number
  /** Final gross after structural solving */
  finalGross: number
  /** Final net after structural solving */
  finalNet: number
  /** Winning candidate type (e.g., 'add_g4_tines', 'swap_sides') */
  winningCandidateType: string
  /** Primary reason for structural change */
  primaryReason?: string | null
  /** Structural change reasons */
  structuralChangeReasons?: string[]
  /** Confidence shift reason */
  confidenceShiftReason?: string | null
  /** Geometry improvement */
  geometryImprovement?: number | null
  /** Baseline structure summary */
  baselineStructureSummary?: Record<string, unknown>
  /** Winning structure summary */
  winningStructureSummary?: Record<string, unknown>
}

/**
 * Hook called after structural_hypothesis_solve completes.
 * Creates supervision event if structure changed meaningfully from baseline.
 */
export async function onStructuralSolverComplete(
  input: StructuralSolverHookInput
): Promise<{ created: boolean; eventId?: string }> {
  const grossDelta = input.finalGross - input.baselineGross
  const netDelta = input.finalNet - input.baselineNet
  const changeMagnitude = Math.max(Math.abs(grossDelta), Math.abs(netDelta))

  // Only create event if baseline was non-trivially changed
  if (input.winningCandidateType === 'baseline_structure') {
    return { created: false }
  }

  if (changeMagnitude < STRUCTURAL_MIN_DELTA) {
    return { created: false }
  }

  // Map candidate type to supervision labels
  const labels: CreateSupervisionEventInput['labels'] = []
  const inferredLabel = inferLabelFromStructuralCandidate(input.winningCandidateType)
  if (inferredLabel) {
    labels.push({
      label: inferredLabel,
      confidence: 0.7,
      source: 'auto',
    })
  }

  const event = await createSupervisionEvent({
    supervision_type: 'structural_solver_corrected_topology',
    source: 'structural_solver',
    confidence: 0.7,
    prediction_id: input.predictionId,
    buck_id: input.buckId,
    structural_hypothesis_run_id: input.structuralRunId,
    delta_gross: grossDelta,
    delta_net: netDelta,
    metadata_json: {
      baseline_gross: input.baselineGross,
      baseline_net: input.baselineNet,
      final_gross: input.finalGross,
      final_net: input.finalNet,
      winning_candidate_type: input.winningCandidateType,
      primary_reason: input.primaryReason,
      structural_change_reasons: input.structuralChangeReasons,
      confidence_shift_reason: input.confidenceShiftReason,
      geometry_improvement: input.geometryImprovement,
      baseline_structure_summary: input.baselineStructureSummary,
      winning_structure_summary: input.winningStructureSummary,
    },
    labels,
  })

  return { created: true, eventId: event.id }
}

// ============================================================================
// LABEL MAPPING HELPERS
// ============================================================================

function mapCauseToFailureLabel(cause: string): FailureCauseLabel | null {
  const normalized = cause.toLowerCase()
  
  if (normalized.includes('scale')) return 'scale_reference_failure'
  if (normalized.includes('front')) return 'weak_front_reference'
  if (normalized.includes('side')) return 'weak_side_reference'
  if (normalized.includes('beam')) return 'beam_tip_misread'
  if (normalized.includes('tine') && normalized.includes('occlusion')) return 'tine_occlusion'
  if (normalized.includes('tine') && normalized.includes('topology')) return 'tine_topology_confusion'
  if (normalized.includes('asymmetry') || normalized.includes('perspective')) return 'asymmetry_perspective_confound'
  if (normalized.includes('left') || normalized.includes('right') || normalized.includes('swap')) return 'left_right_association_error'
  if (normalized.includes('multi') || normalized.includes('view') || normalized.includes('agreement')) return 'weak_multi_view_agreement'
  if (normalized.includes('crop') || normalized.includes('occlusion')) return 'crop_or_occlusion_failure'
  if (normalized.includes('lighting') || normalized.includes('light')) return 'lighting_quality_failure'
  
  return null
}

function inferLabelFromHypothesis(hypothesisType: string): FailureCauseLabel | null {
  const normalized = hypothesisType.toLowerCase()
  
  if (normalized.includes('scale')) return 'scale_reference_failure'
  if (normalized.includes('swap') || normalized.includes('asymmetry')) return 'left_right_association_error'
  if (normalized.includes('spread')) return 'asymmetry_perspective_confound'
  if (normalized.includes('beam')) return 'beam_tip_misread'
  if (normalized.includes('tine') || normalized.includes('g1') || normalized.includes('g2')) return 'tine_occlusion'
  
  return null
}

// ============================================================================
// PHASE 52 PATCH 2: INTERVAL MISS HOOK
// ============================================================================

export interface IntervalMissHookInput {
  predictionId: string
  buckId?: string
  /** Predicted lower bound of interval */
  predictedIntervalLow: number
  /** Predicted upper bound of interval */
  predictedIntervalHigh: number
  /** Actual verified score */
  actualScore: number
  /** Current confidence tier from model */
  confidenceTier: string
  /** Trust tier from input quality */
  trustTier?: string
  /** Segment context if available */
  segment?: string
  /** Current confidence percent (0-100) */
  confidencePercent?: number
}

/**
 * Hook called when actual result falls outside predicted interval.
 * Creates supervision event for interval calibration learning.
 */
export async function onIntervalMiss(
  input: IntervalMissHookInput
): Promise<{ created: boolean; eventId?: string }> {
  const intervalWidth = input.predictedIntervalHigh - input.predictedIntervalLow
  const deviationBelow = Math.max(0, input.predictedIntervalLow - input.actualScore)
  const deviationAbove = Math.max(0, input.actualScore - input.predictedIntervalHigh)
  const totalDeviation = deviationBelow + deviationAbove

  // Only create event if there's a meaningful miss
  if (totalDeviation < 0.25) {
    return { created: false }
  }

  const missType = deviationBelow > 0 ? 'below_interval' : 'above_interval'

  // Map to appropriate label
  let label: FailureCauseLabel = 'confidence_overestimate'
  if (missType === 'below_interval') {
    label = 'confidence_underestimate'
  }

  const event = await createSupervisionEvent({
    supervision_type: 'interval_miss',
    source: 'auto',
    confidence: Math.min(0.9, 0.5 + (totalDeviation / intervalWidth) * 0.4),
    prediction_id: input.predictionId,
    buck_id: input.buckId,
    metadata_json: {
      predicted_interval_low: input.predictedIntervalLow,
      predicted_interval_high: input.predictedIntervalHigh,
      actual_score: input.actualScore,
      deviation_magnitude: totalDeviation,
      miss_type: missType,
      interval_width: intervalWidth,
      confidence_tier: input.confidenceTier,
      trust_tier: input.trustTier ?? 'unknown',
      segment: input.segment,
      confidence_percent: input.confidencePercent,
    },
    labels: [{
      label,
      confidence: 0.8,
      source: 'auto',
    }],
  })

  return { created: true, eventId: event.id }
}

// ============================================================================
// PHASE 52 PATCH 2: HIGH-CONFIDENCE MISS HOOK
// ============================================================================

export interface HighConfidenceMissHookInput {
  predictionId: string
  buckId?: string
  /** Confidence tier (e.g., 'high', 'very_high') */
  confidenceTier: string
  /** Trust tier from input quality */
  trustTier?: string
  /** Magnitude of miss in inches */
  missMagnitude: number
  /** Whether it was an interval miss */
  intervalMiss: boolean
  /** Predicted value */
  predicted: number
  /** Actual verified value */
  actual: number
  /** Segment context */
  segment?: string
}

/**
 * Hook called when high-confidence predictions miss meaningfully.
 * High-confidence misses are high-value learning signals.
 */
export async function onHighConfidenceMiss(
  input: HighConfidenceMissHookInput
): Promise<{ created: boolean; eventId?: string }> {
  // Only for genuinely high confidence
  if (!['high', 'very_high', 'extreme'].includes(input.confidenceTier)) {
    return { created: false }
  }

  // Only for meaningful misses
  if (input.missMagnitude < 1.0) {
    return { created: false }
  }

  const event = await createSupervisionEvent({
    supervision_type: 'confidence_overclaim',
    source: 'auto',
    confidence: Math.min(1.0, 0.7 + (input.missMagnitude / 10) * 0.3),
    prediction_id: input.predictionId,
    buck_id: input.buckId,
    metadata_json: {
      confidence_tier: input.confidenceTier,
      trust_tier: input.trustTier ?? 'unknown',
      miss_magnitude: input.missMagnitude,
      interval_miss: input.intervalMiss,
      predicted: input.predicted,
      actual: input.actual,
      segment: input.segment,
      high_confidence_miss_severity: input.missMagnitude > 5 ? 'severe' : 'moderate',
    },
    labels: [{
      label: 'confidence_overestimate',
      confidence: 0.85,
      source: 'auto',
    }],
  })

  return { created: true, eventId: event.id }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mapDisagreementTypeToFailureLabel(cause: string): FailureCauseLabel | null {
  const mapping: Record<string, FailureCauseLabel> = {
    'scale_reference_conflict': 'scale_reference_failure',
    'perspective_distortion': 'asymmetry_perspective_confound',
    'occlusion_missing_structure': 'crop_or_occlusion_failure',
    'asymmetry_vs_perspective': 'asymmetry_perspective_confound',
    'landmark_instability': 'weak_multi_view_agreement',
    'multi_view_inconsistency': 'weak_multi_view_agreement',
    'low_quality_input': 'lighting_quality_failure',
  }
  
  return mapping[cause] ?? null
}

function inferLabelFromFamily(family: string): FailureCauseLabel | null {
  const mapping: Record<string, FailureCauseLabel> = {
    'spread': 'weak_front_reference',
    'beam': 'beam_tip_misread',
    'tine': 'tine_occlusion',
    'mass': 'weak_side_reference',
  }
  
  return mapping[family] ?? null
}

function inferLabelFromStructuralCandidate(candidateType: string): FailureCauseLabel | null {
  const normalized = candidateType.toLowerCase()
  
  if (normalized.includes('swap')) return 'left_right_association_error'
  if (normalized.includes('beam') || normalized.includes('alternative_beam')) return 'beam_tip_misread'
  if (normalized.includes('add_g') || normalized.includes('remove_g') || normalized.includes('tine')) return 'tine_topology_confusion'
  if (normalized.includes('symmetr')) return 'asymmetry_perspective_confound'
  
  return null
}
