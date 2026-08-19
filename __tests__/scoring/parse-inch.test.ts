import { describe, it, expect } from 'vitest'
import { parseInch, toEighths, fromEighths } from '@/components/admin/training-import-form'

/**
 * These values become the ground truth every later accuracy claim is measured
 * against, so a silent misparse here is far worse than a visible error. The
 * previous implementation was a bare parseFloat: "4 6/8" became 4 and "6/8"
 * became 6, with no warning.
 */
describe('parseInch', () => {
  it('leaves plain decimals exactly as they were (no regression)', () => {
    expect(parseInch('4.75')).toBeCloseTo(4.75, 6)
    expect(parseInch('0.375')).toBeCloseTo(0.375, 6)
    expect(parseInch('22')).toBe(22)
    expect(parseInch('0')).toBe(0)
  })

  it('parses mixed eighths the way a scorer writes them', () => {
    expect(parseInch('4 6/8')).toBeCloseTo(4.75, 6)
    expect(parseInch('4-6/8')).toBeCloseTo(4.75, 6)
    expect(parseInch('22 3/8')).toBeCloseTo(22.375, 6)
    expect(parseInch('5 1/2')).toBeCloseTo(5.5, 6)
  })

  it('parses a bare fraction as a sub-inch value, not a whole number', () => {
    // The old behavior returned 6 here — a 5.25" error on one field.
    expect(parseInch('6/8')).toBeCloseTo(0.75, 6)
    expect(parseInch('3/8')).toBeCloseTo(0.375, 6)
  })

  it('tolerates a trailing inch mark and surrounding whitespace', () => {
    expect(parseInch('4 6/8"')).toBeCloseTo(4.75, 6)
    expect(parseInch('  4.75  ')).toBeCloseTo(4.75, 6)
    expect(parseInch('22"')).toBe(22)
  })

  it('returns 0 for a zero denominator rather than Infinity', () => {
    // Feeds calcGross/calcDeductions — CLAUDE.md §5 requires finite guards.
    expect(parseInch('4 6/0')).toBe(0)
    expect(parseInch('6/0')).toBe(0)
  })

  it('returns 0 for empty or unparseable input', () => {
    expect(parseInch('')).toBe(0)
    expect(parseInch('   ')).toBe(0)
    expect(parseInch('abc')).toBe(0)
    expect(parseInch('--')).toBe(0)
  })

  it('never produces a non-finite result for any input', () => {
    const inputs = [
      '4.75', '4 6/8', '6/8', '4-6/8', '4 6/0', '6/0', '', '   ', 'abc',
      '1/0', 'NaN', 'Infinity', '-5', '999999', '4 6/8"', '.5', '1e10',
    ]
    for (const v of inputs) {
      const out = parseInch(v)
      expect(Number.isFinite(out)).toBe(true)
    }
  })

  it('handles a non-string defensively', () => {
    expect(parseInch(undefined as unknown as string)).toBe(0)
    expect(parseInch(null as unknown as string)).toBe(0)
  })
})


/**
 * The entry widget is a whole-inch box plus an eighths dropdown, but the value
 * stored is still the same string parseInch reads. These guard that the split
 * and recompose are lossless for every legal B&C measurement.
 */
describe('toEighths / fromEighths', () => {
  it('round-trips every legal eighth from 0 to 40 7/8', () => {
    for (let w = 0; w <= 40; w += 1) {
      for (let e = 0; e <= 7; e += 1) {
        const stored = fromEighths(w, e)
        const back = toEighths(stored)
        expect({ w, e, whole: back.whole, eighths: back.eighths }).toEqual({
          w, e, whole: w, eighths: e,
        })
        // And the numeric value survives the trip.
        expect(parseInch(stored)).toBeCloseTo(w + e / 8, 6)
      }
    }
  })

  it('keeps a blank field blank rather than forcing a zero', () => {
    expect(toEighths('')).toEqual({ whole: null, eighths: 0 })
    expect(toEighths('   ')).toEqual({ whole: null, eighths: 0 })
    expect(fromEighths(null, 0)).toBe('')
  })

  it('preserves an explicitly entered zero', () => {
    expect(fromEighths(0, 0)).toBe('0')
    expect(toEighths('0')).toEqual({ whole: 0, eighths: 0 })
  })

  it('allows a sub-inch value with no whole part', () => {
    expect(fromEighths(null, 6)).toBe('6/8')
    expect(parseInch(fromEighths(null, 6))).toBeCloseTo(0.75, 6)
  })

  it('carries when rounding lands on eight eighths', () => {
    // 3.99 is closer to 4 than to 3 7/8 — must become 4 whole, not 3 and 8/8.
    expect(toEighths('3.99')).toEqual({ whole: 4, eighths: 0 })
    expect(toEighths('3.9375')).toEqual({ whole: 4, eighths: 0 })
  })

  it('snaps a legacy non-eighth decimal to the nearest legal eighth', () => {
    // 4.7 is not a B&C measurement; nearest eighth is 4 6/8 = 4.75.
    expect(toEighths('4.7')).toEqual({ whole: 4, eighths: 6 })
  })

  it('clamps out-of-range eighths instead of emitting nonsense', () => {
    expect(fromEighths(4, 9)).toBe('4 7/8')
    expect(fromEighths(4, -1)).toBe('4')
    expect(fromEighths(-2, 3)).toBe('0 3/8')
  })

  it('never yields a non-finite parsed value', () => {
    for (const v of ['', '   ', '0', '4 6/8', '3.99', '4.7', 'abc']) {
      expect(Number.isFinite(parseInch(fromEighths(toEighths(v).whole, toEighths(v).eighths)))).toBe(true)
    }
  })
})
