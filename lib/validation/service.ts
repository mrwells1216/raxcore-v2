import { createClient } from '@/lib/supabase/server'
import type {
  ValidationRun,
  ValidationRunConfig,
  ValidationResult,
  ValidationSummary,
  ValidationBreakdown,
  AccuracyMetrics,
  TrendPoint,
  ModelAccuracyPoint,
  AccuracyBreakdown,
  ErrorDistribution,
  RackType,
  MeasurementLevelMetrics,
  MeasurementCategory,
  SecondPassAccuracyMetrics,
  SelfCheckIssueType,
  FinalSelectionMethod,
  RuntimeHealthMetrics,
  VisionRuntimeErrorType,
  FallbackReason,
  ImageValidationIssueType,
  ConfidenceCalibrationMetrics,
  ConfidenceCalibrationPoint,
  ConfidenceTier,
  TrustTier
} from '@/lib/types'

// ============================================================================
// VALIDATION RUNS
// ============================================================================

export interface CreateValidationRunParams {
  runName: string
  modelVersionId?: string | null
  config?: ValidationRunConfig
}

export async function createValidationRun(
  params: CreateValidationRunParams
): Promise<ValidationRun> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('validation_runs')
    .insert({
      run_name: params.runName,
      model_version_id: params.modelVersionId || null,
      status: 'pending',
      total_examples: 0,
      processed_examples: 0,
      config: params.config || null
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create validation run: ${error.message}`)
  return data
}

export async function getValidationRun(id: string): Promise<ValidationRun | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('validation_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get validation run: ${error.message}`)
  }
  return data
}

export async function listValidationRuns(options?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<{ data: ValidationRun[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('validation_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list validation runs: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

export async function updateValidationRunStatus(
  id: string,
  status: ValidationRun['status'],
  errorMessage?: string
): Promise<void> {
  const supabase = await createClient()

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString()
  }

  if (status === 'running' && !errorMessage) {
    updates.started_at = new Date().toISOString()
  }

  if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString()
  }

  if (errorMessage) {
    updates.error_message = errorMessage
  }

  const { error } = await supabase
    .from('validation_runs')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update validation run status: ${error.message}`)
}

export async function updateValidationRunProgress(
  id: string,
  totalExamples: number,
  processedExamples: number
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('validation_runs')
    .update({
      total_examples: totalExamples,
      processed_examples: processedExamples,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) throw new Error(`Failed to update validation run progress: ${error.message}`)
}

export async function updateValidationRunMetrics(
  id: string,
  metrics: {
    mean_absolute_error_gross?: number | null
    mean_absolute_error_net?: number | null
    median_absolute_error_gross?: number | null
    median_absolute_error_net?: number | null
    rmse_gross?: number | null
    rmse_net?: number | null
    within_5_percent?: number | null
    within_10_percent?: number | null
    within_15_percent?: number | null
  }
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('validation_runs')
    .update({
      ...metrics,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) throw new Error(`Failed to update validation run metrics: ${error.message}`)
}

export async function deleteValidationRun(id: string): Promise<void> {
  const supabase = await createClient()

  // Delete results first (cascade)
  await supabase
    .from('validation_results')
    .delete()
    .eq('run_id', id)

  const { error } = await supabase
    .from('validation_runs')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete validation run: ${error.message}`)
}

// ============================================================================
// VALIDATION RESULTS
// ============================================================================

export interface CreateValidationResultParams {
  runId: string
  trainingExampleId: string
  buckId: string
  groundTruthGross: number
  groundTruthNet: number | null
  predictedGross: number
  predictedNet: number | null
  confidencePercent: number | null
  state: string | null
  rackType: RackType | null
  scoringMethod: string | null
  processingTimeMs: number | null
}

export async function createValidationResult(
  params: CreateValidationResultParams
): Promise<ValidationResult> {
  const supabase = await createClient()

  const errorGross = params.predictedGross - params.groundTruthGross
  const errorNet = params.groundTruthNet != null && params.predictedNet != null
    ? params.predictedNet - params.groundTruthNet
    : null
  
  const absErrorGross = Math.abs(errorGross)
  const absErrorNet = errorNet != null ? Math.abs(errorNet) : null
  
  const percentErrorGross = params.groundTruthGross > 0
    ? (errorGross / params.groundTruthGross) * 100
    : 0
  const percentErrorNet = params.groundTruthNet != null && params.groundTruthNet > 0 && errorNet != null
    ? (errorNet / params.groundTruthNet) * 100
    : null

  const { data, error } = await supabase
    .from('validation_results')
    .insert({
      run_id: params.runId,
      training_example_id: params.trainingExampleId,
      buck_id: params.buckId,
      ground_truth_gross: params.groundTruthGross,
      ground_truth_net: params.groundTruthNet,
      predicted_gross: params.predictedGross,
      predicted_net: params.predictedNet,
      confidence_percent: params.confidencePercent,
      error_gross: errorGross,
      error_net: errorNet,
      abs_error_gross: absErrorGross,
      abs_error_net: absErrorNet,
      percent_error_gross: percentErrorGross,
      percent_error_net: percentErrorNet,
      state: params.state,
      rack_type: params.rackType,
      scoring_method: params.scoringMethod,
      processing_time_ms: params.processingTimeMs
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create validation result: ${error.message}`)
  return data
}

export async function getValidationResults(
  runId: string,
  options?: {
    limit?: number
    offset?: number
    orderBy?: 'abs_error_gross' | 'percent_error_gross' | 'created_at'
    ascending?: boolean
  }
): Promise<{ data: ValidationResult[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('validation_results')
    .select('*', { count: 'exact' })
    .eq('run_id', runId)
    .order(options?.orderBy || 'created_at', { ascending: options?.ascending ?? false })

  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get validation results: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

// ============================================================================
// VALIDATION SUMMARY & METRICS
// ============================================================================

export async function getValidationSummary(runId: string): Promise<ValidationSummary | null> {
  const supabase = await createClient()

  // Get the run
  const run = await getValidationRun(runId)
  if (!run) return null

  // Get all results
  const { data: results } = await getValidationResults(runId, { limit: 10000 })

  // Calculate breakdowns
  const byState = calculateBreakdown(results, 'state')
  const byRackType = calculateBreakdown(results, 'rack_type')
  const byScoreBucket = calculateScoreBucketBreakdown(results)
  const byConfidenceBucket = calculateConfidenceBucketBreakdown(results)

  // Get worst and best predictions
  const sorted = [...results].sort((a, b) => b.abs_error_gross - a.abs_error_gross)
  const worstPredictions = sorted.slice(0, 10)
  const bestPredictions = sorted.slice(-10).reverse()

  return {
    run,
    results,
    by_state: byState,
    by_rack_type: byRackType,
    by_score_bucket: byScoreBucket,
    by_confidence_bucket: byConfidenceBucket,
    worst_predictions: worstPredictions,
    best_predictions: bestPredictions
  }
}

function calculateBreakdown(
  results: ValidationResult[],
  groupKey: 'state' | 'rack_type'
): ValidationBreakdown[] {
  const groups = new Map<string, ValidationResult[]>()

  for (const r of results) {
    const key = (r[groupKey] as string) || 'Unknown'
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(r)
  }

  const breakdowns: ValidationBreakdown[] = []
  for (const [category, items] of groups) {
    const grossErrors = items.map(i => i.abs_error_gross)
    const netErrors = items.filter(i => i.abs_error_net != null).map(i => i.abs_error_net!)
    
    const mae_gross = grossErrors.reduce((a, b) => a + b, 0) / grossErrors.length
    const mae_net = netErrors.length > 0 ? netErrors.reduce((a, b) => a + b, 0) / netErrors.length : null
    
    // Median
    const sortedGross = [...grossErrors].sort((a, b) => a - b)
    const median_error_gross = sortedGross[Math.floor(sortedGross.length / 2)]

    // Within percentage thresholds
    const within5 = items.filter(i => Math.abs(i.percent_error_gross) <= 5).length
    const within10 = items.filter(i => Math.abs(i.percent_error_gross) <= 10).length

    breakdowns.push({
      category,
      count: items.length,
      mae_gross,
      mae_net,
      median_error_gross,
      within_5_percent: (within5 / items.length) * 100,
      within_10_percent: (within10 / items.length) * 100
    })
  }

  return breakdowns.sort((a, b) => b.count - a.count)
}

function calculateScoreBucketBreakdown(results: ValidationResult[]): ValidationBreakdown[] {
  const buckets = [
    { label: '< 100"', min: 0, max: 100 },
    { label: '100-120"', min: 100, max: 120 },
    { label: '120-140"', min: 120, max: 140 },
    { label: '140-160"', min: 140, max: 160 },
    { label: '160-180"', min: 160, max: 180 },
    { label: '180-200"', min: 180, max: 200 },
    { label: '200+"', min: 200, max: 999 }
  ]

  const breakdowns: ValidationBreakdown[] = []

  for (const bucket of buckets) {
    const items = results.filter(r => 
      r.ground_truth_gross >= bucket.min && r.ground_truth_gross < bucket.max
    )
    
    if (items.length === 0) continue

    const grossErrors = items.map(i => i.abs_error_gross)
    const netErrors = items.filter(i => i.abs_error_net != null).map(i => i.abs_error_net!)
    
    const mae_gross = grossErrors.reduce((a, b) => a + b, 0) / grossErrors.length
    const mae_net = netErrors.length > 0 ? netErrors.reduce((a, b) => a + b, 0) / netErrors.length : null
    
    const sortedGross = [...grossErrors].sort((a, b) => a - b)
    const median_error_gross = sortedGross[Math.floor(sortedGross.length / 2)]

    const within5 = items.filter(i => Math.abs(i.percent_error_gross) <= 5).length
    const within10 = items.filter(i => Math.abs(i.percent_error_gross) <= 10).length

    breakdowns.push({
      category: bucket.label,
      count: items.length,
      mae_gross,
      mae_net,
      median_error_gross,
      within_5_percent: (within5 / items.length) * 100,
      within_10_percent: (within10 / items.length) * 100
    })
  }

  return breakdowns
}

function calculateConfidenceBucketBreakdown(results: ValidationResult[]): ValidationBreakdown[] {
  const buckets = [
    { label: 'Low (0-40%)', min: 0, max: 40 },
    { label: 'Medium (40-60%)', min: 40, max: 60 },
    { label: 'High (60-80%)', min: 60, max: 80 },
    { label: 'Very High (80-100%)', min: 80, max: 101 }
  ]

  const breakdowns: ValidationBreakdown[] = []

  for (const bucket of buckets) {
    const items = results.filter(r => 
      r.confidence_percent != null &&
      r.confidence_percent >= bucket.min && 
      r.confidence_percent < bucket.max
    )
    
    if (items.length === 0) continue

    const grossErrors = items.map(i => i.abs_error_gross)
    const netErrors = items.filter(i => i.abs_error_net != null).map(i => i.abs_error_net!)
    
    const mae_gross = grossErrors.reduce((a, b) => a + b, 0) / grossErrors.length
    const mae_net = netErrors.length > 0 ? netErrors.reduce((a, b) => a + b, 0) / netErrors.length : null
    
    const sortedGross = [...grossErrors].sort((a, b) => a - b)
    const median_error_gross = sortedGross[Math.floor(sortedGross.length / 2)]

    const within5 = items.filter(i => Math.abs(i.percent_error_gross) <= 5).length
    const within10 = items.filter(i => Math.abs(i.percent_error_gross) <= 10).length

    breakdowns.push({
      category: bucket.label,
      count: items.length,
      mae_gross,
      mae_net,
      median_error_gross,
      within_5_percent: (within5 / items.length) * 100,
      within_10_percent: (within10 / items.length) * 100
    })
  }

  return breakdowns
}

// ============================================================================
// ACCURACY DASHBOARD METRICS
// ============================================================================

export async function getAccuracyMetrics(): Promise<AccuracyMetrics> {
  const supabase = await createClient()

  // Get total predictions count
  const { count: totalPredictions } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true })

  // Get predictions with ground truth
  const { data: withGroundTruth } = await supabase
    .from('training_examples')
    .select('ground_truth_score, predicted_score, error_amount, created_at')
    .eq('verified_for_training', true)
    .not('predicted_score', 'is', null)
    .not('ground_truth_score', 'is', null)

  const totalWithGroundTruth = withGroundTruth?.length || 0
  const coveragePercent = totalPredictions && totalPredictions > 0 
    ? (totalWithGroundTruth / totalPredictions) * 100 
    : 0

  // Calculate error metrics
  let maeGross: number | null = null
  let maeNet: number | null = null
  let medianErrorGross: number | null = null
  let medianErrorNet: number | null = null
  let rmseGross: number | null = null
  let rmseNet: number | null = null
  let within5Inches = 0
  let within10Inches = 0
  let within15Inches = 0
  let within5Percent = 0
  let within10Percent = 0

  if (withGroundTruth && withGroundTruth.length > 0) {
    const absErrors = withGroundTruth.map(d => Math.abs(d.error_amount || 0))
    const errors = withGroundTruth.map(d => d.error_amount || 0)
    
    // MAE
    maeGross = absErrors.reduce((a, b) => a + b, 0) / absErrors.length
    maeNet = errors.reduce((a, b) => a + b, 0) / errors.length

    // Median
    const sorted = [...absErrors].sort((a, b) => a - b)
    medianErrorGross = sorted[Math.floor(sorted.length / 2)]
    
    const sortedSigned = [...errors].sort((a, b) => a - b)
    medianErrorNet = sortedSigned[Math.floor(sortedSigned.length / 2)]

    // RMSE
    rmseGross = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length)
    rmseNet = rmseGross // Same for now

    // Within thresholds
    within5Inches = absErrors.filter(e => e <= 5).length
    within10Inches = absErrors.filter(e => e <= 10).length
    within15Inches = absErrors.filter(e => e <= 15).length

    // Percentage thresholds
    const percentErrors = withGroundTruth.map(d => {
      const gt = d.ground_truth_score || 1
      return Math.abs((d.error_amount || 0) / gt) * 100
    })
    within5Percent = percentErrors.filter(e => e <= 5).length
    within10Percent = percentErrors.filter(e => e <= 10).length
  }

  // Trend data (last 7 days)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  
  const { data: recentData } = await supabase
    .from('training_examples')
    .select('error_amount, created_at')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: true })

  const errorTrend7d = calculateDailyTrend(recentData || [], 7)

  // Trend data (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  const { data: monthData } = await supabase
    .from('training_examples')
    .select('error_amount, created_at')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: true })

  const errorTrend30d = calculateDailyTrend(monthData || [], 30)

  // Model version history
  const { data: modelVersions } = await supabase
    .from('model_versions')
    .select('version_name, created_at, avg_gross_error, training_data_count')
    .order('created_at', { ascending: true })
    .limit(10)

  const modelAccuracyHistory: ModelAccuracyPoint[] = (modelVersions || []).map(mv => ({
    version_name: mv.version_name,
    created_at: mv.created_at,
    mae_gross: mv.avg_gross_error,
    sample_count: mv.training_data_count
  }))

  // Get current model version
  const { data: activeModel } = await supabase
    .from('model_versions')
    .select('version_name')
    .eq('is_active', true)
    .single()

  return {
    total_predictions: totalPredictions || 0,
    total_with_ground_truth: totalWithGroundTruth,
    coverage_percent: coveragePercent,
    mae_gross: maeGross,
    mae_net: maeNet,
    median_error_gross: medianErrorGross,
    median_error_net: medianErrorNet,
    rmse_gross: rmseGross,
    rmse_net: rmseNet,
    within_5_inches: within5Inches,
    within_10_inches: within10Inches,
    within_15_inches: within15Inches,
    within_5_percent: within5Percent,
    within_10_percent: within10Percent,
    error_trend_7d: errorTrend7d,
    error_trend_30d: errorTrend30d,
    current_model_version: activeModel?.version_name || null,
    model_accuracy_history: modelAccuracyHistory
  }
}

function calculateDailyTrend(
  data: { error_amount: number | null; created_at: string }[],
  days: number
): TrendPoint[] {
  const trend: TrendPoint[] = []
  const today = new Date()
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    
    const dayData = data.filter(d => d.created_at.startsWith(dateStr))
    const errors = dayData.map(d => Math.abs(d.error_amount || 0))
    
    trend.push({
      date: dateStr,
      mae: errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0,
      count: errors.length
    })
  }
  
  return trend
}

export async function getAccuracyBreakdown(
  dimension: 'state' | 'rack_type' | 'score_bucket' | 'confidence_bucket'
): Promise<AccuracyBreakdown> {
  const supabase = await createClient()

  // Get all training examples with predictions
  const { data: examples } = await supabase
    .from('training_examples')
    .select(`
      id,
      ground_truth_score,
      predicted_score,
      error_amount,
      buck_id
    `)
    .eq('verified_for_training', true)
    .not('predicted_score', 'is', null)
    .not('ground_truth_score', 'is', null)

  if (!examples || examples.length === 0) {
    return { dimension, breakdown: [] }
  }

  // For state and rack_type, we need to join with bucks
  if (dimension === 'state' || dimension === 'rack_type') {
    const buckIds = examples.filter(e => e.buck_id).map(e => e.buck_id)
    
    const { data: bucks } = await supabase
      .from('bucks')
      .select('id, location, rack_type')
      .in('id', buckIds)

    const buckMap = new Map(bucks?.map(b => [b.id, b]) || [])
    
    const groups = new Map<string, typeof examples>()
    
    for (const ex of examples) {
      const buck = ex.buck_id ? buckMap.get(ex.buck_id) : null
      let key = 'Unknown'
      
      if (dimension === 'state') {
        // Extract state from location
        key = buck?.location?.split(',').pop()?.trim() || 'Unknown'
      } else {
        key = buck?.rack_type || 'Unknown'
      }
      
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(ex)
    }

    const breakdown = Array.from(groups.entries()).map(([label, items]) => {
      const absErrors = items.map(i => Math.abs(i.error_amount || 0))
      const mae_gross = absErrors.length > 0 
        ? absErrors.reduce((a, b) => a + b, 0) / absErrors.length 
        : null
      
      const percentErrors = items.map(i => {
        const gt = i.ground_truth_score || 1
        return Math.abs((i.error_amount || 0) / gt) * 100
      })
      const within10 = percentErrors.filter(e => e <= 10).length

      return {
        label,
        count: items.length,
        mae_gross,
        mae_net: null,
        within_10_percent: items.length > 0 ? (within10 / items.length) * 100 : 0
      }
    })

    return { dimension, breakdown: breakdown.sort((a, b) => b.count - a.count) }
  }

  // Score bucket breakdown
  if (dimension === 'score_bucket') {
    const buckets = [
      { label: '< 100"', min: 0, max: 100 },
      { label: '100-120"', min: 100, max: 120 },
      { label: '120-140"', min: 120, max: 140 },
      { label: '140-160"', min: 140, max: 160 },
      { label: '160-180"', min: 160, max: 180 },
      { label: '180-200"', min: 180, max: 200 },
      { label: '200+"', min: 200, max: 999 }
    ]

    const breakdown = buckets.map(bucket => {
      const items = examples.filter(e => 
        e.ground_truth_score >= bucket.min && e.ground_truth_score < bucket.max
      )
      
      const absErrors = items.map(i => Math.abs(i.error_amount || 0))
      const mae_gross = absErrors.length > 0 
        ? absErrors.reduce((a, b) => a + b, 0) / absErrors.length 
        : null

      const percentErrors = items.map(i => {
        const gt = i.ground_truth_score || 1
        return Math.abs((i.error_amount || 0) / gt) * 100
      })
      const within10 = percentErrors.filter(e => e <= 10).length

      return {
        label: bucket.label,
        count: items.length,
        mae_gross,
        mae_net: null,
        within_10_percent: items.length > 0 ? (within10 / items.length) * 100 : 0
      }
    }).filter(b => b.count > 0)

    return { dimension, breakdown }
  }

  // Confidence bucket (would need prediction confidence data)
  return { dimension, breakdown: [] }
}

export async function getErrorDistribution(): Promise<ErrorDistribution[]> {
  const supabase = await createClient()

  const { data: examples } = await supabase
    .from('training_examples')
    .select('error_amount')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)

  if (!examples || examples.length === 0) return []

  const buckets = [
    { label: '< -20"', min: -Infinity, max: -20 },
    { label: '-20 to -15"', min: -20, max: -15 },
    { label: '-15 to -10"', min: -15, max: -10 },
    { label: '-10 to -5"', min: -10, max: -5 },
    { label: '-5 to 0"', min: -5, max: 0 },
    { label: '0 to 5"', min: 0, max: 5 },
    { label: '5 to 10"', min: 5, max: 10 },
    { label: '10 to 15"', min: 10, max: 15 },
    { label: '15 to 20"', min: 15, max: 20 },
    { label: '> 20"', min: 20, max: Infinity }
  ]

  const total = examples.length
  
  return buckets.map(bucket => {
    const count = examples.filter(e => {
      const err = e.error_amount || 0
      return err > bucket.min && err <= bucket.max
    }).length

    return {
      bucket_label: bucket.label,
      bucket_min: bucket.min === -Infinity ? -999 : bucket.min,
      bucket_max: bucket.max === Infinity ? 999 : bucket.max,
      count,
      percent: total > 0 ? (count / total) * 100 : 0
    }
  })
}

// ============================================================================
// TRAINING EXAMPLES FOR VALIDATION
// ============================================================================

export async function getTrainingExamplesForValidation(
  config?: ValidationRunConfig
): Promise<{ id: string; buck_id: string; ground_truth_score: number; predicted_score: number | null }[]> {
  const supabase = await createClient()

  let query = supabase
    .from('training_examples')
    .select('id, buck_id, ground_truth_score, predicted_score')
    .not('ground_truth_score', 'is', null)

  // Apply filters from config
  if (!config?.include_unverified) {
    query = query.eq('verified_for_training', true)
  }

  if (config?.score_range_min != null) {
    query = query.gte('ground_truth_score', config.score_range_min)
  }

  if (config?.score_range_max != null) {
    query = query.lte('ground_truth_score', config.score_range_max)
  }

  if (config?.sample_size) {
    query = query.limit(config.sample_size)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to get training examples: ${error.message}`)
  return data || []
}

// ============================================================================
// MEASUREMENT-LEVEL ACCURACY (Phase 21)
// ============================================================================

export async function getMeasurementLevelMetrics(): Promise<MeasurementLevelMetrics | null> {
  const supabase = await createClient()

  // Get training examples with measurement_errors data
  const { data: examples } = await supabase
    .from('training_examples')
    .select('measurement_errors')
    .eq('verified_for_training', true)
    .not('measurement_errors', 'is', null)
    .limit(500)

  if (!examples || examples.length === 0) {
    return null
  }

  // Calculate per-category MAE
  const categoryErrors: Record<MeasurementCategory, { before: number[]; after: number[] }> = {
    spread: { before: [], after: [] },
    beam: { before: [], after: [] },
    tine: { before: [], after: [] },
    mass: { before: [], after: [] },
    deduction: { before: [], after: [] },
  }

  for (const ex of examples) {
    const errors = ex.measurement_errors as Record<string, number | { before?: number; after?: number }> | null
    if (!errors) continue

    for (const category of Object.keys(categoryErrors) as MeasurementCategory[]) {
      const catError = errors[category]
      if (typeof catError === 'number') {
        // Legacy format: single error value (treat as "before")
        categoryErrors[category].before.push(Math.abs(catError))
      } else if (catError && typeof catError === 'object') {
        // New format: before/after
        if (catError.before !== undefined) {
          categoryErrors[category].before.push(Math.abs(catError.before))
        }
        if (catError.after !== undefined) {
          categoryErrors[category].after.push(Math.abs(catError.after))
        }
      }
    }
  }

  // Calculate MAE for each category
  const calcMae = (arr: number[]): number | null => {
    if (arr.length === 0) return null
    return arr.reduce((a, b) => a + b, 0) / arr.length
  }

  const spreadMaeBefore = calcMae(categoryErrors.spread.before)
  const spreadMaeAfter = calcMae(categoryErrors.spread.after)
  const beamMaeBefore = calcMae(categoryErrors.beam.before)
  const beamMaeAfter = calcMae(categoryErrors.beam.after)
  const tineMaeBefore = calcMae(categoryErrors.tine.before)
  const tineMaeAfter = calcMae(categoryErrors.tine.after)
  const massMaeBefore = calcMae(categoryErrors.mass.before)
  const massMaeAfter = calcMae(categoryErrors.mass.after)

  // Calculate improvement (positive = improved, negative = worsened)
  const calcImprovement = (before: number | null, after: number | null): number | null => {
    if (before === null || after === null) return null
    return before - after
  }

  const spreadImprovement = calcImprovement(spreadMaeBefore, spreadMaeAfter)
  const beamImprovement = calcImprovement(beamMaeBefore, beamMaeAfter)
  const tineImprovement = calcImprovement(tineMaeBefore, tineMaeAfter)
  const massImprovement = calcImprovement(massMaeBefore, massMaeAfter)

  // Categorize improvements
  const categoriesImproved: MeasurementCategory[] = []
  const categoriesWorsened: MeasurementCategory[] = []
  const categoriesUnchanged: MeasurementCategory[] = []

  const categorizeImprovement = (category: MeasurementCategory, improvement: number | null) => {
    if (improvement === null) return
    if (improvement > 0.25) categoriesImproved.push(category)
    else if (improvement < -0.25) categoriesWorsened.push(category)
    else categoriesUnchanged.push(category)
  }

  categorizeImprovement('spread', spreadImprovement)
  categorizeImprovement('beam', beamImprovement)
  categorizeImprovement('tine', tineImprovement)
  categorizeImprovement('mass', massImprovement)

  return {
    spreadMaeBefore,
    spreadMaeAfter,
    beamMaeBefore,
    beamMaeAfter,
    tineMaeBefore,
    tineMaeAfter,
    massMaeBefore,
    massMaeAfter,
    spreadImprovement,
    beamImprovement,
    tineImprovement,
    massImprovement,
    categoriesImproved,
    categoriesWorsened,
    categoriesUnchanged,
  }
}

export interface MeasurementAccuracyBreakdown {
  category: MeasurementCategory
  label: string
  maeBefore: number | null
  maeAfter: number | null
  improvement: number | null
  sampleCount: number
}

export async function getMeasurementAccuracyBreakdown(): Promise<MeasurementAccuracyBreakdown[]> {
  const metrics = await getMeasurementLevelMetrics()
  
  if (!metrics) {
    return []
  }

  const supabase = await createClient()
  
  // Get sample counts per category
  const { data: examples } = await supabase
    .from('training_examples')
    .select('measurement_errors')
    .eq('verified_for_training', true)
    .not('measurement_errors', 'is', null)
    .limit(500)

  const categoryCounts: Record<MeasurementCategory, number> = {
    spread: 0,
    beam: 0,
    tine: 0,
    mass: 0,
    deduction: 0,
  }

  for (const ex of examples || []) {
    const errors = ex.measurement_errors as Record<string, unknown> | null
    if (!errors) continue
    for (const cat of Object.keys(categoryCounts) as MeasurementCategory[]) {
      if (errors[cat] !== undefined) categoryCounts[cat]++
    }
  }

  return [
    {
      category: 'spread',
      label: 'Inside Spread',
      maeBefore: metrics.spreadMaeBefore,
      maeAfter: metrics.spreadMaeAfter,
      improvement: metrics.spreadImprovement,
      sampleCount: categoryCounts.spread,
    },
    {
      category: 'beam',
      label: 'Main Beams',
      maeBefore: metrics.beamMaeBefore,
      maeAfter: metrics.beamMaeAfter,
      improvement: metrics.beamImprovement,
      sampleCount: categoryCounts.beam,
    },
    {
      category: 'tine',
      label: 'Tine Lengths',
      maeBefore: metrics.tineMaeBefore,
      maeAfter: metrics.tineMaeAfter,
      improvement: metrics.tineImprovement,
      sampleCount: categoryCounts.tine,
    },
    {
      category: 'mass',
      label: 'Mass/Circumference',
      maeBefore: metrics.massMaeBefore,
      maeAfter: metrics.massMaeAfter,
      improvement: metrics.massImprovement,
      sampleCount: categoryCounts.mass,
    },
  ]
}

// ============================================================================
// PHASE 23: SECOND-PASS ACCURACY METRICS
// ============================================================================

export async function getSecondPassAccuracyMetrics(): Promise<SecondPassAccuracyMetrics | null> {
  const supabase = await createClient()

  // Get predictions with two-pass metadata
  const { data: predictions } = await supabase
    .from('predictions')
    .select('two_pass_metadata, second_pass_ran, final_selection_method, self_check_stability')
    .not('two_pass_metadata', 'is', null)
    .limit(1000)

  if (!predictions || predictions.length === 0) {
    return null
  }

  // Get training examples with both first and second pass errors
  const { data: examples } = await supabase
    .from('training_examples')
    .select('first_pass_error, error_amount, second_pass_improved, final_selection_method, two_pass_metadata')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)
    .limit(500)

  // Calculate metrics
  const totalPredictions = predictions.length
  const secondPassTriggered = predictions.filter(p => p.second_pass_ran).length
  const triggerRate = totalPredictions > 0 ? (secondPassTriggered / totalPredictions) * 100 : 0

  // Selection method counts
  const selectionMethodCounts: Record<FinalSelectionMethod, number> = {
    first_pass: 0,
    second_pass: 0,
    blend_weighted: 0,
    blend_conservative: 0,
  }

  for (const p of predictions) {
    const method = p.final_selection_method as FinalSelectionMethod | null
    if (method && method in selectionMethodCounts) {
      selectionMethodCounts[method]++
    }
  }

  // Stability distribution
  let stableCount = 0
  let uncertainCount = 0
  let unstableCount = 0

  for (const p of predictions) {
    const stability = p.self_check_stability
    if (stability === 'stable') stableCount++
    else if (stability === 'uncertain') uncertainCount++
    else if (stability === 'unstable') unstableCount++
  }

  // Issue type frequency
  const issueTypeFrequency: Partial<Record<SelfCheckIssueType, number>> = {}

  for (const p of predictions) {
    const metadata = p.two_pass_metadata as { selfCheck?: { issues?: { type: SelfCheckIssueType }[] } } | null
    const issues = metadata?.selfCheck?.issues
    if (issues && Array.isArray(issues)) {
      for (const issue of issues) {
        if (issue.type) {
          issueTypeFrequency[issue.type] = (issueTypeFrequency[issue.type] || 0) + 1
        }
      }
    }
  }

  // Calculate error improvement from training examples
  let firstPassOnlyMae: number | null = null
  let withSecondPassMae: number | null = null
  let maeImprovement: number | null = null

  if (examples && examples.length > 0) {
    const firstPassErrors: number[] = []
    const finalErrors: number[] = []

    for (const ex of examples) {
      if (ex.first_pass_error !== null && ex.error_amount !== null) {
        firstPassErrors.push(Math.abs(ex.first_pass_error))
        finalErrors.push(Math.abs(ex.error_amount))
      }
    }

    if (firstPassErrors.length > 0) {
      firstPassOnlyMae = firstPassErrors.reduce((a, b) => a + b, 0) / firstPassErrors.length
      withSecondPassMae = finalErrors.reduce((a, b) => a + b, 0) / finalErrors.length
      maeImprovement = firstPassOnlyMae - withSecondPassMae
    }
  }

  // Best improvement scenarios (placeholder - would need more detailed analysis)
  const bestImprovementScenarios: SecondPassAccuracyMetrics['best_improvement_scenarios'] = []

  // Analyze which stability levels benefit most
  const stabilityLevels = ['stable', 'uncertain', 'unstable']
  for (const stability of stabilityLevels) {
    const stabExamples = examples?.filter(ex => {
      const metadata = ex.two_pass_metadata as { selfCheck?: { overallStability?: string } } | null
      return metadata?.selfCheck?.overallStability === stability
    }) || []

    if (stabExamples.length >= 5) {
      const improved = stabExamples.filter(ex => ex.second_pass_improved === true).length
      const improvementRate = (improved / stabExamples.length) * 100

      if (improvementRate > 30) {
        bestImprovementScenarios.push({
          scenario: `${stability} stability`,
          improvement: improvementRate,
          sampleCount: stabExamples.length,
        })
      }
    }
  }

  return {
    total_predictions_with_two_pass: totalPredictions,
    second_pass_trigger_rate: triggerRate,
    first_pass_only_mae: firstPassOnlyMae,
    with_second_pass_mae: withSecondPassMae,
    mae_improvement: maeImprovement,
    selection_method_counts: selectionMethodCounts,
    issue_type_frequency: issueTypeFrequency as Record<SelfCheckIssueType, number>,
    stable_count: stableCount,
    uncertain_count: uncertainCount,
    unstable_count: unstableCount,
    best_improvement_scenarios: bestImprovementScenarios,
  }
}

export interface SecondPassBreakdown {
  category: string
  totalPredictions: number
  secondPassTriggered: number
  triggerRate: number
  firstPassMae: number | null
  finalMae: number | null
  improvement: number | null
  selectionBreakdown: Record<FinalSelectionMethod, number>
}

export async function getSecondPassBreakdownByState(): Promise<SecondPassBreakdown[]> {
  const supabase = await createClient()

  // Get predictions with state info
  const { data: predictions } = await supabase
    .from('predictions')
    .select('buck_id, two_pass_metadata, second_pass_ran, final_selection_method')
    .not('two_pass_metadata', 'is', null)
    .limit(500)

  if (!predictions || predictions.length === 0) {
    return []
  }

  // Get buck states
  const buckIds = predictions.map(p => p.buck_id).filter(Boolean)
  const { data: bucks } = await supabase
    .from('bucks')
    .select('id, state')
    .in('id', buckIds)

  const buckStateMap = new Map(bucks?.map(b => [b.id, b.state]) || [])

  // Group by state
  const stateGroups = new Map<string, typeof predictions>()
  for (const p of predictions) {
    const state = buckStateMap.get(p.buck_id) || 'Unknown'
    if (!stateGroups.has(state)) {
      stateGroups.set(state, [])
    }
    stateGroups.get(state)!.push(p)
  }

  // Calculate breakdown for each state
  const breakdowns: SecondPassBreakdown[] = []

  for (const [state, preds] of stateGroups) {
    if (preds.length < 3) continue

    const secondPassTriggered = preds.filter(p => p.second_pass_ran).length
    const triggerRate = (secondPassTriggered / preds.length) * 100

    const selectionBreakdown: Record<FinalSelectionMethod, number> = {
      first_pass: 0,
      second_pass: 0,
      blend_weighted: 0,
      blend_conservative: 0,
    }

    for (const p of preds) {
      const method = p.final_selection_method as FinalSelectionMethod | null
      if (method && method in selectionBreakdown) {
        selectionBreakdown[method]++
      }
    }

    breakdowns.push({
      category: state,
      totalPredictions: preds.length,
      secondPassTriggered,
      triggerRate,
      firstPassMae: null, // Would need training examples
      finalMae: null,
      improvement: null,
      selectionBreakdown,
    })
  }

  return breakdowns.sort((a, b) => b.totalPredictions - a.totalPredictions)
}

export interface SelfCheckIssueAnalysis {
  issueType: SelfCheckIssueType
  count: number
  avgSeverity: string
  secondPassTriggeredPercent: number
  avgImprovementWhenTriggered: number | null
}

export async function getSelfCheckIssueAnalysis(): Promise<SelfCheckIssueAnalysis[]> {
  const supabase = await createClient()

  const { data: logs } = await supabase
    .from('self_check_issue_log')
    .select('issue_type, severity, second_pass_triggered, second_pass_improved, final_error_gross')
    .limit(1000)

  if (!logs || logs.length === 0) {
    return []
  }

  // Group by issue type
  const issueGroups = new Map<string, typeof logs>()
  for (const log of logs) {
    const type = log.issue_type
    if (!issueGroups.has(type)) {
      issueGroups.set(type, [])
    }
    issueGroups.get(type)!.push(log)
  }

  const analyses: SelfCheckIssueAnalysis[] = []

  for (const [issueType, issueLogs] of issueGroups) {
    const count = issueLogs.length
    
    // Calculate average severity
    const severityMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }
    const severitySum = issueLogs.reduce((sum, l) => sum + (severityMap[l.severity] || 0), 0)
    const avgSeverityNum = severitySum / count
    const avgSeverity = avgSeverityNum < 1.5 ? 'low' : avgSeverityNum < 2.5 ? 'medium' : avgSeverityNum < 3.5 ? 'high' : 'critical'

    // Second pass trigger rate
    const triggered = issueLogs.filter(l => l.second_pass_triggered).length
    const secondPassTriggeredPercent = (triggered / count) * 100

    // Average improvement when triggered
    const triggeredLogs = issueLogs.filter(l => l.second_pass_triggered && l.second_pass_improved !== null)
    const avgImprovementWhenTriggered = triggeredLogs.length > 0
      ? triggeredLogs.filter(l => l.second_pass_improved).length / triggeredLogs.length * 100
      : null

    analyses.push({
      issueType: issueType as SelfCheckIssueType,
      count,
      avgSeverity,
      secondPassTriggeredPercent,
      avgImprovementWhenTriggered,
    })
  }

  return analyses.sort((a, b) => b.count - a.count)
}

// ============================================================================
// PHASE 24: RUNTIME HEALTH METRICS
// ============================================================================

export async function getRuntimeHealthMetrics(): Promise<RuntimeHealthMetrics | null> {
  const supabase = await createClient()

  // Get predictions from last 30 days
  const { data: predictions } = await supabase
    .from('predictions')
    .select(`
      id,
      scoring_method,
      used_fallback,
      fallback_reason,
      runtime_total_time_ms,
      runtime_timed_out,
      runtime_was_retried,
      runtime_total_attempts,
      image_validation_valid,
      image_validation_valid_count,
      image_validation_total_count,
      image_validation_issue_count,
      image_validation_issues,
      fallback_metadata,
      created_at
    `)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1000)

  if (!predictions || predictions.length === 0) {
    return null
  }

  const totalPredictions = predictions.length
  
  // Vision success rate
  const visionSuccesses = predictions.filter(p => 
    p.scoring_method === 'vision' && !p.used_fallback
  ).length
  const visionSuccessRate = (visionSuccesses / totalPredictions) * 100

  // Fallback rate
  const fallbacks = predictions.filter(p => p.used_fallback).length
  const fallbackRate = (fallbacks / totalPredictions) * 100

  // Error type counts
  const errorTypeCounts: Partial<Record<VisionRuntimeErrorType, number>> = {}
  const fallbackReasonCounts: Partial<Record<FallbackReason, number>> = {}

  for (const p of predictions) {
    if (p.fallback_reason) {
      const reason = p.fallback_reason as FallbackReason
      fallbackReasonCounts[reason] = (fallbackReasonCounts[reason] || 0) + 1
      
      // Map fallback reason to error type
      const errorTypeMap: Record<string, VisionRuntimeErrorType> = {
        vision_timeout: 'timeout',
        vision_provider_error: 'provider_error',
        vision_rate_limit: 'rate_limit',
        vision_quota_exceeded: 'quota_exceeded',
        vision_model_unavailable: 'model_unavailable',
        vision_malformed_response: 'malformed_response',
        vision_validation_failed: 'validation_error',
        vision_content_blocked: 'content_policy',
      }
      const errorType = errorTypeMap[reason] || 'unknown'
      errorTypeCounts[errorType] = (errorTypeCounts[errorType] || 0) + 1
    }
  }

  // Timing stats
  const timings = predictions
    .map(p => p.runtime_total_time_ms)
    .filter((t): t is number => t !== null && t > 0)
  
  const avgVisionTimeMs = timings.length > 0 
    ? timings.reduce((a, b) => a + b, 0) / timings.length 
    : null

  const sortedTimings = [...timings].sort((a, b) => a - b)
  const p95VisionTimeMs = sortedTimings.length > 0 
    ? sortedTimings[Math.floor(sortedTimings.length * 0.95)]
    : null

  // Timeout rate
  const timeouts = predictions.filter(p => p.runtime_timed_out).length
  const timeoutRate = (timeouts / totalPredictions) * 100

  // Image validation stats
  const validImageCounts = predictions
    .map(p => p.image_validation_valid_count)
    .filter((c): c is number => c !== null)
  
  const avgValidImagesPerRequest = validImageCounts.length > 0
    ? validImageCounts.reduce((a, b) => a + b, 0) / validImageCounts.length
    : 0

  const imageValidationFailures = predictions.filter(p => p.image_validation_valid === false).length
  const imageValidationFailRate = (imageValidationFailures / totalPredictions) * 100

  // Common image issues
  const imageIssueCounts: Partial<Record<ImageValidationIssueType, number>> = {}
  for (const p of predictions) {
    if (p.image_validation_issues && Array.isArray(p.image_validation_issues)) {
      for (const issue of p.image_validation_issues) {
        const issueType = (issue as { issueType?: string })?.issueType as ImageValidationIssueType | undefined
        if (issueType) {
          imageIssueCounts[issueType] = (imageIssueCounts[issueType] || 0) + 1
        }
      }
    }
  }

  const commonImageIssues = Object.entries(imageIssueCounts)
    .map(([type, count]) => ({ type: type as ImageValidationIssueType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Retry stats
  const retriedPredictions = predictions.filter(p => p.runtime_was_retried).length
  const retryRate = (retriedPredictions / totalPredictions) * 100

  const failedWithRetries = predictions.filter(p => 
    p.used_fallback && p.runtime_total_attempts && p.runtime_total_attempts > 1
  )
  const avgRetriesPerFailure = failedWithRetries.length > 0
    ? failedWithRetries.reduce((sum, p) => sum + ((p.runtime_total_attempts || 1) - 1), 0) / failedWithRetries.length
    : 0

  // Health trend by day
  const dayGroups = new Map<string, typeof predictions>()
  for (const p of predictions) {
    const day = p.created_at.split('T')[0]
    if (!dayGroups.has(day)) {
      dayGroups.set(day, [])
    }
    dayGroups.get(day)!.push(p)
  }

  const healthTrend7d = Array.from(dayGroups.entries())
    .slice(0, 7)
    .map(([date, preds]) => {
      const dayTotal = preds.length
      const daySuccesses = preds.filter(p => p.scoring_method === 'vision' && !p.used_fallback).length
      const dayFallbacks = preds.filter(p => p.used_fallback).length
      const dayTimings = preds.map(p => p.runtime_total_time_ms).filter((t): t is number => t !== null)
      
      return {
        date,
        successRate: dayTotal > 0 ? (daySuccesses / dayTotal) * 100 : 0,
        fallbackRate: dayTotal > 0 ? (dayFallbacks / dayTotal) * 100 : 0,
        avgTimeMs: dayTimings.length > 0 
          ? dayTimings.reduce((a, b) => a + b, 0) / dayTimings.length 
          : 0,
      }
    })

  return {
    totalPredictions,
    visionSuccessRate,
    fallbackRate,
    errorTypeCounts: errorTypeCounts as Record<VisionRuntimeErrorType, number>,
    fallbackReasonCounts: fallbackReasonCounts as Record<FallbackReason, number>,
    avgVisionTimeMs,
    p95VisionTimeMs,
    timeoutRate,
    avgValidImagesPerRequest,
    imageValidationFailRate,
    commonImageIssues,
    retryRate,
    avgRetriesPerFailure,
    healthTrend7d,
  }
}

export interface FallbackBreakdown {
  reason: FallbackReason
  count: number
  percent: number
  avgConfidencePenalty: number | null
  avgErrorBandWidening: number | null
}

export async function getFallbackBreakdown(): Promise<FallbackBreakdown[]> {
  const supabase = await createClient()

  const { data: predictions } = await supabase
    .from('predictions')
    .select('fallback_reason, fallback_confidence_penalty, fallback_error_band_widening')
    .eq('used_fallback', true)
    .not('fallback_reason', 'is', null)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(500)

  if (!predictions || predictions.length === 0) {
    return []
  }

  const total = predictions.length
  const reasonGroups = new Map<string, typeof predictions>()

  for (const p of predictions) {
    const reason = p.fallback_reason!
    if (!reasonGroups.has(reason)) {
      reasonGroups.set(reason, [])
    }
    reasonGroups.get(reason)!.push(p)
  }

  return Array.from(reasonGroups.entries())
    .map(([reason, preds]) => {
      const penalties = preds.map(p => p.fallback_confidence_penalty).filter((p): p is number => p !== null)
      const widenings = preds.map(p => p.fallback_error_band_widening).filter((w): w is number => w !== null)

      return {
        reason: reason as FallbackReason,
        count: preds.length,
        percent: (preds.length / total) * 100,
        avgConfidencePenalty: penalties.length > 0 
          ? penalties.reduce((a, b) => a + b, 0) / penalties.length 
          : null,
        avgErrorBandWidening: widenings.length > 0 
          ? widenings.reduce((a, b) => a + b, 0) / widenings.length 
          : null,
      }
    })
    .sort((a, b) => b.count - a.count)
}

// ============================================================================
// PHASE 25: CONFIDENCE CALIBRATION METRICS
// ============================================================================

export async function getConfidenceCalibrationMetrics(): Promise<ConfidenceCalibrationMetrics | null> {
  const supabase = await createClient()

  // Get training examples with confidence data
  const { data: examples } = await supabase
    .from('training_examples')
    .select(`
      raw_confidence,
      calibrated_confidence,
      confidence_tier,
      trust_score,
      trust_tier,
      error_amount,
      ground_truth_score,
      predicted_score
    `)
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)
    .limit(1000)

  if (!examples || examples.length === 0) {
    return null
  }

  const totalPredictionsAnalyzed = examples.length

  // Calculate calibration accuracy by tier
  const tierGroups = new Map<string, typeof examples>()
  for (const ex of examples) {
    const tier = ex.confidence_tier || 'unknown'
    if (!tierGroups.has(tier)) {
      tierGroups.set(tier, [])
    }
    tierGroups.get(tier)!.push(ex)
  }

  // Expected MAE by tier (these are the targets from calibration)
  const expectedMaeByTier: Record<string, number> = {
    very_high: 4.0,
    high: 6.5,
    medium: 9.5,
    low: 14.0,
    very_low: 20.0,
  }

  const tierAccuracy: ConfidenceCalibrationMetrics['tierAccuracy'] = []
  for (const [tier, exs] of tierGroups) {
    if (exs.length < 3) continue
    
    const errors = exs.map(e => Math.abs(e.error_amount || 0))
    const actualMae = errors.reduce((a, b) => a + b, 0) / errors.length
    const predictedMae = expectedMaeByTier[tier] || 10
    const accuracy = 100 - Math.abs(actualMae - predictedMae) / predictedMae * 100

    tierAccuracy.push({
      tier: tier as ConfidenceTier,
      predictedMae,
      actualMae,
      sampleCount: exs.length,
      accuracy: Math.max(0, Math.min(100, accuracy)),
    })
  }

  // Calculate overconfidence/underconfidence
  let overconfidentCount = 0
  let underconfidentCount = 0

  for (const ex of examples) {
    const confidence = ex.calibrated_confidence || ex.raw_confidence || 50
    const error = Math.abs(ex.error_amount || 0)
    
    // High confidence (>75) but high error (>10")
    if (confidence > 75 && error > 10) {
      overconfidentCount++
    }
    // Low confidence (<50) but low error (<5")
    if (confidence < 50 && error < 5) {
      underconfidentCount++
    }
  }

  const overconfidentPercent = (overconfidentCount / totalPredictionsAnalyzed) * 100
  const underconfidentPercent = (underconfidentCount / totalPredictionsAnalyzed) * 100

  // Calculate confidence-error correlation
  const confidenceValues = examples.map(e => e.calibrated_confidence || e.raw_confidence || 50)
  const errorValues = examples.map(e => Math.abs(e.error_amount || 0))
  const confidenceErrorCorrelation = calculateCorrelation(confidenceValues, errorValues)

  // Calculate trust score effectiveness
  const trustScores = examples.map(e => e.trust_score).filter((t): t is number => t !== null)
  const trustScoreCorrelation = trustScores.length > 10 
    ? calculateCorrelation(trustScores, errorValues.slice(0, trustScores.length))
    : null

  // High vs low trust average error
  const highTrustExamples = examples.filter(e => e.trust_score !== null && e.trust_score >= 70)
  const lowTrustExamples = examples.filter(e => e.trust_score !== null && e.trust_score < 50)
  
  const highTrustAvgError = highTrustExamples.length > 0
    ? highTrustExamples.map(e => Math.abs(e.error_amount || 0)).reduce((a, b) => a + b, 0) / highTrustExamples.length
    : null
  const lowTrustAvgError = lowTrustExamples.length > 0
    ? lowTrustExamples.map(e => Math.abs(e.error_amount || 0)).reduce((a, b) => a + b, 0) / lowTrustExamples.length
    : null

  // Simple linear regression for calibration slope/intercept
  const { slope, intercept, r2 } = calculateLinearRegression(confidenceValues, errorValues)

  return {
    totalPredictionsAnalyzed,
    calibrationSlope: slope,
    calibrationIntercept: intercept,
    calibrationR2: r2,
    tierAccuracy,
    overconfidentPercent,
    underconfidentPercent,
    confidenceErrorCorrelation,
    trustScoreCorrelation,
    highTrustAvgError,
    lowTrustAvgError,
  }
}

function calculateCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 3) return 0

  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  const denominator = Math.sqrt(denomX * denomY)
  return denominator === 0 ? 0 : numerator / denominator
}

function calculateLinearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = Math.min(x.length, y.length)
  if (n < 3) return { slope: 0, intercept: 0, r2: 0 }

  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n

  let ssXY = 0
  let ssXX = 0
  let ssYY = 0
  let ssTot = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    ssXY += dx * dy
    ssXX += dx * dx
    ssYY += dy * dy
    ssTot += dy * dy
  }

  const slope = ssXX === 0 ? 0 : ssXY / ssXX
  const intercept = meanY - slope * meanX
  
  // Calculate R²
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept
    const residual = y[i] - predicted
    ssRes += residual * residual
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return { slope, intercept, r2 }
}

export async function getConfidenceCalibrationPoints(): Promise<ConfidenceCalibrationPoint[]> {
  const supabase = await createClient()

  const { data: examples } = await supabase
    .from('training_examples')
    .select('raw_confidence, calibrated_confidence, error_amount')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)
    .limit(1000)

  if (!examples || examples.length === 0) {
    return []
  }

  // Group by confidence buckets
  const buckets = [
    { label: '0-50%', min: 0, max: 50 },
    { label: '50-60%', min: 50, max: 60 },
    { label: '60-70%', min: 60, max: 70 },
    { label: '70-80%', min: 70, max: 80 },
    { label: '80-90%', min: 80, max: 90 },
    { label: '90-100%', min: 90, max: 101 },
  ]

  const points: ConfidenceCalibrationPoint[] = []

  for (const bucket of buckets) {
    const bucketExamples = examples.filter(e => {
      const conf = e.calibrated_confidence || e.raw_confidence || 50
      return conf >= bucket.min && conf < bucket.max
    })

    if (bucketExamples.length === 0) continue

    const rawConfs = bucketExamples.map(e => e.raw_confidence || 50)
    const calibratedConfs = bucketExamples.map(e => e.calibrated_confidence || e.raw_confidence || 50)
    const errors = bucketExamples.map(e => Math.abs(e.error_amount || 0))

    const avgRaw = rawConfs.reduce((a, b) => a + b, 0) / rawConfs.length
    const avgCalibrated = calibratedConfs.reduce((a, b) => a + b, 0) / calibratedConfs.length
    const actualMae = errors.reduce((a, b) => a + b, 0) / errors.length
    const within5 = errors.filter(e => e <= 5).length
    const within10 = errors.filter(e => e <= 10).length

    points.push({
      confidenceBucket: bucket.label,
      avgRawConfidence: avgRaw,
      avgCalibratedConfidence: avgCalibrated,
      actualMae,
      sampleCount: bucketExamples.length,
      within5InchesPercent: (within5 / bucketExamples.length) * 100,
      within10InchesPercent: (within10 / bucketExamples.length) * 100,
    })
  }

  return points
}
