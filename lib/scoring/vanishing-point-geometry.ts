import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { ParallelFeature, VanishingPointResult } from './vanishing-point-types'

/**
 * Intersect two finite line segments treated as infinite lines.
 * Returns null when the lines are (numerically) parallel.
 */
export function computeVanishingPoint(
  feature: ParallelFeature,
): { x: number; y: number } | null {
  const { line_a: a, line_b: b } = feature
  const ax = a.x2 - a.x1
  const ay = a.y2 - a.y1
  const bx = b.x2 - b.x1
  const by = b.y2 - b.y1
  const denom = ax * by - ay * bx
  if (Math.abs(denom) < 1e-6) return null
  const dx = b.x1 - a.x1
  const dy = b.y1 - a.y1
  const t = (dx * by - dy * bx) / denom
  return { x: a.x1 + t * ax, y: a.y1 + t * ay }
}

/** Camera tilt from horizontal in degrees, derived from a vertical VP offset. */
export function computeTiltAngle(
  vanishingPoint: { x: number; y: number },
  imageHeight: number,
  focalLengthPx: number,
): number | null {
  if (!isFiniteNumber(focalLengthPx) || focalLengthPx <= 0) return null
  if (!isFiniteNumber(imageHeight) || imageHeight <= 0) return null
  const cy = imageHeight / 2
  const offsetY = vanishingPoint.y - cy
  return (Math.atan2(offsetY, focalLengthPx) * 180) / Math.PI
}

/**
 * Derive pixelsPerInch from a feature with a known real-world line
 * separation. Corrects for camera tilt via cosine of the tilt angle.
 */
export function computePixelsPerInchFromSpacing(
  feature: ParallelFeature,
  tiltAngleDeg: number | null,
): number | null {
  if (!feature.known_spacing_inches || feature.known_spacing_inches <= 0) return null
  const a = feature.line_a
  const b = feature.line_b
  const midAx = (a.x1 + a.x2) / 2
  const midAy = (a.y1 + a.y2) / 2
  const midBx = (b.x1 + b.x2) / 2
  const midBy = (b.y1 + b.y2) / 2
  const pixelDist = Math.sqrt(
    (midBx - midAx) * (midBx - midAx) + (midBy - midAy) * (midBy - midAy),
  )
  const tiltRad = tiltAngleDeg != null ? (tiltAngleDeg * Math.PI) / 180 : 0
  const corrected = pixelDist * Math.cos(tiltRad)
  if (corrected < 1) return null
  const ppi = corrected / feature.known_spacing_inches
  return isFiniteNumber(ppi) && ppi > 0 ? ppi : null
}

/**
 * Analyze every detected parallel feature pair and return the best
 * vanishing-point calibration result. Picks the highest-confidence
 * feature; never throws.
 */
export function analyzeVanishingPoints(
  features: ParallelFeature[] | null | undefined,
  imageWidth: number,
  imageHeight: number,
  focalLengthPx: number | null,
): VanishingPointResult {
  const result: VanishingPointResult = {
    vanishingPoint: null,
    tiltAngleDeg: null,
    pixelsPerInch: null,
    scaleSource: null,
    confidence: 0,
    warnings: [],
  }

  if (!features || features.length === 0) return result

  const ranked = [...features].sort((a, b) => b.confidence - a.confidence)
  const best = ranked[0]
  if (!best || best.confidence < 0.4) {
    result.warnings.push('Parallel features detected but confidence too low to use')
    return result
  }

  const vp = computeVanishingPoint(best)
  if (!vp || !isFiniteNumber(vp.x) || !isFiniteNumber(vp.y)) {
    result.warnings.push('Lines appear parallel — could not compute vanishing point')
    return result
  }
  result.vanishingPoint = vp

  if (focalLengthPx && focalLengthPx > 0) {
    result.tiltAngleDeg = computeTiltAngle(vp, imageHeight, focalLengthPx)
  } else {
    result.warnings.push('No EXIF focal length — tilt angle not computed')
  }

  if (best.known_spacing_inches) {
    result.pixelsPerInch = computePixelsPerInchFromSpacing(best, result.tiltAngleDeg)
    result.scaleSource = best.feature_type
  }

  let conf = best.confidence * 0.6
  if (result.tiltAngleDeg != null) conf += 0.15
  if (result.pixelsPerInch != null) conf += 0.20
  const vpOutsideFactor =
    vp.x < -imageWidth ||
    vp.x > 2 * imageWidth ||
    vp.y < -imageHeight ||
    vp.y > 2 * imageHeight
      ? 0.7
      : 1.0
  result.confidence = Math.min(0.55, conf * vpOutsideFactor)

  return result
}
