/**
 * lib/advanced-scoring/point-cloud.ts
 *
 * Lightweight point cloud utility layer.
 * Supports parsing .xyz / .pts / .csv text data.
 * Provides snapping, density estimation, and coverage warnings.
 *
 * Three.js Points rendering is handled separately in scene-3d.tsx.
 * This module is pure TS with no DOM / Three.js dependencies.
 */

import type { PointCloudPoint, MeasurementPoint3D } from './types'
import { distance3D, isFiniteNumber } from './geometry'

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a plain-text point cloud file (.xyz, .pts, .csv).
 *
 * Expects one point per line with whitespace or comma-separated values:
 *   x y z [r g b]
 *   x, y, z [, r, g, b]
 *
 * Lines that cannot be parsed are silently skipped.
 * Returns an empty array for empty/invalid input.
 */
export function parsePointCloudText(text: string): PointCloudPoint[] {
  if (!text || typeof text !== 'string') return []

  const points: PointCloudPoint[] = []
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip comment lines and blank lines
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    // Split by whitespace or comma
    const parts = trimmed.split(/[\s,]+/).map(Number)
    if (parts.length < 3) continue

    const [x, y, z, r, g, b] = parts
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue

    const pt: PointCloudPoint = { x, y, z }

    if (isFiniteNumber(r) && isFiniteNumber(g) && isFiniteNumber(b)) {
      // Normalize to 0–1 if values appear to be 0–255
      const scale = (r > 1 || g > 1 || b > 1) ? 255 : 1
      pt.color = { r: r / scale, g: g / scale, b: b / scale }
    }

    points.push(pt)
  }

  return points
}

// ─── Snapping ─────────────────────────────────────────────────────────────────

/**
 * Find the nearest point cloud point to `point` within `maxSnapDistance`.
 * Returns null if no point is within range.
 */
export function findNearestPointCloudAnchor(
  point: MeasurementPoint3D,
  cloudPoints: PointCloudPoint[],
  maxSnapDistance: number,
): PointCloudPoint | null {
  if (!cloudPoints.length || maxSnapDistance <= 0) return null

  let nearest: PointCloudPoint | null = null
  let nearestDist = Infinity

  for (const cp of cloudPoints) {
    const d = distance3D(point, cp)
    if (d < nearestDist && d <= maxSnapDistance) {
      nearestDist = d
      nearest = cp
    }
  }

  return nearest
}

/**
 * Snap a polyline of 3D points to the nearest point cloud anchors.
 * Points that cannot be snapped (no point within maxSnapDistance) are left unchanged.
 * Returns the snapped polyline and a boolean indicating if all points were snapped.
 */
export function snapPolylineToPointCloud(
  points: MeasurementPoint3D[],
  cloudPoints: PointCloudPoint[],
  maxSnapDistance: number,
): { snapped: MeasurementPoint3D[]; allSnapped: boolean } {
  if (!cloudPoints.length) return { snapped: points, allSnapped: false }

  let allSnapped = true
  const snapped: MeasurementPoint3D[] = points.map(p => {
    const anchor = findNearestPointCloudAnchor(p, cloudPoints, maxSnapDistance)
    if (anchor) return { x: anchor.x, y: anchor.y, z: anchor.z }
    allSnapped = false
    return p
  })

  return { snapped, allSnapped }
}

// ─── Density ─────────────────────────────────────────────────────────────────

/**
 * Estimate the number of point cloud points within `radius` of `point`.
 * This is a simple O(n) scan — suitable for interactive use with clouds
 * up to ~500k points. For larger clouds, use an octree (future work).
 */
export function estimatePointDensityAround(
  point: MeasurementPoint3D,
  cloudPoints: PointCloudPoint[],
  radius: number,
): number {
  if (!cloudPoints.length || radius <= 0) return 0
  let count = 0
  for (const cp of cloudPoints) {
    if (distance3D(point, cp) <= radius) count++
  }
  return count
}

// ─── Coverage warning ─────────────────────────────────────────────────────────

/**
 * Returns a warning string if the point density is too sparse for reliable
 * measurement snapping. Threshold is points per unit-radius sphere.
 */
export function pointCloudCoverageWarning(density: number): string | null {
  if (density >= 50) return null
  if (density >= 10) return 'Sparse point cloud density in measurement zone — confidence reduced.'
  return 'Very sparse point cloud in measurement zone — consider uploading a denser scan.'
}
