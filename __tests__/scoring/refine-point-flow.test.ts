import { describe, it, expect } from 'vitest'
import { refineSinglePoint } from '@/lib/scoring/subpixel-refine'

/**
 * §4.6 wiring sanity tests. The math is already covered by
 * subpixel-refine.test.ts; these specs verify the contract surface used
 * by the new `/api/measure/refine-point` route plus the photo-canvas
 * refinement helper:
 *   1. Edge-of-image inputs degrade to method='unchanged' (do not crash).
 *   2. Non-finite inputs degrade to method='unchanged' with safe outputs.
 *   3. Coordinates are clamped finite no matter what came in.
 */

function flatGrayPixels(w: number, h: number): Uint8Array {
  const arr = new Uint8Array(w * h)
  for (let i = 0; i < arr.length; i++) arr[i] = 128
  return arr
}

function pixelsWithStrongEdge(w: number, h: number, edgeX: number): Uint8Array {
  const arr = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      arr[y * w + x] = x < edgeX ? 30 : 220
    }
  }
  return arr
}

describe('refineSinglePoint — contract used by /api/measure/refine-point', () => {
  it('returns method=unchanged on a flat neighborhood without crashing', () => {
    const pixels = flatGrayPixels(40, 40)
    const r = refineSinglePoint(
      { id: 'p', x: 20, y: 20 },
      pixels,
      40,
      40,
    )
    expect(r.method).toBe('unchanged')
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
  })

  it('returns method=unchanged near image edges', () => {
    const pixels = flatGrayPixels(40, 40)
    const r = refineSinglePoint(
      { id: 'p', x: 1, y: 1 },
      pixels,
      40,
      40,
    )
    expect(r.method).toBe('unchanged')
    expect(r.reason).toBe('edge_of_image')
  })

  it('coerces non-finite input coords to 0 in the unchanged path', () => {
    const pixels = flatGrayPixels(40, 40)
    const r = refineSinglePoint(
      { id: 'p', x: NaN, y: Infinity },
      pixels,
      40,
      40,
    )
    expect(r.method).toBe('unchanged')
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it('produces finite output for inputs near a strong vertical edge', () => {
    // Synthetic step edges are a degenerate case for Gaussian peak fitting
    // (second derivative collapses), so the algorithm may legitimately
    // return method='unchanged'. The contract we care about for the API
    // surface is that the output is always finite and bounded — never NaN,
    // never Infinity, refinementConfidence ∈ [0, 1].
    const pixels = pixelsWithStrongEdge(40, 40, 20)
    const r = refineSinglePoint(
      { id: 'p', x: 18.4, y: 20 },
      pixels,
      40,
      40,
    )
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(r.refinementConfidence).toBeGreaterThanOrEqual(0)
    expect(r.refinementConfidence).toBeLessThanOrEqual(1)
  })

  it('never returns NaN or Infinity for the refined coordinate', () => {
    const pixels = pixelsWithStrongEdge(40, 40, 20)
    for (const x of [10, 15, 18.4, 21.6, 25]) {
      const r = refineSinglePoint({ id: 'p', x, y: 20 }, pixels, 40, 40)
      expect(Number.isFinite(r.x)).toBe(true)
      expect(Number.isFinite(r.y)).toBe(true)
      expect(r.refinementConfidence).toBeGreaterThanOrEqual(0)
      expect(r.refinementConfidence).toBeLessThanOrEqual(1)
    }
  })
})
