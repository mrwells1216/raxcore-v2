/**
 * Phase 46: Scheduled Job Scheduler
 * 
 * Processes scheduled job definitions and creates job instances when due.
 * Called periodically by a cron job.
 */

import {
  getDueScheduledJobs,
  updateScheduledJobAfterRun,
  createJob,
} from './service'
import type { ScheduledJobDefinition } from './types'

// ============================================================================
// CRON PARSING (simple implementation)
// ============================================================================

/**
 * Parse a simple cron expression and calculate next run time
 * Supports: minute hour day-of-month month day-of-week
 * e.g., "0 * * * *" = every hour at minute 0
 *       "0 0 * * *" = daily at midnight
 *       "0 0 * * 0" = weekly on Sunday
 */
function parseNextCronRun(cronExpression: string, fromDate = new Date()): Date {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpression}`)
  }
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  
  // Simple implementation: just calculate common patterns
  const next = new Date(fromDate)
  next.setSeconds(0)
  next.setMilliseconds(0)
  
  // Handle "every hour" pattern: "N * * * *"
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const targetMinute = parseInt(minute, 10)
    if (next.getMinutes() >= targetMinute) {
      next.setHours(next.getHours() + 1)
    }
    next.setMinutes(targetMinute)
    return next
  }
  
  // Handle "daily" pattern: "N N * * *"
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const targetMinute = parseInt(minute, 10)
    const targetHour = parseInt(hour, 10)
    
    next.setMinutes(targetMinute)
    next.setHours(targetHour)
    
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1)
    }
    return next
  }
  
  // Handle "weekly" pattern: "N N * * N"
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const targetMinute = parseInt(minute, 10)
    const targetHour = parseInt(hour, 10)
    const targetDayOfWeek = parseInt(dayOfWeek, 10)
    
    next.setMinutes(targetMinute)
    next.setHours(targetHour)
    
    const currentDayOfWeek = next.getDay()
    let daysUntilTarget = targetDayOfWeek - currentDayOfWeek
    if (daysUntilTarget < 0) daysUntilTarget += 7
    if (daysUntilTarget === 0 && next <= fromDate) daysUntilTarget = 7
    
    next.setDate(next.getDate() + daysUntilTarget)
    return next
  }
  
  // Fallback: add 1 hour
  next.setHours(next.getHours() + 1)
  return next
}

/**
 * Calculate next run time based on interval in minutes
 */
function calculateNextIntervalRun(intervalMinutes: number, fromDate = new Date()): Date {
  const next = new Date(fromDate)
  next.setMinutes(next.getMinutes() + intervalMinutes)
  next.setSeconds(0)
  next.setMilliseconds(0)
  return next
}

/**
 * Calculate next run time for a scheduled job definition
 */
export function calculateNextRunTime(def: ScheduledJobDefinition, fromDate = new Date()): Date {
  if (def.cron_expression) {
    return parseNextCronRun(def.cron_expression, fromDate)
  }
  
  if (def.interval_minutes) {
    return calculateNextIntervalRun(def.interval_minutes, fromDate)
  }
  
  // Fallback: 1 hour from now
  const next = new Date(fromDate)
  next.setHours(next.getHours() + 1)
  return next
}

// ============================================================================
// SCHEDULER
// ============================================================================

export interface SchedulerResult {
  processed: number
  jobsCreated: string[]
  errors: Array<{ definitionId: string; error: string }>
}

/**
 * Process all due scheduled jobs
 */
export async function processScheduledJobs(): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    processed: 0,
    jobsCreated: [],
    errors: [],
  }
  
  try {
    const dueJobs = await getDueScheduledJobs()
    
    for (const def of dueJobs) {
      result.processed++
      
      try {
        // Create the job instance
        const job = await createJob({
          jobType: def.job_type,
          payload: def.payload,
          priority: def.priority,
          maxRetries: def.max_retries,
          idempotencyKey: `scheduled-${def.id}-${new Date().toISOString().slice(0, 13)}`, // Hourly idempotency
        })
        
        result.jobsCreated.push(job.id)
        
        // Calculate and update next run time
        const nextRunAt = calculateNextRunTime(def)
        await updateScheduledJobAfterRun(def.id, nextRunAt)
        
      } catch (error) {
        result.errors.push({
          definitionId: def.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
    
  } catch (error) {
    console.error('[Scheduler] Failed to process scheduled jobs:', error)
    throw error
  }
  
  return result
}

// ============================================================================
// SCHEDULER API ENDPOINT HANDLER
// ============================================================================

export interface SchedulerInvocationResult extends SchedulerResult {
  durationMs: number
}

/**
 * Main scheduler invocation for serverless environments
 */
export async function invokeScheduler(): Promise<SchedulerInvocationResult> {
  const startTime = Date.now()
  
  const result = await processScheduledJobs()
  
  return {
    ...result,
    durationMs: Date.now() - startTime,
  }
}
