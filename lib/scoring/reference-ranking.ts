/**
 * Phase 42: Reference Source Ranking System
 * 
 * Implements a ranked reference system for anatomical scaling and geometry checks.
 * Determines which reference points (ears, eyes, combined) were most trusted
 * for each measurement type in a given prediction.
 */

import type { LandmarksDetected, AngleType, DetailedLandmarks } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

// ============================================================================
// TYPES
// ============================================================================

export type ReferenceSource = 
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

const REFERENCE_BASE_SCORES: Record<ReferenceSource, number> = {
  strong_ear: 0.95,
  combined_ear_eye: 0.88,
  partial_ear: 0.70,
  strong_eye: 0.65,
  weak_fallback: 0.35,
  none: 0.0,
}

// Which reference is best for which measurement family
const FAMILY_REFERENCE_PRIORITY: Record<MeasurementFamily, ReferenceSource[]> = {
  spread: ['strong_ear', 'combined_ear_eye', 'strong_eye', 'partial_ear', 'weak_fallback'],
  beam: ['combined_ear_eye', 'strong_ear', 'strong_eye', 'partial_ear', 'weak_fallback'],
  tine: ['combined_ear_eye', 'strong_eye', 'partial_ear', 'strong_ear', 'weak_fallback'],
  mass: ['strong_ear', 'combined_ear_eye', 'partial_ear', 'strong_eye', 'weak_fallback'],
  deduction: ['combined_ear_eye', 'strong_ear', 'strong_eye', 'partial_ear', 'weak_fallback'],
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
  
  const hasEars = landmarks.ears_visible
  const hasEyes = landmarks.eyes_visible
  const hasFront = angleTypes.includes('front')
  
  // Strong ear reference: ears fully visible + front angle + detailed landmarks
  if (hasEars && earsFullyVisible && hasFront) {
    sources.push('strong_ear')
  } else if (hasEars && (earsFullyVisible || hasFront)) {
    sources.push('partial_ear')
  }
  
  // Eye reference
  if (hasEyes && hasFront) {
    sources.push('strong_eye')
  }
  
  // Combined reference: both ear and eye available
  if (hasEars && hasEyes && hasFront) {
    sources.push('combined_ear_eye')
  }
  
  // If nothing else, add weak fallback
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
    case 'strong_ear':
    case 'partial_ear':
      const earLength = visionReportedEarLength || landmarks.ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      scalingFactor = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earLength
      explanation = `Scaling from ear base-to-tip (${earLength.toFixed(1)}" detected vs ${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}" expected)`
      break
      
    case 'strong_eye':
      const eyeDistance = visionReportedEyeDistance || landmarks.eye_to_eye || ANATOMICAL_REFERENCES.EYE_TO_EYE
      scalingFactor = ANATOMICAL_REFERENCES.EYE_TO_EYE / eyeDistance
      explanation = `Scaling from eye-to-eye distance (${eyeDistance.toFixed(1)}" detected vs ${ANATOMICAL_REFERENCES.EYE_TO_EYE}" expected)`
      break
      
    case 'combined_ear_eye':
      const earRef = visionReportedEarLength || landmarks.ear_base_to_tip || ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP
      const eyeRef = visionReportedEyeDistance || landmarks.eye_to_eye || ANATOMICAL_REFERENCES.EYE_TO_EYE
      const earScale = ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP / earRef
      const eyeScale = ANATOMICAL_REFERENCES.EYE_TO_EYE / eyeRef
      // Weighted average favoring ears (more reliable)
      scalingFactor = earScale * 0.65 + eyeScale * 0.35
      explanation = `Combined ear+eye scaling (ear: ${earScale.toFixed(2)}x, eye: ${eyeScale.toFixed(2)}x, blended: ${scalingFactor.toFixed(2)}x)`
      break
      
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
