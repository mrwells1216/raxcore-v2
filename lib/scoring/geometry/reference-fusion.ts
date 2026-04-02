/**
 * Phase 45: Reference Fusion Layer
 * 
 * Decides which reference sources are most trusted for each measurement family
 * by analyzing per-image reference quality scores and selecting the best sources.
 */

import type {
  ImageReferenceQuality,
  FusedLandmarkPackage,
  ReferenceFusionResult,
  ReferenceSourceSelection,
  MeasurementFamily,
} from '@/lib/vision/landmarks/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// MAIN FUSION FUNCTION
// ============================================================================

export interface ReferenceFusionInput {
  perImageQuality: ImageReferenceQuality[]
  fusedLandmarks: FusedLandmarkPackage
  earsFullyVisible?: boolean
  visionEarLength?: number
  visionEyeDistance?: number
}

/**
 * Fuse reference sources across all images to select the best
 * reference for each measurement family.
 */
export function fuseReferences(input: ReferenceFusionInput): ReferenceFusionResult {
  const { perImageQuality, fusedLandmarks, earsFullyVisible, visionEarLength, visionEyeDistance } = input
  
  const fusionNotes: string[] = []
  const selectionReasons: Record<MeasurementFamily, string> = {} as Record<MeasurementFamily, string>
  
  // Select primary and backup for each family
  const spreadSelection = selectReferenceForFamily('spread', perImageQuality, fusedLandmarks, earsFullyVisible, visionEarLength, visionEyeDistance)
  const beamSelection = selectReferenceForFamily('beam', perImageQuality, fusedLandmarks, earsFullyVisible, visionEarLength, visionEyeDistance)
  const tineSelection = selectReferenceForFamily('tine', perImageQuality, fusedLandmarks, earsFullyVisible, visionEarLength, visionEyeDistance)
  const massSelection = selectReferenceForFamily('mass', perImageQuality, fusedLandmarks, earsFullyVisible, visionEarLength, visionEyeDistance)
  
  // Record selection reasons
  selectionReasons.spread = spreadSelection.primary.explanation
  selectionReasons.beam = beamSelection.primary.explanation
  selectionReasons.tine = tineSelection.primary.explanation
  selectionReasons.mass = massSelection.primary.explanation
  selectionReasons.asymmetry = 'Derived from spread and beam references'
  selectionReasons.deduction = 'Derived from asymmetry analysis'
  
  // Calculate disagreement score
  const allConfidences = [
    spreadSelection.primary.confidence,
    beamSelection.primary.confidence,
    tineSelection.primary.confidence,
    massSelection.primary.confidence,
  ]
  const avgConfidence = allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
  const confidenceVariance = allConfidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / allConfidences.length
  const disagreementScore = Math.sqrt(confidenceVariance) // standard deviation as disagreement
  
  // Overall reference quality
  const overallQuality = avgConfidence * (1 - disagreementScore * 0.5)
  
  // Add fusion notes
  if (spreadSelection.primary.source_type === 'ear_strong') {
    fusionNotes.push('Strong ear reference available for spread measurement')
  } else if (spreadSelection.primary.source_type === 'weak_fallback') {
    fusionNotes.push('Weak reference for spread - anatomical scaling limited')
  }
  
  if (beamSelection.primary.source_type !== 'weak_fallback') {
    fusionNotes.push(`Beam reference from ${beamSelection.primary.image_indices.length} image(s)`)
  }
  
  if (disagreementScore > 0.2) {
    fusionNotes.push('Significant reference quality variation across measurement families')
  }
  
  return {
    spread_primary: spreadSelection.primary,
    spread_backup: spreadSelection.backup,
    beam_primary: beamSelection.primary,
    beam_backup: beamSelection.backup,
    tine_primary: tineSelection.primary,
    tine_backup: tineSelection.backup,
    mass_primary: massSelection.primary,
    mass_backup: massSelection.backup,
    reference_disagreement_score: disagreementScore,
    overall_reference_quality: overallQuality,
    fusion_notes: fusionNotes,
    selection_reasons: selectionReasons,
  }
}

// ============================================================================
// PER-FAMILY SELECTION
// ============================================================================

interface FamilySelection {
  primary: ReferenceSourceSelection
  backup: ReferenceSourceSelection | null
}

function selectReferenceForFamily(
  family: MeasurementFamily,
  perImageQuality: ImageReferenceQuality[],
  fusedLandmarks: FusedLandmarkPackage,
  earsFullyVisible?: boolean,
  visionEarLength?: number,
  visionEyeDistance?: number
): FamilySelection {
  // Get the appropriate score for this family from each image
  const imageScores = perImageQuality.map(q => {
    let score = 0
    switch (family) {
      case 'spread': score = q.spread_reference_score; break
      case 'beam': score = q.beam_reference_score; break
      case 'tine': score = q.tine_reference_score; break
      case 'mass': score = q.mass_reference_score; break
      case 'asymmetry': score = q.asymmetry_reliability_score; break
      case 'deduction': score = (q.spread_reference_score + q.asymmetry_reliability_score) / 2; break
    }
    return { imageIndex: q.image_index, score, quality: q }
  })
  
  // Sort by score descending
  imageScores.sort((a, b) => b.score - a.score)
  
  // Determine available reference signals
  const hasEyeBox      = fusedLandmarks.estimated_eye_box_width !== null && fusedLandmarks.estimated_eye_box_height !== null
  const hasPedicle     = fusedLandmarks.estimated_pedicle_spacing !== null
  const hasEye2Pedicle = fusedLandmarks.estimated_eye_to_pedicle !== null
  const hasSkullWidth  = fusedLandmarks.estimated_skull_width !== null
  const hasNoseBridge  = fusedLandmarks.estimated_nose_bridge_length !== null
  const hasMuzzle      = fusedLandmarks.estimated_muzzle_width !== null
  const hasEarBaseSpacing = fusedLandmarks.estimated_ear_base_spacing !== null

  const hasStrongEar = earsFullyVisible === true ||
    (fusedLandmarks.estimated_ear_base_to_tip !== null &&
     fusedLandmarks.landmarks.left_ear_base &&
     fusedLandmarks.landmarks.right_ear_base)
  const hasPartialEar = !hasStrongEar &&
    (fusedLandmarks.landmarks.left_ear_base || fusedLandmarks.landmarks.right_ear_base)
  const hasEye = !!(fusedLandmarks.landmarks.left_eye_center && fusedLandmarks.landmarks.right_eye_center)

  // Priority order for each family — top-tier first, legacy as fallback
  const FAMILY_SOURCE_PRIORITY: Record<MeasurementFamily, ReferenceSourceSelection['source_type'][]> = {
    spread:    ['pedicle_spacing', 'skull_width', 'eye_box', 'eye_to_pedicle', 'ear_base_spacing', 'combined_ear_eye', 'ear_strong', 'ear_partial', 'eye', 'weak_fallback'],
    beam:      ['eye_to_pedicle', 'eye_box', 'pedicle_spacing', 'skull_width', 'combined_ear_eye', 'ear_strong', 'ear_partial', 'eye', 'weak_fallback'],
    tine:      ['eye_to_pedicle', 'eye_box', 'nose_bridge', 'combined_ear_eye', 'ear_strong', 'eye', 'ear_partial', 'weak_fallback'],
    mass:      ['skull_width', 'pedicle_spacing', 'ear_base_spacing', 'combined_ear_eye', 'ear_strong', 'eye', 'ear_partial', 'weak_fallback'],
    asymmetry: ['eye_box', 'pedicle_spacing', 'skull_width', 'combined_ear_eye', 'ear_strong', 'eye', 'weak_fallback'],
    deduction: ['eye_box', 'skull_width', 'combined_ear_eye', 'ear_strong', 'eye', 'ear_partial', 'weak_fallback'],
  }

  // Map signal booleans to source types
  const signalAvailable: Record<ReferenceSourceSelection['source_type'], boolean> = {
    eye_box:          hasEyeBox,
    pedicle_spacing:  hasPedicle,
    eye_to_pedicle:   hasEye2Pedicle,
    skull_width:      hasSkullWidth,
    nose_bridge:      hasNoseBridge,
    muzzle_width:     hasMuzzle,
    ear_base_spacing: hasEarBaseSpacing,
    ear_strong:       !!hasStrongEar,
    ear_partial:      !!hasPartialEar,
    eye:              hasEye,
    combined_ear_eye: !!(hasStrongEar && hasEye),
    weak_fallback:    true,
  }

  // Select the highest-priority available source for this family
  const priorityList = FAMILY_SOURCE_PRIORITY[family] ?? FAMILY_SOURCE_PRIORITY.beam
  let sourceType: ReferenceSourceSelection['source_type'] = 'weak_fallback'
  for (const candidate of priorityList) {
    if (signalAvailable[candidate]) {
      sourceType = candidate
      break
    }
  }
  
  // Calculate scaling factor
  const scalingFactor = computeScalingFactor(sourceType, fusedLandmarks, visionEarLength, visionEyeDistance)
  
  // Build primary selection
  const bestImages = imageScores.filter(s => s.score >= 0.3).slice(0, 3)
  const primaryConfidence = bestImages.length > 0
    ? bestImages.reduce((sum, s) => sum + s.score, 0) / bestImages.length
    : 0.2
  
  const primary: ReferenceSourceSelection = {
    source_type: sourceType,
    image_indices: bestImages.map(s => s.imageIndex),
    confidence: adjustConfidenceForFamily(family, primaryConfidence, sourceType),
    scaling_factor: scalingFactor,
    explanation: buildExplanation(family, sourceType, bestImages.length, primaryConfidence),
  }
  
  // Build backup selection (if different source type available)
  let backup: ReferenceSourceSelection | null = null
  const backupSourceType = getBackupSourceType(sourceType, !!hasStrongEar, !!hasPartialEar, hasEye, signalAvailable)
  
  if (backupSourceType && backupSourceType !== sourceType) {
    const backupScaling = computeScalingFactor(backupSourceType, fusedLandmarks, visionEarLength, visionEyeDistance)
    backup = {
      source_type: backupSourceType,
      image_indices: primary.image_indices.slice(0, 2), // reuse top images
      confidence: primary.confidence * 0.7, // backup is less confident
      scaling_factor: backupScaling,
      explanation: `Backup: ${backupSourceType.replace(/_/g, ' ')} reference`,
    }
  }
  
  return { primary, backup }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function computeScalingFactor(
  sourceType: ReferenceSourceSelection['source_type'],
  fusedLandmarks: FusedLandmarkPackage,
  visionEarLength?: number,
  visionEyeDistance?: number
): number {
  switch (sourceType) {
    // ── Top-tier
    case 'eye_box': {
      const boxW = fusedLandmarks.estimated_eye_box_width ?? ANATOMICAL_REFERENCES.EYE_BOX_WIDTH
      const boxH = fusedLandmarks.estimated_eye_box_height ?? ANATOMICAL_REFERENCES.EYE_BOX_HEIGHT
      return ((ANATOMICAL_REFERENCES.EYE_BOX_WIDTH / boxW) + (ANATOMICAL_REFERENCES.EYE_BOX_HEIGHT / boxH)) / 2
    }
    case 'pedicle_spacing': {
      const pd = fusedLandmarks.estimated_pedicle_spacing ?? ANATOMICAL_REFERENCES.PEDICLE_SPACING
      return ANATOMICAL_REFERENCES.PEDICLE_SPACING / pd
    }
    case 'eye_to_pedicle': {
      const e2p = fusedLandmarks.estimated_eye_to_pedicle ?? ANATOMICAL_REFERENCES.EYE_TO_PEDICLE
      return ANATOMICAL_REFERENCES.EYE_TO_PEDICLE / e2p
    }
    case 'skull_width': {
      const sw = fusedLandmarks.estimated_skull_width ?? ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH
      return ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH / sw
    }
    // ── Secondary
    case 'nose_bridge': {
      const nb = fusedLandmarks.estimated_nose_bridge_length ?? ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH
      return ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH / nb
    }
    case 'muzzle_width': {
      const mw = fusedLandmarks.estimated_muzzle_width ?? ANATOMICAL_REFERENCES.MUZZLE_WIDTH
      return ANATOMICAL_REFERENCES.MUZZLE_WIDTH / mw
    }
    case 'ear_base_spacing': {
      const ebs = fusedLandmarks.estimated_ear_base_spacing ?? ANATOMICAL_REFERENCES.EAR_BASE_SPACING
      return ANATOMICAL_REFERENCES.EAR_BASE_SPACING / ebs
    }
    // ── Legacy / compat
    case 'ear_strong':
    case 'ear_partial': {
      const earLength = visionEarLength ||
        fusedLandmarks.estimated_ear_base_to_tip ||
        ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      return ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earLength
    }
    case 'eye': {
      const eyeDistance = visionEyeDistance ||
        fusedLandmarks.estimated_eye_to_eye ||
        ANATOMICAL_REFERENCES.EYE_TO_EYE
      return ANATOMICAL_REFERENCES.EYE_TO_EYE / eyeDistance
    }
    case 'combined_ear_eye': {
      const earLength   = visionEarLength   || fusedLandmarks.estimated_ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      const eyeDistance = visionEyeDistance || fusedLandmarks.estimated_eye_to_eye      || ANATOMICAL_REFERENCES.EYE_TO_EYE
      const earScale    = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earLength
      const eyeScale    = ANATOMICAL_REFERENCES.EYE_TO_EYE      / eyeDistance
      // Eye gets more weight now as a top-tier reference
      return eyeScale * 0.55 + earScale * 0.45
    }
    case 'weak_fallback':
    default:
      return 1.0
  }
}

function adjustConfidenceForFamily(
  family: MeasurementFamily,
  baseConfidence: number,
  sourceType: ReferenceSourceSelection['source_type']
): number {
  let conf = baseConfidence
  
  // Source type adjustments
  switch (sourceType) {
    case 'combined_ear_eye': conf *= 1.05; break
    case 'ear_strong': conf *= 1.0; break
    case 'ear_partial': conf *= 0.85; break
    case 'eye': conf *= 0.80; break
    case 'weak_fallback': conf *= 0.5; break
  }
  
  // Family-specific adjustments
  switch (family) {
    case 'spread':
      // Spread benefits most from ear reference
      if (sourceType === 'ear_strong' || sourceType === 'combined_ear_eye') conf *= 1.05
      break
    case 'beam':
      // Beam is less dependent on ear reference
      if (sourceType === 'weak_fallback') conf *= 1.1 // slightly less penalty
      break
    case 'tine':
      // Tines are harder to measure accurately
      conf *= 0.95
      break
    case 'mass':
      // Mass estimation is inherently less precise
      conf *= 0.90
      break
  }
  
  return Math.max(0.15, Math.min(0.98, conf))
}

function getBackupSourceType(
  primary: ReferenceSourceSelection['source_type'],
  hasStrongEar: boolean,
  hasPartialEar: boolean,
  hasEye: boolean,
  signalAvailable?: Record<ReferenceSourceSelection['source_type'], boolean>
): ReferenceSourceSelection['source_type'] | null {
  // For top-tier sources, fall back to the next best top-tier then legacy
  const topTierFallbackChain: ReferenceSourceSelection['source_type'][] = [
    'eye_box', 'pedicle_spacing', 'eye_to_pedicle', 'skull_width',
    'combined_ear_eye', 'ear_strong', 'eye', 'ear_partial', 'ear_base_spacing',
    'nose_bridge', 'muzzle_width',
  ]
  if (signalAvailable) {
    for (const candidate of topTierFallbackChain) {
      if (candidate !== primary && signalAvailable[candidate]) {
        return candidate
      }
    }
    return null
  }

  // Legacy path (no signalAvailable map provided)
  if (primary === 'combined_ear_eye') return hasStrongEar ? 'ear_strong' : 'eye'
  if (primary === 'ear_strong' || primary === 'ear_partial') return hasEye ? 'eye' : null
  if (primary === 'eye') return hasStrongEar ? 'ear_strong' : hasPartialEar ? 'ear_partial' : null
  return null
}

function buildExplanation(
  family: MeasurementFamily,
  sourceType: ReferenceSourceSelection['source_type'],
  imageCount: number,
  confidence: number
): string {
  const sourceLabel = sourceType.replace(/_/g, ' ')
  const confPercent = Math.round(confidence * 100)
  
  let familyNote = ''
  switch (family) {
    case 'spread': familyNote = 'for inside spread measurement'; break
    case 'beam': familyNote = 'for main beam measurement'; break
    case 'tine': familyNote = 'for tine length measurement'; break
    case 'mass': familyNote = 'for circumference estimation'; break
    case 'asymmetry': familyNote = 'for asymmetry assessment'; break
    case 'deduction': familyNote = 'for deduction calculation'; break
  }
  
  return `Using ${sourceLabel} reference ${familyNote} (${confPercent}% confidence from ${imageCount} image${imageCount > 1 ? 's' : ''})`
}
