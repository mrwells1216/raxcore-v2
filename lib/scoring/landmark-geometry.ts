import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import { ANATOMICAL_REFERENCES, maturityFacialScale } from '@/lib/constants'
import type { MaturityClass } from '@/lib/constants'
import type {
  LandmarkDetection,
  AntlerLandmarkId,
  EyeCircleObservation,
  PerImageLandmarkResult,
} from './landmark-detection'

/**
 * Eye-circle anatomical calibration result. See §4.3 of CLAUDE.md.
 *
 * Returned by `eyeCircleToPixelsPerInch` when at least one usable iris
 * observation exists across the per-image detection results. Confidence
 * follows the §8 hierarchy:
 *   - Both eyes agreeing in the same image (front view): up to 0.72
 *   - Single eye, front view: 0.55–0.65
 *   - Single eye, side view: 0.50 (foreshortened iris)
 *   - Cross-image fusion penalties applied via median+MAD.
 */
export interface EyeCirclePpiResult {
  pixelsPerInch: number
  confidence: number
  /** Number of per-image iris observations that survived outlier rejection. */
  contributingObservations: number
  /** Brief human-readable explanation for the UI / debug logs. */
  method: string
  warnings: string[]
}

/**
 * Compute the calibration pixels-per-inch implied by iris radius observations.
 *
 * Per CLAUDE.md §8, this lives at slot 6–7 in the calibration hierarchy
 * (0.50–0.72). It NEVER unlocks Verified Score — it's an anatomical_prior
 * cousin, just with much tighter physiology than skull-spacing priors.
 *
 * Inputs are the per-image landmark results from
 * `detectLandmarkPositionsPerImage`. We fuse with the same median + relative
 * deviation outlier rejection pattern used by `calibration-resolver.ts` so a
 * single bad iris (squinting deer, motion blur) can't drag the consensus.
 *
 * Returns null when no per-image result reported an iris radius.
 */
export function eyeCircleToPixelsPerInch(
  perImage: PerImageLandmarkResult[],
  maturityClass?: MaturityClass | null,
): EyeCirclePpiResult | null {
  const observations: Array<{
    ppi: number
    weight: number
    angle: 'front' | 'left' | 'right' | 'unknown'
    side: 'left' | 'right'
  }> = []

  // Younger bucks have a slightly smaller iris; scale the reference radius down
  // so the same pixel radius maps to the correct (smaller) real size. Adult/
  // unknown ⇒ 1.0 (no change). Ears are never scaled (mature early).
  const irisInches = ANATOMICAL_REFERENCES.IRIS_RADIUS * maturityFacialScale(maturityClass)

  for (const image of perImage) {
    if (image.failed) continue
    const ec: EyeCircleObservation | undefined = image.eyeCircles
    if (!ec) continue

    const angle = image.angleType

    // Front view irises read cleanly; profiles foreshorten the iris circle
    // into an ellipse so a circular radius read is biased downward.
    const angleWeight =
      angle === 'front' ? 1.0 :
      angle === 'left' || angle === 'right' ? 0.55 :
      0.7

    const consider = (radiusPx: number | null, side: 'left' | 'right') => {
      if (!isFiniteNumber(radiusPx) || (radiusPx as number) <= 0) return
      const ppi = (radiusPx as number) / irisInches
      if (!isFiniteNumber(ppi) || ppi <= 0) return
      observations.push({ ppi, weight: angleWeight, angle, side })
    }

    consider(ec.leftRadiusPx, 'left')
    consider(ec.rightRadiusPx, 'right')
  }

  if (observations.length === 0) return null

  const warnings: string[] = []

  // Single observation: nothing to cross-check; cap confidence per §8 row 7.
  if (observations.length === 1) {
    const only = observations[0]
    const baseConfidence =
      only.angle === 'front' ? 0.62 :
      only.angle === 'unknown' ? 0.55 :
      0.50
    return {
      pixelsPerInch: only.ppi,
      confidence: baseConfidence,
      contributingObservations: 1,
      method: `eye-circle (${only.side} iris, ${only.angle})`,
      warnings: ['Single iris observation — no cross-check'],
    }
  }

  // Multi-observation: median + ±25% relative-deviation outlier rejection.
  const sorted = [...observations].map(o => o.ppi).sort((a, b) => a - b)
  const med = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  const survivors = observations.filter(o =>
    med > 0 ? Math.abs(o.ppi - med) / med <= 0.25 : true,
  )

  if (survivors.length === 0) {
    // Degenerate case: pick the highest-weight observation as fallback.
    const best = [...observations].sort((a, b) => b.weight - a.weight)[0]
    warnings.push('Iris observations disagreed by >25%; using highest-weight reading')
    return {
      pixelsPerInch: best.ppi,
      confidence: 0.45,
      contributingObservations: 1,
      method: `eye-circle (fallback, ${best.angle})`,
      warnings,
    }
  }

  const rejected = observations.length - survivors.length
  if (rejected > 0) {
    warnings.push(`Rejected ${rejected} iris outlier${rejected === 1 ? '' : 's'} vs median`)
  }

  const totalWeight = survivors.reduce((s, o) => s + o.weight, 0)
  const fusedPpi = totalWeight > 0
    ? survivors.reduce((s, o) => s + o.ppi * o.weight, 0) / totalWeight
    : med

  // Both eyes agree on one front-view image is the gold case → 0.72 ceiling.
  // Multiple front observations from different images is similar; side-only
  // even with agreement is capped lower because all are foreshortened.
  const hasFront = survivors.some(o => o.angle === 'front')
  const hasBothEyesSameImage = (() => {
    const byImage = new Map<string, Set<'left' | 'right'>>()
    for (const o of survivors) {
      const key = `${o.angle}`
      const cur = byImage.get(key) ?? new Set<'left' | 'right'>()
      cur.add(o.side)
      byImage.set(key, cur)
    }
    return [...byImage.values()].some(s => s.has('left') && s.has('right'))
  })()

  let confidence: number
  if (hasFront && hasBothEyesSameImage) {
    confidence = 0.72
  } else if (hasFront) {
    confidence = 0.66
  } else if (hasBothEyesSameImage) {
    confidence = 0.60
  } else {
    confidence = 0.55
  }

  // Tighten further when survivors are within 8% of each other (high agreement).
  const ppis = survivors.map(o => o.ppi)
  const spread = (Math.max(...ppis) - Math.min(...ppis)) / Math.max(...ppis)
  if (spread > 0 && spread < 0.08 && survivors.length >= 2) {
    confidence = Math.min(0.78, confidence + 0.04)
  }

  return {
    pixelsPerInch: fusedPpi,
    confidence,
    contributingObservations: survivors.length,
    method: `eye-circle (${survivors.length} iris reading${survivors.length === 1 ? '' : 's'})`,
    warnings,
  }
}

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
