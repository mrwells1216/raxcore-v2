/**
 * Landmark Consistency Layer (Phase 9)
 * 
 * Enforces consistent scaling across anatomical landmarks:
 * - Ears (base-to-tip, tip-to-tip)
 * - Eyes (inter-pupillary distance)
 * - Skull proportions
 * 
 * If vision output conflicts with known anatomical ratios,
 * measurements are adjusted toward valid ranges and confidence is reduced.
 */

import type { Measurements, LandmarksDetected } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// Anatomical ratio bounds for whitetail deer
const DEER_ANATOMY = {
  // Ear measurements
  ear: {
    base_to_tip: { min: 5.5, max: 7.5, avg: ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP },
    tip_to_tip_alert: { min: 14, max: 19, avg: ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT },
    tip_to_tip_relaxed: { min: 12, max: 16, avg: ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_RELAXED },
  },
  // Eye measurements
  eye: {
    interocular: { min: 3.8, max: 5.0, avg: ANATOMICAL_REFERENCES.EYE_TO_EYE },
  },
  // Relationship ratios
  ratios: {
    // Spread is typically 1.0-1.4x ear tip-to-tip (alert)
    spread_to_ear_tip: { min: 0.85, max: 1.5, ideal: 1.15 },
    // Main beam is typically 3.5-4.5x ear length
    beam_to_ear: { min: 3.0, max: 5.0, ideal: 4.0 },
    // Inside spread is typically 2.5-4.0x eye distance
    spread_to_eye: { min: 3.0, max: 5.5, ideal: 4.2 },
  },
} as const

export interface LandmarkConsistencyResult {
  adjustedMeasurements: Measurements
  scalingFactor: number
  consistencyScore: number // 0-1, higher is better
  confidenceAdjustment: number // negative if inconsistencies found
  issues: LandmarkIssue[]
  landmarkQuality: 'poor' | 'fair' | 'good' | 'excellent'
}

export interface LandmarkIssue {
  type: 'ear_scaling' | 'eye_scaling' | 'ratio_violation' | 'missing_landmark'
  description: string
  severity: 'minor' | 'moderate' | 'major'
  adjustment?: {
    field: string
    original: number
    adjusted: number
  }
}

/**
 * Check landmark consistency and adjust measurements if needed
 */
export function checkLandmarkConsistency(
  measurements: Measurements,
  landmarks: LandmarksDetected,
  visionReportedEarLength?: number
): LandmarkConsistencyResult {
  const issues: LandmarkIssue[] = []
  let scalingFactor = 1.0
  let confidenceAdjustment = 0
  
  const adjusted: Measurements = { ...measurements }

  // 1. Check if we have usable landmarks
  if (!landmarks.ears_visible && !landmarks.eyes_visible) {
    issues.push({
      type: 'missing_landmark',
      description: 'No anatomical landmarks detected for scaling verification',
      severity: 'major',
    })
    confidenceAdjustment -= 10
  }

  // 2. Validate ear-based scaling
  if (landmarks.ears_visible && visionReportedEarLength) {
    const expectedEar = DEER_ANATOMY.ear.base_to_tip.avg
    const earRatio = visionReportedEarLength / expectedEar

    // If reported ear length differs significantly from expected
    if (earRatio < 0.7 || earRatio > 1.4) {
      // Vision is seeing the ear as significantly different from expected
      // This suggests a scaling error
      scalingFactor = expectedEar / visionReportedEarLength
      
      issues.push({
        type: 'ear_scaling',
        description: `Vision estimated ear as ${visionReportedEarLength.toFixed(1)}" vs expected ${expectedEar}". Scaling factor: ${scalingFactor.toFixed(2)}`,
        severity: earRatio < 0.5 || earRatio > 2.0 ? 'major' : 'moderate',
      })
      
      confidenceAdjustment -= earRatio < 0.5 || earRatio > 2.0 ? 12 : 6
    }
  }

  // 3. Check spread-to-ear-tip ratio if we have spread and ears visible
  if (landmarks.ears_visible && measurements.inside_spread !== null) {
    const earTipToTip = landmarks.ear_tip_to_tip ?? DEER_ANATOMY.ear.tip_to_tip_alert.avg
    const spreadToEarRatio = measurements.inside_spread / earTipToTip

    const { min, max } = DEER_ANATOMY.ratios.spread_to_ear_tip

    if (spreadToEarRatio < min) {
      // Spread seems too narrow relative to ear width
      const minSpread = earTipToTip * min
      issues.push({
        type: 'ratio_violation',
        description: `Spread (${measurements.inside_spread.toFixed(1)}") seems narrow relative to ear tip-to-tip (${earTipToTip.toFixed(1)}")`,
        severity: 'moderate',
        adjustment: { field: 'inside_spread', original: measurements.inside_spread, adjusted: minSpread },
      })
      // Gentle adjustment - average between reported and minimum expected
      adjusted.inside_spread = Number(((measurements.inside_spread + minSpread) / 2).toFixed(1))
      confidenceAdjustment -= 5
    } else if (spreadToEarRatio > max) {
      // Spread seems too wide relative to ear width
      const maxSpread = earTipToTip * max
      issues.push({
        type: 'ratio_violation',
        description: `Spread (${measurements.inside_spread.toFixed(1)}") seems wide relative to ear tip-to-tip (${earTipToTip.toFixed(1)}")`,
        severity: 'moderate',
        adjustment: { field: 'inside_spread', original: measurements.inside_spread, adjusted: maxSpread },
      })
      adjusted.inside_spread = Number(((measurements.inside_spread + maxSpread) / 2).toFixed(1))
      confidenceAdjustment -= 5
    }
  }

  // 4. Check beam-to-ear ratio
  if (landmarks.ears_visible) {
    const earLength = landmarks.ear_base_to_tip ?? DEER_ANATOMY.ear.base_to_tip.avg
    const avgBeam = ((measurements.main_beam_left ?? 0) + (measurements.main_beam_right ?? 0)) / 2

    if (avgBeam > 0) {
      const beamToEarRatio = avgBeam / earLength
      const { min, max } = DEER_ANATOMY.ratios.beam_to_ear

      if (beamToEarRatio < min) {
        issues.push({
          type: 'ratio_violation',
          description: `Main beams (avg ${avgBeam.toFixed(1)}") seem short relative to ear length (${earLength.toFixed(1)}")`,
          severity: 'moderate',
        })
        confidenceAdjustment -= 4
      } else if (beamToEarRatio > max) {
        issues.push({
          type: 'ratio_violation',
          description: `Main beams (avg ${avgBeam.toFixed(1)}") seem long relative to ear length (${earLength.toFixed(1)}")`,
          severity: 'moderate',
        })
        confidenceAdjustment -= 4
      }
    }
  }

  // 5. Check eye-based scaling if eyes visible
  if (landmarks.eyes_visible && measurements.inside_spread !== null) {
    const eyeDistance = landmarks.eye_to_eye ?? DEER_ANATOMY.eye.interocular.avg
    const spreadToEyeRatio = measurements.inside_spread / eyeDistance
    const { min, max } = DEER_ANATOMY.ratios.spread_to_eye

    if (spreadToEyeRatio < min || spreadToEyeRatio > max) {
      issues.push({
        type: 'eye_scaling',
        description: `Spread-to-eye ratio (${spreadToEyeRatio.toFixed(1)}) outside expected range (${min}-${max})`,
        severity: 'minor',
      })
      confidenceAdjustment -= 3
    }
  }

  // 6. Apply scaling factor if significant
  if (scalingFactor !== 1.0 && Math.abs(scalingFactor - 1.0) > 0.1) {
    // Apply scaling to all measurements (but cap the adjustment)
    const cappedScale = Math.max(0.7, Math.min(1.4, scalingFactor))
    
    const scaleFields: (keyof Measurements)[] = [
      'inside_spread', 'main_beam_left', 'main_beam_right',
      'g1_left', 'g1_right', 'g2_left', 'g2_right',
      'g3_left', 'g3_right', 'g4_left', 'g4_right',
      'g5_left', 'g5_right'
    ]

    for (const field of scaleFields) {
      const value = adjusted[field]
      if (typeof value === 'number' && value > 0) {
        // Blend: 70% original + 30% scaled (conservative adjustment)
        const scaled = value * cappedScale
        ;(adjusted as unknown as Record<string, number | null>)[field] = Number(
          (value * 0.7 + scaled * 0.3).toFixed(1)
        )
      }
    }
  }

  // 7. Calculate consistency score
  const majorIssues = issues.filter(i => i.severity === 'major').length
  const moderateIssues = issues.filter(i => i.severity === 'moderate').length
  const minorIssues = issues.filter(i => i.severity === 'minor').length

  const consistencyScore = Math.max(0, Math.min(1,
    1.0 - (majorIssues * 0.3) - (moderateIssues * 0.12) - (minorIssues * 0.05)
  ))

  // Determine landmark quality
  let landmarkQuality: LandmarkConsistencyResult['landmarkQuality'] = 'poor'
  if (consistencyScore >= 0.9 && landmarks.ears_visible && landmarks.eyes_visible) {
    landmarkQuality = 'excellent'
  } else if (consistencyScore >= 0.75 && (landmarks.ears_visible || landmarks.eyes_visible)) {
    landmarkQuality = 'good'
  } else if (consistencyScore >= 0.5) {
    landmarkQuality = 'fair'
  }

  return {
    adjustedMeasurements: adjusted,
    scalingFactor: scalingFactor !== 1.0 ? scalingFactor : 1.0,
    consistencyScore,
    confidenceAdjustment: Math.max(-25, confidenceAdjustment),
    issues,
    landmarkQuality,
  }
}

/**
 * Validate that landmarks are consistent with each other
 */
export function validateLandmarkConsistency(landmarks: LandmarksDetected): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  // Check ear measurements consistency
  if (landmarks.ear_base_to_tip !== undefined) {
    const { min, max } = DEER_ANATOMY.ear.base_to_tip
    if (landmarks.ear_base_to_tip < min || landmarks.ear_base_to_tip > max) {
      issues.push(`Ear base-to-tip (${landmarks.ear_base_to_tip}") outside normal range (${min}-${max})`)
    }
  }

  if (landmarks.ear_tip_to_tip !== undefined) {
    const alertMin = DEER_ANATOMY.ear.tip_to_tip_alert.min
    const alertMax = DEER_ANATOMY.ear.tip_to_tip_alert.max
    if (landmarks.ear_tip_to_tip < alertMin - 2 || landmarks.ear_tip_to_tip > alertMax + 2) {
      issues.push(`Ear tip-to-tip (${landmarks.ear_tip_to_tip}") outside normal range`)
    }
  }

  // Check eye measurement consistency
  if (landmarks.eye_to_eye !== undefined) {
    const { min, max } = DEER_ANATOMY.eye.interocular
    if (landmarks.eye_to_eye < min - 0.5 || landmarks.eye_to_eye > max + 0.5) {
      issues.push(`Eye-to-eye distance (${landmarks.eye_to_eye}") outside normal range (${min}-${max})`)
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * Get a summary string for landmark consistency
 */
export function getLandmarkConsistencySummary(result: LandmarkConsistencyResult): string {
  if (result.issues.length === 0) {
    return `Landmark consistency: ${result.landmarkQuality} (${(result.consistencyScore * 100).toFixed(0)}%)`
  }

  const summary = result.issues
    .slice(0, 2)
    .map(i => i.description)
    .join('; ')

  return `Landmark consistency: ${result.landmarkQuality}. ${summary}`
}
