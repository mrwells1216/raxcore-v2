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
  /** When > 0, indicates a foreshortening correction was applied. */
  foreshorteningFactor?: number
}

/**
 * Principal 3D axis of each B&C measurement relative to the deer's body frame.
 *   horizontal  — left-right across the face/skull plane (e.g. inside spread)
 *   parasagittal— forward-back in the side plane (main beams curve in this
 *                 plane; G tines mostly live here too)
 *   vertical    — up-down (tine height when tine is roughly skull-vertical)
 *
 * The full 3D geometry is more complex than these three buckets but they're
 * sufficient for a first-order cos(θ) foreshortening correction when only
 * one viewing angle is available.
 */
type PrincipalAxis = 'horizontal' | 'parasagittal' | 'vertical'

const FIELD_PRINCIPAL_AXIS: Record<string, PrincipalAxis> = {
  inside_spread:   'horizontal',
  main_beam_left:  'parasagittal',
  main_beam_right: 'parasagittal',
  // G tines: G1 leans forward, G2-G5 project upward off the beam. Treat as
  // parasagittal-leaning since they live in the side plane; the height
  // component matters less than the projection seen from the side.
  g1_left:  'parasagittal', g1_right: 'parasagittal',
  g2_left:  'parasagittal', g2_right: 'parasagittal',
  g3_left:  'parasagittal', g3_right: 'parasagittal',
  g4_left:  'parasagittal', g4_right: 'parasagittal',
  g5_left:  'parasagittal', g5_right: 'parasagittal',
}

/**
 * cos(θ) for each (image angle, measurement axis) combination, where θ is the
 * angle between the measurement's principal axis and the image plane. Values
 * close to 1.0 mean the measurement projects with little foreshortening;
 * smaller values mean the image dramatically under-represents the true length.
 *
 *   front  view: horizontal measurements are flat in the image plane (~1.0);
 *                parasagittal measurements point toward the camera (~0.35).
 *   side   view: parasagittal measurements are flat in the image plane (~1.0);
 *                horizontal measurements point toward the camera (~0.35).
 *   vertical is always close to 1.0 regardless of horizontal viewing angle.
 */
const COS_THETA: Record<'front' | 'left' | 'right' | 'unknown', Record<PrincipalAxis, number>> = {
  front:   { horizontal: 0.98, parasagittal: 0.35, vertical: 0.95 },
  left:    { horizontal: 0.35, parasagittal: 0.95, vertical: 0.95 },
  right:   { horizontal: 0.35, parasagittal: 0.95, vertical: 0.95 },
  unknown: { horizontal: 0.75, parasagittal: 0.75, vertical: 0.85 },
}

/**
 * Hard clamp on the correction factor (= 1/cos(θ_min)). cos(θ)=0.34 → 2.94×;
 * anything more aggressive amplifies noise more than it recovers signal.
 */
const MAX_FORESHORTENING_FACTOR = 2.94
const MIN_FORESHORTENING_FOR_CORRECTION = 1.10  // skip <10% corrections (noise)

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

    // Foreshortening correction. When both endpoints came from the same image
    // angle, project a cos(θ) recovery factor based on the measurement's
    // principal 3D axis vs the viewing direction. If the endpoints disagree
    // on sourceAngle (cross-image fusion already happened upstream), skip
    // correction — the cross-image fusion is the better signal.
    const axis = FIELD_PRINCIPAL_AXIS[fieldKey]
    let foreshorteningFactor = 1.0
    let angleConfidencePenalty = 1.0
    if (axis && from.sourceAngle === to.sourceAngle && from.sourceAngle !== 'unknown') {
      const cosTheta = COS_THETA[from.sourceAngle][axis]
      if (cosTheta > 0) {
        const rawFactor = 1 / cosTheta
        if (rawFactor >= MIN_FORESHORTENING_FOR_CORRECTION) {
          foreshorteningFactor = Math.min(MAX_FORESHORTENING_FACTOR, rawFactor)
          // Confidence drops as the foreshortening correction grows — the
          // bigger the correction, the more we're relying on a 3D-pose
          // assumption that may not hold for this rack/posture.
          angleConfidencePenalty = cosTheta * cosTheta
        }
      }
    }

    const correctedPx = effectivePx * foreshorteningFactor
    const valueInches = ppiValid ? correctedPx / pixelsPerInch : null
    const combinedConfidence =
      Math.min(from.confidence, to.confidence) * calibrationConfidence * angleConfidencePenalty

    const m: LandmarkMeasurement = {
      fieldKey,
      valuePx: correctedPx,
      valueInches,
      fromLandmark: fromId,
      toLandmark: toId,
      fromConfidence: from.confidence,
      toConfidence: to.confidence,
      combinedConfidence,
      method: 'landmark_pixel_distance',
    }

    if (foreshorteningFactor > 1.0) {
      m.foreshorteningFactor = foreshorteningFactor
      const pct = Math.round((foreshorteningFactor - 1) * 100)
      m.warning = `Foreshortening-corrected (+${pct}%) — measurement axis was angled toward the camera. Use a perpendicular view for higher precision.`
    }

    if (isBeam) {
      const beamNote = `Main beam estimated from straight-line landmark positions with ${curvatureFactor}× curvature correction. Polyline in Advanced Scoring is more precise.`
      m.warning = m.warning ? `${m.warning} ${beamNote}` : beamNote
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
