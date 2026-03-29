/**
 * Phase 46: Durable Job System Types
 * 
 * Type definitions for the async pipeline orchestration system.
 */

// ============================================================================
// CORE ENUMS (match database enums)
// ============================================================================

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter'

export type JobType =
  // Scoring pipeline
  | 'score_full'
  | 'score_heavy'
  | 'score_multi_image'
  // Multi-view fusion (Phase 49)
  | 'multiview_fusion'
  | 'multiview_batch'
  // Render
  | 'render_generate'
  | 'render_batch'
  // Export/retraining
  | 'export_pack_compute'
  | 'export_run'
  | 'benchmark_run'
  | 'offline_evaluation'
  // Sandbox (Phase 48)
  | 'sandbox_evaluation_run'
  | 'sandbox_shadow_batch'
  | 'sandbox_comparison_generate'
  | 'sandbox_promotion_check'
  // Maintenance
  | 'cleanup_old_events'
  | 'cleanup_stale_jobs'
  | 'cleanup_temp_assets'
  | 'segment_metric_refresh'
  | 'confidence_profile_refresh'
  // Notification
  | 'notification_digest'
  // Billing
  | 'billing_usage_sync'
  // Admin
  | 'admin_bulk_action'

export type JobPriority = 'critical' | 'high' | 'normal' | 'low' | 'background'

export type StageStatus = 'started' | 'completed' | 'failed' | 'skipped'

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface DurableJob {
  id: string
  job_type: JobType
  idempotency_key: string | null
  status: JobStatus
  stage: string | null
  progress_percent: number
  priority: JobPriority
  scheduled_for: string
  payload: Record<string, unknown>
  result_summary: Record<string, unknown> | null
  error_summary: Record<string, unknown> | null
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  trace_id: string | null
  correlation_id: string | null
  requested_by_user_id: string | null
  buck_id: string | null
  render_job_id: string | null
  benchmark_pack_id: string | null
  export_pack_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  cancelled_at: string | null
  worker_id: string | null
  locked_until: string | null
}

export interface JobStageHistory {
  id: string
  job_id: string
  stage: string
  status: StageStatus
  duration_ms: number | null
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ScheduledJobDefinition {
  id: string
  name: string
  job_type: JobType
  cron_expression: string | null
  interval_minutes: number | null
  payload: Record<string, unknown>
  priority: JobPriority
  max_retries: number
  is_enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface CreateJobParams {
  jobType: JobType
  payload: Record<string, unknown>
  priority?: JobPriority
  maxRetries?: number
  scheduledFor?: Date
  idempotencyKey?: string
  traceId?: string
  correlationId?: string
  requestedByUserId?: string
  buckId?: string
  renderJobId?: string
  benchmarkPackId?: string
  exportPackId?: string
}

export interface ClaimedJob {
  jobId: string
  jobType: JobType
  payload: Record<string, unknown>
  retryCount: number
  traceId: string | null
}

export interface JobProgress {
  stage: string
  percent: number
  message?: string
}

export interface JobResult {
  success: boolean
  data?: Record<string, unknown>
  error?: {
    code: string
    message: string
    stack?: string
  }
}

export interface JobStats {
  queued: number
  running: number
  completed: number
  failed: number
  deadLetter: number
  byType: Record<string, number>
  avgDurationMs: number
  successRate: number
}

export interface JobFilter {
  status?: JobStatus | JobStatus[]
  jobType?: JobType | JobType[]
  userId?: string
  traceId?: string
  buckId?: string
  createdAfter?: Date
  createdBefore?: Date
}

// ============================================================================
// PIPELINE STAGE TYPES
// ============================================================================

export interface PipelineStage<TInput = unknown, TOutput = unknown> {
  name: string
  execute: (input: TInput, context: StageContext) => Promise<TOutput>
  shouldSkip?: (input: TInput, context: StageContext) => boolean
  onError?: (error: Error, context: StageContext) => Promise<void>
}

export interface StageContext {
  jobId: string
  jobType: JobType
  traceId: string | null
  retryCount: number
  updateProgress: (percent: number, message?: string) => Promise<void>
  recordStage: (stage: string, status: StageStatus, metadata?: Record<string, unknown>) => Promise<void>
}

export interface Pipeline<TPayload = unknown, TResult = unknown> {
  name: string
  stages: PipelineStage[]
  execute: (payload: TPayload, context: StageContext) => Promise<TResult>
}

// ============================================================================
// WORKER TYPES
// ============================================================================

export interface WorkerConfig {
  workerId: string
  jobTypes?: JobType[]
  pollIntervalMs: number
  lockDurationSeconds: number
  maxConcurrent: number
  shutdownGracePeriodMs: number
}

export interface WorkerStats {
  workerId: string
  jobsProcessed: number
  jobsSucceeded: number
  jobsFailed: number
  currentJobs: number
  uptimeMs: number
  lastPollAt: string | null
}
