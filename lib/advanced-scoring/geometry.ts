/**
 * lib/advanced-scoring/geometry.ts
 *
 * Pure, NaN-safe geometry helpers for 2D and 3D measurement calculations.
 * All functions reject invalid inputs and return null or a fallback rather
 * than propagating NaN into scores.
 */

import type { MeasurementPoint2D, MeasurementPoint3D } from './types'

// ─── Guards ───────────────────────────────────────────────────────────────────

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && !isNaN(value)
}

export function safeNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? (value as number) : fallback
}

function isValidPoint2D(p: MeasurementPoint2D): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y)
}

function isValidPoint3D(p: MeasurementPoint3D): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z)
}

// ─── Distance ─────────────────────────────────────────────────────────────────

export function distance2D(a: MeasurementPoint2D, b: MeasurementPoint2D): number {
  if (!isValidPoint2D(a) || !isValidPoint2D(b)) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function distance3D(a: MeasurementPoint3D, b: MeasurementPoint3D): number {
  if (!isValidPoint3D(a) || !isValidPoint3D(b)) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ─── Polyline length ──────────────────────────────────────────────────────────

export function polylineLength2D(points: MeasurementPoint2D[]): number {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += distance2D(points[i - 1], points[i])
  }
  return isFiniteNumber(total) ? total : 0
}

export function polylineLength3D(points: MeasurementPoint3D[]): number {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += distance3D(points[i - 1], points[i])
  }
  return isFiniteNumber(total) ? total : 0
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

/**
 * Convert a pixel-space length to inches.
 * Returns null and emits a warning if pixelsPerInch is invalid.
 */
export function pixelsToInches(pixelLength: number, pixelsPerInch: number): number | null {
  if (!isFiniteNumber(pixelLength) || pixelLength < 0) return null
  if (!isFiniteNumber(pixelsPerInch) || pixelsPerInch <= 0) return null
  const result = pixelLength / pixelsPerInch
  return isFiniteNumber(result) ? result : null
}

/**
 * Convert a model-unit length to inches.
 * Returns null if unitsPerInch is invalid.
 */
export function unitsToInches(unitLength: number, unitsPerInch: number): number | null {
  if (!isFiniteNumber(unitLength) || unitLength < 0) return null
  if (!isFiniteNumber(unitsPerInch) || unitsPerInch <= 0) return null
  const result = unitLength / unitsPerInch
  return isFiniteNumber(result) ? result : null
}

// ─── Bounding boxes ───────────────────────────────────────────────────────────

export interface BoundingBox2D {
  minX: number; maxX: number
  minY: number; maxY: number
  width: number; height: number
}

export function boundingBox2D(points: MeasurementPoint2D[]): BoundingBox2D | null {
  const valid = points.filter(isValidPoint2D)
  if (valid.length === 0) return null
  const xs = valid.map(p => p.x)
  const ys = valid.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
}

export interface BoundingBox3D {
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
  width: number; height: number; depth: number
}

export function boundingBox3D(points: MeasurementPoint3D[]): BoundingBox3D | null {
  const valid = points.filter(isValidPoint3D)
  if (valid.length === 0) return null
  const xs = valid.map(p => p.x)
  const ys = valid.map(p => p.y)
  const zs = valid.map(p => p.z)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  return {
    minX, maxX, minY, maxY, minZ, maxZ,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  }
}

// ─── Segment length warnings ──────────────────────────────────────────────────

/**
 * Returns a warning string if any segment in the polyline is longer than
 * the threshold (in inches), indicating the user needs more points for a
 * curved measurement.
 */
export function curveAccuracyWarning(
  points: MeasurementPoint2D[],
  pixelsPerInch: number,
  thresholdInches = 2.5,
): string | null {
  if (points.length < 2 || !isFiniteNumber(pixelsPerInch) || pixelsPerInch <= 0) return null
  for (let i = 1; i < points.length; i++) {
    const px = distance2D(points[i - 1], points[i])
    const inches = px / pixelsPerInch
    if (inches > thresholdInches) {
      return 'Add more points for curve accuracy'
    }
  }
  return null
}

// ─── Taubin circle fit ─────────────────────────────────────────────────────
//
// Algebraic circle fit using the Taubin method (1991). Unbiased on partial
// arcs — the common antler-beam case, where one photo angle only sees half
// the circumference. Kasa/chord-sum bias toward smaller radii on partial arcs;
// Taubin adds a normalization that removes the bias.
//
// Reference: Taubin (1991), "Estimation of planar curves, surfaces, and
// nonplanar space curves defined by implicit equations." Implementation
// follows the Chernov–Lesort closed-form derivation (Newton on the Taubin
// characteristic polynomial) for numerical robustness.

interface CircleFit {
  cx: number
  cy: number
  r: number
  residualRms: number
}

/**
 * Algebraic circle fit using the Taubin method.
 * @param points  At least 3 points on or near the circle; 5+ recommended.
 * @returns       cx, cy, r, residualRms (RMS distance from points to fitted
 *                circle, in input units). Returns null if degenerate
 *                (collinear, <3 points, or numerical failure).
 */
export function fitCircleTaubin(
  points: ReadonlyArray<{ x: number; y: number }>,
): CircleFit | null {
  if (!Array.isArray(points) || points.length < 3) return null
  const n = points.length

  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    const p = points[i]
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null
    sumX += p.x
    sumY += p.y
  }
  const xBar = sumX / n
  const yBar = sumY / n

  let Mxx = 0
  let Myy = 0
  let Mxy = 0
  let Mxz = 0
  let Myz = 0
  let Mzz = 0
  for (let i = 0; i < n; i++) {
    const xc = points[i].x - xBar
    const yc = points[i].y - yBar
    const z = xc * xc + yc * yc
    Mxx += xc * xc
    Myy += yc * yc
    Mxy += xc * yc
    Mxz += xc * z
    Myz += yc * z
    Mzz += z * z
  }
  Mxx /= n
  Myy /= n
  Mxy /= n
  Mxz /= n
  Myz /= n
  Mzz /= n

  const Mz = Mxx + Myy
  const CovXY = Mxx * Myy - Mxy * Mxy

  // Characteristic polynomial coefficients (Chernov–Lesort).
  const A3 = 4 * Mz
  const A2 = -3 * Mz * Mz - Mzz
  const A1 = Mzz * Mz + 4 * CovXY * Mz - Mxz * Mxz - Myz * Myz - Mz * Mz * Mz
  const A0 =
    Mxz * Mxz * Myy +
    Myz * Myz * Mxx -
    Mzz * CovXY -
    2 * Mxz * Myz * Mxy +
    Mz * Mz * CovXY
  const A22 = A2 + A2
  const A33 = A3 + A3 + A3

  // Newton iteration on A3·x³ + A2·x² + A1·x + A0 = 0, starting from x=0.
  let x = 0
  let y = A0
  for (let iter = 0; iter < 99; iter++) {
    const dy = A1 + x * (A22 + A33 * x)
    if (Math.abs(dy) < 1e-15) break
    const xNew = x - y / dy
    if (!isFiniteNumber(xNew) || xNew === x) break
    const yNew = A0 + xNew * (A1 + xNew * (A2 + xNew * A3))
    if (Math.abs(yNew) >= Math.abs(y)) break
    x = xNew
    y = yNew
  }

  const det = x * x - x * Mz + CovXY
  if (!isFiniteNumber(det) || Math.abs(det) < 1e-12) return null

  const cxCentered = (Mxz * (Myy - x) - Myz * Mxy) / (2 * det)
  const cyCentered = (Myz * (Mxx - x) - Mxz * Mxy) / (2 * det)
  const rSq = cxCentered * cxCentered + cyCentered * cyCentered + Mz
  if (!isFiniteNumber(rSq) || rSq < 0) return null
  const r = Math.sqrt(rSq)

  const cx = cxCentered + xBar
  const cy = cyCentered + yBar
  if (!isFiniteNumber(cx) || !isFiniteNumber(cy) || !isFiniteNumber(r) || r <= 0) {
    return null
  }

  // RMS residual: how far input points sit from the fitted circle.
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const dx = points[i].x - cx
    const dy = points[i].y - cy
    const d = Math.sqrt(dx * dx + dy * dy) - r
    sumSq += d * d
  }
  const residualRms = Math.sqrt(sumSq / n)
  if (!isFiniteNumber(residualRms)) return null

  return { cx, cy, r, residualRms }
}

export type CircumferenceMethod =
  | 'taubin_full'
  | 'taubin_arc'
  | 'chord_sum_fallback'

export interface CircumferenceFromPointsResult {
  circumference: number
  method: CircumferenceMethod
  arcCoverageDeg: number
  residualRms: number
  fitConfidence: number
}

/**
 * Circumference of a partial or full arc from perimeter points.
 *
 * Arc coverage logic:
 *   > 270°  → method='taubin_full',  circumference = 2πr
 *   60–270° → method='taubin_arc',   circumference = (arc/360) · 2πr
 *   < 60°   → method='chord_sum_fallback' (arc too short to fit reliably)
 *
 * Returns null only for truly degenerate input (<3 points, collinear, or
 * numerical failure). Callers should chord-sum-fallback on null.
 */
export function circumferenceFromPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): CircumferenceFromPointsResult | null {
  if (!Array.isArray(points) || points.length < 3) return null

  const fit = fitCircleTaubin(points)
  if (!fit) return null

  const arcCoverageDeg = computeArcCoverageDeg(points, fit.cx, fit.cy)
  const fullCircumference = 2 * Math.PI * fit.r
  if (!isFiniteNumber(fullCircumference) || fullCircumference <= 0) return null

  const base = Math.max(0, Math.min(1, 1 - fit.residualRms / fit.r))
  const coveragePenalty = Math.max(0.4, Math.min(1, arcCoverageDeg / 270))
  const fitConfidence = base * coveragePenalty

  if (arcCoverageDeg < 60) {
    // Arc too short to fit reliably; report chord-sum length but flag method.
    let chord = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      chord += Math.sqrt(dx * dx + dy * dy)
    }
    if (!isFiniteNumber(chord)) return null
    return {
      circumference: chord,
      method: 'chord_sum_fallback',
      arcCoverageDeg,
      residualRms: fit.residualRms,
      fitConfidence: Math.min(fitConfidence, 0.5),
    }
  }

  if (arcCoverageDeg > 270) {
    return {
      circumference: fullCircumference,
      method: 'taubin_full',
      arcCoverageDeg,
      residualRms: fit.residualRms,
      fitConfidence,
    }
  }

  return {
    circumference: (arcCoverageDeg / 360) * fullCircumference,
    method: 'taubin_arc',
    arcCoverageDeg,
    residualRms: fit.residualRms,
    fitConfidence,
  }
}

function computeArcCoverageDeg(
  points: ReadonlyArray<{ x: number; y: number }>,
  cx: number,
  cy: number,
): number {
  const thetas: number[] = []
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - cx
    const dy = points[i].y - cy
    if (dx === 0 && dy === 0) continue
    let t = Math.atan2(dy, dx)
    if (t < 0) t += 2 * Math.PI
    thetas.push(t)
  }
  if (thetas.length < 2) return 0
  thetas.sort((a, b) => a - b)

  let largestGap = 0
  for (let i = 1; i < thetas.length; i++) {
    const gap = thetas[i] - thetas[i - 1]
    if (gap > largestGap) largestGap = gap
  }
  const wrap = 2 * Math.PI - thetas[thetas.length - 1] + thetas[0]
  if (wrap > largestGap) largestGap = wrap

  const coverageRad = 2 * Math.PI - largestGap
  return (coverageRad * 180) / Math.PI
}
