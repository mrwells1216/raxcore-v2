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
  MeasurementCategory
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
