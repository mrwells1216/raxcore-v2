/**
 * Phase 42 / Extended: Reference Source Ranking System
 *
 * Implements a weighted consensus model across all available anatomical
 * reference candidates. Top-tier references (eye box, pedicle spacing,
 * eye-to-pedicle, skull width) drive the scale factor and error range.
 * Secondary references (nose, muzzle, ear base spacing) contribute to
 * confidence but don't dominate the blend. Ears are a bonus reference, not
 * the primary one.
 *
 * Exports a buildReferenceConsensus() function that returns a
 * ReferenceConsensusResult with full debug fields as requested.
 */

import type { LandmarksDetected, AngleType, DetailedLandmarks, ReferenceConsensusResult } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// TYPES
// ============================================================================

export type ReferenceSource =
  // Top-tier
  | 'eye_box'              // eye width + height (full box visible)
  | 'pedicle_spacing'      // antler base spacing on skull
  | 'eye_to_pedicle'       // eye-center to pedicle-base distance
  | 'skull_width'          // forehead / orbital-ridge width
  // Secondary
  | 'nose_bridge'          // nose bridge length
  | 'muzzle_width'         // muzzle width
  | 'ear_base_spacing'     // ear-base center-to-center (not tip-to-tip)
  // Legacy / existing — kept for compat
  | 'strong_ear'
  | 'partial_ear'
  | 'strong_eye'
  | 'combined_ear_eye'
  | 'weak_fallback'
  | 'none'

export type MeasurementFamily = 'spread' | 'beam' | 'tine' | 'mass' | 'deduction'

export interface ReferenceQuality {
  source: ReferenceSource
  confidence: number  // 0-1
  scalingFactor: number  // derived scale factor to convert pixels to inches
  contributingImages: number[]  // indices of images that contributed
  explanation: string
}

export interface ReferenceRanking {
  /** Primary reference used for overall scaling */
  primary: ReferenceQuality
  
  /** Fallback reference if primary is weak */
  fallback: ReferenceQuality | null
  
  /** Per-measurement-family reference assignments */
  familyReferences: Record<MeasurementFamily, ReferenceQuality>
  
  /** Overall reference reliability score */
  overallReliability: number
  
  /** Whether reference is sufficient for accurate scoring */
  isSufficient: boolean
  
  /** Warnings about reference quality */
  warnings: string[]
  
  /** Admin-readable ranking explanation */
  rankingExplanation: string[]
}

export interface ReferenceRankingInput {
  landmarks: LandmarksDetected
  detailedLandmarks?: DetailedLandmarks
  angleTypes: AngleType[]
  earsFullyVisible?: boolean
  visionReportedEarLength?: number
  visionReportedEyeDistance?: number
}

// ============================================================================
// REFERENCE CONFIDENCE SCORES
// ============================================================================

// Base reliability scores per reference type.
// Top-tier references score 0.80+; secondary 0.55–0.70; legacy/ears 0.60–0.75; fallback 0.35.
const REFERENCE_BASE_SCORES: Record<ReferenceSource, number> = {
  // Top-tier
  eye_box:          0.90,
  pedicle_spacing:  0.87,
  eye_to_pedicle:   0.85,
  skull_width:      0.82,
  // Secondary
  nose_bridge:      0.65,
  muzzle_width:     0.62,
  ear_base_spacing: 0.60,
  // Legacy (kept for compat)
  strong_ear:       0.75,
  combined_ear_eye: 0.80,
  partial_ear:      0.58,
  strong_eye:       0.72,
  weak_fallback:    0.35,
  none:             0.0,
}

// How much each reference contributes to the blended scale factor.
// Weights within the consensus blend — top-tier references carry more weight.
const REFERENCE_BLEND_WEIGHT: Record<ReferenceSource, number> = {
  eye_box:          0.30,
  pedicle_spacing:  0.28,
  eye_to_pedicle:   0.22,
  skull_width:      0.20,
  nose_bridge:      0.08,
  muzzle_width:     0.07,
  ear_base_spacing: 0.05,
  // Legacy
  strong_ear:       0.10,
  combined_ear_eye: 0.20,
  partial_ear:      0.06,
  strong_eye:       0.15,
  weak_fallback:    0.00,
  none:             0.00,
}

// Which reference is best for which measurement family
const FAMILY_REFERENCE_PRIORITY: Record<MeasurementFamily, ReferenceSource[]> = {
  spread:    ['pedicle_spacing', 'skull_width', 'eye_box', 'eye_to_pedicle', 'ear_base_spacing', 'strong_ear', 'combined_ear_eye', 'strong_eye', 'partial_ear', 'weak_fallback'],
  beam:      ['eye_to_pedicle', 'eye_box', 'pedicle_spacing', 'skull_width', 'combined_ear_eye', 'strong_ear', 'strong_eye', 'partial_ear', 'weak_fallback'],
  tine:      ['eye_to_pedicle', 'eye_box', 'nose_bridge', 'combined_ear_eye', 'strong_eye', 'partial_ear', 'strong_ear', 'weak_fallback'],
  mass:      ['skull_width', 'pedicle_spacing', 'ear_base_spacing', 'strong_ear', 'combined_ear_eye', 'partial_ear', 'strong_eye', 'weak_fallback'],
  deduction: ['eye_box', 'skull_width', 'combined_ear_eye', 'strong_ear', 'strong_eye', 'partial_ear', 'weak_fallback'],
}

// ============================================================================
// MAIN RANKING FUNCTION
// ============================================================================

export function rankReferenceSources(input: ReferenceRankingInput): ReferenceRanking {
  const { 
    landmarks, 
    detailedLandmarks, 
    angleTypes, 
    earsFullyVisible,
    visionReportedEarLength,
    visionReportedEyeDistance,
  } = input
  
  const warnings: string[] = []
  const rankingExplanation: string[] = []
  
  // Determine available reference sources
  const availableSources = determineAvailableSources(
    landmarks,
    detailedLandmarks,
    angleTypes,
    earsFullyVisible
  )
  
  rankingExplanation.push(`Available references: ${availableSources.join(', ') || 'none'}`)
  
  // Build reference quality for each available source
  const sourceQualities: Map<ReferenceSource, ReferenceQuality> = new Map()
  
  for (const source of availableSources) {
    const quality = buildReferenceQuality(
      source,
      landmarks,
      detailedLandmarks,
      angleTypes,
      visionReportedEarLength,
      visionReportedEyeDistance
    )
    sourceQualities.set(source, quality)
  }
  
  // Select primary reference (highest confidence available)
  let primary: ReferenceQuality
  let fallback: ReferenceQuality | null = null
  
  const sortedSources = Array.from(sourceQualities.entries())
    .sort((a, b) => b[1].confidence - a[1].confidence)
  
  if (sortedSources.length > 0) {
    primary = sortedSources[0][1]
    if (sortedSources.length > 1) {
      fallback = sortedSources[1][1]
    }
    rankingExplanation.push(`Primary reference: ${primary.source} (${(primary.confidence * 100).toFixed(0)}%)`)
  } else {
    primary = {
      source: 'weak_fallback',
      confidence: REFERENCE_BASE_SCORES.weak_fallback,
      scalingFactor: 1.0,
      contributingImages: [],
      explanation: 'No clear anatomical reference available; using statistical priors',
    }
    warnings.push('No clear anatomical reference detected — scaling accuracy will be limited')
    rankingExplanation.push('Using weak fallback reference based on statistical priors')
  }
  
  // Assign best available reference to each measurement family
  const familyReferences: Record<MeasurementFamily, ReferenceQuality> = {} as Record<MeasurementFamily, ReferenceQuality>
  
  for (const family of ['spread', 'beam', 'tine', 'mass', 'deduction'] as MeasurementFamily[]) {
    const priorityOrder = FAMILY_REFERENCE_PRIORITY[family]
    let assigned = false
    
    for (const preferredSource of priorityOrder) {
      if (sourceQualities.has(preferredSource)) {
        familyReferences[family] = sourceQualities.get(preferredSource)!
        assigned = true
        break
      }
    }
    
    if (!assigned) {
      familyReferences[family] = primary
    }
  }
  
  // Calculate overall reliability
  const familyConfidences = Object.values(familyReferences).map(r => r.confidence)
  const overallReliability = familyConfidences.reduce((a, b) => a + b, 0) / familyConfidences.length
  
  // Determine sufficiency
  const isSufficient = overallReliability >= 0.5 && primary.source !== 'weak_fallback'
  
  if (!isSufficient) {
    warnings.push('Reference quality is below threshold for high-confidence scoring')
  }
  
  // Add specific warnings
  if (!landmarks.ears_visible) {
    warnings.push('Ears not visible — primary anatomical reference unavailable')
  }
  if (!landmarks.eyes_visible) {
    warnings.push('Eyes not visible — secondary anatomical reference unavailable')
  }
  if (earsFullyVisible === false && landmarks.ears_visible) {
    warnings.push('Ears partially visible — ear-to-tip measurement may be inaccurate')
  }
  if (!angleTypes.includes('front')) {
    warnings.push('No front angle — spread reference quality reduced')
  }
  
  rankingExplanation.push(`Overall reliability: ${(overallReliability * 100).toFixed(0)}%`)
  rankingExplanation.push(`Reference sufficient: ${isSufficient ? 'yes' : 'no'}`)
  
  return {
    primary,
    fallback,
    familyReferences,
    overallReliability,
    isSufficient,
    warnings,
    rankingExplanation,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function determineAvailableSources(
  landmarks: LandmarksDetected,
  detailedLandmarks: DetailedLandmarks | undefined,
  angleTypes: AngleType[],
  earsFullyVisible?: boolean
): ReferenceSource[] {
  const sources: ReferenceSource[] = []
  const hasEars  = landmarks.ears_visible
  const hasEyes  = landmarks.eyes_visible
  const hasFront = angleTypes.includes('front')

  // ── Top-tier: eye box (full eye socket visible, front angle)
  if (hasEyes && hasFront && landmarks.eye_box_detected) {
    sources.push('eye_box')
  }

  // ── Top-tier: pedicle / antler base spacing
  if (landmarks.pedicle_visible && hasFront && landmarks.pedicle_spacing) {
    sources.push('pedicle_spacing')
  }

  // ── Top-tier: eye-to-pedicle structural proportion
  if (hasEyes && landmarks.pedicle_visible && landmarks.eye_to_pedicle_distance) {
    sources.push('eye_to_pedicle')
  }

  // ── Top-tier: skull / forehead width
  if (hasFront && landmarks.skull_width_visible && landmarks.skull_forehead_width) {
    sources.push('skull_width')
  }

  // ── Secondary: nose bridge
  if (hasFront && landmarks.nose_bridge_length) {
    sources.push('nose_bridge')
  }

  // ── Secondary: muzzle width
  if (hasFront && landmarks.muzzle_width) {
    sources.push('muzzle_width')
  }

  // ── Secondary: ear base spacing (bonus, not primary)
  if (hasEars && hasFront && landmarks.ear_base_spacing) {
    sources.push('ear_base_spacing')
  }

  // ── Legacy: strong/partial ear (kept for compat)
  if (hasEars && earsFullyVisible && hasFront) {
    sources.push('strong_ear')
  } else if (hasEars && (earsFullyVisible || hasFront)) {
    sources.push('partial_ear')
  }

  // ── Legacy: strong_eye
  if (hasEyes && hasFront && !sources.includes('eye_box')) {
    sources.push('strong_eye')
  }

  // ── Legacy: combined_ear_eye
  if (hasEars && hasEyes && hasFront) {
    sources.push('combined_ear_eye')
  }

  // ── If nothing was detected, fall back to statistical priors
  if (sources.length === 0) {
    sources.push('weak_fallback')
  }

  return sources
}

function buildReferenceQuality(
  source: ReferenceSource,
  landmarks: LandmarksDetected,
  detailedLandmarks: DetailedLandmarks | undefined,
  angleTypes: AngleType[],
  visionReportedEarLength?: number,
  visionReportedEyeDistance?: number
): ReferenceQuality {
  let confidence = REFERENCE_BASE_SCORES[source]
  let scalingFactor = 1.0
  const contributingImages: number[] = []
  let explanation = ''
  
  // Adjust confidence based on detailed landmark quality if available
  if (detailedLandmarks) {
    const qualityBonus = {
      excellent: 0.05,
      good: 0.02,
      fair: -0.05,
      poor: -0.15,
    }[detailedLandmarks.overall_quality] || 0
    
    confidence = Math.max(0, Math.min(1, confidence + qualityBonus))
  }
  
  // Calculate scaling factor based on reference type
  switch (source) {
    case 'eye_box': {
      const detectedEyeW = landmarks.eye_width ?? ANATOMICAL_REFERENCES.EYE_BOX_WIDTH
      const detectedEyeH = landmarks.eye_height ?? ANATOMICAL_REFERENCES.EYE_BOX_HEIGHT
      const scaleW = ANATOMICAL_REFERENCES.EYE_BOX_WIDTH / detectedEyeW
      const scaleH = ANATOMICAL_REFERENCES.EYE_BOX_HEIGHT / detectedEyeH
      scalingFactor = (scaleW + scaleH) / 2
      explanation = `Eye box scaling (w: ${detectedEyeW.toFixed(2)}", h: ${detectedEyeH.toFixed(2)}", factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'pedicle_spacing': {
      const detectedPedicle = landmarks.pedicle_spacing ?? ANATOMICAL_REFERENCES.PEDICLE_SPACING
      scalingFactor = ANATOMICAL_REFERENCES.PEDICLE_SPACING / detectedPedicle
      explanation = `Pedicle spacing scaling (${detectedPedicle.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.PEDICLE_SPACING}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'eye_to_pedicle': {
      const detectedE2P = landmarks.eye_to_pedicle_distance ?? ANATOMICAL_REFERENCES.EYE_TO_PEDICLE
      scalingFactor = ANATOMICAL_REFERENCES.EYE_TO_PEDICLE / detectedE2P
      explanation = `Eye-to-pedicle scaling (${detectedE2P.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.EYE_TO_PEDICLE}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'skull_width': {
      const detectedSkull = landmarks.skull_forehead_width ?? ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH
      scalingFactor = ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH / detectedSkull
      explanation = `Skull width scaling (${detectedSkull.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'nose_bridge': {
      const detectedNose = landmarks.nose_bridge_length ?? ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH
      scalingFactor = ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH / detectedNose
      explanation = `Nose bridge scaling (${detectedNose.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'muzzle_width': {
      const detectedMuzzle = landmarks.muzzle_width ?? ANATOMICAL_REFERENCES.MUZZLE_WIDTH
      scalingFactor = ANATOMICAL_REFERENCES.MUZZLE_WIDTH / detectedMuzzle
      explanation = `Muzzle width scaling (${detectedMuzzle.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.MUZZLE_WIDTH}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'ear_base_spacing': {
      const detectedEarBase = landmarks.ear_base_spacing ?? ANATOMICAL_REFERENCES.EAR_BASE_SPACING
      scalingFactor = ANATOMICAL_REFERENCES.EAR_BASE_SPACING / detectedEarBase
      explanation = `Ear base spacing scaling (${detectedEarBase.toFixed(2)}" detected vs ${ANATOMICAL_REFERENCES.EAR_BASE_SPACING}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'strong_ear':
    case 'partial_ear': {
      const earLength = visionReportedEarLength || landmarks.ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      scalingFactor = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earLength
      explanation = `Ear base-to-tip scaling (${earLength.toFixed(1)}" detected vs ${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'strong_eye': {
      const eyeDistance = visionReportedEyeDistance || landmarks.eye_to_eye || ANATOMICAL_REFERENCES.EYE_TO_EYE
      scalingFactor = ANATOMICAL_REFERENCES.EYE_TO_EYE / eyeDistance
      explanation = `Eye-to-eye scaling (${eyeDistance.toFixed(1)}" detected vs ${ANATOMICAL_REFERENCES.EYE_TO_EYE}" expected, factor: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'combined_ear_eye': {
      const earRef  = visionReportedEarLength  || landmarks.ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      const eyeRef  = visionReportedEyeDistance || landmarks.eye_to_eye      || ANATOMICAL_REFERENCES.EYE_TO_EYE
      const earScale = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earRef
      const eyeScale = ANATOMICAL_REFERENCES.EYE_TO_EYE      / eyeRef
      // Eye gets more weight now that it is a first-class reference
      scalingFactor = eyeScale * 0.55 + earScale * 0.45
      explanation = `Combined eye+ear scaling (eye: ${eyeScale.toFixed(2)}x, ear: ${earScale.toFixed(2)}x, blended: ${scalingFactor.toFixed(3)}x)`
      break
    }
    case 'weak_fallback':
      scalingFactor = 1.0
      explanation = 'No clear reference; using statistical priors for typical whitetail proportions'
      break
    case 'none':
      scalingFactor = 1.0
      explanation = 'No anatomical reference available'
      break
  }
  
  // Identify contributing images
  if (angleTypes.includes('front')) {
    contributingImages.push(angleTypes.indexOf('front'))
  }
  if (source.includes('ear') && angleTypes.includes('left')) {
    contributingImages.push(angleTypes.indexOf('left'))
  }
  if (source.includes('ear') && angleTypes.includes('right')) {
    contributingImages.push(angleTypes.indexOf('right'))
  }
  
  return {
    source,
    confidence,
    scalingFactor,
    contributingImages,
    explanation,
  }
}

// ============================================================================
// WEIGHTED CONSENSUS MODEL
// ============================================================================

export interface BuildReferenceConsensusInput {
  landmarks: LandmarksDetected
  detailedLandmarks?: DetailedLandmarks
  angleTypes: AngleType[]
  earsFullyVisible?: boolean
  visionReportedEarLength?: number
  visionReportedEyeDistance?: number
}

/**
 * Build a weighted consensus scaling factor from all available anatomical
 * references. Top-tier references (eye box, pedicle, eye-to-pedicle, skull)
 * drive the blend; secondary references influence confidence but are weighted
 * lightly. Ears are treated as a bonus contributor.
 *
 * Returns a ReferenceConsensusResult with full debug fields.
 */
export function buildReferenceConsensus(
  input: BuildReferenceConsensusInput
): ReferenceConsensusResult {
  const { landmarks, detailedLandmarks, angleTypes, earsFullyVisible, visionReportedEarLength, visionReportedEyeDistance } = input

  const availableSources = determineAvailableSources(landmarks, detailedLandmarks, angleTypes, earsFullyVisible)

  // Build quality objects for all available sources
  const qualities = new Map<ReferenceSource, ReferenceQuality>()
  for (const src of availableSources) {
    qualities.set(
      src,
      buildReferenceQuality(src, landmarks, detailedLandmarks, angleTypes, visionReportedEarLength, visionReportedEyeDistance)
    )
  }

  // Separate top-tier from secondary/legacy
  const topTierSources: ReferenceSource[] = ['eye_box', 'pedicle_spacing', 'eye_to_pedicle', 'skull_width']
  const secondarySources: ReferenceSource[] = ['nose_bridge', 'muzzle_width', 'ear_base_spacing']
  const earSources: ReferenceSource[] = ['strong_ear', 'combined_ear_eye', 'partial_ear']

  const activeTopTier  = topTierSources.filter(s  => qualities.has(s))
  const activeSecondary = secondarySources.filter(s => qualities.has(s))
  const activeEar      = earSources.filter(s       => qualities.has(s))

  // Compute weighted blend of scaling factors
  let totalWeight = 0
  let weightedScaleSum = 0
  const contributingScales: number[] = []

  for (const [src, q] of qualities.entries()) {
    const w = REFERENCE_BLEND_WEIGHT[src]
    if (w > 0 && src !== 'weak_fallback' && src !== 'none') {
      weightedScaleSum += q.scalingFactor * w
      totalWeight += w
      contributingScales.push(q.scalingFactor)
    }
  }

  const blendedScalingFactor = totalWeight > 0 ? weightedScaleSum / totalWeight : 1.0

  // Agreement / conflict scores from standard deviation of scale factors
  let agreementScore = 1.0
  let conflictScore = 0.0
  if (contributingScales.length > 1) {
    const mean = contributingScales.reduce((a, b) => a + b, 0) / contributingScales.length
    const stdDev = Math.sqrt(
      contributingScales.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / contributingScales.length
    )
    // stdDev of 0.1 (10% scale spread) ≈ full conflict
    conflictScore  = Math.min(1.0, stdDev / 0.1)
    agreementScore = 1.0 - conflictScore
  }

  // Blend quality tier
  let blendQuality: ReferenceConsensusResult['referenceBlendQuality'] = 'fallback'
  if (activeTopTier.length >= 2 && agreementScore >= 0.8) {
    blendQuality = 'strong'
  } else if (activeTopTier.length >= 1 && agreementScore >= 0.6) {
    blendQuality = 'moderate'
  } else if (activeTopTier.length >= 1 || activeSecondary.length >= 2) {
    blendQuality = 'weak'
  }

  // Blended confidence: base from best top-tier, modified by agreement
  const topTierConfidences = activeTopTier.map(s => qualities.get(s)!.confidence)
  const baseConfidence = topTierConfidences.length > 0
    ? Math.max(...topTierConfidences)
    : (activeSecondary.length > 0 ? 0.52 : 0.35)
  const blendedConfidence = Math.max(0.15, Math.min(0.98, baseConfidence * (0.6 + agreementScore * 0.4)))

  // Debug flags
  const eyeReferenceUsed        = qualities.has('eye_box') || qualities.has('strong_eye')
  const antlerBaseReferenceUsed = qualities.has('pedicle_spacing')
  const eyeToBaseReferenceUsed  = qualities.has('eye_to_pedicle')
  const skullWidthReferenceUsed = qualities.has('skull_width')
  const noseReferenceUsed       = qualities.has('nose_bridge') || qualities.has('muzzle_width')
  const earReferenceUsed        = activeEar.length > 0 || qualities.has('ear_base_spacing')

  // Summary strings
  const referencesSummary: string[] = []
  for (const [src, q] of qualities.entries()) {
    if (src !== 'weak_fallback' && src !== 'none') {
      referencesSummary.push(`${src}: ${(q.confidence * 100).toFixed(0)}% conf, scale ${q.scalingFactor.toFixed(3)}x`)
    }
  }
  if (referencesSummary.length === 0) {
    referencesSummary.push('No reliable anatomical reference — statistical prior used')
  }

  // Whether range was tightened (multiple top-tier agreed) or widened (conflict)
  const rangeTightened = activeTopTier.length >= 2 && agreementScore >= 0.8
  const rangeWidened   = conflictScore >= 0.4

  return {
    blendedScalingFactor,
    referenceAgreementScore: Number(agreementScore.toFixed(3)),
    referenceConflictScore:  Number(conflictScore.toFixed(3)),
    referenceBlendQuality:   blendQuality,
    blendedConfidence:       Number(blendedConfidence.toFixed(3)),
    eyeReferenceUsed,
    antlerBaseReferenceUsed,
    eyeToBaseReferenceUsed,
    skullWidthReferenceUsed,
    noseReferenceUsed,
    earReferenceUsed,
    referencesSummary,
    rangeTightened,
    rangeWidened,
  }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get the reference source name in human-readable format
 */
export function getReferenceSourceLabel(source: ReferenceSource): string {
  const labels: Record<ReferenceSource, string> = {
    strong_ear: 'Strong Ear Reference',
    partial_ear: 'Partial Ear Reference',
    strong_eye: 'Strong Eye Reference',
    combined_ear_eye: 'Combined Ear+Eye Reference',
    weak_fallback: 'Weak Fallback (Statistical)',
    none: 'No Reference',
  }
  return labels[source]
}

/**
 * Get confidence tier for reference quality
 */
export function getReferenceConfidenceTier(
  quality: ReferenceQuality
): 'excellent' | 'good' | 'fair' | 'poor' {
  if (quality.confidence >= 0.85) return 'excellent'
  if (quality.confidence >= 0.65) return 'good'
  if (quality.confidence >= 0.45) return 'fair'
  return 'poor'
}

/**
 * Convert ranking to metadata for storage
 */
export function referenceRankingToMetadata(
  ranking: ReferenceRanking
): Record<string, unknown> {
  return {
    primary_source: ranking.primary.source,
    primary_confidence: ranking.primary.confidence,
    fallback_source: ranking.fallback?.source || null,
    overall_reliability: ranking.overallReliability,
    is_sufficient: ranking.isSufficient,
    warning_count: ranking.warnings.length,
    family_sources: Object.fromEntries(
      Object.entries(ranking.familyReferences).map(([k, v]) => [k, {
        source: v.source,
        confidence: v.confidence,
      }])
    ),
  }
}

/**
 * Get a summary string for display
 */
export function getReferenceRankingSummary(ranking: ReferenceRanking): string {
  const primaryLabel = getReferenceSourceLabel(ranking.primary.source)
  const confidence = Math.round(ranking.primary.confidence * 100)
  
  if (ranking.isSufficient) {
    return `${primaryLabel} (${confidence}% confidence) — sufficient for accurate scaling`
  }
  
  return `${primaryLabel} (${confidence}% confidence) — limited reference quality may affect accuracy`
}
