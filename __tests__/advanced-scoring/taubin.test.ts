import { describe, it, expect } from 'vitest'
import {
  fitCircleTaubin,
  circumferenceFromPoints,
} from '@/lib/advanced-scoring/geometry'

function pointsOnArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  count: number,
): Array<{ x: number; y: number }> {
  const startRad = (startDeg * Math.PI) / 180
  const endRad = (endDeg * Math.PI) / 180
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const ang = startRad + (endRad - startRad) * t
    out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) })
  }
  return out
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function gaussianNoise(rng: () => number, sigma: number): number {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

describe('fitCircleTaubin', () => {
  it('1. recovers a perfect full circle within ±0.001', () => {
    const points = pointsOnArc(100, 100, 50, 0, 330, 12)
    const fit = fitCircleTaubin(points)
    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.cx - 100)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(fit!.cy - 100)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(fit!.r - 50)).toBeLessThanOrEqual(0.001)
    expect(fit!.residualRms).toBeLessThan(0.01)
  })

  it('2. recovers radius on a 180° partial arc within ±0.5', () => {
    const points = pointsOnArc(100, 100, 50, 0, 180, 6)
    const fit = fitCircleTaubin(points)
    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.r - 50)).toBeLessThanOrEqual(0.5)
  })

  it('3. recovers radius from a noisy 180° arc within ±2', () => {
    const rng = makeRng(54321)
    const clean = pointsOnArc(100, 100, 50, 0, 180, 6)
    const noisy = clean.map((p) => ({
      x: p.x + gaussianNoise(rng, 0.5),
      y: p.y + gaussianNoise(rng, 0.5),
    }))
    const fit = fitCircleTaubin(noisy)
    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.r - 50)).toBeLessThanOrEqual(2)
    expect(fit!.residualRms).toBeGreaterThan(0.1)
    expect(fit!.residualRms).toBeLessThan(1.5)
  })

  it('4. returns null on collinear input; circumferenceFromPoints falls through', () => {
    const collinear = [
      { x: 0, y: 5 },
      { x: 2, y: 5 },
      { x: 4, y: 5 },
      { x: 6, y: 5 },
      { x: 8, y: 5 },
    ]
    const fit = fitCircleTaubin(collinear)
    expect(fit).toBeNull()

    const res = circumferenceFromPoints(collinear)
    expect(res).toBeNull()
  })
})

describe('circumferenceFromPoints arc-coverage detection', () => {
  it('5a. 4 points spanning 50° → chord_sum_fallback', () => {
    const points = pointsOnArc(0, 0, 30, 0, 50, 4)
    const res = circumferenceFromPoints(points)
    expect(res).not.toBeNull()
    expect(res!.method).toBe('chord_sum_fallback')
    expect(res!.arcCoverageDeg).toBeLessThan(60)
  })

  it('5b. 6 points spanning 100° → taubin_arc', () => {
    const points = pointsOnArc(0, 0, 30, 0, 100, 6)
    const res = circumferenceFromPoints(points)
    expect(res).not.toBeNull()
    expect(res!.method).toBe('taubin_arc')
    expect(res!.arcCoverageDeg).toBeGreaterThan(60)
    expect(res!.arcCoverageDeg).toBeLessThan(270)
  })

  it('5c. 12 points spanning 320° → taubin_full', () => {
    const points = pointsOnArc(0, 0, 30, 0, 320, 12)
    const res = circumferenceFromPoints(points)
    expect(res).not.toBeNull()
    expect(res!.method).toBe('taubin_full')
    expect(res!.arcCoverageDeg).toBeGreaterThan(270)
  })

  it('6. typical antler arc (8 points, ~180°) stays within sane bounds vs chord sum', () => {
    // An antler photographed from one side typically yields a ~180° arc of
    // perimeter points. This is the operating point of the change.
    const points = pointsOnArc(0, 0, 30, 0, 180, 8)
    const res = circumferenceFromPoints(points)
    expect(res).not.toBeNull()
    expect(res!.method).toBe('taubin_arc')

    let chord = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dy = points[i].y - points[i - 1].y
      chord += Math.sqrt(dx * dx + dy * dy)
    }

    // Taubin should not change the answer by more than 5% vs chord-sum on
    // dense, low-noise input — the regression guard for downstream scores.
    const ratio = res!.circumference / chord
    expect(ratio).toBeGreaterThan(0.95)
    expect(ratio).toBeLessThan(1.05)
    expect(res!.fitConfidence).toBeGreaterThan(0)
    expect(res!.fitConfidence).toBeLessThanOrEqual(1)
  })
})
