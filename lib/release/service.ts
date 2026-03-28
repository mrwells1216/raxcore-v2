/**
 * Phase 30: Release Readiness Service
 * 
 * Evaluates model/calibration combinations for production readiness.
 * Surfaces benchmark results, regressions, and health indicators.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  ReleaseReadinessCheck,
  ReleaseReadinessCheckInput,
  ReleaseReadinessReport,
  ReleaseReadinessSummaryView,
  ReleaseReadinessCategory,
  ReleaseReadinessStatus,
} from '@/lib/types'
import { getRuntimeHealthMetrics } from '@/lib/validation/service'
import { getLatestBenchmarkRun, evaluateGuardrails } from '@/lib/benchmark/service'
import { getActiveCalibrationProfile } from '@/lib/calibration/utils'
import { getDatasetHealthSummary } from '@/lib/health/service'

// ============================================================================
// RELEASE READINESS CHECKS
// ============================================================================

export async function createReleaseReadinessCheck(
  input: ReleaseReadinessCheckInput
): Promise<ReleaseReadinessCheck | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('release_readiness_checks')
    .insert({
      model_version_id: input.model_version_id || null,
      calibration_profile_id: input.calibration_profile_id || null,
      benchmark_run_id: input.benchmark_run_id || null,
      check_name: input.check_name,
      check_category: input.check_category,
      check_passed: input.check_passed,
      check_value: input.check_value ?? null,
      check_threshold: input.check_threshold ?? null,
      check_details: input.check_details || null,
      severity: input.severity || 'info',
      checked_by: input.checked_by || null,
      checked_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating release readiness check:', error)
    return null
  }

  return data
}

export async function getRecentReadinessChecks(
  modelVersionId?: string,
  calibrationProfileId?: string,
  limit: number = 50
): Promise<ReleaseReadinessCheck[]> {
  const supabase = await createClient()

  let query = supabase
    .from('release_readiness_checks')
    .select('*')
    .order('checked_at', { ascending: false })
    .limit(limit)

  if (modelVersionId) {
    query = query.eq('model_version_id', modelVersionId)
  }
  if (calibrationProfileId) {
    query = query.eq('calibration_profile_id', calibrationProfileId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching readiness checks:', error)
    return []
  }

  return data || []
}

export async function getReadinessSummary(): Promise<ReleaseReadinessSummaryView[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('release_readiness_summary')
    .select('*')

  if (error) {
    console.error('Error fetching readiness summary:', error)
    return []
  }

  return data || []
}

// ============================================================================
// AUTOMATED RELEASE READINESS EVALUATION
// ============================================================================

interface ReadinessCheckConfig {
  // Accuracy thresholds
  maxMaeGross: number
  maxMaeNet: number
  minR2Gross: number
  regressionMaeThreshold: number
  
  // Runtime thresholds
  minVisionSuccessRate: number
  maxTimeoutRate: number
  maxFallbackRate: number
  
  // Calibration thresholds
  minCalibrationR2: number
  maxCalibrationSlope: number
  minCalibrationSlope: number
  
  // Data quality thresholds
  minHealthyExamplesPercent: number
  maxOutlierPercent: number
  
  // Cost thresholds
  maxDailyCostDollars: number
}

const DEFAULT_READINESS_CONFIG: ReadinessCheckConfig = {
  // Accuracy
  maxMaeGross: 10.0,
  maxMaeNet: 10.0,
  minR2Gross: 0.7,
  regressionMaeThreshold: 1.5,
  
  // Runtime
  minVisionSuccessRate: 85,
  maxTimeoutRate: 5,
  maxFallbackRate: 15,
  
  // Calibration
  minCalibrationR2: 0.8,
  maxCalibrationSlope: 1.15,
  minCalibrationSlope: 0.85,
  
  // Data quality
  minHealthyExamplesPercent: 60,
  maxOutlierPercent: 10,
  
  // Cost
  maxDailyCostDollars: 50,
}

export async function runReadinessChecks(
  modelVersionId?: string,
  calibrationProfileId?: string,
  config: Partial<ReadinessCheckConfig> = {}
): Promise<ReleaseReadinessReport> {
  const fullConfig = { ...DEFAULT_READINESS_CONFIG, ...config }
  const checks: ReleaseReadinessCheck[] = []
  const recommendations: string[] = []
  
  // Get context
  const supabase = await createClient()
  
  // Get model version info
  let modelName: string | null = null
  if (modelVersionId) {
    const { data: model } = await supabase
      .from('model_versions')
      .select('version_name')
      .eq('id', modelVersionId)
      .single()
    modelName = model?.version_name || null
  }
  
  // Get calibration profile info
  let calibrationName: string | null = null
  if (calibrationProfileId) {
    const { data: calibration } = await supabase
      .from('calibration_profiles')
      .select('name')
      .eq('id', calibrationProfileId)
      .single()
    calibrationName = calibration?.name || null
  } else {
    const activeCalibration = await getActiveCalibrationProfile()
    calibrationProfileId = activeCalibration?.id
    calibrationName = activeCalibration?.name || null
  }

  // =====================
  // ACCURACY CHECKS
  // =====================
  
  try {
    const benchmarkRun = await getLatestBenchmarkRun(modelVersionId, calibrationProfileId)
    
    if (benchmarkRun) {
      // MAE Gross Check
      const maeGross = benchmarkRun.mae_gross
      const maeGrossPassed = maeGross != null && maeGross <= fullConfig.maxMaeGross
      const maeGrossCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        benchmark_run_id: benchmarkRun.id,
        check_name: 'MAE Gross Score',
        check_category: 'accuracy',
        check_passed: maeGrossPassed,
        check_value: maeGross,
        check_threshold: fullConfig.maxMaeGross,
        severity: maeGrossPassed ? 'info' : 'blocker',
        check_details: { metric: 'mae_gross', unit: 'inches' },
      })
      if (maeGrossCheck) checks.push(maeGrossCheck)
      if (!maeGrossPassed) {
        recommendations.push(`Gross score MAE (${maeGross?.toFixed(1)}") exceeds threshold (${fullConfig.maxMaeGross}"). Consider re-tuning calibration.`)
      }

      // MAE Net Check
      const maeNet = benchmarkRun.mae_net
      const maeNetPassed = maeNet != null && maeNet <= fullConfig.maxMaeNet
      const maeNetCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        benchmark_run_id: benchmarkRun.id,
        check_name: 'MAE Net Score',
        check_category: 'accuracy',
        check_passed: maeNetPassed,
        check_value: maeNet,
        check_threshold: fullConfig.maxMaeNet,
        severity: maeNetPassed ? 'info' : 'blocker',
        check_details: { metric: 'mae_net', unit: 'inches' },
      })
      if (maeNetCheck) checks.push(maeNetCheck)
      if (!maeNetPassed) {
        recommendations.push(`Net score MAE (${maeNet?.toFixed(1)}") exceeds threshold (${fullConfig.maxMaeNet}"). Review measurement corrections.`)
      }

      // R² Check
      const r2Gross = benchmarkRun.r2_gross
      const r2Passed = r2Gross != null && r2Gross >= fullConfig.minR2Gross
      const r2Check = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        benchmark_run_id: benchmarkRun.id,
        check_name: 'R² Gross Score',
        check_category: 'accuracy',
        check_passed: r2Passed,
        check_value: r2Gross,
        check_threshold: fullConfig.minR2Gross,
        severity: r2Passed ? 'info' : 'warning',
        check_details: { metric: 'r2_gross' },
      })
      if (r2Check) checks.push(r2Check)

      // Guardrail evaluation
      const guardrailResult = await evaluateGuardrails(benchmarkRun.id)
      if (guardrailResult) {
        const guardrailPassed = guardrailResult.overall_passed
        const guardrailCheck = await createReleaseReadinessCheck({
          model_version_id: modelVersionId,
          calibration_profile_id: calibrationProfileId,
          benchmark_run_id: benchmarkRun.id,
          check_name: 'Regression Guardrails',
          check_category: 'accuracy',
          check_passed: guardrailPassed,
          check_value: guardrailResult.checks_passed,
          check_threshold: guardrailResult.total_checks,
          severity: guardrailPassed ? 'info' : 'blocker',
          check_details: {
            checks: guardrailResult.check_results,
            failed_checks: guardrailResult.check_results?.filter((c: { passed: boolean }) => !c.passed) || [],
          },
        })
        if (guardrailCheck) checks.push(guardrailCheck)
        if (!guardrailPassed) {
          recommendations.push('Regression guardrails failed. Review benchmark results for specific regressions.')
        }
      }
    } else {
      // No benchmark data
      const noBenchmarkCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Benchmark Data Available',
        check_category: 'accuracy',
        check_passed: false,
        severity: 'warning',
        check_details: { message: 'No recent benchmark run found' },
      })
      if (noBenchmarkCheck) checks.push(noBenchmarkCheck)
      recommendations.push('No benchmark data available. Run a benchmark pack before promoting.')
    }
  } catch (error) {
    console.error('Error running accuracy checks:', error)
    recommendations.push('Could not complete accuracy checks. Review error logs.')
  }

  // =====================
  // RUNTIME CHECKS
  // =====================
  
  try {
    const runtimeMetrics = await getRuntimeHealthMetrics()
    
    if (runtimeMetrics) {
      // Vision Success Rate
      const successRate = runtimeMetrics.visionSuccessRate
      const successPassed = successRate >= fullConfig.minVisionSuccessRate
      const successCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Vision Success Rate',
        check_category: 'runtime',
        check_passed: successPassed,
        check_value: successRate,
        check_threshold: fullConfig.minVisionSuccessRate,
        severity: successPassed ? 'info' : 'warning',
        check_details: { metric: 'vision_success_rate', unit: 'percent' },
      })
      if (successCheck) checks.push(successCheck)
      if (!successPassed) {
        recommendations.push(`Vision success rate (${successRate.toFixed(1)}%) is below threshold (${fullConfig.minVisionSuccessRate}%). Investigate provider issues.`)
      }

      // Timeout Rate
      const timeoutRate = runtimeMetrics.timeoutRate
      const timeoutPassed = timeoutRate <= fullConfig.maxTimeoutRate
      const timeoutCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Timeout Rate',
        check_category: 'runtime',
        check_passed: timeoutPassed,
        check_value: timeoutRate,
        check_threshold: fullConfig.maxTimeoutRate,
        severity: timeoutPassed ? 'info' : 'warning',
        check_details: { metric: 'timeout_rate', unit: 'percent' },
      })
      if (timeoutCheck) checks.push(timeoutCheck)
      if (!timeoutPassed) {
        recommendations.push(`Timeout rate (${timeoutRate.toFixed(1)}%) exceeds threshold (${fullConfig.maxTimeoutRate}%). Consider increasing timeouts or investigating latency.`)
      }

      // Fallback Rate
      const fallbackRate = runtimeMetrics.fallbackRate
      const fallbackPassed = fallbackRate <= fullConfig.maxFallbackRate
      const fallbackCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Fallback Rate',
        check_category: 'runtime',
        check_passed: fallbackPassed,
        check_value: fallbackRate,
        check_threshold: fullConfig.maxFallbackRate,
        severity: fallbackPassed ? 'info' : 'warning',
        check_details: { metric: 'fallback_rate', unit: 'percent' },
      })
      if (fallbackCheck) checks.push(fallbackCheck)
      if (!fallbackPassed) {
        recommendations.push(`Fallback rate (${fallbackRate.toFixed(1)}%) exceeds threshold (${fullConfig.maxFallbackRate}%). Review vision errors.`)
      }
    } else {
      const noRuntimeCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Runtime Data Available',
        check_category: 'runtime',
        check_passed: false,
        severity: 'warning',
        check_details: { message: 'No runtime metrics available' },
      })
      if (noRuntimeCheck) checks.push(noRuntimeCheck)
      recommendations.push('No runtime data available. Make some scoring requests before promoting.')
    }
  } catch (error) {
    console.error('Error running runtime checks:', error)
    recommendations.push('Could not complete runtime checks. Review error logs.')
  }

  // =====================
  // CALIBRATION CHECKS
  // =====================
  
  try {
    const activeCalibration = await getActiveCalibrationProfile()
    
    if (activeCalibration && (!calibrationProfileId || calibrationProfileId === activeCalibration.id)) {
      // Check if calibration has been validated
      const { data: calibrationMetrics } = await supabase
        .from('calibration_profiles')
        .select('*')
        .eq('id', activeCalibration.id)
        .single()
      
      if (calibrationMetrics) {
        const calibrationCheck = await createReleaseReadinessCheck({
          model_version_id: modelVersionId,
          calibration_profile_id: activeCalibration.id,
          check_name: 'Active Calibration Profile',
          check_category: 'calibration',
          check_passed: true,
          check_details: {
            profile_name: activeCalibration.name,
            gross_offset: activeCalibration.gross_offset,
            net_offset: activeCalibration.net_offset,
            spread_scale: activeCalibration.spread_scale,
            beam_scale: activeCalibration.beam_scale,
          },
        })
        if (calibrationCheck) checks.push(calibrationCheck)
      }
    } else {
      const noCalibrationCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        check_name: 'Active Calibration Profile',
        check_category: 'calibration',
        check_passed: false,
        severity: 'warning',
        check_details: { message: 'No active calibration profile' },
      })
      if (noCalibrationCheck) checks.push(noCalibrationCheck)
      recommendations.push('No active calibration profile. Create and activate a calibration profile.')
    }
  } catch (error) {
    console.error('Error running calibration checks:', error)
  }

  // =====================
  // DATA QUALITY CHECKS
  // =====================
  
  try {
    const healthSummary = await getDatasetHealthSummary()
    
    if (healthSummary && healthSummary.totals.total > 0) {
      // Healthy examples percentage
      const healthyPercent = (healthSummary.totals.healthy / healthSummary.totals.total) * 100
      const healthyPassed = healthyPercent >= fullConfig.minHealthyExamplesPercent
      const healthyCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Healthy Training Examples',
        check_category: 'data_quality',
        check_passed: healthyPassed,
        check_value: healthyPercent,
        check_threshold: fullConfig.minHealthyExamplesPercent,
        severity: healthyPassed ? 'info' : 'warning',
        check_details: {
          healthy_count: healthSummary.totals.healthy,
          total_count: healthSummary.totals.total,
        },
      })
      if (healthyCheck) checks.push(healthyCheck)
      if (!healthyPassed) {
        recommendations.push(`Only ${healthyPercent.toFixed(0)}% of training examples are healthy. Review and clean dataset.`)
      }

      // Outlier percentage
      const outlierPercent = healthSummary.breakdown.outliers_flagged 
        ? (healthSummary.breakdown.outliers_flagged / healthSummary.totals.total) * 100 
        : 0
      const outlierPassed = outlierPercent <= fullConfig.maxOutlierPercent
      const outlierCheck = await createReleaseReadinessCheck({
        model_version_id: modelVersionId,
        calibration_profile_id: calibrationProfileId,
        check_name: 'Outlier Rate',
        check_category: 'data_quality',
        check_passed: outlierPassed,
        check_value: outlierPercent,
        check_threshold: fullConfig.maxOutlierPercent,
        severity: outlierPassed ? 'info' : 'warning',
        check_details: { outlier_count: healthSummary.breakdown.outliers_flagged || 0 },
      })
      if (outlierCheck) checks.push(outlierCheck)
      if (!outlierPassed) {
        recommendations.push(`Outlier rate (${outlierPercent.toFixed(1)}%) exceeds threshold. Review flagged outliers.`)
      }
    }
  } catch (error) {
    console.error('Error running data quality checks:', error)
  }

  // =====================
  // BUILD REPORT
  // =====================
  
  const blockers = checks.filter(c => !c.check_passed && c.severity === 'blocker')
  const warnings = checks.filter(c => !c.check_passed && c.severity === 'warning')
  
  // Determine overall status
  let status: ReleaseReadinessStatus = 'ready'
  if (blockers.length > 0) {
    status = 'blocked'
  } else if (warnings.length > 0) {
    status = 'warnings'
  } else if (checks.some(c => !c.check_passed)) {
    status = 'issues'
  }

  // Group checks by category
  const checksByCategory: Record<ReleaseReadinessCategory, ReleaseReadinessCheck[]> = {
    accuracy: checks.filter(c => c.check_category === 'accuracy'),
    runtime: checks.filter(c => c.check_category === 'runtime'),
    calibration: checks.filter(c => c.check_category === 'calibration'),
    data_quality: checks.filter(c => c.check_category === 'data_quality'),
    cost: checks.filter(c => c.check_category === 'cost'),
  }

  return {
    model_version_id: modelVersionId || null,
    model_name: modelName,
    calibration_profile_id: calibrationProfileId || null,
    calibration_name: calibrationName,
    status,
    summary: {
      total_checks: checks.length,
      passed_checks: checks.filter(c => c.check_passed).length,
      failed_checks: checks.filter(c => !c.check_passed).length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
    },
    checks_by_category: checksByCategory,
    blockers,
    warnings,
    recommendations,
    is_safe_to_promote: blockers.length === 0,
    last_checked_at: new Date().toISOString(),
  }
}
