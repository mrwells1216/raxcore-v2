/**
 * Multi-Image Fusion Module
 * 
 * Combines measurements from multiple images using weighted confidence.
 * Different angles are preferred for different measurement types:
 * - Side images (left/right): Best for beams and tines
 * - Front images: Best for spread and symmetry
 * - Multiple angles: Enables conflict resolution
 * 
 * Phase 49.5: Enhanced with cross-view conflict detection and trust-weighted fusion.
 * When views disagree, the system explains rather than averages.
 */

import type { 
  Measurements, 
  AngleType, 
  FusionResult,
  LandmarksDetected 
} from '@/lib/types'
import { 
  analyzesCrossViewConflicts, 
  conflictResultToMetadata,
  type CrossViewConflictResult,
  type CrossViewConflictInput 
} from './cross-view-conflict'

export interface ImageMeasurement {
  angleType: AngleType
  imageIndex: number
  measurements: Partial<Measurements>
  confidence: number
}

/** Phase 49.5: Extended fusion result with conflict analysis */
export interface EnhancedFusionResult extends FusionResult {
  /** Cross-view conflict analysis result */
  conflictAnalysis?: CrossViewConflictResult
  /** Metadata-friendly conflict summary */
  conflictMetadata?: ReturnType<typeof conflictResultToMetadata>
  /** Whether conflict-aware fusion was used */
  usedConflictAwareFusion: boolean
}

// Preferred angles for each measurement type
const ANGLE_PREFERENCES: Record<string, AngleType[]> = {
  // Spread is best measured from front
  inside_spread: ['front', 'back'],
  
  // Beams are best measured from side profiles
  main_beam_left: ['left', 'front'],
  main_beam_right: ['right', 'front'],
  
  // Tines are best from side views
  g1_left: ['left', 'front'],
  g1_right: ['right', 'front'],
  g2_left: ['left', 'front'],
  g2_right: ['right', 'front'],
  g3_left: ['left', 'front'],
  g3_right: ['right', 'front'],
  g4_left: ['left', 'front'],
  g4_right: ['right', 'front'],
  g5_left: ['left', 'front'],
  g5_right: ['right', 'front'],
  
  // Circumferences need side views
  h1_left: ['left', 'front'],
  h1_right: ['right', 'front'],
  h2_left: ['left'],
  h2_right: ['right'],
  h3_left: ['left'],
  h3_right: ['right'],
  h4_left: ['left'],
  h4_right: ['right'],
}

// Confidence boost for preferred angles
const PREFERRED_ANGLE_BOOST = 1.3
const SECONDARY_ANGLE_BOOST = 1.1

/**
 * Calculate angle-adjusted confidence for a measurement
 */
function getAngleAdjustedConfidence(
  measurementKey: string,
  angleType: AngleType,
  baseConfidence: number
): number {
  const preferred = ANGLE_PREFERENCES[measurementKey]
  if (!preferred) return baseConfidence

  if (preferred[0] === angleType) {
    return Math.min(1, baseConfidence * PREFERRED_ANGLE_BOOST)
  }
  if (preferred.includes(angleType)) {
    return Math.min(1, baseConfidence * SECONDARY_ANGLE_BOOST)
  }
  return baseConfidence * 0.8 // Non-preferred angle gets penalty
}

/**
 * Resolve conflicting measurements from multiple images using weighted confidence
 */
function resolveMeasurementConflict(
  values: { value: number; confidence: number; angle: AngleType; index: number }[]
): { value: number; confidence: number; conflictsResolved: boolean } {
  if (values.length === 0) {
    return { value: 0, confidence: 0, conflictsResolved: false }
  }
  
  if (values.length === 1) {
    return { 
      value: values[0].value, 
      confidence: values[0].confidence,
      conflictsResolved: false 
    }
  }

  // Check for significant conflicts (>15% difference)
  const minVal = Math.min(...values.map(v => v.value))
  const maxVal = Math.max(...values.map(v => v.value))
  const hasConflict = minVal > 0 && (maxVal - minVal) / minVal > 0.15

  // Weighted average using confidence^2 for stronger weighting
  let totalWeight = 0
  let weightedSum = 0
  let maxConfidence = 0

  for (const v of values) {
    const weight = v.confidence * v.confidence
    totalWeight += weight
    weightedSum += v.value * weight
    maxConfidence = Math.max(maxConfidence, v.confidence)
  }

  // Final confidence is boosted if multiple sources agree
  let finalConfidence = maxConfidence
  if (!hasConflict && values.length >= 2) {
    finalConfidence = Math.min(1, maxConfidence * 1.1)
  } else if (hasConflict) {
    finalConfidence = maxConfidence * 0.85 // Reduce confidence when there's conflict
  }

  return {
    value: totalWeight > 0 ? weightedSum / totalWeight : 0,
    confidence: finalConfidence,
    conflictsResolved: hasConflict,
  }
}

/**
 * Fuse measurements from multiple images
 */
export function fuseMeasurements(
  imageMeasurements: ImageMeasurement[],
  baseMeasurements: Measurements
): FusionResult {
  const measurementSources: FusionResult['measurement_sources'] = {}
  const fusedMeasurements = { ...baseMeasurements }
  let conflictsResolved = 0

  // Determine angle coverage
  const angleCoverage = {
    front: imageMeasurements.some(m => m.angleType === 'front'),
    left: imageMeasurements.some(m => m.angleType === 'left'),
    right: imageMeasurements.some(m => m.angleType === 'right'),
    back: imageMeasurements.some(m => m.angleType === 'back'),
  }

  // Process each measurement key
  const measurementKeys = Object.keys(baseMeasurements) as (keyof Measurements)[]
  
  for (const key of measurementKeys) {
    const values: { value: number; confidence: number; angle: AngleType; index: number }[] = []
    
    // Collect values from all images for this measurement
    for (const imgMeasurement of imageMeasurements) {
      const value = imgMeasurement.measurements[key]
      if (typeof value === 'number' && value > 0) {
        const adjustedConfidence = getAngleAdjustedConfidence(
          key,
          imgMeasurement.angleType,
          imgMeasurement.confidence
        )
        values.push({
          value,
          confidence: adjustedConfidence,
          angle: imgMeasurement.angleType,
          index: imgMeasurement.imageIndex,
        })
      }
    }

    // Store sources for this measurement
    measurementSources[key] = values.map(v => ({
      value: v.value,
      confidence: v.confidence,
      source_angle: v.angle,
      source_image_index: v.index,
    }))

    // Resolve conflicts if we have multiple values
    if (values.length > 1) {
      const resolved = resolveMeasurementConflict(values)
      ;(fusedMeasurements as Record<string, number | null>)[key] = Number(resolved.value.toFixed(1))
      if (resolved.conflictsResolved) conflictsResolved++
    } else if (values.length === 1) {
      ;(fusedMeasurements as Record<string, number | null>)[key] = Number(values[0].value.toFixed(1))
    }
    // If no values, keep base measurement
  }

  // Calculate fusion confidence based on coverage and conflict resolution
  const coverageScore = Object.values(angleCoverage).filter(Boolean).length / 4
  const conflictPenalty = conflictsResolved * 0.02
  const fusionConfidence = Math.min(1, Math.max(0.3, coverageScore * 0.8 + 0.2 - conflictPenalty))

  // Determine preferred angles for different measurement types
  const preferredAngles: FusionResult['preferred_angles'] = {
    beams: angleCoverage.left && angleCoverage.right ? ['left', 'right'] : 
           angleCoverage.left ? ['left'] : 
           angleCoverage.right ? ['right'] : ['front'],
    tines: angleCoverage.left && angleCoverage.right ? ['left', 'right'] : 
           angleCoverage.left ? ['left'] : 
           angleCoverage.right ? ['right'] : ['front'],
    spread: angleCoverage.front ? ['front'] : ['back'],
    symmetry: angleCoverage.front ? ['front'] : 
              angleCoverage.left && angleCoverage.right ? ['left', 'right'] : ['front'],
  }

  return {
    fused_measurements: fusedMeasurements,
    measurement_sources: measurementSources,
    conflicts_resolved: conflictsResolved,
    fusion_confidence: fusionConfidence,
    angle_coverage: angleCoverage,
    preferred_angles: preferredAngles,
  }
}

/**
 * Get fusion quality summary for UI display
 */
export function getFusionQualitySummary(result: FusionResult): {
  quality: 'poor' | 'fair' | 'good' | 'excellent'
  summary: string
  recommendations: string[]
} {
  const { angle_coverage, conflicts_resolved, fusion_confidence } = result
  const recommendations: string[] = []
  
  // Calculate coverage
  const coverageCount = Object.values(angle_coverage).filter(Boolean).length
  
  // Determine quality
  let quality: 'poor' | 'fair' | 'good' | 'excellent' = 'poor'
  if (fusion_confidence >= 0.8 && coverageCount >= 3) quality = 'excellent'
  else if (fusion_confidence >= 0.6 && coverageCount >= 2) quality = 'good'
  else if (fusion_confidence >= 0.4 || coverageCount >= 2) quality = 'fair'

  // Generate summary
  let summary = ''
  if (coverageCount === 1) {
    summary = 'Single-angle analysis. Measurements may be less accurate.'
  } else if (coverageCount === 2) {
    summary = 'Two angles captured. Good baseline accuracy.'
  } else if (coverageCount === 3) {
    summary = 'Three angles captured. Strong measurement confidence.'
  } else if (coverageCount === 4) {
    summary = 'Full angle coverage. Maximum measurement accuracy.'
  }

  if (conflicts_resolved > 0) {
    summary += ` Resolved ${conflicts_resolved} measurement conflict(s) between images.`
  }

  // Add recommendations
  if (!angle_coverage.front) {
    recommendations.push('Add a front photo for better spread and symmetry measurements.')
  }
  if (!angle_coverage.left) {
    recommendations.push('Add a left side photo for better left beam and tine measurements.')
  }
  if (!angle_coverage.right) {
    recommendations.push('Add a right side photo for better right beam and tine measurements.')
  }
  if (conflicts_resolved > 2) {
    recommendations.push('Multiple measurement conflicts detected. Ensure images show the same buck clearly.')
  }

  return { quality, summary, recommendations }
}

/**
 * Check if angle diversity is sufficient for reliable scoring
 */
export function hasMinimumAngleDiversity(
  angles: AngleType[]
): { sufficient: boolean; reason: string } {
  const unique = new Set(angles)
  const hasUsableAngles = unique.has('front') || unique.has('left') || unique.has('right')
  
  if (!hasUsableAngles) {
    return {
      sufficient: false,
      reason: 'No usable angles detected. Please provide front or side photos.',
    }
  }
  
  if (unique.size === 1 && !unique.has('front')) {
    return {
      sufficient: false,
      reason: 'Only one side angle detected. Add a front or opposite side photo for better accuracy.',
    }
  }

  return {
    sufficient: true,
    reason: unique.size >= 2 
      ? 'Multiple angles detected. Good measurement potential.'
      : 'Single angle detected. Accuracy is limited.',
  }
}

// ============================================================================
// PHASE 49.5: ENHANCED FUSION WITH CONFLICT ANALYSIS
// ============================================================================

export interface EnhancedFusionInput {
  imageMeasurements: ImageMeasurement[]
  baseMeasurements: Measurements
  /** Per-image landmark data for conflict analysis */
  perImageLandmarks?: {
    imageIndex: number
    angleType: AngleType
    landmarks: LandmarksDetected
    landmarkConfidence: number
    referenceQuality: number
  }[]
  /** Whether ears are fully visible */
  earsFullyVisible?: boolean
  /** Geometry consistency result (optional) */
  geometryConsistency?: import('./geometry-consistency').GeometryConsistencyResult | null
}

/**
 * Phase 49.5: Enhanced multi-image fusion with cross-view conflict detection
 * 
 * This function performs conflict-aware fusion that:
 * 1. Detects disagreement between views
 * 2. Classifies why disagreement occurs
 * 3. Assigns trust per view per measurement family
 * 4. Performs conflict-aware fusion instead of naive merging
 * 5. Flags disagreement for reverse-engineering (Phase 50)
 */
export function fuseMeasurementsWithConflictAnalysis(
  input: EnhancedFusionInput
): EnhancedFusionResult {
  const { imageMeasurements, baseMeasurements, perImageLandmarks, earsFullyVisible, geometryConsistency } = input

  // First perform basic fusion to get baseline
  const basicFusion = fuseMeasurements(imageMeasurements, baseMeasurements)

  // If we don't have sufficient data for conflict analysis, return basic fusion
  if (imageMeasurements.length < 2 || !perImageLandmarks || perImageLandmarks.length < 2) {
    return {
      ...basicFusion,
      usedConflictAwareFusion: false,
    }
  }

  // Prepare input for conflict analysis
  const conflictInput: CrossViewConflictInput = {
    imageMeasurements,
    baseMeasurements,
    perImageLandmarks,
    geometryConsistency,
    earsFullyVisible,
  }

  // Run cross-view conflict analysis
  const conflictAnalysis = analyzesCrossViewConflicts(conflictInput)
  const conflictMetadata = conflictResultToMetadata(conflictAnalysis)

  // Use conflict-aware fused measurements if available
  const fusedMeasurements = conflictAnalysis.fusedMeasurements

  // Recalculate fusion confidence based on conflict analysis
  const conflictPenalty = conflictAnalysis.conflictSummary.highDisagreementFamilies.length * 0.05
  const outlierPenalty = conflictAnalysis.rejectedViews.length * 0.03
  const adjustedFusionConfidence = Math.max(
    0.2,
    conflictAnalysis.conflictSummary.overallConfidence - conflictPenalty - outlierPenalty
  )

  // Rebuild measurement sources incorporating conflict data
  const measurementSources: FusionResult['measurement_sources'] = { ...basicFusion.measurement_sources }

  // Update conflicts resolved count based on conflict analysis
  const conflictsResolved = conflictAnalysis.conflictSummary.totalDisagreements

  return {
    fused_measurements: fusedMeasurements,
    measurement_sources: measurementSources,
    conflicts_resolved: conflictsResolved,
    fusion_confidence: adjustedFusionConfidence,
    angle_coverage: basicFusion.angle_coverage,
    preferred_angles: basicFusion.preferred_angles,
    conflictAnalysis,
    conflictMetadata,
    usedConflictAwareFusion: true,
  }
}

/**
 * Get extended fusion quality summary including conflict analysis
 */
export function getEnhancedFusionQualitySummary(result: EnhancedFusionResult): {
  quality: 'poor' | 'fair' | 'good' | 'excellent'
  summary: string
  recommendations: string[]
  conflictWarnings: string[]
  reverseEngineeringRecommended: boolean
} {
  const basicSummary = getFusionQualitySummary(result)
  const conflictWarnings: string[] = []
  let reverseEngineeringRecommended = false

  if (result.conflictAnalysis) {
    const conflict = result.conflictAnalysis

    // Add warnings for high disagreement
    for (const family of conflict.conflictSummary.highDisagreementFamilies) {
      const classification = conflict.disagreementClassifications.find(d => d.family === family)
      if (classification) {
        conflictWarnings.push(classification.explanation)
      }
    }

    // Add warnings for rejected views
    if (conflict.rejectedViews.length > 0) {
      conflictWarnings.push(
        `${conflict.rejectedViews.length} image(s) excluded as outliers: ${
          conflict.rejectedViews.map(v => `${v.angleType} (${v.reason})`).join(', ')
        }`
      )
    }

    // Check reverse engineering recommendation
    if (conflict.conflictSummary.reverseEngineeringRecommended) {
      reverseEngineeringRecommended = true
      conflictWarnings.push(
        `Reverse engineering recommended: ${conflict.conflictSummary.reverseEngineeringTriggerReasons.join('; ')}`
      )
    }

    // Adjust quality based on conflict severity
    let adjustedQuality = basicSummary.quality
    if (conflict.conflictSummary.highDisagreementFamilies.length >= 2) {
      if (adjustedQuality === 'excellent') adjustedQuality = 'good'
      else if (adjustedQuality === 'good') adjustedQuality = 'fair'
    }
    if (reverseEngineeringRecommended) {
      if (adjustedQuality === 'excellent') adjustedQuality = 'good'
      else if (adjustedQuality === 'good') adjustedQuality = 'fair'
      else if (adjustedQuality === 'fair') adjustedQuality = 'poor'
    }

    // Adjust summary
    let summary = basicSummary.summary
    if (conflict.conflictSummary.dominantViewUsed) {
      summary += ' Dominant view used for some measurements due to disagreement.'
    }

    return {
      quality: adjustedQuality,
      summary,
      recommendations: basicSummary.recommendations,
      conflictWarnings,
      reverseEngineeringRecommended,
    }
  }

  return {
    ...basicSummary,
    conflictWarnings,
    reverseEngineeringRecommended,
  }
}
