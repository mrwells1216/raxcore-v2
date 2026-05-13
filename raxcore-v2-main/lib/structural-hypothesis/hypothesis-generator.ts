/**
 * Phase 51: Structural Hypothesis Generator
 * Generates bounded, plausible structural hypotheses based on conflict signals
 */

import type { Measurements, MeasurementFamily, AngleType, LandmarksDetected } from '@/lib/types'
import type { AllLandmarkId } from '@/lib/vision/landmarks/types'
import type {
  StructuralParams,
  StructuralCandidateType,
  TopologyInterpretation,
  LandmarkOverride,
  StructuralSolvingInput,
  StructuralSolvingSettings,
} from './types'
import { CANDIDATE_GENERATION_LIMITS, ANATOMICAL_BOUNDS } from './config'

// ============================================================================
// TYPES
// ============================================================================

export interface GeneratedCandidate {
  type: StructuralCandidateType
  params: StructuralParams
  affectedFamilies: MeasurementFamily[]
  generationReason: string
  triggeringSignals: string[]
}

export interface CandidateGenerationInput {
  baseMeasurements: Measurements
  baseTopology: TopologyInterpretation
  perImageLandmarks: StructuralSolvingInput['perImageLandmarks']
  crossViewConflict?: StructuralSolvingInput['crossViewConflict']
  multiViewData?: StructuralSolvingInput['multiViewData']
  settings: StructuralSolvingSettings
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

export function generateStructuralHypotheses(
  input: CandidateGenerationInput
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []

  // Always include baseline
  candidates.push({
    type: 'baseline_structure',
    params: { notes: ['Baseline structure (no changes)'] },
    affectedFamilies: [],
    generationReason: 'Baseline for comparison',
    triggeringSignals: [],
  })

  // Analyze signals to determine which hypotheses to generate
  const signals = analyzeConflictSignals(input)

  // Generate candidates based on detected signals
  if (signals.spreadAnchorUncertain) {
    candidates.push(...generateSpreadAnchorShiftCandidates(input, signals))
  }

  if (signals.beamTipConflict) {
    candidates.push(...generateBeamTipReassignmentCandidates(input, signals))
  }

  if (signals.tineTopologyUncertain) {
    candidates.push(...generateTineTopologyVariants(input, signals))
  }

  if (signals.asymmetryAmbiguous) {
    candidates.push(...generateAsymmetryRebalanceCandidates(input, signals))
  }

  if (signals.occlusionSuspected) {
    candidates.push(...generateOcclusionRecoveryCandidates(input, signals))
  }

  if (signals.leftRightConfusion) {
    candidates.push(...generateLeftRightAssociationCandidates(input, signals))
  }

  // Generate combo candidates if multiple signals are present
  if (countActiveSignals(signals) >= 2) {
    candidates.push(...generateComboCandidates(input, signals))
  }

  // Limit total candidates
  return candidates.slice(0, input.settings.maxCandidates)
}

// ============================================================================
// SIGNAL ANALYSIS
// ============================================================================

interface ConflictSignals {
  spreadAnchorUncertain: boolean
  spreadAnchorSignals: string[]
  
  beamTipConflict: boolean
  beamTipSignals: string[]
  
  tineTopologyUncertain: boolean
  tineTopologySignals: string[]
  
  asymmetryAmbiguous: boolean
  asymmetrySignals: string[]
  
  occlusionSuspected: boolean
  occlusionSignals: string[]
  
  leftRightConfusion: boolean
  leftRightSignals: string[]
}

function analyzeConflictSignals(input: CandidateGenerationInput): ConflictSignals {
  const signals: ConflictSignals = {
    spreadAnchorUncertain: false,
    spreadAnchorSignals: [],
    beamTipConflict: false,
    beamTipSignals: [],
    tineTopologyUncertain: false,
    tineTopologySignals: [],
    asymmetryAmbiguous: false,
    asymmetrySignals: [],
    occlusionSuspected: false,
    occlusionSignals: [],
    leftRightConfusion: false,
    leftRightSignals: [],
  }

  const { baseTopology, crossViewConflict, multiViewData } = input

  // Check spread anchor uncertainty
  if (baseTopology.spreadAnchor.confidence < 0.6) {
    signals.spreadAnchorUncertain = true
    signals.spreadAnchorSignals.push(`Low spread anchor confidence (${(baseTopology.spreadAnchor.confidence * 100).toFixed(0)}%)`)
  }
  if (baseTopology.spreadAnchor.anchorType === 'uncertain' || baseTopology.spreadAnchor.anchorType === 'inferred') {
    signals.spreadAnchorUncertain = true
    signals.spreadAnchorSignals.push(`Anchor type is ${baseTopology.spreadAnchor.anchorType}`)
  }
  if (crossViewConflict?.highDisagreementFamilies?.includes('spread')) {
    signals.spreadAnchorUncertain = true
    signals.spreadAnchorSignals.push('Cross-view disagreement on spread')
  }

  // Check beam tip conflict
  if (baseTopology.beamContinuityScore < 0.5) {
    signals.beamTipConflict = true
    signals.beamTipSignals.push(`Low beam continuity score (${(baseTopology.beamContinuityScore * 100).toFixed(0)}%)`)
  }
  if (crossViewConflict?.highDisagreementFamilies?.includes('beam')) {
    signals.beamTipConflict = true
    signals.beamTipSignals.push('Cross-view disagreement on beam')
  }

  // Check tine topology uncertainty
  if (baseTopology.tineOrderingConfidence < 0.6) {
    signals.tineTopologyUncertain = true
    signals.tineTopologySignals.push(`Low tine ordering confidence (${(baseTopology.tineOrderingConfidence * 100).toFixed(0)}%)`)
  }
  if (baseTopology.missingTinesLeft.length > 0 || baseTopology.missingTinesRight.length > 0) {
    signals.tineTopologyUncertain = true
    signals.tineTopologySignals.push(`Missing tines: L[${baseTopology.missingTinesLeft.join(',')}] R[${baseTopology.missingTinesRight.join(',')}]`)
  }
  if (crossViewConflict?.highDisagreementFamilies?.includes('tine')) {
    signals.tineTopologyUncertain = true
    signals.tineTopologySignals.push('Cross-view disagreement on tine')
  }

  // Check asymmetry ambiguity
  const asym = baseTopology.asymmetry
  if (asym.cause === 'mixed' || asym.cause === 'unknown') {
    signals.asymmetryAmbiguous = true
    signals.asymmetrySignals.push(`Ambiguous asymmetry cause: ${asym.cause}`)
  }
  if (asym.causeConfidence < 0.6) {
    signals.asymmetryAmbiguous = true
    signals.asymmetrySignals.push(`Low asymmetry cause confidence (${(asym.causeConfidence * 100).toFixed(0)}%)`)
  }
  if (asym.overallAsymmetryPercent > 0.15 && asym.viewsContradicting > 0) {
    signals.asymmetryAmbiguous = true
    signals.asymmetrySignals.push(`High asymmetry (${(asym.overallAsymmetryPercent * 100).toFixed(0)}%) with contradicting views`)
  }

  // Check occlusion suspicion
  if (crossViewConflict?.rejectedViews && crossViewConflict.rejectedViews.length > 0) {
    const occlusionRejects = crossViewConflict.rejectedViews.filter(
      v => v.reason.toLowerCase().includes('occlusion') || v.reason.toLowerCase().includes('crop')
    )
    if (occlusionRejects.length > 0) {
      signals.occlusionSuspected = true
      signals.occlusionSignals.push(`${occlusionRejects.length} view(s) rejected for occlusion/crop`)
    }
  }
  const totalMissingTines = baseTopology.missingTinesLeft.length + baseTopology.missingTinesRight.length
  if (totalMissingTines >= 2) {
    signals.occlusionSuspected = true
    signals.occlusionSignals.push(`${totalMissingTines} missing tines may indicate occlusion`)
  }

  // Check left/right confusion
  const beamAsym = baseTopology.asymmetry.beamAsymmetryPercent
  if (beamAsym > 0.25) {
    signals.leftRightConfusion = true
    signals.leftRightSignals.push(`High beam asymmetry (${(beamAsym * 100).toFixed(0)}%) may indicate L/R confusion`)
  }

  return signals
}

function countActiveSignals(signals: ConflictSignals): number {
  let count = 0
  if (signals.spreadAnchorUncertain) count++
  if (signals.beamTipConflict) count++
  if (signals.tineTopologyUncertain) count++
  if (signals.asymmetryAmbiguous) count++
  if (signals.occlusionSuspected) count++
  if (signals.leftRightConfusion) count++
  return count
}

// ============================================================================
// SPREAD ANCHOR SHIFT CANDIDATES
// ============================================================================

function generateSpreadAnchorShiftCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []
  const { baseMeasurements, baseTopology } = input

  const baseSpread = baseMeasurements.inside_spread
  if (baseSpread === null) return candidates

  // Generate shift candidates based on reference uncertainty
  const shifts = [
    { left: { x: 0.02, y: 0 }, right: { x: -0.02, y: 0 }, note: 'Widen anchor' },
    { left: { x: -0.02, y: 0 }, right: { x: 0.02, y: 0 }, note: 'Narrow anchor' },
  ]

  for (const shift of shifts.slice(0, CANDIDATE_GENERATION_LIMITS.maxSpreadAnchorShiftCandidates)) {
    candidates.push({
      type: 'spread_anchor_shift',
      params: {
        spreadAnchorShift: {
          leftDelta: shift.left,
          rightDelta: shift.right,
          reason: shift.note,
        },
        notes: [`Spread anchor shift: ${shift.note}`],
      },
      affectedFamilies: ['spread'],
      generationReason: shift.note,
      triggeringSignals: signals.spreadAnchorSignals,
    })
  }

  return candidates
}

// ============================================================================
// BEAM TIP REASSIGNMENT CANDIDATES
// ============================================================================

function generateBeamTipReassignmentCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []
  const { baseTopology, perImageLandmarks } = input

  // Find views with highest beam visibility
  const sideViews = perImageLandmarks.filter(
    img => img.angleType === 'left' || img.angleType === 'right'
  )

  if (sideViews.length === 0) return candidates

  // Generate candidates that reassign beam tip based on alternate views
  for (const side of ['left', 'right'] as const) {
    if (candidates.length >= CANDIDATE_GENERATION_LIMITS.maxBeamTipReassignmentCandidates) break

    const relevantViews = sideViews.filter(v => v.angleType === side)
    if (relevantViews.length === 0) continue

    const bestView = relevantViews.sort((a, b) => b.referenceQuality - a.referenceQuality)[0]
    if (!bestView) continue

    candidates.push({
      type: 'beam_tip_reassignment',
      params: {
        beamTipReassignment: {
          side,
          newTipLandmarks: {}, // Would be populated with actual landmark positions
          reason: `Reassign ${side} beam tip from view ${bestView.imageIndex}`,
        },
        notes: [`Use ${side} view ${bestView.imageIndex} for beam tip`],
      },
      affectedFamilies: ['beam'],
      generationReason: `Alternative beam tip from ${side} view`,
      triggeringSignals: signals.beamTipSignals,
    })
  }

  return candidates
}

// ============================================================================
// TINE TOPOLOGY VARIANT CANDIDATES
// ============================================================================

function generateTineTopologyVariants(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []
  const { baseTopology, baseMeasurements } = input

  // Variant 1: Treat missing tines as occluded (not zero)
  if (baseTopology.missingTinesLeft.length > 0 || baseTopology.missingTinesRight.length > 0) {
    candidates.push({
      type: 'tine_topology_variant',
      params: {
        tineTopologyVariant: {
          occludedTines: [...baseTopology.missingTinesLeft.map(t => `${t}_left`), ...baseTopology.missingTinesRight.map(t => `${t}_right`)],
          reason: 'Treat missing tines as occluded, not absent',
        },
        notes: ['Missing tines reinterpreted as occluded'],
      },
      affectedFamilies: ['tine'],
      generationReason: 'Occlusion interpretation for missing tines',
      triggeringSignals: signals.tineTopologySignals,
    })
  }

  // Variant 2: Check for tine ordering issues (G1/G2 swap)
  const g1Left = baseMeasurements.g1_left
  const g2Left = baseMeasurements.g2_left
  const g1Right = baseMeasurements.g1_right
  const g2Right = baseMeasurements.g2_right

  // If G2 > G1, consider reordering
  if ((g1Left !== null && g2Left !== null && g2Left > g1Left * 1.1) ||
      (g1Right !== null && g2Right !== null && g2Right > g1Right * 1.1)) {
    candidates.push({
      type: 'tine_topology_variant',
      params: {
        tineTopologyVariant: {
          reorderedTinesLeft: g2Left !== null && g1Left !== null && g2Left > g1Left ? ['g2', 'g1', 'g3', 'g4', 'g5'] : undefined,
          reorderedTinesRight: g2Right !== null && g1Right !== null && g2Right > g1Right ? ['g2', 'g1', 'g3', 'g4', 'g5'] : undefined,
          reason: 'G1/G2 ordering may be swapped',
        },
        notes: ['Reorder G1/G2 based on length'],
      },
      affectedFamilies: ['tine'],
      generationReason: 'G1/G2 reordering hypothesis',
      triggeringSignals: signals.tineTopologySignals,
    })
  }

  return candidates.slice(0, CANDIDATE_GENERATION_LIMITS.maxTineTopologyVariants)
}

// ============================================================================
// ASYMMETRY REBALANCE CANDIDATES
// ============================================================================

function generateAsymmetryRebalanceCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []
  const { baseTopology } = input
  const asym = baseTopology.asymmetry

  // If asymmetry might be perspective-induced, try rebalancing
  if (asym.cause === 'perspective_induced' || asym.cause === 'mixed' || asym.cause === 'unknown') {
    // Partial rebalancing (40% toward symmetric)
    candidates.push({
      type: 'asymmetry_rebalanced',
      params: {
        asymmetryRebalance: {
          targetSymmetry: 0.4,
          family: 'all',
          reason: 'Partial symmetry correction for possible perspective effect',
        },
        notes: ['40% symmetry correction across all families'],
      },
      affectedFamilies: ['beam', 'tine', 'mass'],
      generationReason: 'Perspective-induced asymmetry correction',
      triggeringSignals: signals.asymmetrySignals,
    })

    // Higher rebalancing if strong perspective suspicion
    if (asym.viewsContradicting > asym.viewsSupporting) {
      candidates.push({
        type: 'asymmetry_rebalanced',
        params: {
          asymmetryRebalance: {
            targetSymmetry: 0.7,
            family: 'all',
            reason: 'Strong symmetry correction (views contradict asymmetry)',
          },
          notes: ['70% symmetry correction due to view contradictions'],
        },
        affectedFamilies: ['beam', 'tine', 'mass'],
        generationReason: 'Strong perspective asymmetry correction',
        triggeringSignals: signals.asymmetrySignals,
      })
    }
  }

  return candidates.slice(0, CANDIDATE_GENERATION_LIMITS.maxAsymmetryRebalanceCandidates)
}

// ============================================================================
// OCCLUSION RECOVERY CANDIDATES
// ============================================================================

function generateOcclusionRecoveryCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []
  const { perImageLandmarks, baseTopology } = input

  // Find views that might have better visibility of occluded structures
  const rejectedViews = input.crossViewConflict?.rejectedViews ?? []
  const nonRejectedViews = perImageLandmarks.filter(
    img => !rejectedViews.some(r => r.imageIndex === img.imageIndex)
  )

  // Try to recover from best alternate view
  const sortedViews = nonRejectedViews.sort((a, b) => b.landmarkConfidence - a.landmarkConfidence)
  
  for (const view of sortedViews.slice(0, CANDIDATE_GENERATION_LIMITS.maxOcclusionRecoveryCandidates)) {
    // Identify which landmarks could be recovered from this view
    const recoverable: AllLandmarkId[] = []
    
    // Check for missing tines that might be visible in this view
    for (const tine of baseTopology.missingTinesLeft) {
      recoverable.push(`left_${tine}_tip` as AllLandmarkId)
    }
    for (const tine of baseTopology.missingTinesRight) {
      recoverable.push(`right_${tine}_tip` as AllLandmarkId)
    }

    if (recoverable.length > 0) {
      candidates.push({
        type: 'occlusion_recovery_variant',
        params: {
          occlusionRecovery: {
            recoveredLandmarks: recoverable,
            sourceViewIndex: view.imageIndex,
            reason: `Recover occluded landmarks from view ${view.imageIndex}`,
          },
          notes: [`Occlusion recovery from view ${view.imageIndex}`],
        },
        affectedFamilies: ['tine'],
        generationReason: `Landmark recovery from alternate view`,
        triggeringSignals: signals.occlusionSignals,
      })
    }
  }

  return candidates
}

// ============================================================================
// LEFT/RIGHT ASSOCIATION CANDIDATES
// ============================================================================

function generateLeftRightAssociationCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []

  // Generate a full left/right swap candidate
  candidates.push({
    type: 'left_right_association_variant',
    params: {
      leftRightAssociationFix: {
        swappedLandmarks: [
          { left: 'left_main_beam_tip', right: 'right_main_beam_tip' },
          { left: 'left_burr_or_antler_base', right: 'right_burr_or_antler_base' },
        ],
        reason: 'Full left/right landmark swap',
      },
      notes: ['Swap all left/right associations'],
    },
    affectedFamilies: ['beam', 'tine', 'mass', 'spread'],
    generationReason: 'Left/right confusion correction',
    triggeringSignals: signals.leftRightSignals,
  })

  return candidates.slice(0, CANDIDATE_GENERATION_LIMITS.maxLeftRightAssociationCandidates)
}

// ============================================================================
// COMBO CANDIDATES
// ============================================================================

function generateComboCandidates(
  input: CandidateGenerationInput,
  signals: ConflictSignals
): GeneratedCandidate[] {
  const candidates: GeneratedCandidate[] = []

  // Combo 1: Spread anchor shift + asymmetry rebalance
  if (signals.spreadAnchorUncertain && signals.asymmetryAmbiguous) {
    candidates.push({
      type: 'combo_structure_variant',
      params: {
        spreadAnchorShift: {
          leftDelta: { x: 0.01, y: 0 },
          rightDelta: { x: -0.01, y: 0 },
          reason: 'Minor spread adjustment',
        },
        asymmetryRebalance: {
          targetSymmetry: 0.3,
          family: 'all',
          reason: 'Light symmetry correction',
        },
        notes: ['Combo: spread + asymmetry correction'],
      },
      affectedFamilies: ['spread', 'beam', 'tine', 'mass'],
      generationReason: 'Combined spread anchor and asymmetry correction',
      triggeringSignals: [...signals.spreadAnchorSignals, ...signals.asymmetrySignals],
    })
  }

  // Combo 2: Beam tip reassignment + tine topology
  if (signals.beamTipConflict && signals.tineTopologyUncertain) {
    candidates.push({
      type: 'combo_structure_variant',
      params: {
        beamTipReassignment: {
          side: 'both',
          newTipLandmarks: {},
          reason: 'Alternative beam tips',
        },
        tineTopologyVariant: {
          occludedTines: input.baseTopology.missingTinesLeft.concat(input.baseTopology.missingTinesRight),
          reason: 'Tine occlusion recovery',
        },
        notes: ['Combo: beam tip + tine topology correction'],
      },
      affectedFamilies: ['beam', 'tine'],
      generationReason: 'Combined beam and tine structure correction',
      triggeringSignals: [...signals.beamTipSignals, ...signals.tineTopologySignals],
    })
  }

  return candidates.slice(0, CANDIDATE_GENERATION_LIMITS.maxComboCandidates)
}
