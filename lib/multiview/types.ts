/**
 * Phase 49: Multi-View Fusion Types
 * 
 * Type definitions for the multi-image fusion scoring system.
 */

import type { Measurements, AngleType, MeasurementFamily, LandmarksDetected } from '@/lib/types'
export type { MeasurementFamily }

// ============================================================================
// STATUS AND METHOD ENUMS
// ============================================================================

export type MVSetStatus = 
  | 'pending' 
  | 'building_graph' 
  | 'scoring_pairs' 
  | 'fusing_families'
  | 'solving_geometry' 
  | 'completed' 
  | 'failed' 
  | 'fallback_used'

export type MVMethod = 
  | 'graph_fusion' 
  | 'weighted_average' 
  | 'best_single' 
  | 'ransac_fusion'

export type MVSolutionMethod = 
  | 'full_graph_fusion' 
  | 'subgraph_fusion' 
  | 'dominant_view'
  | 'weighted_blend' 
  | 'single_view_fallback' 
  | 'ransac_consensus'

export type AngleClass = 
  | 'front' 
  | 'left' 
  | 'right' 
  | 'back' 
  | 'front_left' 
  | 'front_right' 
  | 'unknown'

export type ReferenceQuality = 'strong' | 'moderate' | 'weak' | 'none'
export type SupportQuality = 'strong' | 'moderate' | 'weak' | 'insufficient'
export type SolutionQualityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'fallback'

// ============================================================================
// MULTI-VIEW SET
// ============================================================================

export interface MVSet {
  id: string
  prediction_id: string | null
  buck_id: string | null
  user_id: string | null
  status: MVSetStatus
  method: MVMethod
  image_count: number
  accepted_view_count: number | null
  rejected_view_count: number | null
  graph_connectivity_score: number | null
  strongest_subgraph_size: number | null
  processing_time_ms: number | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// ============================================================================
// MULTI-VIEW VIEW
// ============================================================================

export interface MVView {
  id: string
  mv_set_id: string
  buck_image_id: string | null
  image_index: number
  angle_class: AngleClass
  angle_confidence: number | null
  reference_quality_score: number | null
  ear_reference_quality: ReferenceQuality | null
  has_scale_reference: boolean
  landmark_count: number
  landmark_confidence_avg: number | null
  key_landmarks_detected: string[]
  view_overall_score: number | null
  spread_contribution_score: number | null
  beam_contribution_score: number | null
  tine_contribution_score: number | null
  mass_contribution_score: number | null
  view_measurements: Partial<Measurements> | null
  is_accepted: boolean
  rejection_reason: string | null
  is_primary_view: boolean
  is_outlier: boolean
  outlier_score: number | null
  created_at: string
}

// ============================================================================
// MULTI-VIEW EDGE
// ============================================================================

export interface MVEdge {
  id: string
  mv_set_id: string
  view_a_id: string
  view_b_id: string
  match_quality: number
  landmark_overlap_score: number | null
  reference_compatibility_score: number | null
  angle_complementarity_score: number | null
  geometric_plausibility_score: number | null
  inlier_count: number
  outlier_count: number
  inlier_ratio: number | null
  geometric_consistency_score: number | null
  scale_agreement_score: number | null
  structure_agreement_score: number | null
  spread_agreement_score: number | null
  beam_agreement_score: number | null
  tine_agreement_score: number | null
  mass_agreement_score: number | null
  accepted_for_fusion: boolean
  rejection_reason: string | null
  edge_weight: number
  metadata: Record<string, unknown> | null
  created_at: string
}

// ============================================================================
// MULTI-VIEW SOLUTION
// ============================================================================

export interface MVFamilyFusionDetail {
  family: MeasurementFamily
  primary_view_index: number
  primary_view_weight: number
  secondary_view_indices: number[]
  secondary_view_weights: number[]
  fused_value: number
  disagreement_score: number
  max_deviation: number
  views_used: number
}

export interface MVDisagreementSummary {
  total_disagreements: number
  high_disagreement_families: MeasurementFamily[]
  max_family_disagreement: number
  avg_family_disagreement: number
  per_family_disagreement: Record<MeasurementFamily, number>
  disagreement_triggers: string[]
}

export interface MVSolution {
  id: string
  mv_set_id: string
  method: MVSolutionMethod
  fused_measurements: Measurements
  family_fusion_details: Record<MeasurementFamily, MVFamilyFusionDetail> | null
  fused_uncertainty: {
    gross_uncertainty: number
    net_uncertainty: number | null
    per_family_uncertainty: Record<MeasurementFamily, number>
  } | null
  gross_error_band_low: number | null
  gross_error_band_high: number | null
  net_error_band_low: number | null
  net_error_band_high: number | null
  disagreement_summary: MVDisagreementSummary | null
  max_family_disagreement: number | null
  avg_family_disagreement: number | null
  high_disagreement_families: MeasurementFamily[]
  fallback_used: boolean
  fallback_reason: string | null
  fallback_source_view_id: string | null
  chosen_primary_views: Record<MeasurementFamily, number> | null
  solution_confidence: number | null
  solution_quality_tier: SolutionQualityTier | null
  improvement_vs_single_view: number | null
  processing_time_ms: number | null
  created_at: string
}

// ============================================================================
// MULTI-VIEW FAMILY SUPPORT
// ============================================================================

export interface MVFamilySupport {
  id: string
  mv_solution_id: string
  family: MeasurementFamily
  primary_view_id: string | null
  primary_view_weight: number | null
  primary_view_measurement: number | null
  secondary_view_ids: string[]
  secondary_view_weights: number[]
  secondary_view_measurements: number[]
  fused_estimate: number | null
  fused_uncertainty: number | null
  disagreement_score: number | null
  max_deviation: number | null
  std_deviation: number | null
  support_quality: SupportQuality | null
  created_at: string
}

// ============================================================================
// PROCESSING INPUTS AND OUTPUTS
// ============================================================================

export interface MVProcessingInput {
  buckId: string
  predictionId?: string
  userId?: string
  images: {
    imageId: string
    imageUrl: string
    angleType: AngleType
    width: number
    height: number
  }[]
  landmarks: {
    imageIndex: number
    landmarks: LandmarksDetected
    confidence: number
  }[]
  perImageMeasurements: {
    imageIndex: number
    measurements: Partial<Measurements>
    confidence: number
  }[]
  options?: {
    method?: MVMethod
    minPairQuality?: number
    minGraphConnectivity?: number
    fallbackThreshold?: number
  }
}

export interface MVProcessingResult {
  mvSetId: string
  status: MVSetStatus
  solution: MVSolution | null
  views: MVView[]
  edges: MVEdge[]
  familySupport: MVFamilySupport[]
  fallbackUsed: boolean
  fallbackReason: string | null
  processingTimeMs: number
  qualitySummary: {
    graphConnectivity: number
    acceptedViews: number
    rejectedViews: number
    highDisagreementFamilies: MeasurementFamily[]
    solutionQualityTier: SolutionQualityTier
  }
}

// ============================================================================
// VIEW GRAPH TYPES
// ============================================================================

export interface ViewGraphNode {
  viewId: string
  imageIndex: number
  angleClass: AngleClass
  overallScore: number
  isAccepted: boolean
  isOutlier: boolean
  familyContributions: Record<MeasurementFamily, number>
}

export interface ViewGraphEdge {
  edgeId: string
  viewAId: string
  viewBId: string
  weight: number
  isAccepted: boolean
  matchQuality: number
  familyAgreement: Record<MeasurementFamily, number>
}

export interface ViewGraph {
  nodes: ViewGraphNode[]
  edges: ViewGraphEdge[]
  connectivity: number
  strongestSubgraph: string[] // View IDs
  isolatedNodes: string[]
  acceptedEdgeCount: number
  totalEdgeCount: number
}

// ============================================================================
// PAIR MATCHING TYPES
// ============================================================================

export interface PairMatchInput {
  viewA: {
    imageIndex: number
    angleClass: AngleClass
    landmarks: LandmarksDetected
    measurements: Partial<Measurements>
    referenceQuality: number
  }
  viewB: {
    imageIndex: number
    angleClass: AngleClass
    landmarks: LandmarksDetected
    measurements: Partial<Measurements>
    referenceQuality: number
  }
}

export interface PairMatchResult {
  matchQuality: number
  landmarkOverlap: number
  referenceCompatibility: number
  angleComplementarity: number
  geometricPlausibility: number
  familyAgreement: Record<MeasurementFamily, number>
  inlierCount: number
  outlierCount: number
  isUsableForFusion: boolean
  rejectionReason: string | null
}

// ============================================================================
// FAMILY FUSION TYPES
// ============================================================================

export interface FamilyFusionInput {
  family: MeasurementFamily
  views: {
    viewId: string
    imageIndex: number
    angleClass: AngleClass
    measurement: number
    confidence: number
    referenceQuality: number
    isPreferredAngle: boolean
  }[]
  edges: {
    viewAIndex: number
    viewBIndex: number
    agreement: number
    weight: number
  }[]
}

export interface FamilyFusionResult {
  family: MeasurementFamily
  fusedValue: number
  uncertainty: number
  primaryViewIndex: number
  primaryViewWeight: number
  secondaryViewIndices: number[]
  secondaryViewWeights: number[]
  disagreementScore: number
  maxDeviation: number
  supportQuality: SupportQuality
  usedRobustFusion: boolean
}

// ============================================================================
// FALLBACK TYPES
// ============================================================================

export type FallbackTrigger =
  | 'weak_graph_connectivity'
  | 'low_pair_quality'
  | 'high_family_disagreement'
  | 'missing_key_references'
  | 'unstable_geometry'
  | 'insufficient_views'
  | 'all_views_rejected'

export interface FallbackDecision {
  shouldFallback: boolean
  triggers: FallbackTrigger[]
  reason: string
  recommendedMethod: MVSolutionMethod
  bestSingleViewIndex: number | null
  bestSubgraphViewIndices: number[] | null
}

// ============================================================================
// COMPARISON TYPES (for validation/benchmark)
// ============================================================================

export interface MVComparisonResult {
  mvSetId: string
  groundTruthGross: number | null
  groundTruthNet: number | null
  singleViewGross: number
  singleViewNet: number | null
  multiViewGross: number
  multiViewNet: number | null
  singleViewError: number | null
  multiViewError: number | null
  errorReduction: number | null
  errorReductionPercent: number | null
  multiViewHelped: boolean
  multiViewHurt: boolean
  graphQuality: number
  method: MVSolutionMethod
}
