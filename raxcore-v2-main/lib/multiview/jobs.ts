/**
 * Phase 49: Multi-View Fusion Job Pipeline
 * 
 * Integrates multi-view scoring with the durable job system from Phase 46.
 */

import type { PipelineStage, StageContext } from '@/lib/jobs/types'
import { solveMultiView, type MVSolverInput, type MVSolverResult } from './solver'
import type { AngleClass } from './types'
import type { Measurements, LandmarksDetected } from '@/lib/types'
import { createClient } from '@/lib/supabase/server'

// ============================================================================
// MULTI-VIEW FUSION JOB PAYLOAD
// ============================================================================

export interface MVFusionJobPayload {
  buckId: string
  predictionId?: string
  userId?: string
  images: Array<{
    buckImageId: string
    imageUrl: string
    imageIndex: number
  }>
}

export interface MVFusionJobResult {
  mvSetId: string
  status: string
  qualityTier: string
  fusedMeasurements: Partial<Measurements>
  fallbackUsed: boolean
  fallbackReason: string | null
  processingTimeMs: number
  graphConnectivity: number
  acceptedViews: number
  rejectedViews: number
}

// ============================================================================
// PIPELINE STAGES
// ============================================================================

/**
 * Stage 1: Load image data and landmarks
 */
export const loadImageDataStage: PipelineStage<MVFusionJobPayload, {
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
}> = {
  name: 'load_image_data',
  
  async execute(payload, context) {
    await context.updateProgress(10, 'Loading image data and landmarks')
    
    const supabase = await createClient()
    const views: MVSolverInput['views'] = []
    
    for (const image of payload.images) {
      // Load buck image data
      const { data: buckImage } = await supabase
        .from('buck_images')
        .select('*, landmarks_detected, detected_angle_type, angle_confidence')
        .eq('id', image.buckImageId)
        .single()
      
      if (!buckImage) {
        console.warn(`[MVJob] Buck image not found: ${image.buckImageId}`)
        continue
      }
      
      // Load single-image prediction if exists
      const { data: prediction } = await supabase
        .from('predictions')
        .select('measurements, confidence, reference_quality')
        .eq('buck_image_id', image.buckImageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      const angleClass = mapAngleTypeToClass(buckImage.detected_angle_type)
      
      views.push({
        imageIndex: image.imageIndex,
        buckImageId: image.buckImageId,
        angleClass,
        landmarks: buckImage.landmarks_detected || {},
        measurements: prediction?.measurements || {},
        confidence: buckImage.angle_confidence || 0.5,
        referenceQuality: prediction?.reference_quality || 0.5,
      })
    }
    
    await context.recordStage('load_image_data', 'completed', { viewCount: views.length })
    
    return { payload, views }
  },
}

/**
 * Stage 2: Build view graph
 */
export const buildViewGraphStage: PipelineStage<{
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
}, {
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}> = {
  name: 'build_view_graph',
  
  async execute(input, context) {
    await context.updateProgress(30, 'Building view graph')
    
    // The actual graph building happens in the solver, but we can
    // do a quick pre-check here
    const graphMetrics = {
      connectivity: 0,
      acceptedEdges: 0,
      outliers: 0,
    }
    
    await context.recordStage('build_view_graph', 'completed', graphMetrics)
    
    return { ...input, graphMetrics }
  },
}

/**
 * Stage 3: Score pairs
 */
export const scorePairsStage: PipelineStage<{
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}, {
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}> = {
  name: 'score_pairs',
  
  async execute(input, context) {
    await context.updateProgress(50, 'Scoring view pairs')
    
    // Pair scoring happens in the solver
    await context.recordStage('score_pairs', 'completed')
    
    return input
  },
}

/**
 * Stage 4: Fuse families
 */
export const fuseFamiliesStage: PipelineStage<{
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}, {
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}> = {
  name: 'fuse_families',
  
  async execute(input, context) {
    await context.updateProgress(70, 'Fusing measurement families')
    
    await context.recordStage('fuse_families', 'completed')
    
    return input
  },
}

/**
 * Stage 5: Solve multi-view geometry
 */
export const solveGeometryStage: PipelineStage<{
  payload: MVFusionJobPayload
  views: MVSolverInput['views']
  graphMetrics: { connectivity: number; acceptedEdges: number; outliers: number }
}, MVSolverResult> = {
  name: 'solve_multiview_geometry',
  
  async execute(input, context) {
    await context.updateProgress(85, 'Solving multi-view geometry')
    
    const result = await solveMultiView({
      buckId: input.payload.buckId,
      predictionId: input.payload.predictionId,
      userId: input.payload.userId,
      views: input.views,
    })
    
    await context.recordStage('solve_multiview_geometry', 'completed', {
      mvSetId: result.mvSetId,
      qualityTier: result.qualityTier,
      fallbackUsed: result.fallbackDecision.shouldFallback,
    })
    
    return result
  },
}

/**
 * Stage 6: Fallback decision
 */
export const fallbackDecisionStage: PipelineStage<MVSolverResult, MVFusionJobResult> = {
  name: 'fallback_decision',
  
  async execute(result, context) {
    await context.updateProgress(95, 'Finalizing solution')
    
    const jobResult: MVFusionJobResult = {
      mvSetId: result.mvSetId,
      status: result.status,
      qualityTier: result.qualityTier,
      fusedMeasurements: result.solution?.fused_measurements || {},
      fallbackUsed: result.fallbackDecision.shouldFallback,
      fallbackReason: result.fallbackDecision.reason,
      processingTimeMs: result.solution?.processing_time_ms || 0,
      graphConnectivity: result.graph.connectivity,
      acceptedViews: result.views.filter(v => v.is_accepted).length,
      rejectedViews: result.views.filter(v => !v.is_accepted).length,
    }
    
    await context.recordStage('fallback_decision', 'completed', {
      fallbackUsed: jobResult.fallbackUsed,
      fallbackReason: jobResult.fallbackReason,
    })
    
    await context.updateProgress(100, 'Multi-view fusion complete')
    
    return jobResult
  },
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mapAngleTypeToClass(angleType: string | null): AngleClass {
  switch (angleType) {
    case 'front':
    case 'frontal':
      return 'front'
    case 'left':
    case 'left_side':
      return 'left'
    case 'right':
    case 'right_side':
      return 'right'
    case 'back':
    case 'rear':
      return 'back'
    case 'front_left':
    case 'quartering_left':
      return 'front_left'
    case 'front_right':
    case 'quartering_right':
      return 'front_right'
    default:
      return 'unknown'
  }
}

// ============================================================================
// PIPELINE DEFINITION
// ============================================================================

export const multiviewFusionPipeline = {
  name: 'multiview_fusion',
  stages: [
    loadImageDataStage,
    buildViewGraphStage,
    scorePairsStage,
    fuseFamiliesStage,
    solveGeometryStage,
    fallbackDecisionStage,
  ],
}
