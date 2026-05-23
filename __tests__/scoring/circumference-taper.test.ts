import { describe, it, expect } from 'vitest'
import {
  deriveCircumferences,
  applyTaperToMeasurements,
  CircumferenceTaperError,
  TAPER_RATIOS,
} from '@/lib/scoring/circumference-taper'

describe('deriveCircumferences', () => {
  it('applies the published taper ratios to derive H2/H3/H4', () => {
    const r = deriveCircumferences(4.5, 'left')
    expect(r.h1_left).toBe(4.5)
    expect(r.h2_left).toBeCloseTo(4.5 * TAPER_RATIOS.H2, 1)
    expect(r.h3_left).toBeCloseTo(4.5 * TAPER_RATIOS.H3, 1)
    expect(r.h4_left).toBeCloseTo(4.5 * TAPER_RATIOS.H4, 1)
  })

  it('mirrors the opposite side from the measured side', () => {
    const left = deriveCircumferences(5.0, 'left')
    expect(left.h1_right).toBe(left.h1_left)
    expect(left.h2_right).toBe(left.h2_left)
    expect(left.h3_right).toBe(left.h3_left)
    expect(left.h4_right).toBe(left.h4_left)
  })

  it('tags derived values with the right provenance keys', () => {
    const r = deriveCircumferences(4.0, 'right')
    expect(r.derivedSource).toBe('derived_taper')
    expect(r.measuredSource).toBe('measured')
    expect(r.measuredSide).toBe('right')
  })

  it('rejects values below the 1.0" floor', () => {
    expect(() => deriveCircumferences(0.5, 'left')).toThrow(CircumferenceTaperError)
  })

  it('rejects values above the 8.0" ceiling', () => {
    expect(() => deriveCircumferences(9.0, 'left')).toThrow(CircumferenceTaperError)
  })

  it('rejects non-finite inputs (NaN, Infinity)', () => {
    expect(() => deriveCircumferences(NaN, 'left')).toThrow(CircumferenceTaperError)
    expect(() => deriveCircumferences(Infinity, 'left')).toThrow(CircumferenceTaperError)
  })

  it('produces a monotonically decreasing ladder', () => {
    const r = deriveCircumferences(5.5, 'left')
    expect(r.h1_left).toBeGreaterThan(r.h2_left)
    expect(r.h2_left).toBeGreaterThan(r.h3_left)
    expect(r.h3_left).toBeGreaterThan(r.h4_left)
  })

  it('rounds derived values to one decimal place', () => {
    const r = deriveCircumferences(4.7, 'left')
    expect(r.h2_left).toBe(Math.round(4.7 * TAPER_RATIOS.H2 * 10) / 10)
    expect(r.h3_left).toBe(Math.round(4.7 * TAPER_RATIOS.H3 * 10) / 10)
    expect(r.h4_left).toBe(Math.round(4.7 * TAPER_RATIOS.H4 * 10) / 10)
  })
})

describe('applyTaperToMeasurements', () => {
  it('replaces only H1-H4 fields and preserves everything else', () => {
    const existing = {
      inside_spread: 18,
      main_beam_left: 24,
      h1_left: 3.9, h1_right: 3.9,
      h2_left: 3.7, h2_right: 3.7,
      h3_left: 3.5, h3_right: 3.5,
      h4_left: 3.3, h4_right: 3.3,
      g1_left: 4,
      deductions: 2,
    }
    const derived = deriveCircumferences(5.0, 'left')
    const updated = applyTaperToMeasurements(existing, derived)
    expect(updated.h1_left).toBe(5.0)
    expect(updated.h2_left).toBeCloseTo(5.0 * TAPER_RATIOS.H2, 1)
    expect(updated.inside_spread).toBe(18)
    expect(updated.main_beam_left).toBe(24)
    expect(updated.g1_left).toBe(4)
    expect(updated.deductions).toBe(2)
  })
})
