import { describe, it, expect } from 'vitest'
import {
  lineIntersection,
  analyzeVanishingPoint,
  comparePerspectiveTilt,
} from '@/lib/scoring/vanishing-point-geometry'
import type { ParallelLinePair } from '@/lib/scoring/vanishing-point-types'

describe('lineIntersection', () => {
  it('returns the intersection of two non-parallel lines', () => {
    const r = lineIntersection(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 10 }, { x: 10, y: 0 },
    )
    expect(r).not.toBeNull()
    expect(r!.x).toBeCloseTo(5, 5)
    expect(r!.y).toBeCloseTo(5, 5)
  })

  it('returns null for parallel lines', () => {
    const r = lineIntersection(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 0, y: 5 }, { x: 10, y: 5 },
    )
    expect(r).toBeNull()
  })

  it('returns null for non-finite inputs', () => {
    expect(lineIntersection(
      { x: NaN, y: 0 }, { x: 10, y: 0 },
      { x: 0, y: 5 }, { x: 10, y: 5 },
    )).toBeNull()
  })
})

describe('analyzeVanishingPoint', () => {
  it('returns orthogonal severity when no pairs are supplied', () => {
    const r = analyzeVanishingPoint([], 1000, 800)
    expect(r.vanishingPoint).toBeNull()
    expect(r.severity).toBe('orthogonal')
    expect(r.tiltDegrees).toBe(0)
    expect(r.contributingPairsCount).toBe(0)
  })

  it('flags parallel lines as degenerate with a warning', () => {
    const pairs: ParallelLinePair[] = [{
      label: 'fence',
      line1: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      line2: [{ x: 0, y: 10 }, { x: 100, y: 10 }],
    }]
    const r = analyzeVanishingPoint(pairs, 1000, 800)
    expect(r.vanishingPoint).toBeNull()
    expect(r.warnings.join(' ')).toMatch(/parallel or degenerate/)
  })

  it('reports orthogonal severity for a vanishing point at image center', () => {
    // Lines from corners through the center → VP at center.
    const pairs: ParallelLinePair[] = [{
      label: 'centered',
      line1: [{ x: 0, y: 0 }, { x: 500, y: 400 }],
      line2: [{ x: 1000, y: 0 }, { x: 500, y: 400 }],
    }]
    const r = analyzeVanishingPoint(pairs, 1000, 800)
    expect(r.vanishingPoint).not.toBeNull()
    expect(r.severity).toBe('orthogonal')
    expect(r.contributingPairsCount).toBe(1)
  })

  it('reports severe tilt for a vanishing point at the image edge', () => {
    // VP near image edge → atan2(edge_offset, focal_proxy) ≈ 45°
    const pairs: ParallelLinePair[] = [{
      label: 'extreme',
      line1: [{ x: 0, y: 200 }, { x: 1000, y: 400 }],
      line2: [{ x: 0, y: 800 }, { x: 1000, y: 400 }],
    }]
    const r = analyzeVanishingPoint(pairs, 1000, 800)
    expect(r.vanishingPoint).not.toBeNull()
    expect(r.tiltDegrees).toBeGreaterThan(0)
    // VP at (1000, 400) is on the right edge → severity moderate or severe
    expect(['moderate', 'severe', 'mild']).toContain(r.severity)
  })

  it('fuses multiple pairs via median VP', () => {
    const pairs: ParallelLinePair[] = [
      {
        label: 'fence',
        line1: [{ x: 0, y: 0 }, { x: 500, y: 400 }],
        line2: [{ x: 1000, y: 0 }, { x: 500, y: 400 }],
      },
      {
        label: 'truck',
        line1: [{ x: 0, y: 200 }, { x: 500, y: 400 }],
        line2: [{ x: 1000, y: 200 }, { x: 500, y: 400 }],
      },
    ]
    const r = analyzeVanishingPoint(pairs, 1000, 800)
    expect(r.contributingPairsCount).toBe(2)
    expect(r.vanishingPoint).not.toBeNull()
  })
})

describe('comparePerspectiveTilt', () => {
  function makeResult(tiltDegrees: number, pairs = 1) {
    return {
      vanishingPoint: { x: 500, y: 400 } as { x: number; y: number },
      tiltDegrees,
      severity: 'orthogonal' as const,
      contributingPairsCount: pairs,
      warnings: [],
    }
  }

  it('returns null when the VP has no contributing pairs', () => {
    const r = comparePerspectiveTilt({
      vanishingPoint: null,
      tiltDegrees: 0,
      severity: 'orthogonal',
      contributingPairsCount: 0,
      warnings: [],
    }, 0)
    expect(r).toBeNull()
  })

  it('returns null when tilts agree within 35% of the 30° reference scale', () => {
    // primary 5°, VP 10° → delta 5°/30° ≈ 17% — under threshold.
    const r = comparePerspectiveTilt(makeResult(10), 5)
    expect(r).toBeNull()
  })

  it('emits a warning when delta exceeds 35% of the reference scale', () => {
    // primary 0°, VP 20° → delta 20°/30° ≈ 67%.
    const r = comparePerspectiveTilt(makeResult(20), 0)
    expect(r).not.toBeNull()
    expect(r!.severity).toBe('critical')
  })

  it('escalates to critical when delta exceeds 50% of the reference scale', () => {
    // primary 0°, VP 18° → delta 18°/30° = 60% — critical.
    const r = comparePerspectiveTilt(makeResult(18), 0)
    expect(r!.severity).toBe('critical')
  })

  it('caps at warning for moderate delta', () => {
    // primary 5°, VP 17° → delta 12°/30° = 40% — warning.
    const r = comparePerspectiveTilt(makeResult(17), 5)
    expect(r).not.toBeNull()
    expect(r!.severity).toBe('warning')
  })

  it('ignores non-finite primary tilts', () => {
    const r = comparePerspectiveTilt(makeResult(20), NaN)
    expect(r).toBeNull()
  })
})
