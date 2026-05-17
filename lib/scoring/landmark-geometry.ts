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

/** Known deer eye iris physical dimensions */
const DEER_EYE_IRIS = {
  /** Apparent radius when viewed front-on (inches) */
  frontRadiusInches: 0.55,
  /** Semi-major axis when viewed from side (inches) */
  sideRadiusInches: 0.65,
  /** Minimum plausible radius in pixels to trust detection */
  minRadiusPx: 8,
  /** Maximum plausible radius (very close shot) */
  maxRadiusPx: 200,
}

export interface EyeCircleCalibrationResult {
  pixelsPerInch: number
  eyeUsed: 'eye_left' | 'eye_right' | 'average'
  radiusPxUsed: number
  referenceInches: number
  confidence: number
  isElliptical: boolean
  warnings: string[]
}

/**
 * Derive pixelsPerInch from detected eye iris circle(s).
 * Returns null if no eye landmark has a usable radius.
 */
export function computeCalibrationFromEyeCircle(
  landmarks: LandmarkDetection[],
): EyeCircleCalibrationResult | null {
  const eyes = landmarks.filter(
    (lm) =>
      (lm.id === 'eye_left' || lm.id === 'eye_right') &&
      lm.visibility !== 'not_visible' &&
      lm.confidence >= 0.5 &&
      isFiniteNumber(lm.radiusPx) &&
      (lm.radiusPx as number) >= DEER_EYE_IRIS.minRadiusPx &&
      (lm.radiusPx as number) <= DEER_EYE_IRIS.maxRadiusPx,
  )

  if (eyes.length === 0) return null

  const warnings: string[] = []

  const perEye = eyes.map((eye) => {
    const elliptical = eye.isElliptical === true
    const r = elliptical ? (eye.radiusMajorPx ?? eye.radiusPx!) : (eye.radiusPx as number)
    const refIn = elliptical ? DEER_EYE_IRIS.sideRadiusInches : DEER_EYE_IRIS.frontRadiusInches
    return {
      id: eye.id as 'eye_left' | 'eye_right',
      ppi: r / refIn,
      radiusPx: r,
      refIn,
      confidence: eye.confidence * (elliptical ? 0.85 : 1.0),
      elliptical,
    }
  })

  if (perEye.length === 2) {
    const delta = Math.abs(perEye[0].ppi - perEye[1].ppi) / Math.max(perEye[0].ppi, perEye[1].ppi)
    if (delta > 0.15) {
      warnings.push(
        `Left and right eye radii differ by ${(delta * 100).toFixed(0)}% — using higher-confidence eye only`,
      )
      const best = [...perEye].sort((a, b) => b.confidence - a.confidence)[0]
      return {
        pixelsPerInch: best.ppi,
        eyeUsed: best.id,
        radiusPxUsed: best.radiusPx,
        referenceInches: best.refIn,
        confidence: best.confidence * 0.90,
        isElliptical: best.elliptical,
        warnings,
      }
    }
    const avgPpi = (perEye[0].ppi + perEye[1].ppi) / 2
    const avgConf = (perEye[0].confidence + perEye[1].confidence) / 2
    const avgRadiusPx = (perEye[0].radiusPx + perEye[1].radiusPx) / 2
    return {
      pixelsPerInch: avgPpi,
      eyeUsed: 'average',
      radiusPxUsed: avgRadiusPx,
      referenceInches: (perEye[0].refIn + perEye[1].refIn) / 2,
      confidence: Math.min(0.72, avgConf * 1.05),
      isElliptical: perEye.some((e) => e.elliptical),
      warnings,
    }
  }

  // Single eye
  const e = perEye[0]
  if (e.elliptical) {
    warnings.push('Eye appears elliptical (side profile) — reduced confidence')
  }
  return {
    pixelsPerInch: e.ppi,
    eyeUsed: e.id,
    radiusPxUsed: e.radiusPx,
    referenceInches: e.refIn,
    confidence: e.confidence,
    isElliptical: e.elliptical,
    warnings,
  }
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
