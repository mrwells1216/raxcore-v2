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
// INITIALIZATION
// ============================================================================

console.log('[Jobs] Registered pipelines and handlers for all job types including Phase 48 sandbox')
