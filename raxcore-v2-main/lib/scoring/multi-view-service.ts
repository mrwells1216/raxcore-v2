/**
 * Phase 49: Multi-View Scoring Service
 * 
 * Database-backed service for multi-view scoring operations.
 * Handles persistence, retrieval, and management of multi-view sets.
 */

import { createClient } from '@/lib/supabase/server'
import type { 
  MultiViewResult, 
  MultiViewInput, 
  ViewData,
  MultiViewSolution,
  ViewGraph,
  ViewEdge,
  FamilyFusionDetail,
  MultiViewStatus
} from './multi-view-engine'
import { processMultiView } from './multi-view-engine'
import type { Measurements, AngleType, LandmarksDetected } from '@/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export interface MVSet {
  id: string
  prediction_id: string | null
  buck_id: string | null
  user_id: string | null
  status: MultiViewStatus
  method: string
  image_count: number
  graph_connectivity_score: number | null
  strongest_subgraph_size: number | null
  total_edges: number | null
  accepted_edges: number | null
  solve_quality_score: number | null
  fallback_used: boolean
  fallback_reason: string | null
  fallback_source_prediction_id: string | null
  processing_time_ms: number | null
  error_message: string | null
  metadata_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MVView {
  id: string
  mv_set_id: string
  image_id: string | null
  image_index: number
  angle_class: AngleType
  angle_confidence: number | null
  reference_quality_summary: Record<string, unknown>
  landmark_summary: Record<string, unknown>
  landmark_confidence: number | null
  view_score_summary: Record<string, unknown>
  view_confidence: number | null
  trust_scores: Record<string, number>
  overall_trust_score: number | null
  is_accepted: boolean
  is_outlier: boolean
  rejection_reason: string | null
  created_at: string
}

export interface MVEdge {
  id: string
  mv_set_id: string
  view_a_id: string
  view_b_id: string
  match_quality: number
  inlier_count: number | null
  geometric_consistency_score: number | null
  spread_agreement: number | null
  beam_agreement: number | null
  tine_agreement: number | null
  mass_agreement: number | null
  accepted_for_fusion: boolean
  rejection_reason: string | null
  metadata_json: Record<string, unknown>
  created_at: string
}

export interface MVSolution {
  id: string
  mv_set_id: string
  method: string
  fused_measurements_json: Measurements
  family_fusion_details: Record<string, FamilyFusionDetail>
  fused_uncertainty_json: Record<string, unknown>
  disagreement_summary_json: Record<string, unknown>
  fused_gross_score: number | null
  fused_net_score: number | null
  score_confidence: number | null
  fallback_used: boolean
  fallback_reason: string | null
  chosen_primary_views_json: number[]
  secondary_supporting_views_json: number[]
  rejected_views_json: { index: number; reason: string }[]
  solution_quality_score: number | null
  cross_view_agreement_score: number | null
  created_at: string
}

export interface MVBenchmarkResult {
  id: string
  mv_set_id: string
  benchmark_run_id: string | null
  ground_truth_gross: number | null
  ground_truth_net: number | null
  single_image_prediction: number | null
  single_image_confidence: number | null
  multi_view_prediction: number | null
  multi_view_confidence: number | null
  single_image_error: number | null
  multi_view_error: number | null
  improvement_inches: number | null
  improvement_percent: number | null
  spread_improvement: number | null
  beam_improvement: number | null
  tine_improvement: number | null
  mass_improvement: number | null
  image_count: number | null
  graph_quality: number | null
  notes: string | null
  created_at: string
}

export interface CreateMultiViewInput {
  buckId: string
  predictionId?: string
  userId?: string
  views: {
    imageId?: string
    imageIndex: number
    angleType: AngleType
    angleConfidence: number
    measurements: Partial<Measurements>
    measurementConfidence: number
    landmarks: LandmarksDetected
    landmarkConfidence: number
    referenceQuality: number
  }[]
  baseMeasurements: Measurements
  earsFullyVisible?: boolean
}

export interface MultiViewSetWithDetails {
  set: MVSet
  views: MVView[]
  edges: MVEdge[]
  solution: MVSolution | null
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Create and process a multi-view scoring set
 */
export async function createAndProcessMultiView(
  input: CreateMultiViewInput
): Promise<{ result: MultiViewResult; saved: MultiViewSetWithDetails }> {
  // Convert input to engine format
  const engineInput: MultiViewInput = {
    buckId: input.buckId,
    predictionId: input.predictionId,
    userId: input.userId,
    views: input.views.map(v => ({
      imageIndex: v.imageIndex,
      imageId: v.imageId,
      angleType: v.angleType,
      angleConfidence: v.angleConfidence,
      measurements: v.measurements,
      measurementConfidence: v.measurementConfidence,
      landmarks: v.landmarks,
      landmarkConfidence: v.landmarkConfidence,
      referenceQuality: v.referenceQuality,
    })),
    baseMeasurements: input.baseMeasurements,
    earsFullyVisible: input.earsFullyVisible,
  }

  // Process multi-view
  const result = processMultiView(engineInput)

  // Save to database
  const saved = await saveMultiViewResult(input, result)

  return { result, saved }
}

/**
 * Save multi-view result to database
 */
export async function saveMultiViewResult(
  input: CreateMultiViewInput,
  result: MultiViewResult
): Promise<MultiViewSetWithDetails> {
  const supabase = await createClient()
  
  // Phase 52: Import supervision hook for conflict detection
  const { onConflictDetected } = await import('@/lib/supervision/hooks')

  // 1. Create the mv_set record
  const { data: mvSet, error: setError } = await supabase
    .from('mv_sets')
    .insert({
      id: result.mvSetId,
      prediction_id: input.predictionId || null,
      buck_id: input.buckId,
      user_id: input.userId || null,
      status: result.status,
      method: result.solution.method,
      image_count: result.imageCount,
      graph_connectivity_score: result.viewGraph.graphConnectivityScore,
      strongest_subgraph_size: result.viewGraph.strongestSubgraph.length,
      total_edges: result.viewGraph.edges.length,
      accepted_edges: result.viewGraph.edges.filter(e => e.acceptedForFusion).length,
      solve_quality_score: result.solution.solutionQualityScore,
      fallback_used: result.solution.fallbackUsed,
      fallback_reason: result.solution.fallbackReason,
      processing_time_ms: result.processingTimeMs,
      metadata_json: {
        debugInfo: result.debugInfo,
        geometryConsistencyTier: result.geometryConsistency?.tier,
      },
    })
    .select()
    .single()

  if (setError || !mvSet) {
    console.error('[multi-view-service] Error creating mv_set:', setError)
    throw new Error(`Failed to create mv_set: ${setError?.message}`)
  }

  // 2. Create mv_views records
  const viewInserts = input.views.map((view, index) => {
    const graphNode = result.viewGraph.nodes[index]
    return {
      mv_set_id: mvSet.id,
      image_id: view.imageId || null,
      image_index: view.imageIndex,
      angle_class: view.angleType,
      angle_confidence: view.angleConfidence,
      reference_quality_summary: { score: view.referenceQuality },
      landmark_summary: view.landmarks,
      landmark_confidence: view.landmarkConfidence,
      view_score_summary: { measurements: view.measurements },
      view_confidence: view.measurementConfidence,
      trust_scores: graphNode?.trustScores?.trust || {},
      overall_trust_score: graphNode?.trustScores?.overallTrust || null,
      is_accepted: graphNode?.isAccepted ?? true,
      is_outlier: graphNode?.isOutlier ?? false,
      rejection_reason: graphNode?.rejectionReason || null,
    }
  })

  const { data: mvViews, error: viewsError } = await supabase
    .from('mv_views')
    .insert(viewInserts)
    .select()

  if (viewsError) {
    console.error('[multi-view-service] Error creating mv_views:', viewsError)
  }

  // 3. Create mv_edges records (need view IDs from previous insert)
  const viewIdMap = new Map<number, string>()
  mvViews?.forEach(v => viewIdMap.set(v.image_index, v.id))

  const edgeInserts = result.viewGraph.edges.map(edge => ({
    mv_set_id: mvSet.id,
    view_a_id: viewIdMap.get(edge.viewAIndex)!,
    view_b_id: viewIdMap.get(edge.viewBIndex)!,
    match_quality: edge.matchQuality,
    inlier_count: edge.inlierCount,
    geometric_consistency_score: edge.geometricConsistencyScore,
    spread_agreement: edge.perFamilyAgreement.spread,
    beam_agreement: edge.perFamilyAgreement.beam,
    tine_agreement: edge.perFamilyAgreement.tine,
    mass_agreement: edge.perFamilyAgreement.mass,
    accepted_for_fusion: edge.acceptedForFusion,
    rejection_reason: edge.rejectionReason,
    metadata_json: {
      acceptanceReason: edge.acceptanceReason,
      deductionAgreement: edge.perFamilyAgreement.deduction,
    },
  })).filter(e => e.view_a_id && e.view_b_id)

  const { data: mvEdges, error: edgesError } = await supabase
    .from('mv_edges')
    .insert(edgeInserts)
    .select()

  if (edgesError) {
    console.error('[multi-view-service] Error creating mv_edges:', edgesError)
  }

  // 4. Create mv_solution record
  const { data: mvSolution, error: solutionError } = await supabase
    .from('mv_solutions')
    .insert({
      mv_set_id: mvSet.id,
      method: result.solution.method,
      fused_measurements_json: result.solution.fusedMeasurements,
      family_fusion_details: Object.fromEntries(
        result.solution.familyFusionDetails.map(d => [d.family, d])
      ),
      fused_uncertainty_json: {
        familyUncertainties: result.solution.familyFusionDetails.map(d => ({
          family: d.family,
          uncertainty: d.uncertaintyBand,
        })),
      },
      disagreement_summary_json: {
        highDisagreementFamilies: result.conflictAnalysis?.conflictSummary.highDisagreementFamilies || [],
        totalDisagreements: result.conflictAnalysis?.conflictSummary.totalDisagreements || 0,
      },
      fused_gross_score: result.solution.fusedGrossScore,
      fused_net_score: result.solution.fusedNetScore,
      score_confidence: result.solution.scoreConfidence,
      fallback_used: result.solution.fallbackUsed,
      fallback_reason: result.solution.fallbackReason,
      chosen_primary_views_json: result.solution.chosenPrimaryViews,
      secondary_supporting_views_json: result.solution.secondarySupportingViews,
      rejected_views_json: result.solution.rejectedViews,
      solution_quality_score: result.solution.solutionQualityScore,
      cross_view_agreement_score: result.solution.crossViewAgreementScore,
    })
    .select()
    .single()

  if (solutionError) {
    console.error('[multi-view-service] Error creating mv_solution:', solutionError)
  }

  // Phase 52: Conflict Engine Hook
  // Create supervision event if meaningful multi-view disagreement was detected
  if (result.conflictAnalysis && input.predictionId) {
    try {
      const conflictSummary = result.conflictAnalysis.conflictSummary
      
      // Only create event if there's meaningful disagreement
      if (conflictSummary.totalDisagreements > 0 && conflictSummary.highDisagreementFamilies.length > 0) {
        await onConflictDetected({
          predictionId: input.predictionId,
          buckId: input.buckId,
          disagreementScore: Math.min(1, conflictSummary.totalDisagreements / 5), // Normalize to 0-1
          highDisagreementFamilies: conflictSummary.highDisagreementFamilies,
          dominantViews: result.solution.chosenPrimaryViews.map((viewIdx) => ({
            family: 'spread', // Would extract actual family per view
            viewIndex: viewIdx,
          })),
          rejectedViews: result.solution.rejectedViews.map(rv => ({
            imageIndex: rv.index,
            reason: rv.reason,
          })),
          disagreementClassifications: result.conflictAnalysis.disagreementClassifications.map(dc => ({
            family: dc.family,
            primaryType: dc.primaryType,
            explanation: dc.explanation,
            reverseEngineeringRecommended: dc.reverseEngineeringRecommended,
          })),
        })
      }
    } catch (hookError) {
      // Log but don't fail the main operation
      console.error('[Phase 52] Conflict engine supervision hook failed:', hookError)
    }
  }

  return {
    set: mvSet as MVSet,
    views: (mvViews || []) as MVView[],
    edges: (mvEdges || []) as MVEdge[],
    solution: mvSolution as MVSolution | null,
  }
}

/**
 * Get a multi-view set with all details
 */
export async function getMultiViewSet(mvSetId: string): Promise<MultiViewSetWithDetails | null> {
  const supabase = await createClient()

  const [setResult, viewsResult, edgesResult, solutionResult] = await Promise.all([
    supabase.from('mv_sets').select('*').eq('id', mvSetId).single(),
    supabase.from('mv_views').select('*').eq('mv_set_id', mvSetId).order('image_index'),
    supabase.from('mv_edges').select('*').eq('mv_set_id', mvSetId),
    supabase.from('mv_solutions').select('*').eq('mv_set_id', mvSetId).single(),
  ])

  if (setResult.error || !setResult.data) {
    return null
  }

  return {
    set: setResult.data as MVSet,
    views: (viewsResult.data || []) as MVView[],
    edges: (edgesResult.data || []) as MVEdge[],
    solution: solutionResult.data as MVSolution | null,
  }
}

/**
 * Get multi-view sets for a buck
 */
export async function getMultiViewSetsForBuck(buckId: string): Promise<MVSet[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mv_sets')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[multi-view-service] Error fetching mv_sets for buck:', error)
    return []
  }

  return (data || []) as MVSet[]
}

/**
 * Get multi-view set for a prediction
 */
export async function getMultiViewSetForPrediction(predictionId: string): Promise<MultiViewSetWithDetails | null> {
  const supabase = await createClient()

  const { data: mvSet, error } = await supabase
    .from('mv_sets')
    .select('*')
    .eq('prediction_id', predictionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !mvSet) {
    return null
  }

  return getMultiViewSet(mvSet.id)
}

/**
 * Update multi-view set status
 */
export async function updateMultiViewSetStatus(
  mvSetId: string,
  status: MultiViewStatus,
  errorMessage?: string
): Promise<void> {
  const supabase = await createClient()

  const updateData: Partial<MVSet> = { status }
  if (errorMessage) {
    updateData.error_message = errorMessage
  }

  await supabase
    .from('mv_sets')
    .update(updateData)
    .eq('id', mvSetId)
}

/**
 * Record benchmark comparison for a multi-view set
 */
export async function recordBenchmarkComparison(input: {
  mvSetId: string
  benchmarkRunId?: string
  groundTruthGross: number
  groundTruthNet?: number
  singleImagePrediction: number
  singleImageConfidence: number
  multiViewPrediction: number
  multiViewConfidence: number
  perFamilyImprovements?: {
    spread?: number
    beam?: number
    tine?: number
    mass?: number
  }
  notes?: string
}): Promise<MVBenchmarkResult | null> {
  const supabase = await createClient()

  const singleError = Math.abs(input.singleImagePrediction - input.groundTruthGross)
  const multiError = Math.abs(input.multiViewPrediction - input.groundTruthGross)
  const improvementInches = singleError - multiError
  const improvementPercent = singleError > 0 ? (improvementInches / singleError) * 100 : 0

  // Get image count and graph quality from mv_set
  const { data: mvSet } = await supabase
    .from('mv_sets')
    .select('image_count, graph_connectivity_score')
    .eq('id', input.mvSetId)
    .single()

  const { data, error } = await supabase
    .from('mv_benchmark_results')
    .insert({
      mv_set_id: input.mvSetId,
      benchmark_run_id: input.benchmarkRunId || null,
      ground_truth_gross: input.groundTruthGross,
      ground_truth_net: input.groundTruthNet || null,
      single_image_prediction: input.singleImagePrediction,
      single_image_confidence: input.singleImageConfidence,
      multi_view_prediction: input.multiViewPrediction,
      multi_view_confidence: input.multiViewConfidence,
      single_image_error: singleError,
      multi_view_error: multiError,
      improvement_inches: improvementInches,
      improvement_percent: improvementPercent,
      spread_improvement: input.perFamilyImprovements?.spread || null,
      beam_improvement: input.perFamilyImprovements?.beam || null,
      tine_improvement: input.perFamilyImprovements?.tine || null,
      mass_improvement: input.perFamilyImprovements?.mass || null,
      image_count: mvSet?.image_count || null,
      graph_quality: mvSet?.graph_connectivity_score || null,
      notes: input.notes || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[multi-view-service] Error recording benchmark:', error)
    return null
  }

  return data as MVBenchmarkResult
}

/**
 * Get benchmark statistics for multi-view scoring
 */
export async function getMultiViewBenchmarkStats(): Promise<{
  totalComparisons: number
  avgImprovement: number
  medianImprovement: number
  percentImproved: number
  avgMultiViewError: number
  avgSingleViewError: number
  byImageCount: Record<number, { count: number; avgImprovement: number }>
  byGraphQuality: Record<string, { count: number; avgImprovement: number }>
}> {
  const supabase = await createClient()

  const { data: results, error } = await supabase
    .from('mv_benchmark_results')
    .select('*')
    .not('improvement_inches', 'is', null)

  if (error || !results || results.length === 0) {
    return {
      totalComparisons: 0,
      avgImprovement: 0,
      medianImprovement: 0,
      percentImproved: 0,
      avgMultiViewError: 0,
      avgSingleViewError: 0,
      byImageCount: {},
      byGraphQuality: {},
    }
  }

  const improvements = results.map(r => r.improvement_inches as number).sort((a, b) => a - b)
  const improved = improvements.filter(i => i > 0).length

  // Group by image count
  const byImageCount: Record<number, { count: number; avgImprovement: number; total: number }> = {}
  for (const r of results) {
    const count = r.image_count || 2
    if (!byImageCount[count]) byImageCount[count] = { count: 0, avgImprovement: 0, total: 0 }
    byImageCount[count].count++
    byImageCount[count].total += r.improvement_inches as number
  }
  for (const key of Object.keys(byImageCount)) {
    const k = parseInt(key)
    byImageCount[k].avgImprovement = byImageCount[k].total / byImageCount[k].count
  }

  // Group by graph quality tier
  const byGraphQuality: Record<string, { count: number; avgImprovement: number; total: number }> = {}
  for (const r of results) {
    const quality = r.graph_quality as number || 0
    const tier = quality >= 0.8 ? 'excellent' : quality >= 0.6 ? 'good' : quality >= 0.4 ? 'fair' : 'poor'
    if (!byGraphQuality[tier]) byGraphQuality[tier] = { count: 0, avgImprovement: 0, total: 0 }
    byGraphQuality[tier].count++
    byGraphQuality[tier].total += r.improvement_inches as number
  }
  for (const tier of Object.keys(byGraphQuality)) {
    byGraphQuality[tier].avgImprovement = byGraphQuality[tier].total / byGraphQuality[tier].count
  }

  return {
    totalComparisons: results.length,
    avgImprovement: improvements.reduce((a, b) => a + b, 0) / improvements.length,
    medianImprovement: improvements[Math.floor(improvements.length / 2)],
    percentImproved: (improved / results.length) * 100,
    avgMultiViewError: results.reduce((sum, r) => sum + (r.multi_view_error as number), 0) / results.length,
    avgSingleViewError: results.reduce((sum, r) => sum + (r.single_image_error as number), 0) / results.length,
    byImageCount: Object.fromEntries(
      Object.entries(byImageCount).map(([k, v]) => [k, { count: v.count, avgImprovement: v.avgImprovement }])
    ),
    byGraphQuality: Object.fromEntries(
      Object.entries(byGraphQuality).map(([k, v]) => [k, { count: v.count, avgImprovement: v.avgImprovement }])
    ),
  }
}

/**
 * Get recent multi-view sets with status
 */
export async function getRecentMultiViewSets(limit: number = 50): Promise<MVSet[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mv_sets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[multi-view-service] Error fetching recent mv_sets:', error)
    return []
  }

  return (data || []) as MVSet[]
}

/**
 * Get multi-view sets that need processing
 */
export async function getPendingMultiViewSets(): Promise<MVSet[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mv_sets')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) {
    console.error('[multi-view-service] Error fetching pending mv_sets:', error)
    return []
  }

  return (data || []) as MVSet[]
}
