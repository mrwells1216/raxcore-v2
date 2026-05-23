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

/**
 * Calibration source values. Aligns with §8 of CLAUDE.md.
 * - `depth_map_lidar`: priority 2 (iPhone Pro LiDAR + EXIF)
 * - `user_placed_known`: priority 4 (user dragged pedicle dots + their own measured spacing)
 * - `user_placed_anatomical`: priority 5 (user dragged pedicle dots, avg 3.8" spacing)
 * - `reference_object`: priority 9–10 (ring/hat/ruler — never primary)
 * - `eye_circle_anatomical`: priority 6–7 (whitetail iris diameter)
 * - `anatomical_prior`: priority 8 (eye-to-eye, pedicle spacing, etc.)
 *
 * §4.2 and §4.7 add more sources in later orders. Each one must NOT report
 * `physical_reference` — that's reserved for user ruler/tape (the only source
 * that unlocks Verified Score per `lib/advanced-scoring/cross-validation.ts`).
 */
export type CalibrationSourceTag =
  | 'depth_map_lidar'
  | 'user_placed_known'
  | 'user_placed_anatomical'
  | 'reference_object'
  | 'eye_circle_anatomical'
  | 'anatomical_prior'

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
export function resolveCalibration(
  landmarks: LandmarkDetection[],
  depthCalibration: DepthCalibrationResult | null,
  referenceObject: ReferenceObjectInput | null,
  perImageLandmarks?: PerImageLandmarkResult[],
  pedicleCalibrations?: PedicleCalibrationInput[] | null,
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

  // Priority 2: User-placed pedicle dots. Best non-LiDAR source when the user
  // physically measured their own pedicle spacing (0.85); falls back to the
  // average 3.8" prior (0.68) when no measurement was supplied. §8 slots 4–5.
  if (pedicleCalibrations && pedicleCalibrations.length > 0) {
    const pedicleResult = resolvePedicleDots(pedicleCalibrations)
    if (pedicleResult) return pedicleResult
  }

  // Priority 3: Reference object
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
