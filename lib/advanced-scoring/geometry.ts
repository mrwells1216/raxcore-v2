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
