import { describe, it, expect } from 'vitest'
import { calcGross } from '@/components/admin/training-import-form'

/**
 * B&C chart, Spread Credit line: "spread credit may equal but not exceed the
 * length of the longer antler". The cap only binds on wide, short-beamed
 * racks — for a typical buck (beams 22-26", spread 16-20") it never fires,
 * which is why an uncapped total looked correct for so long.
 *
 * These exercise the import form's calcGross, which is the ground-truth
 * total a certified sheet is checked against. The same rule is applied in
 * lib/scoring/ai-service.ts calculateScores.
 */
function sheet(overrides: {
  spread?: string
  beamLeft?: string
  beamRight?: string
} = {}) {
  const blankSide = {
    main_beam: '', g1: '', g2: '', g3: '', g4: '', g5: '',
    h1: '', h2: '', h3: '', h4: '',
  }
  return {
    inside_spread: overrides.spread ?? '',
    abnormal_points: '',
    left: { ...blankSide, main_beam: overrides.beamLeft ?? '' },
    right: { ...blankSide, main_beam: overrides.beamRight ?? '' },
  }
}

describe('spread credit cap', () => {
  it('credits the spread in full when it is under the longer beam', () => {
    // The common case — this is the regression guard that matters most.
    const g = calcGross(sheet({ spread: '18', beamLeft: '24', beamRight: '23' }))
    expect(g).toBeCloseTo(18 + 24 + 23, 6)
  })

  it('caps the credit at the longer beam when the spread exceeds it', () => {
    // 22" spread on 21"/20" beams: credit 21", not 22".
    const g = calcGross(sheet({ spread: '22', beamLeft: '21', beamRight: '20' }))
    expect(g).toBeCloseTo(21 + 21 + 20, 6)
  })

  it('credits in full when spread exactly equals the longer beam ("may equal")', () => {
    const g = calcGross(sheet({ spread: '21', beamLeft: '21', beamRight: '20' }))
    expect(g).toBeCloseTo(21 + 21 + 20, 6)
  })

  it('caps against the longer beam even when that is the right one', () => {
    const g = calcGross(sheet({ spread: '25', beamLeft: '20', beamRight: '22' }))
    expect(g).toBeCloseTo(22 + 20 + 22, 6)
  })

  it('credits the raw spread when no beam has been entered yet', () => {
    // A half-filled sheet must not have its spread zeroed out.
    const g = calcGross(sheet({ spread: '20' }))
    expect(g).toBeCloseTo(20, 6)
  })

  it('caps against the only beam present', () => {
    const g = calcGross(sheet({ spread: '25', beamLeft: '19' }))
    expect(g).toBeCloseTo(19 + 19, 6)
  })

  it('handles eighths notation on both spread and beams', () => {
    // 22 4/8 spread vs 21 2/8 longer beam → credit 21.25.
    const g = calcGross(sheet({ spread: '22 4/8', beamLeft: '21 2/8', beamRight: '20' }))
    expect(g).toBeCloseTo(21.25 + 21.25 + 20, 6)
  })

  it('stays finite for empty and junk input', () => {
    expect(Number.isFinite(calcGross(sheet()))).toBe(true)
    expect(Number.isFinite(calcGross(sheet({ spread: 'abc', beamLeft: 'xyz' })))).toBe(true)
    expect(calcGross(sheet())).toBe(0)
  })
})
