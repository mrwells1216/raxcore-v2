/**
 * Phase 46: Job Worker Execution Layer
 * 
 * Provides worker infrastructure for claiming and executing jobs.
 * Designed for serverless environments (Vercel Functions).
 */

import {
  claimNextJob,
  completeJob,
  failJob,
  recoverStaleJobs,
} from './service'
import {
  executePipeline,
  hasPipeline,
  createStageContext,
} from './pipeline'
import type {
  ClaimedJob,
  JobType,
  WorkerConfig,
  WorkerStats,
} from './types'

// ============================================================================
// WORKER CONFIGURATION
// ============================================================================

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  workerId: `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  pollIntervalMs: 1000,
  lockDurationSeconds: 300, // 5 minutes
  maxConcurrent: 1,
  shutdownGracePeriodMs: 10000,
}

// ============================================================================
// JOB HANDLERS
// ============================================================================

type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  job: ClaimedJob
) => Promise<TResult>

const jobHandlers = new Map<JobType, JobHandler>()

/**
 * Register a job handler for a specific job type
 */
export function registerJobHandler<TPayload, TResult>(
  jobType: JobType,
  handler: JobHandler<TPayload, TResult>
): void {
  jobHandlers.set(jobType, handler as JobHandler)
}

/**
 * Get a registered job handler
 */
export function getJobHandler(jobType: JobType): JobHandler | undefined {
  return jobHandlers.get(jobType)
}

// ============================================================================
// SINGLE JOB EXECUTION
// ============================================================================

/**
 * Execute a single claimed job
 */
export async function executeJob(job: ClaimedJob): Promise<{ success: boolean; error?: Error }> {
  const context = createStageContext(
    job.jobId,
    job.jobType,
    job.traceId,
    job.retryCount
  )
  
  try {
    let result: unknown
    
    // Check for pipeline first
    if (hasPipeline(job.jobType)) {
      result = await executePipeline(job.jobType, job.payload, context)
    } else {
      // Fall back to handler
      const handler = getJobHandler(job.jobType)
      if (!handler) {
        throw new Error(`No handler or pipeline registered for job type: ${job.jobType}`)
      }
      result = await handler(job.payload, job)
    }
    
    await completeJob(job.jobId, {
      success: true,
      data: result as Record<string, unknown>,
    })
    
    return { success: true }
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    const willRetry = await failJob(job.jobId, err)
    
    // Log the error for observability
    console.error(`[Worker] Job ${job.jobId} (${job.jobType}) failed:`, err.message, {
      willRetry,
      retryCount: job.retryCount,
    })
    
    return { success: false, error: err }
  }
}

// ============================================================================
// BATCH JOB PROCESSING
// ============================================================================

/**
 * Process a batch of jobs (for cron/scheduled invocations)
 */
export async function processJobBatch(
  config: Partial<WorkerConfig> = {},
  maxJobs = 10
): Promise<{
  processed: number
  succeeded: number
  failed: number
  errors: Array<{ jobId: string; error: string }>
}> {
  const workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config }
  
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: Array<{ jobId: string; error: string }> = []
  
  // First, recover any stale jobs
  await recoverStaleJobs(10)
  
  // Process jobs up to the limit
  while (processed < maxJobs) {
    const job = await claimNextJob(
      workerConfig.workerId,
      workerConfig.jobTypes,
      workerConfig.lockDurationSeconds
    )
    
    if (!job) {
      // No more jobs available
      break
    }
    
    const result = await executeJob(job)
    processed++
    
    if (result.success) {
      succeeded++
    } else {
      failed++
      errors.push({
        jobId: job.jobId,
        error: result.error?.message ?? 'Unknown error',
      })
    }
  }
  
  return { processed, succeeded, failed, errors }
}

// ============================================================================
// SERVERLESS WORKER ENDPOINT
// ============================================================================

export interface WorkerInvocationResult {
  workerId: string
  jobsProcessed: number
  jobsSucceeded: number
  jobsFailed: number
  durationMs: number
  recoveredStaleJobs: number
  errors: Array<{ jobId: string; error: string }>
}

/**
 * Main worker invocation function for serverless environments
 * Call this from a cron job or webhook
 */
export async function invokeWorker(
  config: Partial<WorkerConfig> = {},
  maxJobs = 5
): Promise<WorkerInvocationResult> {
  const startTime = Date.now()
  const workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config }
  
  // Recover stale jobs first
  const recoveredStaleJobs = await recoverStaleJobs(10)
  
  // Process batch
  const result = await processJobBatch(workerConfig, maxJobs)
  
  return {
    workerId: workerConfig.workerId,
    jobsProcessed: result.processed,
    jobsSucceeded: result.succeeded,
    jobsFailed: result.failed,
    durationMs: Date.now() - startTime,
    recoveredStaleJobs,
    errors: result.errors,
  }
}

// ============================================================================
// IMMEDIATE JOB EXECUTION
// ============================================================================

/**
 * Execute a job immediately (bypass queue)
 * Use for critical path operations that need synchronous execution
 */
export async function executeJobImmediately<TPayload, TResult>(
  jobType: JobType,
  payload: TPayload,
  traceId?: string
): Promise<TResult> {
  const tempJobId = `immediate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  
  const context = createStageContext(
    tempJobId,
    jobType,
    traceId ?? null,
    0
  )
  
  // Override context methods to no-op for immediate execution
  context.updateProgress = async () => {}
  context.recordStage = async () => {}
  
  if (hasPipeline(jobType)) {
    return executePipeline(jobType, payload, context) as Promise<TResult>
  }
  
  const handler = getJobHandler(jobType)
  if (!handler) {
    throw new Error(`No handler or pipeline registered for job type: ${jobType}`)
  }
  
  const job: ClaimedJob = {
    jobId: tempJobId,
    jobType,
    payload: payload as Record<string, unknown>,
    retryCount: 0,
    traceId: traceId ?? null,
  }
  
  return handler(payload, job) as Promise<TResult>
}

// ============================================================================
// WORKER STATS (for monitoring)
// ============================================================================

const workerStats: Record<string, WorkerStats> = {}

export function getWorkerStats(workerId: string): WorkerStats | undefined {
  return workerStats[workerId]
}

export function getAllWorkerStats(): WorkerStats[] {
  return Object.values(workerStats)
}
