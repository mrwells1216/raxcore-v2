/**
 * Cross-validation for advanced measurements.
 *
 * High confidence is reserved for independent methods that agree within 3%.
 * Verified Score is stricter: each required field needs both photo polyline
 * and point-cloud anchored 3D evidence.
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
import { isFiniteNumber } from './geometry'

const AGREEMENT_THRESHOLD_PERCENT = 3

function disagreementPercent(a: number, b: number): number {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return 100
  const avg = (a + b) / 2
  if (avg <= 0) return 100
  return (Math.abs(a - b) / avg) * 100
}

export function compareMeasurementSources(
  field: MeasurementField,
  measurements: AdvancedMeasurement[],
): CrossValidationResult {
  const sources: SourceValue[] = measurements
    .filter((measurement) =>
      measurement.field === field &&
      measurement.lengthInches !== null &&
      isFiniteNumber(measurement.lengthInches) &&
      measurement.lengthInches > 0,
    )
    .map((measurement) => ({
      method: measurement.method,
      value: measurement.lengthInches as number,
      confidence: computeMeasurementConfidence(measurement),
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
    return {
      field,
      sources,
      bestValue: sources[0].value,
      agreementPercent: 100,
      tier: 'low',
      warning: 'Only one measurement source - add an independent source for cross-validation.',
    }
  }

  const ranked = [...sources].sort((a, b) => {
    if (a.method === 'three_d_mesh_fallback' && b.method !== 'three_d_mesh_fallback') return 1
    if (b.method === 'three_d_mesh_fallback' && a.method !== 'three_d_mesh_fallback') return -1
    return b.confidence - a.confidence
  })
  const bestValue = ranked[0].value

  let maxDelta = 0
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      maxDelta = Math.max(maxDelta, disagreementPercent(sources[i].value, sources[j].value))
    }
  }

  const agreement = Math.max(0, 100 - maxDelta)
  const independentMethodCount = new Set(sources.map((source) => source.method)).size
  const onlyMeshFallbacks = sources.every((source) => source.method === 'three_d_mesh_fallback')

  let tier: CrossValidationTier = 'low'
  let warning: string | null = null

  if (independentMethodCount < 2) {
    warning = 'Independent measurement methods are required for high confidence.'
  } else if (onlyMeshFallbacks) {
    warning = 'All sources are mesh fallback - point cloud required for high confidence.'
  } else if (maxDelta <= AGREEMENT_THRESHOLD_PERCENT) {
    tier = 'high'
  } else if (maxDelta <= 10) {
    const inliers = sources.filter((source) => disagreementPercent(source.value, bestValue) <= AGREEMENT_THRESHOLD_PERCENT)
    tier = inliers.length >= 2 ? 'medium' : 'low'
    warning = `Sources disagree by ${maxDelta.toFixed(1)}% - review outlier measurements.`
  } else {
    warning = `Significant disagreement (${maxDelta.toFixed(1)}%) between sources.`
  }

  return { field, sources, bestValue, agreementPercent: agreement, tier, warning }
}

export const REQUIRED_BC_FIELDS: MeasurementField[] = [
  'main_beam_left',
  'main_beam_right',
  'g1_left',
  'g1_right',
  'g2_left',
  'g2_right',
  'g3_left',
  'g3_right',
  'g4_left',
  'g4_right',
  'h1_left',
  'h1_right',
  'h2_left',
  'h2_right',
  'h3_left',
  'h3_right',
  'h4_left',
  'h4_right',
  'inside_spread',
]

const CIRCUMFERENCE_FIELDS = new Set<MeasurementField>([
  'h1_left', 'h1_right', 'h2_left', 'h2_right',
  'h3_left', 'h3_right', 'h4_left', 'h4_right',
])

export function computeVerifiedScoreStatus(
  session: AdvancedMeasurementSession,
): VerifiedScoreStatus {
  const reasons: string[] = []
  const fieldStatuses: VerifiedScoreStatus['fieldStatuses'] = []

  const cal2D = session.calibration2D
  const cal3D = session.calibration3D

  if (!cal2D && !cal3D) {
    reasons.push('No calibration has been set.')
  }

  if (!cal2D || cal2D.source !== 'physical_reference') {
    reasons.push('Physical 2D reference calibration is required.')
  } else {
    const quality = calibrationQuality(cal2D)
    if (!quality.canVerify) reasons.push(`2D calibration: ${quality.reason}`)
  }

  if (!cal3D || cal3D.source !== 'physical_reference') {
    reasons.push('Physical 3D reference calibration is required.')
  } else {
    const quality = calibrationQuality(cal3D)
    if (!quality.canVerify) reasons.push(`3D calibration: ${quality.reason}`)
  }

  for (const field of REQUIRED_BC_FIELDS) {
    const fieldMeasurements = session.measurements.filter((measurement) => measurement.field === field)
    const result = compareMeasurementSources(field, fieldMeasurements)
    const methods = new Set(result.sources.map((source) => source.method))
    const hasPhoto = methods.has('photo_polyline')
    const hasPointCloud = methods.has('three_d_point_cloud')
    const noLowConfidence = result.sources.every((source) => source.confidence >= 0.5)

    const isCircumferenceField = CIRCUMFERENCE_FIELDS.has(field)
    const meshCircumOk = methods.has('three_d_mesh_circumference') &&
      result.sources.some(s => s.method === 'three_d_mesh_circumference' && s.confidence >= 0.6)
    const hasValidSecondSource = hasPointCloud || (isCircumferenceField && meshCircumOk)

    if (methods.size < 2) {
      fieldStatuses.push({ field, verified: false, reason: 'Fewer than two independent measurement sources.' })
    } else if (!hasPhoto || !hasValidSecondSource) {
      fieldStatuses.push({
        field,
        verified: false,
        reason: isCircumferenceField
          ? 'Verified Score requires photo + point-cloud or photo + mesh-circumference (confidence ≥ 0.6).'
          : 'Verified Score requires both photo and point-cloud sources.',
      })
    } else if (result.tier !== 'high') {
      fieldStatuses.push({ field, verified: false, reason: result.warning ?? 'Sources do not agree within 3%.' })
    } else if (!noLowConfidence) {
      fieldStatuses.push({ field, verified: false, reason: 'At least one source has unacceptably low confidence.' })
    } else {
      fieldStatuses.push({ field, verified: true, reason: 'Photo and point-cloud sources agree within 3%.' })
    }
  }

  if (session.measurements.some((measurement) => measurement.warnings.length > 0)) {
    reasons.push('Session has unresolved measurement warnings.')
  }

  const allFieldsVerified = fieldStatuses.every((status) => status.verified)
  const verified = reasons.length === 0 && allFieldsVerified

  return { verified, reasons, fieldStatuses }
}
