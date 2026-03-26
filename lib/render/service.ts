/**
 * 3D Render Job Service
 * Delegates to Supabase-backed storage via lib/storage/service.ts.
 * The in-memory fallback has been removed; Supabase is the single source of truth.
 */

import {
  createRenderJobRecord,
  getRenderJobById,
  getRenderJobsByBuckId,
  getLatestRenderJobForBuck,
  updateRenderJobStatus,
  addRenderOutputRecord,
  getRenderOutputsForJob,
  deleteRenderJobRecord,
  getRenderStats as getStorageRenderStats,
  listRenderJobsAdmin,
  type RenderJobRecord,
  type RenderOutputRecord,
} from '@/lib/storage/service'

import type {
  RenderJob,
  RenderOutput,
  RenderSettings,
  RenderStatus,
  AntlerGeometry,
  RenderBundle,
  Measurements,
  RackType,
} from '@/lib/types'

// Default render settings
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  quality: 'standard',
  showMeasurements: true,
  showLabels: true,
  backgroundColor: '#1a1a2e',
  antlerColor: '#d4a373',
  highlightColor: '#e9c46a',
  wireframe: false,
  autoRotate: true,
}

// ── Adapter helpers ──────────────────────────────────────────────────────────
// The storage layer returns plain DB records; these convert them to the typed
// RenderJob / RenderOutput shapes the rest of the app already uses.

function toRenderJob(record: RenderJobRecord): RenderJob {
  return {
    id: record.id,
    buck_id: record.buck_id,
    status: record.status as RenderStatus,
    settings: (record.settings as unknown as RenderSettings) ?? DEFAULT_RENDER_SETTINGS,
    progress_percent: record.progress_percent,
    error_message: record.error_message,
    created_at: record.created_at,
    updated_at: record.updated_at,
    completed_at: record.completed_at,
  }
}

function toRenderOutput(record: RenderOutputRecord): RenderOutput {
  return {
    id: record.id,
    render_job_id: record.render_job_id,
    view_type: record.view_type as RenderOutput['view_type'],
    image_url: record.image_url,
    thumbnail_url: record.thumbnail_url,
    created_at: record.created_at,
  }
}

// ── Geometry helpers (unchanged) ─────────────────────────────────────────────

/**
 * Convert scoring measurements to antler geometry for 3D rendering
 */
export function measurementsToGeometry(
  measurements: Measurements,
  rackType: RackType,
  mainFramePoints?: number
): AntlerGeometry {
  return {
    insideSpread: measurements.inside_spread || 18,
    mainBeamLeft: measurements.main_beam_left || 24,
    mainBeamRight: measurements.main_beam_right || 24,
    g1Left: measurements.g1_left || 4,
    g1Right: measurements.g1_right || 4,
    g2Left: measurements.g2_left || 10,
    g2Right: measurements.g2_right || 10,
    g3Left: measurements.g3_left || 9,
    g3Right: measurements.g3_right || 9,
    g4Left: measurements.g4_left || 6,
    g4Right: measurements.g4_right || 6,
    g5Left: measurements.g5_left,
    g5Right: measurements.g5_right,
    h1Left: measurements.h1_left || 4.5,
    h1Right: measurements.h1_right || 4.5,
    h2Left: measurements.h2_left || 4.25,
    h2Right: measurements.h2_right || 4.25,
    h3Left: measurements.h3_left || 4,
    h3Right: measurements.h3_right || 4,
    h4Left: measurements.h4_left || 3.75,
    h4Right: measurements.h4_right || 3.75,
    abnormalPoints: measurements.abnormal_points || 0,
    rackType,
    mainFramePoints: mainFramePoints || 10,
  }
}

// ── CRUD operations (Supabase-backed) ────────────────────────────────────────

/**
 * Create a new render job for a buck
 */
export async function createRenderJob(
  buckId: string,
  settings?: Partial<RenderSettings>
): Promise<RenderJob> {
  const mergedSettings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, ...settings }
  const record = await createRenderJobRecord(buckId, mergedSettings as unknown as Record<string, unknown>)
  if (!record) {
    throw new Error(`Failed to create render job for buck ${buckId}`)
  }
  return toRenderJob(record)
}

/**
 * Get a render job by ID
 */
export async function getRenderJob(id: string): Promise<RenderJob | null> {
  const record = await getRenderJobById(id)
  return record ? toRenderJob(record) : null
}

/**
 * Get render job(s) for a buck
 */
export async function getRenderJobsForBuck(buckId: string): Promise<RenderJob[]> {
  const records = await getRenderJobsByBuckId(buckId)
  return records.map(toRenderJob)
}

/**
 * Get the latest render job for a buck
 */
export async function getLatestRenderJob(buckId: string): Promise<RenderJob | null> {
  const record = await getLatestRenderJobForBuck(buckId)
  return record ? toRenderJob(record) : null
}

/**
 * Update render job status and progress
 */
export async function updateRenderJob(
  id: string,
  updates: Partial<Pick<RenderJob, 'status' | 'progress_percent' | 'error_message'>>
): Promise<RenderJob | null> {
  const record = await updateRenderJobStatus(id, {
    status: updates.status as RenderJobRecord['status'],
    progress_percent: updates.progress_percent,
    error_message: updates.error_message ?? undefined,
  })
  return record ? toRenderJob(record) : null
}

/**
 * Add a render output (view image) to a job
 */
export async function addRenderOutput(
  jobId: string,
  viewType: RenderOutput['view_type'],
  imageUrl?: string,
  thumbnailUrl?: string
): Promise<RenderOutput> {
  const record = await addRenderOutputRecord(jobId, viewType, imageUrl, thumbnailUrl)
  if (!record) {
    throw new Error(`Failed to add render output for job ${jobId}`)
  }
  return toRenderOutput(record)
}

/**
 * Get render outputs for a job
 */
export async function getRenderOutputs(jobId: string): Promise<RenderOutput[]> {
  const records = await getRenderOutputsForJob(jobId)
  return records.map(toRenderOutput)
}

/**
 * Get full render bundle for a buck (job + outputs + geometry)
 */
export async function getRenderBundle(
  buckId: string,
  measurements?: Measurements,
  rackType?: RackType,
  mainFramePoints?: number
): Promise<RenderBundle | null> {
  const job = await getLatestRenderJob(buckId)
  if (!job) return null

  const outputs = await getRenderOutputs(job.id)
  const geometry = measurements
    ? measurementsToGeometry(measurements, rackType || 'typical', mainFramePoints)
    : null

  return { job, outputs, geometry }
}

/**
 * Delete a render job and its outputs
 */
export async function deleteRenderJob(id: string): Promise<boolean> {
  return deleteRenderJobRecord(id)
}

/**
 * List all render jobs with pagination (admin use)
 */
export async function listRenderJobs(options?: {
  status?: RenderStatus
  limit?: number
  offset?: number
}): Promise<{ jobs: RenderJob[]; total: number }> {
  const { jobs: records, total } = await listRenderJobsAdmin(options as Parameters<typeof listRenderJobsAdmin>[0])
  return { jobs: records.map(toRenderJob), total }
}

/**
 * Check if a buck has any render jobs
 */
export async function hasRenderJob(buckId: string): Promise<boolean> {
  const jobs = await getRenderJobsForBuck(buckId)
  return jobs.length > 0
}

/**
 * Get render statistics
 */
export async function getRenderStats(): Promise<{
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
}> {
  return getStorageRenderStats()
}
