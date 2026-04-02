/**
 * Phase 46: Core Job Service
 * 
 * Provides CRUD operations for durable jobs, job claiming, status updates,
 * and job lifecycle management.
 */

import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type {
  DurableJob,
  JobStageHistory,
  ScheduledJobDefinition,
  CreateJobParams,
  ClaimedJob,
  JobProgress,
  JobResult,
  JobStats,
  JobFilter,
  JobStatus,
  JobType,
  StageStatus,
} from './types'

// ============================================================================
// JOB CREATION
// ============================================================================

/**
 * Create a new durable job
 */
export async function createJob(params: CreateJobParams): Promise<DurableJob> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase
    .from('durable_jobs')
    .insert({
      job_type: params.jobType,
      payload: params.payload,
      priority: params.priority ?? 'normal',
      max_retries: params.maxRetries ?? 3,
      scheduled_for: params.scheduledFor?.toISOString() ?? new Date().toISOString(),
      idempotency_key: params.idempotencyKey ?? null,
      trace_id: params.traceId ?? null,
      correlation_id: params.correlationId ?? null,
      requested_by_user_id: params.requestedByUserId ?? null,
      buck_id: params.buckId ?? null,
      render_job_id: params.renderJobId ?? null,
      benchmark_pack_id: params.benchmarkPackId ?? null,
      export_pack_id: params.exportPackId ?? null,
    })
    .select()
    .single()
  
  if (error) {
    // Handle idempotency key conflict - return existing job
    if (error.code === '23505' && params.idempotencyKey) {
      const { data: existing } = await supabase
        .from('durable_jobs')
        .select()
        .eq('idempotency_key', params.idempotencyKey)
        .single()
      
      if (existing) return existing as DurableJob
    }
    throw new Error(`Failed to create job: ${error.message}`)
  }
  
  return data as DurableJob
}

/**
 * Create multiple jobs in a batch
 */
export async function createJobBatch(jobs: CreateJobParams[]): Promise<DurableJob[]> {
  const supabase = await getServiceSupabase()
  
  const rows = jobs.map(params => ({
    job_type: params.jobType,
    payload: params.payload,
    priority: params.priority ?? 'normal',
    max_retries: params.maxRetries ?? 3,
    scheduled_for: params.scheduledFor?.toISOString() ?? new Date().toISOString(),
    idempotency_key: params.idempotencyKey ?? null,
    trace_id: params.traceId ?? null,
    correlation_id: params.correlationId ?? null,
    requested_by_user_id: params.requestedByUserId ?? null,
    buck_id: params.buckId ?? null,
    render_job_id: params.renderJobId ?? null,
    benchmark_pack_id: params.benchmarkPackId ?? null,
    export_pack_id: params.exportPackId ?? null,
  }))
  
  const { data, error } = await supabase
    .from('durable_jobs')
    .insert(rows)
    .select()
  
  if (error) throw new Error(`Failed to create job batch: ${error.message}`)
  
  return data as DurableJob[]
}

// ============================================================================
// JOB CLAIMING & EXECUTION
// ============================================================================

/**
 * Claim the next available job for processing (uses Postgres function)
 */
export async function claimNextJob(
  workerId: string,
  jobTypes?: JobType[],
  lockDurationSeconds = 300
): Promise<ClaimedJob | null> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase.rpc('claim_next_job', {
    p_worker_id: workerId,
    p_job_types: jobTypes ?? null,
    p_lock_duration_seconds: lockDurationSeconds,
  })
  
  if (error) throw new Error(`Failed to claim job: ${error.message}`)
  
  if (!data || data.length === 0) return null
  
  const row = data[0]
  return {
    jobId: row.job_id,
    jobType: row.job_type,
    payload: row.payload,
    retryCount: row.retry_count,
    traceId: row.trace_id,
  }
}

/**
 * Complete a job successfully
 */
export async function completeJob(
  jobId: string,
  result?: JobResult
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase.rpc('complete_job', {
    p_job_id: jobId,
    p_result_summary: result ? JSON.stringify(result) : null,
  })
  
  if (error) throw new Error(`Failed to complete job: ${error.message}`)
}

/**
 * Fail a job (will retry if under max_retries)
 */
export async function failJob(
  jobId: string,
  error: Error | JobResult['error'],
  retryDelaySeconds = 60
): Promise<boolean> {
  const supabase = await getServiceSupabase()
  
  const errorSummary = error instanceof Error
    ? { code: 'EXECUTION_ERROR', message: error.message, stack: error.stack }
    : error
  
  const { data, error: rpcError } = await supabase.rpc('fail_job', {
    p_job_id: jobId,
    p_error_summary: JSON.stringify(errorSummary),
    p_retry_delay_seconds: retryDelaySeconds,
  })
  
  if (rpcError) throw new Error(`Failed to fail job: ${rpcError.message}`)
  
  return data as boolean // true if will retry
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('durable_jobs')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      locked_until: null,
      worker_id: null,
    })
    .eq('id', jobId)
  
  if (error) throw new Error(`Failed to cancel job: ${error.message}`)
}

// ============================================================================
// PROGRESS & STAGE TRACKING
// ============================================================================

/**
 * Update job progress
 */
export async function updateJobProgress(
  jobId: string,
  progress: JobProgress
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('durable_jobs')
    .update({
      stage: progress.stage,
      progress_percent: progress.percent,
    })
    .eq('id', jobId)
  
  if (error) throw new Error(`Failed to update job progress: ${error.message}`)
}

/**
 * Record a stage transition in job history
 */
export async function recordStageHistory(
  jobId: string,
  stage: string,
  status: StageStatus,
  durationMs?: number,
  errorMessage?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('job_stage_history')
    .insert({
      job_id: jobId,
      stage,
      status,
      duration_ms: durationMs ?? null,
      error_message: errorMessage ?? null,
      metadata: metadata ?? {},
    })
  
  if (error) throw new Error(`Failed to record stage history: ${error.message}`)
}

/**
 * Get stage history for a job
 */
export async function getJobStageHistory(jobId: string): Promise<JobStageHistory[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('job_stage_history')
    .select()
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  
  if (error) throw new Error(`Failed to get stage history: ${error.message}`)
  
  return data as JobStageHistory[]
}

// ============================================================================
// JOB QUERIES
// ============================================================================

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<DurableJob | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('durable_jobs')
    .select()
    .eq('id', jobId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get job: ${error.message}`)
  }
  
  return data as DurableJob | null
}

/**
 * Get a job by idempotency key
 */
export async function getJobByIdempotencyKey(key: string): Promise<DurableJob | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('durable_jobs')
    .select()
    .eq('idempotency_key', key)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get job by idempotency key: ${error.message}`)
  }
  
  return data as DurableJob | null
}

/**
 * List jobs with filters
 */
export async function listJobs(
  filter: JobFilter = {},
  limit = 50,
  offset = 0
): Promise<{ data: DurableJob[]; count: number }> {
  const supabase = await createClient()
  
  let query = supabase
    .from('durable_jobs')
    .select('*', { count: 'exact' })
  
  // Apply filters
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
    query = query.in('status', statuses)
  }
  
  if (filter.jobType) {
    const types = Array.isArray(filter.jobType) ? filter.jobType : [filter.jobType]
    query = query.in('job_type', types)
  }
  
  if (filter.userId) {
    query = query.eq('requested_by_user_id', filter.userId)
  }
  
  if (filter.traceId) {
    query = query.eq('trace_id', filter.traceId)
  }
  
  if (filter.buckId) {
    query = query.eq('buck_id', filter.buckId)
  }
  
  if (filter.createdAfter) {
    query = query.gte('created_at', filter.createdAfter.toISOString())
  }
  
  if (filter.createdBefore) {
    query = query.lte('created_at', filter.createdBefore.toISOString())
  }
  
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  
  if (error) throw new Error(`Failed to list jobs: ${error.message}`)
  
  return { data: data as DurableJob[], count: count ?? 0 }
}

/**
 * Get jobs for a specific user
 */
export async function getUserJobs(
  userId: string,
  limit = 20
): Promise<DurableJob[]> {
  const { data } = await listJobs({ userId }, limit)
  return data
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get job statistics
 */
export async function getJobStats(): Promise<JobStats> {
  const supabase = await createClient()
  
  // Get counts by status
  const { data: statusCounts } = await supabase
    .from('durable_jobs')
    .select('status')
  
  const counts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    deadLetter: 0,
  }
  
  const byType: Record<string, number> = {}
  
  if (statusCounts) {
    for (const row of statusCounts) {
      const status = row.status as JobStatus
      if (status === 'queued') counts.queued++
      else if (status === 'running') counts.running++
      else if (status === 'completed') counts.completed++
      else if (status === 'failed') counts.failed++
      else if (status === 'dead_letter') counts.deadLetter++
    }
  }
  
  // Get type breakdown for recent jobs
  const { data: typeData } = await supabase
    .from('durable_jobs')
    .select('job_type')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  
  if (typeData) {
    for (const row of typeData) {
      const type = row.job_type as string
      byType[type] = (byType[type] ?? 0) + 1
    }
  }
  
  // Calculate success rate and avg duration from completed jobs
  const { data: completedJobs } = await supabase
    .from('durable_jobs')
    .select('started_at, completed_at')
    .eq('status', 'completed')
    .not('started_at', 'is', null)
    .not('completed_at', 'is', null)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(100)
  
  let avgDurationMs = 0
  if (completedJobs && completedJobs.length > 0) {
    const durations = completedJobs.map(j => 
      new Date(j.completed_at!).getTime() - new Date(j.started_at!).getTime()
    )
    avgDurationMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  }
  
  const total = counts.completed + counts.failed + counts.deadLetter
  const successRate = total > 0 ? counts.completed / total : 1
  
  return {
    ...counts,
    byType,
    avgDurationMs,
    successRate,
  }
}

// ============================================================================
// MAINTENANCE
// ============================================================================

/**
 * Recover stale jobs that timed out
 */
export async function recoverStaleJobs(staleThresholdMinutes = 10): Promise<number> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase.rpc('recover_stale_jobs', {
    p_stale_threshold_minutes: staleThresholdMinutes,
  })
  
  if (error) throw new Error(`Failed to recover stale jobs: ${error.message}`)
  
  return data as number
}

/**
 * Clean up old completed jobs
 */
export async function cleanupOldJobs(retentionDays = 30): Promise<number> {
  const supabase = await getServiceSupabase()
  
  const { data, error } = await supabase.rpc('cleanup_old_jobs', {
    p_retention_days: retentionDays,
  })
  
  if (error) throw new Error(`Failed to cleanup old jobs: ${error.message}`)
  
  return data as number
}

// ============================================================================
// SCHEDULED JOBS
// ============================================================================

/**
 * Get all scheduled job definitions
 */
export async function getScheduledJobDefinitions(): Promise<ScheduledJobDefinition[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('scheduled_job_definitions')
    .select()
    .order('name')
  
  if (error) throw new Error(`Failed to get scheduled jobs: ${error.message}`)
  
  return data as ScheduledJobDefinition[]
}

/**
 * Get scheduled jobs that are due to run
 */
export async function getDueScheduledJobs(): Promise<ScheduledJobDefinition[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('scheduled_job_definitions')
    .select()
    .eq('is_enabled', true)
    .lte('next_run_at', new Date().toISOString())
  
  if (error) throw new Error(`Failed to get due scheduled jobs: ${error.message}`)
  
  return data as ScheduledJobDefinition[]
}

/**
 * Update scheduled job after execution
 */
export async function updateScheduledJobAfterRun(
  definitionId: string,
  nextRunAt: Date
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('scheduled_job_definitions')
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', definitionId)
  
  if (error) throw new Error(`Failed to update scheduled job: ${error.message}`)
}

/**
 * Toggle scheduled job enabled state
 */
export async function toggleScheduledJob(
  definitionId: string,
  isEnabled: boolean
): Promise<void> {
  const supabase = await getServiceSupabase()
  
  const { error } = await supabase
    .from('scheduled_job_definitions')
    .update({
      is_enabled: isEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', definitionId)
  
  if (error) throw new Error(`Failed to toggle scheduled job: ${error.message}`)
}
