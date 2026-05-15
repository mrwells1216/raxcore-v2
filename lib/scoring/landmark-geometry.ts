import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { LandmarkDetection, AntlerLandmarkId } from './landmark-detection'

export interface LandmarkMeasurement {
  fieldKey: string
  valuePx: number
  valueInches: number | null
  fromLandmark: AntlerLandmarkId
  toLandmark: AntlerLandmarkId
  fromConfidence: number
  toConfidence: number
  combinedConfidence: number
  method: 'landmark_pixel_distance'
  warning?: string
}

export interface LandmarkScoreResult {
  measurements: LandmarkMeasurement[]
  grossScore: number | null
  netScore: number | null
  pixelsPerInch: number | null
  calibrationSource: string
  calibrationConfidence: number
  locatedFieldCount: number
  totalFieldCount: number
  warnings: string[]
}

// Field definitions: fieldKey → [fromId, toId]
const FIELD_PAIRS: Array<[string, AntlerLandmarkId, AntlerLandmarkId]> = [
  ['inside_spread',    'spread_anchor_left',  'spread_anchor_right'],
  ['main_beam_left',   'burr_left',           'beam_tip_left'],
  ['main_beam_right',  'burr_right',          'beam_tip_right'],
  ['g1_left',          'g1_base_left',        'g1_tip_left'],
  ['g1_right',         'g1_base_right',       'g1_tip_right'],
  ['g2_left',          'g2_base_left',        'g2_tip_left'],
  ['g2_right',         'g2_base_right',       'g2_tip_right'],
  ['g3_left',          'g3_base_left',        'g3_tip_left'],
  ['g3_right',         'g3_base_right',       'g3_tip_right'],
  ['g4_left',          'g4_base_left',        'g4_tip_left'],
  ['g4_right',         'g4_base_right',       'g4_tip_right'],
  ['g5_left',          'g5_base_left',        'g5_tip_left'],
  ['g5_right',         'g5_base_right',       'g5_tip_right'],
]

// B&C required fields for gross score computation
const GROSS_FIELDS = [
  'inside_spread',
  'main_beam_left', 'main_beam_right',
  'g1_left', 'g1_right',
  'g2_left', 'g2_right',
  'g3_left', 'g3_right',
]

// Beam measurements are straight-line; real beams curve. Apply correction.
const BEAM_CURVATURE_FIELDS = new Set(['main_beam_left', 'main_beam_right'])
const DEFAULT_BEAM_CURVATURE_FACTOR = 1.10

/**
 * Compute all B&C measurements from detected landmarks.
 * Returns a LandmarkScoreResult; grossScore/netScore are null when
 * calibration is unavailable or too few fields are located.
 */
export function computeMeasurementsFromLandmarks(
  landmarks: LandmarkDetection[],
  pixelsPerInch: number,
  options?: {
    beamCurvatureFactor?: number
    calibrationSource?: string
    calibrationConfidence?: number
  },
): LandmarkScoreResult {
  const curvatureFactor = options?.beamCurvatureFactor ?? DEFAULT_BEAM_CURVATURE_FACTOR
  const calibrationSource = options?.calibrationSource ?? 'unknown'
  const calibrationConfidence = options?.calibrationConfidence ?? 0

  const byId = new Map<AntlerLandmarkId, LandmarkDetection>()
  for (const lm of landmarks) {
    byId.set(lm.id, lm)
  }

  const measurements: LandmarkMeasurement[] = []
  const warnings: string[] = []

  const ppiValid = isFiniteNumber(pixelsPerInch) && pixelsPerInch > 0

  for (const [fieldKey, fromId, toId] of FIELD_PAIRS) {
    const from = byId.get(fromId)
    const to = byId.get(toId)

    if (!from || !to) continue
    if (
      from.px == null || from.py == null ||
      to.px == null || to.py == null ||
      from.visibility === 'not_visible' ||
      to.visibility === 'not_visible'
    ) continue

    const dx = to.px - from.px
    const dy = to.py - from.py
    const valuePx = Math.sqrt(dx * dx + dy * dy)

    if (!isFiniteNumber(valuePx) || valuePx <= 0) continue

    const isBeam = BEAM_CURVATURE_FIELDS.has(fieldKey)
    const effectivePx = isBeam ? valuePx * curvatureFactor : valuePx

    const valueInches = ppiValid ? effectivePx / pixelsPerInch : null
    const combinedConfidence = Math.min(from.confidence, to.confidence) * calibrationConfidence

    const m: LandmarkMeasurement = {
      fieldKey,
      valuePx: effectivePx,
      valueInches,
      fromLandmark: fromId,
      toLandmark: toId,
      fromConfidence: from.confidence,
      toConfidence: to.confidence,
      combinedConfidence,
      method: 'landmark_pixel_distance',
    }

    if (isBeam) {
      m.warning = `Main beam estimated from straight-line landmark positions with ${curvatureFactor}× curvature correction. Polyline in Advanced Scoring is more precise.`
    }

    measurements.push(m)
  }

  // Gross score: sum of located GROSS_FIELDS where valueInches is available
  let grossScore: number | null = null
  const grossMeasurements = measurements.filter(
    (m) => GROSS_FIELDS.includes(m.fieldKey) && m.valueInches != null,
  )

  if (grossMeasurements.length >= 5) {
    grossScore = grossMeasurements.reduce((sum, m) => sum + (m.valueInches ?? 0), 0)
    if (!isFiniteNumber(grossScore) || grossScore <= 0) grossScore = null
  }

  const totalFieldCount = FIELD_PAIRS.length
  const locatedFieldCount = measurements.length

  if (locatedFieldCount < Math.round(totalFieldCount * 0.6)) {
    warnings.push(`Only ${locatedFieldCount}/${totalFieldCount} landmark pairs located — score may be incomplete`)
  }

  if (!ppiValid) {
    warnings.push('No calibration available — inch measurements not computed')
  }

  return {
    measurements,
    grossScore,
    netScore: grossScore,
    pixelsPerInch: ppiValid ? pixelsPerInch : null,
    calibrationSource,
    calibrationConfidence,
    locatedFieldCount,
    totalFieldCount,
    warnings,
  }
}
