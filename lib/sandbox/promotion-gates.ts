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
// PROTECTED SEGMENTS (PATCH A)
// ============================================================================

/**
 * Protected segment definitions - these are sensitive scenarios where
 * regression is particularly harmful and requires hard fail gates
 */
export const PROTECTED_SEGMENTS = {
  low_light_trail_cam: {
    name: 'Low Light / Trail Cam',
    description: 'Poor lighting conditions from trail cameras',
    regressionThreshold: 0.5, // inches - stricter threshold
    minSampleCount: 5,
    filter: (r: ExampleComparisonData) => 
      r.sourceType === 'trail_cam' || r.sourceType === 'trail_camera' ||
      r.characteristics?.lighting_quality === 'low' ||
      r.characteristics?.lighting_quality === 'poor',
  },
  weak_reference: {
    name: 'Weak Reference',
    description: 'Examples with low reference quality or missing ear reference',
    regressionThreshold: 0.75,
    minSampleCount: 3,
    filter: (r: ExampleComparisonData) =>
      r.characteristics?.reference_quality === 'weak' ||
      r.characteristics?.reference_quality === 'poor' ||
      r.characteristics?.ear_reference === false ||
      r.earsVisible === false,
  },
  high_asymmetry: {
    name: 'High Asymmetry',
    description: 'Racks with significant asymmetry that are harder to score',
    regressionThreshold: 0.75,
    minSampleCount: 3,
    filter: (r: ExampleComparisonData) =>
      r.characteristics?.asymmetry_score !== undefined && 
      r.characteristics.asymmetry_score > 0.3,
  },
  single_image: {
    name: 'Single Image',
    description: 'Predictions made from only one image',
    regressionThreshold: 1.0, // More lenient since single images are inherently harder
    minSampleCount: 5,
    filter: (r: ExampleComparisonData) =>
      r.imageCount === 1,
  },
} as const

export type ProtectedSegmentKey = keyof typeof PROTECTED_SEGMENTS

export interface ProtectedSegmentResult {
  segmentKey: ProtectedSegmentKey
  segmentName: string
  sampleCount: number
  improvedCount: number
  regressedCount: number
  unchangedCount: number
  avgRegressionAmount: number
  maxRegressionAmount: number
  isHardFail: boolean
  failReason: string | null
}

export interface ExampleComparisonData {
  buckId: string
  prodAbsErrorGross: number
  candAbsErrorGross: number
  prodAbsErrorNet: number | null
  candAbsErrorNet: number | null
  prodConfidence: number | null
  candConfidence: number | null
  prodSpreadError: number | null
  candSpreadError: number | null
  prodBeamError: number | null
  candBeamError: number | null
  prodTineError: number | null
  candTineError: number | null
  prodMassError: number | null
  candMassError: number | null
  state: string | null
  rackType: string | null
  sourceType: string | null
  imageCount: number
  earsVisible: boolean | null
  characteristics: Record<string, unknown> | null
}

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
 * PATCH B: Richer example-level comparison data structure
 */
export interface RichExampleLevelCounts {
  // Core counts
  improved: number
  regressed: number
  unchanged: number
  total: number
  
  // Net error counts (if available)
  netImproved: number
  netRegressed: number
  netUnchanged: number
  netTotal: number
  
  // Family-level counts
  spreadImproved: number
  spreadRegressed: number
  beamImproved: number
  beamRegressed: number
  tineImproved: number
  tineRegressed: number
  massImproved: number
  massRegressed: number
  
  // Confidence changes
  confidenceImproved: number
  confidenceRegressed: number
  
  // High-confidence regressions (PATCH C)
  highConfidenceRegressions: number
  highConfidenceTotal: number
  
  // Protected segment results (PATCH A)
  protectedSegmentResults: ProtectedSegmentResult[]
  
  // Raw comparison data for further analysis
  exampleData: ExampleComparisonData[]
}

/**
 * Compute example-level win/loss/unchanged counts from real evaluation results
 * PATCH B: Extended to include gross/net/family/confidence deltas
 */
async function computeExampleLevelCounts(
  prodRunId: string,
  candRunId: string
): Promise<RichExampleLevelCounts> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  // Get production results with full data
  const { data: prodResults } = await supabase
    .from('evaluation_results')
    .select(`
      buck_id,
      abs_error_gross,
      abs_error_net,
      confidence_percent,
      spread_error,
      beam_error,
      tine_error,
      mass_error,
      state,
      rack_type,
      source_type,
      result_snapshot
    `)
    .eq('evaluation_run_id', prodRunId)
    .not('abs_error_gross', 'is', null)

  // Get candidate results with full data
  const { data: candResults } = await supabase
    .from('evaluation_results')
    .select(`
      buck_id,
      abs_error_gross,
      abs_error_net,
      confidence_percent,
      spread_error,
      beam_error,
      tine_error,
      mass_error,
      state,
      rack_type,
      source_type,
      result_snapshot
    `)
    .eq('evaluation_run_id', candRunId)
    .not('abs_error_gross', 'is', null)

  const result: RichExampleLevelCounts = {
    improved: 0, regressed: 0, unchanged: 0, total: 0,
    netImproved: 0, netRegressed: 0, netUnchanged: 0, netTotal: 0,
    spreadImproved: 0, spreadRegressed: 0,
    beamImproved: 0, beamRegressed: 0,
    tineImproved: 0, tineRegressed: 0,
    massImproved: 0, massRegressed: 0,
    confidenceImproved: 0, confidenceRegressed: 0,
    highConfidenceRegressions: 0, highConfidenceTotal: 0,
    protectedSegmentResults: [],
    exampleData: [],
  }

  if (!prodResults || !candResults) {
    return result
  }

  // Build lookup maps
  type ResultRow = typeof prodResults[number]
  const prodMap = new Map<string, ResultRow>()
  for (const r of prodResults) {
    if (r.buck_id) prodMap.set(r.buck_id, r)
  }

  const candMap = new Map<string, ResultRow>()
  for (const r of candResults) {
    if (r.buck_id) candMap.set(r.buck_id, r)
  }

  // Threshold for "unchanged" (within 0.5 inches is considered unchanged)
  const UNCHANGED_THRESHOLD = 0.5
  const FAMILY_THRESHOLD = 0.3
  const CONFIDENCE_THRESHOLD = 3 // 3% confidence change
  const HIGH_CONFIDENCE_THRESHOLD = 75 // Production confidence >= 75% is "high confidence"

  // Compare examples that exist in both runs
  for (const [buckId, prod] of prodMap) {
    const cand = candMap.get(buckId)
    if (!cand) continue

    const prodError = prod.abs_error_gross || 0
    const candError = cand.abs_error_gross || 0
    const errorDiff = prodError - candError // Positive means candidate is better

    // Build example comparison data
    const exampleData: ExampleComparisonData = {
      buckId,
      prodAbsErrorGross: prodError,
      candAbsErrorGross: candError,
      prodAbsErrorNet: prod.abs_error_net,
      candAbsErrorNet: cand.abs_error_net,
      prodConfidence: prod.confidence_percent,
      candConfidence: cand.confidence_percent,
      prodSpreadError: prod.spread_error,
      candSpreadError: cand.spread_error,
      prodBeamError: prod.beam_error,
      candBeamError: cand.beam_error,
      prodTineError: prod.tine_error,
      candTineError: cand.tine_error,
      prodMassError: prod.mass_error,
      candMassError: cand.mass_error,
      state: prod.state,
      rackType: prod.rack_type,
      sourceType: prod.source_type,
      imageCount: (prod.result_snapshot as Record<string, unknown>)?.image_count as number || 1,
      earsVisible: (prod.result_snapshot as Record<string, unknown>)?.ears_visible as boolean ?? null,
      characteristics: (prod.result_snapshot as Record<string, unknown>)?.characteristics as Record<string, unknown> || null,
    }
    result.exampleData.push(exampleData)

    // Gross error comparison
    if (errorDiff > UNCHANGED_THRESHOLD) {
      result.improved++
    } else if (errorDiff < -UNCHANGED_THRESHOLD) {
      result.regressed++
    } else {
      result.unchanged++
    }
    result.total++

    // Net error comparison (PATCH B)
    if (prod.abs_error_net !== null && cand.abs_error_net !== null) {
      const netDiff = prod.abs_error_net - cand.abs_error_net
      if (netDiff > UNCHANGED_THRESHOLD) result.netImproved++
      else if (netDiff < -UNCHANGED_THRESHOLD) result.netRegressed++
      else result.netUnchanged++
      result.netTotal++
    }

    // Family-level comparisons (PATCH B)
    if (prod.spread_error !== null && cand.spread_error !== null) {
      const spreadDiff = Math.abs(prod.spread_error) - Math.abs(cand.spread_error)
      if (spreadDiff > FAMILY_THRESHOLD) result.spreadImproved++
      else if (spreadDiff < -FAMILY_THRESHOLD) result.spreadRegressed++
    }
    if (prod.beam_error !== null && cand.beam_error !== null) {
      const beamDiff = Math.abs(prod.beam_error) - Math.abs(cand.beam_error)
      if (beamDiff > FAMILY_THRESHOLD) result.beamImproved++
      else if (beamDiff < -FAMILY_THRESHOLD) result.beamRegressed++
    }
    if (prod.tine_error !== null && cand.tine_error !== null) {
      const tineDiff = Math.abs(prod.tine_error) - Math.abs(cand.tine_error)
      if (tineDiff > FAMILY_THRESHOLD) result.tineImproved++
      else if (tineDiff < -FAMILY_THRESHOLD) result.tineRegressed++
    }
    if (prod.mass_error !== null && cand.mass_error !== null) {
      const massDiff = Math.abs(prod.mass_error) - Math.abs(cand.mass_error)
      if (massDiff > FAMILY_THRESHOLD) result.massImproved++
      else if (massDiff < -FAMILY_THRESHOLD) result.massRegressed++
    }

    // Confidence comparison (PATCH B)
    if (prod.confidence_percent !== null && cand.confidence_percent !== null) {
      const confDiff = cand.confidence_percent - prod.confidence_percent
      if (confDiff > CONFIDENCE_THRESHOLD) result.confidenceImproved++
      else if (confDiff < -CONFIDENCE_THRESHOLD) result.confidenceRegressed++
    }

    // PATCH C: High-confidence regression detection
    // Track cases where production was high-confidence but candidate regresses
    if (prod.confidence_percent !== null && prod.confidence_percent >= HIGH_CONFIDENCE_THRESHOLD) {
      result.highConfidenceTotal++
      // If candidate makes the prediction worse on a high-confidence example
      if (errorDiff < -UNCHANGED_THRESHOLD) {
        result.highConfidenceRegressions++
      }
    }
  }

  // PATCH A: Evaluate protected segments
  result.protectedSegmentResults = evaluateProtectedSegments(result.exampleData)

  return result
}

/**
 * PATCH A: Evaluate all protected segments and return results
 */
function evaluateProtectedSegments(
  exampleData: ExampleComparisonData[]
): ProtectedSegmentResult[] {
  const results: ProtectedSegmentResult[] = []
  const UNCHANGED_THRESHOLD = 0.5

  for (const [segmentKey, segment] of Object.entries(PROTECTED_SEGMENTS) as [ProtectedSegmentKey, typeof PROTECTED_SEGMENTS[ProtectedSegmentKey]][]) {
    // Filter examples that match this protected segment
    const matchingExamples = exampleData.filter(segment.filter)
    
    if (matchingExamples.length < segment.minSampleCount) {
      // Not enough samples to evaluate this segment
      results.push({
        segmentKey,
        segmentName: segment.name,
        sampleCount: matchingExamples.length,
        improvedCount: 0,
        regressedCount: 0,
        unchangedCount: 0,
        avgRegressionAmount: 0,
        maxRegressionAmount: 0,
        isHardFail: false,
        failReason: matchingExamples.length === 0 
          ? 'No examples in segment' 
          : `Only ${matchingExamples.length} examples (min ${segment.minSampleCount} required)`,
      })
      continue
    }

    // Compute segment-level metrics
    let improved = 0
    let regressed = 0
    let unchanged = 0
    const regressionAmounts: number[] = []

    for (const ex of matchingExamples) {
      const errorDiff = ex.prodAbsErrorGross - ex.candAbsErrorGross

      if (errorDiff > UNCHANGED_THRESHOLD) {
        improved++
      } else if (errorDiff < -UNCHANGED_THRESHOLD) {
        regressed++
        regressionAmounts.push(Math.abs(errorDiff))
      } else {
        unchanged++
      }
    }

    const avgRegressionAmount = regressionAmounts.length > 0
      ? regressionAmounts.reduce((a, b) => a + b, 0) / regressionAmounts.length
      : 0
    const maxRegressionAmount = regressionAmounts.length > 0
      ? Math.max(...regressionAmounts)
      : 0

    // Determine if this is a hard fail
    // Hard fail if: average regression exceeds threshold OR regression rate > 40%
    const regressionRate = regressed / matchingExamples.length
    const isHardFail = avgRegressionAmount > segment.regressionThreshold || regressionRate > 0.4

    let failReason: string | null = null
    if (isHardFail) {
      const reasons: string[] = []
      if (avgRegressionAmount > segment.regressionThreshold) {
        reasons.push(`avg regression ${avgRegressionAmount.toFixed(2)}" exceeds threshold ${segment.regressionThreshold}"`)
      }
      if (regressionRate > 0.4) {
        reasons.push(`regression rate ${(regressionRate * 100).toFixed(0)}% exceeds 40%`)
      }
      failReason = reasons.join('; ')
    }

    results.push({
      segmentKey,
      segmentName: segment.name,
      sampleCount: matchingExamples.length,
      improvedCount: improved,
      regressedCount: regressed,
      unchangedCount: unchanged,
      avgRegressionAmount,
      maxRegressionAmount,
      isHardFail,
      failReason,
    })
  }

  return results
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

  // PATCH B+C: Derive rich win/loss/unchanged from REAL per-example evaluation results
  const exampleCounts = await computeExampleLevelCounts(prodRun.id, candRun.id)
  const sampleCount = exampleCounts.total || Math.min(prodMetrics.sample_count, candMetrics.sample_count)
  const improvedCount = exampleCounts.improved
  const regressedCount = exampleCounts.regressed
  const unchangedCount = exampleCounts.unchanged

  // PATCH A: Check for protected segment hard fails
  const protectedSegmentHardFails = exampleCounts.protectedSegmentResults.filter(r => r.isHardFail)
  
  // PATCH C: Check for high-confidence regressions
  const highConfRegressionRate = exampleCounts.highConfidenceTotal > 0
    ? exampleCounts.highConfidenceRegressions / exampleCounts.highConfidenceTotal
    : 0

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

  // Determine promotion signal (now includes protected segments and high-confidence regression check)
  const { signal, reasons, confidence, confidenceTier } = determinePromotionSignal(
    maeImprovement,
    p95Improvement,
    calibrationImprovement,
    segmentComparisons,
    familyComparisons,
    protectedSegmentHardFails,
    highConfRegressionRate,
    exampleCounts
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
    // PATCH A+B+C: Extended comparison data
    protected_segment_results: exampleCounts.protectedSegmentResults,
    protected_segment_hard_fails: protectedSegmentHardFails.length,
    high_confidence_regressions: exampleCounts.highConfidenceRegressions,
    high_confidence_total: exampleCounts.highConfidenceTotal,
    high_confidence_regression_rate: highConfRegressionRate,
    // Family-level example counts
    family_level_counts: {
      spread: { improved: exampleCounts.spreadImproved, regressed: exampleCounts.spreadRegressed },
      beam: { improved: exampleCounts.beamImproved, regressed: exampleCounts.beamRegressed },
      tine: { improved: exampleCounts.tineImproved, regressed: exampleCounts.tineRegressed },
      mass: { improved: exampleCounts.massImproved, regressed: exampleCounts.massRegressed },
    },
    net_error_counts: {
      improved: exampleCounts.netImproved,
      regressed: exampleCounts.netRegressed,
      unchanged: exampleCounts.netUnchanged,
      total: exampleCounts.netTotal,
    },
    confidence_counts: {
      improved: exampleCounts.confidenceImproved,
      regressed: exampleCounts.confidenceRegressed,
    },
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
  familyComparisons: Record<string, FamilyComparisonDetail> | null,
  protectedSegmentHardFails: ProtectedSegmentResult[],
  highConfRegressionRate: number,
  exampleCounts: RichExampleLevelCounts
): {
  signal: PromotionSignal
  reasons: string[]
  confidence: number
  confidenceTier: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
} {
  const reasons: string[] = []
  let score = 0 // -100 to +100
  let forceDoNotPromote = false

  // ============================================================================
  // PATCH A: Protected segment hard fail check (highest priority)
  // ============================================================================
  if (protectedSegmentHardFails.length > 0) {
    forceDoNotPromote = true
    score -= 50
    for (const fail of protectedSegmentHardFails) {
      reasons.push(`PROTECTED SEGMENT HARD FAIL: ${fail.segmentName} - ${fail.failReason}`)
    }
  }

  // ============================================================================
  // PATCH C: High-confidence regression guard
  // ============================================================================
  const HIGH_CONF_REGRESSION_HARD_FAIL_THRESHOLD = 0.25 // 25% of high-conf cases regressing = hard fail
  const HIGH_CONF_REGRESSION_WARNING_THRESHOLD = 0.15 // 15% = warning
  
  if (exampleCounts.highConfidenceTotal >= 5) { // Only evaluate if we have enough samples
    if (highConfRegressionRate >= HIGH_CONF_REGRESSION_HARD_FAIL_THRESHOLD) {
      forceDoNotPromote = true
      score -= 40
      reasons.push(`HIGH-CONFIDENCE REGRESSION: ${(highConfRegressionRate * 100).toFixed(0)}% of high-confidence cases regressed (${exampleCounts.highConfidenceRegressions}/${exampleCounts.highConfidenceTotal})`)
    } else if (highConfRegressionRate >= HIGH_CONF_REGRESSION_WARNING_THRESHOLD) {
      score -= 20
      reasons.push(`High-confidence regression warning: ${(highConfRegressionRate * 100).toFixed(0)}% of high-confidence cases regressed`)
    } else if (highConfRegressionRate < 0.05 && exampleCounts.highConfidenceRegressions === 0) {
      score += 10
      reasons.push('No regressions on high-confidence cases')
    }
  }

  // ============================================================================
  // MAE improvement (+/- 30 points)
  // ============================================================================
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

  // ============================================================================
  // P95 improvement (+/- 20 points)
  // ============================================================================
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

  // ============================================================================
  // Calibration (+/- 15 points)
  // ============================================================================
  if (calibrationImprovement !== null) {
    if (calibrationImprovement > 0.03) {
      score += 15
      reasons.push('Confidence calibration improved')
    } else if (calibrationImprovement < -0.03) {
      score -= 15
      reasons.push('Confidence calibration degraded')
    }
  }

  // ============================================================================
  // Segment regressions (+/- 20 points)
  // ============================================================================
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

  // ============================================================================
  // Family regressions (+/- 15 points)
  // ============================================================================
  if (familyComparisons) {
    const regressions = Object.values(familyComparisons).filter(f => f.is_regression)
    if (regressions.length === 0) {
      score += 5
    } else {
      score -= regressions.length * 5
      reasons.push(`${regressions.length} measurement family regression(s)`)
    }
  }

  // ============================================================================
  // PATCH B: Example-level family counts (bonus/penalty)
  // ============================================================================
  const familyRegressionTotal = exampleCounts.spreadRegressed + exampleCounts.beamRegressed + 
    exampleCounts.tineRegressed + exampleCounts.massRegressed
  const familyImprovementTotal = exampleCounts.spreadImproved + exampleCounts.beamImproved + 
    exampleCounts.tineImproved + exampleCounts.massImproved
  
  if (familyRegressionTotal > familyImprovementTotal * 1.5 && familyRegressionTotal > 10) {
    score -= 10
    reasons.push(`Family-level regressions (${familyRegressionTotal}) outpace improvements (${familyImprovementTotal})`)
  } else if (familyImprovementTotal > familyRegressionTotal * 1.5 && familyImprovementTotal > 10) {
    score += 5
    reasons.push(`Family-level improvements (${familyImprovementTotal}) outpace regressions (${familyRegressionTotal})`)
  }

  // ============================================================================
  // Determine final signal
  // ============================================================================
  let signal: PromotionSignal
  let confidenceTier: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'

  // PATCH A+C: Force do_not_promote if any hard fail triggered
  if (forceDoNotPromote) {
    signal = 'do_not_promote'
    confidenceTier = 'very_low'
  } else if (score >= 50) {
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

  // PATCH A: Add protected segment hard fails to gate results
  const protectedSegmentResults = (comparison as Record<string, unknown>).protected_segment_results as ProtectedSegmentResult[] | undefined
  const protectedSegmentHardFails = protectedSegmentResults?.filter(r => r.isHardFail) || []
  
  for (const segFail of protectedSegmentHardFails) {
    gateResults.push({
      criteria_id: `protected_${segFail.segmentKey}`,
      criteria_name: `Protected Segment: ${segFail.segmentName}`,
      criteria_type: 'hard_fail',
      passed: false,
      metric_value: segFail.avgRegressionAmount,
      threshold_value: PROTECTED_SEGMENTS[segFail.segmentKey].regressionThreshold,
      threshold_unit: 'inches',
      message: `PROTECTED SEGMENT HARD FAIL: ${segFail.segmentName} - ${segFail.failReason}`,
    })
    hardFailCount++
  }

  // PATCH C: Add high-confidence regression check to gate results
  const highConfRegressions = (comparison as Record<string, unknown>).high_confidence_regressions as number | undefined || 0
  const highConfTotal = (comparison as Record<string, unknown>).high_confidence_total as number | undefined || 0
  const highConfRate = highConfTotal > 0 ? highConfRegressions / highConfTotal : 0
  
  if (highConfTotal >= 5 && highConfRate >= 0.25) {
    gateResults.push({
      criteria_id: 'high_confidence_regression',
      criteria_name: 'High-Confidence Regression Guard',
      criteria_type: 'hard_fail',
      passed: false,
      metric_value: highConfRate,
      threshold_value: 0.25,
      threshold_unit: 'ratio',
      message: `HIGH-CONFIDENCE REGRESSION: ${(highConfRate * 100).toFixed(0)}% of high-confidence cases regressed (${highConfRegressions}/${highConfTotal})`,
    })
    hardFailCount++
  } else if (highConfTotal >= 5 && highConfRate >= 0.15) {
    gateResults.push({
      criteria_id: 'high_confidence_regression',
      criteria_name: 'High-Confidence Regression Guard',
      criteria_type: 'soft_warning',
      passed: false,
      metric_value: highConfRate,
      threshold_value: 0.15,
      threshold_unit: 'ratio',
      message: `High-confidence regression warning: ${(highConfRate * 100).toFixed(0)}% of high-confidence cases regressed`,
    })
    softWarningCount++
  }

  // Determine overall status
  let overallStatus: PromotionGateStatus
  let statusReason: string

  if (hardFailCount > 0) {
    overallStatus = 'rejected'
    const reasons: string[] = [`${hardFailCount} hard fail(s) detected`]
    if (protectedSegmentHardFails.length > 0) {
      reasons.push(`including ${protectedSegmentHardFails.length} protected segment failure(s)`)
    }
    if (highConfTotal >= 5 && highConfRate >= 0.25) {
      reasons.push('including high-confidence regression hard fail')
    }
    statusReason = reasons.join('; ')
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
        // PATCH A+B+C: Extended gate evaluation details
        protected_segment_results: protectedSegmentResults || [],
        protected_segment_hard_fail_count: protectedSegmentHardFails.length,
        high_confidence_regressions: highConfRegressions,
        high_confidence_total: highConfTotal,
        high_confidence_regression_rate: highConfRate,
        family_level_counts: (comparison as Record<string, unknown>).family_level_counts,
        net_error_counts: (comparison as Record<string, unknown>).net_error_counts,
        confidence_counts: (comparison as Record<string, unknown>).confidence_counts,
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
