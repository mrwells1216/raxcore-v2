import { isFiniteNumber } from './geometry'

export interface Vec3 { x: number; y: number; z: number }
export interface MeshPlane { origin: Vec3; normal: Vec3 }
export interface CircumferenceRing {
  points: Vec3[]
  closed: boolean
  perimeter: number | null
}
export interface MeshCircumferenceResult {
  segments: Array<{ a: Vec3; b: Vec3 }>
  rings: CircumferenceRing[]
  closedRingCount: number
  confidence: number
  warnings: string[]
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b))
}

function signedDist(p: Vec3, plane: MeshPlane): number {
  return dot(sub(p, plane.origin), plane.normal)
}

// Interpolate edge intersection point
function edgeIntersect(p0: Vec3, d0: number, p1: Vec3, d1: number): Vec3 {
  const t = d0 / (d0 - d1)
  return add(p0, scale(sub(p1, p0), t))
}

function segmentLength(a: Vec3, b: Vec3): number {
  return dist(a, b)
}

function stitchRings(
  segments: Array<{ a: Vec3; b: Vec3 }>,
  tolerance: number,
): CircumferenceRing[] {
  // Build adjacency list by matching endpoints
  const unused = new Set<number>(segments.map((_, i) => i))
  const rings: CircumferenceRing[] = []

  while (unused.size > 0) {
    // Start a new chain from the first unused segment
    const startIdx = unused.values().next().value as number
    unused.delete(startIdx)
    const chain: Vec3[] = [segments[startIdx].a, segments[startIdx].b]

    let extended = true
    while (extended) {
      extended = false
      const tail = chain[chain.length - 1]
      for (const idx of unused) {
        const seg = segments[idx]
        if (dist(tail, seg.a) <= tolerance) {
          chain.push(seg.b)
          unused.delete(idx)
          extended = true
          break
        }
        if (dist(tail, seg.b) <= tolerance) {
          chain.push(seg.a)
          unused.delete(idx)
          extended = true
          break
        }
      }
    }

    const closed = chain.length >= 3 && dist(chain[0], chain[chain.length - 1]) <= tolerance
    let perimeter: number | null = null
    if (closed) {
      perimeter = 0
      for (let i = 0; i < chain.length - 1; i++) {
        const seg = segmentLength(chain[i], chain[i + 1])
        if (!isFiniteNumber(seg)) { perimeter = null; break }
        perimeter += seg
      }
    }
    rings.push({ points: chain, closed, perimeter })
  }

  return rings
}

export function computeMeshCircumference(
  positions: Float32Array,
  indices: Uint32Array | null,
  plane: MeshPlane,
  bboxDiagonal: number,
): MeshCircumferenceResult {
  const warnings: string[] = []
  const segments: Array<{ a: Vec3; b: Vec3 }> = []

  if (!isFiniteNumber(bboxDiagonal) || bboxDiagonal <= 0) {
    return { segments: [], rings: [], closedRingCount: 0, confidence: 0, warnings: ['Invalid bounding box diagonal.'] }
  }

  const tolerance = 1e-4 * bboxDiagonal
  const triCount = indices ? indices.length / 3 : positions.length / 9
  const edgeUseCount = new Map<string, number>()

  function getVert(i: number): Vec3 {
    const base = i * 3
    return { x: positions[base], y: positions[base + 1], z: positions[base + 2] }
  }

  function edgeKey(i: number, j: number): string {
    return i < j ? `${i}:${j}` : `${j}:${i}`
  }

  let nearPlaneTris = 0
  const planeRadius = bboxDiagonal * 0.15

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number
    if (indices) {
      i0 = indices[t * 3]
      i1 = indices[t * 3 + 1]
      i2 = indices[t * 3 + 2]
    } else {
      i0 = t * 3
      i1 = t * 3 + 1
      i2 = t * 3 + 2
    }

    const v0 = getVert(i0)
    const v1 = getVert(i1)
    const v2 = getVert(i2)

    // Track edge use for non-manifold detection
    if (indices) {
      const e01 = edgeKey(i0, i1)
      const e12 = edgeKey(i1, i2)
      const e20 = edgeKey(i2, i0)
      edgeUseCount.set(e01, (edgeUseCount.get(e01) ?? 0) + 1)
      edgeUseCount.set(e12, (edgeUseCount.get(e12) ?? 0) + 1)
      edgeUseCount.set(e20, (edgeUseCount.get(e20) ?? 0) + 1)
    }

    const d0 = signedDist(v0, plane)
    const d1 = signedDist(v1, plane)
    const d2 = signedDist(v2, plane)

    if (!isFiniteNumber(d0) || !isFiniteNumber(d1) || !isFiniteNumber(d2)) continue

    // Count triangles near the plane for density check
    const centroid: Vec3 = { x: (v0.x + v1.x + v2.x) / 3, y: (v0.y + v1.y + v2.y) / 3, z: (v0.z + v1.z + v2.z) / 3 }
    if (dist(centroid, plane.origin) < planeRadius) nearPlaneTris++

    // Check if triangle spans the plane
    const pos = (d0 > 0 ? 1 : 0) + (d1 > 0 ? 1 : 0) + (d2 > 0 ? 1 : 0)
    if (pos === 0 || pos === 3) continue // All same side

    // Compute the two intersection points
    let pa: Vec3 | null = null
    let pb: Vec3 | null = null

    const edges: Array<[Vec3, number, Vec3, number]> = [
      [v0, d0, v1, d1],
      [v1, d1, v2, d2],
      [v2, d2, v0, d0],
    ]

    for (const [ea, da, eb, db] of edges) {
      if ((da > 0 && db <= 0) || (da <= 0 && db > 0)) {
        const pt = edgeIntersect(ea, da, eb, db)
        if (pa === null) pa = pt
        else if (pb === null) { pb = pt; break }
      }
    }

    if (pa && pb) {
      segments.push({ a: pa, b: pb })
    }
  }

  if (segments.length === 0) {
    return {
      segments: [],
      rings: [],
      closedRingCount: 0,
      confidence: 0,
      warnings: ['No mesh-plane intersections found. Check plane placement.'],
    }
  }

  const rings = stitchRings(segments, tolerance)
  const closedRings = rings.filter(r => r.closed && r.perimeter !== null)
  const closedRingCount = closedRings.length

  // Confidence scoring
  let confidence = 0.70

  // Non-manifold detection
  let nonManifold = false
  if (indices) {
    for (const count of edgeUseCount.values()) {
      if (count > 2) { nonManifold = true; break }
    }
  }
  if (nonManifold) {
    confidence -= 0.10
    warnings.push('Non-manifold mesh near plane')
  }

  // Low density
  if (nearPlaneTris < 5000) {
    confidence -= 0.10
    warnings.push('Mesh density low near plane')
  }

  // Open rings penalty
  const openRings = rings.filter(r => !r.closed)
  if (openRings.length > 0) {
    const maxClosedPerimeter = closedRings.reduce((m, r) => Math.max(m, r.perimeter ?? 0), 0)
    const significantOpenRings = openRings.filter(r => {
      const openPerimeter = r.points.reduce((sum, _, i) => {
        if (i === 0) return sum
        return sum + segmentLength(r.points[i - 1], r.points[i])
      }, 0)
      return maxClosedPerimeter > 0 && openPerimeter > maxClosedPerimeter * 0.1
    })
    confidence -= 0.15 * significantOpenRings.length
    if (openRings.length > 0) warnings.push('Open ring detected — perimeter incomplete')
  }

  if (closedRingCount > 1) {
    warnings.push('Multiple rings found — picked the longest closed one')
  }

  confidence = Math.max(0, Math.min(1, confidence))
  if (!isFiniteNumber(confidence)) confidence = 0

  return { segments, rings, closedRingCount, confidence, warnings }
}
