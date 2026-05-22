/**
 * lib/advanced-scoring/subpixel-refine.ts
 *
 * Sub-pixel refinement for Advanced Scoring physical-reference endpoints.
 * Reuses the Gaussian peak math from `lib/scoring/subpixel-refine.ts` for
 * each endpoint, then adds a line-aware step:
 *
 *   1. Refine each endpoint independently.
 *   2. Sample N points along the line between refined endpoints.
 *   3. Walk perpendicular ±5 px and find the gradient maximum at each sample.
 *   4. Median perpendicular offset = how far the true edge sits from the
 *      naive endpoint-to-endpoint line.
 *   5. Project each refined endpoint onto the shifted centerline. Kills the
 *      case where one endpoint drifted off the ruler by sub-pixel amounts.
 *
 * The physical_reference calibration is the only path to Verified Score
 * (CLAUDE.md §13). Integer-pixel error here multiplies through every
 * Verified field — this module exists to remove that error source.
 *
 * Server-side only. Pure. Never throws — degenerate inputs degrade to
 * `method: 'unchanged'` and `lineQuality: 0`.
 */

import { isFiniteNumber } from './geometry'
import { decodeGrayscale } from '@/lib/scoring/subpixel-refine'

// SP2 deliberately does NOT call SP1's per-endpoint Gaussian peak fit.
// SP1 is designed for Gaussian-shaped peak features (e.g., LLM landmarks
// at edge midpoints) — it wanders on line endpoints where the gradient
// has no characteristic peak. The line-aware projection step below is
// what actually corrects sub-pixel calibration error.
export type RefineReferenceMethod = 'line_aware_projection' | 'unchanged'

export interface RefineReferenceInput {
  imageBuffer: Buffer
  imageWidth: number
  imageHeight: number
  endpoints: readonly [
    { x: number; y: number },
    { x: number; y: number },
  ]
}

export interface RefinedEndpoint {
  x: number
  y: number
  refinementConfidence: number
  method: RefineReferenceMethod
  reason?: string
}

export interface RefineReferenceResult {
  endpoints: [RefinedEndpoint, RefinedEndpoint]
  /** 0..1 — fraction of perpendicular samples that land on a strong edge. */
  lineQuality: number
  /** refined_length − input_length, in pixels. Sanity metric. */
  lengthDelta: number
}

const PERPENDICULAR_SAMPLES = 15
const PERPENDICULAR_HALF_WIDTH = 5
// Sobel on 0–255 pixels produces |G| up to ≈ sqrt(2)·1020 ≈ 1442 at a
// perfectly contrasted edge. Normalize by 1020 — close to the practical
// upper bound and matches the plan's "max possible" definition.
const SOBEL_MAX = 1020
const LINE_QUALITY_KEEP_THRESHOLD = 0.25

export async function refineReferenceEndpoints(
  input: RefineReferenceInput,
): Promise<RefineReferenceResult> {
  const [a, b] = input.endpoints
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) {
    return rawFallback(input, 0)
  }

  const decoded = await decodeGrayscale(input.imageBuffer)
  if (!decoded) return rawFallback(input, 0)

  const { pixels, width, height } = decoded

  // Line-aware projection: sample perpendicular gradient peaks along the
  // user's line, find the median offset to the true edge, shift the
  // centerline by that median, project both endpoints onto the new line.
  const projected = projectOntoCenterline(a, b, pixels, width, height)
  if (!projected) {
    return {
      endpoints: [
        { x: a.x, y: a.y, refinementConfidence: 0.3, method: 'unchanged', reason: 'no_edge_found' },
        { x: b.x, y: b.y, refinementConfidence: 0.3, method: 'unchanged', reason: 'no_edge_found' },
      ],
      lineQuality: 0,
      lengthDelta: 0,
    }
  }

  // If the line is too faint to trust the projection, keep the user's
  // raw points but report lineQuality so the UI can decide whether to
  // surface a weak-edge warning.
  if (projected.lineQuality < LINE_QUALITY_KEEP_THRESHOLD) {
    return {
      endpoints: [
        { x: a.x, y: a.y, refinementConfidence: 0.3, method: 'unchanged', reason: 'low_line_quality' },
        { x: b.x, y: b.y, refinementConfidence: 0.3, method: 'unchanged', reason: 'low_line_quality' },
      ],
      lineQuality: projected.lineQuality,
      lengthDelta: 0,
    }
  }

  const finalA = projected.a
  const finalB = projected.b
  if (
    !isFiniteNumber(finalA.x) ||
    !isFiniteNumber(finalA.y) ||
    !isFiniteNumber(finalB.x) ||
    !isFiniteNumber(finalB.y)
  ) {
    return rawFallback(input, 0)
  }

  const inputLen = Math.hypot(b.x - a.x, b.y - a.y)
  const refinedLen = Math.hypot(finalB.x - finalA.x, finalB.y - finalA.y)
  const lengthDelta = isFiniteNumber(refinedLen - inputLen) ? refinedLen - inputLen : 0
  const confidence = Math.max(0, Math.min(1, projected.lineQuality))

  return {
    endpoints: [
      { x: finalA.x, y: finalA.y, refinementConfidence: confidence, method: 'line_aware_projection' },
      { x: finalB.x, y: finalB.y, refinementConfidence: confidence, method: 'line_aware_projection' },
    ],
    lineQuality: projected.lineQuality,
    lengthDelta,
  }
}

function rawFallback(input: RefineReferenceInput, lineQuality: number): RefineReferenceResult {
  const [a, b] = input.endpoints
  // Even on fallback, never emit NaN or Infinity — substitute 0 for any
  // non-finite input so downstream math never propagates poison values.
  return {
    endpoints: [
      {
        x: isFiniteNumber(a.x) ? a.x : 0,
        y: isFiniteNumber(a.y) ? a.y : 0,
        refinementConfidence: 0.2,
        method: 'unchanged',
        reason: 'decode_or_input_failed',
      },
      {
        x: isFiniteNumber(b.x) ? b.x : 0,
        y: isFiniteNumber(b.y) ? b.y : 0,
        refinementConfidence: 0.2,
        method: 'unchanged',
        reason: 'decode_or_input_failed',
      },
    ],
    lineQuality: isFiniteNumber(lineQuality) ? lineQuality : 0,
    lengthDelta: 0,
  }
}

// ─── Centerline projection ──────────────────────────────────────────────────

interface ProjectionResult {
  a: { x: number; y: number }
  b: { x: number; y: number }
  lineQuality: number
}

function projectOntoCenterline(
  a: { x: number; y: number },
  b: { x: number; y: number },
  pixels: Uint8Array,
  width: number,
  height: number,
): ProjectionResult | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (!isFiniteNumber(length) || length < 1) return null

  const ux = dx / length
  const uy = dy / length
  // Unit normal perpendicular to (ux, uy).
  const nx = -uy
  const ny = ux

  const offsets: number[] = []
  const magnitudes: number[] = []

  for (let i = 0; i < PERPENDICULAR_SAMPLES; i++) {
    const t = i / (PERPENDICULAR_SAMPLES - 1)
    const sx = a.x + ux * length * t
    const sy = a.y + uy * length * t

    let bestMag = 0
    let bestOffset = 0
    for (let k = -PERPENDICULAR_HALF_WIDTH; k <= PERPENDICULAR_HALF_WIDTH; k++) {
      const px = sx + nx * k
      const py = sy + ny * k
      const mag = sampleGradientMagnitude(pixels, width, height, px, py)
      if (mag > bestMag) {
        bestMag = mag
        bestOffset = k
      }
    }
    if (bestMag > 0) {
      offsets.push(bestOffset)
      magnitudes.push(bestMag)
    }
  }

  if (offsets.length < 3) return null

  const median = medianOf(offsets)
  const meanMag = magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length
  const lineQuality = Math.max(0, Math.min(1, meanMag / SOBEL_MAX))

  // Shift the centerline by median·n, then project a and b onto it.
  const cx = a.x + nx * median
  const cy = a.y + ny * median
  const projectPoint = (p: { x: number; y: number }) => {
    const vx = p.x - cx
    const vy = p.y - cy
    const t = vx * ux + vy * uy
    return { x: cx + ux * t, y: cy + uy * t }
  }

  const projA = projectPoint(a)
  const projB = projectPoint(b)
  if (
    !isFiniteNumber(projA.x) ||
    !isFiniteNumber(projA.y) ||
    !isFiniteNumber(projB.x) ||
    !isFiniteNumber(projB.y)
  ) {
    return null
  }
  return { a: projA, b: projB, lineQuality }
}

/**
 * Bilinear-interpolated Sobel-3 gradient magnitude at a sub-pixel
 * location. Returns 0 if the point is within 1 px of the image boundary.
 */
function sampleGradientMagnitude(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const g00 = sobelAt(pixels, width, x0, y0)
  const g10 = sobelAt(pixels, width, x0 + 1, y0)
  const g01 = sobelAt(pixels, width, x0, y0 + 1)
  const g11 = sobelAt(pixels, width, x0 + 1, y0 + 1)
  if (g00 < 0 || g10 < 0 || g01 < 0 || g11 < 0) return 0
  return (
    g00 * (1 - fx) * (1 - fy) +
    g10 * fx * (1 - fy) +
    g01 * (1 - fx) * fy +
    g11 * fx * fy
  )
}

function sobelAt(pixels: Uint8Array, width: number, px: number, py: number): number {
  // Caller guarantees px, py are at least 1 from the image edge.
  const i00 = pixels[(py - 1) * width + (px - 1)]
  const i01 = pixels[(py - 1) * width + px]
  const i02 = pixels[(py - 1) * width + (px + 1)]
  const i10 = pixels[py * width + (px - 1)]
  const i12 = pixels[py * width + (px + 1)]
  const i20 = pixels[(py + 1) * width + (px - 1)]
  const i21 = pixels[(py + 1) * width + px]
  const i22 = pixels[(py + 1) * width + (px + 1)]
  const gx = -i00 - 2 * i10 - i20 + i02 + 2 * i12 + i22
  const gy = -i00 - 2 * i01 - i02 + i20 + 2 * i21 + i22
  return Math.sqrt(gx * gx + gy * gy)
}

function medianOf(arr: readonly number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
