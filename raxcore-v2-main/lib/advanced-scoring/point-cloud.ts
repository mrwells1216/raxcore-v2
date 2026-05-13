/**
 * Lightweight point-cloud utilities for parsing, snapping, and density checks.
 * Rendering can downsample, but measurement anchoring should use the full index.
 */

import type { MeasurementPoint3D, PointCloudPoint } from './types'
import { distance3D, isFiniteNumber } from './geometry'

export interface PointCloudIndex {
  points: PointCloudPoint[]
  cellSize: number
  cells: Map<string, number[]>
}

function cellCoord(value: number, cellSize: number): number {
  return Math.floor(value / cellSize)
}

function cellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function isValidPoint3D(point: MeasurementPoint3D): boolean {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z)
}

function squaredDistance3D(a: MeasurementPoint3D, b: MeasurementPoint3D): number {
  if (!isValidPoint3D(a) || !isValidPoint3D(b)) return Infinity
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * Parse .xyz, .pts, .csv, or simple whitespace text point clouds.
 * Headers, blank lines, comments, malformed rows, and extra columns are skipped.
 */
export function parsePointCloudText(text: string): PointCloudPoint[] {
  if (!text || typeof text !== 'string') return []

  const points: PointCloudPoint[] = []

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    const parts = trimmed.split(/[\s,]+/).map(Number)
    if (parts.length < 3) continue

    const [x, y, z, r, g, b] = parts
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue

    const point: PointCloudPoint = { x, y, z }
    if (isFiniteNumber(r) && isFiniteNumber(g) && isFiniteNumber(b)) {
      const scale = r > 1 || g > 1 || b > 1 ? 255 : 1
      point.color = {
        r: Math.max(0, Math.min(1, r / scale)),
        g: Math.max(0, Math.min(1, g / scale)),
        b: Math.max(0, Math.min(1, b / scale)),
      }
    }

    points.push(point)
  }

  return points
}

export function createPointCloudIndex(points: PointCloudPoint[], cellSize: number): PointCloudIndex {
  const safeCellSize = isFiniteNumber(cellSize) && cellSize > 0 ? cellSize : 0.01
  const validPoints = points.filter(isValidPoint3D)
  const cells = new Map<string, number[]>()

  validPoints.forEach((point, index) => {
    const key = cellKey(
      cellCoord(point.x, safeCellSize),
      cellCoord(point.y, safeCellSize),
      cellCoord(point.z, safeCellSize),
    )
    const existing = cells.get(key)
    if (existing) existing.push(index)
    else cells.set(key, [index])
  })

  return { points: validPoints, cellSize: safeCellSize, cells }
}

/**
 * Linear fallback nearest-anchor search. Kept for compatibility and small clouds.
 */
export function findNearestPointCloudAnchor(
  point: MeasurementPoint3D,
  cloudPoints: PointCloudPoint[],
  maxSnapDistance: number,
): PointCloudPoint | null {
  if (!isValidPoint3D(point) || !cloudPoints.length || !isFiniteNumber(maxSnapDistance) || maxSnapDistance <= 0) {
    return null
  }

  let nearest: PointCloudPoint | null = null
  let nearestDistSq = maxSnapDistance * maxSnapDistance

  for (const cloudPoint of cloudPoints) {
    const distSq = squaredDistance3D(point, cloudPoint)
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq
      nearest = cloudPoint
    }
  }

  return nearest
}

export function findNearestPointCloudAnchorIndexed(
  point: MeasurementPoint3D,
  index: PointCloudIndex | null | undefined,
  maxSnapDistance: number,
): PointCloudPoint | null {
  if (!index || !isValidPoint3D(point) || !index.points.length || !isFiniteNumber(maxSnapDistance) || maxSnapDistance <= 0) {
    return null
  }

  const cx = cellCoord(point.x, index.cellSize)
  const cy = cellCoord(point.y, index.cellSize)
  const cz = cellCoord(point.z, index.cellSize)
  const cellRadius = Math.max(1, Math.ceil(maxSnapDistance / index.cellSize))
  let nearest: PointCloudPoint | null = null
  let nearestDistSq = maxSnapDistance * maxSnapDistance

  for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
    for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
      for (let z = cz - cellRadius; z <= cz + cellRadius; z++) {
        const candidates = index.cells.get(cellKey(x, y, z))
        if (!candidates) continue

        for (const candidateIndex of candidates) {
          const candidate = index.points[candidateIndex]
          const distSq = squaredDistance3D(point, candidate)
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq
            nearest = candidate
          }
        }
      }
    }
  }

  return nearest
}

export function snapPolylineToPointCloud(
  points: MeasurementPoint3D[],
  cloudPoints: PointCloudPoint[],
  maxSnapDistance: number,
): { snapped: MeasurementPoint3D[]; allSnapped: boolean } {
  if (!cloudPoints.length) return { snapped: points, allSnapped: false }

  let allSnapped = true
  const snapped = points.map((point) => {
    const anchor = findNearestPointCloudAnchor(point, cloudPoints, maxSnapDistance)
    if (anchor) return { x: anchor.x, y: anchor.y, z: anchor.z }
    allSnapped = false
    return point
  })

  return { snapped, allSnapped }
}

export function estimatePointDensityAround(
  point: MeasurementPoint3D,
  cloudPoints: PointCloudPoint[],
  radius: number,
): number {
  if (!isValidPoint3D(point) || !cloudPoints.length || !isFiniteNumber(radius) || radius <= 0) return 0
  let count = 0
  for (const cloudPoint of cloudPoints) {
    if (distance3D(point, cloudPoint) <= radius) count++
  }
  return count
}

export function estimatePointDensityAroundIndexed(
  point: MeasurementPoint3D,
  index: PointCloudIndex | null | undefined,
  radius: number,
): number {
  if (!index || !isValidPoint3D(point) || !index.points.length || !isFiniteNumber(radius) || radius <= 0) return 0

  const cx = cellCoord(point.x, index.cellSize)
  const cy = cellCoord(point.y, index.cellSize)
  const cz = cellCoord(point.z, index.cellSize)
  const cellRadius = Math.max(1, Math.ceil(radius / index.cellSize))
  const radiusSq = radius * radius
  let count = 0

  for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
    for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
      for (let z = cz - cellRadius; z <= cz + cellRadius; z++) {
        const candidates = index.cells.get(cellKey(x, y, z))
        if (!candidates) continue

        for (const candidateIndex of candidates) {
          if (squaredDistance3D(point, index.points[candidateIndex]) <= radiusSq) {
            count++
          }
        }
      }
    }
  }

  return count
}

export function pointCloudCoverageWarning(density: number): string | null {
  if (!isFiniteNumber(density)) return 'Sparse point cloud density in measurement zone'
  if (density >= 50) return null
  if (density >= 10) return 'Sparse point cloud density in measurement zone'
  return 'Very sparse point cloud in measurement zone'
}
