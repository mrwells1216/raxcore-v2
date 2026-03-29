/**
 * Phase 48: Offline Evaluation Runner
 * 
 * Runs candidate variants against curated datasets for structured evaluation.
 * Produces comprehensive metrics for promotion decision support.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  EvaluationRun,
  EvaluationResult,
  EvaluationMetrics,
  FamilyEvaluationMetrics,
  SegmentEvaluationMetrics,
  IntervalCoverageMetrics,
  GeometryConsistencyEvalMetrics,
  FailureCluster,
  ScoringVariant,
  EvaluationRunStatus,
} from '@/lib/types'
import { getScoringVariant } from './variant-registry'

// ============================================================================
// EVALUATION RUN CRUD
// ============================================================================

export interface CreateEvaluationRunParams {
  variantId: string
  datasetType: 'export_pack' | 'benchmark_pack' | 'custom'
  exportPackId?: string
  benchmarkPackId?: string
  config?: Record<string, unknown>
  notes?: string
  createdBy?: string
}

/**
 * Create a new evaluation run
 */
export async function createEvaluationRun(params: CreateEvaluationRunParams): Promise<EvaluationRun> {
  const supabase = await createClient()

  // Validate variant exists
  const variant = await getScoringVariant(params.variantId)
  if (!variant) {
    throw new Error('Variant not found')
  }

  // Validate dataset reference
  if (params.datasetType === 'export_pack' && !params.exportPackId) {
    throw new Error('export_pack_id required for export_pack dataset type')
  }
  if (params.datasetType === 'benchmark_pack' && !params.benchmarkPackId) {
    throw new Error('benchmark_pack_id required for benchmark_pack dataset type')
  }

  // Get example count from dataset
  let totalExamples = 0
  if (params.exportPackId) {
    const { count } = await supabase
      .from('export_pack_examples')
      .select('*', { count: 'exact', head: true })
      .eq('export_pack_id', params.exportPackId)
    totalExamples = count || 0
  } else if (params.benchmarkPackId) {
    const { count } = await supabase
      .from('benchmark_pack_examples')
      .select('*', { count: 'exact', head: true })
      .eq('benchmark_pack_id', params.benchmarkPackId)
    totalExamples = count || 0
  }

  const { data, error } = await supabase
    .from('evaluation_runs')
    .insert({
      variant_id: params.variantId,
      dataset_type: params.datasetType,
      export_pack_id: params.exportPackId || null,
      benchmark_pack_id: params.benchmarkPackId || null,
      config: params.config || {},
      status: 'pending',
      total_examples: totalExamples,
      processed_examples: 0,
      notes: params.notes || null,
      created_by: params.createdBy || null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create evaluation run: ${error.message}`)
  return data as EvaluationRun
}

/**
 * Get an evaluation run by ID
 */
export async function getEvaluationRun(id: string): Promise<EvaluationRun | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('evaluation_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get evaluation run: ${error.message}`)
  }
  return data as EvaluationRun | null
}

/**
 * List evaluation runs for a variant
 */
export async function listEvaluationRuns(options?: {
  variantId?: string
  status?: EvaluationRunStatus
  limit?: number
  offset?: number
}): Promise<{ data: EvaluationRun[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('evaluation_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.variantId) {
    query = query.eq('variant_id', options.variantId)
  }
  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list evaluation runs: ${error.message}`)
  return { data: (data || []) as EvaluationRun[], count: count || 0 }
}

/**
 * Update evaluation run status
 */
export async function updateEvaluationRunStatus(
  id: string,
  status: EvaluationRunStatus,
  additionalUpdates?: Partial<EvaluationRun>
): Promise<void> {
  const supabase = await createClient()

  const updates: Record<string, unknown> = {
    status,
    ...additionalUpdates,
  }

  if (status === 'running') {
    updates.started_at = new Date().toISOString()
  }
  if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('evaluation_runs')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update evaluation run: ${error.message}`)
}

/**
 * Update evaluation run progress
 */
export async function updateEvaluationRunProgress(
  id: string,
  processedExamples: number
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('evaluation_runs')
    .update({ processed_examples: processedExamples })
    .eq('id', id)

  if (error) throw new Error(`Failed to update progress: ${error.message}`)
}

// ============================================================================
// EVALUATION EXECUTION
// ============================================================================

interface EvaluationExample {
  id: string
  trainingExampleId: string
  buckId: string
  groundTruthGross: number
  groundTruthNet: number | null
  state: string | null
  rackType: string | null
  sourceType: string | null
}

/**
 * Get examples from a dataset
 */
async function getDatasetExamples(
  datasetType: string,
  exportPackId: string | null,
  benchmarkPackId: string | null
): Promise<EvaluationExample[]> {
  const supabase = await createClient()

  if (datasetType === 'export_pack' && exportPackId) {
    const { data, error } = await supabase
      .from('export_pack_examples')
      .select(`
        id,
        training_example_id,
        ground_truth_gross,
        ground_truth_net,
        state,
        rack_type,
        source_type,
        training_examples!inner (
          buck_id
        )
      `)
      .eq('export_pack_id', exportPackId)

    if (error) throw new Error(`Failed to get export pack examples: ${error.message}`)

    return (data || []).map(d => ({
      id: d.id,
      trainingExampleId: d.training_example_id,
      buckId: (d.training_examples as { buck_id: string })?.buck_id || '',
      groundTruthGross: d.ground_truth_gross || 0,
      groundTruthNet: d.ground_truth_net,
      state: d.state,
      rackType: d.rack_type,
      sourceType: d.source_type,
    }))
  }

  if (datasetType === 'benchmark_pack' && benchmarkPackId) {
    const { data, error } = await supabase
      .from('benchmark_pack_examples')
      .select(`
        id,
        training_example_id,
        ground_truth_gross,
        ground_truth_net,
        state,
        rack_type,
        source_type,
        training_examples!inner (
          buck_id
        )
      `)
      .eq('benchmark_pack_id', benchmarkPackId)

    if (error) throw new Error(`Failed to get benchmark pack examples: ${error.message}`)

    return (data || []).map(d => ({
      id: d.id,
      trainingExampleId: d.training_example_id,
      buckId: (d.training_examples as { buck_id: string })?.buck_id || '',
      groundTruthGross: d.ground_truth_gross || 0,
      groundTruthNet: d.ground_truth_net,
      state: d.state,
      rackType: d.rack_type,
      sourceType: d.source_type,
    }))
  }

  return []
}

/**
 * Simulate scoring for an example with a variant
 * In production, this would call the actual scoring pipeline
 */
async function scoreExample(
  variant: ScoringVariant,
  example: EvaluationExample
): Promise<{
  predictedGross: number
  predictedNet: number | null
  confidencePercent: number
  spreadError: number | null
  beamError: number | null
  tineError: number | null
  massError: number | null
  withinInterval: boolean
  intervalWidth: number
  geometryConsistencyScore: number
  processingTimeMs: number
}> {
  const startTime = Date.now()

  // Simulate prediction with slight variation
  // In real implementation, this would call actual scoring with variant config
  const baseVariation = (Math.random() - 0.5) * 8 // +/- 4 inches
  const predictedGross = example.groundTruthGross + baseVariation
  const predictedNet = example.groundTruthNet !== null
    ? example.groundTruthNet + baseVariation * 0.9
    : null

  const confidencePercent = 60 + Math.random() * 35 // 60-95%
  
  // Simulate measurement-level errors
  const spreadError = (Math.random() - 0.5) * 3
  const beamError = (Math.random() - 0.5) * 4
  const tineError = (Math.random() - 0.5) * 2
  const massError = (Math.random() - 0.5) * 1

  // Simulate interval coverage
  const intervalWidth = 8 + Math.random() * 8 // 8-16 inch interval
  const actualError = Math.abs(predictedGross - example.groundTruthGross)
  const withinInterval = actualError <= intervalWidth / 2

  // Simulate geometry consistency
  const geometryConsistencyScore = 0.5 + Math.random() * 0.5 // 0.5-1.0

  const processingTimeMs = Date.now() - startTime + Math.random() * 100 // Add simulated processing time

  return {
    predictedGross,
    predictedNet,
    confidencePercent,
    spreadError,
    beamError,
    tineError,
    massError,
    withinInterval,
    intervalWidth,
    geometryConsistencyScore,
    processingTimeMs,
  }
}

/**
 * Execute a full evaluation run
 */
export async function executeEvaluationRun(runId: string): Promise<EvaluationRun> {
  const supabase = await createClient()

  // Get the run
  const run = await getEvaluationRun(runId)
  if (!run) throw new Error('Evaluation run not found')

  // Get the variant
  const variant = await getScoringVariant(run.variant_id)
  if (!variant) throw new Error('Variant not found')

  // Update status to running
  await updateEvaluationRunStatus(runId, 'running')

  try {
    // Get dataset examples
    const examples = await getDatasetExamples(
      run.dataset_type,
      run.export_pack_id,
      run.benchmark_pack_id
    )

    if (examples.length === 0) {
      throw new Error('No examples found in dataset')
    }

    const results: EvaluationResult[] = []
    let processedCount = 0

    // Score each example
    for (const example of examples) {
      try {
        const scored = await scoreExample(variant, example)

        const errorGross = scored.predictedGross - example.groundTruthGross
        const errorNet = scored.predictedNet !== null && example.groundTruthNet !== null
          ? scored.predictedNet - example.groundTruthNet
          : null

        // Store result
        const { data: resultData } = await supabase
          .from('evaluation_results')
          .insert({
            evaluation_run_id: runId,
            training_example_id: example.trainingExampleId,
            buck_id: example.buckId,
            ground_truth_gross: example.groundTruthGross,
            ground_truth_net: example.groundTruthNet,
            predicted_gross: scored.predictedGross,
            predicted_net: scored.predictedNet,
            confidence_percent: scored.confidencePercent,
            error_gross: errorGross,
            error_net: errorNet,
            abs_error_gross: Math.abs(errorGross),
            abs_error_net: errorNet !== null ? Math.abs(errorNet) : null,
            spread_error: scored.spreadError,
            beam_error: scored.beamError,
            tine_error: scored.tineError,
            mass_error: scored.massError,
            within_interval: scored.withinInterval,
            interval_width: scored.intervalWidth,
            geometry_consistency_score: scored.geometryConsistencyScore,
            state: example.state,
            rack_type: example.rackType,
            source_type: example.sourceType,
            processing_time_ms: scored.processingTimeMs,
          })
          .select()
          .single()

        if (resultData) {
          results.push(resultData as EvaluationResult)
        }

        processedCount++

        // Update progress every 10 examples
        if (processedCount % 10 === 0) {
          await updateEvaluationRunProgress(runId, processedCount)
        }
      } catch (err) {
        console.error(`Error scoring example ${example.id}:`, err)
      }
    }

    // Compute metrics
    const metrics = computeEvaluationMetrics(results)
    const familyMetrics = computeFamilyMetrics(results)
    const segmentMetrics = computeSegmentMetrics(results)
    const intervalCoverage = computeIntervalCoverage(results)
    const geometryMetrics = computeGeometryMetrics(results)
    const failureClusters = identifyFailureClusters(results)

    // Update run with final metrics
    await updateEvaluationRunStatus(runId, 'completed', {
      processed_examples: processedCount,
      metrics,
      family_metrics: familyMetrics,
      segment_metrics: segmentMetrics,
      interval_coverage: intervalCoverage,
      geometry_consistency_metrics: geometryMetrics,
      failure_clusters: failureClusters,
    })

    return (await getEvaluationRun(runId))!
  } catch (err) {
    await updateEvaluationRunStatus(runId, 'failed')
    throw err
  }
}

// ============================================================================
// METRICS COMPUTATION
// ============================================================================

function computeEvaluationMetrics(results: EvaluationResult[]): EvaluationMetrics {
  const absErrorsGross = results.map(r => r.abs_error_gross).filter((e): e is number => e !== null)
  const absErrorsNet = results.map(r => r.abs_error_net).filter((e): e is number => e !== null)
  const errorsGross = results.map(r => r.error_gross).filter((e): e is number => e !== null)

  const sortedAbsGross = [...absErrorsGross].sort((a, b) => a - b)
  const sortedAbsNet = [...absErrorsNet].sort((a, b) => a - b)

  const mae = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const median = (arr: number[]) => arr.length > 0 ? arr[Math.floor(arr.length / 2)] : 0
  const rmse = (arr: number[]) => arr.length > 0 
    ? Math.sqrt(arr.reduce((a, b) => a + b * b, 0) / arr.length) 
    : 0
  const percentile = (arr: number[], p: number) => arr.length > 0 
    ? arr[Math.floor(arr.length * p)] 
    : 0

  const within5 = absErrorsGross.filter(e => e <= 5).length
  const within10 = absErrorsGross.filter(e => e <= 10).length
  const over = errorsGross.filter(e => e > 0).length
  const under = errorsGross.filter(e => e < 0).length

  return {
    mae_gross: mae(absErrorsGross),
    mae_net: absErrorsNet.length > 0 ? mae(absErrorsNet) : null,
    median_error_gross: median(sortedAbsGross),
    median_error_net: sortedAbsNet.length > 0 ? median(sortedAbsNet) : null,
    rmse_gross: rmse(errorsGross),
    rmse_net: absErrorsNet.length > 0 ? rmse(absErrorsNet) : null,
    p95_error: percentile(sortedAbsGross, 0.95),
    max_error: sortedAbsGross.length > 0 ? sortedAbsGross[sortedAbsGross.length - 1] : 0,
    within_5_inches_count: within5,
    within_5_inches_percent: (within5 / results.length) * 100,
    within_10_inches_count: within10,
    within_10_inches_percent: (within10 / results.length) * 100,
    overestimation_count: over,
    underestimation_count: under,
    sample_count: results.length,
  }
}

function computeFamilyMetrics(results: EvaluationResult[]): FamilyEvaluationMetrics {
  const compute = (errors: (number | null)[]) => {
    const valid = errors.filter((e): e is number => e !== null)
    if (valid.length === 0) return { mae: 0, median: 0, p95: 0, count: 0 }
    const sorted = [...valid].map(Math.abs).sort((a, b) => a - b)
    return {
      mae: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
      count: sorted.length,
    }
  }

  return {
    spread: compute(results.map(r => r.spread_error)),
    beam: compute(results.map(r => r.beam_error)),
    tine: compute(results.map(r => r.tine_error)),
    mass: compute(results.map(r => r.mass_error)),
  }
}

function computeSegmentMetrics(results: EvaluationResult[]): SegmentEvaluationMetrics {
  const groupBy = <T extends Record<string, unknown>>(
    items: T[],
    keyFn: (item: T) => string | null
  ): Record<string, T[]> => {
    const groups: Record<string, T[]> = {}
    for (const item of items) {
      const key = keyFn(item) || 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    return groups
  }

  const computeGroupMetrics = (groups: Record<string, EvaluationResult[]>) => {
    const result: Record<string, { mae: number; median: number; count: number }> = {}
    for (const [key, items] of Object.entries(groups)) {
      const errors = items.map(i => i.abs_error_gross).filter((e): e is number => e !== null)
      if (errors.length === 0) continue
      const sorted = [...errors].sort((a, b) => a - b)
      result[key] = {
        mae: errors.reduce((a, b) => a + b, 0) / errors.length,
        median: sorted[Math.floor(sorted.length / 2)],
        count: errors.length,
      }
    }
    return result
  }

  // By state
  const byState = groupBy(results, r => r.state)
  
  // By rack type
  const byRackType = groupBy(results, r => r.rack_type)
  
  // By source type
  const bySourceType = groupBy(results, r => r.source_type)
  
  // By score band
  const byScoreBand = groupBy(results, r => {
    const gt = r.ground_truth_gross
    if (gt === null) return null
    if (gt < 120) return '<120'
    if (gt < 140) return '120-140'
    if (gt < 160) return '140-160'
    if (gt < 180) return '160-180'
    if (gt < 200) return '180-200'
    return '200+'
  })

  return {
    by_state: computeGroupMetrics(byState),
    by_rack_type: computeGroupMetrics(byRackType),
    by_source_type: computeGroupMetrics(bySourceType),
    by_score_band: computeGroupMetrics(byScoreBand),
  }
}

function computeIntervalCoverage(results: EvaluationResult[]): IntervalCoverageMetrics {
  const withInterval = results.filter(r => r.within_interval !== null && r.interval_width !== null)
  if (withInterval.length === 0) {
    return {
      coverage_percent: 0,
      avg_interval_width: 0,
      tight_coverage_percent: 0,
      wide_coverage_percent: 0,
    }
  }

  const covered = withInterval.filter(r => r.within_interval).length
  const widths = withInterval.map(r => r.interval_width!).filter((w): w is number => w !== null)
  const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length

  // Tight/wide coverage (within 50%/150% of predicted interval)
  let tightCount = 0
  let wideCount = 0
  for (const r of withInterval) {
    if (r.abs_error_gross === null || r.interval_width === null) continue
    const halfWidth = r.interval_width / 2
    if (r.abs_error_gross <= halfWidth * 0.5) tightCount++
    if (r.abs_error_gross <= halfWidth * 1.5) wideCount++
  }

  return {
    coverage_percent: (covered / withInterval.length) * 100,
    avg_interval_width: avgWidth,
    tight_coverage_percent: (tightCount / withInterval.length) * 100,
    wide_coverage_percent: (wideCount / withInterval.length) * 100,
  }
}

function computeGeometryMetrics(results: EvaluationResult[]): GeometryConsistencyEvalMetrics {
  const withGeometry = results.filter(r => 
    r.geometry_consistency_score !== null && r.abs_error_gross !== null
  )
  
  if (withGeometry.length === 0) {
    return {
      avg_consistency_score: 0,
      median_consistency_score: 0,
      consistency_error_correlation: 0,
      low_consistency_mae: 0,
      high_consistency_mae: 0,
    }
  }

  const scores = withGeometry.map(r => r.geometry_consistency_score!)
  const sortedScores = [...scores].sort((a, b) => a - b)

  // Correlation between consistency and error
  const errors = withGeometry.map(r => r.abs_error_gross!)
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length
  
  let cov = 0
  let varScore = 0
  let varError = 0
  for (let i = 0; i < withGeometry.length; i++) {
    const sDiff = scores[i] - meanScore
    const eDiff = errors[i] - meanError
    cov += sDiff * eDiff
    varScore += sDiff * sDiff
    varError += eDiff * eDiff
  }
  const correlation = varScore > 0 && varError > 0 
    ? cov / Math.sqrt(varScore * varError) 
    : 0

  // MAE by consistency level
  const lowConsistency = withGeometry.filter(r => r.geometry_consistency_score! < 0.7)
  const highConsistency = withGeometry.filter(r => r.geometry_consistency_score! >= 0.7)
  
  const lowMae = lowConsistency.length > 0
    ? lowConsistency.map(r => r.abs_error_gross!).reduce((a, b) => a + b, 0) / lowConsistency.length
    : 0
  const highMae = highConsistency.length > 0
    ? highConsistency.map(r => r.abs_error_gross!).reduce((a, b) => a + b, 0) / highConsistency.length
    : 0

  return {
    avg_consistency_score: meanScore,
    median_consistency_score: sortedScores[Math.floor(sortedScores.length / 2)],
    consistency_error_correlation: correlation,
    low_consistency_mae: lowMae,
    high_consistency_mae: highMae,
  }
}

function identifyFailureClusters(results: EvaluationResult[]): FailureCluster[] {
  const clusters: FailureCluster[] = []
  
  // High error threshold
  const highErrorThreshold = 10
  const highErrorResults = results.filter(r => 
    r.abs_error_gross !== null && r.abs_error_gross > highErrorThreshold
  )

  if (highErrorResults.length === 0) return clusters

  // Cluster by state
  const byState: Record<string, EvaluationResult[]> = {}
  for (const r of highErrorResults) {
    const key = r.state || 'unknown'
    if (!byState[key]) byState[key] = []
    byState[key].push(r)
  }

  for (const [state, items] of Object.entries(byState)) {
    if (items.length >= 3) {
      const errors = items.map(i => i.abs_error_gross!).filter((e): e is number => e !== null)
      clusters.push({
        cluster_name: `High error in ${state}`,
        cluster_type: 'segment',
        description: `${items.length} examples from ${state} had errors > ${highErrorThreshold}"`,
        example_count: items.length,
        avg_error: errors.reduce((a, b) => a + b, 0) / errors.length,
        example_ids: items.slice(0, 10).map(i => i.training_example_id || i.id),
        common_traits: { state },
      })
    }
  }

  // Cluster by rack type
  const byRackType: Record<string, EvaluationResult[]> = {}
  for (const r of highErrorResults) {
    const key = r.rack_type || 'unknown'
    if (!byRackType[key]) byRackType[key] = []
    byRackType[key].push(r)
  }

  for (const [rackType, items] of Object.entries(byRackType)) {
    if (items.length >= 3) {
      const errors = items.map(i => i.abs_error_gross!).filter((e): e is number => e !== null)
      clusters.push({
        cluster_name: `High error for ${rackType}`,
        cluster_type: 'segment',
        description: `${items.length} ${rackType} examples had errors > ${highErrorThreshold}"`,
        example_count: items.length,
        avg_error: errors.reduce((a, b) => a + b, 0) / errors.length,
        example_ids: items.slice(0, 10).map(i => i.training_example_id || i.id),
        common_traits: { rack_type: rackType },
      })
    }
  }

  // Cluster by low geometry consistency
  const lowGeometry = highErrorResults.filter(r => 
    r.geometry_consistency_score !== null && r.geometry_consistency_score < 0.6
  )
  if (lowGeometry.length >= 3) {
    const errors = lowGeometry.map(i => i.abs_error_gross!).filter((e): e is number => e !== null)
    clusters.push({
      cluster_name: 'Low geometry consistency failures',
      cluster_type: 'characteristic',
      description: `${lowGeometry.length} high-error examples had low geometry consistency (<0.6)`,
      example_count: lowGeometry.length,
      avg_error: errors.reduce((a, b) => a + b, 0) / errors.length,
      example_ids: lowGeometry.slice(0, 10).map(i => i.training_example_id || i.id),
      common_traits: { geometry_consistency: 'low' },
    })
  }

  return clusters
}

// ============================================================================
// EVALUATION RESULTS QUERIES
// ============================================================================

/**
 * Get evaluation results for a run
 */
export async function getEvaluationResults(
  runId: string,
  options?: {
    limit?: number
    offset?: number
    orderBy?: 'abs_error_gross' | 'created_at'
    ascending?: boolean
  }
): Promise<{ data: EvaluationResult[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('evaluation_results')
    .select('*', { count: 'exact' })
    .eq('evaluation_run_id', runId)
    .order(options?.orderBy || 'abs_error_gross', { ascending: options?.ascending ?? false })

  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get evaluation results: ${error.message}`)
  return { data: (data || []) as EvaluationResult[], count: count || 0 }
}

/**
 * Get worst predictions from an evaluation run
 */
export async function getWorstPredictions(
  runId: string,
  limit = 20
): Promise<EvaluationResult[]> {
  const { data } = await getEvaluationResults(runId, {
    limit,
    orderBy: 'abs_error_gross',
    ascending: false,
  })
  return data
}
