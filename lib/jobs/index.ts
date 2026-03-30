/**
 * Phase 46: Durable Job System
 * 
 * Main export file for the job system.
 */

// Types
export * from './types'

// Service (CRUD, queries, stats)
export {
  createJob,
  createJobBatch,
  claimNextJob,
  completeJob,
  failJob,
  cancelJob,
  updateJobProgress,
  recordStageHistory,
  getJobStageHistory,
  getJob,
  getJobByIdempotencyKey,
  listJobs,
  getUserJobs,
  getJobStats,
  recoverStaleJobs,
  cleanupOldJobs,
  getScheduledJobDefinitions,
  getDueScheduledJobs,
  updateScheduledJobAfterRun,
  toggleScheduledJob,
} from './service'

// Pipeline (stage-based execution)
export {
  definePipeline,
  createStageContext,
  validationStage,
  loadDataStage,
  saveResultStage,
  notificationStage,
  registerPipeline,
  getPipeline,
  hasPipeline,
  executePipeline,
  wrapAsSimplePipeline,
} from './pipeline'

// Worker (job execution)
export {
  registerJobHandler,
  getJobHandler,
  executeJob,
  processJobBatch,
  invokeWorker,
  executeJobImmediately,
  getWorkerStats,
  getAllWorkerStats,
} from './worker'

// Scheduler (scheduled/recurring jobs)
export {
  calculateNextRunTime,
  processScheduledJobs,
  invokeScheduler,
} from './scheduler'
