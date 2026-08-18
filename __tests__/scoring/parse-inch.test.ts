import { describe, it, expect } from 'vitest'
import { parseInch } from '@/components/admin/training-import-form'

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
