/**
 * Phase 46: Pipeline Stage System
 * 
 * Provides a structured way to define and execute multi-stage pipelines
 * with progress tracking, error handling, and stage history recording.
 */

import {
  updateJobProgress,
  recordStageHistory,
} from './service'
import type {
  PipelineStage,
  StageContext,
  JobType,
  StageStatus,
} from './types'

// ============================================================================
// PIPELINE BUILDER
// ============================================================================

export interface PipelineDefinition<TPayload = unknown, TResult = unknown> {
  name: string
  stages: PipelineStageDefinition[]
  execute: (payload: TPayload, context: StageContext) => Promise<TResult>
}

export interface PipelineStageDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  weight: number // Relative weight for progress calculation (0-100 total)
  execute: (input: TInput, context: StageContext) => Promise<TOutput>
  shouldSkip?: (input: TInput, context: StageContext) => boolean
  onError?: (error: Error, input: TInput, context: StageContext) => Promise<TOutput | void>
}

/**
 * Create a pipeline definition with typed stages
 */
export function definePipeline<TPayload, TResult>(
  name: string,
  stages: PipelineStageDefinition[]
): PipelineDefinition<TPayload, TResult> {
  // Normalize weights to sum to 100
  const totalWeight = stages.reduce((sum, s) => sum + s.weight, 0)
  const normalizedStages = stages.map(s => ({
    ...s,
    weight: totalWeight > 0 ? (s.weight / totalWeight) * 100 : 100 / stages.length,
  }))
  
  return {
    name,
    stages: normalizedStages,
    execute: async (payload: TPayload, context: StageContext): Promise<TResult> => {
      return runPipeline(normalizedStages, payload, context) as Promise<TResult>
    },
  }
}

// ============================================================================
// PIPELINE EXECUTION
// ============================================================================

/**
 * Run a pipeline with stage tracking
 */
async function runPipeline(
  stages: PipelineStageDefinition[],
  initialInput: unknown,
  context: StageContext
): Promise<unknown> {
  let currentInput = initialInput
  let progressAccumulated = 0
  
  for (const stage of stages) {
    const stageStartTime = Date.now()
    
    // Check if stage should be skipped
    if (stage.shouldSkip?.(currentInput, context)) {
      await recordStageHistory(context.jobId, stage.name, 'skipped')
      progressAccumulated += stage.weight
      await context.updateProgress(Math.round(progressAccumulated), `Skipped: ${stage.name}`)
      continue
    }
    
    // Record stage start
    await recordStageHistory(context.jobId, stage.name, 'started')
    await context.updateProgress(Math.round(progressAccumulated), `Running: ${stage.name}`)
    
    try {
      // Execute the stage
      const output = await stage.execute(currentInput, context)
      
      const durationMs = Date.now() - stageStartTime
      await recordStageHistory(context.jobId, stage.name, 'completed', durationMs)
      
      progressAccumulated += stage.weight
      currentInput = output
      
    } catch (error) {
      const durationMs = Date.now() - stageStartTime
      const err = error instanceof Error ? error : new Error(String(error))
      
      // Try error handler if provided
      if (stage.onError) {
        try {
          const recovered = await stage.onError(err, currentInput, context)
          if (recovered !== undefined) {
            await recordStageHistory(context.jobId, stage.name, 'completed', durationMs, undefined, {
              recovered: true,
              originalError: err.message,
            })
            progressAccumulated += stage.weight
            currentInput = recovered
            continue
          }
        } catch {
          // Error handler failed, fall through to failure
        }
      }
      
      // Record failure and rethrow
      await recordStageHistory(context.jobId, stage.name, 'failed', durationMs, err.message)
      throw err
    }
  }
  
  await context.updateProgress(100, 'Completed')
  return currentInput
}

// ============================================================================
// STAGE CONTEXT FACTORY
// ============================================================================

/**
 * Create a stage context for pipeline execution
 */
export function createStageContext(
  jobId: string,
  jobType: JobType,
  traceId: string | null,
  retryCount: number
): StageContext {
  return {
    jobId,
    jobType,
    traceId,
    retryCount,
    
    updateProgress: async (percent: number, message?: string) => {
      await updateJobProgress(jobId, {
        stage: message ?? '',
        percent: Math.min(100, Math.max(0, percent)),
      })
    },
    
    recordStage: async (
      stage: string,
      status: StageStatus,
      metadata?: Record<string, unknown>
    ) => {
      await recordStageHistory(jobId, stage, status, undefined, undefined, metadata)
    },
  }
}

// ============================================================================
// COMMON PIPELINE STAGES
// ============================================================================

/**
 * Create a validation stage
 */
export function validationStage<T>(
  validator: (input: T) => { valid: boolean; errors?: string[] }
): PipelineStageDefinition<T, T> {
  return {
    name: 'validation',
    weight: 5,
    execute: async (input) => {
      const result = validator(input)
      if (!result.valid) {
        throw new Error(`Validation failed: ${result.errors?.join(', ') ?? 'unknown error'}`)
      }
      return input
    },
  }
}

/**
 * Create a data loading stage
 */
export function loadDataStage<TId, TData>(
  loader: (id: TId) => Promise<TData | null>,
  idExtractor: (input: TId) => string
): PipelineStageDefinition<TId, TData> {
  return {
    name: 'load_data',
    weight: 10,
    execute: async (input) => {
      const data = await loader(input)
      if (!data) {
        throw new Error(`Data not found for id: ${idExtractor(input)}`)
      }
      return data
    },
  }
}

/**
 * Create a save result stage
 */
export function saveResultStage<T>(
  saver: (data: T) => Promise<void>
): PipelineStageDefinition<T, T> {
  return {
    name: 'save_result',
    weight: 10,
    execute: async (input) => {
      await saver(input)
      return input
    },
  }
}

/**
 * Create a notification stage
 */
export function notificationStage<T>(
  notifier: (data: T, context: StageContext) => Promise<void>,
  shouldSkip?: (data: T) => boolean
): PipelineStageDefinition<T, T> {
  return {
    name: 'notification',
    weight: 5,
    shouldSkip,
    execute: async (input, context) => {
      await notifier(input, context)
      return input
    },
    onError: async () => {
      // Don't fail the whole pipeline for notification errors
      return undefined
    },
  }
}

// ============================================================================
// PIPELINE REGISTRY
// ============================================================================

const pipelineRegistry = new Map<JobType, PipelineDefinition>()

/**
 * Register a pipeline for a job type
 */
export function registerPipeline<TPayload, TResult>(
  jobType: JobType,
  pipeline: PipelineDefinition<TPayload, TResult>
): void {
  pipelineRegistry.set(jobType, pipeline as PipelineDefinition)
}

/**
 * Get a registered pipeline
 */
export function getPipeline(jobType: JobType): PipelineDefinition | undefined {
  return pipelineRegistry.get(jobType)
}

/**
 * Check if a pipeline is registered
 */
export function hasPipeline(jobType: JobType): boolean {
  return pipelineRegistry.has(jobType)
}

// ============================================================================
// PIPELINE EXECUTION HELPERS
// ============================================================================

/**
 * Execute a registered pipeline for a job
 */
export async function executePipeline<TPayload, TResult>(
  jobType: JobType,
  payload: TPayload,
  context: StageContext
): Promise<TResult> {
  const pipeline = getPipeline(jobType)
  if (!pipeline) {
    throw new Error(`No pipeline registered for job type: ${jobType}`)
  }
  
  return pipeline.execute(payload, context) as Promise<TResult>
}

/**
 * Wrap an async function as a simple single-stage pipeline
 */
export function wrapAsSimplePipeline<TPayload, TResult>(
  name: string,
  handler: (payload: TPayload, context: StageContext) => Promise<TResult>
): PipelineDefinition<TPayload, TResult> {
  return definePipeline<TPayload, TResult>(name, [
    {
      name: 'execute',
      weight: 100,
      execute: handler as (input: unknown, context: StageContext) => Promise<unknown>,
    },
  ])
}
