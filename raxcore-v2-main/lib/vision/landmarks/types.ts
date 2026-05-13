/**
 * Phase 45: Geometry-First Landmark + Reference Engine
 * Type definitions for structured landmark and reference handling
 */

// ============================================================================
// LANDMARK POINT SCHEMA
// ============================================================================

export type LandmarkDerivation = 'model' | 'heuristic' | 'fused' | 'interpolated'

export interface LandmarkPoint45 {
  x: number                      // normalized 0-1 position in image
  y: number                      // normalized 0-1 position in image
  confidence: number             // 0-1 confidence score
  visible: boolean               // whether landmark is actually visible
  derived_from: LandmarkDerivation
  source_image_index: number     // which image this came from
  notes?: string                 // optional notes about detection
}

// ============================================================================
// LANDMARK CATEGORIES
// ============================================================================

export type AnatomicalLandmarkId =
  | 'left_ear_base'
  | 'left_ear_tip'
  | 'right_ear_base'
  | 'right_ear_tip'
  | 'left_eye_center'
  | 'right_eye_center'
  | 'nose_tip'
  | 'skull_centerline_estimate'
  | 'left_burr_or_antler_base'
  | 'right_burr_or_antler_base'
  | 'left_main_beam_tip'
  | 'right_main_beam_tip'
  | 'inside_spread_anchor_left'
  | 'inside_spread_anchor_right'

export type TineLandmarkId =
  | 'left_g1_base' | 'left_g1_tip'
  | 'left_g2_base' | 'left_g2_tip'
  | 'left_g3_base' | 'left_g3_tip'
  | 'left_g4_base' | 'left_g4_tip'
  | 'left_g5_base' | 'left_g5_tip'
  | 'right_g1_base' | 'right_g1_tip'
  | 'right_g2_base' | 'right_g2_tip'
  | 'right_g3_base' | 'right_g3_tip'
  | 'right_g4_base' | 'right_g4_tip'
  | 'right_g5_base' | 'right_g5_tip'

export type AllLandmarkId = AnatomicalLandmarkId | TineLandmarkId

// ============================================================================
// PER-IMAGE LANDMARK PACKAGE
// ============================================================================

export interface ImageLandmarkPackage {
  image_index: number
  angle_type: import('@/lib/types').AngleType
  
  // All detected landmarks for this image
  landmarks: Partial<Record<AllLandmarkId, LandmarkPoint45>>
  
  // Summary statistics
  detected_count: number
  total_possible: number
  coverage_percent: number
  
  // Derived quality metrics
  ear_detection_quality: LandmarkQualityScore
  eye_detection_quality: LandmarkQualityScore
  antler_detection_quality: LandmarkQualityScore
  tine_detection_quality: LandmarkQualityScore
  
  // Image-level issues
  issues: LandmarkIssue[]
  
  // Processing metadata
  extraction_method: 'vision_model' | 'heuristic' | 'hybrid'
  processing_time_ms: number
}

export interface LandmarkQualityScore {
  score: number       // 0-1
  tier: 'excellent' | 'good' | 'fair' | 'poor' | 'missing'
  reason: string
}

export interface LandmarkIssue {
  type: 'occlusion' | 'crop' | 'blur' | 'low_confidence' | 'conflict' | 'missing'
  severity: 'info' | 'warning' | 'critical'
  affected_landmarks: AllLandmarkId[]
  message: string
}

// ============================================================================
// PER-IMAGE REFERENCE QUALITY SCORES
// ============================================================================

export interface ImageReferenceQuality {
  image_index: number
  angle_type: import('@/lib/types').AngleType
  
  // Per-measurement-family reference scores
  spread_reference_score: number         // 0-1
  beam_reference_score: number           // 0-1
  tine_reference_score: number           // 0-1
  mass_reference_score: number           // 0-1
  asymmetry_reliability_score: number    // 0-1
  overall_reference_score: number        // 0-1
  
  // Input signals that fed into these scores
  signals: ReferenceSignals
  
  // Recommendations
  best_for: MeasurementFamily[]
  weak_for: MeasurementFamily[]
  reason_notes: string[]
}

export type MeasurementFamily = 'spread' | 'beam' | 'tine' | 'mass' | 'asymmetry' | 'deduction'

export interface ReferenceSignals {
  angle_class: 'frontal' | 'side_left' | 'side_right' | '45_left' | '45_right' | 'back' | 'unknown'
  angle_quality: number                   // 0-1
  ear_visibility: 'both_full' | 'both_partial' | 'one_only' | 'none'
  eye_visibility: 'both' | 'one_only' | 'none'
  beam_tip_visibility: 'both' | 'left_only' | 'right_only' | 'none'
  tine_visibility: 'excellent' | 'good' | 'partial' | 'poor' | 'none'
  crop_risk: 'none' | 'low' | 'medium' | 'high'
  occlusion_risk: 'none' | 'low' | 'medium' | 'high'
  source_type: string
  lighting_quality: 'excellent' | 'good' | 'fair' | 'poor'
  landmark_confidence_avg: number
}

// ============================================================================
// FUSED LANDMARK PACKAGE (MULTI-IMAGE)
// ============================================================================

export interface FusedLandmarkPackage {
  // Best-estimate landmarks across all images
  landmarks: Partial<Record<AllLandmarkId, FusedLandmarkPoint>>
  
  // Per-image packages (source data)
  per_image_packages: ImageLandmarkPackage[]
  
  // Fusion statistics
  images_used: number
  landmark_coverage: number              // 0-1
  cross_image_agreement: number          // 0-1
  fusion_quality: 'excellent' | 'good' | 'fair' | 'poor'
  
  // Derived anatomical estimates
  estimated_ear_base_to_tip: number | null
  estimated_eye_to_eye: number | null
  estimated_ear_tip_to_tip: number | null
  estimated_skull_width: number | null
  // Extended top-tier reference estimates
  estimated_pedicle_spacing: number | null
  estimated_eye_to_pedicle: number | null
  estimated_eye_box_width: number | null
  estimated_eye_box_height: number | null
  estimated_ear_base_spacing: number | null
  estimated_nose_bridge_length: number | null
  estimated_muzzle_width: number | null
  
  // Issues found during fusion
  fusion_conflicts: FusionConflict[]
}

export interface FusedLandmarkPoint extends LandmarkPoint45 {
  // Fusion-specific fields
  source_images: number[]               // indices of images that contributed
  agreement_score: number               // 0-1, how much sources agreed
  fusion_method: 'best_confidence' | 'weighted_average' | 'conflict_resolved'
}

export interface FusionConflict {
  landmark_id: AllLandmarkId
  conflicting_images: number[]
  position_variance: number             // how much positions differed
  resolution: 'used_highest_confidence' | 'weighted_average' | 'excluded'
  notes: string
}

// ============================================================================
// REFERENCE FUSION OUTPUT
// ============================================================================

export interface ReferenceFusionResult {
  // Primary reference source per measurement family
  spread_primary: ReferenceSourceSelection
  spread_backup: ReferenceSourceSelection | null
  
  beam_primary: ReferenceSourceSelection
  beam_backup: ReferenceSourceSelection | null
  
  tine_primary: ReferenceSourceSelection
  tine_backup: ReferenceSourceSelection | null
  
  mass_primary: ReferenceSourceSelection
  mass_backup: ReferenceSourceSelection | null
  
  // Cross-family metrics
  reference_disagreement_score: number   // 0-1, how much different families disagree
  overall_reference_quality: number      // 0-1
  
  // Debug info
  fusion_notes: string[]
  selection_reasons: Record<MeasurementFamily, string>
}

export interface ReferenceSourceSelection {
  source_type:
    // Top-tier
    | 'eye_box'
    | 'pedicle_spacing'
    | 'eye_to_pedicle'
    | 'skull_width'
    // Secondary
    | 'nose_bridge'
    | 'muzzle_width'
    | 'ear_base_spacing'
    // Legacy / compat
    | 'ear_strong'
    | 'ear_partial'
    | 'eye'
    | 'combined_ear_eye'
    | 'weak_fallback'
  image_indices: number[]
  confidence: number
  scaling_factor: number
  explanation: string
}

// ============================================================================
// GEOMETRY-AWARE REFINEMENT OUTPUT
// ============================================================================

export interface GeometryRefinementResult {
  // Refined landmark package
  refined_landmarks: FusedLandmarkPackage
  
  // Geometry consistency analysis
  geometry_consistency_score: number      // 0-1
  geometry_tier: 'excellent' | 'good' | 'fair' | 'poor' | 'implausible'
  
  // Detected issues
  geometry_flags: GeometryFlag45[]
  
  // Per-family adjustments/refinements
  measurement_family_adjustments: MeasurementFamilyAdjustment[]
  
  // Trust/confidence impacts
  confidence_penalty: number              // negative value
  family_trust_penalties: Record<MeasurementFamily, number>
  
  // Asymmetry analysis
  asymmetry_analysis: AsymmetryAnalysis
  
  // Summary
  summary: string
  explanation: string[]
}

export interface GeometryFlag45 {
  id: string
  category: 'spread_reference' | 'beam_proportion' | 'tine_progression' | 'mass_progression' | 'asymmetry' | 'anatomical_bounds' | 'reference_conflict'
  severity: 'info' | 'warning' | 'critical'
  field: string | null
  message: string
  suggested_action: GeometrySuggestedAction | null
}

export interface GeometrySuggestedAction {
  action_type: 'reduce_trust' | 'apply_bound' | 'flag_for_review' | 'use_alternative_reference'
  target_field: string
  magnitude: 'small' | 'moderate' | 'large'
  reason: string
}

export interface MeasurementFamilyAdjustment {
  family: MeasurementFamily
  original_estimate: number | null
  refined_estimate: number | null
  adjustment_amount: number
  adjustment_reason: string
  trust_reduction: number                // 0-1
  refinement_applied: boolean
}

// ============================================================================
// ASYMMETRY DISAMBIGUATION
// ============================================================================

export interface AsymmetryAnalysis {
  // Overall assessment
  is_likely_real: boolean
  apparent_cause: 'real_asymmetry' | 'perspective_induced' | 'missing_visibility' | 'mixed' | 'unknown'
  
  // Per-side visibility quality
  left_side_visibility: number           // 0-1
  right_side_visibility: number          // 0-1
  visibility_imbalance: number           // 0-1, how different visibility is
  
  // Asymmetry magnitude
  overall_asymmetry_percent: number      // e.g., 15 means 15% asymmetry
  beam_asymmetry_percent: number
  tine_asymmetry_percent: number
  mass_asymmetry_percent: number
  
  // Confidence in asymmetry being real
  asymmetry_confidence: number           // 0-1
  
  // Multi-view support
  views_supporting_asymmetry: number
  views_contradicting_asymmetry: number
  
  // Recommendations
  recommendation: string
  should_apply_asymmetry_deduction: boolean
  suggested_deduction_adjustment: number  // positive = increase deduction, negative = decrease
}

// ============================================================================
// COMPLETE PHASE 45 PIPELINE OUTPUT
// ============================================================================

export interface Phase45PipelineResult {
  // Stage 1: Per-image landmarks
  per_image_landmarks: ImageLandmarkPackage[]
  
  // Stage 2: Per-image reference quality
  per_image_reference_quality: ImageReferenceQuality[]
  
  // Stage 3: Fused landmarks
  fused_landmarks: FusedLandmarkPackage
  
  // Stage 4: Reference fusion
  reference_fusion: ReferenceFusionResult
  
  // Stage 5: Geometry refinement
  geometry_refinement: GeometryRefinementResult
  
  // Overall pipeline metrics
  pipeline_version: string
  processing_time_ms: number
  images_processed: number
  
  // Summary for storage
  summary_for_storage: Phase45StorageSummary
}

export interface Phase45StorageSummary {
  landmark_coverage: number
  fusion_quality: string
  reference_quality: number
  geometry_consistency: number
  geometry_tier: string
  asymmetry_likely_real: boolean
  asymmetry_cause: string
  critical_flags_count: number
  warning_flags_count: number
  confidence_adjustment: number
  family_trust_penalties: Record<string, number>
  processed_at: string
  pipeline_version: string
}
