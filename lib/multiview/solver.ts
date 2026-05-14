/**
 * Phase 49: Multi-View Geometry Solver
 * 
 * Combines cross-view evidence into a fused rack estimate with
 * safe fallback logic when multi-view quality is weak.
 */

import { createClient } from '@/lib/supabase/server'
import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import type {
  MVSet,
  MVView,
  MVEdge,
  MVSolution,
  MVFamilySupport,
  MVSetStatus,
  MVSolutionMethod,
  MVProcessingInput,
  MVProcessingResult,
  ViewGraph,
  FallbackDecision,
  FallbackTrigger,
  SolutionQualityTier,
  MeasurementFamily,
  AngleClass,
} from './types'
import { buildViewGraph, getGraphSummary, getFamilySupport } from './view-graph'
import { scoreAllPairs } from './pair-matcher'
import { fuseAllFamilies, type FuseAllFamiliesResult } from './family-fusion'

// ============================================================================
// CONSTANTS
// ============================================================================

const FALLBACK_TRIGGERS = {
  MIN_GRAPH_CONNECTIVITY: 0.3,
  MIN_ACCEPTED_EDGES: 1,
  MAX_FAMILY_DISAGREEMENT: 0.7,
  MIN_REFERENCE_QUALITY: 0.3,
  MIN_VIEWS_FOR_FUSION: 2,
}

// ============================================================================
// FALLBACK DECISION
// ============================================================================

/**
 * Determine if fallback to single-view or subset is needed
 */
export function determineFallback(
  graph: ViewGraph,
  fusionResult: FuseAllFamiliesResult,
  views: Array<{ viewIndex: number; referenceQuality: number }>
): FallbackDecision {
  const triggers: FallbackTrigger[] = []
  const graphSummary = getGraphSummary(graph)

  // Check graph connectivity
  if (graphSummary.connectivity < FALLBACK_TRIGGERS.MIN_GRAPH_CONNECTIVITY) {
    triggers.push('weak_graph_connectivity')
  }

  // Check if we have enough accepted edges
  if (graphSummary.acceptedEdgeCount < FALLBACK_TRIGGERS.MIN_ACCEPTED_EDGES) {
    triggers.push('low_pair_quality')
  }

  // Check family disagreement
  if (fusionResult.overallDisagreement > FALLBACK_TRIGGERS.MAX_FAMILY_DISAGREEMENT) {
    triggers.push('high_family_disagreement')
  }

  // Check reference quality
  const avgRefQuality = views.reduce((sum, v) => sum + v.referenceQuality, 0) / views.length
  if (avgRefQuality < FALLBACK_TRIGGERS.MIN_REFERENCE_QUALITY) {
    triggers.push('missing_key_references')
  }

  // Check if we have enough views
  if (graphSummary.acceptedNodeCount < FALLBACK_TRIGGERS.MIN_VIEWS_FOR_FUSION) {
    triggers.push('insufficient_views')
  }

  // Check if all views were rejected
  if (graphSummary.acceptedNodeCount === 0) {
    triggers.push('all_views_rejected')
  }

  // Determine recommended method
  let recommendedMethod: MVSolutionMethod = 'full_graph_fusion'
  let bestSingleViewIndex: number | null = null
  let bestSubgraphViewIndices: number[] | null = null

  if (triggers.length > 0) {
    // Find best single view
    const bestView = views.reduce((best, view) =>
      view.referenceQuality > (best?.referenceQuality ?? 0) ? view : best
    , views[0])
    bestSingleViewIndex = bestView?.viewIndex ?? null

    // Find best subgraph
    if (graph.strongestSubgraph.length >= 2) {
      bestSubgraphViewIndices = graph.strongestSubgraph.map(viewId => {
        const node = graph.nodes.find(n => n.viewId === viewId)
        return node?.imageIndex ?? 0
      })
      recommendedMethod = 'subgraph_fusion'
    } else {
      recommendedMethod = 'single_view_fallback'
    }
  }

  const reason = triggers.length > 0
    ? `Fallback triggered: ${triggers.join(', ')}`
    : 'Multi-view fusion viable'

  return {
    shouldFallback: triggers.length > 0,
    triggers,
    reason,
    recommendedMethod,
    bestSingleViewIndex,
    bestSubgraphViewIndices,
  }
}

// ============================================================================
// SOLUTION BUILDING
// ============================================================================

/**
 * Build fused measurements from family fusion results
 */
function buildFusedMeasurements(
  fusionResult: FuseAllFamiliesResult,
  views: Array<{ viewIndex: number; measurements: Partial<Measurements> }>,
  graph: ViewGraph
): Measurements {
  const measurements: Partial<Measurements> = {}

  // Get primary view for each family
  const spreadResult = fusionResult.results.spread
  const beamResult = fusionResult.results.beam
  const tineResult = fusionResult.results.tine
  const massResult = fusionResult.results.mass

  // Spread - use fused value directly
  if (spreadResult.supportQuality !== 'insufficient') {
    measurements.inside_spread = spreadResult.fusedValue
  }

  // For beam/tine/mass, we need to reconstruct from primary view and scale
  const beamPrimaryView = views.find(v => v.viewIndex === beamResult.primaryViewIndex)
  if (beamPrimaryView && beamResult.supportQuality !== 'insufficient') {
    const primaryBeamL = beamPrimaryView.measurements.main_beam_left
    const primaryBeamR = beamPrimaryView.measurements.main_beam_right
    
    if (primaryBeamL !== null && primaryBeamL !== undefined && 
        primaryBeamR !== null && primaryBeamR !== undefined) {
      // Scale to match fused beam average
      const primaryAvg = (primaryBeamL + primaryBeamR) / 2
      const scaleFactor = beamResult.fusedValue / primaryAvg
      measurements.main_beam_left = primaryBeamL * scaleFactor
      measurements.main_beam_right = primaryBeamR * scaleFactor
    }
  }

  // Tine - use primary view measurements scaled
  const tinePrimaryView = views.find(v => v.viewIndex === tineResult.primaryViewIndex)
  if (tinePrimaryView && tineResult.supportQuality !== 'insufficient') {
    const tineFields = ['g1_left', 'g1_right', 'g2_left', 'g2_right', 'g3_left', 'g3_right', 'g4_left', 'g4_right'] as const
    const primaryTineValues = tineFields.map(f => tinePrimaryView.measurements[f]).filter((v): v is number => v !== null && v !== undefined)
    
    if (primaryTineValues.length >= 4) {
      const primaryTotal = primaryTineValues.reduce((a, b) => a + b, 0)
      const scaleFactor = tineResult.fusedValue / primaryTotal
      
      for (const field of tineFields) {
        const value = tinePrimaryView.measurements[field]
        if (value !== null && value !== undefined) {
          (measurements as Record<string, number | null>)[field] = value * scaleFactor
        }
      }
    }
  }

  // Mass - use primary view measurements scaled
  const massPrimaryView = views.find(v => v.viewIndex === massResult.primaryViewIndex)
  if (massPrimaryView && massResult.supportQuality !== 'insufficient') {
    const massFields = ['h1_left', 'h1_right', 'h2_left', 'h2_right', 'h3_left', 'h3_right', 'h4_left', 'h4_right'] as const
    const primaryMassValues = massFields.map(f => massPrimaryView.measurements[f]).filter((v): v is number => v !== null && v !== undefined)
    
    if (primaryMassValues.length >= 4) {
      const primaryTotal = primaryMassValues.reduce((a, b) => a + b, 0)
      const scaleFactor = massResult.fusedValue / primaryTotal
      
      for (const field of massFields) {
        const value = massPrimaryView.measurements[field]
        if (value !== null && value !== undefined) {
          (measurements as Record<string, number | null>)[field] = value * scaleFactor
        }
      }
    }
  }

  return measurements as Measurements
}

/**
 * Compute solution quality tier
 */
function computeQualityTier(
  graph: ViewGraph,
  fusionResult: FuseAllFamiliesResult,
  fallbackUsed: boolean
): SolutionQualityTier {
  if (fallbackUsed) {
    return 'fallback'
  }

  const graphSummary = getGraphSummary(graph)

  // Excellent: High connectivity, low disagreement, multiple views
  if (graphSummary.connectivity >= 0.7 && 
      fusionResult.overallDisagreement < 0.2 && 
      graphSummary.acceptedNodeCount >= 3) {
    return 'excellent'
  }

  // Good: Moderate connectivity and disagreement
  if (graphSummary.connectivity >= 0.5 && 
      fusionResult.overallDisagreement < 0.4 && 
      graphSummary.acceptedNodeCount >= 2) {
    return 'good'
  }

  // Fair: Some connectivity, moderate disagreement
  if (graphSummary.connectivity >= 0.3 && 
      fusionResult.overallDisagreement < 0.6) {
    return 'fair'
  }

  return 'poor'
}

/**
 * Compute error bands based on fusion quality
 */
function computeErrorBands(
  fusionResult: FuseAllFamiliesResult,
  qualityTier: SolutionQualityTier
): { grossLow: number; grossHigh: number; netLow: number | null; netHigh: number | null } {
  // Base uncertainty from fusion
  const baseUncertainty = fusionResult.overallUncertainty

  // Quality tier multiplier
  const tierMultiplier: Record<SolutionQualityTier, number> = {
    excellent: 0.7,
    good: 0.9,
    fair: 1.1,
    poor: 1.3,
    fallback: 1.5,
  }

  const scaledUncertainty = baseUncertainty * tierMultiplier[qualityTier]
  
  // Compute bands (asymmetric - slightly wider on high end)
  const grossLow = -scaledUncertainty * 0.9
  const grossHigh = scaledUncertainty * 1.1

  return {
    grossLow,
    grossHigh,
    netLow: grossLow,
    netHigh: grossHigh,
  }
}

// ============================================================================
// MAIN SOLVER
// ============================================================================

export interface MVSolverInput {
  buckId: string
  predictionId?: string
  userId?: string
  views: Array<{
    imageIndex: number
    buckImageId?: string
    angleClass: AngleClass
    landmarks: LandmarksDetected
    measurements: Partial<Measurements>
    confidence: number
    referenceQuality: number
  }>
}

export interface MVSolverResult {
  mvSetId: string
  solution: MVSolution | null
  views: MVView[]
  edges: MVEdge[]
  familySupport: MVFamilySupport[]
  graph: ViewGraph
  fusionResult: FuseAllFamiliesResult
  fallbackDecision: FallbackDecision
  status: MVSetStatus
  qualityTier: SolutionQualityTier
}

/**
 * Main multi-view solver entry point
 */
export async function solveMultiView(input: MVSolverInput): Promise<MVSolverResult> {
  const supabase = await createClient()
  const startTime = Date.now()

  // 1. Build view graph
  const graph = buildViewGraph(input.views.map(v => ({
    imageIndex: v.imageIndex,
    angleClass: v.angleClass,
    landmarks: v.landmarks,
    measurements: v.measurements,
    referenceQuality: v.referenceQuality,
    landmarkConfidence: v.confidence,
  })))

  // 2. Prepare fusion input
  const fusionInput = {
    views: input.views.map(v => ({
      viewIndex: v.imageIndex,
      angleClass: v.angleClass,
      measurements: v.measurements,
      confidence: v.confidence,
      referenceQuality: v.referenceQuality,
    })),
    edges: graph.edges
      .filter(e => e.isAccepted)
      .map(e => {
        const nodeA = graph.nodes.find(n => n.viewId === e.viewAId)
        const nodeB = graph.nodes.find(n => n.viewId === e.viewBId)
        return {
          viewAIndex: nodeA?.imageIndex ?? 0,
          viewBIndex: nodeB?.imageIndex ?? 0,
          agreement: Object.values(e.familyAgreement).reduce((a, b) => a + b, 0) / 4,
          weight: e.weight,
        }
      }),
  }

  // 3. Fuse all families
  const fusionResult = fuseAllFamilies(fusionInput)

  // 4. Determine fallback
  const fallbackDecision = determineFallback(
    graph,
    fusionResult,
    input.views.map(v => ({ viewIndex: v.imageIndex, referenceQuality: v.referenceQuality }))
  )

  // 5. Create MV set record
  const graphSummary = getGraphSummary(graph)
  const { data: mvSetData, error: mvSetError } = await supabase
    .from('mv_sets')
    .insert({
      buck_id: input.buckId,
      prediction_id: input.predictionId,
      user_id: input.userId,
      status: fallbackDecision.shouldFallback ? 'fallback_used' : 'completed',
      method: 'graph_fusion',
      image_count: input.views.length,
      accepted_view_count: graphSummary.acceptedNodeCount,
      rejected_view_count: graphSummary.outlierCount + graphSummary.isolatedCount,
      graph_connectivity_score: graphSummary.connectivity,
      strongest_subgraph_size: graphSummary.strongestSubgraphSize,
      processing_time_ms: Date.now() - startTime,
    })
    .select()
    .single()

  if (mvSetError || !mvSetData) {
    throw new Error(`Failed to create MV set: ${mvSetError?.message}`)
  }

  const mvSetId = mvSetData.id

  // 6. Create MV view records
  const mvViews: MVView[] = []
  for (const view of input.views) {
    const graphNode = graph.nodes.find(n => n.imageIndex === view.imageIndex)
    const familySupport = getFamilySupport(graph)

    const { data: viewData, error: viewError } = await supabase
      .from('mv_views')
      .insert({
        mv_set_id: mvSetId,
        buck_image_id: view.buckImageId,
        image_index: view.imageIndex,
        angle_class: view.angleClass,
        angle_confidence: view.confidence,
        reference_quality_score: view.referenceQuality,
        landmark_count: Object.keys(view.landmarks).filter(k => (view.landmarks as unknown as Record<string, unknown>)[k] !== null).length,
        landmark_confidence_avg: view.confidence,
        view_overall_score: graphNode?.overallScore ?? 0,
        spread_contribution_score: graphNode?.familyContributions.spread ?? 0,
        beam_contribution_score: graphNode?.familyContributions.beam ?? 0,
        tine_contribution_score: graphNode?.familyContributions.tine ?? 0,
        mass_contribution_score: graphNode?.familyContributions.mass ?? 0,
        view_measurements: view.measurements,
        is_accepted: graphNode?.isAccepted ?? false,
        is_primary_view: false, // Will update later
        is_outlier: graphNode?.isOutlier ?? false,
        outlier_score: graphNode?.isOutlier ? 0.2 : null,
      })
      .select()
      .single()

    if (viewData) {
      mvViews.push(viewData as unknown as MVView)
    }
  }

  // 7. Create MV edge records
  const mvEdges: MVEdge[] = []
  for (const edge of graph.edges) {
    const nodeA = graph.nodes.find(n => n.viewId === edge.viewAId)
    const nodeB = graph.nodes.find(n => n.viewId === edge.viewBId)
    const viewA = mvViews.find(v => v.image_index === nodeA?.imageIndex)
    const viewB = mvViews.find(v => v.image_index === nodeB?.imageIndex)

    if (viewA && viewB) {
      const { data: edgeData } = await supabase
        .from('mv_edges')
        .insert({
          mv_set_id: mvSetId,
          view_a_id: viewA.id,
          view_b_id: viewB.id,
          match_quality: edge.matchQuality,
          geometric_consistency_score: edge.matchQuality,
          spread_agreement_score: edge.familyAgreement.spread,
          beam_agreement_score: edge.familyAgreement.beam,
          tine_agreement_score: edge.familyAgreement.tine,
          mass_agreement_score: edge.familyAgreement.mass,
          accepted_for_fusion: edge.isAccepted,
          edge_weight: edge.weight,
        })
        .select()
        .single()

      if (edgeData) {
        mvEdges.push(edgeData as unknown as MVEdge)
      }
    }
  }

  // 8. Build solution
  const qualityTier = computeQualityTier(graph, fusionResult, fallbackDecision.shouldFallback)
  const errorBands = computeErrorBands(fusionResult, qualityTier)

  let solutionMethod: MVSolutionMethod = 'full_graph_fusion'
  let fusedMeasurements: Measurements
  let fallbackSourceViewId: string | null = null

  if (fallbackDecision.shouldFallback) {
    solutionMethod = fallbackDecision.recommendedMethod
    
    if (solutionMethod === 'single_view_fallback' && fallbackDecision.bestSingleViewIndex !== null) {
      // Use best single view
      const bestView = input.views.find(v => v.imageIndex === fallbackDecision.bestSingleViewIndex)
      fusedMeasurements = (bestView?.measurements ?? {}) as Measurements
      const mvView = mvViews.find(v => v.image_index === fallbackDecision.bestSingleViewIndex)
      fallbackSourceViewId = mvView?.id ?? null
    } else {
      // Use subgraph fusion (still use fusion result but mark as fallback)
      fusedMeasurements = buildFusedMeasurements(fusionResult, input.views.map(v => ({ viewIndex: v.imageIndex, measurements: v.measurements })), graph)
    }
  } else {
    fusedMeasurements = buildFusedMeasurements(fusionResult, input.views.map(v => ({ viewIndex: v.imageIndex, measurements: v.measurements })), graph)
  }

  // 9. Create solution record
  const { data: solutionData, error: solutionError } = await supabase
    .from('mv_solution')
    .insert({
      mv_set_id: mvSetId,
      method: solutionMethod,
      fused_measurements: fusedMeasurements,
      family_fusion_details: fusionResult.results,
      fused_uncertainty: {
        gross_uncertainty: fusionResult.overallUncertainty,
        net_uncertainty: fusionResult.overallUncertainty,
        per_family_uncertainty: {
          spread: fusionResult.results.spread.uncertainty,
          beam: fusionResult.results.beam.uncertainty,
          tine: fusionResult.results.tine.uncertainty,
          mass: fusionResult.results.mass.uncertainty,
        },
      },
      gross_error_band_low: errorBands.grossLow,
      gross_error_band_high: errorBands.grossHigh,
      net_error_band_low: errorBands.netLow,
      net_error_band_high: errorBands.netHigh,
      disagreement_summary: {
        total_disagreements: fusionResult.highDisagreementFamilies.length,
        high_disagreement_families: fusionResult.highDisagreementFamilies,
        max_family_disagreement: Math.max(
          fusionResult.results.spread.disagreementScore,
          fusionResult.results.beam.disagreementScore,
          fusionResult.results.tine.disagreementScore,
          fusionResult.results.mass.disagreementScore
        ),
        avg_family_disagreement: fusionResult.overallDisagreement,
        per_family_disagreement: {
          spread: fusionResult.results.spread.disagreementScore,
          beam: fusionResult.results.beam.disagreementScore,
          tine: fusionResult.results.tine.disagreementScore,
          mass: fusionResult.results.mass.disagreementScore,
        },
        disagreement_triggers: fallbackDecision.triggers,
      },
      max_family_disagreement: Math.max(
        fusionResult.results.spread.disagreementScore,
        fusionResult.results.beam.disagreementScore,
        fusionResult.results.tine.disagreementScore,
        fusionResult.results.mass.disagreementScore
      ),
      avg_family_disagreement: fusionResult.overallDisagreement,
      high_disagreement_families: fusionResult.highDisagreementFamilies,
      fallback_used: fallbackDecision.shouldFallback,
      fallback_reason: fallbackDecision.shouldFallback ? fallbackDecision.reason : null,
      fallback_source_view_id: fallbackSourceViewId,
      chosen_primary_views: {
        spread: fusionResult.results.spread.primaryViewIndex,
        beam: fusionResult.results.beam.primaryViewIndex,
        tine: fusionResult.results.tine.primaryViewIndex,
        mass: fusionResult.results.mass.primaryViewIndex,
      },
      solution_confidence: 1 - fusionResult.overallDisagreement,
      solution_quality_tier: qualityTier,
      improvement_vs_single_view: fallbackDecision.shouldFallback ? 0 : 
        (1 - fusionResult.overallDisagreement) * 0.15, // Rough estimate
      processing_time_ms: Date.now() - startTime,
    })
    .select()
    .single()

  // 10. Create family support records
  const familySupport: MVFamilySupport[] = []
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']
  
  for (const family of families) {
    const result = fusionResult.results[family]
    const primaryMvView = mvViews.find(v => v.image_index === result.primaryViewIndex)
    const secondaryMvViews = result.secondaryViewIndices
      .map(idx => mvViews.find(v => v.image_index === idx))
      .filter((v): v is MVView => v !== undefined)

    const { data: supportData } = await supabase
      .from('mv_family_support')
      .insert({
        mv_solution_id: solutionData?.id,
        family,
        primary_view_id: primaryMvView?.id,
        primary_view_weight: result.primaryViewWeight,
        primary_view_measurement: result.fusedValue,
        secondary_view_ids: secondaryMvViews.map(v => v.id),
        secondary_view_weights: result.secondaryViewWeights,
        secondary_view_measurements: result.secondaryViewWeights.map(() => result.fusedValue), // Simplified
        fused_estimate: result.fusedValue,
        fused_uncertainty: result.uncertainty,
        disagreement_score: result.disagreementScore,
        max_deviation: result.maxDeviation,
        std_deviation: result.maxDeviation * 0.5, // Approximation
        support_quality: result.supportQuality,
      })
      .select()
      .single()

    if (supportData) {
      familySupport.push(supportData as unknown as MVFamilySupport)
    }
  }

  // Update processing time
  await supabase
    .from('mv_sets')
    .update({ processing_time_ms: Date.now() - startTime })
    .eq('id', mvSetId)

  return {
    mvSetId,
    solution: solutionData as unknown as MVSolution,
    views: mvViews,
    edges: mvEdges,
    familySupport,
    graph,
    fusionResult,
    fallbackDecision,
    status: fallbackDecision.shouldFallback ? 'fallback_used' : 'completed',
    qualityTier,
  }
}

/**
 * Get multi-view solution for a buck/prediction
 */
export async function getMVSolution(buckId: string): Promise<MVSolverResult | null> {
  const supabase = await createClient()

  const { data: mvSet } = await supabase
    .from('mv_sets')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!mvSet) return null

  const { data: solution } = await supabase
    .from('mv_solution')
    .select('*')
    .eq('mv_set_id', mvSet.id)
    .single()

  const { data: views } = await supabase
    .from('mv_views')
    .select('*')
    .eq('mv_set_id', mvSet.id)

  const { data: edges } = await supabase
    .from('mv_edges')
    .select('*')
    .eq('mv_set_id', mvSet.id)

  const { data: familySupport } = await supabase
    .from('mv_family_support')
    .select('*')
    .eq('mv_solution_id', solution?.id)

  // Reconstruct graph from stored data
  const graph: ViewGraph = {
    nodes: (views || []).map(v => ({
      viewId: v.id,
      imageIndex: v.image_index,
      angleClass: v.angle_class as AngleClass,
      overallScore: v.view_overall_score || 0,
      isAccepted: v.is_accepted,
      isOutlier: v.is_outlier,
      familyContributions: {
        spread: v.spread_contribution_score || 0,
        beam: v.beam_contribution_score || 0,
        tine: v.tine_contribution_score || 0,
        mass: v.mass_contribution_score || 0,
        deduction: 0,
      },
    })),
    edges: (edges || []).map(e => ({
      edgeId: e.id,
      viewAId: e.view_a_id,
      viewBId: e.view_b_id,
      weight: e.edge_weight,
      isAccepted: e.accepted_for_fusion,
      matchQuality: e.match_quality,
      familyAgreement: {
        spread: e.spread_agreement_score || 0,
        beam: e.beam_agreement_score || 0,
        tine: e.tine_agreement_score || 0,
        mass: e.mass_agreement_score || 0,
        deduction: 0,
      },
    })),
    connectivity: mvSet.graph_connectivity_score || 0,
    strongestSubgraph: [],
    isolatedNodes: [],
    acceptedEdgeCount: (edges || []).filter(e => e.accepted_for_fusion).length,
    totalEdgeCount: (edges || []).length,
  }

  return {
    mvSetId: mvSet.id,
    solution: solution as unknown as MVSolution,
    views: (views || []) as unknown as MVView[],
    edges: (edges || []) as unknown as MVEdge[],
    familySupport: (familySupport || []) as unknown as MVFamilySupport[],
    graph,
    fusionResult: {
      results: (solution?.family_fusion_details || {}) as Record<MeasurementFamily, any>,
      fusedMeasurements: solution?.fused_measurements || {},
      overallDisagreement: solution?.avg_family_disagreement || 0,
      highDisagreementFamilies: solution?.high_disagreement_families || [],
      overallUncertainty: 0,
    },
    fallbackDecision: {
      shouldFallback: solution?.fallback_used || false,
      triggers: [],
      reason: solution?.fallback_reason || '',
      recommendedMethod: solution?.method as MVSolutionMethod || 'full_graph_fusion',
      bestSingleViewIndex: null,
      bestSubgraphViewIndices: null,
    },
    status: mvSet.status as MVSetStatus,
    qualityTier: solution?.solution_quality_tier as SolutionQualityTier || 'poor',
  }
}
