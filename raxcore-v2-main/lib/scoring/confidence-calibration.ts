/**
 * Confidence Recalibration Module (Phase 9)
 * 
 * Recalibrates confidence scores based on:
 * 1. Agreement between multiple images
 * 2. Landmark visibility and quality
 * 3. Variance between measurements
 * 4. Normalization adjustments made
 */

import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import type { NormalizationResult } from './normalization'
import type { LandmarkConsistencyResult } from './landmark-consistency'

export interface ConfidenceComponents {
  baseVisionConfidence: number
  imageAgreementBonus: number
  landmarkVisibilityBonus: number
  measurementVariancePenalty: number
  normalizationPenalty: number
  consistencyPenalty: number
  angleQualityBonus: number
}

export interface CalibratedConfidence {
  finalConfidence: number
  components: ConfidenceComponents
  explanation: string[]
  reliability: 'low' | 'medium' | 'high' | 'very_high'
}

// Weights for confidence components
const CONFIDENCE_WEIGHTS = {
  baseVision: 0.35,
  imageAgreement: 0.20,
  landmarkVisibility: 0.15,
  measurementVariance: 0.10,
  normalization: 0.10,
  consistency: 0.10,
} as const

/**
 * Calculate variance in measurements across multiple image sources
 */
export function calculateMeasurementVariance(
  measurementSources: Record<string, { value: number; confidence: number }[]>
): { variance: number; conflictCount: number; highVarianceFields: string[] } {
  let totalVariance = 0
  let conflictCount = 0
  const highVarianceFields: string[] = []
  let fieldCount = 0

  for (const [field, sources] of Object.entries(measurementSources)) {
    if (sources.length < 2) continue
    
    fieldCount++
    const values = sources.map(s => s.value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    
    // Calculate coefficient of variation (CV)
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
    const cv = mean > 0 ? variance / mean : 0

    totalVariance += cv

    // High variance threshold (>15% difference)
    if (cv > 0.15) {
      conflictCount++
      highVarianceFields.push(field)
    }
  }

  return {
    variance: fieldCount > 0 ? totalVariance / fieldCount : 0,
    conflictCount,
    highVarianceFields,
  }
}

/**
 * Calculate image agreement score
 */
export function calculateImageAgreement(
  angleTypes: AngleType[],
  measurementSources?: Record<string, { value: number; confidence: number }[]>
): { score: number; explanation: string } {
  // Check angle diversity
  const uniqueAngles = new Set(angleTypes)
  const hasMultipleAngles = uniqueAngles.size >= 2
  const hasGoodCoverage = 
    (uniqueAngles.has('front') || uniqueAngles.has('back')) &&
    (uniqueAngles.has('left') || uniqueAngles.has('right'))

  let score = 0
  let explanation = ''

  if (hasGoodCoverage) {
    score = 0.8
    explanation = 'Good angle coverage with complementary views.'
  } else if (hasMultipleAngles) {
    score = 0.6
    explanation = 'Multiple angles detected but coverage could be improved.'
  } else if (uniqueAngles.has('front')) {
    score = 0.5
    explanation = 'Single front view provides spread measurement.'
  } else if (uniqueAngles.has('left') || uniqueAngles.has('right')) {
    score = 0.45
    explanation = 'Single side view provides beam/tine measurement.'
  } else {
    score = 0.3
    explanation = 'Limited angle quality reduces measurement accuracy.'
  }

  // Adjust based on measurement variance if available
  if (measurementSources) {
    const { conflictCount } = calculateMeasurementVariance(measurementSources)
    if (conflictCount > 2) {
      score *= 0.8
      explanation += ' Multiple measurement conflicts detected.'
    } else if (conflictCount === 0 && hasMultipleAngles) {
      score = Math.min(1, score * 1.15)
      explanation += ' Strong agreement between images.'
    }
  }

  return { score, explanation }
}

/**
 * Calculate landmark visibility bonus
 */
export function calculateLandmarkBonus(landmarks: LandmarksDetected): {
  bonus: number
  explanation: string
} {
  let bonus = 0
  const parts: string[] = []

  if (landmarks.ears_visible) {
    bonus += 0.35
    parts.push('ears')
  }
  if (landmarks.eyes_visible) {
    bonus += 0.25
    parts.push('eyes')
  }
  if (landmarks.antlers_visible) {
    bonus += 0.20
    parts.push('full antlers')
  }

  // Bonus for specific measurements being available
  if (landmarks.ear_base_to_tip !== undefined) {
    bonus += 0.10
  }
  if (landmarks.eye_to_eye !== undefined) {
    bonus += 0.10
  }

  const explanation = parts.length > 0
    ? `Anatomical references: ${parts.join(', ')}.`
    : 'No clear anatomical landmarks detected.'

  return { bonus: Math.min(1, bonus), explanation }
}

/**
 * Recalibrate confidence based on all factors
 */
export function recalibrateConfidence(
  baseVisionConfidence: number,
  landmarks: LandmarksDetected,
  angleTypes: AngleType[],
  normalizationResult: NormalizationResult,
  consistencyResult: LandmarkConsistencyResult,
  measurementSources?: Record<string, { value: number; confidence: number }[]>
): CalibratedConfidence {
  const explanations: string[] = []

  // 1. Base vision confidence (0-100 scale, convert to 0-1)
  const baseComponent = Math.min(1, baseVisionConfidence / 100)

  // 2. Image agreement
  const agreement = calculateImageAgreement(angleTypes, measurementSources)
  const imageAgreementBonus = agreement.score
  explanations.push(agreement.explanation)

  // 3. Landmark visibility
  const landmarkBonus = calculateLandmarkBonus(landmarks)
  explanations.push(landmarkBonus.explanation)

  // 4. Measurement variance penalty
  let measurementVariancePenalty = 0
  if (measurementSources) {
    const { variance, highVarianceFields } = calculateMeasurementVariance(measurementSources)
    measurementVariancePenalty = Math.min(0.3, variance * 2)
    if (highVarianceFields.length > 0) {
      explanations.push(`High variance in: ${highVarianceFields.slice(0, 3).join(', ')}.`)
    }
  }

  // 5. Normalization penalty
  const normalizationPenalty = Math.min(0.25, 
    (normalizationResult.outlierCount * 0.08) + 
    (normalizationResult.ratioViolations.length * 0.04)
  )
  if (normalizationResult.outlierCount > 0) {
    explanations.push(`${normalizationResult.outlierCount} measurement(s) required normalization.`)
  }

  // 6. Consistency penalty
  const consistencyPenalty = Math.min(0.25, (1 - consistencyResult.consistencyScore) * 0.5)
  if (consistencyResult.issues.length > 0) {
    const majorIssues = consistencyResult.issues.filter(i => i.severity === 'major')
    if (majorIssues.length > 0) {
      explanations.push('Major landmark inconsistencies detected.')
    }
  }

  // 7. Angle quality bonus
  const uniqueAngles = new Set(angleTypes)
  let angleQualityBonus = 0
  if (uniqueAngles.size >= 3) {
    angleQualityBonus = 0.15
    explanations.push('Three or more viewing angles provide strong triangulation.')
  } else if (uniqueAngles.size === 2) {
    angleQualityBonus = 0.08
  }

  // Combine components
  const components: ConfidenceComponents = {
    baseVisionConfidence: baseComponent,
    imageAgreementBonus,
    landmarkVisibilityBonus: landmarkBonus.bonus,
    measurementVariancePenalty,
    normalizationPenalty,
    consistencyPenalty,
    angleQualityBonus,
  }

  // Calculate weighted final confidence
  let finalConfidence = 
    (baseComponent * CONFIDENCE_WEIGHTS.baseVision) +
    (imageAgreementBonus * CONFIDENCE_WEIGHTS.imageAgreement) +
    (landmarkBonus.bonus * CONFIDENCE_WEIGHTS.landmarkVisibility) -
    (measurementVariancePenalty * CONFIDENCE_WEIGHTS.measurementVariance) -
    (normalizationPenalty * CONFIDENCE_WEIGHTS.normalization) -
    (consistencyPenalty * CONFIDENCE_WEIGHTS.consistency) +
    (angleQualityBonus * 0.5) // Extra weight for angle quality

  // Normalize to 0-100 scale with bounds
  finalConfidence = Math.max(15, Math.min(95, finalConfidence * 100))

  // Determine reliability tier
  let reliability: CalibratedConfidence['reliability'] = 'low'
  if (finalConfidence >= 80) reliability = 'very_high'
  else if (finalConfidence >= 65) reliability = 'high'
  else if (finalConfidence >= 45) reliability = 'medium'

  return {
    finalConfidence: Math.round(finalConfidence),
    components,
    explanation: explanations,
    reliability,
  }
}

/**
 * Get a human-readable confidence breakdown
 */
export function getConfidenceBreakdown(result: CalibratedConfidence): string[] {
  const breakdown: string[] = []

  breakdown.push(`Base vision confidence: ${(result.components.baseVisionConfidence * 100).toFixed(0)}%`)
  breakdown.push(`Image agreement: ${(result.components.imageAgreementBonus * 100).toFixed(0)}%`)
  breakdown.push(`Landmark visibility: ${(result.components.landmarkVisibilityBonus * 100).toFixed(0)}%`)
  
  if (result.components.measurementVariancePenalty > 0) {
    breakdown.push(`Variance penalty: -${(result.components.measurementVariancePenalty * 100).toFixed(0)}%`)
  }
  if (result.components.normalizationPenalty > 0) {
    breakdown.push(`Normalization penalty: -${(result.components.normalizationPenalty * 100).toFixed(0)}%`)
  }
  if (result.components.consistencyPenalty > 0) {
    breakdown.push(`Consistency penalty: -${(result.components.consistencyPenalty * 100).toFixed(0)}%`)
  }
  if (result.components.angleQualityBonus > 0) {
    breakdown.push(`Multi-angle bonus: +${(result.components.angleQualityBonus * 100).toFixed(0)}%`)
  }

  return breakdown
}
