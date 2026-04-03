/**
 * Phase 45: Landmark Extraction Layer
 * 
 * Extracts structured landmarks from each image in the scoring pipeline.
 * This is NOT true computer vision - it's a structured estimation layer
 * that normalizes provider output and derives heuristic placeholders.
 */

import type { AngleType, LandmarksDetected } from '@/lib/types'
import type {
  ImageLandmarkPackage,
  LandmarkPoint45,
  AllLandmarkId,
  LandmarkQualityScore,
  LandmarkIssue,
  FusedLandmarkPackage,
  FusedLandmarkPoint,
  FusionConflict,
} from './types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface ImageForLandmarkExtraction {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
  index: number
}

export interface LandmarkExtractionInput {
  images: ImageForLandmarkExtraction[]
  visionLandmarks?: LandmarksDetected
  earsFullyVisible?: boolean
  mainFramePoints?: number
  sourceType?: string
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract structured landmarks from all images in the input.
 * Returns per-image packages plus a fused multi-image package.
 */
export function extractLandmarks(input: LandmarkExtractionInput): {
  perImagePackages: ImageLandmarkPackage[]
  fusedPackage: FusedLandmarkPackage
} {
  const startTime = Date.now()
  const { images, visionLandmarks, earsFullyVisible, mainFramePoints } = input
  
  // Extract landmarks for each image
  const perImagePackages: ImageLandmarkPackage[] = []
  
  for (const image of images) {
    const pkg = extractImageLandmarks(image, visionLandmarks, earsFullyVisible, mainFramePoints)
    perImagePackages.push(pkg)
  }
  
  // Fuse landmarks across all images
  const fusedPackage = fuseLandmarks(perImagePackages, visionLandmarks)
  
  // Update processing time
  const totalTime = Date.now() - startTime
  for (const pkg of perImagePackages) {
    pkg.processing_time_ms = Math.round(totalTime / images.length)
  }
  
  return { perImagePackages, fusedPackage }
}

// ============================================================================
// PER-IMAGE EXTRACTION
// ============================================================================

function extractImageLandmarks(
  image: ImageForLandmarkExtraction,
  visionLandmarks: LandmarksDetected | undefined,
  earsFullyVisible: boolean | undefined,
  mainFramePoints: number | undefined
): ImageLandmarkPackage {
  const { angleType, index, width, height } = image
  const landmarks: Partial<Record<AllLandmarkId, LandmarkPoint45>> = {}
  const issues: LandmarkIssue[] = []
  
  // Estimate landmarks based on angle type and available info
  const hasEarsInfo = visionLandmarks?.ears_visible ?? false
  const hasEyesInfo = visionLandmarks?.eyes_visible ?? false
  const hasAntlersInfo = visionLandmarks?.antlers_visible ?? true
  
  // ========== FRONTAL ANGLE LANDMARKS ==========
  if (angleType === 'front') {
    // Ear landmarks - best detected from front
    if (hasEarsInfo || earsFullyVisible) {
      const earConf = earsFullyVisible ? 0.9 : 0.65
      
      landmarks.left_ear_base = createLandmark(0.25, 0.22, earConf, index, earsFullyVisible ? 'heuristic' : 'heuristic')
      landmarks.left_ear_tip = createLandmark(0.18, 0.12, earConf * 0.95, index, 'heuristic')
      landmarks.right_ear_base = createLandmark(0.75, 0.22, earConf, index, 'heuristic')
      landmarks.right_ear_tip = createLandmark(0.82, 0.12, earConf * 0.95, index, 'heuristic')
    } else {
      issues.push({
        type: 'missing',
        severity: 'warning',
        affected_landmarks: ['left_ear_base', 'left_ear_tip', 'right_ear_base', 'right_ear_tip'],
        message: 'Ears not visible or confirmed in frontal image',
      })
    }
    
    // Eye landmarks - good from front
    if (hasEyesInfo) {
      landmarks.left_eye_center = createLandmark(0.35, 0.38, 0.85, index, 'heuristic')
      landmarks.right_eye_center = createLandmark(0.65, 0.38, 0.85, index, 'heuristic')
    }
    
    // Nose/skull centerline
    landmarks.nose_tip = createLandmark(0.5, 0.65, 0.7, index, 'heuristic')
    landmarks.skull_centerline_estimate = createLandmark(0.5, 0.35, 0.75, index, 'heuristic')
    
    // Antler bases - visible from front
    if (hasAntlersInfo) {
      landmarks.left_burr_or_antler_base = createLandmark(0.32, 0.15, 0.75, index, 'heuristic')
      landmarks.right_burr_or_antler_base = createLandmark(0.68, 0.15, 0.75, index, 'heuristic')
      
      // Inside spread anchors - best from front
      landmarks.inside_spread_anchor_left = createLandmark(0.28, 0.08, 0.8, index, 'heuristic')
      landmarks.inside_spread_anchor_right = createLandmark(0.72, 0.08, 0.8, index, 'heuristic')
    }
    
    // Beam tips - partially visible from front
    if (hasAntlersInfo) {
      landmarks.left_main_beam_tip = createLandmark(0.15, 0.25, 0.55, index, 'heuristic')
      landmarks.right_main_beam_tip = createLandmark(0.85, 0.25, 0.55, index, 'heuristic')
    }
  }
  
  // ========== LEFT SIDE ANGLE LANDMARKS ==========
  else if (angleType === 'left') {
    // Left side shows left antler well
    if (hasAntlersInfo) {
      landmarks.left_burr_or_antler_base = createLandmark(0.55, 0.18, 0.85, index, 'heuristic')
      landmarks.left_main_beam_tip = createLandmark(0.2, 0.45, 0.85, index, 'heuristic')
      
      // Left tines - good visibility
      const tineCount = mainFramePoints ? Math.ceil(mainFramePoints / 2) : 4
      if (tineCount >= 1) {
        landmarks.left_g1_base = createLandmark(0.52, 0.2, 0.8, index, 'heuristic')
        landmarks.left_g1_tip = createLandmark(0.48, 0.12, 0.75, index, 'heuristic')
      }
      if (tineCount >= 2) {
        landmarks.left_g2_base = createLandmark(0.45, 0.25, 0.8, index, 'heuristic')
        landmarks.left_g2_tip = createLandmark(0.38, 0.08, 0.75, index, 'heuristic')
      }
      if (tineCount >= 3) {
        landmarks.left_g3_base = createLandmark(0.38, 0.32, 0.75, index, 'heuristic')
        landmarks.left_g3_tip = createLandmark(0.32, 0.15, 0.7, index, 'heuristic')
      }
      if (tineCount >= 4) {
        landmarks.left_g4_base = createLandmark(0.3, 0.38, 0.7, index, 'heuristic')
        landmarks.left_g4_tip = createLandmark(0.25, 0.22, 0.65, index, 'heuristic')
      }
      if (tineCount >= 5) {
        landmarks.left_g5_base = createLandmark(0.25, 0.42, 0.6, index, 'heuristic')
        landmarks.left_g5_tip = createLandmark(0.22, 0.32, 0.55, index, 'heuristic')
      }
    }
    
    // Eye - partially visible from side
    if (hasEyesInfo) {
      landmarks.left_eye_center = createLandmark(0.62, 0.4, 0.6, index, 'heuristic')
    }
    
    // Ear - partially visible
    if (hasEarsInfo) {
      landmarks.left_ear_base = createLandmark(0.7, 0.25, 0.5, index, 'heuristic')
      landmarks.left_ear_tip = createLandmark(0.75, 0.15, 0.45, index, 'heuristic')
    }
    
    // Right side landmarks have very low confidence from left view
    issues.push({
      type: 'occlusion',
      severity: 'info',
      affected_landmarks: ['right_main_beam_tip', 'right_g1_tip', 'right_g2_tip', 'right_g3_tip'],
      message: 'Right side antler occluded in left profile view',
    })
  }
  
  // ========== RIGHT SIDE ANGLE LANDMARKS ==========
  else if (angleType === 'right') {
    // Right side shows right antler well
    if (hasAntlersInfo) {
      landmarks.right_burr_or_antler_base = createLandmark(0.45, 0.18, 0.85, index, 'heuristic')
      landmarks.right_main_beam_tip = createLandmark(0.8, 0.45, 0.85, index, 'heuristic')
      
      // Right tines - good visibility
      const tineCount = mainFramePoints ? Math.ceil(mainFramePoints / 2) : 4
      if (tineCount >= 1) {
        landmarks.right_g1_base = createLandmark(0.48, 0.2, 0.8, index, 'heuristic')
        landmarks.right_g1_tip = createLandmark(0.52, 0.12, 0.75, index, 'heuristic')
      }
      if (tineCount >= 2) {
        landmarks.right_g2_base = createLandmark(0.55, 0.25, 0.8, index, 'heuristic')
        landmarks.right_g2_tip = createLandmark(0.62, 0.08, 0.75, index, 'heuristic')
      }
      if (tineCount >= 3) {
        landmarks.right_g3_base = createLandmark(0.62, 0.32, 0.75, index, 'heuristic')
        landmarks.right_g3_tip = createLandmark(0.68, 0.15, 0.7, index, 'heuristic')
      }
      if (tineCount >= 4) {
        landmarks.right_g4_base = createLandmark(0.7, 0.38, 0.7, index, 'heuristic')
        landmarks.right_g4_tip = createLandmark(0.75, 0.22, 0.65, index, 'heuristic')
      }
      if (tineCount >= 5) {
        landmarks.right_g5_base = createLandmark(0.75, 0.42, 0.6, index, 'heuristic')
        landmarks.right_g5_tip = createLandmark(0.78, 0.32, 0.55, index, 'heuristic')
      }
    }
    
    // Eye - partially visible from side
    if (hasEyesInfo) {
      landmarks.right_eye_center = createLandmark(0.38, 0.4, 0.6, index, 'heuristic')
    }
    
    // Ear - partially visible
    if (hasEarsInfo) {
      landmarks.right_ear_base = createLandmark(0.3, 0.25, 0.5, index, 'heuristic')
      landmarks.right_ear_tip = createLandmark(0.25, 0.15, 0.45, index, 'heuristic')
    }
    
    // Left side landmarks have very low confidence from right view
    issues.push({
      type: 'occlusion',
      severity: 'info',
      affected_landmarks: ['left_main_beam_tip', 'left_g1_tip', 'left_g2_tip', 'left_g3_tip'],
      message: 'Left side antler occluded in right profile view',
    })
  }
  
  // ========== BACK ANGLE LANDMARKS ==========
  else if (angleType === 'back') {
    if (hasAntlersInfo) {
      // Beam tips visible from back
      landmarks.left_main_beam_tip = createLandmark(0.2, 0.35, 0.7, index, 'heuristic')
      landmarks.right_main_beam_tip = createLandmark(0.8, 0.35, 0.7, index, 'heuristic')
      
      // Burrs partially visible
      landmarks.left_burr_or_antler_base = createLandmark(0.35, 0.2, 0.5, index, 'heuristic')
      landmarks.right_burr_or_antler_base = createLandmark(0.65, 0.2, 0.5, index, 'heuristic')
    }
    
    // Ears visible from back
    if (hasEarsInfo) {
      landmarks.left_ear_base = createLandmark(0.3, 0.35, 0.6, index, 'heuristic')
      landmarks.right_ear_base = createLandmark(0.7, 0.35, 0.6, index, 'heuristic')
    }
    
    issues.push({
      type: 'occlusion',
      severity: 'warning',
      affected_landmarks: ['left_eye_center', 'right_eye_center', 'nose_tip'],
      message: 'Face landmarks not visible from back view',
    })
  }
  
  // ========== OTHER/UNKNOWN ANGLE ==========
  else {
    // Very limited landmark detection for unknown angles
    if (hasAntlersInfo) {
      landmarks.left_burr_or_antler_base = createLandmark(0.3, 0.2, 0.4, index, 'heuristic')
      landmarks.right_burr_or_antler_base = createLandmark(0.7, 0.2, 0.4, index, 'heuristic')
    }
    
    issues.push({
      type: 'low_confidence',
      severity: 'warning',
      affected_landmarks: [],
      message: 'Unknown or oblique angle reduces landmark detection confidence',
    })
  }
  
  // Calculate quality scores
  const detectedCount = Object.keys(landmarks).length
  const totalPossible = 32 // max landmarks we track
  const coveragePercent = (detectedCount / totalPossible) * 100
  
  const earQuality = computeQualityScore(
    ['left_ear_base', 'left_ear_tip', 'right_ear_base', 'right_ear_tip'],
    landmarks
  )
  const eyeQuality = computeQualityScore(
    ['left_eye_center', 'right_eye_center'],
    landmarks
  )
  const antlerQuality = computeQualityScore(
    ['left_burr_or_antler_base', 'right_burr_or_antler_base', 'left_main_beam_tip', 'right_main_beam_tip'],
    landmarks
  )
  const tineQuality = computeQualityScore(
    ['left_g1_tip', 'left_g2_tip', 'left_g3_tip', 'right_g1_tip', 'right_g2_tip', 'right_g3_tip'],
    landmarks
  )
  
  return {
    image_index: index,
    angle_type: angleType,
    landmarks,
    detected_count: detectedCount,
    total_possible: totalPossible,
    coverage_percent: coveragePercent,
    ear_detection_quality: earQuality,
    eye_detection_quality: eyeQuality,
    antler_detection_quality: antlerQuality,
    tine_detection_quality: tineQuality,
    issues,
    extraction_method: 'heuristic',
    processing_time_ms: 0, // set later
  }
}

// ============================================================================
// LANDMARK FUSION
// ============================================================================

function fuseLandmarks(
  packages: ImageLandmarkPackage[],
  visionLandmarks: LandmarksDetected | undefined
): FusedLandmarkPackage {
  const fusedLandmarks: Partial<Record<AllLandmarkId, FusedLandmarkPoint>> = {}
  const conflicts: FusionConflict[] = []
  
  // Collect all landmark IDs across all images
  const allLandmarkIds = new Set<AllLandmarkId>()
  for (const pkg of packages) {
    for (const id of Object.keys(pkg.landmarks) as AllLandmarkId[]) {
      allLandmarkIds.add(id)
    }
  }
  
  // Fuse each landmark
  for (const landmarkId of allLandmarkIds) {
    const sources: { pkg: ImageLandmarkPackage; point: LandmarkPoint45 }[] = []
    
    for (const pkg of packages) {
      const point = pkg.landmarks[landmarkId]
      if (point && point.visible !== false && point.confidence > 0.1) {
        sources.push({ pkg, point })
      }
    }
    
    if (sources.length === 0) continue
    
    if (sources.length === 1) {
      // Single source - use directly
      const { pkg, point } = sources[0]
      fusedLandmarks[landmarkId] = {
        ...point,
        source_images: [pkg.image_index],
        agreement_score: 1.0,
        fusion_method: 'best_confidence',
      }
    } else {
      // Multiple sources - check for conflicts and fuse
      const positions = sources.map(s => ({ x: s.point.x, y: s.point.y }))
      const variance = computePositionVariance(positions)
      
      if (variance > 0.15) {
        // Significant disagreement - use highest confidence
        conflicts.push({
          landmark_id: landmarkId,
          conflicting_images: sources.map(s => s.pkg.image_index),
          position_variance: variance,
          resolution: 'used_highest_confidence',
          notes: `Position variance ${(variance * 100).toFixed(1)}% exceeded threshold`,
        })
        
        const best = sources.reduce((a, b) => a.point.confidence > b.point.confidence ? a : b)
        fusedLandmarks[landmarkId] = {
          ...best.point,
          source_images: sources.map(s => s.pkg.image_index),
          agreement_score: 1 - variance,
          fusion_method: 'conflict_resolved',
        }
      } else {
        // Good agreement - weighted average
        const totalWeight = sources.reduce((sum, s) => sum + s.point.confidence, 0)
        const avgX = sources.reduce((sum, s) => sum + s.point.x * s.point.confidence, 0) / totalWeight
        const avgY = sources.reduce((sum, s) => sum + s.point.y * s.point.confidence, 0) / totalWeight
        const maxConf = Math.max(...sources.map(s => s.point.confidence))
        
        fusedLandmarks[landmarkId] = {
          x: avgX,
          y: avgY,
          confidence: maxConf * (1 + (sources.length - 1) * 0.05), // slight boost for multi-source
          visible: true,
          derived_from: 'fused',
          source_image_index: sources[0].pkg.image_index,
          source_images: sources.map(s => s.pkg.image_index),
          agreement_score: 1 - variance,
          fusion_method: 'weighted_average',
        }
      }
    }
  }
  
  // Calculate derived anatomical estimates
  const earBaseTip = estimateDistance(fusedLandmarks, 'left_ear_base', 'left_ear_tip', 'right_ear_base', 'right_ear_tip')
  const eyeToEye = estimateDistance(fusedLandmarks, 'left_eye_center', 'right_eye_center')
  const earTipToTip = estimateDistance(fusedLandmarks, 'left_ear_tip', 'right_ear_tip')
  
  // Determine fusion quality
  const landmarkCoverage = Object.keys(fusedLandmarks).length / 32
  const avgAgreement = Object.values(fusedLandmarks).reduce((sum, p) => sum + p.agreement_score, 0) / Math.max(1, Object.keys(fusedLandmarks).length)
  
  let fusionQuality: FusedLandmarkPackage['fusion_quality'] = 'poor'
  if (landmarkCoverage >= 0.6 && avgAgreement >= 0.85) fusionQuality = 'excellent'
  else if (landmarkCoverage >= 0.4 && avgAgreement >= 0.7) fusionQuality = 'good'
  else if (landmarkCoverage >= 0.25 && avgAgreement >= 0.5) fusionQuality = 'fair'
  
  return {
    landmarks: fusedLandmarks,
    per_image_packages: packages,
    images_used: packages.length,
    landmark_coverage: landmarkCoverage,
    cross_image_agreement: avgAgreement,
    fusion_quality: fusionQuality,
    estimated_ear_base_to_tip: earBaseTip ?? visionLandmarks?.ear_base_to_tip ?? null,
    estimated_eye_to_eye: eyeToEye ?? visionLandmarks?.eye_to_eye ?? null,
    estimated_ear_tip_to_tip: earTipToTip ?? visionLandmarks?.ear_tip_to_tip ?? null,
    estimated_skull_width: null, // derived later if needed
    fusion_conflicts: conflicts,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createLandmark(
  x: number,
  y: number,
  confidence: number,
  sourceImageIndex: number,
  derivedFrom: LandmarkPoint45['derived_from']
): LandmarkPoint45 {
  return {
    x,
    y,
    confidence: Math.min(1, Math.max(0, confidence)),
    visible: true,
    derived_from: derivedFrom,
    source_image_index: sourceImageIndex,
  }
}

function computeQualityScore(
  landmarkIds: AllLandmarkId[],
  landmarks: Partial<Record<AllLandmarkId, LandmarkPoint45>>
): LandmarkQualityScore {
  const detected = landmarkIds.filter(id => landmarks[id] && landmarks[id]!.confidence > 0.3)
  const avgConfidence = detected.length > 0
    ? detected.reduce((sum, id) => sum + (landmarks[id]?.confidence ?? 0), 0) / detected.length
    : 0
  
  const coverage = detected.length / landmarkIds.length
  const score = coverage * 0.6 + avgConfidence * 0.4
  
  let tier: LandmarkQualityScore['tier'] = 'missing'
  let reason = 'No landmarks detected'
  
  if (coverage >= 0.75 && avgConfidence >= 0.7) {
    tier = 'excellent'
    reason = `${detected.length}/${landmarkIds.length} landmarks with high confidence`
  } else if (coverage >= 0.5 && avgConfidence >= 0.5) {
    tier = 'good'
    reason = `${detected.length}/${landmarkIds.length} landmarks with moderate confidence`
  } else if (coverage >= 0.25) {
    tier = 'fair'
    reason = `${detected.length}/${landmarkIds.length} landmarks detected`
  } else if (detected.length > 0) {
    tier = 'poor'
    reason = `Only ${detected.length} landmarks detected`
  }
  
  return { score, tier, reason }
}

function computePositionVariance(positions: { x: number; y: number }[]): number {
  if (positions.length < 2) return 0
  
  const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length
  const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length
  
  const variance = positions.reduce((sum, p) => {
    const dx = p.x - avgX
    const dy = p.y - avgY
    return sum + Math.sqrt(dx * dx + dy * dy)
  }, 0) / positions.length
  
  return variance
}

function estimateDistance(
  landmarks: Partial<Record<AllLandmarkId, FusedLandmarkPoint>>,
  ...ids: AllLandmarkId[]
): number | null {
  // For single pair (2 ids)
  if (ids.length === 2) {
    const p1 = landmarks[ids[0]]
    const p2 = landmarks[ids[1]]
    if (!p1 || !p2) return null
    
    const dx = p1.x - p2.x
    const dy = p1.y - p2.y
    const normalizedDist = Math.sqrt(dx * dx + dy * dy)
    
    // Convert to approximate inches using anatomical references
    // This is a rough estimate - actual scaling happens in reference fusion
    return normalizedDist * ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT
  }
  
  // For paired landmarks (4 ids: left_base, left_tip, right_base, right_tip)
  if (ids.length === 4) {
    const lb = landmarks[ids[0]]
    const lt = landmarks[ids[1]]
    const rb = landmarks[ids[2]]
    const rt = landmarks[ids[3]]
    
    let leftDist = null
    let rightDist = null
    
    if (lb && lt) {
      const dx = lb.x - lt.x
      const dy = lb.y - lt.y
      leftDist = Math.sqrt(dx * dx + dy * dy) * ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
    }
    
    if (rb && rt) {
      const dx = rb.x - rt.x
      const dy = rb.y - rt.y
      rightDist = Math.sqrt(dx * dx + dy * dy) * ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
    }
    
    if (leftDist && rightDist) return (leftDist + rightDist) / 2
    return leftDist ?? rightDist
  }
  
  return null
}
