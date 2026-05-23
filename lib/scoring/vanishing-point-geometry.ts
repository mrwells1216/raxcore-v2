/**
 * §4.7 Vanishing-point geometry — pure math.
 *
 * Each parallel-line pair yields one image-plane vanishing point (intersection
 * of the two lines). Fusing across pairs gives a centroid; the angle from the
 * image center to that centroid (and the centroid's distance from the center)
 * gives a tilt estimate.
 *
 * Per CLAUDE.md §4.7 this NEVER unlocks Verified Score on its own — its job
 * is to surface a warning when the resolved primary calibration disagrees
 * with the perspective implied here by >35% (warn) or >50% (critical).
 */

import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type {
  Point2D,
  ParallelLinePair,
  VanishingPointResult,
} from './vanishing-point-types'
import {
  VANISHING_POINT_TILT_BANDS,
  PERSPECTIVE_DISAGREEMENT_WARN_PCT,
  PERSPECTIVE_DISAGREEMENT_CRIT_PCT,
} from './vanishing-point-types'

/**
 * Compute the intersection of two line segments treated as infinite lines.
 * Returns null when the lines are parallel (det ≈ 0) or degenerate.
 *
 * Algorithm: solve
 *   line1: a + t·(b - a) = p
 *   line2: c + s·(d - c) = p
 * → 2×2 linear system in (t, s).
 */
export function lineIntersection(
  a: Point2D, b: Point2D,
  c: Point2D, d: Point2D,
): Point2D | null {
  if (!finitePt(a) || !finitePt(b) || !finitePt(c) || !finitePt(d)) return null
  const r1x = b.x - a.x
  const r1y = b.y - a.y
  const r2x = d.x - c.x
  const r2y = d.y - c.y
  const det = r1x * r2y - r1y * r2x
  if (Math.abs(det) < 1e-9) return null
  const t = ((c.x - a.x) * r2y - (c.y - a.y) * r2x) / det
  const px = a.x + t * r1x
  const py = a.y + t * r1y
  if (!isFiniteNumber(px) || !isFiniteNumber(py)) return null
  return { x: px, y: py }
}

/**
 * Compute the angle (radians) of a line segment from its endpoints.
 * Returns NaN on degenerate input; the median of multiple line angles is
 * used to estimate the camera's rotation axis.
 */
export function lineAngleRadians(a: Point2D, b: Point2D): number {
  if (!finitePt(a) || !finitePt(b)) return NaN
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return NaN
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return NaN
  return Math.atan2(dy, dx)
}

/**
 * Analyze a set of parallel-line pairs for perspective tilt.
 *
 * Algorithm:
 *   1. For each pair, intersect the two lines → candidate VP.
 *   2. Median the candidate VPs into a fused VP (median tolerates a
 *      single outlier when ≥3 pairs available).
 *   3. Tilt angle = atan2(|VP.x - cx|, focal). Without a known focal we
 *      use image diagonal / 2 as a heuristic focal proxy — the absolute
 *      number is biased but the relative severity ordering is preserved.
 *   4. Bucket the tilt into orthogonal / mild / moderate / severe.
 */
export function analyzeVanishingPoint(
  pairs: ParallelLinePair[],
  imageWidth: number,
  imageHeight: number,
): VanishingPointResult {
  const warnings: string[] = []
  const usablePairs: Array<{ pair: ParallelLinePair; vp: Point2D }> = []

  for (const pair of pairs) {
    const [a, b] = pair.line1
    const [c, d] = pair.line2
    const vp = lineIntersection(a, b, c, d)
    if (vp == null) {
      warnings.push(`Line pair "${pair.label ?? 'unnamed'}" — parallel or degenerate`)
      continue
    }
    if (!isFiniteNumber(vp.x) || !isFiniteNumber(vp.y)) {
      warnings.push(`Line pair "${pair.label ?? 'unnamed'}" — non-finite VP`)
      continue
    }
    usablePairs.push({ pair, vp })
  }

  if (usablePairs.length === 0) {
    return {
      vanishingPoint: null,
      tiltDegrees: 0,
      severity: 'orthogonal',
      contributingPairsCount: 0,
      warnings,
    }
  }

  // Fuse: median of x, median of y across all surviving VPs.
  const xs = usablePairs.map(p => p.vp.x).sort((a, b) => a - b)
  const ys = usablePairs.map(p => p.vp.y).sort((a, b) => a - b)
  const midX = Math.floor(xs.length / 2)
  const midY = Math.floor(ys.length / 2)
  const fusedX = xs.length % 2 === 0 ? (xs[midX - 1] + xs[midX]) / 2 : xs[midX]
  const fusedY = ys.length % 2 === 0 ? (ys[midY - 1] + ys[midY]) / 2 : ys[midY]

  const fusedVP: Point2D = { x: fusedX, y: fusedY }
  const tiltDegrees = computeTiltDegrees(fusedVP, imageWidth, imageHeight)
  const severity = bucketSeverity(tiltDegrees)

  return {
    vanishingPoint: fusedVP,
    tiltDegrees,
    severity,
    contributingPairsCount: usablePairs.length,
    warnings,
  }
}

/**
 * Compare the perspective tilt implied by the resolved primary calibration
 * source against the vanishing-point analysis. Returns a structured warning
 * payload if the two disagree beyond the warn/critical thresholds, else
 * null.
 *
 * The primary calibration source doesn't directly report a tilt — we infer
 * one from its `cosTilt` (ArUco), the image angleType (eye-circle/pedicle),
 * or default to 0° (LiDAR). The caller computes this proxy and passes it
 * in as `primaryTiltDegrees`.
 */
export interface PerspectiveDisagreement {
  severity: 'warning' | 'critical'
  message: string
  primaryTiltDegrees: number
  vanishingPointTiltDegrees: number
  percentageDelta: number
}

export function comparePerspectiveTilt(
  vpResult: VanishingPointResult,
  primaryTiltDegrees: number,
): PerspectiveDisagreement | null {
  if (vpResult.vanishingPoint == null) return null
  if (!isFiniteNumber(primaryTiltDegrees)) return null
  if (vpResult.contributingPairsCount < 1) return null

  // Use degrees-of-disagreement normalized against a 30° reference scale —
  // anything over 30° of tilt is "severe", so a 35%+ delta when one source
  // says ~5° and the other says ~25° is a real signal worth surfacing.
  const referenceScale = 30
  const delta = Math.abs(vpResult.tiltDegrees - primaryTiltDegrees) / referenceScale
  if (delta < PERSPECTIVE_DISAGREEMENT_WARN_PCT) return null

  const severity: PerspectiveDisagreement['severity'] =
    delta >= PERSPECTIVE_DISAGREEMENT_CRIT_PCT ? 'critical' : 'warning'

  return {
    severity,
    message: `Perspective tilt: vanishing-point analysis says ${vpResult.tiltDegrees.toFixed(0)}°, calibration source assumes ${primaryTiltDegrees.toFixed(0)}°. Cross-check with a more orthogonal photo.`,
    primaryTiltDegrees,
    vanishingPointTiltDegrees: vpResult.tiltDegrees,
    percentageDelta: delta,
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function finitePt(p: Point2D | undefined): p is Point2D {
  return p != null && isFiniteNumber(p.x) && isFiniteNumber(p.y)
}

function computeTiltDegrees(
  vp: Point2D,
  imageWidth: number,
  imageHeight: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 0
  const cx = imageWidth / 2
  const cy = imageHeight / 2
  const focalProxy = Math.hypot(imageWidth, imageHeight) / 2
  if (focalProxy <= 0) return 0
  const offset = Math.hypot(vp.x - cx, vp.y - cy)
  // arctan(offset / focal_proxy) → degrees. A VP at the image edge is ~45°.
  const rad = Math.atan2(offset, focalProxy)
  const deg = (rad * 180) / Math.PI
  if (!isFiniteNumber(deg)) return 0
  return Math.max(0, Math.min(89, deg))
}

function bucketSeverity(tiltDegrees: number): VanishingPointResult['severity'] {
  const t = Math.abs(tiltDegrees)
  if (t <= VANISHING_POINT_TILT_BANDS.orthogonalMax) return 'orthogonal'
  if (t <= VANISHING_POINT_TILT_BANDS.mildMax) return 'mild'
  if (t <= VANISHING_POINT_TILT_BANDS.moderateMax) return 'moderate'
  return 'severe'
}
