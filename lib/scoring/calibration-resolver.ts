import 'server-only'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { LandmarkDetection } from './landmark-detection'
import type { DepthCalibrationResult } from '@/lib/calibration/depth-calibration'
import type { ArucoDetectionResult } from './aruco-types'
import type { VanishingPointResult } from './vanishing-point-types'
import { computeCalibrationFromEyeCircle } from './landmark-geometry'

// Known whitetail anatomical references (inches)
const ANATOMICAL_REFERENCES = {
  EYE_BOX_WIDTH: 3.5,      // typical interocular distance
  PEDICLE_SPACING: 4.0,    // typical inter-pedicle spacing
}

export type CalibrationSource =
  | 'depth_map_lidar'
  | 'aruco_marker'
  | 'user_placed_known'
  | 'user_placed_anatomical'
  | 'reference_object'
  | 'eye_circle_anatomical'
  | 'anatomical_prior'
  | 'vanishing_point'

export interface PedicleCalibrationInput {
  source: 'user_placed_known' | 'user_placed_anatomical'
  pixelsPerInch: number
  confidence: number
  knownSpacingInches: number | null
}

export interface CalibrationResult {
  pixelsPerInch: number
  source: CalibrationSource
  confidence: number
  method: string
  warnings: string[]
}

export interface ReferenceObjectInput {
  type: 'ring' | 'hat' | 'ruler' | 'none'
  knownSizeInches: number | null
  pixelSize: number | null
}

export interface ResolveCalibrationOptions {
  landmarks: LandmarkDetection[]
  depthCalibration?: DepthCalibrationResult | null
  referenceObject?: ReferenceObjectInput | null
  arucoResult?: ArucoDetectionResult | null
  pedicleCalibration?: PedicleCalibrationInput | null
  vanishingPoint?: VanishingPointResult | null
}

/**
 * Resolve the best available pixelsPerInch calibration.
 *
 * Priority:
 *   1. LiDAR depth map + EXIF                      (auto, very high)
 *   2. ArUco marker (GPT-4o detected, conf > 0.5)  (printed marker, auto)
 *   3. Reference object (ring, hat, ruler)         (user-declared size)
 *   4. Anatomical priors (eye, pedicle spacing)    (always-on fallback)
 */
export function resolveCalibration(
  options: ResolveCalibrationOptions,
): CalibrationResult | null {
  const {
    landmarks,
    depthCalibration,
    referenceObject,
    arucoResult,
    pedicleCalibration,
    vanishingPoint,
  } = options

  // Priority 1: LiDAR depth calibration
  if (
    depthCalibration &&
    isFiniteNumber(depthCalibration.pixelsPerInch) &&
    depthCalibration.pixelsPerInch > 0 &&
    depthCalibration.confidence > 0.4
  ) {
    return applyVanishingPointCrossCheck({
      pixelsPerInch: depthCalibration.pixelsPerInch,
      source: 'depth_map_lidar',
      confidence: depthCalibration.confidence,
      method: `LiDAR depth at ${depthCalibration.subjectDistanceMeters.toFixed(2)}m`,
      warnings: depthCalibration.warnings,
    }, vanishingPoint)
  }

  // Priority 2: ArUco marker (printed, GPT-4o detected)
  if (
    arucoResult &&
    arucoResult.detected &&
    isFiniteNumber(arucoResult.pixelsPerInch) &&
    arucoResult.pixelsPerInch > 0 &&
    arucoResult.confidence > 0.5
  ) {
    const sizeLabel = isFiniteNumber(arucoResult.markerSizeInches)
      ? `${arucoResult.markerSizeInches}" marker`
      : 'ArUco marker'
    return applyVanishingPointCrossCheck({
      pixelsPerInch: arucoResult.pixelsPerInch,
      source: 'aruco_marker',
      confidence: arucoResult.confidence,
      method: `${sizeLabel} (${arucoResult.method})`,
      warnings: arucoResult.warnings,
    }, vanishingPoint)
  }

  // Priority 2b: User-placed pedicle calibration dots
  if (
    pedicleCalibration &&
    isFiniteNumber(pedicleCalibration.pixelsPerInch) &&
    pedicleCalibration.pixelsPerInch > 0 &&
    pedicleCalibration.confidence > 0.5
  ) {
    const spacingLabel =
      pedicleCalibration.source === 'user_placed_known' && pedicleCalibration.knownSpacingInches
        ? `${pedicleCalibration.knownSpacingInches}" measured`
        : '4.5" anatomical average'
    return applyVanishingPointCrossCheck({
      pixelsPerInch: pedicleCalibration.pixelsPerInch,
      source: pedicleCalibration.source,
      confidence: pedicleCalibration.confidence,
      method: `pedicle dots (${spacingLabel})`,
      warnings: [],
    }, vanishingPoint)
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

    return applyVanishingPointCrossCheck({
      pixelsPerInch,
      source: 'reference_object',
      confidence,
      method: `${referenceObject.type} reference (${referenceObject.knownSizeInches}" known)`,
      warnings: [],
    }, vanishingPoint)
  }

  // Priority 4: Eye iris circle (per-eye anatomical reference)
  // — preferred over the inter-eye box prior because it works with a
  //   single eye visible and the iris size is more stable across deer.
  const eyeCircle = computeCalibrationFromEyeCircle(landmarks)
  if (
    eyeCircle &&
    isFiniteNumber(eyeCircle.pixelsPerInch) &&
    eyeCircle.pixelsPerInch > 0 &&
    eyeCircle.confidence > 0.45
  ) {
    return applyVanishingPointCrossCheck({
      pixelsPerInch: eyeCircle.pixelsPerInch,
      source: 'eye_circle_anatomical',
      confidence: eyeCircle.confidence,
      method:
        eyeCircle.eyeUsed === 'average'
          ? `iris average (both eyes, ${eyeCircle.radiusPxUsed.toFixed(1)}px)`
          : `iris (${eyeCircle.eyeUsed}, ${eyeCircle.radiusPxUsed.toFixed(1)}px${eyeCircle.isElliptical ? ', elliptical' : ''})`,
      warnings: eyeCircle.warnings,
    }, vanishingPoint)
  }

  // Priority 5: Anatomical priors from landmarks (inter-eye / inter-pedicle)
  const anatomical = resolveAnatomicalPrior(landmarks)
  if (anatomical) {
    return applyVanishingPointCrossCheck(anatomical, vanishingPoint)
  }

  // Priority 6: Vanishing point (lowest — cross-check only)
  if (
    vanishingPoint &&
    isFiniteNumber(vanishingPoint.pixelsPerInch) &&
    (vanishingPoint.pixelsPerInch as number) > 0 &&
    vanishingPoint.confidence > 0.3
  ) {
    const warnings = [...vanishingPoint.warnings]
    if (vanishingPoint.tiltAngleDeg != null && Math.abs(vanishingPoint.tiltAngleDeg) > 20) {
      warnings.push(
        `Camera tilt ${Math.abs(vanishingPoint.tiltAngleDeg).toFixed(1)}° detected — a more level photo improves accuracy`,
      )
    }
    return {
      pixelsPerInch: vanishingPoint.pixelsPerInch as number,
      source: 'vanishing_point',
      confidence: vanishingPoint.confidence,
      method: `vanishing point (${vanishingPoint.scaleSource ?? 'background lines'})`,
      warnings,
    }
  }

  return null
}

/**
 * When a higher-priority source already won, but the vanishing-point
 * analysis disagrees with it by more than 35%, attach a warning.
 * Pure: returns a new CalibrationResult with the warning appended.
 */
function applyVanishingPointCrossCheck(
  primary: CalibrationResult,
  vanishingPoint: VanishingPointResult | null | undefined,
): CalibrationResult {
  if (
    !vanishingPoint ||
    !isFiniteNumber(vanishingPoint.pixelsPerInch) ||
    (vanishingPoint.pixelsPerInch as number) <= 0 ||
    vanishingPoint.confidence < 0.3
  ) {
    return primary
  }
  const vpPpi = vanishingPoint.pixelsPerInch as number
  const delta = Math.abs(vpPpi - primary.pixelsPerInch) / primary.pixelsPerInch
  if (delta <= 0.35) return primary
  const note = `Perspective analysis suggests a different scale than the primary calibration (${Math.round(delta * 100)}% difference). Advanced Scoring with a physical ruler is recommended.`
  return { ...primary, warnings: [...primary.warnings, note] }
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
      const ppi = pixelDist / ANATOMICAL_REFERENCES.EYE_BOX_WIDTH
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

  // If multiple estimates agree within 10%, average them
  const warnings: string[] = []
  if (estimates.length > 1) {
    const [a, b] = estimates
    const disagreement = Math.abs(a.ppi - b.ppi) / Math.max(a.ppi, b.ppi)
    if (disagreement > 0.20) {
      warnings.push(`Anatomical calibration estimates disagree by ${Math.round(disagreement * 100)}% — using highest confidence`)
      estimates.sort((x, y) => y.confidence - x.confidence)
      return {
        pixelsPerInch: estimates[0].ppi,
        source: 'anatomical_prior',
        confidence: estimates[0].confidence,
        method: `anatomical prior (${estimates[0].label})`,
        warnings,
      }
    }
  }

  const avgPpi = estimates.reduce((s, e) => s + e.ppi, 0) / estimates.length
  const avgConf = estimates.reduce((s, e) => s + e.confidence, 0) / estimates.length
  const labels = estimates.map((e) => e.label).join(' + ')

  return {
    pixelsPerInch: avgPpi,
    source: 'anatomical_prior',
    confidence: avgConf,
    method: `anatomical prior (${labels})`,
    warnings,
  }
}
