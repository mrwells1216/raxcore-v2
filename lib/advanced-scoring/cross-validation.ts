/**
 * lib/advanced-scoring/cross-validation.ts
 *
 * Cross-validation engine: compares measurements from multiple sources for
 * the same field and produces a tier (high / medium / low) and best value.
 *
 * Rules:
 * - high: photo + point_cloud + optional quick_ai agree within 3%
 * - medium: two sources agree, one is outlier
 * - low: significant disagreement or only one source
 * - mesh fallback alone cannot produce high
 * - estimated calibration cannot produce verified score
 */

import type {
  AdvancedMeasurement,
  AdvancedMeasurementSession,
  CrossValidationResult,
  CrossValidationTier,
  MeasurementField,
  SourceValue,
  VerifiedScoreStatus,
} from './types'
import { computeMeasurementConfidence } from './confidence'
import { calibrationQuality } from './calibration'

// ─── Agreement threshold ─────────────────────────────────────────────────────

const AGREEMENT_THRESHOLD_PERCENT = 3

function agreementPercent(a: number, b: number): number {
  const avg = (a + b) / 2
  if (avg === 0) return 0
  return (Math.abs(a - b) / avg) * 100
}

// ─── Per-field cross-validation ───────────────────────────────────────────────

export function compareMeasurementSources(
  field: MeasurementField,
  measurements: AdvancedMeasurement[],
): CrossValidationResult {
  // Gather sources that have a real value
  const sources: SourceValue[] = measurements
    .filter(m => m.field === field && m.lengthInches !== null && m.lengthInches > 0)
    .map(m => ({
      method: m.method,
      value: m.lengthInches as number,
      confidence: computeMeasurementConfidence(m),
    }))

  if (sources.length === 0) {
    return {
      field,
      sources: [],
      bestValue: 0,
      agreementPercent: 0,
      tier: 'low',
      warning: 'No measurements available for this field.',
    }
  }

  if (sources.length === 1) {
    const s = sources[0]
    const tier: CrossValidationTier =
      s.method === 'three_d_mesh_fallback' ? 'low' : 'medium'
    return {
      field,
      sources,
      bestValue: s.value,
      agreementPercent: 100,
      tier,
      warning: sources.length === 1 ? 'Only one measurement source — add a second for cross-validation.' : null,
    }
  }

  // Pick best value: highest-confidence non-mesh source, otherwise highest confidence
  const ranked = [...sources].sort((a, b) => {
    if (a.method === 'three_d_mesh_fallback' && b.method !== 'three_d_mesh_fallback') return 1
    if (b.method === 'three_d_mesh_fallback' && a.method !== 'three_d_mesh_fallback') return -1
    return b.confidence - a.confidence
  })
  const bestValue = ranked[0].value

  // Compute max pairwise agreement deviation
  let maxDelta = 0
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const delta = agreementPercent(sources[i].value, sources[j].value)
      if (delta > maxDelta) maxDelta = delta
    }
  }

  const agreePct = Math.max(0, 100 - maxDelta)
  const onlyMeshFallbacks = sources.every(s => s.method === 'three_d_mesh_fallback')

  let tier: CrossValidationTier
  let warning: string | null = null

  if (onlyMeshFallbacks) {
    tier = 'low'
    warning = 'All sources are mesh fallback — point cloud required for high confidence.'
  } else if (maxDelta <= AGREEMENT_THRESHOLD_PERCENT && sources.length >= 2) {
    tier = 'high'
  } else if (maxDelta <= 10 && sources.length >= 2) {
    // Majority agree
    const inliers = sources.filter(
      s => agreementPercent(s.value, bestValue) <= AGREEMENT_THRESHOLD_PERCENT,
    )
    tier = inliers.length >= 2 ? 'medium' : 'low'
    if (maxDelta > AGREEMENT_THRESHOLD_PERCENT) {
      warning = `Sources disagree by ${maxDelta.toFixed(1)}% — review outlier measurements.`
    }
  } else {
    tier = 'low'
    warning = `Significant disagreement (${maxDelta.toFixed(1)}%) between sources.`
  }

  return { field, sources, bestValue, agreementPercent: agreePct, tier, warning }
}

// ─── Session verified status ──────────────────────────────────────────────────

const REQUIRED_BC_FIELDS: MeasurementField[] = [
  'main_beam_left', 'main_beam_right',
  'g1_left', 'g1_right',
  'g2_left', 'g2_right',
  'g3_left', 'g3_right',
  'g4_left', 'g4_right',
  'h1_left', 'h1_right',
  'h2_left', 'h2_right',
  'h3_left', 'h3_right',
  'h4_left', 'h4_right',
  'inside_spread',
]

export function computeVerifiedScoreStatus(
  session: AdvancedMeasurementSession,
): VerifiedScoreStatus {
  const reasons: string[] = []
  const fieldStatuses: VerifiedScoreStatus['fieldStatuses'] = []

  // 1. Calibration must be physical
  const cal2D = session.calibration2D
  const cal3D = session.calibration3D
  const hasCal = cal2D !== null || cal3D !== null
  if (!hasCal) {
    reasons.push('No calibration has been set.')
  } else {
    if (cal2D && cal2D.source !== 'physical_reference') {
      reasons.push('2D calibration is estimated — physical reference required.')
    }
    if (cal3D && cal3D.source !== 'physical_reference') {
      reasons.push('3D calibration is estimated — physical reference required.')
    }
    if (cal2D) {
      const q = calibrationQuality(cal2D)
      if (!q.canVerify) reasons.push(`2D calibration: ${q.reason}`)
    }
  }

  // 2. Each required field must have at least two independent method sources
  //    and those sources must agree within 3%
  for (const field of REQUIRED_BC_FIELDS) {
    const fieldMeasurements = session.measurements.filter(m => m.field === field)
    const xv = compareMeasurementSources(field, fieldMeasurements)

    const hasAtLeastTwo = xv.sources.length >= 2
    const allAgree = xv.tier === 'high'
    const noLowConf = xv.sources.every(s => s.confidence >= 0.5)

    if (!hasAtLeastTwo) {
      fieldStatuses.push({ field, verified: false, reason: 'Fewer than two independent measurement sources.' })
    } else if (!allAgree) {
      fieldStatuses.push({ field, verified: false, reason: xv.warning ?? 'Sources do not agree within 3%.' })
    } else if (!noLowConf) {
      fieldStatuses.push({ field, verified: false, reason: 'At least one source has unacceptably low confidence.' })
    } else {
      fieldStatuses.push({ field, verified: true, reason: 'Two+ sources agree within 3%.' })
    }
  }

  // 3. Any unresolved warnings prevent verification
  const hasUnresolvedWarnings = session.measurements.some(m => m.warnings.length > 0)
  if (hasUnresolvedWarnings) {
    reasons.push('Session has unresolved measurement warnings.')
  }

  const allFieldsVerified = fieldStatuses.every(f => f.verified)
  const noCalIssues = reasons.length === 0

  const verified = allFieldsVerified && noCalIssues && !hasUnresolvedWarnings

  return { verified, reasons, fieldStatuses }
}
