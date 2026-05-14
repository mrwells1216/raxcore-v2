/**
 * Phase 51: Structural Hypothesis Scorer
 * Evaluates and ranks structural hypotheses based on multi-view consistency,
 * geometry, and plausibility
 */

import type { Measurements, MeasurementFamily, AngleType } from '@/lib/types'
import type {
  StructuralParams,
  StructuralCandidateType,
  TopologyInterpretation,
  ViewSupportScore,
  StructuralSolvingInput,
} from './types'
import type { GeneratedCandidate } from './hypothesis-generator'
import { 
  STRUCTURAL_SCORING_WEIGHTS, 
  SIMPLICITY_PENALTIES, 
  ANATOMICAL_BOUNDS,
  clamp,
  normalizeScore,
} from './config'

// ============================================================================
// TYPES
// ============================================================================

export interface CandidateEvaluation {
  candidateId: string
  candidateType: StructuralCandidateType
  
  // Component scores (all 0-1)
  geometryConsistencyScore: number
  crossViewConsistencyScore: number
  landmarkAgreementScore: number
  familyPlausibilityScore: number
  asymmetryPlausibilityScore: number
  structuralSimplicityScore: number
  baselineDeviationPenalty: number
  uncertaintyReductionBenefit: number
  
  // Per-view support
  perViewSupport: Record<number, ViewSupportScore>
  viewsSupporting: number
  viewsContradicting: number
  
  // Final scores
  totalScore: number
  rankFinal: number
  
  // Predicted measurements
  predictedMeasurements: Measurements
  predictedGross: number
  predictedNet: number
  
  // Explanation
  reasonSummary: string
  evaluationFlags: string[]
}

export interface ScoringInput {
  candidate: GeneratedCandidate
  candidateId: string
  baseMeasurements: Measurements
  baseGross: number
  baseNet: number
  baseTopology: TopologyInterpretation
  perImageLandmarks: StructuralSolvingInput['perImageLandmarks']
  crossViewConflict: StructuralSolvingInput['crossViewConflict']
  multiViewData: StructuralSolvingInput['multiViewData']
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

export function evaluateStructuralCandidate(input: ScoringInput): CandidateEvaluation {
  const {
    candidate,
    candidateId,
    baseMeasurements,
    baseGross,
    baseNet,
    baseTopology,
    perImageLandmarks,
    crossViewConflict,
    multiViewData,
  } = input

  const flags: string[] = []

  // Apply structural params to get predicted measurements
  const { predictedMeasurements, measurementChanges } = applyStructuralParams(
    baseMeasurements,
    candidate.params,
    baseTopology
  )

  // Calculate gross/net
  const { gross: predictedGross, net: predictedNet } = calculateGrossNet(predictedMeasurements)

  // Score geometry consistency
  const geometryConsistencyScore = scoreGeometryConsistency(
    predictedMeasurements,
    baseTopology,
    candidate.params,
    flags
  )

  // Score cross-view consistency
  const { crossViewConsistencyScore, perViewSupport, viewsSupporting, viewsContradicting } = 
    scoreCrossViewConsistency(
      predictedMeasurements,
      perImageLandmarks,
      multiViewData,
      flags
    )

  // Score landmark agreement
  const landmarkAgreementScore = scoreLandmarkAgreement(
    candidate.params,
    perImageLandmarks,
    flags
  )

  // Score family plausibility
  const familyPlausibilityScore = scoreFamilyPlausibility(
    predictedMeasurements,
    flags
  )

  // Score asymmetry plausibility
  const asymmetryPlausibilityScore = scoreAsymmetryPlausibility(
    predictedMeasurements,
    candidate.params,
    baseTopology.asymmetry,
    flags
  )

  // Score structural simplicity (penalize complex changes)
  const structuralSimplicityScore = scoreStructuralSimplicity(
    candidate.type,
    candidate.params,
    flags
  )

  // Calculate baseline deviation penalty
  const baselineDeviationPenalty = calculateBaselineDeviationPenalty(
    baseGross,
    predictedGross,
    measurementChanges,
    flags
  )

  // Calculate uncertainty reduction benefit
  const uncertaintyReductionBenefit = calculateUncertaintyReductionBenefit(
    crossViewConflict,
    crossViewConsistencyScore,
    flags
  )

  // Calculate weighted total score
  const weights = STRUCTURAL_SCORING_WEIGHTS
  const totalScore = normalizeScore(
    geometryConsistencyScore * weights.geometryConsistency +
    crossViewConsistencyScore * weights.crossViewConsistency +
    landmarkAgreementScore * weights.landmarkAgreement +
    familyPlausibilityScore * weights.familyPlausibility +
    asymmetryPlausibilityScore * weights.asymmetryPlausibility +
    structuralSimplicityScore * weights.structuralSimplicity -
    baselineDeviationPenalty * weights.baselineDeviationPenalty +
    uncertaintyReductionBenefit * weights.uncertaintyReductionBenefit
  )

  // Build reason summary
  const reasonSummary = buildReasonSummary(
    candidate,
    totalScore,
    geometryConsistencyScore,
    crossViewConsistencyScore,
    viewsSupporting,
    viewsContradicting,
    predictedGross - baseGross
  )

  return {
    candidateId,
    candidateType: candidate.type,
    geometryConsistencyScore,
    crossViewConsistencyScore,
    landmarkAgreementScore,
    familyPlausibilityScore,
    asymmetryPlausibilityScore,
    structuralSimplicityScore,
    baselineDeviationPenalty,
    uncertaintyReductionBenefit,
    perViewSupport,
    viewsSupporting,
    viewsContradicting,
    totalScore,
    rankFinal: 0, // Will be set after ranking all candidates
    predictedMeasurements,
    predictedGross,
    predictedNet,
    reasonSummary,
    evaluationFlags: flags,
  }
}

// ============================================================================
// APPLY STRUCTURAL PARAMS
// ============================================================================

interface MeasurementChange {
  field: keyof Measurements
  oldValue: number | null
  newValue: number | null
  changePercent: number
}

function applyStructuralParams(
  base: Measurements,
  params: StructuralParams,
  topology: TopologyInterpretation
): { predictedMeasurements: Measurements; measurementChanges: MeasurementChange[] } {
  const changes: MeasurementChange[] = []
  let m: Measurements = { ...base }

  // Apply spread anchor shift
  if (params.spreadAnchorShift) {
    const baseSpread = m.inside_spread
    if (baseSpread !== null) {
      // Calculate spread change based on anchor position shift
      const spreadDelta = (Math.abs(params.spreadAnchorShift.leftDelta.x) + Math.abs(params.spreadAnchorShift.rightDelta.x)) * baseSpread * 2
      const newSpread = clamp(baseSpread + spreadDelta, ANATOMICAL_BOUNDS.spreadRange.min, ANATOMICAL_BOUNDS.spreadRange.max)
      changes.push({
        field: 'inside_spread',
        oldValue: baseSpread,
        newValue: newSpread,
        changePercent: ((newSpread - baseSpread) / baseSpread) * 100,
      })
      m.inside_spread = Number(newSpread.toFixed(1))
    }
  }

  // Apply asymmetry rebalancing
  if (params.asymmetryRebalance) {
    const { targetSymmetry, family } = params.asymmetryRebalance
    m = applySymmetryCorrection(m, targetSymmetry, family, changes)
  }

  // Apply left/right association fix (swap sides)
  if (params.leftRightAssociationFix) {
    m = swapLeftRightMeasurements(m, changes)
  }

  return { predictedMeasurements: m, measurementChanges: changes }
}

function applySymmetryCorrection(
  m: Measurements,
  targetSymmetry: number,
  family: 'beam' | 'tine' | 'mass' | 'all',
  changes: MeasurementChange[]
): Measurements {
  const result = { ...m }
  const k = clamp(targetSymmetry, 0, 1)

  const pairs: Array<{ left: keyof Measurements; right: keyof Measurements; applyTo: string }> = []

  if (family === 'beam' || family === 'all') {
    pairs.push({ left: 'main_beam_left', right: 'main_beam_right', applyTo: 'beam' })
  }
  if (family === 'tine' || family === 'all') {
    pairs.push(
      { left: 'g1_left', right: 'g1_right', applyTo: 'tine' },
      { left: 'g2_left', right: 'g2_right', applyTo: 'tine' },
      { left: 'g3_left', right: 'g3_right', applyTo: 'tine' },
      { left: 'g4_left', right: 'g4_right', applyTo: 'tine' },
      { left: 'g5_left', right: 'g5_right', applyTo: 'tine' }
    )
  }
  if (family === 'mass' || family === 'all') {
    pairs.push(
      { left: 'h1_left', right: 'h1_right', applyTo: 'mass' },
      { left: 'h2_left', right: 'h2_right', applyTo: 'mass' },
      { left: 'h3_left', right: 'h3_right', applyTo: 'mass' },
      { left: 'h4_left', right: 'h4_right', applyTo: 'mass' }
    )
  }

  for (const { left, right } of pairs) {
    const lv = result[left] as number | null
    const rv = result[right] as number | null
    if (lv !== null && rv !== null && lv > 0 && rv > 0) {
      const avg = (lv + rv) / 2
      const newLeft = lv + (avg - lv) * k
      const newRight = rv + (avg - rv) * k

      if (Math.abs(newLeft - lv) > 0.1) {
        changes.push({
          field: left,
          oldValue: lv,
          newValue: newLeft,
          changePercent: ((newLeft - lv) / lv) * 100,
        })
      }
      if (Math.abs(newRight - rv) > 0.1) {
        changes.push({
          field: right,
          oldValue: rv,
          newValue: newRight,
          changePercent: ((newRight - rv) / rv) * 100,
        })
      }

      result[left] = Number(newLeft.toFixed(1)) as never
      result[right] = Number(newRight.toFixed(1)) as never
    }
  }

  return result
}

function swapLeftRightMeasurements(
  m: Measurements,
  changes: MeasurementChange[]
): Measurements {
  const result = { ...m }
  const pairs: Array<[keyof Measurements, keyof Measurements]> = [
    ['main_beam_left', 'main_beam_right'],
    ['g1_left', 'g1_right'],
    ['g2_left', 'g2_right'],
    ['g3_left', 'g3_right'],
    ['g4_left', 'g4_right'],
    ['g5_left', 'g5_right'],
    ['h1_left', 'h1_right'],
    ['h2_left', 'h2_right'],
    ['h3_left', 'h3_right'],
    ['h4_left', 'h4_right'],
  ]

  for (const [left, right] of pairs) {
    const lv = result[left]
    const rv = result[right]
    if (lv !== rv) {
      changes.push({
        field: left,
        oldValue: lv as number | null,
        newValue: rv as number | null,
        changePercent: 100, // Full swap
      })
      ;(result as unknown as Record<string, number | null>)[left as string] = rv ?? null
      ;(result as unknown as Record<string, number | null>)[right as string] = lv ?? null
    }
  }

  return result
}

// ============================================================================
// COMPONENT SCORING FUNCTIONS
// ============================================================================

function scoreGeometryConsistency(
  measurements: Measurements,
  topology: TopologyInterpretation,
  params: StructuralParams,
  flags: string[]
): number {
  let score = 0.7 // Base score

  // Check beam length ratio (typically 0.8-1.2)
  const beamLeft = measurements.main_beam_left
  const beamRight = measurements.main_beam_right
  if (beamLeft !== null && beamRight !== null && beamLeft > 0 && beamRight > 0) {
    const ratio = beamLeft / beamRight
    if (ratio >= 0.85 && ratio <= 1.15) {
      score += 0.1
    } else if (ratio < 0.7 || ratio > 1.3) {
      score -= 0.15
      flags.push('beam_ratio_extreme')
    }
  }

  // Check spread vs beam length (spread typically < beam length)
  const spread = measurements.inside_spread
  if (spread !== null && beamLeft !== null && beamRight !== null) {
    const avgBeam = (beamLeft + beamRight) / 2
    if (spread <= avgBeam * 1.1) {
      score += 0.1
    } else {
      score -= 0.1
      flags.push('spread_exceeds_beam')
    }
  }

  // Check tine progression
  const g1 = (measurements.g1_left ?? 0) + (measurements.g1_right ?? 0)
  const g2 = (measurements.g2_left ?? 0) + (measurements.g2_right ?? 0)
  if (g1 > 0 && g2 > 0 && g1 >= g2 * 0.9) {
    score += 0.05
  }

  // Check mass progression
  const h1 = (measurements.h1_left ?? 0) + (measurements.h1_right ?? 0)
  const h4 = (measurements.h4_left ?? 0) + (measurements.h4_right ?? 0)
  if (h1 > 0 && h4 > 0 && h1 >= h4) {
    score += 0.05
  }

  return normalizeScore(score)
}

function scoreCrossViewConsistency(
  measurements: Measurements,
  perImageLandmarks: StructuralSolvingInput['perImageLandmarks'],
  multiViewData: StructuralSolvingInput['multiViewData'],
  flags: string[]
): {
  crossViewConsistencyScore: number
  perViewSupport: Record<number, ViewSupportScore>
  viewsSupporting: number
  viewsContradicting: number
} {
  const perViewSupport: Record<number, ViewSupportScore> = {}
  let viewsSupporting = 0
  let viewsContradicting = 0

  // Use multi-view family agreement if available
  if (multiViewData?.familyAgreement) {
    const agreements = Object.values(multiViewData.familyAgreement)
    const avgAgreement = agreements.reduce((s, v) => s + v, 0) / Math.max(1, agreements.length)
    
    // Build per-view support based on dominant view assignment
    for (const img of perImageLandmarks) {
      const support: ViewSupportScore = {
        imageIndex: img.imageIndex,
        angleType: img.angleType,
        supportScore: avgAgreement,
        landmarkAgreement: img.landmarkConfidence,
        structureAgreement: avgAgreement,
        contradictionReasons: [],
      }

      if (avgAgreement >= 0.6) {
        viewsSupporting++
      } else if (avgAgreement < 0.4) {
        viewsContradicting++
        support.contradictionReasons.push('Low family agreement')
      }

      perViewSupport[img.imageIndex] = support
    }

    return {
      crossViewConsistencyScore: normalizeScore(avgAgreement),
      perViewSupport,
      viewsSupporting,
      viewsContradicting,
    }
  }

  // Fallback: estimate from landmark confidence
  for (const img of perImageLandmarks) {
    const conf = img.landmarkConfidence
    const support: ViewSupportScore = {
      imageIndex: img.imageIndex,
      angleType: img.angleType,
      supportScore: conf,
      landmarkAgreement: conf,
      structureAgreement: conf,
      contradictionReasons: [],
    }

    if (conf >= 0.6) {
      viewsSupporting++
    } else if (conf < 0.4) {
      viewsContradicting++
    }

    perViewSupport[img.imageIndex] = support
  }

  const avgSupport = Object.values(perViewSupport)
    .map(v => v.supportScore)
    .reduce((s, v) => s + v, 0) / Math.max(1, Object.keys(perViewSupport).length)

  return {
    crossViewConsistencyScore: normalizeScore(avgSupport),
    perViewSupport,
    viewsSupporting,
    viewsContradicting,
  }
}

function scoreLandmarkAgreement(
  params: StructuralParams,
  perImageLandmarks: StructuralSolvingInput['perImageLandmarks'],
  flags: string[]
): number {
  // If no landmark overrides, full agreement
  if (!params.landmarkOverrides || params.landmarkOverrides.length === 0) {
    return 0.9
  }

  // Penalize per override
  const overridePenalty = params.landmarkOverrides.length * 0.1
  const avgOverrideConfidence = params.landmarkOverrides
    .map(o => o.confidence)
    .reduce((s, c) => s + c, 0) / params.landmarkOverrides.length

  const score = 0.9 - overridePenalty + (avgOverrideConfidence * 0.3)

  if (params.landmarkOverrides.length > 3) {
    flags.push('many_landmark_overrides')
  }

  return normalizeScore(score)
}

function scoreFamilyPlausibility(
  measurements: Measurements,
  flags: string[]
): number {
  let score = 0.8

  // Check spread bounds
  const spread = measurements.inside_spread
  if (spread !== null) {
    if (spread >= ANATOMICAL_BOUNDS.spreadRange.min && spread <= ANATOMICAL_BOUNDS.spreadRange.max) {
      score += 0.05
    } else {
      score -= 0.15
      flags.push('spread_out_of_bounds')
    }
  }

  // Check beam bounds
  const beamL = measurements.main_beam_left
  const beamR = measurements.main_beam_right
  if (beamL !== null) {
    if (beamL >= ANATOMICAL_BOUNDS.beamRange.min && beamL <= ANATOMICAL_BOUNDS.beamRange.max) {
      score += 0.025
    } else {
      score -= 0.075
      flags.push('beam_left_out_of_bounds')
    }
  }
  if (beamR !== null) {
    if (beamR >= ANATOMICAL_BOUNDS.beamRange.min && beamR <= ANATOMICAL_BOUNDS.beamRange.max) {
      score += 0.025
    } else {
      score -= 0.075
      flags.push('beam_right_out_of_bounds')
    }
  }

  // Check mass bounds
  const massFields = ['h1_left', 'h1_right', 'h2_left', 'h2_right', 'h3_left', 'h3_right', 'h4_left', 'h4_right'] as const
  for (const f of massFields) {
    const v = measurements[f]
    if (v !== null && (v < ANATOMICAL_BOUNDS.minMassCircumference || v > ANATOMICAL_BOUNDS.maxMassCircumference)) {
      score -= 0.02
      flags.push(`${f}_out_of_bounds`)
    }
  }

  return normalizeScore(score)
}

function scoreAsymmetryPlausibility(
  measurements: Measurements,
  params: StructuralParams,
  baseAsymmetry: TopologyInterpretation['asymmetry'],
  flags: string[]
): number {
  // Calculate post-correction asymmetry
  const beamL = measurements.main_beam_left ?? 0
  const beamR = measurements.main_beam_right ?? 0
  const beamAsym = beamL > 0 && beamR > 0 ? Math.abs(beamL - beamR) / Math.max(beamL, beamR) : 0

  let score = 0.7

  // If asymmetry was rebalanced, check if result is plausible
  if (params.asymmetryRebalance) {
    if (beamAsym <= ANATOMICAL_BOUNDS.maxSideAsymmetry) {
      score += 0.2 // Rebalancing produced plausible result
    } else {
      score -= 0.1
      flags.push('asymmetry_still_extreme_after_rebalance')
    }
  } else {
    // No rebalancing - check if asymmetry is within bounds
    if (beamAsym <= ANATOMICAL_BOUNDS.maxSideAsymmetry) {
      score += 0.1
    } else if (baseAsymmetry.cause === 'real_asymmetry') {
      score += 0.05 // Accept high asymmetry if classified as real
    } else {
      score -= 0.1
      flags.push('high_asymmetry_unexplained')
    }
  }

  return normalizeScore(score)
}

function scoreStructuralSimplicity(
  candidateType: StructuralCandidateType,
  params: StructuralParams,
  flags: string[]
): number {
  let score = 1.0

  // Penalize based on candidate type
  if (candidateType === 'baseline_structure') {
    return 1.0 // Baseline is simplest
  }

  // Apply simplicity penalties
  if (params.landmarkOverrides) {
    score -= params.landmarkOverrides.length * SIMPLICITY_PENALTIES.perLandmarkOverride
  }
  if (params.tineTopologyVariant?.reorderedTinesLeft || params.tineTopologyVariant?.reorderedTinesRight) {
    score -= SIMPLICITY_PENALTIES.tineReordering
  }
  if (params.leftRightAssociationFix) {
    score -= SIMPLICITY_PENALTIES.leftRightSwap
  }
  if (params.asymmetryRebalance) {
    score -= SIMPLICITY_PENALTIES.asymmetryRebalance
  }
  if (candidateType === 'combo_structure_variant') {
    score -= SIMPLICITY_PENALTIES.comboCandidate
  }

  if (score < 0.6) {
    flags.push('complex_structural_change')
  }

  return normalizeScore(score)
}

function calculateBaselineDeviationPenalty(
  baseGross: number,
  predictedGross: number,
  changes: MeasurementChange[],
  flags: string[]
): number {
  // Calculate gross deviation
  const grossDeviation = Math.abs(predictedGross - baseGross) / baseGross

  // Calculate change magnitude
  const avgChangePercent = changes.length > 0
    ? changes.map(c => Math.abs(c.changePercent)).reduce((s, v) => s + v, 0) / changes.length
    : 0

  let penalty = 0

  // Gross deviation penalty
  if (grossDeviation > 0.10) {
    penalty += 0.3
    flags.push('large_gross_deviation')
  } else if (grossDeviation > 0.05) {
    penalty += 0.1
  }

  // Change magnitude penalty
  if (avgChangePercent > 15) {
    penalty += 0.2
  } else if (avgChangePercent > 8) {
    penalty += 0.1
  }

  return normalizeScore(penalty)
}

function calculateUncertaintyReductionBenefit(
  crossViewConflict: StructuralSolvingInput['crossViewConflict'],
  crossViewConsistencyScore: number,
  flags: string[]
): number {
  if (!crossViewConflict) return 0

  // Benefit if we improved cross-view consistency
  const baselineDisagreement = crossViewConflict.disagreementScore
  const improvedConsistency = crossViewConsistencyScore

  // If we went from high disagreement to high consistency, that's a benefit
  if (baselineDisagreement > 0.3 && improvedConsistency > 0.7) {
    flags.push('significant_uncertainty_reduction')
    return 0.3
  } else if (baselineDisagreement > 0.2 && improvedConsistency > 0.6) {
    return 0.15
  }

  return 0
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function calculateGrossNet(measurements: Measurements): { gross: number; net: number } {
  const vals = [
    measurements.inside_spread,
    measurements.main_beam_left, measurements.main_beam_right,
    measurements.g1_left, measurements.g1_right,
    measurements.g2_left, measurements.g2_right,
    measurements.g3_left, measurements.g3_right,
    measurements.g4_left, measurements.g4_right,
    measurements.g5_left, measurements.g5_right,
    measurements.h1_left, measurements.h1_right,
    measurements.h2_left, measurements.h2_right,
    measurements.h3_left, measurements.h3_right,
    measurements.h4_left, measurements.h4_right,
    measurements.abnormal_points,
  ].filter((v): v is number => v !== null && v !== undefined)

  const gross = vals.reduce((sum, v) => sum + v, 0)
  const net = gross - (measurements.deductions || 0) - (measurements.abnormal_points || 0)
  
  return { 
    gross: Number(gross.toFixed(1)), 
    net: Number(net.toFixed(1)) 
  }
}

function buildReasonSummary(
  candidate: GeneratedCandidate,
  totalScore: number,
  geometryScore: number,
  crossViewScore: number,
  viewsSupporting: number,
  viewsContradicting: number,
  grossDelta: number
): string {
  const parts: string[] = []

  parts.push(`${candidate.type} hypothesis`)
  parts.push(`score ${(totalScore * 100).toFixed(0)}%`)
  
  if (candidate.type !== 'baseline_structure') {
    parts.push(candidate.generationReason)
  }

  parts.push(`geometry ${(geometryScore * 100).toFixed(0)}%`)
  parts.push(`cross-view ${(crossViewScore * 100).toFixed(0)}%`)
  parts.push(`${viewsSupporting} views support, ${viewsContradicting} contradict`)
  
  if (Math.abs(grossDelta) > 0.5) {
    parts.push(`gross ${grossDelta > 0 ? '+' : ''}${grossDelta.toFixed(1)}"`)
  }

  return parts.join('; ')
}

// ============================================================================
// RANKING FUNCTION
// ============================================================================

export function rankCandidates(evaluations: CandidateEvaluation[]): CandidateEvaluation[] {
  // Sort by total score descending
  const sorted = [...evaluations].sort((a, b) => b.totalScore - a.totalScore)
  
  // Assign ranks
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rankFinal = i + 1
  }

  return sorted
}

export function selectWinningCandidate(
  rankedCandidates: CandidateEvaluation[]
): CandidateEvaluation | null {
  if (rankedCandidates.length === 0) return null

  const winner = rankedCandidates[0]
  const baseline = rankedCandidates.find(c => c.candidateType === 'baseline_structure')

  // Only select non-baseline winner if it's significantly better
  if (winner.candidateType !== 'baseline_structure' && baseline) {
    const improvement = winner.totalScore - baseline.totalScore
    if (improvement < 0.05) {
      // Not enough improvement, prefer baseline
      return baseline
    }
  }

  return winner
}
