/**
 * Image Angle Scoring Module (Phase 60)
 * 
 * Scores each image's visibility and quality for specific measurement angles.
 * This enables the multi-view fusion engine to weight images appropriately
 * based on what each image can actually see well.
 * 
 * Key insight: A front view is great for spread but poor for beam length.
 * A side view is great for tines but poor for spread. This module quantifies that.
 */

import type { AngleType, LandmarksDetected, Measurements } from '@/lib/types'
import type { ImageDiagnostics } from './image-diagnostics'
import type { MeasurementFamily } from './cross-view-conflict'

// ============================================================================
// TYPES
// ============================================================================

export type AngleSuitability = 'excellent' | 'good' | 'fair' | 'poor' | 'unsuitable'

export interface AngleVisibilityScore {
  angle: AngleType
  spreadVisibility: number      // 0-1: How well can this angle see spread?
  beamVisibility: number        // 0-1: How well can this angle see beam length?
  tineVisibility: number        // 0-1: How well can this angle see tine lengths?
  massVisibility: number        // 0-1: How well can this angle see circumferences?
  overallSuitability: AngleSuitability
  explanation: string
}

export interface ImageAngleScore {
  imageIndex: number
  angleType: AngleType
  angleConfidence: number
  visibilityScores: AngleVisibilityScore
  qualityAdjustedScores: {
    spread: number
    beam: number
    tine: number
    mass: number
  }
  effectiveWeight: number       // Combined quality + visibility weight
  diagnostics: ImageDiagnostics | null
  landmarks: LandmarksDetected
  recommendations: string[]
}

export interface MultiImageAngleAnalysis {
  images: ImageAngleScore[]
  bestImageForSpread: number | null
  bestImageForBeam: number | null
  bestImageForTines: number | null
  bestImageForMass: number | null
  coverageQuality: 'excellent' | 'good' | 'fair' | 'poor'
  coverageGaps: MeasurementFamily[]
  recommendations: string[]
}

// ============================================================================
// ANGLE VISIBILITY MATRICES
// ============================================================================

/**
 * Base visibility scores for each angle type.
 * These represent the theoretical maximum visibility assuming perfect image quality.
 */
const ANGLE_VISIBILITY_MATRIX: Record<AngleType, {
  spread: number
  beam: number
  tine: number
  mass: number
}> = {
  front: {
    spread: 1.0,    // Front is ideal for inside spread
    beam: 0.4,      // Can see some beam but foreshortened
    tine: 0.5,      // Can see some tines but foreshortened
    mass: 0.6,      // Can see some circumference
  },
  left: {
    spread: 0.3,    // Can infer some spread but poor angle
    beam: 0.95,     // Excellent for left beam, okay for right
    tine: 0.9,      // Great for left tines
    mass: 0.7,      // Good for mass estimation
  },
  right: {
    spread: 0.3,    // Can infer some spread but poor angle
    beam: 0.95,     // Excellent for right beam, okay for left
    tine: 0.9,      // Great for right tines
    mass: 0.7,      // Good for mass estimation
  },
  back: {
    spread: 0.6,    // Can see spread from behind
    beam: 0.5,      // Can see beam curves
    tine: 0.4,      // Tines often obscured
    mass: 0.5,      // Moderate mass visibility
  },
  other: {
    spread: 0.3,
    beam: 0.3,
    tine: 0.3,
    mass: 0.3,
  },
}

/**
 * Landmark-based visibility adjustments.
 * If key landmarks are visible, we can be more confident in measurements.
 */
const LANDMARK_VISIBILITY_BOOST: Record<keyof LandmarksDetected, {
  spread: number
  beam: number
  tine: number
  mass: number
}> = {
  ears_visible: {
    spread: 0.15,   // Ears help calibrate spread
    beam: 0.05,
    tine: 0.05,
    mass: 0.10,
  },
  eyes_visible: {
    spread: 0.10,
    beam: 0.05,
    tine: 0.05,
    mass: 0.05,
  },
  antlers_visible: {
    spread: 0.10,
    beam: 0.15,
    tine: 0.20,
    mass: 0.15,
  },
  ear_base_to_tip: {
    spread: 0.10,
    beam: 0.05,
    tine: 0.05,
    mass: 0.10,
  },
  eye_to_eye: {
    spread: 0.10,
    beam: 0.05,
    tine: 0.05,
    mass: 0.05,
  },
}

// ============================================================================
// CORE SCORING FUNCTIONS
// ============================================================================

/**
 * Score a single image for its angle-specific visibility
 */
export function scoreImageForAngle(
  imageIndex: number,
  angleType: AngleType,
  angleConfidence: number,
  landmarks: LandmarksDetected,
  diagnostics: ImageDiagnostics | null,
  measurements?: Partial<Measurements>
): ImageAngleScore {
  const recommendations: string[] = []

  // 1. Get base visibility scores for this angle
  const baseScores = ANGLE_VISIBILITY_MATRIX[angleType] || ANGLE_VISIBILITY_MATRIX.other

  // 2. Apply landmark visibility boosts
  let spreadBoost = 0
  let beamBoost = 0
  let tineBoost = 0
  let massBoost = 0

  if (landmarks.ears_visible) {
    spreadBoost += LANDMARK_VISIBILITY_BOOST.ears_visible.spread
    beamBoost += LANDMARK_VISIBILITY_BOOST.ears_visible.beam
    tineBoost += LANDMARK_VISIBILITY_BOOST.ears_visible.tine
    massBoost += LANDMARK_VISIBILITY_BOOST.ears_visible.mass
  }
  if (landmarks.eyes_visible) {
    spreadBoost += LANDMARK_VISIBILITY_BOOST.eyes_visible.spread
    beamBoost += LANDMARK_VISIBILITY_BOOST.eyes_visible.beam
    tineBoost += LANDMARK_VISIBILITY_BOOST.eyes_visible.tine
    massBoost += LANDMARK_VISIBILITY_BOOST.eyes_visible.mass
  }
  if (landmarks.antlers_visible) {
    spreadBoost += LANDMARK_VISIBILITY_BOOST.antlers_visible.spread
    beamBoost += LANDMARK_VISIBILITY_BOOST.antlers_visible.beam
    tineBoost += LANDMARK_VISIBILITY_BOOST.antlers_visible.tine
    massBoost += LANDMARK_VISIBILITY_BOOST.antlers_visible.mass
  }
  if (landmarks.ear_base_to_tip !== undefined) {
    spreadBoost += LANDMARK_VISIBILITY_BOOST.ear_base_to_tip.spread
    massBoost += LANDMARK_VISIBILITY_BOOST.ear_base_to_tip.mass
  }
  if (landmarks.eye_to_eye !== undefined) {
    spreadBoost += LANDMARK_VISIBILITY_BOOST.eye_to_eye.spread
  }

  // Compute visibility scores (capped at 1.0)
  const spreadVisibility = Math.min(1.0, baseScores.spread + spreadBoost)
  const beamVisibility = Math.min(1.0, baseScores.beam + beamBoost)
  const tineVisibility = Math.min(1.0, baseScores.tine + tineBoost)
  const massVisibility = Math.min(1.0, baseScores.mass + massBoost)

  // 3. Determine overall suitability
  const avgVisibility = (spreadVisibility + beamVisibility + tineVisibility + massVisibility) / 4
  let overallSuitability: AngleSuitability = 'fair'
  if (avgVisibility >= 0.8) overallSuitability = 'excellent'
  else if (avgVisibility >= 0.65) overallSuitability = 'good'
  else if (avgVisibility >= 0.45) overallSuitability = 'fair'
  else if (avgVisibility >= 0.25) overallSuitability = 'poor'
  else overallSuitability = 'unsuitable'

  // 4. Generate explanation
  let explanation = `${angleType} view`
  if (angleType === 'front') {
    explanation += ' is excellent for spread measurement'
    if (beamVisibility < 0.5) {
      recommendations.push('Add a side view for better beam/tine accuracy')
    }
  } else if (angleType === 'left' || angleType === 'right') {
    explanation += ` is excellent for ${angleType} beam and tine measurements`
    if (spreadVisibility < 0.5) {
      recommendations.push('Add a front view for better spread accuracy')
    }
  } else if (angleType === 'back') {
    explanation += ' provides supplementary information'
    recommendations.push('Front or side views provide more accurate measurements')
  }

  // 5. Compute quality-adjusted scores
  let qualityMultiplier = 1.0
  if (diagnostics) {
    if (diagnostics.overallQuality === 'poor') {
      qualityMultiplier = 0.5
      recommendations.push('Image quality is poor - measurements may be less accurate')
    } else if (diagnostics.overallQuality === 'ok') {
      qualityMultiplier = 0.75
    }
    
    if (diagnostics.likelyBlurry) {
      qualityMultiplier *= 0.7
      recommendations.push('Image appears blurry')
    }
    if (diagnostics.tooDark) {
      qualityMultiplier *= 0.8
      recommendations.push('Image is too dark')
    }
    if (diagnostics.tooBright) {
      qualityMultiplier *= 0.8
      recommendations.push('Image is overexposed')
    }
  }

  // Apply angle confidence
  const confidenceMultiplier = Math.max(0.3, angleConfidence)

  const qualityAdjustedScores = {
    spread: spreadVisibility * qualityMultiplier * confidenceMultiplier,
    beam: beamVisibility * qualityMultiplier * confidenceMultiplier,
    tine: tineVisibility * qualityMultiplier * confidenceMultiplier,
    mass: massVisibility * qualityMultiplier * confidenceMultiplier,
  }

  // 6. Compute effective weight (geometric mean of quality-adjusted scores)
  const effectiveWeight = Math.pow(
    qualityAdjustedScores.spread * 
    qualityAdjustedScores.beam * 
    qualityAdjustedScores.tine * 
    qualityAdjustedScores.mass,
    0.25
  )

  // 7. Check if measurements exist and add bonus context
  if (measurements) {
    const hasSpread = measurements.inside_spread !== undefined && measurements.inside_spread !== null
    const hasBeams = (measurements.main_beam_left !== undefined && measurements.main_beam_left !== null) ||
                     (measurements.main_beam_right !== undefined && measurements.main_beam_right !== null)
    
    if (hasSpread && spreadVisibility < 0.5) {
      recommendations.push('Spread measurement from poor angle may be less reliable')
    }
    if (hasBeams && beamVisibility < 0.5) {
      recommendations.push('Beam measurement from poor angle may be less reliable')
    }
  }

  return {
    imageIndex,
    angleType,
    angleConfidence,
    visibilityScores: {
      angle: angleType,
      spreadVisibility,
      beamVisibility,
      tineVisibility,
      massVisibility,
      overallSuitability,
      explanation,
    },
    qualityAdjustedScores,
    effectiveWeight,
    diagnostics,
    landmarks,
    recommendations,
  }
}

/**
 * Analyze multiple images to determine which is best for each measurement family
 */
export function analyzeMultiImageAngles(
  images: Array<{
    index: number
    angleType: AngleType
    angleConfidence: number
    landmarks: LandmarksDetected
    diagnostics: ImageDiagnostics | null
    measurements?: Partial<Measurements>
  }>
): MultiImageAngleAnalysis {
  const recommendations: string[] = []

  // Score each image
  const scoredImages = images.map(img => 
    scoreImageForAngle(
      img.index,
      img.angleType,
      img.angleConfidence,
      img.landmarks,
      img.diagnostics,
      img.measurements
    )
  )

  // Find best image for each measurement family
  let bestImageForSpread: number | null = null
  let bestSpreadScore = 0
  
  let bestImageForBeam: number | null = null
  let bestBeamScore = 0
  
  let bestImageForTines: number | null = null
  let bestTineScore = 0
  
  let bestImageForMass: number | null = null
  let bestMassScore = 0

  for (const img of scoredImages) {
    if (img.qualityAdjustedScores.spread > bestSpreadScore) {
      bestSpreadScore = img.qualityAdjustedScores.spread
      bestImageForSpread = img.imageIndex
    }
    if (img.qualityAdjustedScores.beam > bestBeamScore) {
      bestBeamScore = img.qualityAdjustedScores.beam
      bestImageForBeam = img.imageIndex
    }
    if (img.qualityAdjustedScores.tine > bestTineScore) {
      bestTineScore = img.qualityAdjustedScores.tine
      bestImageForTines = img.imageIndex
    }
    if (img.qualityAdjustedScores.mass > bestMassScore) {
      bestMassScore = img.qualityAdjustedScores.mass
      bestImageForMass = img.imageIndex
    }
  }

  // Identify coverage gaps
  const coverageGaps: MeasurementFamily[] = []
  const MINIMUM_COVERAGE_THRESHOLD = 0.4

  if (bestSpreadScore < MINIMUM_COVERAGE_THRESHOLD) {
    coverageGaps.push('spread')
    recommendations.push('Add a front-facing image for better spread measurement')
  }
  if (bestBeamScore < MINIMUM_COVERAGE_THRESHOLD) {
    coverageGaps.push('beam')
    recommendations.push('Add a side-facing image for better beam measurement')
  }
  if (bestTineScore < MINIMUM_COVERAGE_THRESHOLD) {
    coverageGaps.push('tine')
    recommendations.push('Add a side-facing image for better tine measurement')
  }
  if (bestMassScore < MINIMUM_COVERAGE_THRESHOLD) {
    coverageGaps.push('mass')
    recommendations.push('Add clearer images for better mass estimation')
  }

  // Determine overall coverage quality
  const avgBestScores = (bestSpreadScore + bestBeamScore + bestTineScore + bestMassScore) / 4
  let coverageQuality: 'excellent' | 'good' | 'fair' | 'poor' = 'fair'
  
  if (avgBestScores >= 0.8 && coverageGaps.length === 0) {
    coverageQuality = 'excellent'
  } else if (avgBestScores >= 0.6 && coverageGaps.length <= 1) {
    coverageQuality = 'good'
  } else if (avgBestScores >= 0.4 || coverageGaps.length <= 2) {
    coverageQuality = 'fair'
  } else {
    coverageQuality = 'poor'
  }

  // Check angle diversity
  const uniqueAngles = new Set(images.map(img => img.angleType))
  if (uniqueAngles.size === 1) {
    recommendations.push('Single angle view limits accuracy - add different angles for better results')
  } else if (!uniqueAngles.has('front') && !uniqueAngles.has('back')) {
    recommendations.push('No front-facing view - spread measurement may be less accurate')
  } else if (!uniqueAngles.has('left') && !uniqueAngles.has('right')) {
    recommendations.push('No side views - beam and tine measurements may be less accurate')
  }

  return {
    images: scoredImages,
    bestImageForSpread,
    bestImageForBeam,
    bestImageForTines,
    bestImageForMass,
    coverageQuality,
    coverageGaps,
    recommendations,
  }
}

/**
 * Get the weight a specific image should have for a measurement family
 */
export function getImageWeightForFamily(
  imageScore: ImageAngleScore,
  family: MeasurementFamily
): number {
  switch (family) {
    case 'spread':
      return imageScore.qualityAdjustedScores.spread
    case 'beam':
      return imageScore.qualityAdjustedScores.beam
    case 'tine':
      return imageScore.qualityAdjustedScores.tine
    case 'mass':
      return imageScore.qualityAdjustedScores.mass
    case 'deduction':
      // Deductions benefit from multiple views equally
      return imageScore.effectiveWeight
    default:
      return imageScore.effectiveWeight
  }
}

/**
 * Compute weighted fusion for a measurement family across multiple images
 */
export function computeWeightedFusionForFamily(
  imageScores: ImageAngleScore[],
  family: MeasurementFamily,
  values: Array<{ imageIndex: number; value: number; confidence: number }>
): { fusedValue: number; fusedConfidence: number; primaryImageIndex: number } {
  if (values.length === 0) {
    return { fusedValue: 0, fusedConfidence: 0, primaryImageIndex: -1 }
  }

  if (values.length === 1) {
    const imageScore = imageScores.find(s => s.imageIndex === values[0].imageIndex)
    const weight = imageScore ? getImageWeightForFamily(imageScore, family) : 0.5
    return {
      fusedValue: values[0].value,
      fusedConfidence: values[0].confidence * weight,
      primaryImageIndex: values[0].imageIndex,
    }
  }

  // Compute weighted average
  let weightedSum = 0
  let totalWeight = 0
  let maxWeight = 0
  let primaryImageIndex = values[0].imageIndex

  for (const v of values) {
    const imageScore = imageScores.find(s => s.imageIndex === v.imageIndex)
    const familyWeight = imageScore ? getImageWeightForFamily(imageScore, family) : 0.3
    const combinedWeight = familyWeight * v.confidence

    weightedSum += v.value * combinedWeight
    totalWeight += combinedWeight

    if (combinedWeight > maxWeight) {
      maxWeight = combinedWeight
      primaryImageIndex = v.imageIndex
    }
  }

  const fusedValue = totalWeight > 0 ? weightedSum / totalWeight : values[0].value
  
  // Confidence increases with agreement and number of sources
  const avgConfidence = values.reduce((sum, v) => sum + v.confidence, 0) / values.length
  const valueVariance = computeValueVariance(values.map(v => v.value))
  const agreementBonus = Math.max(0, 1 - valueVariance) * 0.2
  const multiSourceBonus = Math.min(0.15, (values.length - 1) * 0.05)
  
  const fusedConfidence = Math.min(1.0, avgConfidence + agreementBonus + multiSourceBonus)

  return { fusedValue, fusedConfidence, primaryImageIndex }
}

/**
 * Compute coefficient of variation for a set of values
 */
function computeValueVariance(values: number[]): number {
  if (values.length < 2) return 0

  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0

  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
  
  return variance / mean // Coefficient of variation
}
