/**
 * Enhanced Landmark Detection & Estimation Module
 * 
 * Note: This is an estimation layer, NOT true computer vision landmark detection.
 * When true CV models are available, this module should be replaced with actual
 * neural network-based landmark detection.
 */

import type { 
  LandmarkPoint, 
  DetailedLandmarks, 
  AngleType,
  LandmarksDetected 
} from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

export interface ImageForLandmarkDetection {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
  index: number
}

/**
 * Estimate landmark positions based on image angle and metadata.
 * This is a procedural estimation - NOT real CV detection.
 */
export function estimateLandmarks(
  images: ImageForLandmarkDetection[],
  earsFullyVisible: boolean,
  mainFramePoints?: number
): DetailedLandmarks {
  const landmarks: Partial<DetailedLandmarks> = {}
  let detectedCount = 0
  const totalPossible = 32 // 16 landmark points * 2 (base + tip for most)

  // Process each image based on its angle
  for (const image of images) {
    const { angleType, index } = image
    
    switch (angleType) {
      case 'front':
        // Front images are good for: ears, eyes, spread estimation
        if (earsFullyVisible) {
          landmarks.ear_base_left = createLandmarkPoint(0.25, 0.2, 0.8, index)
          landmarks.ear_base_right = createLandmarkPoint(0.75, 0.2, 0.8, index)
          landmarks.ear_tip_left = createLandmarkPoint(0.2, 0.1, 0.75, index)
          landmarks.ear_tip_right = createLandmarkPoint(0.8, 0.1, 0.75, index)
          detectedCount += 4
        }
        landmarks.eye_center_left = createLandmarkPoint(0.35, 0.35, 0.85, index)
        landmarks.eye_center_right = createLandmarkPoint(0.65, 0.35, 0.85, index)
        landmarks.burr_left = createLandmarkPoint(0.3, 0.15, 0.7, index)
        landmarks.burr_right = createLandmarkPoint(0.7, 0.15, 0.7, index)
        detectedCount += 4
        break

      case 'left':
        // Left side images: good for left beam, left tines
        landmarks.beam_start_left = createLandmarkPoint(0.4, 0.2, 0.8, index)
        landmarks.beam_mid_left = createLandmarkPoint(0.3, 0.3, 0.75, index)
        landmarks.beam_tip_left = createLandmarkPoint(0.2, 0.5, 0.7, index)
        detectedCount += 3

        // Tine landmarks from left side
        if (mainFramePoints && mainFramePoints >= 8) {
          landmarks.g1_base_left = createLandmarkPoint(0.38, 0.22, 0.7, index)
          landmarks.g1_tip_left = createLandmarkPoint(0.35, 0.15, 0.65, index)
          landmarks.g2_base_left = createLandmarkPoint(0.32, 0.28, 0.75, index)
          landmarks.g2_tip_left = createLandmarkPoint(0.28, 0.12, 0.7, index)
          landmarks.g3_base_left = createLandmarkPoint(0.28, 0.35, 0.7, index)
          landmarks.g3_tip_left = createLandmarkPoint(0.24, 0.18, 0.65, index)
          detectedCount += 6
          
          if (mainFramePoints >= 10) {
            landmarks.g4_base_left = createLandmarkPoint(0.24, 0.42, 0.65, index)
            landmarks.g4_tip_left = createLandmarkPoint(0.2, 0.28, 0.6, index)
            detectedCount += 2
          }
        }
        break

      case 'right':
        // Right side images: good for right beam, right tines
        landmarks.beam_start_right = createLandmarkPoint(0.6, 0.2, 0.8, index)
        landmarks.beam_mid_right = createLandmarkPoint(0.7, 0.3, 0.75, index)
        landmarks.beam_tip_right = createLandmarkPoint(0.8, 0.5, 0.7, index)
        detectedCount += 3

        // Tine landmarks from right side
        if (mainFramePoints && mainFramePoints >= 8) {
          landmarks.g1_base_right = createLandmarkPoint(0.62, 0.22, 0.7, index)
          landmarks.g1_tip_right = createLandmarkPoint(0.65, 0.15, 0.65, index)
          landmarks.g2_base_right = createLandmarkPoint(0.68, 0.28, 0.75, index)
          landmarks.g2_tip_right = createLandmarkPoint(0.72, 0.12, 0.7, index)
          landmarks.g3_base_right = createLandmarkPoint(0.72, 0.35, 0.7, index)
          landmarks.g3_tip_right = createLandmarkPoint(0.76, 0.18, 0.65, index)
          detectedCount += 6
          
          if (mainFramePoints >= 10) {
            landmarks.g4_base_right = createLandmarkPoint(0.76, 0.42, 0.65, index)
            landmarks.g4_tip_right = createLandmarkPoint(0.8, 0.28, 0.6, index)
            detectedCount += 2
          }
        }
        break

      case 'back':
        // Back images: useful for beam curvature, overall symmetry
        landmarks.beam_tip_left = createLandmarkPoint(0.2, 0.4, 0.6, index)
        landmarks.beam_tip_right = createLandmarkPoint(0.8, 0.4, 0.6, index)
        detectedCount += 2
        break
    }
  }

  // Calculate anatomical reference distances if we have the landmarks
  if (landmarks.ear_base_left && landmarks.ear_tip_left) {
    landmarks.estimated_ear_base_to_tip = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
  }
  if (landmarks.eye_center_left && landmarks.eye_center_right) {
    landmarks.estimated_eye_to_eye = ANATOMICAL_REFERENCES.EYE_TO_EYE
  }
  if (landmarks.ear_tip_left && landmarks.ear_tip_right) {
    landmarks.estimated_ear_tip_to_tip = ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT
  }

  // Determine overall quality
  const coverage = detectedCount / totalPossible
  let overallQuality: DetailedLandmarks['overall_quality'] = 'poor'
  if (coverage >= 0.7) overallQuality = 'excellent'
  else if (coverage >= 0.5) overallQuality = 'good'
  else if (coverage >= 0.3) overallQuality = 'fair'

  return {
    ...landmarks,
    overall_quality: overallQuality,
    detected_landmark_count: detectedCount,
    total_possible_landmarks: totalPossible,
  } as DetailedLandmarks
}

/**
 * Convert detailed landmarks to the simpler LandmarksDetected format
 * for backward compatibility
 */
export function detailedToSimpleLandmarks(detailed: DetailedLandmarks): LandmarksDetected {
  return {
    ears_visible: !!(detailed.ear_base_left || detailed.ear_base_right),
    eyes_visible: !!(detailed.eye_center_left || detailed.eye_center_right),
    antlers_visible: !!(detailed.beam_start_left || detailed.beam_start_right),
    ear_base_to_tip: detailed.estimated_ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
    eye_to_eye: detailed.estimated_eye_to_eye || ANATOMICAL_REFERENCES.EYE_TO_EYE,
    ear_tip_to_tip: detailed.estimated_ear_tip_to_tip || ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT,
    quality_notes: [
      `Landmark quality: ${detailed.overall_quality}`,
      `Detected ${detailed.detected_landmark_count} of ${detailed.total_possible_landmarks} possible landmarks`,
    ],
  }
}

/**
 * Helper to create a landmark point
 */
function createLandmarkPoint(
  x: number,
  y: number,
  confidence: number,
  sourceImageIndex: number
): LandmarkPoint {
  return {
    x,
    y,
    confidence,
    source_image_index: sourceImageIndex,
  }
}

/**
 * Calculate landmark stability score across multiple images
 * Higher score = more consistent landmark positions across images
 */
export function calculateLandmarkStability(
  landmarks: DetailedLandmarks,
  imageCount: number
): number {
  if (imageCount <= 1) return 0.5 // Single image = baseline stability

  const detectionRatio = landmarks.detected_landmark_count / landmarks.total_possible_landmarks
  
  // Stability increases with more landmarks detected
  let stability = detectionRatio * 0.7

  // Bonus for having symmetric landmarks (both left and right)
  const hasSymmetricEars = !!(landmarks.ear_base_left && landmarks.ear_base_right)
  const hasSymmetricEyes = !!(landmarks.eye_center_left && landmarks.eye_center_right)
  const hasSymmetricBeams = !!(landmarks.beam_start_left && landmarks.beam_start_right)
  
  if (hasSymmetricEars) stability += 0.1
  if (hasSymmetricEyes) stability += 0.1
  if (hasSymmetricBeams) stability += 0.1

  return Math.min(stability, 1)
}

/**
 * Get recommended landmark detection improvements based on current state
 */
export function getLandmarkRecommendations(
  landmarks: DetailedLandmarks,
  hasAngle: { front: boolean; left: boolean; right: boolean; back: boolean }
): string[] {
  const recommendations: string[] = []

  if (!hasAngle.front) {
    recommendations.push('Add a front-facing photo to improve ear and eye landmark detection.')
  }
  if (!hasAngle.left && !hasAngle.right) {
    recommendations.push('Add side profile photos to improve beam and tine measurements.')
  }
  if (landmarks.overall_quality === 'poor') {
    recommendations.push('Image quality is low. Use well-lit, clear photos for better landmark detection.')
  }
  if (!landmarks.ear_base_left && !landmarks.ear_base_right) {
    recommendations.push('Ears are not clearly visible. This limits anatomical scaling accuracy.')
  }

  return recommendations
}

// ============================================================================
// PHASE 42: ENHANCED LANDMARK QUALITY TRACKING
// ============================================================================

import type { 
  EnhancedLandmarkData, 
  LandmarkQualityTier 
} from '@/lib/types'

export interface EnhancedLandmarkInput {
  images: ImageForLandmarkDetection[]
  earsFullyVisible?: boolean
  mainFramePoints?: number
  visionLandmarks?: {
    ears_visible?: boolean
    eyes_visible?: boolean
    antlers_visible?: boolean
    ear_base_to_tip_estimated?: number
  }
}

/**
 * Phase 42: Compute enhanced landmark data with per-landmark quality tracking
 */
export function computeEnhancedLandmarks(
  input: EnhancedLandmarkInput
): EnhancedLandmarkData {
  const { images, earsFullyVisible, mainFramePoints, visionLandmarks } = input
  
  // Analyze angle coverage
  const angles = images.map(img => img.angleType)
  const hasFront = angles.includes('front')
  const hasLeft = angles.includes('left')
  const hasRight = angles.includes('right')
  const hasBothSides = hasLeft && hasRight
  
  // Determine best images
  const frontIndex = angles.indexOf('front')
  const leftIndex = angles.indexOf('left')
  const rightIndex = angles.indexOf('right')
  const bestSideImages = [leftIndex, rightIndex].filter(i => i >= 0)
  
  // Ear quality assessment
  let earBaseQuality: LandmarkQualityTier = 'missing'
  let earTipQuality: LandmarkQualityTier = 'missing'
  let earBaseConfidence = 0
  let earTipConfidence = 0
  
  if (visionLandmarks?.ears_visible || earsFullyVisible) {
    if (earsFullyVisible && hasFront) {
      earBaseQuality = 'excellent'
      earTipQuality = 'excellent'
      earBaseConfidence = 0.95
      earTipConfidence = 0.92
    } else if (earsFullyVisible) {
      earBaseQuality = 'good'
      earTipQuality = 'good'
      earBaseConfidence = 0.8
      earTipConfidence = 0.78
    } else if (hasFront) {
      earBaseQuality = 'fair'
      earTipQuality = 'fair'
      earBaseConfidence = 0.6
      earTipConfidence = 0.55
    } else {
      earBaseQuality = 'poor'
      earTipQuality = 'poor'
      earBaseConfidence = 0.35
      earTipConfidence = 0.3
    }
  }
  
  // Eye quality assessment
  let eyeQuality: LandmarkQualityTier = 'missing'
  let eyeConfidence = 0
  
  if (visionLandmarks?.eyes_visible) {
    if (hasFront) {
      eyeQuality = 'excellent'
      eyeConfidence = 0.9
    } else if (hasLeft || hasRight) {
      eyeQuality = 'fair'
      eyeConfidence = 0.5
    } else {
      eyeQuality = 'poor'
      eyeConfidence = 0.3
    }
  }
  
  // Skull symmetry (derived from having both eyes + front)
  let skullSymmetryQuality: LandmarkQualityTier = 'missing'
  if (eyeQuality !== 'missing' && hasFront) {
    skullSymmetryQuality = eyeQuality
  } else if (hasFront) {
    skullSymmetryQuality = 'fair'
  }
  
  // Beam tip visibility
  let beamTipVisibility: LandmarkQualityTier = 'missing'
  let beamTipConfidence = 0
  
  if (visionLandmarks?.antlers_visible) {
    if (hasBothSides) {
      beamTipVisibility = 'excellent'
      beamTipConfidence = 0.9
    } else if (hasLeft || hasRight) {
      beamTipVisibility = 'good'
      beamTipConfidence = 0.7
    } else if (hasFront) {
      beamTipVisibility = 'fair'
      beamTipConfidence = 0.5
    } else {
      beamTipVisibility = 'poor'
      beamTipConfidence = 0.3
    }
  }
  
  // Brow tine visibility
  let browTineVisibility: LandmarkQualityTier = 'missing'
  if (visionLandmarks?.antlers_visible) {
    if (hasBothSides && mainFramePoints && mainFramePoints >= 8) {
      browTineVisibility = 'excellent'
    } else if (hasLeft || hasRight) {
      browTineVisibility = 'good'
    } else if (hasFront) {
      browTineVisibility = 'fair'
    } else {
      browTineVisibility = 'poor'
    }
  }
  
  // Inside spread visibility
  let insideSpreadVisibility: LandmarkQualityTier = 'missing'
  if (hasFront && visionLandmarks?.antlers_visible) {
    insideSpreadVisibility = earBaseQuality === 'excellent' ? 'excellent' : 'good'
  } else if (visionLandmarks?.antlers_visible) {
    insideSpreadVisibility = 'fair'
  }
  
  // Compute overall quality
  const qualities = [
    earBaseQuality, 
    earTipQuality, 
    eyeQuality, 
    beamTipVisibility,
  ].filter(q => q !== 'missing')
  
  let overallQuality: LandmarkQualityTier = 'poor'
  let overallConfidence = 0.3
  
  if (qualities.length >= 3) {
    const excellentCount = qualities.filter(q => q === 'excellent').length
    const goodCount = qualities.filter(q => q === 'good').length
    
    if (excellentCount >= 2) {
      overallQuality = 'excellent'
      overallConfidence = 0.9
    } else if (excellentCount >= 1 || goodCount >= 2) {
      overallQuality = 'good'
      overallConfidence = 0.75
    } else {
      overallQuality = 'fair'
      overallConfidence = 0.55
    }
  } else if (qualities.length > 0) {
    overallQuality = 'fair'
    overallConfidence = 0.45
  }
  
  return {
    ear_base_quality: earBaseQuality,
    ear_tip_quality: earTipQuality,
    eye_quality: eyeQuality,
    skull_symmetry_quality: skullSymmetryQuality,
    beam_tip_visibility: beamTipVisibility,
    brow_tine_visibility: browTineVisibility,
    inside_spread_visibility: insideSpreadVisibility,
    ear_base_confidence: earBaseConfidence,
    ear_tip_confidence: earTipConfidence,
    eye_confidence: eyeConfidence,
    beam_tip_confidence: beamTipConfidence,
    overall_quality: overallQuality,
    overall_confidence: overallConfidence,
    best_frontal_image: frontIndex >= 0 ? frontIndex : null,
    best_side_images: bestSideImages,
  }
}

/**
 * Convert enhanced landmark data to a summary string
 */
export function getEnhancedLandmarkSummary(data: EnhancedLandmarkData): string {
  const parts: string[] = []
  
  if (data.ear_base_quality !== 'missing') {
    parts.push(`Ears: ${data.ear_base_quality}`)
  }
  if (data.eye_quality !== 'missing') {
    parts.push(`Eyes: ${data.eye_quality}`)
  }
  if (data.beam_tip_visibility !== 'missing') {
    parts.push(`Beams: ${data.beam_tip_visibility}`)
  }
  
  if (parts.length === 0) {
    return 'No landmarks detected'
  }
  
  return `Overall: ${data.overall_quality} (${parts.join(', ')})`
}
