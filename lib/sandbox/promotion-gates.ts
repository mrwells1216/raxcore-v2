/**
 * Phase 48: Promotion Gate System
 * 
 * Defines explicit criteria for promoting candidate variants to production.
 * Evaluates comparisons against gates and provides decision support.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  PromotionGateCriteria,
  PromotionGateResult,
  PromotionGateEvaluation,
  PromotionGateStatus,
  PromotionSignal,
  VariantComparison,
  VariantComparisonWithDetails,
  EvaluationRun,
  SegmentComparisonDetail,
  FamilyComparisonDetail,
  FailureCluster,
} from '@/lib/types'
import { getEvaluationRun } from './evaluation-runner'

// ============================================================================
// PROMOTION GATE CRITERIA
// ============================================================================

/**
 * Get all promotion gate criteria
 */
export async function getPromotionGateCriteria(
  includeDisabled = false
): Promise<PromotionGateCriteria[]> {
  const supabase = await createClient()

  let query = supabase
    .from('promotion_gate_criteria')
    .select('*')
    .order('sort_order', { ascending: true })

  if (!includeDisabled) {
    query = query.eq('is_enabled', true)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to get gate criteria: ${error.message}`)
  return (data || []) as PromotionGateCriteria[]
}

/**
 * Create or update a gate criteria
 */
export async function upsertGateCriteria(criteria: Partial<PromotionGateCriteria> & {
  name: string
  metric_name: string
  comparison_operator: string
  threshold_value: number
}): Promise<PromotionGateCriteria> {
  const supabase = await createClient()

  if (criteria.id) {
    const { data, error } = await supabase
      .from('promotion_gate_criteria')
      .update({
        name: criteria.name,
        description: criteria.description,
        criteria_type: criteria.criteria_type || 'soft_warning',
        metric_name: criteria.metric_name,
        comparison_operator: criteria.comparison_operator,
        threshold_value: criteria.threshold_value,
        threshold_unit: criteria.threshold_unit,
        applies_to_segments: criteria.applies_to_segments,
        applies_to_families: criteria.applies_to_families,
        is_enabled: criteria.is_enabled ?? true,
        sort_order: criteria.sort_order ?? 99,
        updated_at: new Date().toISOString(),
      })
      .eq('id', criteria.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update gate criteria: ${error.message}`)
    return data as PromotionGateCriteria
  }

  const { data, error } = await supabase
    .from('promotion_gate_criteria')
    .insert({
      name: criteria.name,
      description: criteria.description,
      criteria_type: criteria.criteria_type || 'soft_warning',
      metric_name: criteria.metric_name,
      comparison_operator: criteria.comparison_operator,
      threshold_value: criteria.threshold_value,
      threshold_unit: criteria.threshold_unit,
      applies_to_segments: criteria.applies_to_segments,
      applies_to_families: criteria.applies_to_families,
      is_enabled: criteria.is_enabled ?? true,
      sort_order: criteria.sort_order ?? 99,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create gate criteria: ${error.message}`)
  return data as PromotionGateCriteria
}

// ============================================================================
// VARIANT COMPARISON
// ============================================================================

export interface CreateComparisonParams {
  productionVariantId: string
  candidateVariantId: string
  productionEvaluationRunId: string
  candidateEvaluationRunId: string
  datasetType: string
  exportPackId?: string
  benchmarkPackId?: string
  createdBy?: string
}

/**
 * Create a comparison between production and candidate variants
 */
export async function createVariantComparison(
  params: CreateComparisonParams
): Promise<VariantComparison> {
  const supabase = await createClient()

  // Get evaluation runs
  const prodRun = await getEvaluationRun(params.productionEvaluationRunId)
  const candRun = await getEvaluationRun(params.candidateEvaluationRunId)

  if (!prodRun || !candRun) {
    throw new Error('Evaluation runs not found')
  }

  if (prodRun.status !== 'completed' || candRun.status !== 'completed') {
    throw new Error('Both evaluation runs must be completed')
  }

  // Compute comparison metrics (now async to query real results)
  const comparison = await computeComparisonMetrics(prodRun, candRun)

  // Store comparison
  const { data, error } = await supabase
    .from('variant_comparisons')
    .insert({
      production_variant_id: params.productionVariantId,
      candidate_variant_id: params.candidateVariantId,
      production_evaluation_run_id: params.productionEvaluationRunId,
      candidate_evaluation_run_id: params.candidateEvaluationRunId,
      dataset_type: params.datasetType,
      export_pack_id: params.exportPackId || null,
      benchmark_pack_id: params.benchmarkPackId || null,
      ...comparison,
      created_by: params.createdBy || null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create comparison: ${error.message}`)
  return data as VariantComparison
}

/**
 * Generate a comparison between two variants (for job pipeline integration)
 * Optionally runs evaluations if not already done
 */
export async function generateComparison(
  productionVariantId: string,
  candidateVariantId: string,
  productionEvaluationRunId?: string,
  candidateEvaluationRunId?: string,
  options?: {
    datasetType?: string
    exportPackId?: string
    benchmarkPackId?: string
    createdBy?: string
  }
): Promise<VariantComparison> {
  const supabase = await createClient()

  // If evaluation run IDs are provided, use them directly
  if (productionEvaluationRunId && candidateEvaluationRunId) {
    return createVariantComparison({
      productionVariantId,
      candidateVariantId,
      productionEvaluationRunId,
      candidateEvaluationRunId,
      datasetType: options?.datasetType || 'benchmark_pack',
      exportPackId: options?.exportPackId,
      benchmarkPackId: options?.benchmarkPackId,
      createdBy: options?.createdBy,
    })
  }

  // Otherwise, find the most recent completed evaluation runs for each variant
  const { data: prodRuns } = await supabase
    .from('evaluation_runs')
    .select('id')
    .eq('variant_id', productionVariantId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)

  const { data: candRuns } = await supabase
    .from('evaluation_runs')
    .select('id')
    .eq('variant_id', candidateVariantId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)

  if (!prodRuns || prodRuns.length === 0) {
    throw new Error(`No completed evaluation runs found for production variant ${productionVariantId}`)
  }
  if (!candRuns || candRuns.length === 0) {
    throw new Error(`No completed evaluation runs found for candidate variant ${candidateVariantId}`)
  }

  return createVariantComparison({
    productionVariantId,
    candidateVariantId,
    productionEvaluationRunId: prodRuns[0].id,
    candidateEvaluationRunId: candRuns[0].id,
    datasetType: options?.datasetType || 'benchmark_pack',
    exportPackId: options?.exportPackId,
    benchmarkPackId: options?.benchmarkPackId,
    createdBy: options?.createdBy,
  })
}

/**
 * Compute example-level win/loss/unchanged counts from real evaluation results
 * Compares per-example absolute errors between production and candidate runs
 */
async function computeExampleLevelCounts(
  prodRunId: string,
  candRunId: string
): Promise<{ improved: number; regressed: number; unchanged: number; total: number }> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  // Get production results indexed by buck_id
  const { data: prodResults } = await supabase
    .from('evaluation_results')
    .select('buck_id, abs_error_gross')
    .eq('evaluation_run_id', prodRunId)
    .not('abs_error_gross', 'is', null)

  // Get candidate results indexed by buck_id
  const { data: candResults } = await supabase
    .from('evaluation_results')
    .select('buck_id, abs_error_gross')
    .eq('evaluation_run_id', candRunId)
    .not('abs_error_gross', 'is', null)

  if (!prodResults || !candResults) {
    return { improved: 0, regressed: 0, unchanged: 0, total: 0 }
  }

  // Build lookup maps
  const prodMap = new Map<string, number>()
  for (const r of prodResults) {
    if (r.buck_id && r.abs_error_gross !== null) {
      prodMap.set(r.buck_id, r.abs_error_gross)
    }
  }

  const candMap = new Map<string, number>()
  for (const r of candResults) {
    if (r.buck_id && r.abs_error_gross !== null) {
      candMap.set(r.buck_id, r.abs_error_gross)
    }
  }

  // Compare examples that exist in both runs
  let improved = 0
  let regressed = 0
  let unchanged = 0

  // Threshold for "unchanged" (within 0.5 inches is considered unchanged)
  const UNCHANGED_THRESHOLD = 0.5

  for (const [buckId, prodError] of prodMap) {
    const candError = candMap.get(buckId)
    if (candError === undefined) continue

    const errorDiff = prodError - candError // Positive means candidate is better

    if (errorDiff > UNCHANGED_THRESHOLD) {
      improved++ // Candidate has lower error
    } else if (errorDiff < -UNCHANGED_THRESHOLD) {
      regressed++ // Candidate has higher error
    } else {
      unchanged++ // Within threshold
    }
  }

  return {
    improved,
    regressed,
    unchanged,
    total: improved + regressed + unchanged,
  }
}

/**
 * Compute comparison metrics between two evaluation runs using REAL example-level data
 */
async function computeComparisonMetrics(
  prodRun: EvaluationRun,
  candRun: EvaluationRun
): Promise<Partial<VariantComparison>> {
  const prodMetrics = prodRun.metrics
  const candMetrics = candRun.metrics

  if (!prodMetrics || !candMetrics) {
    throw new Error('Evaluation metrics not available')
  }

  // Core error comparison
  const maeImprovement = prodMetrics.mae_gross - candMetrics.mae_gross
  const maeImprovementPercent = prodMetrics.mae_gross > 0
    ? (maeImprovement / prodMetrics.mae_gross) * 100
    : 0

  const p95Improvement = prodMetrics.p95_error - candMetrics.p95_error

  // PATCH C: Derive win/loss/unchanged from REAL per-example evaluation results
  const exampleCounts = await computeExampleLevelCounts(prodRun.id, candRun.id)
  const sampleCount = exampleCounts.total || Math.min(prodMetrics.sample_count, candMetrics.sample_count)
  const improvedCount = exampleCounts.improved
  const regressedCount = exampleCounts.regressed
  const unchangedCount = exampleCounts.unchanged

  // Confidence calibration (from interval coverage if available)
  const prodCalibration = prodRun.interval_coverage?.coverage_percent || null
  const candCalibration = candRun.interval_coverage?.coverage_percent || null
  const calibrationImprovement = prodCalibration !== null && candCalibration !== null
    ? (candCalibration - prodCalibration) / 100
    : null

  // Interval coverage
  const intervalCoverageChange = prodCalibration !== null && candCalibration !== null
    ? (candCalibration - prodCalibration) / 100
    : null

  // Geometry correlation
  const prodGeom = prodRun.geometry_consistency_metrics?.consistency_error_correlation || null
  const candGeom = candRun.geometry_consistency_metrics?.consistency_error_correlation || null

  // Segment comparisons
  const segmentComparisons = computeSegmentComparisons(prodRun, candRun)

  // Family comparisons
  const familyComparisons = computeFamilyComparisons(prodRun, candRun)

  // Determine promotion signal
  const { signal, reasons, confidence, confidenceTier } = determinePromotionSignal(
    maeImprovement,
    p95Improvement,
    calibrationImprovement,
    segmentComparisons,
    familyComparisons
  )

  // Generate summary
  const summaryText = generateComparisonSummary(
    maeImprovement,
    maeImprovementPercent,
    p95Improvement,
    improvedCount,
    regressedCount,
    sampleCount
  )

  return {
    sample_count: sampleCount,
    production_mae_gross: prodMetrics.mae_gross,
    candidate_mae_gross: candMetrics.mae_gross,
    mae_improvement: maeImprovement,
    mae_improvement_percent: maeImprovementPercent,
    production_median_error: prodMetrics.median_error_gross,
    candidate_median_error: candMetrics.median_error_gross,
    production_p95_error: prodMetrics.p95_error,
    candidate_p95_error: candMetrics.p95_error,
    p95_improvement: p95Improvement,
    production_max_error: prodMetrics.max_error,
    candidate_max_error: candMetrics.max_error,
    production_calibration_score: prodCalibration !== null ? prodCalibration / 100 : null,
    candidate_calibration_score: candCalibration !== null ? candCalibration / 100 : null,
    calibration_improvement: calibrationImprovement,
    production_interval_coverage: prodCalibration !== null ? prodCalibration / 100 : null,
    candidate_interval_coverage: candCalibration !== null ? candCalibration / 100 : null,
    interval_coverage_change: intervalCoverageChange,
    production_geometry_correlation: prodGeom,
    candidate_geometry_correlation: candGeom,
    examples_improved: improvedCount,
    examples_regressed: regressedCount,
    examples_unchanged: unchangedCount,
    improvement_rate: sampleCount > 0 ? (improvedCount + unchangedCount) / sampleCount : null,
    segment_comparisons: segmentComparisons,
    family_comparisons: familyComparisons,
    regression_clusters: candRun.failure_clusters || null,
    improvement_clusters: null, // Would identify where candidate does better
    confidence_in_improvement: confidence,
    improvement_confidence_tier: confidenceTier,
    promotion_signal: signal,
    promotion_signal_reasons: reasons,
    summary_text: summaryText,
  }
}

function computeSegmentComparisons(
  prodRun: EvaluationRun,
  candRun: EvaluationRun
): Record<string, SegmentComparisonDetail> | null {
  const prodSegments = prodRun.segment_metrics
  const candSegments = candRun.segment_metrics

  if (!prodSegments || !candSegments) return null

  const result: Record<string, SegmentComparisonDetail> = {}

  // Compare states
  for (const [state, candData] of Object.entries(candSegments.by_state || {})) {
    const prodData = prodSegments.by_state?.[state]
    if (!prodData) continue

    const improvement = prodData.mae - candData.mae
    result[`state_${state}`] = {
      segment_value: state,
      production_mae: prodData.mae,
      candidate_mae: candData.mae,
      improvement,
      improvement_percent: prodData.mae > 0 ? (improvement / prodData.mae) * 100 : 0,
      sample_count: candData.count,
      is_regression: improvement < -0.5,
    }
  }

  // Compare rack types
  for (const [rackType, candData] of Object.entries(candSegments.by_rack_type || {})) {
    const prodData = prodSegments.by_rack_type?.[rackType]
    if (!prodData) continue

    const improvement = prodData.mae - candData.mae
    result[`rack_${rackType}`] = {
      segment_value: rackType,
      production_mae: prodData.mae,
      candidate_mae: candData.mae,
      improvement,
      improvement_percent: prodData.mae > 0 ? (improvement / prodData.mae) * 100 : 0,
      sample_count: candData.count,
      is_regression: improvement < -0.5,
    }
  }

  return result
}

function computeFamilyComparisons(
  prodRun: EvaluationRun,
  candRun: EvaluationRun
): Record<string, FamilyComparisonDetail> | null {
  const prodFamily = prodRun.family_metrics
  const candFamily = candRun.family_metrics

  if (!prodFamily || !candFamily) return null

  const result: Record<string, FamilyComparisonDetail> = {}

  const families = ['spread', 'beam', 'tine', 'mass'] as const
  for (const family of families) {
    const prodData = prodFamily[family]
    const candData = candFamily[family]
    if (!prodData || !candData) continue

    const improvement = prodData.mae - candData.mae
    result[family] = {
      family,
      production_mae: prodData.mae,
      candidate_mae: candData.mae,
      improvement,
      improvement_percent: prodData.mae > 0 ? (improvement / prodData.mae) * 100 : 0,
      is_regression: improvement < -0.3,
    }
  }

  return result
}

function determinePromotionSignal(
  maeImprovement: number,
  p95Improvement: number,
  calibrationImprovement: number | null,
  segmentComparisons: Record<string, SegmentComparisonDetail> | null,
  familyComparisons: Record<string, FamilyComparisonDetail> | null
): {
  signal: PromotionSignal
  reasons: string[]
  confidence: number
  confidenceTier: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
} {
  const reasons: string[] = []
  let score = 0 // -100 to +100

  // MAE improvement (+/- 30 points)
  if (maeImprovement > 1) {
    score += 30
    reasons.push(`MAE improved by ${maeImprovement.toFixed(2)}" - strong improvement`)
  } else if (maeImprovement > 0.3) {
    score += 20
    reasons.push(`MAE improved by ${maeImprovement.toFixed(2)}" - moderate improvement`)
  } else if (maeImprovement > -0.3) {
    score += 5
    reasons.push('MAE roughly unchanged')
  } else if (maeImprovement > -1) {
    score -= 20
    reasons.push(`MAE regressed by ${Math.abs(maeImprovement).toFixed(2)}" - moderate concern`)
  } else {
    score -= 40
    reasons.push(`MAE regressed by ${Math.abs(maeImprovement).toFixed(2)}" - significant regression`)
  }

  // P95 improvement (+/- 20 points)
  if (p95Improvement > 2) {
    score += 20
    reasons.push('Tail errors (P95) significantly improved')
  } else if (p95Improvement > 0) {
    score += 10
    reasons.push('Tail errors (P95) improved')
  } else if (p95Improvement > -2) {
    // Neutral
  } else {
    score -= 20
    reasons.push('Tail errors (P95) significantly worse')
  }

  // Calibration (+/- 15 points)
  if (calibrationImprovement !== null) {
    if (calibrationImprovement > 0.03) {
      score += 15
      reasons.push('Confidence calibration improved')
    } else if (calibrationImprovement < -0.03) {
      score -= 15
      reasons.push('Confidence calibration degraded')
    }
  }

  // Segment regressions (+/- 20 points)
  if (segmentComparisons) {
    const regressions = Object.values(segmentComparisons).filter(s => s.is_regression)
    if (regressions.length === 0) {
      score += 10
      reasons.push('No segment regressions detected')
    } else if (regressions.length <= 2) {
      score -= 10
      reasons.push(`${regressions.length} minor segment regression(s)`)
    } else {
      score -= 25
      reasons.push(`${regressions.length} segment regressions - review required`)
    }
  }

  // Family regressions (+/- 15 points)
  if (familyComparisons) {
    const regressions = Object.values(familyComparisons).filter(f => f.is_regression)
    if (regressions.length === 0) {
      score += 5
    } else {
      score -= regressions.length * 5
      reasons.push(`${regressions.length} measurement family regression(s)`)
    }
  }

  // Determine signal
  let signal: PromotionSignal
  let confidenceTier: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'

  if (score >= 50) {
    signal = 'strongly_recommend'
    confidenceTier = 'very_high'
  } else if (score >= 25) {
    signal = 'recommend'
    confidenceTier = 'high'
  } else if (score >= 0) {
    signal = 'neutral'
    confidenceTier = 'medium'
  } else if (score >= -25) {
    signal = 'caution'
    confidenceTier = 'low'
  } else {
    signal = 'do_not_promote'
    confidenceTier = 'very_low'
  }

  // Normalize confidence to 0-1
  const confidence = Math.max(0, Math.min(1, (score + 100) / 200))

  return { signal, reasons, confidence, confidenceTier }
}

function generateComparisonSummary(
  maeImprovement: number,
  maeImprovementPercent: number,
  p95Improvement: number,
  improvedCount: number,
  regressedCount: number,
  sampleCount: number
): string {
  const parts: string[] = []

  if (maeImprovement > 0.5) {
    parts.push(`Candidate improves MAE by ${maeImprovement.toFixed(2)}" (${Math.abs(maeImprovementPercent).toFixed(1)}%)`)
  } else if (maeImprovement < -0.5) {
    parts.push(`Candidate regresses MAE by ${Math.abs(maeImprovement).toFixed(2)}" (${Math.abs(maeImprovementPercent).toFixed(1)}%)`)
  } else {
    parts.push('MAE roughly unchanged')
  }

  if (p95Improvement > 1) {
    parts.push(`tail errors improved by ${p95Improvement.toFixed(1)}"`)
  } else if (p95Improvement < -1) {
    parts.push(`tail errors worsened by ${Math.abs(p95Improvement).toFixed(1)}"`)
  }

  const improvementRate = sampleCount > 0 ? ((improvedCount / sampleCount) * 100).toFixed(0) : '0'
  const regressionRate = sampleCount > 0 ? ((regressedCount / sampleCount) * 100).toFixed(0) : '0'
  parts.push(`${improvementRate}% of examples improved, ${regressionRate}% regressed`)

  return parts.join('. ') + '.'
}

// ============================================================================
// GATE EVALUATION
// ============================================================================

/**
 * Evaluate a comparison against all promotion gates
 */
export async function evaluatePromotionGates(
  comparisonId: string,
  evaluatedBy?: string
): Promise<PromotionGateEvaluation> {
  const supabase = await createClient()

  // Get comparison
  const { data: comparison, error: compError } = await supabase
    .from('variant_comparisons')
    .select('*')
    .eq('id', comparisonId)
    .single()

  if (compError || !comparison) {
    throw new Error('Comparison not found')
  }

  // Get criteria
  const criteria = await getPromotionGateCriteria()

  // Evaluate each gate
  const gateResults: PromotionGateResult[] = []
  let hardFailCount = 0
  let softWarningCount = 0

  for (const criterion of criteria) {
    const result = evaluateSingleGate(criterion, comparison as VariantComparison)
    gateResults.push(result)

    if (!result.passed) {
      if (criterion.criteria_type === 'hard_fail') {
        hardFailCount++
      } else if (criterion.criteria_type === 'soft_warning') {
        softWarningCount++
      }
    }
  }

  // Determine overall status
  let overallStatus: PromotionGateStatus
  let statusReason: string

  if (hardFailCount > 0) {
    overallStatus = 'rejected'
    statusReason = `${hardFailCount} hard fail(s) detected`
  } else if (softWarningCount > 0) {
    overallStatus = 'needs_review'
    statusReason = `${softWarningCount} warning(s) require review`
  } else {
    overallStatus = 'eligible'
    statusReason = 'All gates passed'
  }

  // Store evaluation
  const { data: evaluation, error } = await supabase
    .from('promotion_gate_evaluations')
    .insert({
      variant_comparison_id: comparisonId,
      candidate_variant_id: comparison.candidate_variant_id,
      overall_status: overallStatus,
      gate_results: gateResults,
      hard_fail_count: hardFailCount,
      soft_warning_count: softWarningCount,
      status_reason: statusReason,
      detailed_summary: {
        comparison_id: comparisonId,
        candidate_variant_id: comparison.candidate_variant_id,
        promotion_signal: comparison.promotion_signal,
        mae_improvement: comparison.mae_improvement,
        p95_improvement: comparison.p95_improvement,
      },
      evaluated_by: evaluatedBy || null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to store gate evaluation: ${error.message}`)
  return evaluation as PromotionGateEvaluation
}

function evaluateSingleGate(
  criterion: PromotionGateCriteria,
  comparison: VariantComparison
): PromotionGateResult {
  // Get the metric value from comparison
  const metricValue = getMetricValue(criterion.metric_name, comparison)

  // Evaluate against threshold
  const passed = evaluateThreshold(
    metricValue,
    criterion.comparison_operator,
    criterion.threshold_value
  )

  // Generate message
  const message = passed
    ? `${criterion.name}: ${formatMetric(metricValue, criterion.threshold_unit)} meets threshold ${criterion.comparison_operator} ${criterion.threshold_value}${criterion.threshold_unit || ''}`
    : `${criterion.name}: ${formatMetric(metricValue, criterion.threshold_unit)} fails threshold ${criterion.comparison_operator} ${criterion.threshold_value}${criterion.threshold_unit || ''}`

  return {
    criteria_id: criterion.id,
    criteria_name: criterion.name,
    criteria_type: criterion.criteria_type,
    passed,
    metric_value: metricValue,
    threshold_value: criterion.threshold_value,
    threshold_unit: criterion.threshold_unit,
    message,
  }
}

function getMetricValue(metricName: string, comparison: VariantComparison): number {
  switch (metricName) {
    case 'mae_improvement':
      return comparison.mae_improvement || 0
    case 'p95_improvement':
      return comparison.p95_improvement || 0
    case 'calibration_improvement':
      return comparison.calibration_improvement || 0
    case 'interval_coverage_change':
      return comparison.interval_coverage_change || 0
    case 'improvement_rate':
      return comparison.improvement_rate || 0
    case 'max_segment_regression':
      // Find worst segment regression
      if (!comparison.segment_comparisons) return 0
      const regressions = Object.values(comparison.segment_comparisons)
        .filter(s => s.is_regression)
        .map(s => Math.abs(s.improvement))
      return regressions.length > 0 ? Math.max(...regressions) : 0
    case 'candidate_mae_gross':
      return comparison.candidate_mae_gross || 0
    case 'candidate_p95_error':
      return comparison.candidate_p95_error || 0
    default:
      return 0
  }
}

function evaluateThreshold(
  value: number,
  operator: string,
  threshold: number
): boolean {
  switch (operator) {
    case '<=':
      return value <= threshold
    case '>=':
      return value >= threshold
    case '<':
      return value < threshold
    case '>':
      return value > threshold
    case '=':
      return Math.abs(value - threshold) < 0.001
    case '!=':
      return Math.abs(value - threshold) >= 0.001
    default:
      return false
  }
}

function formatMetric(value: number, unit: string | null): string {
  if (unit === 'inches') {
    return `${value.toFixed(2)}"`
  }
  if (unit === 'ratio' || unit === '%') {
    return `${(value * 100).toFixed(1)}%`
  }
  return value.toFixed(2)
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get a comparison by ID
 */
export async function getVariantComparison(id: string): Promise<VariantComparisonWithDetails | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('recent_variant_comparisons')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get comparison: ${error.message}`)
  }
  return data as VariantComparisonWithDetails | null
}

/**
 * List comparisons
 */
export async function listVariantComparisons(options?: {
  candidateVariantId?: string
  limit?: number
  offset?: number
}): Promise<{ data: VariantComparisonWithDetails[]; count: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('recent_variant_comparisons')
    .select('*', { count: 'exact' })

  if (options?.candidateVariantId) {
    query = query.eq('candidate_variant_id', options.candidateVariantId)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list comparisons: ${error.message}`)
  return { data: (data || []) as VariantComparisonWithDetails[], count: count || 0 }
}

/**
 * Get gate evaluation for a comparison
 */
export async function getGateEvaluation(comparisonId: string): Promise<PromotionGateEvaluation | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('promotion_gate_evaluations')
    .select('*')
    .eq('variant_comparison_id', comparisonId)
    .order('evaluated_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get gate evaluation: ${error.message}`)
  }
  return data as PromotionGateEvaluation | null
}

/**
 * Get promotion history for a variant
 */
export async function getVariantPromotionHistory(variantId: string): Promise<{
  id: string
  action: string
  decision_reason: string | null
  decided_by: string | null
  decided_at: string
}[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('variant_promotion_history')
    .select('id, action, decision_reason, decided_by, decided_at')
    .eq('variant_id', variantId)
    .order('decided_at', { ascending: false })

  if (error) throw new Error(`Failed to get promotion history: ${error.message}`)
  return data || []
}
