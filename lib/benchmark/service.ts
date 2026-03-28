/**
 * Phase 26: Benchmark Pack Service
 * 
 * Manages benchmark packs, execution, guardrail evaluation, and promotion decisions.
 * Integrates with existing bulk validation infrastructure.
 */

import { createClient } from '@/lib/supabase/server'
import { createBulkValidationRun } from '@/lib/validation/bulk-service'
import type {
  BenchmarkPack,
  BenchmarkPackInput,
  BenchmarkPackExample,
  BenchmarkRun,
  BenchmarkRunWithDetails,
  BenchmarkRunInput,
  PromotionDecision,
  PromotionDecisionInput,
  PromotionDecisionWithDetails,
  RegressionGuardrailConfig,
  GuardrailEvaluationResult,
  GuardrailCheckResult,
  PromotionReadinessSummary,
  ModelBenchmarkMetrics,
  ModelComparisonSummary,
  PromotionMetricsSnapshot,
  DEFAULT_GUARDRAIL_CONFIG,
} from '@/lib/types'

// ============================================================================
// BENCHMARK PACK CRUD
// ============================================================================

export async function createBenchmarkPack(
  input: BenchmarkPackInput,
  createdBy?: string
): Promise<BenchmarkPack> {
  const supabase = await createClient()

  // Create the pack
  const { data: pack, error: packError } = await supabase
    .from('benchmark_packs')
    .insert({
      name: input.name,
      description: input.description || null,
      tags: input.tags || [],
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (packError) throw new Error(`Failed to create benchmark pack: ${packError.message}`)

  // Fetch training examples to get ground truth data
  if (input.example_ids.length > 0) {
    const { data: examples, error: exampleError } = await supabase
      .from('training_examples')
      .select('id, gross_score, net_score, state, rack_type, source_type')
      .in('id', input.example_ids)

    if (exampleError) throw new Error(`Failed to fetch training examples: ${exampleError.message}`)

    // Insert pack examples with ground truth data
    const packExamples = (examples || []).map(ex => ({
      benchmark_pack_id: pack.id,
      training_example_id: ex.id,
      ground_truth_gross: ex.gross_score,
      ground_truth_net: ex.net_score,
      state: ex.state,
      rack_type: ex.rack_type,
      source_type: ex.source_type,
    }))

    if (packExamples.length > 0) {
      const { error: insertError } = await supabase
        .from('benchmark_pack_examples')
        .insert(packExamples)

      if (insertError) throw new Error(`Failed to insert benchmark examples: ${insertError.message}`)
    }
  }

  // Return pack with updated example count
  const { data: updatedPack } = await supabase
    .from('benchmark_packs')
    .select('*')
    .eq('id', pack.id)
    .single()

  return updatedPack || pack
}

export async function getBenchmarkPack(id: string): Promise<BenchmarkPack | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('benchmark_packs')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get benchmark pack: ${error.message}`)
  }
  return data
}

export async function listBenchmarkPacks(options?: {
  includeArchived?: boolean
  tags?: string[]
  limit?: number
  offset?: number
}): Promise<{ data: BenchmarkPack[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('benchmark_packs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false)
  }

  if (options?.tags && options.tags.length > 0) {
    query = query.overlaps('tags', options.tags)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list benchmark packs: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

export async function updateBenchmarkPack(
  id: string,
  updates: Partial<Pick<BenchmarkPack, 'name' | 'description' | 'tags' | 'is_archived'>>
): Promise<BenchmarkPack> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('benchmark_packs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update benchmark pack: ${error.message}`)
  return data
}

export async function archiveBenchmarkPack(id: string): Promise<void> {
  await updateBenchmarkPack(id, { is_archived: true })
}

export async function deleteBenchmarkPack(id: string): Promise<void> {
  const supabase = await createClient()

  // Check if pack has any runs
  const { count } = await supabase
    .from('benchmark_runs')
    .select('*', { count: 'exact', head: true })
    .eq('benchmark_pack_id', id)

  if (count && count > 0) {
    throw new Error('Cannot delete benchmark pack with existing runs. Archive it instead.')
  }

  const { error } = await supabase
    .from('benchmark_packs')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete benchmark pack: ${error.message}`)
}

// ============================================================================
// BENCHMARK PACK EXAMPLES
// ============================================================================

export async function getBenchmarkPackExamples(
  packId: string
): Promise<BenchmarkPackExample[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('benchmark_pack_examples')
    .select('*')
    .eq('benchmark_pack_id', packId)
    .order('added_at', { ascending: true })

  if (error) throw new Error(`Failed to get benchmark pack examples: ${error.message}`)
  return data || []
}

export async function addExamplesToBenchmarkPack(
  packId: string,
  exampleIds: string[]
): Promise<number> {
  const supabase = await createClient()

  // Fetch training examples data
  const { data: examples, error: fetchError } = await supabase
    .from('training_examples')
    .select('id, gross_score, net_score, state, rack_type, source_type')
    .in('id', exampleIds)

  if (fetchError) throw new Error(`Failed to fetch training examples: ${fetchError.message}`)

  // Get existing example IDs to avoid duplicates
  const { data: existing } = await supabase
    .from('benchmark_pack_examples')
    .select('training_example_id')
    .eq('benchmark_pack_id', packId)

  const existingIds = new Set((existing || []).map(e => e.training_example_id))
  
  const newExamples = (examples || [])
    .filter(ex => !existingIds.has(ex.id))
    .map(ex => ({
      benchmark_pack_id: packId,
      training_example_id: ex.id,
      ground_truth_gross: ex.gross_score,
      ground_truth_net: ex.net_score,
      state: ex.state,
      rack_type: ex.rack_type,
      source_type: ex.source_type,
    }))

  if (newExamples.length > 0) {
    const { error: insertError } = await supabase
      .from('benchmark_pack_examples')
      .insert(newExamples)

    if (insertError) throw new Error(`Failed to add examples: ${insertError.message}`)
  }

  return newExamples.length
}

export async function removeExamplesFromBenchmarkPack(
  packId: string,
  exampleIds: string[]
): Promise<number> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('benchmark_pack_examples')
    .delete()
    .eq('benchmark_pack_id', packId)
    .in('training_example_id', exampleIds)
    .select()

  if (error) throw new Error(`Failed to remove examples: ${error.message}`)
  return data?.length || 0
}

// ============================================================================
// BENCHMARK RUN EXECUTION
// ============================================================================

export async function createBenchmarkRun(
  input: BenchmarkRunInput
): Promise<BenchmarkRun> {
  const supabase = await createClient()

  // Get the benchmark pack and its examples
  const pack = await getBenchmarkPack(input.benchmark_pack_id)
  if (!pack) throw new Error('Benchmark pack not found')

  const examples = await getBenchmarkPackExamples(input.benchmark_pack_id)
  if (examples.length === 0) throw new Error('Benchmark pack has no examples')

  // Determine models to compare
  const activeModelId = input.active_model_version_id || await getActiveModelVersionId()
  const candidateModelId = input.candidate_model_version_id

  // Build run name
  const runName = candidateModelId 
    ? `Benchmark: ${pack.name} (Active vs Candidate)`
    : `Benchmark: ${pack.name} (Single Model)`

  // Create the bulk validation run with snapshotted example IDs
  const bulkRun = await createBulkValidationRun({
    runName,
    runType: candidateModelId ? 'model_comparison' : 'single_model',
    primaryModelVersionId: candidateModelId || activeModelId,
    comparisonModelVersionIds: candidateModelId && activeModelId ? [activeModelId] : [],
    primaryCalibrationProfileId: input.candidate_calibration_profile_id || input.active_calibration_profile_id,
    comparisonCalibrationProfileIds: input.active_calibration_profile_id ? [input.active_calibration_profile_id] : [],
    exampleIds: examples.map(e => e.training_example_id),
  })

  // Create the benchmark run record
  const { data: benchmarkRun, error } = await supabase
    .from('benchmark_runs')
    .insert({
      benchmark_pack_id: input.benchmark_pack_id,
      bulk_validation_run_id: bulkRun.id,
      run_purpose: input.run_purpose || 'ad_hoc',
      run_notes: input.run_notes || null,
      active_model_version_id: activeModelId || null,
      candidate_model_version_id: candidateModelId || null,
      active_calibration_profile_id: input.active_calibration_profile_id || null,
      candidate_calibration_profile_id: input.candidate_calibration_profile_id || null,
      guardrail_config: input.guardrail_config || DEFAULT_GUARDRAIL_CONFIG,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create benchmark run: ${error.message}`)
  return benchmarkRun
}

export async function getBenchmarkRun(id: string): Promise<BenchmarkRunWithDetails | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('benchmark_runs_with_details')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get benchmark run: ${error.message}`)
  }
  return data
}

export async function listBenchmarkRuns(options?: {
  packId?: string
  purpose?: string
  limit?: number
  offset?: number
}): Promise<{ data: BenchmarkRunWithDetails[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('benchmark_runs_with_details')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.packId) {
    query = query.eq('benchmark_pack_id', options.packId)
  }

  if (options?.purpose) {
    query = query.eq('run_purpose', options.purpose)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list benchmark runs: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

// ============================================================================
// GUARDRAIL EVALUATION
// ============================================================================

export async function evaluateGuardrails(
  benchmarkRunId: string
): Promise<GuardrailEvaluationResult> {
  const supabase = await createClient()

  // Get the benchmark run with its config
  const run = await getBenchmarkRun(benchmarkRunId)
  if (!run) throw new Error('Benchmark run not found')

  const config = (run.guardrail_config || DEFAULT_GUARDRAIL_CONFIG) as RegressionGuardrailConfig

  // Get bulk validation results for this run
  const { data: results, error } = await supabase
    .from('bulk_validation_results')
    .select('*')
    .eq('bulk_run_id', run.bulk_validation_run_id)

  if (error) throw new Error(`Failed to fetch validation results: ${error.message}`)
  if (!results || results.length === 0) {
    return {
      overall_passed: false,
      critical_failures: 1,
      warning_failures: 0,
      checks: [{
        name: 'Results Available',
        description: 'Validation results exist for evaluation',
        passed: false,
        threshold: 1,
        actual: 0,
        unit: 'results',
        severity: 'critical',
      }],
      subgroup_results: [],
      summary: 'No validation results available for guardrail evaluation',
    }
  }

  // Calculate metrics for active and candidate models
  const activeMetrics = await calculateModelMetrics(results, run.active_model_version_id)
  const candidateMetrics = await calculateModelMetrics(results, run.candidate_model_version_id || run.active_model_version_id)

  // Run guardrail checks
  const checks: GuardrailCheckResult[] = []

  // Check 1: Candidate average gross error
  checks.push({
    name: 'Average Gross Error',
    description: 'Candidate model average gross error within threshold',
    passed: candidateMetrics.avg_gross_error <= config.max_avg_gross_error_inches,
    threshold: config.max_avg_gross_error_inches,
    actual: candidateMetrics.avg_gross_error,
    unit: 'inches',
    severity: 'critical',
  })

  // Check 2: Candidate average net error (if configured)
  if (config.max_avg_net_error_inches !== null && candidateMetrics.avg_net_error !== null) {
    checks.push({
      name: 'Average Net Error',
      description: 'Candidate model average net error within threshold',
      passed: candidateMetrics.avg_net_error <= config.max_avg_net_error_inches,
      threshold: config.max_avg_net_error_inches,
      actual: candidateMetrics.avg_net_error,
      unit: 'inches',
      severity: 'critical',
    })
  }

  // Check 3: Regression vs active (absolute)
  const regressionInches = candidateMetrics.avg_gross_error - activeMetrics.avg_gross_error
  checks.push({
    name: 'Regression vs Active (Absolute)',
    description: 'Candidate does not regress more than threshold vs active model',
    passed: regressionInches <= config.max_regression_vs_active_inches,
    threshold: config.max_regression_vs_active_inches,
    actual: regressionInches,
    unit: 'inches',
    severity: 'critical',
  })

  // Check 4: Regression vs active (percentage)
  const regressionPercent = activeMetrics.avg_gross_error > 0
    ? ((candidateMetrics.avg_gross_error - activeMetrics.avg_gross_error) / activeMetrics.avg_gross_error) * 100
    : 0
  checks.push({
    name: 'Regression vs Active (Percent)',
    description: 'Candidate does not regress more than threshold % vs active model',
    passed: regressionPercent <= config.max_regression_vs_active_percent,
    threshold: config.max_regression_vs_active_percent,
    actual: regressionPercent,
    unit: '%',
    severity: 'warning',
  })

  // Check 5: Within 5 inches accuracy
  checks.push({
    name: 'Accuracy (5 inches)',
    description: 'Percentage of predictions within 5 inches',
    passed: candidateMetrics.within_5_inches_percent >= config.min_within_5_inches_percent,
    threshold: config.min_within_5_inches_percent,
    actual: candidateMetrics.within_5_inches_percent,
    unit: '%',
    severity: 'critical',
  })

  // Check 6: Within 10 inches accuracy
  checks.push({
    name: 'Accuracy (10 inches)',
    description: 'Percentage of predictions within 10 inches',
    passed: candidateMetrics.within_10_inches_percent >= config.min_within_10_inches_percent,
    threshold: config.min_within_10_inches_percent,
    actual: candidateMetrics.within_10_inches_percent,
    unit: '%',
    severity: 'warning',
  })

  // Check 7: Subgroup regressions
  const subgroupResults = await evaluateSubgroupRegressions(
    results,
    run.active_model_version_id,
    run.candidate_model_version_id || run.active_model_version_id,
    config
  )

  const subgroupFailures = subgroupResults.filter(s => !s.passed)
  if (config.subgroups_to_check.length > 0) {
    checks.push({
      name: 'Subgroup Regression',
      description: `No subgroup regresses more than ${config.max_subgroup_regression_inches} inches`,
      passed: subgroupFailures.length === 0,
      threshold: config.max_subgroup_regression_inches,
      actual: subgroupFailures.length > 0 ? Math.max(...subgroupFailures.map(s => s.regression_inches)) : 0,
      unit: 'inches',
      severity: 'warning',
    })
  }

  // Compute overall result
  const criticalFailures = checks.filter(c => !c.passed && c.severity === 'critical').length
  const warningFailures = checks.filter(c => !c.passed && c.severity === 'warning').length
  const overallPassed = criticalFailures === 0

  const result: GuardrailEvaluationResult = {
    overall_passed: overallPassed,
    critical_failures: criticalFailures,
    warning_failures: warningFailures,
    checks,
    subgroup_results: subgroupResults,
    summary: overallPassed
      ? warningFailures > 0
        ? `All critical guardrails passed with ${warningFailures} warning(s)`
        : 'All guardrails passed'
      : `${criticalFailures} critical guardrail(s) failed`,
  }

  // Save the evaluation result
  await supabase
    .from('benchmark_runs')
    .update({
      guardrail_results: result,
      all_guardrails_passed: overallPassed,
    })
    .eq('id', benchmarkRunId)

  return result
}

async function calculateModelMetrics(
  results: Array<{ 
    model_version_id: string | null
    gross_error: number | null
    net_error: number | null
  }>,
  modelVersionId: string | null
): Promise<ModelBenchmarkMetrics> {
  const modelResults = results.filter(r => r.model_version_id === modelVersionId)
  
  if (modelResults.length === 0) {
    return {
      avg_gross_error: 0,
      avg_net_error: null,
      median_gross_error: 0,
      median_net_error: null,
      within_5_inches_count: 0,
      within_5_inches_percent: 0,
      within_10_inches_count: 0,
      within_10_inches_percent: 0,
      overestimation_count: 0,
      underestimation_count: 0,
      sample_count: 0,
    }
  }

  const grossErrors = modelResults.map(r => Math.abs(r.gross_error || 0))
  const netErrors = modelResults.map(r => r.net_error).filter((e): e is number => e !== null)

  const sortedGross = [...grossErrors].sort((a, b) => a - b)
  const sortedNet = [...netErrors].sort((a, b) => a - b)

  const avgGross = grossErrors.reduce((a, b) => a + b, 0) / grossErrors.length
  const avgNet = netErrors.length > 0 ? netErrors.reduce((a, b) => a + Math.abs(b), 0) / netErrors.length : null

  const medianGross = sortedGross[Math.floor(sortedGross.length / 2)]
  const medianNet = sortedNet.length > 0 ? sortedNet[Math.floor(sortedNet.length / 2)] : null

  const within5 = grossErrors.filter(e => e <= 5).length
  const within10 = grossErrors.filter(e => e <= 10).length

  const overestimations = modelResults.filter(r => (r.gross_error || 0) > 0).length
  const underestimations = modelResults.filter(r => (r.gross_error || 0) < 0).length

  return {
    avg_gross_error: avgGross,
    avg_net_error: avgNet,
    median_gross_error: medianGross,
    median_net_error: medianNet,
    within_5_inches_count: within5,
    within_5_inches_percent: (within5 / modelResults.length) * 100,
    within_10_inches_count: within10,
    within_10_inches_percent: (within10 / modelResults.length) * 100,
    overestimation_count: overestimations,
    underestimation_count: underestimations,
    sample_count: modelResults.length,
  }
}

async function evaluateSubgroupRegressions(
  results: Array<{
    model_version_id: string | null
    gross_error: number | null
    training_example?: {
      state?: string | null
      rack_type?: string | null
      source_type?: string | null
    }
  }>,
  activeModelId: string | null,
  candidateModelId: string | null,
  config: RegressionGuardrailConfig
): Promise<GuardrailEvaluationResult['subgroup_results']> {
  const subgroupResults: GuardrailEvaluationResult['subgroup_results'] = []

  for (const subgroupType of config.subgroups_to_check) {
    // Group results by subgroup value
    const groupedActive = new Map<string, number[]>()
    const groupedCandidate = new Map<string, number[]>()

    for (const result of results) {
      const subgroupValue = result.training_example?.[subgroupType] || 'unknown'
      const error = Math.abs(result.gross_error || 0)

      if (result.model_version_id === activeModelId) {
        const existing = groupedActive.get(subgroupValue) || []
        existing.push(error)
        groupedActive.set(subgroupValue, existing)
      } else if (result.model_version_id === candidateModelId) {
        const existing = groupedCandidate.get(subgroupValue) || []
        existing.push(error)
        groupedCandidate.set(subgroupValue, existing)
      }
    }

    // Calculate regression for each subgroup
    for (const [value, candidateErrors] of groupedCandidate) {
      const activeErrors = groupedActive.get(value) || []
      
      if (activeErrors.length === 0 || candidateErrors.length === 0) continue

      const activeMae = activeErrors.reduce((a, b) => a + b, 0) / activeErrors.length
      const candidateMae = candidateErrors.reduce((a, b) => a + b, 0) / candidateErrors.length
      const regression = candidateMae - activeMae

      subgroupResults.push({
        subgroup_type: subgroupType,
        subgroup_value: value,
        passed: regression <= config.max_subgroup_regression_inches,
        active_mae: activeMae,
        candidate_mae: candidateMae,
        regression_inches: regression,
      })
    }
  }

  return subgroupResults
}

// ============================================================================
// PROMOTION DECISIONS
// ============================================================================

export async function createPromotionDecision(
  input: PromotionDecisionInput
): Promise<PromotionDecision> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('promotion_decisions')
    .insert({
      benchmark_run_id: input.benchmark_run_id || null,
      decision: input.decision,
      decision_reason: input.decision_reason,
      decision_notes: input.decision_notes || null,
      candidate_model_version_id: input.candidate_model_version_id || null,
      candidate_calibration_profile_id: input.candidate_calibration_profile_id || null,
      active_model_version_id: input.active_model_version_id || null,
      active_calibration_profile_id: input.active_calibration_profile_id || null,
      metrics_snapshot: input.metrics_snapshot || null,
      guardrail_results: input.guardrail_results || null,
      decided_by: input.decided_by || null,
      decided_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create promotion decision: ${error.message}`)
  return data
}

export async function getPromotionDecision(id: string): Promise<PromotionDecisionWithDetails | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('promotion_decisions_with_details')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get promotion decision: ${error.message}`)
  }
  return data
}

export async function listPromotionDecisions(options?: {
  decision?: string
  modelVersionId?: string
  limit?: number
  offset?: number
}): Promise<{ data: PromotionDecisionWithDetails[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('promotion_decisions_with_details')
    .select('*', { count: 'exact' })
    .order('decided_at', { ascending: false })

  if (options?.decision) {
    query = query.eq('decision', options.decision)
  }

  if (options?.modelVersionId) {
    query = query.or(`candidate_model_version_id.eq.${options.modelVersionId},active_model_version_id.eq.${options.modelVersionId}`)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list promotion decisions: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

// ============================================================================
// PROMOTION READINESS
// ============================================================================

export async function getPromotionReadiness(
  benchmarkRunId: string
): Promise<PromotionReadinessSummary> {
  const run = await getBenchmarkRun(benchmarkRunId)
  if (!run) throw new Error('Benchmark run not found')

  const pack = await getBenchmarkPack(run.benchmark_pack_id)
  if (!pack) throw new Error('Benchmark pack not found')

  const supabase = await createClient()

  // Get validation results
  const { data: results } = await supabase
    .from('bulk_validation_results')
    .select('*')
    .eq('bulk_run_id', run.bulk_validation_run_id)

  const activeMetrics = results?.length 
    ? await calculateModelMetrics(results, run.active_model_version_id)
    : null

  const candidateMetrics = results?.length
    ? await calculateModelMetrics(results, run.candidate_model_version_id || run.active_model_version_id)
    : null

  // Get model names
  const { data: models } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('id', [run.active_model_version_id, run.candidate_model_version_id].filter(Boolean) as string[])

  const activeModel = models?.find(m => m.id === run.active_model_version_id)
  const candidateModel = models?.find(m => m.id === run.candidate_model_version_id)

  // Calculate comparison if we have both
  let comparison: ModelComparisonSummary | null = null
  if (activeMetrics && candidateMetrics && run.active_model_version_id !== run.candidate_model_version_id) {
    const grossDiff = candidateMetrics.avg_gross_error - activeMetrics.avg_gross_error
    const grossDiffPercent = activeMetrics.avg_gross_error > 0
      ? (grossDiff / activeMetrics.avg_gross_error) * 100
      : 0

    comparison = {
      gross_error_diff_inches: grossDiff,
      gross_error_diff_percent: grossDiffPercent,
      net_error_diff_inches: candidateMetrics.avg_net_error !== null && activeMetrics.avg_net_error !== null
        ? candidateMetrics.avg_net_error - activeMetrics.avg_net_error
        : null,
      net_error_diff_percent: null,
      accuracy_5_inch_diff: candidateMetrics.within_5_inches_percent - activeMetrics.within_5_inches_percent,
      accuracy_10_inch_diff: candidateMetrics.within_10_inches_percent - activeMetrics.within_10_inches_percent,
      examples_improved: 0, // Would need per-example comparison
      examples_regressed: 0,
      examples_unchanged: 0,
      improvement_rate: 0,
      regression_rate: 0,
    }
  }

  // Evaluate guardrails
  let guardrailEval = run.guardrail_results as GuardrailEvaluationResult | null
  if (!guardrailEval && results?.length) {
    guardrailEval = await evaluateGuardrails(benchmarkRunId)
  }

  // Determine recommendation
  let recommendation: PromotionReadinessSummary['recommendation'] = 'insufficient_data'
  const reasons: string[] = []

  if (!results?.length) {
    reasons.push('Validation results not yet available')
  } else if (!guardrailEval) {
    reasons.push('Guardrail evaluation not complete')
  } else if (guardrailEval.overall_passed) {
    if (guardrailEval.warning_failures === 0) {
      recommendation = 'ready_to_promote'
      reasons.push('All guardrails passed')
      if (comparison && comparison.gross_error_diff_inches < 0) {
        reasons.push(`Candidate improves accuracy by ${Math.abs(comparison.gross_error_diff_inches).toFixed(2)} inches`)
      }
    } else {
      recommendation = 'needs_review'
      reasons.push(`${guardrailEval.warning_failures} warning(s) require review`)
    }
  } else {
    recommendation = 'not_recommended'
    reasons.push(`${guardrailEval.critical_failures} critical guardrail(s) failed`)
    guardrailEval.checks
      .filter(c => !c.passed && c.severity === 'critical')
      .forEach(c => reasons.push(`- ${c.name}: ${c.actual.toFixed(2)} ${c.unit} (threshold: ${c.threshold} ${c.unit})`))
  }

  return {
    benchmark_pack: pack,
    benchmark_run: run,
    active_model: activeModel && activeMetrics ? {
      id: activeModel.id,
      name: activeModel.name,
      metrics: activeMetrics,
    } : null,
    candidate_model: candidateModel && candidateMetrics ? {
      id: candidateModel.id,
      name: candidateModel.name,
      metrics: candidateMetrics,
    } : {
      id: run.candidate_model_version_id || '',
      name: 'Unknown',
      metrics: candidateMetrics || {
        avg_gross_error: 0,
        avg_net_error: null,
        median_gross_error: 0,
        median_net_error: null,
        within_5_inches_count: 0,
        within_5_inches_percent: 0,
        within_10_inches_count: 0,
        within_10_inches_percent: 0,
        overestimation_count: 0,
        underestimation_count: 0,
        sample_count: 0,
      },
    },
    comparison,
    guardrail_evaluation: guardrailEval,
    recommendation,
    recommendation_reasons: reasons,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function getActiveModelVersionId(): Promise<string | null> {
  const supabase = await createClient()
  
  const { data } = await supabase
    .from('model_versions')
    .select('id')
    .eq('is_active', true)
    .single()

  return data?.id || null
}

// Export types used by API routes
export type { 
  BenchmarkPack,
  BenchmarkPackInput,
  BenchmarkRun,
  BenchmarkRunInput,
  BenchmarkRunWithDetails,
  PromotionDecision,
  PromotionDecisionInput,
  RegressionGuardrailConfig,
  GuardrailEvaluationResult,
  PromotionReadinessSummary,
}
