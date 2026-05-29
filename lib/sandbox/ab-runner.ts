/**
 * A/B auto-evaluation: the missing orchestration that chains the existing
 * sandbox pieces into a single "is this candidate better?" run. Given a
 * candidate variant and a benchmark pack, it evaluates both the candidate and
 * the current production variant against the same pack, builds a comparison, and
 * runs the promotion gates — surfacing a single promote / review / reject
 * recommendation.
 *
 * NEVER promotes automatically; it only recommends. Promotion stays a deliberate
 * human action via promoteVariant().
 */

import { getProductionVariant, getScoringVariant } from './variant-registry'
import { createEvaluationRun, executeEvaluationRun } from './evaluation-runner'
import { generateComparison, evaluatePromotionGates } from './promotion-gates'
import { getBenchmarkPack } from '@/lib/benchmark/service'
import type { PromotionGateStatus } from '@/lib/types'

export type AbRecommendation = 'promote' | 'review' | 'reject'

const STATUS_TO_RECOMMENDATION: Record<PromotionGateStatus, AbRecommendation> = {
  eligible: 'promote',
  needs_review: 'review',
  rejected: 'reject',
}

export interface AbEvaluationParams {
  candidateVariantId: string
  benchmarkPackId: string
  /** Defaults to the current production variant. */
  productionVariantId?: string
  createdBy?: string
}

export interface AbEvaluationResult {
  comparisonId: string
  productionVariantId: string
  candidateVariantId: string
  productionEvaluationRunId: string
  candidateEvaluationRunId: string
  gateStatus: PromotionGateStatus
  recommendation: AbRecommendation
  hardFailCount: number
  softWarningCount: number
  statusReason: string
}

export async function runAbEvaluation(
  params: AbEvaluationParams
): Promise<AbEvaluationResult> {
  const candidate = await getScoringVariant(params.candidateVariantId)
  if (!candidate) throw new Error('Candidate variant not found')

  const production = params.productionVariantId
    ? await getScoringVariant(params.productionVariantId)
    : await getProductionVariant()
  if (!production) throw new Error('No production variant to compare against')
  if (production.id === candidate.id) {
    throw new Error('Candidate and production variants must differ')
  }

  const pack = await getBenchmarkPack(params.benchmarkPackId)
  if (!pack) throw new Error('Benchmark pack not found')

  // Evaluate both variants against the SAME benchmark pack.
  const candidateRun = await createEvaluationRun({
    variantId: candidate.id,
    datasetType: 'benchmark_pack',
    benchmarkPackId: params.benchmarkPackId,
    createdBy: params.createdBy,
    notes: 'A/B auto-evaluation (candidate)',
  })
  await executeEvaluationRun(candidateRun.id)

  const productionRun = await createEvaluationRun({
    variantId: production.id,
    datasetType: 'benchmark_pack',
    benchmarkPackId: params.benchmarkPackId,
    createdBy: params.createdBy,
    notes: 'A/B auto-evaluation (production baseline)',
  })
  await executeEvaluationRun(productionRun.id)

  const comparison = await generateComparison(
    production.id,
    candidate.id,
    productionRun.id,
    candidateRun.id,
    {
      datasetType: 'benchmark_pack',
      benchmarkPackId: params.benchmarkPackId,
      createdBy: params.createdBy,
    }
  )

  const gate = await evaluatePromotionGates(comparison.id, params.createdBy)

  return {
    comparisonId: comparison.id,
    productionVariantId: production.id,
    candidateVariantId: candidate.id,
    productionEvaluationRunId: productionRun.id,
    candidateEvaluationRunId: candidateRun.id,
    gateStatus: gate.overall_status,
    recommendation: STATUS_TO_RECOMMENDATION[gate.overall_status],
    hardFailCount: gate.hard_fail_count,
    softWarningCount: gate.soft_warning_count,
    statusReason: gate.status_reason ?? '',
  }
}
