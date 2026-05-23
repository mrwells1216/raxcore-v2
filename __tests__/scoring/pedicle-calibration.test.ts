import { describe, it, expect } from 'vitest'
import { resolveCalibration, type PedicleCalibrationInput } from '@/lib/scoring/calibration-resolver'

function dots(
  imageIndex: number,
  leftPx: number,
  rightPx: number,
  knownInches: number | null = null,
  ypx = 200,
): PedicleCalibrationInput {
  return { imageIndex, leftPx, leftPy: ypx, rightPx, rightPy: ypx, knownInches }
}

describe('resolveCalibration — pedicle dots', () => {
  it('returns null when no pedicle inputs and no other sources', () => {
    expect(resolveCalibration([], null, null)).toBeNull()
    expect(resolveCalibration([], null, null, undefined, null)).toBeNull()
  })

  it('returns null for inputs with insufficient pixel distance (<= 5 px)', () => {
    const r = resolveCalibration([], null, null, undefined, [dots(0, 100, 103)])
    expect(r).toBeNull()
  })

  it('uses 0.85 confidence when user supplies a measured pedicle spacing', () => {
    // 380 px / 4.0" = 95 px/in
    const r = resolveCalibration([], null, null, undefined, [dots(0, 100, 480, 4.0)])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_known')
    expect(r!.confidence).toBe(0.85)
    expect(r!.pixelsPerInch).toBeCloseTo(95, 0)
  })

  it('uses 0.68 confidence and 3.8" default when no measurement is supplied', () => {
    // 380 px / 3.8" = 100 px/in
    const r = resolveCalibration([], null, null, undefined, [dots(0, 100, 480)])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_anatomical')
    expect(r!.confidence).toBe(0.68)
    expect(r!.pixelsPerInch).toBeCloseTo(100, 0)
  })

  it('clamps an out-of-band knownInches to anatomical default and warns', () => {
    const r = resolveCalibration([], null, null, undefined, [dots(0, 100, 480, 12.0)])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_anatomical')
    expect(r!.warnings.join(' ')).toMatch(/outside 2-8/)
  })

  it('rejects an out-of-band negative knownInches', () => {
    const r = resolveCalibration([], null, null, undefined, [dots(0, 100, 480, -3)])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_anatomical')
  })

  it('demotes to anatomical when sources are mixed across images', () => {
    const r = resolveCalibration([], null, null, undefined, [
      dots(0, 100, 480, 4.0),
      dots(1, 100, 480, null),
    ])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_anatomical')
    expect(r!.confidence).toBe(0.68)
  })

  it('rejects outliers across multiple images via median ± 25%', () => {
    // Three measurements: 100, 105, and 250 px/in. The 250 should be dropped.
    const r = resolveCalibration([], null, null, undefined, [
      dots(0, 100, 480, 3.8), // 100 px/in
      dots(1, 100, 499, 3.8), // ~105 px/in
      dots(2, 100, 1050, 3.8), // ~250 px/in
    ])
    expect(r).not.toBeNull()
    expect(r!.warnings.join(' ')).toMatch(/Rejected 1 pedicle outlier/)
    expect(r!.pixelsPerInch).toBeGreaterThan(95)
    expect(r!.pixelsPerInch).toBeLessThan(120)
  })

  it('returns warning when survivors disagree by >12%', () => {
    const r = resolveCalibration([], null, null, undefined, [
      dots(0, 100, 480, 3.8), // 100 px/in
      dots(1, 100, 553, 3.8), // ~119 px/in (19% off)
    ])
    expect(r).not.toBeNull()
    expect(r!.warnings.join(' ')).toMatch(/disagree across images/)
  })

  it('ignores inputs with NaN/Infinity pixel coordinates', () => {
    const r = resolveCalibration([], null, null, undefined, [
      { imageIndex: 0, leftPx: NaN, leftPy: 200, rightPx: 480, rightPy: 200, knownInches: null },
      dots(1, 100, 480),
    ])
    expect(r).not.toBeNull()
    expect(r!.source).toBe('user_placed_anatomical')
  })
})
