/**
 * Phase 45: Geometry-First Landmark + Reference Engine
 * 
 * Main pipeline orchestrator that coordinates all landmark/reference
 * extraction, scoring, fusion, and geometry refinement stages.
 */

import type { Measurements, AngleType, LandmarksDetected } from '@/lib/types'
import type {
  Phase45PipelineResult,
  Phase45StorageSummary,
  ImageLandmarkPackage,
  ImageReferenceQuality,
  FusedLandmarkPackage,
  ReferenceFusionResult,
  GeometryRefinementResult,
} from './types'

import { extractLandmarks, type LandmarkExtractionInput, type ImageForLandmarkExtraction } from './extract'
import { scoreAllImageReferences } from './score'
import { fuseReferences } from '@/lib/scoring/geometry/reference-fusion'
import { refineGeometry } from '@/lib/scoring/geometry/refine'
import { refineMeasurementFamilies, type MeasurementFamilyRefinementOutput } from '@/lib/scoring/geometry/consistency'

// Re-export types
export * from './types'
export { extractLandmarks } from './extract'
export { scoreAllImageReferences, scoreImageReference } from './score'

// ============================================================================
// PIPELINE VERSION
// ============================================================================

export const PHASE_45_PIPELINE_VERSION = '45.1.0'

// ============================================================================
// MAIN PIPELINE INPUT
// ============================================================================

export interface Phase45PipelineInput {
  images: {
    imageUrl: string
    angleType: AngleType
    width: number
    height: number
  }[]
  measurements: Measurements
  visionLandmarks?: LandmarksDetected
  earsFullyVisible?: boolean
  mainFramePoints?: number
  sourceType?: string
  captureDevice?: string
  visionEarLength?: number
  visionEyeDistance?: number
}

// ============================================================================
// MAIN PIPELINE FUNCTION
// ============================================================================

/**
 * Run the complete Phase 45 geometry-first landmark + reference pipeline.
 * 
 * Pipeline stages:
 * 1. Per-image landmark extraction
 * 2. Per-image reference quality scoring
 * 3. Landmark fusion across images
 * 4. Reference source fusion
 * 5. Geometry-aware refinement
 * 6. Measurement-family refinement (optional)
 * 
 * @returns Complete pipeline result with all intermediate data
 */
export function runPhase45Pipeline(input: Phase45PipelineInput): Phase45PipelineResult {
  const startTime = Date.now()
  const {
    images,
    measurements,
    visionLandmarks,
    earsFullyVisible,
    mainFramePoints,
    sourceType,
    captureDevice,
    visionEarLength,
    visionEyeDistance,
  } = input
  
  // ========== STAGE 1: Per-Image Landmark Extraction ==========
  const extractionInput: LandmarkExtractionInput = {
    images: images.map((img, i) => ({
      imageUrl: img.imageUrl,
      angleType: img.angleType,
      width: img.width,
      height: img.height,
      index: i,
    })),
    visionLandmarks,
    earsFullyVisible,
    mainFramePoints,
    sourceType,
  }
  
  const { perImagePackages, fusedPackage } = extractLandmarks(extractionInput)
  
  // ========== STAGE 2: Per-Image Reference Quality Scoring ==========
  const perImageQuality = scoreAllImageReferences(
    perImagePackages,
    sourceType,
    captureDevice,
    earsFullyVisible
  )
  
  // ========== STAGE 3: Fused Landmarks (already done in extractLandmarks) ==========
  // fusedPackage contains the multi-image fused landmarks
  
  // ========== STAGE 4: Reference Fusion ==========
  const referenceFusion = fuseReferences({
    perImageQuality,
    fusedLandmarks: fusedPackage,
    earsFullyVisible,
    visionEarLength,
    visionEyeDistance,
  })
  
  // ========== STAGE 5: Geometry-Aware Refinement ==========
  const angleTypes = images.map(img => img.angleType)
  const geometryRefinement = refineGeometry({
    measurements,
    fusedLandmarks: fusedPackage,
    referenceFusion,
    angleTypes,
    earsFullyVisible,
  })
  
  // ========== STAGE 6: Measurement-Family Refinement ==========
  const familyRefinement = refineMeasurementFamilies({
    measurements,
    geometryResult: geometryRefinement,
    referenceFusion,
  })
  
  // ========== BUILD RESULT ==========
  const processingTimeMs = Date.now() - startTime
  
  // Build storage summary
  const storageSummary = buildStorageSummary(
    fusedPackage,
    referenceFusion,
    geometryRefinement,
    familyRefinement
  )
  
  return {
    per_image_landmarks: perImagePackages,
    per_image_reference_quality: perImageQuality,
    fused_landmarks: fusedPackage,
    reference_fusion: referenceFusion,
    geometry_refinement: geometryRefinement,
    pipeline_version: PHASE_45_PIPELINE_VERSION,
    processing_time_ms: processingTimeMs,
    images_processed: images.length,
    summary_for_storage: storageSummary,
  }
}

// ============================================================================
// STORAGE SUMMARY BUILDER
// ============================================================================

function buildStorageSummary(
  fusedLandmarks: FusedLandmarkPackage,
  referenceFusion: ReferenceFusionResult,
  geometry: GeometryRefinementResult,
  familyRefinement: MeasurementFamilyRefinementOutput
): Phase45StorageSummary {
  return {
    landmark_coverage: fusedLandmarks.landmark_coverage,
    fusion_quality: fusedLandmarks.fusion_quality,
    reference_quality: referenceFusion.overall_reference_quality,
    geometry_consistency: geometry.geometry_consistency_score,
    geometry_tier: geometry.geometry_tier,
    asymmetry_likely_real: geometry.asymmetry_analysis.is_likely_real,
    asymmetry_cause: geometry.asymmetry_analysis.apparent_cause,
    critical_flags_count: geometry.geometry_flags.filter(f => f.severity === 'critical').length,
    warning_flags_count: geometry.geometry_flags.filter(f => f.severity === 'warning').length,
    confidence_adjustment: geometry.confidence_penalty,
    family_trust_penalties: familyRefinement.familyTrust,
    processed_at: new Date().toISOString(),
    pipeline_version: PHASE_45_PIPELINE_VERSION,
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check if Phase 45 pipeline should run based on available data
 */
export function shouldRunPhase45(
  images: { angleType: AngleType }[],
  hasVisionResult: boolean
): boolean {
  // Always run Phase 45 if we have at least one image and vision succeeded
  return images.length > 0 && hasVisionResult
}

/**
 * Convert Phase 45 result to the existing Phase42Metadata format for compatibility
 */
export function phase45ToPhase42Metadata(
  result: Phase45PipelineResult
): import('@/lib/types').Phase42Metadata {
  const geo = result.geometry_refinement
  const ref = result.reference_fusion
  const lm = result.fused_landmarks
  
  // Map Phase 45 reference source to Phase 42 format
  const mapSource = (src: string): import('@/lib/types').ReferenceSourceType => {
    switch (src) {
      case 'ear_strong': return 'strong_ear'
      case 'ear_partial': return 'partial_ear'
      case 'eye': return 'strong_eye'
      case 'combined_ear_eye': return 'combined_ear_eye'
      default: return 'weak_fallback'
    }
  }
  
  return {
    enhanced_landmarks: {
      ear_base_quality: lm.per_image_packages[0]?.ear_detection_quality.tier ?? 'missing',
      ear_tip_quality: lm.per_image_packages[0]?.ear_detection_quality.tier ?? 'missing',
      eye_quality: lm.per_image_packages[0]?.eye_detection_quality.tier ?? 'missing',
      skull_symmetry_quality: 'fair', // derived
      beam_tip_visibility: lm.per_image_packages[0]?.antler_detection_quality.tier ?? 'missing',
      brow_tine_visibility: lm.per_image_packages[0]?.tine_detection_quality.tier ?? 'missing',
      inside_spread_visibility: lm.landmarks.inside_spread_anchor_left ? 'good' : 'fair',
      ear_base_confidence: lm.per_image_packages[0]?.landmarks.left_ear_base?.confidence ?? 0,
      ear_tip_confidence: lm.per_image_packages[0]?.landmarks.left_ear_tip?.confidence ?? 0,
      eye_confidence: lm.per_image_packages[0]?.landmarks.left_eye_center?.confidence ?? 0,
      beam_tip_confidence: lm.per_image_packages[0]?.landmarks.left_main_beam_tip?.confidence ?? 0,
      overall_quality: lm.fusion_quality === 'excellent' ? 'excellent' : 
                       lm.fusion_quality === 'good' ? 'good' :
                       lm.fusion_quality === 'fair' ? 'fair' : 'poor',
      overall_confidence: lm.cross_image_agreement,
      best_frontal_image: lm.per_image_packages.find(p => p.angle_type === 'front')?.image_index ?? null,
      best_side_images: lm.per_image_packages
        .filter(p => p.angle_type === 'left' || p.angle_type === 'right')
        .map(p => p.image_index),
    },
    reference_ranking: {
      primary_source: mapSource(ref.spread_primary.source_type),
      primary_confidence: ref.spread_primary.confidence,
      fallback_source: ref.spread_backup ? mapSource(ref.spread_backup.source_type) : null,
      fallback_confidence: ref.spread_backup?.confidence ?? null,
      overall_reliability: ref.overall_reference_quality,
      is_sufficient: ref.spread_primary.confidence >= 0.5,
      spread_reference: mapSource(ref.spread_primary.source_type),
      beam_reference: mapSource(ref.beam_primary.source_type),
      tine_reference: mapSource(ref.tine_primary.source_type),
      mass_reference: mapSource(ref.mass_primary.source_type),
      warnings: ref.fusion_notes,
    },
    geometry_consistency: {
      consistency_score: geo.geometry_consistency_score,
      tier: geo.geometry_tier,
      confidence_adjustment: geo.confidence_penalty,
      critical_flags: geo.geometry_flags.filter(f => f.severity === 'critical').length,
      warning_flags: geo.geometry_flags.filter(f => f.severity === 'warning').length,
      info_flags: geo.geometry_flags.filter(f => f.severity === 'info').length,
      measurement_trust_penalties: geo.family_trust_penalties,
      asymmetry_likely_real: geo.asymmetry_analysis.is_likely_real,
      asymmetry_cause: geo.asymmetry_analysis.apparent_cause,
      asymmetry_divergence: geo.asymmetry_analysis.overall_asymmetry_percent / 100,
      summary: geo.summary,
      flags: geo.geometry_flags.map(f => ({
        id: f.id,
        category: f.category,
        severity: f.severity,
        field: f.field,
        message: f.message,
      })),
    },
    phase42_version: PHASE_45_PIPELINE_VERSION,
    processed_at: result.summary_for_storage.processed_at,
  }
}

/**
 * Get a human-readable summary of the Phase 45 result
 */
export function getPhase45Summary(result: Phase45PipelineResult): string {
  const geo = result.geometry_refinement
  const ref = result.reference_fusion
  
  const parts: string[] = []
  
  // Geometry tier
  parts.push(`Geometry: ${geo.geometry_tier}`)
  
  // Reference quality
  const refQual = Math.round(ref.overall_reference_quality * 100)
  parts.push(`Reference: ${refQual}%`)
  
  // Flags
  const criticalCount = geo.geometry_flags.filter(f => f.severity === 'critical').length
  const warningCount = geo.geometry_flags.filter(f => f.severity === 'warning').length
  if (criticalCount > 0) parts.push(`${criticalCount} critical`)
  if (warningCount > 0) parts.push(`${warningCount} warnings`)
  
  // Asymmetry
  if (geo.asymmetry_analysis.overall_asymmetry_percent > 10) {
    const cause = geo.asymmetry_analysis.apparent_cause.replace(/_/g, ' ')
    parts.push(`Asymmetry: ${cause}`)
  }
  
  return parts.join(' | ')
}
