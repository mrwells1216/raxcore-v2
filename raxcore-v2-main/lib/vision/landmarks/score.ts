/**
 * Phase 45: Per-Image Reference Quality Scoring
 * 
 * Evaluates which images are useful for which measurement families
 * based on angle, landmark visibility, and quality signals.
 */

import type { AngleType, SourceType } from '@/lib/types'
import type {
  ImageLandmarkPackage,
  ImageReferenceQuality,
  ReferenceSignals,
  MeasurementFamily,
} from './types'

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

export interface ReferenceScoreInput {
  landmarkPackage: ImageLandmarkPackage
  sourceType?: string
  captureDevice?: string
  earsFullyVisible?: boolean
}

/**
 * Compute reference quality scores for a single image
 */
export function scoreImageReference(input: ReferenceScoreInput): ImageReferenceQuality {
  const { landmarkPackage, sourceType, captureDevice, earsFullyVisible } = input
  const { image_index, angle_type, landmarks, ear_detection_quality, eye_detection_quality, antler_detection_quality, tine_detection_quality, issues } = landmarkPackage
  
  // Build reference signals
  const signals = buildReferenceSignals(
    angle_type,
    landmarkPackage,
    sourceType,
    captureDevice,
    earsFullyVisible
  )
  
  // Compute per-family scores
  const spreadScore = computeSpreadReferenceScore(signals, landmarkPackage)
  const beamScore = computeBeamReferenceScore(signals, landmarkPackage)
  const tineScore = computeTineReferenceScore(signals, landmarkPackage)
  const massScore = computeMassReferenceScore(signals, landmarkPackage)
  const asymmetryScore = computeAsymmetryReliabilityScore(signals, landmarkPackage)
  
  // Overall score is weighted average
  const overallScore = (
    spreadScore * 0.25 +
    beamScore * 0.25 +
    tineScore * 0.20 +
    massScore * 0.15 +
    asymmetryScore * 0.15
  )
  
  // Determine best/weak for families
  const familyScores: Record<MeasurementFamily, number> = {
    spread: spreadScore,
    beam: beamScore,
    tine: tineScore,
    mass: massScore,
    asymmetry: asymmetryScore,
    deduction: (spreadScore + asymmetryScore) / 2,
  }
  
  const sortedFamilies = Object.entries(familyScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k as MeasurementFamily)
  
  const bestFor = sortedFamilies.filter(f => familyScores[f] >= 0.6).slice(0, 3)
  const weakFor = sortedFamilies.filter(f => familyScores[f] < 0.4)
  
  // Build reason notes
  const reasonNotes = buildReasonNotes(signals, familyScores)
  
  return {
    image_index,
    angle_type,
    spread_reference_score: spreadScore,
    beam_reference_score: beamScore,
    tine_reference_score: tineScore,
    mass_reference_score: massScore,
    asymmetry_reliability_score: asymmetryScore,
    overall_reference_score: overallScore,
    signals,
    best_for: bestFor,
    weak_for: weakFor,
    reason_notes: reasonNotes,
  }
}

/**
 * Score reference quality for all images
 */
export function scoreAllImageReferences(
  packages: ImageLandmarkPackage[],
  sourceType?: string,
  captureDevice?: string,
  earsFullyVisible?: boolean
): ImageReferenceQuality[] {
  return packages.map(pkg => scoreImageReference({
    landmarkPackage: pkg,
    sourceType,
    captureDevice,
    earsFullyVisible,
  }))
}

// ============================================================================
// SIGNAL BUILDING
// ============================================================================

function buildReferenceSignals(
  angleType: AngleType,
  pkg: ImageLandmarkPackage,
  sourceType?: string,
  captureDevice?: string,
  earsFullyVisible?: boolean
): ReferenceSignals {
  // Angle class determination
  let angleClass: ReferenceSignals['angle_class'] = 'unknown'
  if (angleType === 'front') angleClass = 'frontal'
  else if (angleType === 'left') angleClass = 'side_left'
  else if (angleType === 'right') angleClass = 'side_right'
  else if (angleType === 'back') angleClass = 'back'
  
  // Angle quality based on type
  let angleQuality = 0.5
  if (angleType === 'front') angleQuality = 0.9
  else if (angleType === 'left' || angleType === 'right') angleQuality = 0.85
  else if (angleType === 'back') angleQuality = 0.6
  else angleQuality = 0.4
  
  // Ear visibility
  const hasLeftEar = pkg.landmarks.left_ear_base || pkg.landmarks.left_ear_tip
  const hasRightEar = pkg.landmarks.right_ear_base || pkg.landmarks.right_ear_tip
  let earVisibility: ReferenceSignals['ear_visibility'] = 'none'
  if (hasLeftEar && hasRightEar) {
    earVisibility = earsFullyVisible ? 'both_full' : 'both_partial'
  } else if (hasLeftEar || hasRightEar) {
    earVisibility = 'one_only'
  }
  
  // Eye visibility
  const hasLeftEye = !!pkg.landmarks.left_eye_center
  const hasRightEye = !!pkg.landmarks.right_eye_center
  let eyeVisibility: ReferenceSignals['eye_visibility'] = 'none'
  if (hasLeftEye && hasRightEye) eyeVisibility = 'both'
  else if (hasLeftEye || hasRightEye) eyeVisibility = 'one_only'
  
  // Beam tip visibility
  const hasLeftBeamTip = !!pkg.landmarks.left_main_beam_tip
  const hasRightBeamTip = !!pkg.landmarks.right_main_beam_tip
  let beamTipVisibility: ReferenceSignals['beam_tip_visibility'] = 'none'
  if (hasLeftBeamTip && hasRightBeamTip) beamTipVisibility = 'both'
  else if (hasLeftBeamTip) beamTipVisibility = 'left_only'
  else if (hasRightBeamTip) beamTipVisibility = 'right_only'
  
  // Tine visibility
  const leftTineCount = [pkg.landmarks.left_g1_tip, pkg.landmarks.left_g2_tip, pkg.landmarks.left_g3_tip, pkg.landmarks.left_g4_tip].filter(Boolean).length
  const rightTineCount = [pkg.landmarks.right_g1_tip, pkg.landmarks.right_g2_tip, pkg.landmarks.right_g3_tip, pkg.landmarks.right_g4_tip].filter(Boolean).length
  const totalTines = leftTineCount + rightTineCount
  let tineVisibility: ReferenceSignals['tine_visibility'] = 'none'
  if (totalTines >= 6) tineVisibility = 'excellent'
  else if (totalTines >= 4) tineVisibility = 'good'
  else if (totalTines >= 2) tineVisibility = 'partial'
  else if (totalTines >= 1) tineVisibility = 'poor'
  
  // Crop/occlusion risk from issues
  const hasCropIssue = pkg.issues.some(i => i.type === 'crop')
  const hasOcclusionIssue = pkg.issues.some(i => i.type === 'occlusion')
  const cropRisk: ReferenceSignals['crop_risk'] = hasCropIssue ? 'high' : 'none'
  const occlusionRisk: ReferenceSignals['occlusion_risk'] = hasOcclusionIssue ? 'medium' : 'none'
  
  // Lighting quality (estimated from source type)
  let lightingQuality: ReferenceSignals['lighting_quality'] = 'good'
  if (sourceType === 'trail_cam') lightingQuality = 'fair'
  else if (sourceType === 'mounted_photo' || sourceType === 'european_mount') lightingQuality = 'excellent'
  else if (captureDevice === 'vintage_photo' || captureDevice === 'photo_of_photo') lightingQuality = 'poor'
  
  // Average landmark confidence
  const allConfs = Object.values(pkg.landmarks).map(l => l.confidence).filter(c => c > 0)
  const landmarkConfidenceAvg = allConfs.length > 0
    ? allConfs.reduce((a, b) => a + b, 0) / allConfs.length
    : 0.3
  
  return {
    angle_class: angleClass,
    angle_quality: angleQuality,
    ear_visibility: earVisibility,
    eye_visibility: eyeVisibility,
    beam_tip_visibility: beamTipVisibility,
    tine_visibility: tineVisibility,
    crop_risk: cropRisk,
    occlusion_risk: occlusionRisk,
    source_type: sourceType || 'unknown',
    lighting_quality: lightingQuality,
    landmark_confidence_avg: landmarkConfidenceAvg,
  }
}

// ============================================================================
// PER-FAMILY SCORING
// ============================================================================

function computeSpreadReferenceScore(signals: ReferenceSignals, pkg: ImageLandmarkPackage): number {
  let score = 0
  
  // Frontal angle is crucial for spread
  if (signals.angle_class === 'frontal') score += 0.4
  else if (signals.angle_class === '45_left' || signals.angle_class === '45_right') score += 0.2
  else score += 0.05
  
  // Ear visibility is primary reference for spread
  if (signals.ear_visibility === 'both_full') score += 0.35
  else if (signals.ear_visibility === 'both_partial') score += 0.25
  else if (signals.ear_visibility === 'one_only') score += 0.1
  
  // Eye visibility supports spread reference
  if (signals.eye_visibility === 'both') score += 0.15
  else if (signals.eye_visibility === 'one_only') score += 0.08
  
  // Inside spread anchors visible
  if (pkg.landmarks.inside_spread_anchor_left && pkg.landmarks.inside_spread_anchor_right) {
    score += 0.1
  }
  
  // Penalize for crop/occlusion
  if (signals.crop_risk === 'high') score -= 0.2
  if (signals.occlusion_risk === 'high') score -= 0.15
  
  return Math.max(0, Math.min(1, score))
}

function computeBeamReferenceScore(signals: ReferenceSignals, pkg: ImageLandmarkPackage): number {
  let score = 0
  
  // Side angles are best for beam measurement
  if (signals.angle_class === 'side_left' || signals.angle_class === 'side_right') score += 0.4
  else if (signals.angle_class === '45_left' || signals.angle_class === '45_right') score += 0.3
  else if (signals.angle_class === 'frontal') score += 0.15
  else score += 0.05
  
  // Beam tip visibility is crucial
  if (signals.beam_tip_visibility === 'both') score += 0.35
  else if (signals.beam_tip_visibility === 'left_only' || signals.beam_tip_visibility === 'right_only') {
    // Single side is still useful for that side's beam
    score += 0.25
  }
  
  // Burr/base visibility helps
  const hasBurrs = pkg.landmarks.left_burr_or_antler_base || pkg.landmarks.right_burr_or_antler_base
  if (hasBurrs) score += 0.15
  
  // Lighting quality matters for beam curvature
  if (signals.lighting_quality === 'excellent') score += 0.1
  else if (signals.lighting_quality === 'good') score += 0.05
  else if (signals.lighting_quality === 'poor') score -= 0.1
  
  return Math.max(0, Math.min(1, score))
}

function computeTineReferenceScore(signals: ReferenceSignals, pkg: ImageLandmarkPackage): number {
  let score = 0
  
  // Side and 45-degree angles are best for tines
  if (signals.angle_class === 'side_left' || signals.angle_class === 'side_right') score += 0.35
  else if (signals.angle_class === '45_left' || signals.angle_class === '45_right') score += 0.3
  else if (signals.angle_class === 'frontal') score += 0.15
  else score += 0.05
  
  // Tine visibility is crucial
  if (signals.tine_visibility === 'excellent') score += 0.4
  else if (signals.tine_visibility === 'good') score += 0.3
  else if (signals.tine_visibility === 'partial') score += 0.15
  else if (signals.tine_visibility === 'poor') score += 0.05
  
  // Eye reference helps with scaling for tine length
  if (signals.eye_visibility === 'both') score += 0.1
  else if (signals.eye_visibility === 'one_only') score += 0.05
  
  // Lighting quality matters for tine tips
  if (signals.lighting_quality === 'excellent') score += 0.1
  else if (signals.lighting_quality === 'poor') score -= 0.1
  
  // Crop risk is particularly bad for tines
  if (signals.crop_risk === 'high') score -= 0.25
  
  return Math.max(0, Math.min(1, score))
}

function computeMassReferenceScore(signals: ReferenceSignals, pkg: ImageLandmarkPackage): number {
  let score = 0
  
  // Side angles are best for mass (circumference estimation)
  if (signals.angle_class === 'side_left' || signals.angle_class === 'side_right') score += 0.4
  else if (signals.angle_class === '45_left' || signals.angle_class === '45_right') score += 0.25
  else if (signals.angle_class === 'frontal') score += 0.15
  else score += 0.05
  
  // Need to see the beam clearly for mass estimation
  if (signals.beam_tip_visibility === 'both') score += 0.25
  else if (signals.beam_tip_visibility !== 'none') score += 0.15
  
  // Lighting is critical for mass - need to see beam thickness
  if (signals.lighting_quality === 'excellent') score += 0.2
  else if (signals.lighting_quality === 'good') score += 0.1
  else if (signals.lighting_quality === 'fair') score += 0.05
  else if (signals.lighting_quality === 'poor') score -= 0.15
  
  // Landmark confidence affects mass estimation
  score += signals.landmark_confidence_avg * 0.15
  
  return Math.max(0, Math.min(1, score))
}

function computeAsymmetryReliabilityScore(signals: ReferenceSignals, pkg: ImageLandmarkPackage): number {
  let score = 0
  
  // Frontal angle is best for asymmetry assessment
  if (signals.angle_class === 'frontal') score += 0.5
  else if (signals.angle_class === '45_left' || signals.angle_class === '45_right') score += 0.25
  else if (signals.angle_class === 'side_left' || signals.angle_class === 'side_right') score += 0.1
  else score += 0.05
  
  // Need both sides visible for asymmetry
  if (signals.beam_tip_visibility === 'both') score += 0.25
  else score += 0.05
  
  // Ear reference helps validate asymmetry vs perspective
  if (signals.ear_visibility === 'both_full') score += 0.15
  else if (signals.ear_visibility === 'both_partial') score += 0.1
  
  // Eye reference also helps
  if (signals.eye_visibility === 'both') score += 0.1
  
  return Math.max(0, Math.min(1, score))
}

// ============================================================================
// REASON NOTES
// ============================================================================

function buildReasonNotes(signals: ReferenceSignals, scores: Record<MeasurementFamily, number>): string[] {
  const notes: string[] = []
  
  // Angle notes
  if (signals.angle_class === 'frontal') {
    notes.push('Frontal angle provides strong spread and ear reference')
  } else if (signals.angle_class === 'side_left' || signals.angle_class === 'side_right') {
    notes.push(`${signals.angle_class === 'side_left' ? 'Left' : 'Right'} side angle good for beam and tine measurement`)
  }
  
  // Ear reference notes
  if (signals.ear_visibility === 'both_full') {
    notes.push('Full ear visibility provides excellent anatomical scaling reference')
  } else if (signals.ear_visibility === 'none') {
    notes.push('No ear visibility limits anatomical scaling accuracy')
  }
  
  // Beam tip notes
  if (signals.beam_tip_visibility === 'both') {
    notes.push('Both beam tips visible for accurate length measurement')
  } else if (signals.beam_tip_visibility === 'none') {
    notes.push('Beam tips not visible - beam length estimation limited')
  }
  
  // Tine notes
  if (signals.tine_visibility === 'excellent' || signals.tine_visibility === 'good') {
    notes.push('Good tine visibility for accurate tine measurements')
  } else if (signals.tine_visibility === 'poor' || signals.tine_visibility === 'none') {
    notes.push('Limited tine visibility reduces tine measurement confidence')
  }
  
  // Issue notes
  if (signals.crop_risk === 'high') {
    notes.push('Image cropping may cut off antler tips')
  }
  if (signals.occlusion_risk === 'high' || signals.occlusion_risk === 'medium') {
    notes.push('Partial occlusion affects some measurements')
  }
  if (signals.lighting_quality === 'poor') {
    notes.push('Poor lighting reduces measurement confidence')
  }
  
  return notes
}
