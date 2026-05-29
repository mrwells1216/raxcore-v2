import { createClient } from '@/lib/supabase/server'
import { scoreBuck } from '@/lib/scoring/ai-service'
import { getBuckImages } from '@/lib/storage/service'
import { getCalibrationProfileById } from '@/lib/calibration/utils'
import type {
  BulkValidationRun,
  BulkValidationFilters,
  BulkValidationResult,
  BulkRunSummaryMetrics,
  ModelRunMetrics,
  ImprovementMetrics,
  ModelPredictionResult,
  ModelComparisonDetail,
  BulkRunExportData,
  RackType,
  SourceType,
  AngleType,
} from '@/lib/types'

// ============================================================================
// BULK VALIDATION RUN MANAGEMENT
// ============================================================================

export interface CreateBulkRunParams {
  runName: string
  runType: 'single_model' | 'model_comparison'
  primaryModelVersionId?: string | null
  comparisonModelVersionIds?: string[]
  primaryCalibrationProfileId?: string | null
  comparisonCalibrationProfileIds?: string[]
  filters?: BulkValidationFilters
  // Optional: pre-snapshotted example IDs (if not provided, will be computed from filters)
  exampleIds?: string[]
}

export async function createBulkValidationRun(
  params: CreateBulkRunParams
): Promise<BulkValidationRun> {
  const supabase = await createClient()

  // Build filter snapshot string for human readability
  const filterSnapshot = buildFilterSnapshot(params.filters)

  // Snapshot example IDs at creation time for reproducibility
  let exampleIds = params.exampleIds
  if (!exampleIds) {
    const examples = await getFilteredTrainingExamples(params.filters)
    exampleIds = examples.map(e => e.id)
  }

  const { data, error } = await supabase
    .from('bulk_validation_runs')
    .insert({
      run_name: params.runName,
      run_type: params.runType,
      status: 'pending',
      primary_model_version_id: params.primaryModelVersionId || null,
      comparison_model_version_ids: params.comparisonModelVersionIds || [],
      primary_calibration_profile_id: params.primaryCalibrationProfileId || null,
      comparison_calibration_profile_ids: params.comparisonCalibrationProfileIds || [],
      filters: params.filters || null,
      filter_snapshot: filterSnapshot,
      example_ids: exampleIds,
      total_examples: exampleIds.length,
      processed_examples: 0,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create bulk validation run: ${error.message}`)
  return data
}

export async function getBulkValidationRun(id: string): Promise<BulkValidationRun | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bulk_validation_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get bulk validation run: ${error.message}`)
  }
  return data
}

export async function listBulkValidationRuns(options?: {
  status?: string
  runType?: string
  limit?: number
  offset?: number
}): Promise<{ data: BulkValidationRun[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('bulk_validation_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.runType) {
    query = query.eq('run_type', options.runType)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list bulk validation runs: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

export async function updateBulkRunStatus(
  id: string,
  status: BulkValidationRun['status'],
  errorMessage?: string
): Promise<void> {
  const supabase = await createClient()

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'running') {
    updates.started_at = new Date().toISOString()
  }
  if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString()
  }
  if (errorMessage) {
    updates.error_message = errorMessage
  }

  const { error } = await supabase
    .from('bulk_validation_runs')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update bulk run status: ${error.message}`)
}

export async function updateBulkRunProgress(
  id: string,
  totalExamples: number,
  processedExamples: number
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('bulk_validation_runs')
    .update({
      total_examples: totalExamples,
      processed_examples: processedExamples,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(`Failed to update bulk run progress: ${error.message}`)
}

export async function updateBulkRunSummary(
  id: string,
  summaryMetrics: BulkRunSummaryMetrics
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('bulk_validation_runs')
    .update({
      summary_metrics: summaryMetrics,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(`Failed to update bulk run summary: ${error.message}`)
}

export async function deleteBulkValidationRun(id: string): Promise<void> {
  const supabase = await createClient()

  // Results are cascade-deleted via foreign key
  const { error } = await supabase
    .from('bulk_validation_runs')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete bulk validation run: ${error.message}`)
}

// ============================================================================
// BULK VALIDATION RESULTS
// ============================================================================

export interface CreateBulkResultParams {
  bulkRunId: string
  trainingExampleId: string
  buckId: string | null
  groundTruthGross: number
  groundTruthNet: number | null
  modelResults: ModelPredictionResult[]
  state: string | null
  rackType: RackType | null
  sourceType: SourceType | null
  imageCount: number | null
}

export async function createBulkValidationResult(
  params: CreateBulkResultParams
): Promise<BulkValidationResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bulk_validation_results')
    .insert({
      bulk_run_id: params.bulkRunId,
      training_example_id: params.trainingExampleId,
      buck_id: params.buckId,
      ground_truth_gross: params.groundTruthGross,
      ground_truth_net: params.groundTruthNet,
      model_results: params.modelResults,
      state: params.state,
      rack_type: params.rackType,
      source_type: params.sourceType,
      image_count: params.imageCount,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create bulk validation result: ${error.message}`)
  return data
}

export async function getBulkValidationResults(
  bulkRunId: string,
  options?: {
    limit?: number
    offset?: number
    orderBy?: 'abs_error' | 'ground_truth' | 'created_at'
    ascending?: boolean
    state?: string
    rackType?: string
  }
): Promise<{ data: BulkValidationResult[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('bulk_validation_results')
    .select('*', { count: 'exact' })
    .eq('bulk_run_id', bulkRunId)
    .order('created_at', { ascending: options?.ascending ?? false })

  if (options?.state) {
    query = query.eq('state', options.state)
  }
  if (options?.rackType) {
    query = query.eq('rack_type', options.rackType)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get bulk validation results: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

// ============================================================================
// METRICS CALCULATION
// ============================================================================

export function calculateModelRunMetrics(
  results: BulkValidationResult[],
  modelVersionId: string | null,
  modelVersionName: string | null
): ModelRunMetrics {
  const modelResults: {
    errorGross: number
    errorNet: number | null
    absErrorGross: number
    absErrorNet: number | null
    percentErrorGross: number
    processingTime: number | null
    confidence: number | null
  }[] = []

  for (const result of results) {
    const mr = result.model_results.find(
      (m: ModelPredictionResult) => m.model_version_id === modelVersionId
    )
    if (mr) {
      modelResults.push({
        errorGross: mr.error_gross,
        errorNet: mr.error_net,
        absErrorGross: mr.abs_error_gross,
        absErrorNet: mr.abs_error_net ?? null,
        percentErrorGross: mr.percent_error_gross,
        processingTime: mr.processing_time_ms,
        confidence: mr.confidence_percent,
      })
    }
  }

  if (modelResults.length === 0) {
    return createEmptyMetrics(modelVersionId, modelVersionName)
  }

  const grossErrors = modelResults.map((r) => r.errorGross)
  const absGrossErrors = modelResults.map((r) => r.absErrorGross)
  const percentErrors = modelResults.map((r) => Math.abs(r.percentErrorGross))
  const processingTimes = modelResults.filter((r) => r.processingTime != null).map((r) => r.processingTime!)
  const confidences = modelResults.filter((r) => r.confidence != null).map((r) => r.confidence!)

  // Sort for median calculation
  const sortedAbsGross = [...absGrossErrors].sort((a, b) => a - b)
  const medianGross = sortedAbsGross[Math.floor(sortedAbsGross.length / 2)]

  // Net errors (where available)
  const netErrors = modelResults.filter((r) => r.errorNet != null).map((r) => r.errorNet!)
  const absNetErrors = modelResults.filter((r) => r.absErrorNet != null).map((r) => r.absErrorNet!)
  const avgNetError = netErrors.length > 0 ? netErrors.reduce((a, b) => a + b, 0) / netErrors.length : null
  const medianNet = absNetErrors.length > 0
    ? [...absNetErrors].sort((a, b) => a - b)[Math.floor(absNetErrors.length / 2)]
    : null

  // RMSE
  const rmseGross = Math.sqrt(grossErrors.reduce((sum, e) => sum + e * e, 0) / grossErrors.length)
  const rmseNet = netErrors.length > 0
    ? Math.sqrt(netErrors.reduce((sum, e) => sum + e * e, 0) / netErrors.length)
    : null

  return {
    model_version_id: modelVersionId,
    model_version_name: modelVersionName,
    example_count: modelResults.length,
    avg_gross_error: absGrossErrors.reduce((a, b) => a + b, 0) / absGrossErrors.length,
    avg_net_error: avgNetError,
    median_gross_error: medianGross,
    median_net_error: medianNet,
    rmse_gross: rmseGross,
    rmse_net: rmseNet,
    overestimation_count: grossErrors.filter((e) => e > 0).length,
    underestimation_count: grossErrors.filter((e) => e < 0).length,
    exact_count: grossErrors.filter((e) => e === 0).length,
    within_5_inches: absGrossErrors.filter((e) => e <= 5).length,
    within_10_inches: absGrossErrors.filter((e) => e <= 10).length,
    within_5_percent: percentErrors.filter((e) => e <= 5).length,
    within_10_percent: percentErrors.filter((e) => e <= 10).length,
    avg_processing_time_ms: processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : null,
    avg_confidence_percent: confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null,
  }
}

export function calculateImprovementMetrics(
  results: BulkValidationResult[],
  primaryModelVersionId: string | null,
  comparisonModelVersionId: string,
  comparisonModelVersionName: string | null
): ImprovementMetrics {
  let improved = 0
  let worsened = 0
  let unchanged = 0
  const primaryErrors: number[] = []
  const comparisonErrors: number[] = []

  for (const result of results) {
    const primaryResult = result.model_results.find(
      (m: ModelPredictionResult) => m.model_version_id === primaryModelVersionId
    )
    const comparisonResult = result.model_results.find(
      (m: ModelPredictionResult) => m.model_version_id === comparisonModelVersionId
    )

    if (primaryResult && comparisonResult) {
      const primaryAbsError = primaryResult.abs_error_gross
      const comparisonAbsError = comparisonResult.abs_error_gross

      primaryErrors.push(primaryAbsError)
      comparisonErrors.push(comparisonAbsError)

      if (primaryAbsError < comparisonAbsError) {
        improved++
      } else if (primaryAbsError > comparisonAbsError) {
        worsened++
      } else {
        unchanged++
      }
    }
  }

  const primaryMAE = primaryErrors.length > 0
    ? primaryErrors.reduce((a, b) => a + b, 0) / primaryErrors.length
    : 0
  const comparisonMAE = comparisonErrors.length > 0
    ? comparisonErrors.reduce((a, b) => a + b, 0) / comparisonErrors.length
    : 0

  const maeImprovement = comparisonMAE - primaryMAE
  const maeImprovementPercent = comparisonMAE > 0 ? (maeImprovement / comparisonMAE) * 100 : 0

  return {
    comparison_model_version_id: comparisonModelVersionId,
    comparison_model_version_name: comparisonModelVersionName,
    mae_improvement_inches: maeImprovement,
    mae_improvement_percent: maeImprovementPercent,
    examples_improved: improved,
    examples_worsened: worsened,
    examples_unchanged: unchanged,
  }
}

function createEmptyMetrics(
  modelVersionId: string | null,
  modelVersionName: string | null
): ModelRunMetrics {
  return {
    model_version_id: modelVersionId,
    model_version_name: modelVersionName,
    example_count: 0,
    avg_gross_error: 0,
    avg_net_error: null,
    median_gross_error: 0,
    median_net_error: null,
    rmse_gross: 0,
    rmse_net: null,
    overestimation_count: 0,
    underestimation_count: 0,
    exact_count: 0,
    within_5_inches: 0,
    within_10_inches: 0,
    within_5_percent: 0,
    within_10_percent: 0,
    avg_processing_time_ms: null,
    avg_confidence_percent: null,
  }
}

// ============================================================================
// MODEL COMPARISON DETAILS
// ============================================================================

export function buildComparisonDetails(
  results: BulkValidationResult[],
  primaryModelVersionId: string | null
): ModelComparisonDetail[] {
  return results.map((result) => {
    const modelResults = (result.model_results as ModelPredictionResult[]).map((mr) => {
      const isPrimary = mr.model_version_id === primaryModelVersionId
      const primaryResult = result.model_results.find(
        (m: ModelPredictionResult) => m.model_version_id === primaryModelVersionId
      )

      let improvedVsPrimary: boolean | null = null
      let errorDiffVsPrimary: number | null = null

      if (!isPrimary && primaryResult) {
        errorDiffVsPrimary = mr.abs_error_gross - primaryResult.abs_error_gross
        improvedVsPrimary = errorDiffVsPrimary < 0
      }

      return {
        model_version_id: mr.model_version_id,
        model_version_name: mr.model_version_name,
        final_gross: mr.final_gross,
        final_net: mr.final_net,
        error_gross: mr.error_gross,
        error_net: mr.error_net,
        improved_vs_primary: improvedVsPrimary,
        error_diff_vs_primary: errorDiffVsPrimary,
      }
    })

    // Find best and worst performing models
    const sorted = [...modelResults].sort(
      (a, b) => Math.abs(a.error_gross) - Math.abs(b.error_gross)
    )
    const bestModel = sorted[0]?.model_version_id || null
    const worstModel = sorted[sorted.length - 1]?.model_version_id || null

    return {
      training_example_id: result.training_example_id,
      buck_id: result.buck_id,
      ground_truth_gross: result.ground_truth_gross,
      ground_truth_net: result.ground_truth_net,
      results: modelResults,
      best_model_version_id: bestModel,
      worst_model_version_id: worstModel,
    }
  })
}

// ============================================================================
// EXPORT SUPPORT
// ============================================================================

export async function exportBulkRunData(bulkRunId: string): Promise<BulkRunExportData | null> {
  const run = await getBulkValidationRun(bulkRunId)
  if (!run) return null

  const { data: results } = await getBulkValidationResults(bulkRunId, { limit: 10000 })

  const comparisonDetails = buildComparisonDetails(results, run.primary_model_version_id)

  return {
    run,
    summary_metrics: run.summary_metrics || {
      primary_model: createEmptyMetrics(run.primary_model_version_id, null),
      comparison_models: [],
      improvement_vs_comparison: null,
    },
    results,
    comparison_details: comparisonDetails,
  }
}

export function formatExportAsCSV(exportData: BulkRunExportData): string {
  const lines: string[] = []

  // Header
  lines.push('Run Name,Run Type,Status,Total Examples,Primary Model')
  lines.push(
    `"${exportData.run.run_name}","${exportData.run.run_type}","${exportData.run.status}",${exportData.run.total_examples},"${exportData.summary_metrics.primary_model.model_version_name || 'Current'}"`
  )
  lines.push('')

  // Summary metrics
  lines.push('Model,Example Count,Avg Gross Error,Median Gross Error,RMSE,Within 5",Within 10",Overestimations,Underestimations')

  const pm = exportData.summary_metrics.primary_model
  lines.push(
    `"${pm.model_version_name || 'Primary'}",${pm.example_count},${pm.avg_gross_error.toFixed(2)},${pm.median_gross_error.toFixed(2)},${pm.rmse_gross.toFixed(2)},${pm.within_5_inches},${pm.within_10_inches},${pm.overestimation_count},${pm.underestimation_count}`
  )

  for (const cm of exportData.summary_metrics.comparison_models) {
    lines.push(
      `"${cm.model_version_name || 'Comparison'}",${cm.example_count},${cm.avg_gross_error.toFixed(2)},${cm.median_gross_error.toFixed(2)},${cm.rmse_gross.toFixed(2)},${cm.within_5_inches},${cm.within_10_inches},${cm.overestimation_count},${cm.underestimation_count}`
    )
  }
  lines.push('')

  // Per-example results
  lines.push('Example ID,Buck ID,Ground Truth Gross,Ground Truth Net,State,Rack Type,Image Count')
  for (const result of exportData.results) {
    lines.push(
      `"${result.training_example_id}","${result.buck_id || ''}",${result.ground_truth_gross},${result.ground_truth_net || ''},"${result.state || ''}","${result.rack_type || ''}",${result.image_count || ''}`
    )
  }

  return lines.join('\n')
}

// ============================================================================
// FILTER HELPERS
// ============================================================================

function buildFilterSnapshot(filters?: BulkValidationFilters): string {
  if (!filters) return 'No filters applied'

  const parts: string[] = []

  if (filters.states?.length) {
    parts.push(`States: ${filters.states.join(', ')}`)
  }
  if (filters.rackTypes?.length) {
    parts.push(`Rack Types: ${filters.rackTypes.join(', ')}`)
  }
  if (filters.sourceTypes?.length) {
    parts.push(`Source Types: ${filters.sourceTypes.join(', ')}`)
  }
  if (filters.captureDevices?.length) {
    parts.push(`Capture Devices: ${filters.captureDevices.join(', ')}`)
  }
  if (filters.scoreRangeMin != null || filters.scoreRangeMax != null) {
    parts.push(`Score Range: ${filters.scoreRangeMin || 0}" - ${filters.scoreRangeMax || '∞'}"`)
  }
  if (filters.minImageCount != null || filters.maxImageCount != null) {
    parts.push(`Image Count: ${filters.minImageCount || 1} - ${filters.maxImageCount || '∞'}`)
  }
  if (filters.verifiedOnly) {
    parts.push('Verified examples only')
  }
  if (filters.dateRangeStart || filters.dateRangeEnd) {
    parts.push(`Date: ${filters.dateRangeStart || 'Any'} to ${filters.dateRangeEnd || 'Now'}`)
  }
  if (filters.sampleSize) {
    parts.push(`Sample Size: ${filters.sampleSize}`)
  }

  return parts.length > 0 ? parts.join(' | ') : 'No filters applied'
}

export async function getFilteredTrainingExamples(
  filters?: BulkValidationFilters
): Promise<{
  id: string
  buck_id: string | null
  ground_truth_score: number
  image_urls: string[]
  state: string | null
  rack_type: string | null
  source_type: string | null
}[]> {
  const supabase = await createClient()

  // Start with training examples that have ground truth
  let query = supabase
    .from('training_examples')
    .select('id, buck_id, ground_truth_score, image_urls')
    .not('ground_truth_score', 'is', null)

  // Apply verified filter
  if (filters?.verifiedOnly !== false) {
    query = query.eq('verified_for_training', true)
  }

  // Apply score range
  if (filters?.scoreRangeMin != null) {
    query = query.gte('ground_truth_score', filters.scoreRangeMin)
  }
  if (filters?.scoreRangeMax != null) {
    query = query.lte('ground_truth_score', filters.scoreRangeMax)
  }

  // Apply date range
  if (filters?.dateRangeStart) {
    query = query.gte('created_at', filters.dateRangeStart)
  }
  if (filters?.dateRangeEnd) {
    query = query.lte('created_at', filters.dateRangeEnd)
  }

  // Apply sample size limit
  if (filters?.sampleSize) {
    query = query.limit(filters.sampleSize)
  }

  const { data: examples, error } = await query

  if (error) throw new Error(`Failed to get filtered examples: ${error.message}`)
  if (!examples || examples.length === 0) return []

  // Get buck details for additional filtering
  const buckIds = examples.filter((e) => e.buck_id).map((e) => e.buck_id!)
  
  let bucksMap = new Map<string, { state: string | null; rack_type: string | null; source_type: string | null }>()
  
  if (buckIds.length > 0) {
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, state, rack_type, source_type')
      .in('id', buckIds)

    bucksMap = new Map(bucks?.map((b) => [b.id, { state: b.state, rack_type: b.rack_type, source_type: b.source_type }]) || [])
  }

  // Apply buck-level filters
  let filtered = examples.map((e) => {
    const buck = e.buck_id ? bucksMap.get(e.buck_id) : null
    return {
      ...e,
      state: buck?.state || null,
      rack_type: buck?.rack_type || null,
      source_type: buck?.source_type || null,
    }
  })

  if (filters?.states?.length) {
    filtered = filtered.filter((e) => e.state && filters.states!.includes(e.state))
  }
  if (filters?.rackTypes?.length) {
    filtered = filtered.filter((e) => e.rack_type && filters.rackTypes!.includes(e.rack_type as RackType))
  }
  if (filters?.sourceTypes?.length) {
    filtered = filtered.filter((e) => e.source_type && filters.sourceTypes!.includes(e.source_type as SourceType))
  }
  if (filters?.minImageCount != null) {
    filtered = filtered.filter((e) => (e.image_urls?.length || 0) >= filters.minImageCount!)
  }
  if (filters?.maxImageCount != null) {
    filtered = filtered.filter((e) => (e.image_urls?.length || 0) <= filters.maxImageCount!)
  }

  return filtered
}

/**
 * Get training examples by their IDs (for reproducible bulk runs).
 * Returns full metadata for each example.
 */
export async function getTrainingExamplesByIds(
  exampleIds: string[]
): Promise<{
  id: string
  buck_id: string | null
  ground_truth_score: number
  ground_truth_net: number | null
  image_urls: string[]
  state: string | null
  rack_type: string | null
  source_type: string | null
  capture_device: string | null
  frame_size: string | null
  ears_fully_visible: boolean | null
  angle_tags: string[] | null
}[]> {
  if (exampleIds.length === 0) return []
  
  const supabase = await createClient()

  const { data: examples, error } = await supabase
    .from('training_examples')
    .select(`
      id,
      buck_id,
      ground_truth_score,
      ground_truth_net,
      image_urls,
      frame_size,
      ears_fully_visible,
      angle_tags
    `)
    .in('id', exampleIds)

  if (error) throw new Error(`Failed to get examples by IDs: ${error.message}`)
  if (!examples || examples.length === 0) return []

  // Get buck details
  const buckIds = examples.filter((e) => e.buck_id).map((e) => e.buck_id!)
  
  let bucksMap = new Map<string, { 
    state: string | null
    rack_type: string | null
    source_type: string | null
    capture_device: string | null 
  }>()
  
  if (buckIds.length > 0) {
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, state, rack_type, source_type, capture_device')
      .in('id', buckIds)

    bucksMap = new Map(bucks?.map((b) => [b.id, { 
      state: b.state, 
      rack_type: b.rack_type, 
      source_type: b.source_type,
      capture_device: b.capture_device || null,
    }]) || [])
  }

  return examples.map((e) => {
    const buck = e.buck_id ? bucksMap.get(e.buck_id) : null
    return {
      id: e.id,
      buck_id: e.buck_id,
      ground_truth_score: e.ground_truth_score,
      ground_truth_net: e.ground_truth_net || null,
      image_urls: e.image_urls || [],
      state: buck?.state || null,
      rack_type: buck?.rack_type || null,
      source_type: buck?.source_type || null,
      capture_device: buck?.capture_device || null,
      frame_size: e.frame_size || null,
      ears_fully_visible: e.ears_fully_visible ?? null,
      angle_tags: e.angle_tags || null,
    }
  })
}

// ============================================================================
// MODEL VERSION HELPERS
// ============================================================================

export async function getModelVersionInfo(
  modelVersionId: string | null
): Promise<{ id: string | null; name: string | null }> {
  if (!modelVersionId) {
    return { id: null, name: 'Current Active Model' }
  }

  const supabase = await createClient()

  const { data } = await supabase
    .from('model_versions')
    .select('id, version_name')
    .eq('id', modelVersionId)
    .single()

  return {
    id: data?.id || modelVersionId,
    name: data?.version_name || 'Unknown Model',
  }
}

// ============================================================================
// RUN EXECUTION
// ============================================================================

export class BulkRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Bulk validation run not found: ${runId}`)
    this.name = 'BulkRunNotFoundError'
  }
}

export class BulkRunNotPendingError extends Error {
  constructor() {
    super('Only pending runs can be executed')
    this.name = 'BulkRunNotPendingError'
  }
}

export interface ExecuteBulkRunResult {
  processed: number
  total: number
  totalTimeMs: number
  summaryMetrics: BulkRunSummaryMetrics
}

/**
 * Execute a bulk validation run: score every snapshotted training example with
 * the run's model(s), persist per-example errors vs ground truth, and compute
 * summary metrics. Self-contained so it can be invoked from the HTTP route OR
 * the `benchmark_run` job pipeline.
 *
 * Throws BulkRunNotFoundError / BulkRunNotPendingError for guard failures
 * (before any mutation). Execution errors mark the run 'failed' and rethrow.
 */
export async function executeBulkValidationRun(
  runId: string
): Promise<ExecuteBulkRunResult> {
  const run = await getBulkValidationRun(runId)
  if (!run) throw new BulkRunNotFoundError(runId)
  if (run.status !== 'pending') throw new BulkRunNotPendingError()

  try {
    // Mark as running
    await updateBulkRunStatus(runId, 'running')

    // Use snapshotted example IDs if available (reproducibility), otherwise fall back to filter query
    let examples: Awaited<ReturnType<typeof getTrainingExamplesByIds>>

    if (run.example_ids && run.example_ids.length > 0) {
      examples = await getTrainingExamplesByIds(run.example_ids)
    } else {
      // Legacy support: fall back to filter query for older runs without snapshotted IDs
      const filteredExamples = await getFilteredTrainingExamples(
        run.filters as BulkValidationFilters | undefined
      )
      examples = filteredExamples.map((e) => ({
        ...e,
        ground_truth_net: null,
        capture_device: null,
        frame_size: null,
        ears_fully_visible: null,
        angle_tags: null,
      }))
    }

    if (examples.length === 0) {
      await updateBulkRunStatus(runId, 'failed', 'No training examples found for this run')
      throw new Error('No training examples found for this run')
    }

    await updateBulkRunProgress(runId, examples.length, 0)

    // Load calibration profiles for model comparison
    const primaryCalibration = run.primary_calibration_profile_id
      ? await getCalibrationProfileById(run.primary_calibration_profile_id)
      : null
    const comparisonCalibrations = await Promise.all(
      (run.comparison_calibration_profile_ids || []).map((cpId: string) =>
        getCalibrationProfileById(cpId)
      )
    )

    // Get model version info
    const primaryModelInfo = await getModelVersionInfo(run.primary_model_version_id)
    const comparisonModelInfos = await Promise.all(
      (run.comparison_model_version_ids || []).map((mvId: string) =>
        getModelVersionInfo(mvId)
      )
    )

    // Process each example
    let processed = 0
    const startTime = Date.now()

    for (const example of examples) {
      try {
        // Check if run was cancelled
        const currentRun = await getBulkValidationRun(runId)
        if (currentRun?.status === 'cancelled') {
          break
        }

        // Get images for this buck if available
        let imageUrls = example.image_urls || []
        if (example.buck_id && imageUrls.length === 0) {
          const buckImages = await getBuckImages(example.buck_id)
          imageUrls = buckImages
            .map((img) => img.image_url)
            .filter((u): u is string => u != null)
        }

        if (imageUrls.length === 0) {
          // Skip examples without images
          processed++
          await updateBulkRunProgress(runId, examples.length, processed)
          continue
        }

        // Score with each model version
        const modelResults: ModelPredictionResult[] = []

        // Primary model (or current active)
        try {
          const primaryStartTime = Date.now()
          const primaryResult = await scoreBuck({
            images: imageUrls.map((url, i) => ({
              imageUrl: url,
              angleType: (example.angle_tags?.[i] || (i === 0 ? 'front' : 'other')) as AngleType,
              width: 1024,
              height: 1024,
            })),
            state: example.state || undefined,
            rackType: (example.rack_type || 'typical') as RackType,
            earsFullyVisible: example.ears_fully_visible ?? true,
            sourceType: example.source_type || undefined,
            captureDevice: example.capture_device || undefined,
            calibrationProfile: primaryCalibration,
          })
          const primaryProcessingTime = Date.now() - primaryStartTime

          const primaryGross = primaryResult.predictedGross
          const primaryNet = primaryResult.predictedNet
          const errorGross = primaryGross - example.ground_truth_score
          const errorNet =
            primaryNet != null && example.ground_truth_score != null
              ? primaryNet - example.ground_truth_score
              : null

          modelResults.push({
            model_version_id: run.primary_model_version_id,
            model_version_name: primaryModelInfo.name,
            raw_vision_gross: primaryResult.rawVisionGross ?? primaryGross,
            raw_vision_net: primaryResult.rawVisionNet ?? primaryNet,
            normalized_gross: primaryResult.normalizedGross ?? primaryGross,
            normalized_net: primaryResult.normalizedNet ?? primaryNet,
            final_gross: primaryGross,
            final_net: primaryNet,
            error_gross: errorGross,
            error_net: errorNet,
            abs_error_gross: Math.abs(errorGross),
            abs_error_net: errorNet != null ? Math.abs(errorNet) : null,
            percent_error_gross:
              example.ground_truth_score > 0
                ? (errorGross / example.ground_truth_score) * 100
                : 0,
            percent_error_net: null,
            confidence_percent: primaryResult.confidencePercent,
            scoring_method: primaryResult.scoringMethod || 'vision',
            processing_time_ms: primaryProcessingTime,
          })
        } catch (err) {
          console.error(`Error scoring with primary model for example ${example.id}:`, err)
        }

        // Comparison models (for model comparison runs)
        if (run.run_type === 'model_comparison') {
          for (let i = 0; i < comparisonModelInfos.length; i++) {
            const compInfo = comparisonModelInfos[i]
            const compCalibration = comparisonCalibrations[i]
            try {
              const compStartTime = Date.now()
              const compResult = await scoreBuck({
                images: imageUrls.map((url, idx) => ({
                  imageUrl: url,
                  angleType: (example.angle_tags?.[idx] || (idx === 0 ? 'front' : 'other')) as AngleType,
                  width: 1024,
                  height: 1024,
                })),
                state: example.state || undefined,
                rackType: (example.rack_type || 'typical') as RackType,
                earsFullyVisible: example.ears_fully_visible ?? true,
                sourceType: example.source_type || undefined,
                captureDevice: example.capture_device || undefined,
                calibrationProfile: compCalibration,
              })
              const compProcessingTime = Date.now() - compStartTime

              const compGross = compResult.predictedGross
              const compNet = compResult.predictedNet
              const errorGross = compGross - example.ground_truth_score
              const errorNet =
                compNet != null && example.ground_truth_score != null
                  ? compNet - example.ground_truth_score
                  : null

              modelResults.push({
                model_version_id: run.comparison_model_version_ids[i],
                model_version_name: compInfo.name,
                raw_vision_gross: compResult.rawVisionGross ?? compGross,
                raw_vision_net: compResult.rawVisionNet ?? compNet,
                normalized_gross: compResult.normalizedGross ?? compGross,
                normalized_net: compResult.normalizedNet ?? compNet,
                final_gross: compGross,
                final_net: compNet,
                error_gross: errorGross,
                error_net: errorNet,
                abs_error_gross: Math.abs(errorGross),
                abs_error_net: errorNet != null ? Math.abs(errorNet) : null,
                percent_error_gross:
                  example.ground_truth_score > 0
                    ? (errorGross / example.ground_truth_score) * 100
                    : 0,
                percent_error_net: null,
                confidence_percent: compResult.confidencePercent,
                scoring_method: compResult.scoringMethod || 'vision',
                processing_time_ms: compProcessingTime,
              })
            } catch (err) {
              console.error(
                `Error scoring with comparison model ${compInfo.id} for example ${example.id}:`,
                err
              )
            }
          }
        }

        // Save result
        if (modelResults.length > 0) {
          await createBulkValidationResult({
            bulkRunId: runId,
            trainingExampleId: example.id,
            buckId: example.buck_id,
            groundTruthGross: example.ground_truth_score,
            groundTruthNet: null,
            modelResults,
            state: example.state,
            rackType: example.rack_type as RackType | null,
            sourceType: example.source_type as SourceType | null,
            imageCount: imageUrls.length,
          })
        }

        processed++
        await updateBulkRunProgress(runId, examples.length, processed)
      } catch (err) {
        console.error(`Error processing example ${example.id}:`, err)
        processed++
        await updateBulkRunProgress(runId, examples.length, processed)
      }
    }

    // Calculate summary metrics
    const { data: allResults } = await getBulkValidationResults(runId, { limit: 10000 })

    const primaryMetrics = calculateModelRunMetrics(
      allResults,
      run.primary_model_version_id,
      primaryModelInfo.name
    )

    const comparisonMetrics = comparisonModelInfos.map((info, i) =>
      calculateModelRunMetrics(allResults, run.comparison_model_version_ids[i], info.name)
    )

    const improvementMetrics =
      run.run_type === 'model_comparison'
        ? comparisonModelInfos.map((info, i) =>
            calculateImprovementMetrics(
              allResults,
              run.primary_model_version_id,
              run.comparison_model_version_ids[i],
              info.name
            )
          )
        : null

    const summaryMetrics: BulkRunSummaryMetrics = {
      primary_model: primaryMetrics,
      comparison_models: comparisonMetrics,
      improvement_vs_comparison: improvementMetrics,
    }

    await updateBulkRunSummary(runId, summaryMetrics)

    // Check final status
    const finalRun = await getBulkValidationRun(runId)
    if (finalRun?.status !== 'cancelled') {
      await updateBulkRunStatus(runId, 'completed')
    }

    return {
      processed,
      total: examples.length,
      totalTimeMs: Date.now() - startTime,
      summaryMetrics,
    }
  } catch (error) {
    // Mark failed for any execution-phase error (guards already threw above).
    await updateBulkRunStatus(
      runId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    ).catch(() => {})
    throw error
  }
}
