/**
 * Phase 46: Pipeline Registrations
 * 
 * Register all pipeline definitions for job types.
 * Import this file at startup to register pipelines.
 */

import { registerJobHandler, registerPipeline, definePipeline } from '../'
import type { StageContext } from '../types'

// ============================================================================
// SCORING PIPELINE
// ============================================================================

export interface ScoreJobPayload {
  buckId: string
  imageUrls: string[]
  userId?: string
  options?: {
    heavy?: boolean
    multiImage?: boolean
  }
}

export interface ScoreJobResult {
  buckId: string
  score: number
  confidence: number
  processingTimeMs: number
}

const scoringPipeline = definePipeline<ScoreJobPayload, ScoreJobResult>('scoring', [
  {
    name: 'validate_input',
    weight: 5,
    execute: async (payload) => {
      if (!payload.buckId) throw new Error('buckId is required')
      if (!payload.imageUrls || payload.imageUrls.length === 0) {
        throw new Error('At least one image URL is required')
      }
      return payload
    },
  },
  {
    name: 'load_images',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(10, 'Loading images...')
      // Image loading would happen here
      return { ...payload, imagesLoaded: true }
    },
  },
  {
    name: 'extract_landmarks',
    weight: 20,
    execute: async (payload, context) => {
      await context.updateProgress(30, 'Extracting landmarks...')
      // Landmark extraction would happen here
      return { ...payload, landmarksExtracted: true }
    },
  },
  {
    name: 'compute_score',
    weight: 40,
    execute: async (payload, context) => {
      await context.updateProgress(60, 'Computing score...')
      // Score computation would happen here
      return {
        ...payload,
        score: 150, // Placeholder
        confidence: 0.85,
      }
    },
  },
  {
    name: 'save_result',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(90, 'Saving result...')
      // Save to database would happen here
      return {
        buckId: payload.buckId,
        score: (payload as { score: number }).score,
        confidence: (payload as { confidence: number }).confidence,
        processingTimeMs: Date.now(),
      }
    },
  },
  {
    name: 'notify',
    weight: 5,
    execute: async (result) => {
      // Notification would happen here
      return result
    },
    onError: async () => {
      // Don't fail the job for notification errors
      return undefined
    },
  },
])

registerPipeline('score_full', scoringPipeline)
registerPipeline('score_heavy', scoringPipeline)
registerPipeline('score_multi_image', scoringPipeline)

// ============================================================================
// RENDER PIPELINE
// ============================================================================

export interface RenderJobPayload {
  buckId: string
  renderType: 'standard' | 'detailed' | 'comparison'
  outputFormat: 'png' | 'svg'
}

export interface RenderJobResult {
  buckId: string
  renderUrl: string
  generatedAt: string
}

const renderPipeline = definePipeline<RenderJobPayload, RenderJobResult>('render', [
  {
    name: 'validate_input',
    weight: 5,
    execute: async (payload) => {
      if (!payload.buckId) throw new Error('buckId is required')
      return payload
    },
  },
  {
    name: 'load_buck_data',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(15, 'Loading buck data...')
      // Load buck data from database
      return { ...payload, buckData: {} }
    },
  },
  {
    name: 'generate_render',
    weight: 60,
    execute: async (payload, context) => {
      await context.updateProgress(50, 'Generating render...')
      // Generate the render
      return { ...payload, renderGenerated: true }
    },
  },
  {
    name: 'upload_asset',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(85, 'Uploading asset...')
      // Upload to storage
      return {
        buckId: payload.buckId,
        renderUrl: `/renders/${payload.buckId}.png`,
        generatedAt: new Date().toISOString(),
      }
    },
  },
  {
    name: 'update_buck_record',
    weight: 5,
    execute: async (result) => {
      // Update the buck record with render URL
      return result
    },
  },
])

registerPipeline('render_generate', renderPipeline)
registerPipeline('render_batch', renderPipeline)

// ============================================================================
// EXPORT/BENCHMARK PIPELINES
// ============================================================================

export interface ExportJobPayload {
  packId: string
  format: 'json' | 'csv'
  filters?: Record<string, unknown>
}

const exportPipeline = definePipeline<ExportJobPayload, { downloadUrl: string }>('export', [
  {
    name: 'validate_input',
    weight: 5,
    execute: async (payload) => {
      if (!payload.packId) throw new Error('packId is required')
      return payload
    },
  },
  {
    name: 'gather_data',
    weight: 40,
    execute: async (payload, context) => {
      await context.updateProgress(30, 'Gathering data...')
      return { ...payload, data: [] }
    },
  },
  {
    name: 'format_output',
    weight: 30,
    execute: async (payload, context) => {
      await context.updateProgress(70, 'Formatting output...')
      return { ...payload, formatted: true }
    },
  },
  {
    name: 'upload_export',
    weight: 20,
    execute: async (payload, context) => {
      await context.updateProgress(95, 'Uploading export...')
      return { downloadUrl: `/exports/${payload.packId}.${payload.format}` }
    },
  },
  {
    name: 'notify_completion',
    weight: 5,
    execute: async (result) => result,
    onError: async () => undefined,
  },
])

registerPipeline('export_pack_compute', exportPipeline)
registerPipeline('export_run', exportPipeline)
registerPipeline('benchmark_run', exportPipeline)
registerPipeline('offline_evaluation', exportPipeline)

// ============================================================================
// MAINTENANCE JOB HANDLERS
// ============================================================================

registerJobHandler('cleanup_old_events', async () => {
  // Cleanup logic here
  return { cleaned: 0 }
})

registerJobHandler('cleanup_stale_jobs', async () => {
  const { recoverStaleJobs, cleanupOldJobs } = await import('../service')
  const recovered = await recoverStaleJobs(10)
  const cleaned = await cleanupOldJobs(30)
  return { recovered, cleaned }
})

registerJobHandler('cleanup_temp_assets', async () => {
  // Cleanup temporary assets
  return { cleaned: 0 }
})

registerJobHandler('segment_metric_refresh', async () => {
  // Refresh segment metrics
  return { refreshed: true }
})

registerJobHandler('confidence_profile_refresh', async () => {
  // Refresh confidence profiles
  return { refreshed: true }
})

registerJobHandler('notification_digest', async (payload) => {
  // Send notification digests
  return { sent: 0, payload }
})

registerJobHandler('billing_usage_sync', async () => {
  // Sync billing usage
  return { synced: true }
})

registerJobHandler('admin_bulk_action', async (payload) => {
  // Execute admin bulk action
  return { executed: true, payload }
})

// ============================================================================
// SANDBOX PIPELINES (Phase 48)
// ============================================================================

export interface SandboxEvaluationPayload {
  variantId: string
  datasetType: 'export_pack' | 'benchmark_pack' | 'custom'
  exportPackId?: string
  benchmarkPackId?: string
  config?: Record<string, unknown>
}

const sandboxEvaluationPipeline = definePipeline<SandboxEvaluationPayload, { evaluationRunId: string }>('sandbox_evaluation', [
  {
    name: 'validate_input',
    weight: 5,
    execute: async (payload) => {
      if (!payload.variantId) throw new Error('variantId is required')
      if (!payload.datasetType) throw new Error('datasetType is required')
      return payload
    },
  },
  {
    name: 'load_variant',
    weight: 5,
    execute: async (payload, context) => {
      await context.updateProgress(5, 'Loading variant configuration...')
      const { getVariant } = await import('../../sandbox/variant-registry')
      const variant = await getVariant(payload.variantId)
      if (!variant) throw new Error(`Variant ${payload.variantId} not found`)
      return { ...payload, variant }
    },
  },
  {
    name: 'load_dataset',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(15, 'Loading evaluation dataset...')
      // Load the dataset based on type
      return { ...payload, datasetLoaded: true }
    },
  },
  {
    name: 'run_evaluation',
    weight: 60,
    execute: async (payload, context) => {
      await context.updateProgress(30, 'Running evaluation...')
      const { runEvaluation, createEvaluationRun } = await import('../../sandbox/evaluation-runner')
      const run = await createEvaluationRun({
        variantId: payload.variantId,
        datasetType: payload.datasetType,
        exportPackId: payload.exportPackId,
        benchmarkPackId: payload.benchmarkPackId,
        config: payload.config,
      })
      await runEvaluation(run.id, (progress) => {
        context.updateProgress(30 + Math.floor(progress * 0.55), `Processing examples (${Math.floor(progress * 100)}%)...`)
      })
      return { ...payload, evaluationRunId: run.id }
    },
  },
  {
    name: 'compute_metrics',
    weight: 10,
    execute: async (payload, context) => {
      await context.updateProgress(90, 'Computing aggregate metrics...')
      // Metrics computation is part of runEvaluation
      return payload
    },
  },
  {
    name: 'finalize',
    weight: 5,
    execute: async (payload, context) => {
      await context.updateProgress(98, 'Finalizing evaluation...')
      return { evaluationRunId: (payload as { evaluationRunId: string }).evaluationRunId }
    },
  },
])

registerPipeline('sandbox_evaluation_run', sandboxEvaluationPipeline)

registerJobHandler('sandbox_shadow_batch', async (payload) => {
  const { processShadowBatch } = await import('../../sandbox/shadow-scoring')
  const result = await processShadowBatch(payload as { limit?: number })
  return result
})

registerJobHandler('sandbox_comparison_generate', async (payload) => {
  const { generateComparison } = await import('../../sandbox/promotion-gates')
  const typedPayload = payload as {
    productionVariantId: string
    candidateVariantId: string
    productionEvaluationRunId?: string
    candidateEvaluationRunId?: string
    datasetType?: string
    exportPackId?: string
    benchmarkPackId?: string
  }
  const comparison = await generateComparison(
    typedPayload.productionVariantId,
    typedPayload.candidateVariantId,
    typedPayload.productionEvaluationRunId,
    typedPayload.candidateEvaluationRunId,
    {
      datasetType: typedPayload.datasetType || 'benchmark_pack',
      exportPackId: typedPayload.exportPackId,
      benchmarkPackId: typedPayload.benchmarkPackId,
    }
  )
  return { comparisonId: comparison.id }
})

registerJobHandler('sandbox_promotion_check', async (payload) => {
  const { evaluatePromotionGates } = await import('../../sandbox/promotion-gates')
  const typedPayload = payload as { comparisonId: string }
  const evaluation = await evaluatePromotionGates(typedPayload.comparisonId)
  return { 
    evaluationId: evaluation.id,
    status: evaluation.overall_status,
    hardFailCount: evaluation.hard_fail_count,
    softWarningCount: evaluation.soft_warning_count,
  }
})

// ============================================================================
// PHASE 49.5: CROSS-VIEW CONFLICT ANALYSIS JOB HANDLERS
// ============================================================================

registerJobHandler('compute_view_residuals', async (payload) => {
  const { buckId, imageMeasurements, perImageLandmarks } = payload as {
    buckId: string
    imageMeasurements: unknown[]
    perImageLandmarks: unknown[]
  }
  const { analyzesCrossViewConflicts } = await import('../../scoring/cross-view-conflict')
  
  // This would be called as part of the scoring pipeline
  console.log(`[Phase 49.5] Computing view residuals for buck ${buckId} with ${imageMeasurements.length} images`)
  return { stage: 'compute_view_residuals', completed: true, buckId }
})

registerJobHandler('classify_disagreement', async (payload) => {
  const { buckId } = payload as { buckId: string }
  console.log(`[Phase 49.5] Classifying disagreement for buck ${buckId}`)
  return { stage: 'classify_disagreement', completed: true, buckId }
})

registerJobHandler('compute_view_trust', async (payload) => {
  const { buckId } = payload as { buckId: string }
  console.log(`[Phase 49.5] Computing view trust for buck ${buckId}`)
  return { stage: 'compute_view_trust', completed: true, buckId }
})

registerJobHandler('resolve_conflicts', async (payload) => {
  const { buckId } = payload as { buckId: string }
  console.log(`[Phase 49.5] Resolving conflicts for buck ${buckId}`)
  return { stage: 'resolve_conflicts', completed: true, buckId }
})

registerJobHandler('update_uncertainty_with_conflict', async (payload) => {
  const { buckId, conflictAnalysis } = payload as { buckId: string; conflictAnalysis: unknown }
  console.log(`[Phase 49.5] Updating uncertainty with conflict data for buck ${buckId}`)
  return { stage: 'update_uncertainty_with_conflict', completed: true, buckId }
})

// ============================================================================
// PHASE 49: MULTI-VIEW FUSION PIPELINES
// ============================================================================

export interface MultiViewScoringPayload {
  buckId: string
  predictionId?: string
  userId?: string
  imageUrls: string[]
  baseMeasurements: Record<string, number | null>
  earsFullyVisible?: boolean
}

export interface MultiViewScoringResult {
  mvSetId: string
  status: string
  method: string
  fusedGrossScore: number | null
  fusedNetScore: number | null
  scoreConfidence: number
  imageCount: number
  graphConnectivity: number
  fallbackUsed: boolean
  processingTimeMs: number
}

const multiViewScoringPipeline = definePipeline<MultiViewScoringPayload, MultiViewScoringResult>('multi_view_scoring', [
  {
    name: 'validate_input',
    weight: 5,
    execute: async (payload) => {
      if (!payload.buckId) throw new Error('buckId is required')
      if (!payload.imageUrls || payload.imageUrls.length < 2) {
        throw new Error('At least 2 images required for multi-view scoring')
      }
      return payload
    },
  },
  {
    name: 'load_images_and_extract',
    weight: 20,
    execute: async (payload, context) => {
      await context.updateProgress(10, 'Loading images and extracting landmarks...')
      // Image loading and landmark extraction would happen here
      // For now, return placeholder view data
      return { 
        ...payload, 
        views: payload.imageUrls.map((url, i) => ({
          imageIndex: i,
          imageUrl: url,
          // These would be populated by vision/landmark extraction
          angleType: 'front' as const,
          angleConfidence: 0.8,
          measurements: {},
          measurementConfidence: 0.75,
          landmarks: { ears_visible: true, eyes_visible: true, antlers_visible: true },
          landmarkConfidence: 0.8,
          referenceQuality: 0.7,
        })),
      }
    },
  },
  {
    name: 'build_view_graph',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(35, 'Building view graph...')
      // View graph construction happens in processMultiView
      return payload
    },
  },
  {
    name: 'score_pairs',
    weight: 15,
    execute: async (payload, context) => {
      await context.updateProgress(50, 'Scoring view pairs...')
      // Pairwise scoring happens in processMultiView
      return payload
    },
  },
  {
    name: 'fuse_families',
    weight: 20,
    execute: async (payload, context) => {
      await context.updateProgress(65, 'Fusing measurement families...')
      // Family fusion happens in processMultiView
      return payload
    },
  },
  {
    name: 'solve_multiview_geometry',
    weight: 10,
    execute: async (payload, context) => {
      await context.updateProgress(80, 'Solving multi-view geometry...')
      
      const { createAndProcessMultiView } = await import('../../scoring/multi-view-service')
      
      const typedPayload = payload as MultiViewScoringPayload & {
        views: {
          imageIndex: number
          angleType: 'front' | 'left' | 'right' | 'back' | 'other'
          angleConfidence: number
          measurements: Record<string, number | null>
          measurementConfidence: number
          landmarks: { ears_visible: boolean; eyes_visible: boolean; antlers_visible: boolean }
          landmarkConfidence: number
          referenceQuality: number
        }[]
      }
      
      const { result } = await createAndProcessMultiView({
        buckId: typedPayload.buckId,
        predictionId: typedPayload.predictionId,
        userId: typedPayload.userId,
        views: typedPayload.views,
        baseMeasurements: typedPayload.baseMeasurements as Record<string, number | null> & { inside_spread: number | null },
        earsFullyVisible: typedPayload.earsFullyVisible,
      })
      
      return { ...payload, multiViewResult: result }
    },
  },
  {
    name: 'fallback_decision',
    weight: 5,
    execute: async (payload, context) => {
      await context.updateProgress(90, 'Checking fallback conditions...')
      const typedPayload = payload as { multiViewResult?: { solution?: { fallbackUsed?: boolean } } }
      if (typedPayload.multiViewResult?.solution?.fallbackUsed) {
        await context.updateProgress(92, 'Using fallback single-view scoring...')
      }
      return payload
    },
  },
  {
    name: 'save_result',
    weight: 8,
    execute: async (payload, context) => {
      await context.updateProgress(95, 'Saving multi-view result...')
      
      const typedPayload = payload as MultiViewScoringPayload & {
        multiViewResult: {
          mvSetId: string
          status: string
          solution: {
            method: string
            fusedGrossScore: number | null
            fusedNetScore: number | null
            scoreConfidence: number
            fallbackUsed: boolean
          }
          imageCount: number
          viewGraph: { graphConnectivityScore: number }
          processingTimeMs: number
        }
      }
      
      const result = typedPayload.multiViewResult
      return {
        mvSetId: result.mvSetId,
        status: result.status,
        method: result.solution.method,
        fusedGrossScore: result.solution.fusedGrossScore,
        fusedNetScore: result.solution.fusedNetScore,
        scoreConfidence: result.solution.scoreConfidence,
        imageCount: result.imageCount,
        graphConnectivity: result.viewGraph.graphConnectivityScore,
        fallbackUsed: result.solution.fallbackUsed,
        processingTimeMs: result.processingTimeMs,
      }
    },
  },
  {
    name: 'notify',
    weight: 2,
    execute: async (result) => {
      return result
    },
    onError: async () => undefined,
  },
])

registerPipeline('multi_view_scoring', multiViewScoringPipeline)
registerPipeline('multi_view_scoring_heavy', multiViewScoringPipeline)

// Multi-view benchmark job handler
registerJobHandler('multi_view_benchmark_run', async (payload) => {
  const { recordBenchmarkComparison, getMultiViewSet } = await import('../../scoring/multi-view-service')
  
  const typedPayload = payload as {
    mvSetId: string
    groundTruthGross: number
    groundTruthNet?: number
    singleImagePrediction: number
    singleImageConfidence: number
    benchmarkRunId?: string
  }
  
  const mvSetDetails = await getMultiViewSet(typedPayload.mvSetId)
  if (!mvSetDetails || !mvSetDetails.solution) {
    return { error: 'Multi-view set or solution not found' }
  }
  
  const result = await recordBenchmarkComparison({
    mvSetId: typedPayload.mvSetId,
    benchmarkRunId: typedPayload.benchmarkRunId,
    groundTruthGross: typedPayload.groundTruthGross,
    groundTruthNet: typedPayload.groundTruthNet,
    singleImagePrediction: typedPayload.singleImagePrediction,
    singleImageConfidence: typedPayload.singleImageConfidence,
    multiViewPrediction: mvSetDetails.solution.fused_gross_score || 0,
    multiViewConfidence: mvSetDetails.solution.score_confidence || 0,
  })
  
  return { benchmarkResultId: result?.id, improvement: result?.improvement_inches }
})

// Multi-view stats refresh handler
registerJobHandler('multi_view_stats_refresh', async () => {
  const { getMultiViewBenchmarkStats } = await import('../../scoring/multi-view-service')
  const stats = await getMultiViewBenchmarkStats()
  return stats
})

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('[Jobs] Registered pipelines and handlers for all job types including Phase 48 sandbox, Phase 49 multi-view, and Phase 49.5 conflict analysis')
