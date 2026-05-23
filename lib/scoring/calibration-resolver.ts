import 'server-only'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { LandmarkDetection, PerImageLandmarkResult } from './landmark-detection'
import type { DepthCalibrationResult } from '@/lib/calibration/depth-calibration'
// Use the canonical anatomical constants from lib/constants.ts. Keeping a local
// copy here drifted out of sync with the per-image consensus engine and produced
// different px/in values from the same pixel measurement (eye-to-eye was 4.3"
// in the consensus engine but 3.5" here).
import { ANATOMICAL_REFERENCES } from '@/lib/constants'
import { eyeCircleToPixelsPerInch } from './landmark-geometry'
import type { ArucoDetection } from './aruco-types'
import {
  analyzeVanishingPoint,
  comparePerspectiveTilt,
} from './vanishing-point-geometry'
import type { ParallelLinePair } from './vanishing-point-types'

/**
 * Calibration source values. Aligns with §8 of CLAUDE.md.
 * - `depth_map_lidar`: priority 2 (iPhone Pro LiDAR + EXIF)
 * - `aruco_marker`: priority 3 (GPT-4o detected printed ArUco marker)
 * - `user_placed_known`: priority 4 (user dragged pedicle dots + their own measured spacing)
 * - `user_placed_anatomical`: priority 5 (user dragged pedicle dots, avg 3.8" spacing)
 * - `reference_object`: priority 9–10 (ring/hat/ruler — never primary)
 * - `eye_circle_anatomical`: priority 6–7 (whitetail iris diameter)
 * - `anatomical_prior`: priority 8 (eye-to-eye, pedicle spacing, etc.)
 * - `vanishing_point`: priority 11 (cross-check only, surfaces perspective warning)
 *
 * Each source must NOT report `physical_reference` — that's reserved for user
 * ruler/tape (the only source that unlocks Verified Score per
 * `lib/advanced-scoring/cross-validation.ts`).
 */
export type CalibrationSourceTag =
  | 'depth_map_lidar'
  | 'aruco_marker'
  | 'user_placed_known'
  | 'user_placed_anatomical'
  | 'reference_object'
  | 'eye_circle_anatomical'
  | 'anatomical_prior'
  | 'vanishing_point'

/**
 * Per-image pedicle dot placement from the user. Pixel coords are in the
 * coordinate space of the source image (NOT the canvas), so the UI must
 * translate from canvas-px to image-px before sending (see
 * `LandmarkOverlay`'s letterbox/pillarbox math, §3.17).
 */
export interface PedicleCalibrationInput {
  imageIndex: number
  leftPx: number
  leftPy: number
  rightPx: number
  rightPy: number
  /** When provided, the user has physically measured this pair on the skull.
   *  Clamped to a sane band server-side (see PEDICLE_KNOWN_INCHES_*). */
  knownInches?: number | null
}

/** Average adult whitetail pedicle spacing in inches; matches PEDICLE_SPACING
 *  in lib/constants.ts. Used as the default when no known measurement is given. */
const DEFAULT_PEDICLE_SPACING_INCHES = ANATOMICAL_REFERENCES.PEDICLE_SPACING
const PEDICLE_KNOWN_INCHES_MIN = 2.0
const PEDICLE_KNOWN_INCHES_MAX = 8.0

export interface CalibrationResult {
  pixelsPerInch: number
  source: CalibrationSourceTag
  confidence: number
  method: string
  warnings: string[]
}

export interface ReferenceObjectInput {
  type: 'ring' | 'hat' | 'ruler' | 'none'
  knownSizeInches: number | null
  pixelSize: number | null
}

/**
 * Resolve the best available pixelsPerInch calibration.
 *
 * Priority (mirrors §8 of CLAUDE.md):
 *   1. LiDAR depth map + EXIF
 *   2. Reference object (ring, hat, ruler) when explicitly provided by user
 *   3. Eye-circle anatomical (iris radius vs IRIS_RADIUS constant) — only fires
 *      when per-image iris observations are present
 *   4. Anatomical priors (eye spacing, pedicle spacing)
 *
 * Eye-circle is placed above the legacy anatomical_prior path because its
 * physiology is far tighter (iris diameter varies <10% between adult bucks
 * versus ~20% for eye-to-eye spacing). It still NEVER unlocks Verified Score —
 * only `physical_reference` does.
 */
export interface ArucoResolverInput {
  detections: ArucoDetection[]
  /** Physical marker side length in inches as supplied by the user. */
  knownSideInches: number
}

export function resolveCalibration(
  landmarks: LandmarkDetection[],
  depthCalibration: DepthCalibrationResult | null,
  referenceObject: ReferenceObjectInput | null,
  perImageLandmarks?: PerImageLandmarkResult[],
  pedicleCalibrations?: PedicleCalibrationInput[] | null,
  aruco?: ArucoResolverInput | null,
): CalibrationResult | null {
  // Priority 1: LiDAR depth calibration
  if (
    depthCalibration &&
    isFiniteNumber(depthCalibration.pixelsPerInch) &&
    depthCalibration.pixelsPerInch > 0 &&
    depthCalibration.confidence > 0.4
  ) {
    return {
      pixelsPerInch: depthCalibration.pixelsPerInch,
      source: 'depth_map_lidar',
      confidence: depthCalibration.confidence,
      method: `LiDAR depth at ${depthCalibration.subjectDistanceMeters.toFixed(2)}m`,
      warnings: depthCalibration.warnings,
    }
  }

  // Priority 2: ArUco marker (printed by user, GPT-4o detected). §8 slot 3.
  // Confidence 0.55–0.72 depending on perspective skew (cosTilt).
  if (aruco && aruco.detections && aruco.detections.length > 0) {
    const arucoResult = resolveAruco(aruco)
    if (arucoResult) return arucoResult
  }

  // Priority 3: User-placed pedicle dots. §8 slots 4–5. user_placed_known
  // (0.85) when every observation came with a measured spacing; falls back to
  // user_placed_anatomical (0.68) using the 3.8" whitetail average.
  if (pedicleCalibrations && pedicleCalibrations.length > 0) {
    const pedicleResult = resolvePedicleDots(pedicleCalibrations)
    if (pedicleResult) return pedicleResult
  }

  // Priority 4: Reference object
  if (
    referenceObject &&
    referenceObject.type !== 'none' &&
    isFiniteNumber(referenceObject.knownSizeInches) &&
    referenceObject.knownSizeInches > 0 &&
    isFiniteNumber(referenceObject.pixelSize) &&
    referenceObject.pixelSize > 0
  ) {
    const pixelsPerInch = referenceObject.pixelSize / referenceObject.knownSizeInches
    const confidence = referenceObject.type === 'ruler' ? 0.75
      : referenceObject.type === 'ring' ? 0.45
      : 0.40

    return {
      pixelsPerInch,
      source: 'reference_object',
      confidence,
      method: `${referenceObject.type} reference (${referenceObject.knownSizeInches}" known)`,
      warnings: [],
    }
  }

  // Priority 3: Eye-circle anatomical (iris radius from per-image detection).
  // Tighter physiology than skull-spacing priors so it sits above the legacy
  // anatomical_prior path. Only fires when at least one per-image result
  // reported an iris radius (model populates them via the §4.3 prompt extension).
  if (perImageLandmarks && perImageLandmarks.length > 0) {
    const eyeCircle = eyeCircleToPixelsPerInch(perImageLandmarks)
    if (
      eyeCircle &&
      isFiniteNumber(eyeCircle.pixelsPerInch) &&
      eyeCircle.pixelsPerInch > 0
    ) {
      return {
        pixelsPerInch: eyeCircle.pixelsPerInch,
        source: 'eye_circle_anatomical',
        confidence: eyeCircle.confidence,
        method: eyeCircle.method,
        warnings: eyeCircle.warnings,
      }
    }
  }

  // Priority 4: Anatomical priors from landmarks (legacy fallback)
  return resolveAnatomicalPrior(landmarks)
}

/**
 * Vanishing-point cross-check. Pulls parallel-line pairs from the per-image
 * landmark results (when the model reported any), runs the geometry analysis,
 * and compares against the primary resolved tilt. Returns the appended
 * warnings — caller decides where to surface them.
 *
 * Per CLAUDE.md §4.7, VP NEVER overrides the primary calibration. It only
 * surfaces a warning when the implied perspective disagrees by >35% (warn)
 * or >50% (critical). Returns an empty array when no parallel-line pairs were
 * supplied or the math degenerated.
 */
export function computeVanishingPointWarnings(
  perImageLandmarks: PerImageLandmarkResult[] | undefined,
  primary: CalibrationResult | null,
): string[] {
  if (!perImageLandmarks || perImageLandmarks.length === 0) return []
  if (!primary) return []

  const warnings: string[] = []
  for (const image of perImageLandmarks) {
    if (image.failed) continue
    const pairs = image.parallelLinePairs
    if (!pairs || pairs.length === 0) continue

    const vpPairs: ParallelLinePair[] = pairs.map(p => ({
      label: p.label,
      line1: [{ x: p.line1[0].x, y: p.line1[0].y }, { x: p.line1[1].x, y: p.line1[1].y }],
      line2: [{ x: p.line2[0].x, y: p.line2[0].y }, { x: p.line2[1].x, y: p.line2[1].y }],
    }))

    const result = analyzeVanishingPoint(vpPairs, image.imageWidth || 0, image.imageHeight || 0)
    // Translate the primary's expected perspective into a tilt-degrees proxy.
    // LiDAR and reference_object assume orthogonal (0°); ArUco encodes its
    // own cosTilt; anatomical/eye_circle/user-placed all assume close-to-
    // orthogonal so we use the image angleType as a rough guide.
    const primaryTilt = inferPrimaryTilt(primary, image.angleType)
    const disagreement = comparePerspectiveTilt(result, primaryTilt)
    if (disagreement) {
      warnings.push(`Image ${image.imageIndex}: ${disagreement.message}`)
    }
  }
  return warnings
}

function inferPrimaryTilt(
  primary: CalibrationResult,
  angleType: 'front' | 'left' | 'right' | 'unknown',
): number {
  // Assume orthogonal-or-close for these primary sources; the angleType
  // anchor adjusts when the photo is a side profile.
  if (primary.source === 'depth_map_lidar') return 0
  if (primary.source === 'aruco_marker') return 0 // ArUco's cosTilt is already baked into its confidence
  if (angleType === 'left' || angleType === 'right') return 25
  return 5
}

/**
 * Compute calibration from one or more ArUco marker detections.
 *
 * Per-image PPI = avgSidePx / knownSideInches. Multiple images fuse with
 * median + ±25% outlier rejection. Confidence floor 0.55, ceiling 0.72,
 * driven by the worst cosTilt across surviving detections (the more skewed
 * the marker, the less reliable the side length read).
 */
function resolveAruco(input: ArucoResolverInput): CalibrationResult | null {
  const { detections, knownSideInches } = input

  if (!isFiniteNumber(knownSideInches) || knownSideInches <= 0) return null
  const sideInches = Math.max(0.5, Math.min(12.0, knownSideInches))

  const ppis: number[] = []
  const cosTilts: number[] = []
  const warnings: string[] = []
  const perDetectionWarnings: string[] = []

  for (const d of detections) {
    if (!isFiniteNumber(d.avgSidePx) || d.avgSidePx <= 0) continue
    if (!isFiniteNumber(d.cosTilt) || d.cosTilt <= 0) continue
    const ppi = d.avgSidePx / sideInches
    if (!isFiniteNumber(ppi) || ppi <= 0) continue
    ppis.push(ppi)
    cosTilts.push(d.cosTilt)
    for (const w of d.warnings) perDetectionWarnings.push(`image ${d.imageIndex}: ${w}`)
  }

  if (ppis.length === 0) return null

  // Outlier rejection across images.
  const sorted = [...ppis].sort((a, b) => a - b)
  const med = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  const survivorIndices = ppis
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (med > 0 ? Math.abs(p - med) / med <= 0.25 : true))
    .map(({ i }) => i)

  if (survivorIndices.length === 0) return null

  const survivorPpis = survivorIndices.map(i => ppis[i])
  const survivorCos = survivorIndices.map(i => cosTilts[i])

  const fusedPpi = survivorPpis.reduce((s, v) => s + v, 0) / survivorPpis.length
  const worstCos = Math.min(...survivorCos)

  // Confidence: lerp from 0.55 (cosTilt=0.5) to 0.72 (cosTilt=1.0).
  // Below cosTilt 0.5, confidence is clamped at 0.55 — anything that
  // foreshortened ought to be flagged but still usable as a coarse anchor.
  const clampedCos = Math.max(0.5, Math.min(1.0, worstCos))
  const confidence = 0.55 + (clampedCos - 0.5) * (0.72 - 0.55) / 0.5

  const rejected = ppis.length - survivorIndices.length
  if (rejected > 0) {
    warnings.push(`Rejected ${rejected} ArUco outlier${rejected === 1 ? '' : 's'} vs median`)
  }
  warnings.push(...perDetectionWarnings)

  return {
    pixelsPerInch: fusedPpi,
    source: 'aruco_marker',
    confidence,
    method: `ArUco marker (${survivorPpis.length} detection${survivorPpis.length === 1 ? '' : 's'}, ${sideInches.toFixed(1)}" side, worst cos θ ${worstCos.toFixed(2)})`,
    warnings,
  }
}

/**
 * Compute calibration from user-dragged pedicle dots.
 * Each input contributes one (px/in) estimate; we fuse with median + ±25%
 * outlier rejection across images. A measured spacing earns 0.85 confidence;
 * the population average earns 0.68. Mixed inputs are treated as "known" only
 * if every contributing image agreed on the same knownInches value (rare).
 */
function resolvePedicleDots(
  inputs: PedicleCalibrationInput[],
): CalibrationResult | null {
  const warnings: string[] = []

  const estimates: Array<{
    ppi: number
    isKnown: boolean
    knownInches: number | null
  }> = []

  for (const inp of inputs) {
    if (
      !isFiniteNumber(inp.leftPx) || !isFiniteNumber(inp.leftPy) ||
      !isFiniteNumber(inp.rightPx) || !isFiniteNumber(inp.rightPy)
    ) continue

    const dx = inp.rightPx - inp.leftPx
    const dy = inp.rightPy - inp.leftPy
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (!isFiniteNumber(pixelDist) || pixelDist <= 5) continue // 5 px sanity floor

    let knownInches: number | null = null
    if (inp.knownInches != null && isFiniteNumber(inp.knownInches)) {
      if (inp.knownInches < PEDICLE_KNOWN_INCHES_MIN || inp.knownInches > PEDICLE_KNOWN_INCHES_MAX) {
        warnings.push(`Pedicle spacing ${inp.knownInches.toFixed(1)}" outside ${PEDICLE_KNOWN_INCHES_MIN}-${PEDICLE_KNOWN_INCHES_MAX}" band; using anatomical average`)
      } else {
        knownInches = inp.knownInches
      }
    }

    const referenceInches = knownInches ?? DEFAULT_PEDICLE_SPACING_INCHES
    const ppi = pixelDist / referenceInches
    if (!isFiniteNumber(ppi) || ppi <= 0) continue

    estimates.push({ ppi, isKnown: knownInches != null, knownInches })
  }

  if (estimates.length === 0) return null

  // Outlier rejection across multiple images (each one a separate observation).
  const sorted = [...estimates].map(e => e.ppi).sort((a, b) => a - b)
  const med = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  const survivors = estimates.filter(e =>
    med > 0 ? Math.abs(e.ppi - med) / med <= 0.25 : true,
  )

  if (survivors.length === 0) return null

  // Survivors mean (every observation already in the same px/in scale).
  const fusedPpi = survivors.reduce((s, e) => s + e.ppi, 0) / survivors.length

  // Source classification: "known" only when every surviving observation
  // came with a known measurement. Mixing known + anatomical-default is
  // demoted to anatomical so we never over-claim.
  const allKnown = survivors.every(e => e.isKnown)
  const source: CalibrationSourceTag = allKnown ? 'user_placed_known' : 'user_placed_anatomical'
  const confidence = allKnown ? 0.85 : 0.68

  const rejected = estimates.length - survivors.length
  if (rejected > 0) {
    warnings.push(`Rejected ${rejected} pedicle outlier${rejected === 1 ? '' : 's'} vs median`)
  }

  // Tight agreement across multiple images reinforces; loose agreement penalizes
  // confidence slightly (still better than the priors above).
  if (survivors.length >= 2) {
    const ppis = survivors.map(e => e.ppi)
    const spread = (Math.max(...ppis) - Math.min(...ppis)) / Math.max(...ppis)
    if (spread > 0.12) {
      warnings.push('Pedicle dot placements disagree across images by >12%')
    }
  }

  return {
    pixelsPerInch: fusedPpi,
    source,
    confidence,
    method: allKnown
      ? `user-placed dots, measured spacing (${survivors.length} image${survivors.length === 1 ? '' : 's'})`
      : `user-placed dots, anatomical default (${survivors.length} image${survivors.length === 1 ? '' : 's'})`,
    warnings,
  }
}

function resolveAnatomicalPrior(landmarks: LandmarkDetection[]): CalibrationResult | null {
  const byId = new Map(landmarks.map((lm) => [lm.id, lm]))
  const estimates: { ppi: number; confidence: number; label: string }[] = []

  // Eye spacing
  const eyeL = byId.get('eye_left')
  const eyeR = byId.get('eye_right')
  if (
    eyeL && eyeR &&
    eyeL.px != null && eyeL.py != null &&
    eyeR.px != null && eyeR.py != null &&
    eyeL.confidence > 0.5 && eyeR.confidence > 0.5
  ) {
    const dx = eyeR.px - eyeL.px
    const dy = eyeR.py - eyeL.py
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 10) {
      const ppi = pixelDist / ANATOMICAL_REFERENCES.EYE_TO_EYE
      estimates.push({ ppi, confidence: Math.min(eyeL.confidence, eyeR.confidence) * 0.65, label: 'eye spacing' })
    }
  }

  // Pedicle spacing
  const pedL = byId.get('pedicle_left')
  const pedR = byId.get('pedicle_right')
  if (
    pedL && pedR &&
    pedL.px != null && pedL.py != null &&
    pedR.px != null && pedR.py != null &&
    pedL.confidence > 0.5 && pedR.confidence > 0.5
  ) {
    const dx = pedR.px - pedL.px
    const dy = pedR.py - pedL.py
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 10) {
      const ppi = pixelDist / ANATOMICAL_REFERENCES.PEDICLE_SPACING
      estimates.push({ ppi, confidence: Math.min(pedL.confidence, pedR.confidence) * 0.60, label: 'pedicle spacing' })
    }
  }

  if (estimates.length === 0) return null

  const warnings: string[] = []

  // Single estimate: nothing to cross-check against, return as-is with a penalty
  // so the caller knows we couldn't corroborate.
  if (estimates.length === 1) {
    return {
      pixelsPerInch: estimates[0].ppi,
      source: 'anatomical_prior',
      confidence: estimates[0].confidence * 0.85,
      method: `anatomical prior (${estimates[0].label}, unconfirmed)`,
      warnings: ['Single anatomical reference — no corroboration available'],
    }
  }

  // Median + relative-deviation outlier rejection. Mean is poisoned by one bad
  // reading; median tolerates a single outlier when we have 3+ estimates.
  const sortedPpi = [...estimates].map(e => e.ppi).sort((a, b) => a - b)
  const med = sortedPpi.length % 2 === 0
    ? (sortedPpi[sortedPpi.length / 2 - 1] + sortedPpi[sortedPpi.length / 2]) / 2
    : sortedPpi[Math.floor(sortedPpi.length / 2)]

  const survivors = estimates.filter(e => {
    const relDeviation = med > 0 ? Math.abs(e.ppi - med) / med : 0
    return relDeviation <= 0.25  // tolerate up to ±25% from the median
  })

  // If everyone got rejected (degenerate case), fall back to highest confidence
  if (survivors.length === 0) {
    estimates.sort((x, y) => y.confidence - x.confidence)
    warnings.push(`All anatomical estimates deviated >25% from median — using highest confidence (${estimates[0].label})`)
    return {
      pixelsPerInch: estimates[0].ppi,
      source: 'anatomical_prior',
      confidence: estimates[0].confidence * 0.6,
      method: `anatomical prior (${estimates[0].label}, fallback)`,
      warnings,
    }
  }

  // Flag any rejected outliers so the UI can surface them
  const rejected = estimates.filter(e => !survivors.includes(e))
  if (rejected.length > 0) {
    const pct = rejected
      .map(e => `${e.label} ${Math.round(((e.ppi - med) / med) * 100)}%`)
      .join(', ')
    warnings.push(`Rejected anatomical outliers vs median: ${pct}`)
  }

  // Weighted average over survivors (weight = confidence)
  const totalWeight = survivors.reduce((s, e) => s + e.confidence, 0)
  const avgPpi = totalWeight > 0
    ? survivors.reduce((s, e) => s + e.ppi * e.confidence, 0) / totalWeight
    : survivors.reduce((s, e) => s + e.ppi, 0) / survivors.length
  const avgConf = totalWeight / survivors.length

  // Reward agreement: if survivors are tight (<10% spread), boost confidence
  const survivorPpis = survivors.map(e => e.ppi)
  const survivorMax = Math.max(...survivorPpis)
  const survivorMin = Math.min(...survivorPpis)
  const relSpread = survivorMax > 0 ? (survivorMax - survivorMin) / survivorMax : 0
  const agreementBoost = survivors.length >= 2 && relSpread < 0.10 ? 1.10 : 1.0

  const labels = survivors.map((e) => e.label).join(' + ')

  return {
    pixelsPerInch: avgPpi,
    source: 'anatomical_prior',
    confidence: Math.min(0.95, avgConf * agreementBoost),
    method: `anatomical prior (${labels})`,
    warnings,
  }
}
