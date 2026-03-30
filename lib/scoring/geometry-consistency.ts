/**
 * Phase 42: Geometry Consistency Engine
 * 
 * Validates that rack measurements are anatomically plausible and geometrically
 * consistent. Detects impossible or implausible measurement combinations and
 * adjusts confidence accordingly.
 * 
 * This is NOT true 3D reconstruction - it's a heuristic-based sanity checker
 * that uses known whitetail deer antler proportions and relationships.
 */

import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// TYPES
// ============================================================================

export type GeometryFlagSeverity = 'info' | 'warning' | 'critical'
export type GeometryFlagCategory = 
  | 'spread_reference' 
  | 'beam_proportion' 
  | 'tine_progression' 
  | 'mass_progression'
  | 'asymmetry'
  | 'anatomical_bounds'

export interface GeometryFlag {
  id: string
  category: GeometryFlagCategory
  severity: GeometryFlagSeverity
  field: string | null
  message: string
  suggestedAdjustment?: {
    field: string
    direction: 'increase' | 'decrease' | 'verify'
    magnitude: 'small' | 'moderate' | 'large'
  }
}

export interface MeasurementRefinement {
  field: string
  original: number
  refined: number
  reason: string
  trustReduction: number // 0-1, how much to reduce trust in this measurement
}

export interface ReferenceContribution {
  referenceType: 'ear' | 'eye' | 'combined' | 'weak_fallback'
  quality: number // 0-1
  usedForMeasurements: string[]
  imageIndices: number[]
}

export interface GeometryConsistencyResult {
  /** Overall consistency score 0-1 (1 = fully consistent) */
  consistencyScore: number
  
  /** Qualitative tier */
  tier: 'excellent' | 'good' | 'fair' | 'poor' | 'implausible'
  
  /** Detected geometry issues */
  flags: GeometryFlag[]
  
  /** Suggested measurement refinements */
  refinements: MeasurementRefinement[]
  
  /** Refined measurements (original + refinements applied) */
  refinedMeasurements: Measurements
  
  /** Confidence adjustment to apply (negative for issues) */
  confidenceAdjustment: number
  
  /** Trust penalty per measurement family */
  measurementTrustPenalties: Record<string, number>
  
  /** Summary for display */
  summary: string
  
  /** Detailed explanation for admin */
  explanation: string[]
  
  /** Whether asymmetry is likely real vs caused by perspective */
  asymmetryAnalysis: {
    isLikelyReal: boolean
    apparentCause: 'real_asymmetry' | 'poor_angle' | 'weak_reference' | 'unknown'
    leftRightDivergence: number // percentage
    recommendation: string
  }
  
  /** Per-measurement reference confidence */
  referenceContributions: Record<string, ReferenceContribution>
}

// ============================================================================
// ANATOMICAL CONSTRAINTS
// ============================================================================

const GEOMETRY_CONSTRAINTS = {
  // Spread constraints relative to ear reference
  spread: {
    minEarTipRatio: 0.85,   // spread >= 85% of ear tip-to-tip
    maxEarTipRatio: 1.55,   // spread <= 155% of ear tip-to-tip
    minEyeRatio: 3.2,       // spread >= 3.2x eye distance
    maxEyeRatio: 5.8,       // spread <= 5.8x eye distance
    absoluteMin: 12,
    absoluteMax: 32,
  },
  
  // Beam constraints
  beam: {
    minSpreadRatio: 0.85,   // beam >= 85% of spread
    maxSpreadRatio: 1.65,   // beam <= 165% of spread
    minEarRatio: 3.2,       // beam >= 3.2x ear length
    maxEarRatio: 5.2,       // beam <= 5.2x ear length
    maxLeftRightDiff: 0.18, // max 18% difference between beams
    absoluteMin: 16,
    absoluteMax: 32,
  },
  
  // Tine progression constraints
  tine: {
    // G2 is typically longest
    g2ToBeamMin: 0.28,
    g2ToBeamMax: 0.52,
    // G3 relative to G2
    g3ToG2Min: 0.55,
    g3ToG2Max: 1.05,
    // G4 relative to G3
    g4ToG3Min: 0.35,
    g4ToG3Max: 0.95,
    // G1 (brow) bounds
    g1Min: 2.0,
    g1Max: 10.0,
    // Max left/right difference for same tine
    maxLeftRightDiff: 0.25,
  },
  
  // Mass (circumference) progression
  mass: {
    // H values should generally decrease or stay similar
    maxIncreaseRatio: 1.08, // H(n+1) shouldn't exceed H(n) by >8%
    minDecreaseRatio: 0.70, // H(n+1) shouldn't be <70% of H(n)
    h1Min: 3.5,
    h1Max: 6.0,
    maxLeftRightDiff: 0.15,
  },
  
  // Asymmetry thresholds
  asymmetry: {
    // Below this = likely measurement noise, not real
    noiseThreshold: 0.05,
    // Above this = concerning if angles are weak
    suspiciousThreshold: 0.15,
    // Above this = either real asymmetry or bad data
    criticalThreshold: 0.25,
  },
} as const

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export interface GeometryConsistencyInput {
  measurements: Measurements
  landmarks: LandmarksDetected
  angleTypes: AngleType[]
  earsFullyVisible?: boolean
  /** Vision-reported ear length if available */
  visionEarLength?: number
}

export function checkGeometryConsistency(
  input: GeometryConsistencyInput
): GeometryConsistencyResult {
  const { measurements, landmarks, angleTypes, earsFullyVisible } = input
  
  const flags: GeometryFlag[] = []
  const refinements: MeasurementRefinement[] = []
  const explanation: string[] = []
  const measurementTrustPenalties: Record<string, number> = {}
  const referenceContributions: Record<string, ReferenceContribution> = {}
  
  // Determine available references
  const hasStrongEarRef = landmarks.ears_visible && earsFullyVisible
  const hasWeakEarRef = landmarks.ears_visible && !earsFullyVisible
  const hasEyeRef = landmarks.eyes_visible
  const hasFrontAngle = angleTypes.includes('front')
  const hasBothSides = angleTypes.includes('left') && angleTypes.includes('right')
  
  // Reference quality scoring
  let referenceQuality = 0.3 // baseline
  if (hasStrongEarRef) referenceQuality += 0.4
  else if (hasWeakEarRef) referenceQuality += 0.2
  if (hasEyeRef) referenceQuality += 0.2
  if (hasFrontAngle) referenceQuality += 0.1
  referenceQuality = Math.min(1, referenceQuality)
  
  explanation.push(`Reference quality: ${(referenceQuality * 100).toFixed(0)}%`)
  
  // ============================================================================
  // 1. SPREAD CONSISTENCY CHECKS
  // ============================================================================
  
  if (measurements.inside_spread !== null) {
    const spread = measurements.inside_spread
    
    // Set up reference contribution for spread
    referenceContributions['spread'] = {
      referenceType: hasStrongEarRef ? 'ear' : hasEyeRef ? 'eye' : 'weak_fallback',
      quality: hasStrongEarRef ? 0.9 : hasEyeRef ? 0.7 : 0.4,
      usedForMeasurements: ['inside_spread'],
      imageIndices: hasFrontAngle ? [angleTypes.indexOf('front')] : [],
    }
    
    // Absolute bounds check
    if (spread < GEOMETRY_CONSTRAINTS.spread.absoluteMin) {
      flags.push({
        id: 'spread_too_narrow',
        category: 'spread_reference',
        severity: 'critical',
        field: 'inside_spread',
        message: `Inside spread (${spread}") is below minimum anatomical bound (${GEOMETRY_CONSTRAINTS.spread.absoluteMin}")`,
        suggestedAdjustment: { field: 'inside_spread', direction: 'increase', magnitude: 'large' },
      })
      measurementTrustPenalties['inside_spread'] = 0.5
    } else if (spread > GEOMETRY_CONSTRAINTS.spread.absoluteMax) {
      flags.push({
        id: 'spread_too_wide',
        category: 'spread_reference',
        severity: 'critical',
        field: 'inside_spread',
        message: `Inside spread (${spread}") exceeds maximum anatomical bound (${GEOMETRY_CONSTRAINTS.spread.absoluteMax}")`,
        suggestedAdjustment: { field: 'inside_spread', direction: 'decrease', magnitude: 'large' },
      })
      measurementTrustPenalties['inside_spread'] = 0.5
    }
    
    // Ear-based ratio check
    if (landmarks.ear_tip_to_tip) {
      const earTipToTip = landmarks.ear_tip_to_tip
      const spreadToEarRatio = spread / earTipToTip
      
      if (spreadToEarRatio < GEOMETRY_CONSTRAINTS.spread.minEarTipRatio) {
        flags.push({
          id: 'spread_ear_ratio_low',
          category: 'spread_reference',
          severity: 'warning',
          field: 'inside_spread',
          message: `Spread (${spread}") seems narrow relative to ear width (${earTipToTip.toFixed(1)}")`,
        })
        measurementTrustPenalties['inside_spread'] = (measurementTrustPenalties['inside_spread'] || 0) + 0.15
      } else if (spreadToEarRatio > GEOMETRY_CONSTRAINTS.spread.maxEarTipRatio) {
        flags.push({
          id: 'spread_ear_ratio_high',
          category: 'spread_reference',
          severity: 'warning',
          field: 'inside_spread',
          message: `Spread (${spread}") seems wide relative to ear width (${earTipToTip.toFixed(1)}")`,
        })
        measurementTrustPenalties['inside_spread'] = (measurementTrustPenalties['inside_spread'] || 0) + 0.15
      }
    }
    
    // Eye-based ratio check
    if (landmarks.eye_to_eye) {
      const eyeDistance = landmarks.eye_to_eye
      const spreadToEyeRatio = spread / eyeDistance
      
      if (spreadToEyeRatio < GEOMETRY_CONSTRAINTS.spread.minEyeRatio) {
        flags.push({
          id: 'spread_eye_ratio_low',
          category: 'spread_reference',
          severity: 'info',
          field: 'inside_spread',
          message: `Spread/eye ratio (${spreadToEyeRatio.toFixed(1)}x) below typical range`,
        })
      } else if (spreadToEyeRatio > GEOMETRY_CONSTRAINTS.spread.maxEyeRatio) {
        flags.push({
          id: 'spread_eye_ratio_high',
          category: 'spread_reference',
          severity: 'info',
          field: 'inside_spread',
          message: `Spread/eye ratio (${spreadToEyeRatio.toFixed(1)}x) above typical range`,
        })
      }
    }
  }
  
  // ============================================================================
  // 2. BEAM CONSISTENCY CHECKS
  // ============================================================================
  
  const beamLeft = measurements.main_beam_left
  const beamRight = measurements.main_beam_right
  
  if (beamLeft !== null && beamRight !== null) {
    const avgBeam = (beamLeft + beamRight) / 2
    const beamDiff = Math.abs(beamLeft - beamRight)
    const beamDiffPercent = beamDiff / Math.max(beamLeft, beamRight)
    
    // Reference contribution for beams
    referenceContributions['beam'] = {
      referenceType: hasBothSides ? (hasEyeRef ? 'combined' : 'weak_fallback') : 'weak_fallback',
      quality: hasBothSides ? 0.85 : 0.5,
      usedForMeasurements: ['main_beam_left', 'main_beam_right'],
      imageIndices: angleTypes.map((a, i) => a === 'left' || a === 'right' ? i : -1).filter(i => i >= 0),
    }
    
    // Absolute bounds
    if (avgBeam < GEOMETRY_CONSTRAINTS.beam.absoluteMin) {
      flags.push({
        id: 'beam_too_short',
        category: 'beam_proportion',
        severity: 'critical',
        field: 'main_beam',
        message: `Main beams (avg ${avgBeam.toFixed(1)}") below minimum anatomical bound`,
      })
      measurementTrustPenalties['main_beam'] = 0.4
    } else if (avgBeam > GEOMETRY_CONSTRAINTS.beam.absoluteMax) {
      flags.push({
        id: 'beam_too_long',
        category: 'beam_proportion',
        severity: 'critical',
        field: 'main_beam',
        message: `Main beams (avg ${avgBeam.toFixed(1)}") exceed maximum anatomical bound`,
      })
      measurementTrustPenalties['main_beam'] = 0.4
    }
    
    // Beam asymmetry
    if (beamDiffPercent > GEOMETRY_CONSTRAINTS.beam.maxLeftRightDiff) {
      flags.push({
        id: 'beam_asymmetry_high',
        category: 'asymmetry',
        severity: beamDiffPercent > 0.25 ? 'warning' : 'info',
        field: 'main_beam',
        message: `Beam asymmetry (${(beamDiffPercent * 100).toFixed(0)}%) is notable`,
      })
    }
    
    // Beam to spread ratio
    if (measurements.inside_spread !== null) {
      const beamToSpread = avgBeam / measurements.inside_spread
      if (beamToSpread < GEOMETRY_CONSTRAINTS.beam.minSpreadRatio) {
        flags.push({
          id: 'beam_spread_ratio_low',
          category: 'beam_proportion',
          severity: 'warning',
          field: 'main_beam',
          message: `Beams (${avgBeam.toFixed(1)}") seem short relative to spread (${measurements.inside_spread}")`,
        })
        measurementTrustPenalties['main_beam'] = (measurementTrustPenalties['main_beam'] || 0) + 0.1
      } else if (beamToSpread > GEOMETRY_CONSTRAINTS.beam.maxSpreadRatio) {
        flags.push({
          id: 'beam_spread_ratio_high',
          category: 'beam_proportion',
          severity: 'warning',
          field: 'main_beam',
          message: `Beams (${avgBeam.toFixed(1)}") seem long relative to spread (${measurements.inside_spread}")`,
        })
        measurementTrustPenalties['main_beam'] = (measurementTrustPenalties['main_beam'] || 0) + 0.1
      }
    }
  }
  
  // ============================================================================
  // 3. TINE PROGRESSION CHECKS
  // ============================================================================
  
  const tineChecks = checkTineProgression(measurements, flags, measurementTrustPenalties)
  referenceContributions['tine'] = {
    referenceType: hasBothSides ? 'combined' : 'weak_fallback',
    quality: hasBothSides ? 0.8 : 0.45,
    usedForMeasurements: ['g1', 'g2', 'g3', 'g4', 'g5'].flatMap(g => [`${g}_left`, `${g}_right`]),
    imageIndices: angleTypes.map((a, i) => a === 'left' || a === 'right' ? i : -1).filter(i => i >= 0),
  }
  
  // ============================================================================
  // 4. MASS PROGRESSION CHECKS
  // ============================================================================
  
  checkMassProgression(measurements, flags, measurementTrustPenalties)
  referenceContributions['mass'] = {
    referenceType: hasBothSides ? 'combined' : 'weak_fallback',
    quality: hasBothSides ? 0.7 : 0.4,
    usedForMeasurements: ['h1', 'h2', 'h3', 'h4'].flatMap(h => [`${h}_left`, `${h}_right`]),
    imageIndices: angleTypes.map((a, i) => a === 'left' || a === 'right' ? i : -1).filter(i => i >= 0),
  }
  
  // ============================================================================
  // 5. ASYMMETRY ANALYSIS
  // ============================================================================
  
  const asymmetryAnalysis = analyzeAsymmetry(measurements, angleTypes, referenceQuality)
  
  // ============================================================================
  // 6. COMPUTE REFINEMENTS
  // ============================================================================
  
  const refinedMeasurements = computeRefinements(
    measurements,
    flags,
    refinements,
    referenceQuality
  )
  
  // ============================================================================
  // 7. COMPUTE FINAL SCORES
  // ============================================================================
  
  const criticalFlags = flags.filter(f => f.severity === 'critical').length
  const warningFlags = flags.filter(f => f.severity === 'warning').length
  const infoFlags = flags.filter(f => f.severity === 'info').length
  
  let consistencyScore = 1.0
  consistencyScore -= criticalFlags * 0.25
  consistencyScore -= warningFlags * 0.08
  consistencyScore -= infoFlags * 0.02
  consistencyScore = Math.max(0, Math.min(1, consistencyScore))
  
  // Tier determination
  let tier: GeometryConsistencyResult['tier'] = 'excellent'
  if (consistencyScore < 0.3) tier = 'implausible'
  else if (consistencyScore < 0.5) tier = 'poor'
  else if (consistencyScore < 0.7) tier = 'fair'
  else if (consistencyScore < 0.85) tier = 'good'
  
  // Confidence adjustment
  let confidenceAdjustment = 0
  confidenceAdjustment -= criticalFlags * 12
  confidenceAdjustment -= warningFlags * 5
  confidenceAdjustment -= infoFlags * 1
  // Bonus for high consistency
  if (consistencyScore >= 0.9 && referenceQuality >= 0.7) {
    confidenceAdjustment += 3
  }
  confidenceAdjustment = Math.max(-30, Math.min(5, confidenceAdjustment))
  
  // Summary
  const summary = buildSummary(tier, flags, referenceQuality)
  
  return {
    consistencyScore,
    tier,
    flags,
    refinements,
    refinedMeasurements,
    confidenceAdjustment,
    measurementTrustPenalties,
    summary,
    explanation,
    asymmetryAnalysis,
    referenceContributions,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function checkTineProgression(
  measurements: Measurements,
  flags: GeometryFlag[],
  penalties: Record<string, number>
): void {
  const avgBeam = ((measurements.main_beam_left ?? 0) + (measurements.main_beam_right ?? 0)) / 2
  
  // G2 to beam ratio
  const avgG2 = ((measurements.g2_left ?? 0) + (measurements.g2_right ?? 0)) / 2
  if (avgG2 > 0 && avgBeam > 0) {
    const g2ToBeam = avgG2 / avgBeam
    if (g2ToBeam < GEOMETRY_CONSTRAINTS.tine.g2ToBeamMin) {
      flags.push({
        id: 'g2_beam_ratio_low',
        category: 'tine_progression',
        severity: 'info',
        field: 'g2',
        message: `G2 (${avgG2.toFixed(1)}") seems short relative to beam length`,
      })
    } else if (g2ToBeam > GEOMETRY_CONSTRAINTS.tine.g2ToBeamMax) {
      flags.push({
        id: 'g2_beam_ratio_high',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g2',
        message: `G2 (${avgG2.toFixed(1)}") seems very long relative to beam length`,
      })
      penalties['g2'] = 0.1
    }
  }
  
  // G3 to G2 ratio
  const avgG3 = ((measurements.g3_left ?? 0) + (measurements.g3_right ?? 0)) / 2
  if (avgG3 > 0 && avgG2 > 0) {
    const g3ToG2 = avgG3 / avgG2
    if (g3ToG2 < GEOMETRY_CONSTRAINTS.tine.g3ToG2Min) {
      flags.push({
        id: 'g3_g2_ratio_low',
        category: 'tine_progression',
        severity: 'info',
        field: 'g3',
        message: `G3/G2 ratio (${g3ToG2.toFixed(2)}) is below typical`,
      })
    } else if (g3ToG2 > GEOMETRY_CONSTRAINTS.tine.g3ToG2Max) {
      flags.push({
        id: 'g3_exceeds_g2',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g3',
        message: `G3 (${avgG3.toFixed(1)}") exceeds G2 (${avgG2.toFixed(1)}") significantly`,
      })
    }
  }
  
  // G4 to G3 ratio
  const avgG4 = ((measurements.g4_left ?? 0) + (measurements.g4_right ?? 0)) / 2
  if (avgG4 > 0 && avgG3 > 0) {
    const g4ToG3 = avgG4 / avgG3
    if (g4ToG3 > GEOMETRY_CONSTRAINTS.tine.g4ToG3Max) {
      flags.push({
        id: 'g4_g3_ratio_high',
        category: 'tine_progression',
        severity: 'warning',
        field: 'g4',
        message: `G4 (${avgG4.toFixed(1)}") is unusually long relative to G3`,
      })
    }
  }
  
  // Check tine asymmetry
  const tines = ['g1', 'g2', 'g3', 'g4'] as const
  for (const tine of tines) {
    const left = measurements[`${tine}_left` as keyof Measurements] as number | null
    const right = measurements[`${tine}_right` as keyof Measurements] as number | null
    if (left && right && left > 0 && right > 0) {
      const diff = Math.abs(left - right)
      const max = Math.max(left, right)
      const diffPercent = diff / max
      
      if (diffPercent > GEOMETRY_CONSTRAINTS.tine.maxLeftRightDiff) {
        flags.push({
          id: `${tine}_asymmetry`,
          category: 'asymmetry',
          severity: diffPercent > 0.35 ? 'warning' : 'info',
          field: tine,
          message: `${tine.toUpperCase()} asymmetry: L=${left.toFixed(1)}" R=${right.toFixed(1)}" (${(diffPercent * 100).toFixed(0)}% diff)`,
        })
      }
    }
  }
}

function checkMassProgression(
  measurements: Measurements,
  flags: GeometryFlag[],
  penalties: Record<string, number>
): void {
  const circumferences = ['h1', 'h2', 'h3', 'h4'] as const
  
  // Check progression for each side
  for (const side of ['left', 'right'] as const) {
    let prevH: number | null = null
    let prevName = ''
    
    for (const h of circumferences) {
      const value = measurements[`${h}_${side}` as keyof Measurements] as number | null
      if (value === null) continue
      
      if (prevH !== null) {
        const ratio = value / prevH
        
        if (ratio > GEOMETRY_CONSTRAINTS.mass.maxIncreaseRatio) {
          flags.push({
            id: `${h}_${side}_increase`,
            category: 'mass_progression',
            severity: 'warning',
            field: `${h}_${side}`,
            message: `${h.toUpperCase()} ${side} (${value.toFixed(1)}") is larger than ${prevName.toUpperCase()} (${prevH.toFixed(1)}") — unusual mass progression`,
          })
          penalties[`${h}_${side}`] = 0.1
        } else if (ratio < GEOMETRY_CONSTRAINTS.mass.minDecreaseRatio) {
          flags.push({
            id: `${h}_${side}_drop`,
            category: 'mass_progression',
            severity: 'info',
            field: `${h}_${side}`,
            message: `${h.toUpperCase()} ${side} drops significantly from ${prevName.toUpperCase()}`,
          })
        }
      }
      
      prevH = value
      prevName = h
    }
  }
  
  // Check H values against absolute bounds
  const h1Left = measurements.h1_left
  const h1Right = measurements.h1_right
  if (h1Left !== null && h1Left < GEOMETRY_CONSTRAINTS.mass.h1Min) {
    flags.push({
      id: 'h1_left_low',
      category: 'mass_progression',
      severity: 'warning',
      field: 'h1_left',
      message: `H1 left (${h1Left.toFixed(1)}") is below typical minimum`,
    })
  }
  if (h1Right !== null && h1Right < GEOMETRY_CONSTRAINTS.mass.h1Min) {
    flags.push({
      id: 'h1_right_low',
      category: 'mass_progression',
      severity: 'warning',
      field: 'h1_right',
      message: `H1 right (${h1Right.toFixed(1)}") is below typical minimum`,
    })
  }
}

function analyzeAsymmetry(
  measurements: Measurements,
  angleTypes: AngleType[],
  referenceQuality: number
): GeometryConsistencyResult['asymmetryAnalysis'] {
  const leftRightPairs: { name: string; left: number; right: number }[] = []
  
  // Collect all left/right pairs
  const pairs = [
    ['main_beam_left', 'main_beam_right'],
    ['g1_left', 'g1_right'],
    ['g2_left', 'g2_right'],
    ['g3_left', 'g3_right'],
    ['g4_left', 'g4_right'],
    ['h1_left', 'h1_right'],
    ['h2_left', 'h2_right'],
    ['h3_left', 'h3_right'],
    ['h4_left', 'h4_right'],
  ]
  
  for (const [leftKey, rightKey] of pairs) {
    const left = measurements[leftKey as keyof Measurements] as number | null
    const right = measurements[rightKey as keyof Measurements] as number | null
    if (left !== null && right !== null && left > 0 && right > 0) {
      leftRightPairs.push({ name: leftKey.replace('_left', ''), left, right })
    }
  }
  
  if (leftRightPairs.length === 0) {
    return {
      isLikelyReal: false,
      apparentCause: 'unknown',
      leftRightDivergence: 0,
      recommendation: 'Insufficient data to analyze asymmetry',
    }
  }
  
  // Calculate average divergence
  let totalDivergence = 0
  for (const pair of leftRightPairs) {
    const diff = Math.abs(pair.left - pair.right)
    const avg = (pair.left + pair.right) / 2
    totalDivergence += diff / avg
  }
  const avgDivergence = totalDivergence / leftRightPairs.length
  
  // Determine cause
  const hasBothSides = angleTypes.includes('left') && angleTypes.includes('right')
  const hasGoodReference = referenceQuality >= 0.7
  
  let apparentCause: GeometryConsistencyResult['asymmetryAnalysis']['apparentCause'] = 'unknown'
  let isLikelyReal = false
  let recommendation = ''
  
  if (avgDivergence < GEOMETRY_CONSTRAINTS.asymmetry.noiseThreshold) {
    // Very symmetric - likely accurate
    isLikelyReal = false
    apparentCause = 'unknown'
    recommendation = 'Rack appears symmetric within measurement tolerance'
  } else if (avgDivergence > GEOMETRY_CONSTRAINTS.asymmetry.criticalThreshold) {
    // High asymmetry
    if (hasBothSides && hasGoodReference) {
      isLikelyReal = true
      apparentCause = 'real_asymmetry'
      recommendation = 'Significant asymmetry detected and likely real based on multiple angles'
    } else if (!hasBothSides) {
      isLikelyReal = false
      apparentCause = 'poor_angle'
      recommendation = 'High asymmetry may be due to missing opposite side angle — verify with both sides'
    } else {
      isLikelyReal = false
      apparentCause = 'weak_reference'
      recommendation = 'High asymmetry detected but reference quality is weak — verify manually'
    }
  } else if (avgDivergence > GEOMETRY_CONSTRAINTS.asymmetry.suspiciousThreshold) {
    // Moderate asymmetry
    if (hasBothSides) {
      isLikelyReal = true
      apparentCause = 'real_asymmetry'
      recommendation = 'Moderate asymmetry appears real based on both-side coverage'
    } else {
      isLikelyReal = false
      apparentCause = 'poor_angle'
      recommendation = 'Moderate asymmetry could be perspective distortion — add opposite side'
    }
  } else {
    // Low but notable asymmetry
    isLikelyReal = hasBothSides && hasGoodReference
    apparentCause = isLikelyReal ? 'real_asymmetry' : 'unknown'
    recommendation = 'Minor asymmetry within normal range'
  }
  
  return {
    isLikelyReal,
    apparentCause,
    leftRightDivergence: avgDivergence,
    recommendation,
  }
}

function computeRefinements(
  measurements: Measurements,
  flags: GeometryFlag[],
  refinements: MeasurementRefinement[],
  referenceQuality: number
): Measurements {
  const refined = { ...measurements }
  
  // Only apply refinements if we have critical issues and weak references
  // This prevents over-adjustment when data might actually be correct
  const criticalFlags = flags.filter(f => f.severity === 'critical')
  
  if (criticalFlags.length === 0 || referenceQuality >= 0.8) {
    // No refinements needed or data is reliable
    return refined
  }
  
  // Apply conservative refinements for critical issues
  for (const flag of criticalFlags) {
    if (!flag.suggestedAdjustment) continue
    
    const { field, direction, magnitude } = flag.suggestedAdjustment
    const currentValue = refined[field as keyof Measurements] as number | null
    
    if (currentValue === null) continue
    
    // Calculate adjustment amount (conservative)
    let adjustmentPercent = 0
    switch (magnitude) {
      case 'small': adjustmentPercent = 0.03; break
      case 'moderate': adjustmentPercent = 0.06; break
      case 'large': adjustmentPercent = 0.10; break
    }
    
    // Reduce adjustment based on reference quality (higher quality = less adjustment)
    adjustmentPercent *= (1 - referenceQuality * 0.5)
    
    const adjustmentAmount = currentValue * adjustmentPercent
    const newValue = direction === 'increase' 
      ? currentValue + adjustmentAmount 
      : currentValue - adjustmentAmount
    
    refinements.push({
      field,
      original: currentValue,
      refined: Number(newValue.toFixed(1)),
      reason: flag.message,
      trustReduction: adjustmentPercent,
    })
    
    ;(refined as Record<string, number | null>)[field] = Number(newValue.toFixed(1))
  }
  
  return refined
}

function buildSummary(
  tier: GeometryConsistencyResult['tier'],
  flags: GeometryFlag[],
  referenceQuality: number
): string {
  const criticalCount = flags.filter(f => f.severity === 'critical').length
  const warningCount = flags.filter(f => f.severity === 'warning').length
  
  if (tier === 'excellent') {
    return 'Measurements are geometrically consistent with strong anatomical plausibility.'
  }
  
  if (tier === 'implausible') {
    return `Multiple critical geometry issues detected (${criticalCount}). Measurements may be unreliable.`
  }
  
  if (tier === 'poor') {
    return `Geometry consistency is poor with ${criticalCount} critical and ${warningCount} warning issues. Verify measurements manually.`
  }
  
  if (tier === 'fair') {
    const refNote = referenceQuality < 0.5 ? ' Reference quality is limited.' : ''
    return `Some geometry inconsistencies detected (${warningCount} warnings).${refNote}`
  }
  
  // good
  return `Good geometry consistency with minor notes (${flags.length} total flags).`
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get a simplified geometry summary for display
 */
export function getGeometrySummaryForDisplay(
  result: GeometryConsistencyResult
): {
  tier: string
  score: number
  flagCount: number
  primaryIssue: string | null
} {
  const primaryFlag = result.flags.find(f => f.severity === 'critical') 
    || result.flags.find(f => f.severity === 'warning')
    || result.flags[0]
  
  return {
    tier: result.tier,
    score: Math.round(result.consistencyScore * 100),
    flagCount: result.flags.length,
    primaryIssue: primaryFlag?.message || null,
  }
}

/**
 * Convert geometry result to a format suitable for database storage
 */
export function geometryResultToMetadata(
  result: GeometryConsistencyResult
): Record<string, unknown> {
  return {
    consistency_score: result.consistencyScore,
    tier: result.tier,
    flag_count: result.flags.length,
    critical_flags: result.flags.filter(f => f.severity === 'critical').length,
    warning_flags: result.flags.filter(f => f.severity === 'warning').length,
    confidence_adjustment: result.confidenceAdjustment,
    asymmetry_likely_real: result.asymmetryAnalysis.isLikelyReal,
    asymmetry_divergence: result.asymmetryAnalysis.leftRightDivergence,
    reference_contributions: Object.fromEntries(
      Object.entries(result.referenceContributions).map(([k, v]) => [k, {
        type: v.referenceType,
        quality: v.quality,
      }])
    ),
  }
}
