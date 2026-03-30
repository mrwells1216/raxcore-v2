/**
 * Phase 45: Geometry-Aware Refinement Engine
 * 
 * Applies bounded structural reasoning to refine landmarks/references
 * and flag geometrically implausible measurement combinations.
 * This is NOT photogrammetry - it's heuristic-based sanity checking.
 */

import type { Measurements, AngleType } from '@/lib/types'
import type {
  FusedLandmarkPackage,
  ReferenceFusionResult,
  GeometryRefinementResult,
  GeometryFlag45,
  MeasurementFamilyAdjustment,
  AsymmetryAnalysis,
  MeasurementFamily,
} from '@/lib/vision/landmarks/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// GEOMETRY CONSTRAINTS (same as existing geometry-consistency.ts)
// ============================================================================

const GEOMETRY_BOUNDS = {
  spread: {
    minEarTipRatio: 0.85,
    maxEarTipRatio: 1.55,
    minEyeRatio: 3.2,
    maxEyeRatio: 5.8,
    absoluteMin: 12,
    absoluteMax: 32,
  },
  beam: {
    minSpreadRatio: 0.85,
    maxSpreadRatio: 1.65,
    maxLeftRightDiff: 0.18,
    absoluteMin: 16,
    absoluteMax: 32,
  },
  tine: {
    g2ToBeamMin: 0.28,
    g2ToBeamMax: 0.52,
    g3ToG2Min: 0.55,
    g3ToG2Max: 1.05,
    g4ToG3Min: 0.35,
    g4ToG3Max: 0.95,
    maxLeftRightDiff: 0.25,
  },
  mass: {
    maxIncreaseRatio: 1.08,
    minDecreaseRatio: 0.70,
    h1Min: 3.5,
    h1Max: 6.0,
    maxLeftRightDiff: 0.15,
  },
  asymmetry: {
    noiseThreshold: 0.05,
    suspiciousThreshold: 0.15,
    criticalThreshold: 0.25,
  },
} as const

// ============================================================================
// MAIN REFINEMENT FUNCTION
// ============================================================================

export interface GeometryRefineInput {
  measurements: Measurements
  fusedLandmarks: FusedLandmarkPackage
  referenceFusion: ReferenceFusionResult
  angleTypes: AngleType[]
  earsFullyVisible?: boolean
}

/**
 * Apply geometry-aware refinement to landmarks and measurements.
 * Returns refined data with flags and confidence penalties.
 */
export function refineGeometry(input: GeometryRefineInput): GeometryRefinementResult {
  const { measurements, fusedLandmarks, referenceFusion, angleTypes, earsFullyVisible } = input
  
  const flags: GeometryFlag45[] = []
  const adjustments: MeasurementFamilyAdjustment[] = []
  const familyTrustPenalties: Record<MeasurementFamily, number> = {
    spread: 0,
    beam: 0,
    tine: 0,
    mass: 0,
    asymmetry: 0,
    deduction: 0,
  }
  
  // ========== SPREAD CONSISTENCY CHECKS ==========
  const spreadFlags = checkSpreadConsistency(measurements, fusedLandmarks, referenceFusion, earsFullyVisible)
  flags.push(...spreadFlags.flags)
  if (spreadFlags.adjustment) adjustments.push(spreadFlags.adjustment)
  familyTrustPenalties.spread = spreadFlags.trustPenalty
  
  // ========== BEAM CONSISTENCY CHECKS ==========
  const beamFlags = checkBeamConsistency(measurements, fusedLandmarks)
  flags.push(...beamFlags.flags)
  if (beamFlags.adjustment) adjustments.push(beamFlags.adjustment)
  familyTrustPenalties.beam = beamFlags.trustPenalty
  
  // ========== TINE PROGRESSION CHECKS ==========
  const tineFlags = checkTineProgression(measurements)
  flags.push(...tineFlags.flags)
  tineFlags.adjustments.forEach(adj => adjustments.push(adj))
  familyTrustPenalties.tine = tineFlags.trustPenalty
  
  // ========== MASS PROGRESSION CHECKS ==========
  const massFlags = checkMassProgression(measurements)
  flags.push(...massFlags.flags)
  massFlags.adjustments.forEach(adj => adjustments.push(adj))
  familyTrustPenalties.mass = massFlags.trustPenalty
  
  // ========== ASYMMETRY ANALYSIS ==========
  const asymmetryAnalysis = analyzeAsymmetry(measurements, angleTypes, referenceFusion, fusedLandmarks)
  familyTrustPenalties.asymmetry = asymmetryAnalysis.is_likely_real ? 0 : 0.15
  
  // ========== COMPUTE OVERALL SCORES ==========
  const criticalCount = flags.filter(f => f.severity === 'critical').length
  const warningCount = flags.filter(f => f.severity === 'warning').length
  const infoCount = flags.filter(f => f.severity === 'info').length
  
  let consistencyScore = 1.0
  consistencyScore -= criticalCount * 0.25
  consistencyScore -= warningCount * 0.08
  consistencyScore -= infoCount * 0.02
  consistencyScore = Math.max(0, Math.min(1, consistencyScore))
  
  // Determine tier
  let geometryTier: GeometryRefinementResult['geometry_tier'] = 'excellent'
  if (consistencyScore < 0.3) geometryTier = 'implausible'
  else if (consistencyScore < 0.5) geometryTier = 'poor'
  else if (consistencyScore < 0.7) geometryTier = 'fair'
  else if (consistencyScore < 0.85) geometryTier = 'good'
  
  // Confidence penalty
  let confidencePenalty = 0
  confidencePenalty -= criticalCount * 12
  confidencePenalty -= warningCount * 5
  confidencePenalty -= infoCount * 1
  if (consistencyScore >= 0.9 && referenceFusion.overall_reference_quality >= 0.7) {
    confidencePenalty += 3 // bonus for excellent consistency
  }
  confidencePenalty = Math.max(-30, Math.min(5, confidencePenalty))
  
  // Build summary
  const summary = buildSummary(geometryTier, flags, referenceFusion.overall_reference_quality)
  const explanation = buildExplanation(flags, adjustments, asymmetryAnalysis)
  
  return {
    refined_landmarks: fusedLandmarks, // landmarks unchanged - refinement is informational
    geometry_consistency_score: consistencyScore,
    geometry_tier: geometryTier,
    geometry_flags: flags,
    measurement_family_adjustments: adjustments,
    confidence_penalty: confidencePenalty,
    family_trust_penalties: familyTrustPenalties,
    asymmetry_analysis: asymmetryAnalysis,
    summary,
    explanation,
  }
}

// ============================================================================
// SPREAD CONSISTENCY
// ============================================================================

function checkSpreadConsistency(
  m: Measurements,
  landmarks: FusedLandmarkPackage,
  refFusion: ReferenceFusionResult,
  earsFullyVisible?: boolean
): { flags: GeometryFlag45[]; adjustment: MeasurementFamilyAdjustment | null; trustPenalty: number } {
  const flags: GeometryFlag45[] = []
  let trustPenalty = 0
  let adjustment: MeasurementFamilyAdjustment | null = null
  
  if (m.inside_spread === null) return { flags, adjustment, trustPenalty }
  
  const spread = m.inside_spread
  
  // Absolute bounds
  if (spread < GEOMETRY_BOUNDS.spread.absoluteMin) {
    flags.push({
      id: 'spread_below_min',
      category: 'spread_reference',
      severity: 'critical',
      field: 'inside_spread',
      message: `Inside spread (${spread}") below minimum anatomical bound (${GEOMETRY_BOUNDS.spread.absoluteMin}")`,
      suggested_action: {
        action_type: 'apply_bound',
        target_field: 'inside_spread',
        magnitude: 'large',
        reason: 'Value outside anatomical possibility',
      },
    })
    trustPenalty = 0.5
  } else if (spread > GEOMETRY_BOUNDS.spread.absoluteMax) {
    flags.push({
      id: 'spread_above_max',
      category: 'spread_reference',
      severity: 'critical',
      field: 'inside_spread',
      message: `Inside spread (${spread}") exceeds maximum anatomical bound (${GEOMETRY_BOUNDS.spread.absoluteMax}")`,
      suggested_action: {
        action_type: 'apply_bound',
        target_field: 'inside_spread',
        magnitude: 'large',
        reason: 'Value outside anatomical possibility',
      },
    })
    trustPenalty = 0.5
  }
  
  // Ear ratio check
  const earTipToTip = landmarks.estimated_ear_tip_to_tip ?? ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT
  const spreadToEarRatio = spread / earTipToTip
  
  if (spreadToEarRatio < GEOMETRY_BOUNDS.spread.minEarTipRatio) {
    flags.push({
      id: 'spread_ear_ratio_low',
      category: 'spread_reference',
      severity: 'warning',
      field: 'inside_spread',
      message: `Spread (${spread}") narrow relative to ear width (${earTipToTip.toFixed(1)}")`,
      suggested_action: {
        action_type: 'reduce_trust',
        target_field: 'inside_spread',
        magnitude: 'moderate',
        reason: 'Ratio below typical range',
      },
    })
    trustPenalty = Math.max(trustPenalty, 0.15)
  } else if (spreadToEarRatio > GEOMETRY_BOUNDS.spread.maxEarTipRatio) {
    flags.push({
      id: 'spread_ear_ratio_high',
      category: 'spread_reference',
      severity: 'warning',
      field: 'inside_spread',
      message: `Spread (${spread}") wide relative to ear width (${earTipToTip.toFixed(1)}")`,
      suggested_action: {
        action_type: 'reduce_trust',
        target_field: 'inside_spread',
        magnitude: 'moderate',
        reason: 'Ratio above typical range',
      },
    })
    trustPenalty = Math.max(trustPenalty, 0.15)
  }
  
  // Reference quality check
  if (refFusion.spread_primary.confidence < 0.5) {
    flags.push({
      id: 'spread_weak_reference',
      category: 'reference_conflict',
      severity: 'info',
      field: 'inside_spread',
      message: `Spread reference quality limited (${Math.round(refFusion.spread_primary.confidence * 100)}%)`,
      suggested_action: null,
    })
    trustPenalty = Math.max(trustPenalty, 0.1)
  }
  
  return { flags, adjustment, trustPenalty }
}

// ============================================================================
// BEAM CONSISTENCY
// ============================================================================

function checkBeamConsistency(
  m: Measurements,
  landmarks: FusedLandmarkPackage
): { flags: GeometryFlag45[]; adjustment: MeasurementFamilyAdjustment | null; trustPenalty: number } {
  const flags: GeometryFlag45[] = []
  let trustPenalty = 0
  let adjustment: MeasurementFamilyAdjustment | null = null
  
  const beamL = m.main_beam_left
  const beamR = m.main_beam_right
  
  if (beamL === null || beamR === null) return { flags, adjustment, trustPenalty }
  
  const avgBeam = (beamL + beamR) / 2
  const beamDiff = Math.abs(beamL - beamR)
  const beamDiffPercent = beamDiff / Math.max(beamL, beamR)
  
  // Absolute bounds
  if (avgBeam < GEOMETRY_BOUNDS.beam.absoluteMin) {
    flags.push({
      id: 'beam_below_min',
      category: 'beam_proportion',
      severity: 'critical',
      field: 'main_beam',
      message: `Main beams (avg ${avgBeam.toFixed(1)}") below minimum anatomical bound`,
      suggested_action: {
        action_type: 'apply_bound',
        target_field: 'main_beam',
        magnitude: 'large',
        reason: 'Value outside anatomical possibility',
      },
    })
    trustPenalty = 0.4
  } else if (avgBeam > GEOMETRY_BOUNDS.beam.absoluteMax) {
    flags.push({
      id: 'beam_above_max',
      category: 'beam_proportion',
      severity: 'critical',
      field: 'main_beam',
      message: `Main beams (avg ${avgBeam.toFixed(1)}") exceed maximum anatomical bound`,
      suggested_action: {
        action_type: 'apply_bound',
        target_field: 'main_beam',
        magnitude: 'large',
        reason: 'Value outside anatomical possibility',
      },
    })
    trustPenalty = 0.4
  }
  
  // Beam asymmetry
  if (beamDiffPercent > GEOMETRY_BOUNDS.beam.maxLeftRightDiff) {
    const severity = beamDiffPercent > 0.25 ? 'warning' : 'info'
    flags.push({
      id: 'beam_asymmetry_high',
      category: 'asymmetry',
      severity,
      field: 'main_beam',
      message: `Beam asymmetry (${(beamDiffPercent * 100).toFixed(0)}%) is notable`,
      suggested_action: null,
    })
    if (severity === 'warning') trustPenalty = Math.max(trustPenalty, 0.1)
  }
  
  // Beam to spread ratio
  if (m.inside_spread !== null) {
    const beamToSpread = avgBeam / m.inside_spread
    if (beamToSpread < GEOMETRY_BOUNDS.beam.minSpreadRatio) {
      flags.push({
        id: 'beam_spread_ratio_low',
        category: 'beam_proportion',
        severity: 'warning',
        field: 'main_beam',
        message: `Beams (${avgBeam.toFixed(1)}") short relative to spread (${m.inside_spread}")`,
        suggested_action: {
          action_type: 'flag_for_review',
          target_field: 'main_beam',
          magnitude: 'moderate',
          reason: 'Unusual beam/spread ratio',
        },
      })
      trustPenalty = Math.max(trustPenalty, 0.1)
    } else if (beamToSpread > GEOMETRY_BOUNDS.beam.maxSpreadRatio) {
      flags.push({
        id: 'beam_spread_ratio_high',
        category: 'beam_proportion',
        severity: 'warning',
        field: 'main_beam',
        message: `Beams (${avgBeam.toFixed(1)}") long relative to spread (${m.inside_spread}")`,
        suggested_action: {
          action_type: 'flag_for_review',
          target_field: 'main_beam',
          magnitude: 'moderate',
          reason: 'Unusual beam/spread ratio',
        },
      })
      trustPenalty = Math.max(trustPenalty, 0.1)
    }
  }
  
  return { flags, adjustment, trustPenalty }
}

// ============================================================================
// TINE PROGRESSION
// ============================================================================

function checkTineProgression(m: Measurements): { 
  flags: GeometryFlag45[]
  adjustments: MeasurementFamilyAdjustment[]
  trustPenalty: number 
} {
  const flags: GeometryFlag45[] = []
  const adjustments: MeasurementFamilyAdjustment[] = []
  let trustPenalty = 0
  
  const avgBeam = ((m.main_beam_left ?? 0) + (m.main_beam_right ?? 0)) / 2
  const avgG2 = ((m.g2_left ?? 0) + (m.g2_right ?? 0)) / 2
  const avgG3 = ((m.g3_left ?? 0) + (m.g3_right ?? 0)) / 2
  const avgG4 = ((m.g4_left ?? 0) + (m.g4_right ?? 0)) / 2
  
  // G2 to beam ratio
  if (avgG2 > 0 && avgBeam > 0) {
    const g2ToBeam = avgG2 / avgBeam
    if (g2ToBeam < GEOMETRY_BOUNDS.tine.g2ToBeamMin) {
      flags.push({
        id: 'g2_beam_ratio_low',
        category: 'tine_progression',
        severity: 'info',
        field: 'g2',
        message: `G2 (${avgG2.toFixed(1)}") short relative to beam length`,
        suggested_action: null,
      })
    } else if (g2ToBeam > GEOMETRY_BOUNDS.tine.g2ToBeamMax) {
      flags.push({
        id: 'g2_beam_ratio_high',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g2',
        message: `G2 (${avgG2.toFixed(1)}") very long relative to beam length`,
        suggested_action: {
          action_type: 'flag_for_review',
          target_field: 'g2',
          magnitude: 'moderate',
          reason: 'Unusual G2/beam ratio',
        },
      })
      trustPenalty = Math.max(trustPenalty, 0.1)
    }
  }
  
  // G3 to G2 ratio
  if (avgG3 > 0 && avgG2 > 0) {
    const g3ToG2 = avgG3 / avgG2
    if (g3ToG2 > GEOMETRY_BOUNDS.tine.g3ToG2Max) {
      flags.push({
        id: 'g3_exceeds_g2',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g3',
        message: `G3 (${avgG3.toFixed(1)}") exceeds G2 (${avgG2.toFixed(1)}") significantly`,
        suggested_action: null,
      })
    }
  }
  
  // G4 to G3 ratio
  if (avgG4 > 0 && avgG3 > 0) {
    const g4ToG3 = avgG4 / avgG3
    if (g4ToG3 > GEOMETRY_BOUNDS.tine.g4ToG3Max) {
      flags.push({
        id: 'g4_g3_ratio_high',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g4',
        message: `G4 (${avgG4.toFixed(1)}") unusually long relative to G3`,
        suggested_action: null,
      })
    }
  }
  
  // Tine asymmetry
  const tines = ['g1', 'g2', 'g3', 'g4'] as const
  for (const tine of tines) {
    const left = m[`${tine}_left` as keyof Measurements] as number | null
    const right = m[`${tine}_right` as keyof Measurements] as number | null
    if (left && right && left > 0 && right > 0) {
      const diff = Math.abs(left - right)
      const max = Math.max(left, right)
      const diffPercent = diff / max
      
      if (diffPercent > GEOMETRY_BOUNDS.tine.maxLeftRightDiff) {
        flags.push({
          id: `${tine}_asymmetry`,
          category: 'asymmetry',
          severity: diffPercent > 0.35 ? 'warning' : 'info',
          field: tine,
          message: `${tine.toUpperCase()} asymmetry: L=${left.toFixed(1)}" R=${right.toFixed(1)}" (${(diffPercent * 100).toFixed(0)}% diff)`,
          suggested_action: null,
        })
      }
    }
  }
  
  return { flags, adjustments, trustPenalty }
}

// ============================================================================
// MASS PROGRESSION
// ============================================================================

function checkMassProgression(m: Measurements): {
  flags: GeometryFlag45[]
  adjustments: MeasurementFamilyAdjustment[]
  trustPenalty: number
} {
  const flags: GeometryFlag45[] = []
  const adjustments: MeasurementFamilyAdjustment[] = []
  let trustPenalty = 0
  
  // H1 bounds
  const avgH1 = ((m.h1_left ?? 0) + (m.h1_right ?? 0)) / 2
  if (avgH1 > 0) {
    if (avgH1 < GEOMETRY_BOUNDS.mass.h1Min) {
      flags.push({
        id: 'h1_below_min',
        category: 'mass_progression',
        severity: 'info',
        field: 'h1',
        message: `H1 (${avgH1.toFixed(1)}") below typical minimum`,
        suggested_action: null,
      })
    } else if (avgH1 > GEOMETRY_BOUNDS.mass.h1Max) {
      flags.push({
        id: 'h1_above_max',
        category: 'mass_progression',
        severity: 'info',
        field: 'h1',
        message: `H1 (${avgH1.toFixed(1)}") above typical maximum`,
        suggested_action: null,
      })
    }
  }
  
  // Mass progression (H values should generally decrease or stay similar)
  const hValues = [
    { name: 'H1', left: m.h1_left, right: m.h1_right },
    { name: 'H2', left: m.h2_left, right: m.h2_right },
    { name: 'H3', left: m.h3_left, right: m.h3_right },
    { name: 'H4', left: m.h4_left, right: m.h4_right },
  ]
  
  for (let i = 1; i < hValues.length; i++) {
    const prev = hValues[i - 1]
    const curr = hValues[i]
    const prevAvg = ((prev.left ?? 0) + (prev.right ?? 0)) / 2
    const currAvg = ((curr.left ?? 0) + (curr.right ?? 0)) / 2
    
    if (prevAvg > 0 && currAvg > 0) {
      const ratio = currAvg / prevAvg
      if (ratio > GEOMETRY_BOUNDS.mass.maxIncreaseRatio) {
        flags.push({
          id: `${curr.name.toLowerCase()}_increase_unusual`,
          category: 'mass_progression',
          severity: 'warning',
          field: curr.name.toLowerCase(),
          message: `${curr.name} (${currAvg.toFixed(1)}") increases from ${prev.name} (${prevAvg.toFixed(1)}") unusually`,
          suggested_action: null,
        })
        trustPenalty = Math.max(trustPenalty, 0.1)
      }
    }
  }
  
  // Mass asymmetry
  for (const h of hValues) {
    if (h.left && h.right && h.left > 0 && h.right > 0) {
      const diff = Math.abs(h.left - h.right)
      const max = Math.max(h.left, h.right)
      const diffPercent = diff / max
      
      if (diffPercent > GEOMETRY_BOUNDS.mass.maxLeftRightDiff) {
        flags.push({
          id: `${h.name.toLowerCase()}_asymmetry`,
          category: 'asymmetry',
          severity: 'info',
          field: h.name.toLowerCase(),
          message: `${h.name} asymmetry: L=${h.left.toFixed(1)}" R=${h.right.toFixed(1)}" (${(diffPercent * 100).toFixed(0)}% diff)`,
          suggested_action: null,
        })
      }
    }
  }
  
  return { flags, adjustments, trustPenalty }
}

// ============================================================================
// ASYMMETRY ANALYSIS
// ============================================================================

function analyzeAsymmetry(
  m: Measurements,
  angleTypes: AngleType[],
  refFusion: ReferenceFusionResult,
  landmarks: FusedLandmarkPackage
): AsymmetryAnalysis {
  const hasFront = angleTypes.includes('front')
  const hasLeft = angleTypes.includes('left')
  const hasRight = angleTypes.includes('right')
  const hasBothSides = hasLeft && hasRight
  
  // Per-side visibility quality
  let leftVisibility = 0.3
  let rightVisibility = 0.3
  
  if (hasFront) {
    leftVisibility += 0.3
    rightVisibility += 0.3
  }
  if (hasLeft) leftVisibility += 0.4
  if (hasRight) rightVisibility += 0.4
  
  const visibilityImbalance = Math.abs(leftVisibility - rightVisibility)
  
  // Calculate asymmetry percentages
  const beamL = m.main_beam_left ?? 0
  const beamR = m.main_beam_right ?? 0
  const beamAsymmetry = beamL > 0 && beamR > 0 
    ? Math.abs(beamL - beamR) / Math.max(beamL, beamR) 
    : 0
  
  const tineAsymmetry = calculateTineAsymmetry(m)
  const massAsymmetry = calculateMassAsymmetry(m)
  
  const overallAsymmetry = (beamAsymmetry * 0.4 + tineAsymmetry * 0.4 + massAsymmetry * 0.2)
  
  // Determine if asymmetry is real
  let isLikelyReal = false
  let apparentCause: AsymmetryAnalysis['apparent_cause'] = 'unknown'
  
  if (overallAsymmetry > GEOMETRY_BOUNDS.asymmetry.criticalThreshold) {
    if (hasBothSides && hasFront) {
      // Strong multi-view support - likely real
      isLikelyReal = true
      apparentCause = 'real_asymmetry'
    } else if (visibilityImbalance > 0.3) {
      // Significant visibility imbalance - likely perspective
      apparentCause = 'perspective_induced'
    } else if (!hasBothSides) {
      apparentCause = 'missing_visibility'
    } else {
      apparentCause = 'mixed'
    }
  } else if (overallAsymmetry > GEOMETRY_BOUNDS.asymmetry.suspiciousThreshold) {
    if (hasBothSides && visibilityImbalance < 0.2) {
      isLikelyReal = true
      apparentCause = 'real_asymmetry'
    } else {
      apparentCause = visibilityImbalance > 0.2 ? 'perspective_induced' : 'mixed'
    }
  } else if (overallAsymmetry > GEOMETRY_BOUNDS.asymmetry.noiseThreshold) {
    // Minor asymmetry - could be real or noise
    apparentCause = 'real_asymmetry' // minor asymmetry is normal
    isLikelyReal = true
  } else {
    // Very symmetric - no significant asymmetry
    isLikelyReal = false
    apparentCause = 'real_asymmetry' // symmetric is also "real"
  }
  
  // Confidence in assessment
  let asymmetryConfidence = 0.5
  if (hasBothSides && hasFront) asymmetryConfidence = 0.9
  else if (hasBothSides || hasFront) asymmetryConfidence = 0.7
  else asymmetryConfidence = 0.4
  
  // Recommendations
  let recommendation = 'Asymmetry assessment is reliable'
  let shouldApplyDeduction = true
  let suggestedAdjustment = 0
  
  if (apparentCause === 'perspective_induced') {
    recommendation = 'Asymmetry may be caused by perspective - verify with additional angles'
    shouldApplyDeduction = false
    suggestedAdjustment = -(m.deductions ?? 0) * 0.3 // reduce deduction
  } else if (apparentCause === 'missing_visibility') {
    recommendation = 'Cannot reliably assess asymmetry without both side views'
    shouldApplyDeduction = false
    suggestedAdjustment = -(m.deductions ?? 0) * 0.2
  }
  
  return {
    is_likely_real: isLikelyReal,
    apparent_cause: apparentCause,
    left_side_visibility: leftVisibility,
    right_side_visibility: rightVisibility,
    visibility_imbalance: visibilityImbalance,
    overall_asymmetry_percent: overallAsymmetry * 100,
    beam_asymmetry_percent: beamAsymmetry * 100,
    tine_asymmetry_percent: tineAsymmetry * 100,
    mass_asymmetry_percent: massAsymmetry * 100,
    asymmetry_confidence: asymmetryConfidence,
    views_supporting_asymmetry: hasBothSides ? 2 : (hasLeft || hasRight ? 1 : 0),
    views_contradicting_asymmetry: 0, // would need conflict detection
    recommendation,
    should_apply_asymmetry_deduction: shouldApplyDeduction,
    suggested_deduction_adjustment: suggestedAdjustment,
  }
}

function calculateTineAsymmetry(m: Measurements): number {
  const pairs = [
    [m.g1_left, m.g1_right],
    [m.g2_left, m.g2_right],
    [m.g3_left, m.g3_right],
    [m.g4_left, m.g4_right],
  ]
  
  let totalAsymmetry = 0
  let count = 0
  
  for (const [l, r] of pairs) {
    if (l && r && l > 0 && r > 0) {
      totalAsymmetry += Math.abs(l - r) / Math.max(l, r)
      count++
    }
  }
  
  return count > 0 ? totalAsymmetry / count : 0
}

function calculateMassAsymmetry(m: Measurements): number {
  const pairs = [
    [m.h1_left, m.h1_right],
    [m.h2_left, m.h2_right],
    [m.h3_left, m.h3_right],
    [m.h4_left, m.h4_right],
  ]
  
  let totalAsymmetry = 0
  let count = 0
  
  for (const [l, r] of pairs) {
    if (l && r && l > 0 && r > 0) {
      totalAsymmetry += Math.abs(l - r) / Math.max(l, r)
      count++
    }
  }
  
  return count > 0 ? totalAsymmetry / count : 0
}

// ============================================================================
// SUMMARY BUILDERS
// ============================================================================

function buildSummary(
  tier: GeometryRefinementResult['geometry_tier'],
  flags: GeometryFlag45[],
  referenceQuality: number
): string {
  const critical = flags.filter(f => f.severity === 'critical').length
  const warning = flags.filter(f => f.severity === 'warning').length
  
  if (tier === 'excellent') {
    return 'Geometry is consistent with strong anatomical references'
  } else if (tier === 'good') {
    return `Geometry is mostly consistent (${warning} minor concern${warning !== 1 ? 's' : ''})`
  } else if (tier === 'fair') {
    return `Geometry has some inconsistencies (${warning} warning${warning !== 1 ? 's' : ''}, ${Math.round(referenceQuality * 100)}% reference quality)`
  } else if (tier === 'poor') {
    return `Geometry has significant issues (${critical} critical, ${warning} warning${warning !== 1 ? 's' : ''})`
  } else {
    return `Geometry is implausible - measurements may be unreliable`
  }
}

function buildExplanation(
  flags: GeometryFlag45[],
  adjustments: MeasurementFamilyAdjustment[],
  asymmetry: AsymmetryAnalysis
): string[] {
  const explanation: string[] = []
  
  // Flag summary
  const critical = flags.filter(f => f.severity === 'critical')
  const warnings = flags.filter(f => f.severity === 'warning')
  
  if (critical.length > 0) {
    explanation.push(`Critical issues: ${critical.map(f => f.message).join('; ')}`)
  }
  if (warnings.length > 0 && warnings.length <= 3) {
    explanation.push(`Warnings: ${warnings.map(f => f.message).join('; ')}`)
  } else if (warnings.length > 3) {
    explanation.push(`${warnings.length} geometry warnings detected`)
  }
  
  // Asymmetry
  if (asymmetry.overall_asymmetry_percent > 10) {
    explanation.push(`Asymmetry: ${asymmetry.overall_asymmetry_percent.toFixed(0)}% overall (${asymmetry.apparent_cause.replace(/_/g, ' ')})`)
  }
  
  // Adjustments
  if (adjustments.length > 0) {
    explanation.push(`${adjustments.length} measurement adjustment${adjustments.length > 1 ? 's' : ''} suggested`)
  }
  
  return explanation
}
