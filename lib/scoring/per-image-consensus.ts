/**
 * Per-Image Anatomical Reference Consensus
 *
 * Builds one observation per anatomical reference per image, then fuses across
 * images with median + MAD outlier rejection so a single distorted photo (eye
 * box foreshortened on a side profile, ear-tip pinned back, etc.) can't drag
 * the consensus.
 *
 * This module operates on the coordinate landmarks from
 * detectLandmarkPositionsPerImage. The aggregate reference-consensus.ts engine
 * keeps doing its job on the scoring-call's scalar LandmarksDetected blob —
 * this layer is additive context for the UI and learning flywheel.
 */

import type {
  PerImageReferenceObservation,
  PerReferenceFusion,
  PerImageConsensusResult,
} from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'
import type { LandmarkDetection, AntlerLandmarkId, PerImageLandmarkResult } from './landmark-detection'
import { detectEarPosition, type EarPositionResult } from './ear-position'

// ────────────────────────────────────────────────────────────────────────────
// Reference catalogue: which landmark pairs make each reference's distance
// ────────────────────────────────────────────────────────────────────────────

type RefSpec = {
  label: string
  /** Landmark IDs whose pixel distance is the reference's measurement. */
  endpoints: [AntlerLandmarkId, AntlerLandmarkId]
  /** Known real-world size in inches. */
  realSizeInches: number
  /** Quality ceiling when conditions are nominal (front + clear visibility). */
  qualityCeiling: number
  /** Default distortion when no angle penalty applies. */
  baseDistortion: number
  /** Angles on which this reference is reliable; others get distortion bumps. */
  reliableAngles: ReadonlyArray<'front' | 'left' | 'right'>
}

const REFERENCE_SPECS: RefSpec[] = [
  {
    label: 'eye_box',
    endpoints: ['eye_left', 'eye_right'],
    realSizeInches: ANATOMICAL_REFERENCES.EYE_TO_EYE,
    qualityCeiling: 0.92,
    baseDistortion: 0.10,
    reliableAngles: ['front'],
  },
  {
    label: 'pedicle_spacing',
    endpoints: ['pedicle_left', 'pedicle_right'],
    realSizeInches: ANATOMICAL_REFERENCES.PEDICLE_SPACING,
    qualityCeiling: 0.88,
    baseDistortion: 0.10,
    reliableAngles: ['front'],
  },
  {
    label: 'eye_to_pedicle',
    endpoints: ['eye_left', 'pedicle_left'],
    realSizeInches: ANATOMICAL_REFERENCES.EYE_TO_PEDICLE,
    qualityCeiling: 0.85,
    baseDistortion: 0.12,
    reliableAngles: ['front', 'left', 'right'],
  },
  {
    label: 'skull_width',
    endpoints: ['pedicle_left', 'pedicle_right'],
    realSizeInches: ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH,
    qualityCeiling: 0.83,
    baseDistortion: 0.11,
    reliableAngles: ['front'],
  },
  {
    label: 'nose_bridge',
    endpoints: ['nose_bridge_top', 'nose_tip'],
    realSizeInches: ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH,
    qualityCeiling: 0.68,
    baseDistortion: 0.15,
    reliableAngles: ['front'],
  },
  {
    label: 'ear_base_spacing',
    endpoints: ['ear_base_left', 'ear_base_right'],
    realSizeInches: ANATOMICAL_REFERENCES.EAR_BASE_SPACING,
    qualityCeiling: 0.65,
    baseDistortion: 0.13,
    reliableAngles: ['front'],
  },
  // ear_base_to_tip is added dynamically only when ear-position === 'forward'
]

/** Angle-mismatch distortion bump (added to baseDistortion). */
const ANGLE_PENALTY = 0.18
/** Penalty applied when visibility is partial/occluded for either endpoint. */
const PARTIAL_VISIBILITY_PENALTY = 0.12

// ────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ────────────────────────────────────────────────────────────────────────────

function lm(landmarks: LandmarkDetection[], id: AntlerLandmarkId): LandmarkDetection | undefined {
  return landmarks.find(l => l.id === id)
}

function pxDistance(a: LandmarkDetection, b: LandmarkDetection): number | null {
  if (a.px == null || a.py == null || b.px == null || b.py == null) return null
  const dx = a.px - b.px
  const dy = a.py - b.py
  const d = Math.sqrt(dx * dx + dy * dy)
  return Number.isFinite(d) && d > 0 ? d : null
}

function diagonal(image: PerImageLandmarkResult): number {
  const w = image.imageWidth || 0
  const h = image.imageHeight || 0
  const d = Math.sqrt(w * w + h * h)
  return Number.isFinite(d) && d > 0 ? d : 1
}

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function medianAbsoluteDeviation(values: number[], med: number): number {
  if (values.length === 0) return 0
  const dev = values.map(v => Math.abs(v - med))
  return median(dev)
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length
  return Math.sqrt(variance)
}

// ────────────────────────────────────────────────────────────────────────────
// Per-image observation builder
// ────────────────────────────────────────────────────────────────────────────

function visibilityScore(d: LandmarkDetection | undefined): number {
  if (!d) return 0
  switch (d.visibility) {
    case 'clear': return 1
    case 'partially_visible': return 0.7
    case 'occluded': return 0.4
    case 'not_visible': return 0
  }
}

/**
 * Compute a single image's observation for one reference.
 * Returns null when the reference's endpoints aren't usable in this image.
 */
function observeReferenceInImage(
  spec: RefSpec,
  image: PerImageLandmarkResult,
  scalingFactorOverride?: number,
): PerImageReferenceObservation | null {
  const [endA, endB] = spec.endpoints
  const a = lm(image.landmarks, endA)
  const b = lm(image.landmarks, endB)
  const dist = a && b ? pxDistance(a, b) : null
  if (dist == null) return null

  const visA = visibilityScore(a)
  const visB = visibilityScore(b)
  const visibility = visA > 0 && visB > 0
  if (!visibility) return null

  const angleType = image.angleType
  const angleOk = spec.reliableAngles.includes(angleType as 'front' | 'left' | 'right')
  const anglePenalty = angleOk ? 0 : ANGLE_PENALTY
  const partialPenalty = visA < 1 || visB < 1 ? PARTIAL_VISIBILITY_PENALTY : 0

  const distortion = Math.min(0.95, spec.baseDistortion + anglePenalty + partialPenalty)
  const quality = Math.min(spec.qualityCeiling, ((a?.confidence ?? 0.5) + (b?.confidence ?? 0.5)) / 2 * Math.min(visA, visB))
  const weight = visibility ? quality * (1 - distortion) : 0

  // Pixel distance normalized by image diagonal so cross-image comparison is
  // meaningful even when the photos have different dimensions or crops.
  const normalizedDistance = dist / diagonal(image)
  // Implied pixels per inch from this reference in this image.
  const pixelsPerInch = dist / spec.realSizeInches

  // estimatedGross is left in inches-of-implied-pixelsPerInch so the UI can
  // present "X px = Y px/in (Z inches truth)" — keep the existing field name
  // for compatibility with downstream consumers.
  const estimatedGross = scalingFactorOverride != null
    ? scalingFactorOverride
    : pixelsPerInch

  return {
    imageIndex: image.imageIndex,
    angleType,
    label: spec.label,
    visible: true,
    scalingFactor: normalizedDistance,
    estimatedGross,
    quality,
    distortion,
    weight,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-image fusion + outlier rejection
// ────────────────────────────────────────────────────────────────────────────

const OUTLIER_MAD_MULTIPLIER = 2.5

function fuseAcrossImages(
  label: string,
  observations: PerImageReferenceObservation[],
): PerReferenceFusion {
  const usable = observations.filter(o => o.visible && !o.excludedReason && o.weight > 0)

  if (usable.length === 0) {
    return {
      label,
      observations,
      fusedEstimate: null,
      fusedWeight: 0,
      spread: 0,
      agreementTier: 'fallback',
    }
  }

  // Outlier rejection runs on normalized pixel distance (scalingFactor field
  // carries it) so different image sizes don't confound the comparison.
  const normValues = usable.map(o => o.scalingFactor)
  const med = median(normValues)
  const mad = medianAbsoluteDeviation(normValues, med)
  const cutoff = mad > 0 ? OUTLIER_MAD_MULTIPLIER * mad : 0

  if (usable.length >= 3 && cutoff > 0) {
    for (const obs of usable) {
      if (Math.abs(obs.scalingFactor - med) > cutoff) {
        obs.outlier = true
        obs.weight = 0
        const pctOff = med > 0 ? ((obs.scalingFactor - med) / med) * 100 : 0
        obs.excludedReason = `disagrees with other images by ${pctOff.toFixed(0)}%`
      }
    }
  }

  const survivors = usable.filter(o => !o.outlier && !o.excludedReason)
  if (survivors.length === 0) {
    return {
      label,
      observations,
      fusedEstimate: null,
      fusedWeight: 0,
      spread: stddev(normValues),
      agreementTier: 'fallback',
    }
  }

  const totalWeight = survivors.reduce((s, o) => s + o.weight, 0)
  const fusedEstimate = totalWeight > 0
    ? survivors.reduce((s, o) => s + o.estimatedGross * o.weight, 0) / totalWeight
    : null
  const spread = stddev(survivors.map(o => o.estimatedGross))

  let agreementTier: PerReferenceFusion['agreementTier']
  if (survivors.length === 1) {
    agreementTier = 'medium'
  } else {
    // Relative spread vs fused estimate. <3% = high, <8% = medium, <15% = low.
    const relSpread = fusedEstimate && fusedEstimate > 0 ? spread / fusedEstimate : Infinity
    if (relSpread < 0.03) agreementTier = 'high'
    else if (relSpread < 0.08) agreementTier = 'medium'
    else if (relSpread < 0.15) agreementTier = 'low'
    else agreementTier = 'fallback'
  }

  return {
    label,
    observations,
    fusedEstimate,
    fusedWeight: totalWeight,
    spread,
    agreementTier,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the per-image consensus from a set of per-image landmark detections.
 *
 * Per-reference observations are built from each image's coordinate landmarks,
 * fused with median + MAD outlier rejection, and returned alongside ear-position
 * state. Caller persists the result into predictions.per_image_consensus and
 * surfaces it under the existing reference-row UI.
 */
export function computePerImageConsensus(
  perImageDetections: PerImageLandmarkResult[],
): PerImageConsensusResult {
  const usableImages = perImageDetections.filter(r => !r.failed && r.landmarks.length > 0)

  // Per-image ear position assessments
  const earPositions = usableImages.map((image) => {
    const result: EarPositionResult = detectEarPosition(image.landmarks)
    return {
      imageIndex: image.imageIndex,
      angleType: image.angleType,
      state: result.state,
      ratio: result.ratio,
      reason: result.reason,
    }
  })

  // Build per-reference observation arrays
  const perReference: PerReferenceFusion[] = []
  for (const spec of REFERENCE_SPECS) {
    const observations: PerImageReferenceObservation[] = []
    for (const image of usableImages) {
      const obs = observeReferenceInImage(spec, image)
      if (obs) observations.push(obs)
    }
    perReference.push(fuseAcrossImages(spec.label, observations))
  }

  // ear_base_to_tip: only included for images where ear-position === 'forward'
  const earTipObservations: PerImageReferenceObservation[] = []
  for (const image of usableImages) {
    const ear = earPositions.find(p => p.imageIndex === image.imageIndex)
    const spec: RefSpec = {
      label: 'ear_base_to_tip',
      endpoints: ['ear_base_left', 'ear_tip_left'],
      realSizeInches: ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
      qualityCeiling: 0.72,
      baseDistortion: 0.14,
      reliableAngles: ['front'],
    }
    const obs = observeReferenceInImage(spec, image)
    if (!obs) continue
    if (ear && ear.state !== 'forward') {
      obs.excludedReason = ear.reason || 'ears not in forward pose'
      obs.weight = 0
    }
    earTipObservations.push(obs)
  }
  perReference.push(fuseAcrossImages('ear_base_to_tip', earTipObservations))

  const contributingImageCount = usableImages.filter(image =>
    perReference.some(ref =>
      ref.observations.some(o => o.imageIndex === image.imageIndex && !o.outlier && !o.excludedReason && o.weight > 0),
    ),
  ).length

  return {
    perReference,
    earPositions,
    contributingImageCount,
    computedAt: new Date().toISOString(),
  }
}
