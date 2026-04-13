/**
 * Real Confidence Engine (Phase 60)
 * 
 * Computes 0-100 confidence scores based on real factors:
 * 1. Image visibility (per-angle scoring)
 * 2. Cross-view agreement
 * 3. Measurement stability
 * 4. Historical error patterns
 * 
 * This replaces arbitrary confidence with evidence-based scoring.
 */

import type { AngleType, Measurements } from '@/lib/types'
import type { ImageAngleScore, MultiImageAngleAnalysis } from './image-angle-scoring'
import type { MeasurementFamily } from './cross-view-conflict'
import type { TrainingErrorSummary } from './training-mode'

// ============================================================================
// TYPES
// ============================================================================

export interface ConfidenceFactors {
  // Visibility factors (how well can we see what we're measuring?)
  visibilityScore: number           // 0-1: Weighted average of angle visibility
  coverageScore: number             // 0-1: How many measurement families are covered
  qualityScore: number              // 0-1: Image quality (blur, exposure, etc.)
  
  // Agreement factors (do multiple sources agree?)
  crossViewAgreement: number        // 0-1: Agreement between different images
  measurementConsistency: number    // 0-1: Internal consistency of measurements
  
  // Stability factors (is the estimate stable?)
  fusionStability: number           // 0-1: How stable is the fused result
  outlierPenalty: number            // 0-1: Penalty for rejected outliers
  
  // Historical factors (based on training data)
  historicalAccuracy: number        // 0-1: Expected accuracy based on similar inputs
}

export interface ConfidenceResult {
  overallConfidence: number         // 0-100 final score
  tier: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
  factors: ConfidenceFactors
  familyConfidences: Record<MeasurementFamily, number>
  explanation: string[]
  warnings: string[]
  recommendations: string[]
}

export interface FamilyConfidenceInput {
  family: MeasurementFamily
  values: Array<{
    imageIndex: number
    value: number
    confidence: number
  }>
  fusedValue: number
  fusedConfidence: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIDENCE_WEIGHTS = {
  visibility: 0.25,
  coverage: 0.15,
  quality: 0.15,
  agreement: 0.20,
  consistency: 0.10,
  stability: 0.10,
  historical: 0.05,
} as const

const TIER_THRESHOLDS = {
  very_high: 85,
  high: 70,
  medium: 50,
  low: 30,
} as const

// ============================================================================
// CORE ENGINE
// ============================================================================

/**
 * Compute comprehensive confidence score
 */
export function computeRealConfidence(
  angleAnalysis: MultiImageAngleAnalysis,
  familyInputs: FamilyConfidenceInput[],
  fusedMeasurements: Measurements,
  crossViewAgreementScore: number,
  historicalSummaries?: TrainingErrorSummary[]
): ConfidenceResult {
  const explanation: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []

  // 1. Compute visibility score
  const visibilityScore = computeVisibilityScore(angleAnalysis, explanation)

  // 2. Compute coverage score
  const coverageScore = computeCoverageScore(angleAnalysis, explanation, warnings)

  // 3. Compute quality score
  const qualityScore = computeQualityScore(angleAnalysis, explanation, warnings)

  // 4. Cross-view agreement (passed in)
  const crossViewAgreement = Math.max(0, Math.min(1, crossViewAgreementScore))
  if (crossViewAgreement < 0.5) {
    warnings.push('Significant disagreement between image views')
    recommendations.push('Review measurements manually due to view disagreement')
  } else if (crossViewAgreement > 0.8) {
    explanation.push('Strong agreement across multiple views')
  }

  // 5. Compute measurement consistency
  const measurementConsistency = computeMeasurementConsistency(fusedMeasurements, explanation, warnings)

  // 6. Compute fusion stability
  const { fusionStability, outlierPenalty } = computeFusionStability(familyInputs, explanation, warnings)

  // 7. Compute historical accuracy factor
  const historicalAccuracy = computeHistoricalAccuracy(
    angleAnalysis, 
    historicalSummaries,
    explanation
  )

  // Combine factors
  const factors: ConfidenceFactors = {
    visibilityScore,
    coverageScore,
    qualityScore,
    crossViewAgreement,
    measurementConsistency,
    fusionStability,
    outlierPenalty,
    historicalAccuracy,
  }

  // Calculate weighted overall confidence
  let weightedSum = 
    visibilityScore * CONFIDENCE_WEIGHTS.visibility +
    coverageScore * CONFIDENCE_WEIGHTS.coverage +
    qualityScore * CONFIDENCE_WEIGHTS.quality +
    crossViewAgreement * CONFIDENCE_WEIGHTS.agreement +
    measurementConsistency * CONFIDENCE_WEIGHTS.consistency +
    fusionStability * CONFIDENCE_WEIGHTS.stability +
    historicalAccuracy * CONFIDENCE_WEIGHTS.historical

  // Apply outlier penalty
  weightedSum *= (1 - outlierPenalty * 0.3)

  // Scale to 0-100
  let overallConfidence = Math.round(weightedSum * 100)
  overallConfidence = Math.max(10, Math.min(95, overallConfidence))

  // Determine tier
  let tier: ConfidenceResult['tier'] = 'very_low'
  if (overallConfidence >= TIER_THRESHOLDS.very_high) tier = 'very_high'
  else if (overallConfidence >= TIER_THRESHOLDS.high) tier = 'high'
  else if (overallConfidence >= TIER_THRESHOLDS.medium) tier = 'medium'
  else if (overallConfidence >= TIER_THRESHOLDS.low) tier = 'low'

  // Compute per-family confidences
  const familyConfidences = computeFamilyConfidences(
    angleAnalysis,
    familyInputs,
    factors
  )

  // Add tier-specific recommendations
  if (tier === 'very_low' || tier === 'low') {
    recommendations.push('Consider adding higher quality images for better accuracy')
    if (angleAnalysis.coverageGaps.length > 0) {
      recommendations.push(`Missing good coverage for: ${angleAnalysis.coverageGaps.join(', ')}`)
    }
  }

  return {
    overallConfidence,
    tier,
    factors,
    familyConfidences,
    explanation,
    warnings,
    recommendations,
  }
}

// ============================================================================
// FACTOR COMPUTATION
// ============================================================================

function computeVisibilityScore(
  analysis: MultiImageAngleAnalysis,
  explanation: string[]
): number {
  if (analysis.images.length === 0) return 0

  // Weighted average of effective weights
  const totalWeight = analysis.images.reduce((sum, img) => sum + img.effectiveWeight, 0)
  const avgWeight = totalWeight / analysis.images.length

  if (avgWeight >= 0.7) {
    explanation.push('Excellent angle visibility for measurements')
  } else if (avgWeight >= 0.5) {
    explanation.push('Good angle visibility for most measurements')
  } else {
    explanation.push('Limited angle visibility may affect accuracy')
  }

  return avgWeight
}

function computeCoverageScore(
  analysis: MultiImageAngleAnalysis,
  explanation: string[],
  warnings: string[]
): number {
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']
  let coveredCount = 0
  const MIN_COVERAGE = 0.4

  // Check if each family has adequate coverage
  const bestScores = {
    spread: analysis.bestImageForSpread !== null 
      ? analysis.images.find(i => i.imageIndex === analysis.bestImageForSpread)?.qualityAdjustedScores.spread || 0
      : 0,
    beam: analysis.bestImageForBeam !== null
      ? analysis.images.find(i => i.imageIndex === analysis.bestImageForBeam)?.qualityAdjustedScores.beam || 0
      : 0,
    tine: analysis.bestImageForTines !== null
      ? analysis.images.find(i => i.imageIndex === analysis.bestImageForTines)?.qualityAdjustedScores.tine || 0
      : 0,
    mass: analysis.bestImageForMass !== null
      ? analysis.images.find(i => i.imageIndex === analysis.bestImageForMass)?.qualityAdjustedScores.mass || 0
      : 0,
  }

  for (const family of families) {
    if (bestScores[family] >= MIN_COVERAGE) {
      coveredCount++
    } else {
      warnings.push(`${family.charAt(0).toUpperCase() + family.slice(1)} measurement may be less accurate`)
    }
  }

  const score = coveredCount / families.length

  if (score >= 0.75) {
    explanation.push('Good coverage across all measurement families')
  } else if (score >= 0.5) {
    explanation.push('Partial coverage of measurement families')
  }

  return score
}

function computeQualityScore(
  analysis: MultiImageAngleAnalysis,
  explanation: string[],
  warnings: string[]
): number {
  if (analysis.images.length === 0) return 0

  let totalQuality = 0
  let poorCount = 0

  for (const img of analysis.images) {
    const diag = img.diagnostics
    if (!diag) {
      totalQuality += 0.6 // Assume okay quality if no diagnostics
      continue
    }

    let quality = 1.0

    if (diag.overallQuality === 'poor') {
      quality = 0.3
      poorCount++
    } else if (diag.overallQuality === 'ok') {
      quality = 0.6
    }

    if (diag.likelyBlurry) quality *= 0.7
    if (diag.tooDark) quality *= 0.8
    if (diag.tooBright) quality *= 0.8
    if (diag.lowDetail) quality *= 0.9

    totalQuality += quality
  }

  const avgQuality = totalQuality / analysis.images.length

  if (poorCount > 0) {
    warnings.push(`${poorCount} image(s) have poor quality`)
  }

  if (avgQuality >= 0.8) {
    explanation.push('High quality images support accurate measurement')
  } else if (avgQuality < 0.5) {
    explanation.push('Image quality issues may affect accuracy')
  }

  return avgQuality
}

function computeMeasurementConsistency(
  measurements: Measurements,
  explanation: string[],
  warnings: string[]
): number {
  let consistencyScore = 1.0
  const issues: string[] = []

  // Check left/right symmetry (should be roughly similar)
  const checkSymmetry = (left: number | null, right: number | null, name: string) => {
    if (left === null || right === null || left === 0 || right === 0) return

    const ratio = Math.min(left, right) / Math.max(left, right)
    if (ratio < 0.6) {
      consistencyScore *= 0.9
      issues.push(`${name} asymmetry`)
    } else if (ratio < 0.75) {
      consistencyScore *= 0.95
    }
  }

  checkSymmetry(measurements.main_beam_left, measurements.main_beam_right, 'Beam')
  checkSymmetry(measurements.g1_left, measurements.g1_right, 'G1')
  checkSymmetry(measurements.g2_left, measurements.g2_right, 'G2')
  checkSymmetry(measurements.h1_left, measurements.h1_right, 'H1')
  checkSymmetry(measurements.h2_left, measurements.h2_right, 'H2')

  // Check anatomical plausibility
  if (measurements.inside_spread && measurements.main_beam_left && measurements.main_beam_right) {
    const avgBeam = (measurements.main_beam_left + measurements.main_beam_right) / 2
    // Spread should generally be less than beam length
    if (measurements.inside_spread > avgBeam * 1.3) {
      consistencyScore *= 0.9
      issues.push('Spread/beam ratio unusual')
    }
  }

  // Check tine ordering (G2 typically largest)
  const leftTines = [
    measurements.g1_left || 0,
    measurements.g2_left || 0,
    measurements.g3_left || 0,
    measurements.g4_left || 0,
  ].filter(t => t > 0)

  if (leftTines.length >= 2) {
    const maxTine = Math.max(...leftTines)
    const g2Value = measurements.g2_left || 0
    if (g2Value > 0 && maxTine > 0 && g2Value < maxTine * 0.7) {
      consistencyScore *= 0.95
      issues.push('Unusual tine proportions')
    }
  }

  if (issues.length > 0) {
    warnings.push(`Measurement consistency issues: ${issues.join(', ')}`)
  } else {
    explanation.push('Measurements show good internal consistency')
  }

  return consistencyScore
}

function computeFusionStability(
  familyInputs: FamilyConfidenceInput[],
  explanation: string[],
  warnings: string[]
): { fusionStability: number; outlierPenalty: number } {
  let totalVariance = 0
  let familiesWithMultipleSources = 0
  let outlierCount = 0

  for (const input of familyInputs) {
    if (input.values.length < 2) continue

    familiesWithMultipleSources++

    // Compute coefficient of variation
    const values = input.values.map(v => v.value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    if (mean === 0) continue

    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
    const cv = stdDev / mean

    totalVariance += cv

    // Check for outliers (values more than 2 std devs from mean)
    for (const v of values) {
      if (stdDev > 0 && Math.abs(v - mean) > 2 * stdDev) {
        outlierCount++
      }
    }
  }

  const avgVariance = familiesWithMultipleSources > 0 
    ? totalVariance / familiesWithMultipleSources 
    : 0

  const fusionStability = Math.max(0, 1 - avgVariance * 2)
  const outlierPenalty = Math.min(1, outlierCount * 0.15)

  if (fusionStability >= 0.8) {
    explanation.push('Stable fusion across all measurement sources')
  } else if (fusionStability < 0.5) {
    warnings.push('High variance in fused measurements')
  }

  if (outlierCount > 0) {
    warnings.push(`${outlierCount} outlier value(s) detected and down-weighted`)
  }

  return { fusionStability, outlierPenalty }
}

function computeHistoricalAccuracy(
  analysis: MultiImageAngleAnalysis,
  summaries: TrainingErrorSummary[] | undefined,
  explanation: string[]
): number {
  if (!summaries || summaries.length === 0) {
    return 0.7 // Default when no historical data
  }

  let expectedAccuracy = 1.0
  const dominantAngles = new Set(analysis.images.map(i => i.angleType))

  for (const summary of summaries) {
    if (summary.family === 'gross' || summary.family === 'net') continue
    if (summary.sampleCount < 10) continue

    // Check if our angles match historical patterns with high error
    for (const angle of dominantAngles) {
      const angleStats = summary.byAngle[angle]
      if (angleStats && angleStats.sampleCount >= 5) {
        // If this angle historically has high error for this family, reduce confidence
        if (angleStats.meanAbsError > 3) {
          expectedAccuracy *= 0.9
        } else if (angleStats.meanAbsError > 2) {
          expectedAccuracy *= 0.95
        }
      }
    }

    // Check quality tier
    const avgQuality = analysis.images.length > 0
      ? analysis.images.reduce((sum, img) => {
          const q = img.diagnostics?.overallQuality
          return sum + (q === 'good' ? 1 : q === 'ok' ? 0.6 : 0.3)
        }, 0) / analysis.images.length
      : 0.5

    const qualityTier = avgQuality >= 0.8 ? 'good' : avgQuality >= 0.5 ? 'ok' : 'poor'
    const qualityStats = summary.byQuality[qualityTier]
    if (qualityStats && qualityStats.sampleCount >= 5 && qualityStats.meanAbsError > 2.5) {
      expectedAccuracy *= 0.92
    }
  }

  if (expectedAccuracy >= 0.9) {
    explanation.push('Historical data suggests high accuracy for this input type')
  } else if (expectedAccuracy < 0.7) {
    explanation.push('Historical patterns indicate potential accuracy challenges')
  }

  return expectedAccuracy
}

// ============================================================================
// PER-FAMILY CONFIDENCE
// ============================================================================

function computeFamilyConfidences(
  analysis: MultiImageAngleAnalysis,
  familyInputs: FamilyConfidenceInput[],
  globalFactors: ConfidenceFactors
): Record<MeasurementFamily, number> {
  const confidences: Record<MeasurementFamily, number> = {
    spread: 50,
    beam: 50,
    tine: 50,
    mass: 50,
    deduction: 50,
  }

  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']

  for (const family of families) {
    // Get the best image for this family
    let bestScore = 0
    switch (family) {
      case 'spread':
        bestScore = analysis.bestImageForSpread !== null
          ? analysis.images.find(i => i.imageIndex === analysis.bestImageForSpread)?.qualityAdjustedScores.spread || 0
          : 0
        break
      case 'beam':
        bestScore = analysis.bestImageForBeam !== null
          ? analysis.images.find(i => i.imageIndex === analysis.bestImageForBeam)?.qualityAdjustedScores.beam || 0
          : 0
        break
      case 'tine':
        bestScore = analysis.bestImageForTines !== null
          ? analysis.images.find(i => i.imageIndex === analysis.bestImageForTines)?.qualityAdjustedScores.tine || 0
          : 0
        break
      case 'mass':
        bestScore = analysis.bestImageForMass !== null
          ? analysis.images.find(i => i.imageIndex === analysis.bestImageForMass)?.qualityAdjustedScores.mass || 0
          : 0
        break
    }

    // Get fusion input for this family
    const familyInput = familyInputs.find(f => f.family === family)
    const fusionConfidence = familyInput?.fusedConfidence || 0.5
    const sourceCount = familyInput?.values.length || 1

    // Compute family-specific confidence
    let familyConf = bestScore * 0.4 + fusionConfidence * 0.4 + globalFactors.crossViewAgreement * 0.2

    // Bonus for multiple sources
    if (sourceCount >= 2) familyConf += 0.1
    if (sourceCount >= 3) familyConf += 0.05

    // Apply global quality factor
    familyConf *= globalFactors.qualityScore

    // Scale to 0-100
    confidences[family] = Math.round(Math.max(15, Math.min(95, familyConf * 100)))
  }

  // Deduction confidence is based on overall visibility
  const avgEffectiveWeight = analysis.images.length > 0
    ? analysis.images.reduce((sum, img) => sum + img.effectiveWeight, 0) / analysis.images.length
    : 0.5
  confidences.deduction = Math.round(Math.max(15, Math.min(95, avgEffectiveWeight * 100)))

  return confidences
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get human-readable confidence explanation
 */
export function getConfidenceExplanation(result: ConfidenceResult): string {
  const parts: string[] = []

  parts.push(`Overall confidence: ${result.overallConfidence}% (${result.tier.replace('_', ' ')})`)

  if (result.explanation.length > 0) {
    parts.push('')
    parts.push('Positive factors:')
    for (const exp of result.explanation.slice(0, 3)) {
      parts.push(`  - ${exp}`)
    }
  }

  if (result.warnings.length > 0) {
    parts.push('')
    parts.push('Concerns:')
    for (const warn of result.warnings.slice(0, 3)) {
      parts.push(`  - ${warn}`)
    }
  }

  if (result.recommendations.length > 0) {
    parts.push('')
    parts.push('Recommendations:')
    for (const rec of result.recommendations.slice(0, 2)) {
      parts.push(`  - ${rec}`)
    }
  }

  return parts.join('\n')
}

/**
 * Get confidence color for UI display
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 85) return 'green'
  if (confidence >= 70) return 'blue'
  if (confidence >= 50) return 'yellow'
  if (confidence >= 30) return 'orange'
  return 'red'
}

/**
 * Check if confidence meets minimum threshold for reliable use
 */
export function meetsMinimumConfidence(
  result: ConfidenceResult,
  minConfidence: number = 40
): boolean {
  return result.overallConfidence >= minConfidence
}
