import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calcGross } from '@/components/admin/training-import-form'
import { calculateScores, spreadCredit } from '@/lib/scoring/gross-net'
import type { Measurements } from '@/lib/types'

/**
 * The AI scorer and the official-sheet entry form must agree on what "gross"
 * means, or the guide-buck accuracy run reports the formula mismatch as AI
 * error (the §3.54 / §3.58 failure mode). A second private copy of the AI
 * formula also lived in second-pass.ts and silently kept the pre-§3.47 rules.
 * These tests pin all three to the same arithmetic.
 */

const ZERO: Measurements = {
  inside_spread: null,
  main_beam_left: null, main_beam_right: null,
  g1_left: null, g1_right: null,
  g2_left: null, g2_right: null,
  g3_left: null, g3_right: null,
  g4_left: null, g4_right: null,
  g5_left: null, g5_right: null,
  h1_left: null, h1_right: null,
  h2_left: null, h2_right: null,
  h3_left: null, h3_right: null,
  h4_left: null, h4_right: null,
  abnormal_points: null,
  deductions: null,
}

function m(overrides: Partial<Measurements>): Measurements {
  return { ...ZERO, ...overrides }
}

/** Express an AI-side measurement set in the import form's string shape. */
function toFormSheet(x: Measurements) {
  const s = (v: number | null) => (v == null ? '' : String(v))
  const side = (k: 'left' | 'right') => ({
    main_beam: s(x[`main_beam_${k}`]),
    g1: s(x[`g1_${k}`]), g2: s(x[`g2_${k}`]), g3: s(x[`g3_${k}`]),
    g4: s(x[`g4_${k}`]), g5: s(x[`g5_${k}`]),
    h1: s(x[`h1_${k}`]), h2: s(x[`h2_${k}`]), h3: s(x[`h3_${k}`]), h4: s(x[`h4_${k}`]),
  })
  return {
    inside_spread: s(x.inside_spread),
    abnormal_points: s(x.abnormal_points),
    left: side('left'),
    right: side('right'),
  } as Parameters<typeof calcGross>[0]
}

const FULL: Measurements = m({
  inside_spread: 18.25,
  main_beam_left: 24.5, main_beam_right: 25,
  g1_left: 5.25, g1_right: 5.5,
  g2_left: 10.75, g2_right: 10.25,
  g3_left: 9.5, g3_right: 9,
  g4_left: 6.25, g4_right: 5.75,
  g5_left: 2, g5_right: 0,
  h1_left: 4.75, h1_right: 4.5,
  h2_left: 4.25, h2_right: 4.25,
  h3_left: 4, h3_right: 3.75,
  h4_left: 3.5, h4_right: 3.25,
})

describe('AI gross matches the official-sheet form gross', () => {
  const racks: Array<[string, Measurements]> = [
    ['typical frame, spread under cap', FULL],
    ['wide short-beamed rack (cap binds)', { ...FULL, inside_spread: 30 }],
    ['spread exactly equals longer beam', { ...FULL, inside_spread: 25 }],
    ['abnormal points present', { ...FULL, abnormal_points: 6.5 }],
    ['no beams measured (raw spread credited)', m({ inside_spread: 17, g1_left: 4, g1_right: 4 })],
    ['sparse sheet', m({ inside_spread: 12, main_beam_left: 20 })],
  ]

  for (const [name, rack] of racks) {
    it(`typical: ${name}`, () => {
      // For a typical rack gross is the frame only — abnormals never enter it —
      // which is exactly what the form's calcGross sums.
      const ai = calculateScores(rack, 'typical').gross
      const form = calcGross(toFormSheet(rack))
      // calculateScores rounds to one decimal, calcGross does not, so the two
      // can differ by up to half a tenth (0.05) from rounding alone. Anything
      // larger is a real formula disagreement. Epsilon covers float error.
      expect(Math.abs(ai - form)).toBeLessThanOrEqual(0.05 + 1e-9)
    })
  }

  it('abnormal points never change typical gross', () => {
    const base = calculateScores(FULL, 'typical').gross
    const withAbn = calculateScores({ ...FULL, abnormal_points: 9 }, 'typical').gross
    expect(withAbn).toBe(base)
  })
})

describe('rack-type handling of abnormal points', () => {
  it('typical: abnormals are a deduction toward net, not part of gross', () => {
    const r = calculateScores(m({ ...FULL, abnormal_points: 4, deductions: 3 }), 'typical')
    const frame = calculateScores(FULL, 'typical').gross
    expect(r.gross).toBeCloseTo(frame, 1)
    expect(r.net).toBeCloseTo(frame - 3 - 4, 1)
  })

  it('non-typical: abnormals count in gross and are not subtracted again', () => {
    const r = calculateScores(m({ ...FULL, abnormal_points: 4, deductions: 3 }), 'non-typical')
    const frame = calculateScores(FULL, 'typical').gross
    expect(r.gross).toBeCloseTo(frame + 4, 1)
    expect(r.net).toBeCloseTo(frame + 4 - 3, 1)
  })

  it('defaults to typical when no rack type is given', () => {
    const a = calculateScores(m({ ...FULL, abnormal_points: 4 }))
    const b = calculateScores(m({ ...FULL, abnormal_points: 4 }), 'typical')
    expect(a).toEqual(b)
  })
})

describe('spread credit cap and numeric guards', () => {
  it('caps spread at the longer beam', () => {
    expect(spreadCredit(m({ inside_spread: 22, main_beam_left: 21, main_beam_right: 20 }))).toBe(21)
  })

  it('credits raw spread when no beam is measured', () => {
    expect(spreadCredit(m({ inside_spread: 19 }))).toBe(19)
  })

  it('never returns NaN or Infinity for non-finite input', () => {
    const bad = m({
      inside_spread: Infinity,
      main_beam_left: NaN,
      g1_left: Infinity,
      abnormal_points: NaN,
      deductions: Infinity,
    })
    const r = calculateScores(bad, 'typical')
    expect(Number.isFinite(r.gross)).toBe(true)
    expect(spreadCredit(bad)).toBe(0)
  })
})

describe('no private copy of the formula survives', () => {
  // The second-pass solver's gross is blended into the final score. Its own
  // copy ignored rack type and the spread cap, inflating gross on any buck
  // with abnormal points that triggered a second pass.
  const root = join(__dirname, '..', '..')
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

  it('second-pass.ts uses the shared calculateScores', () => {
    const src = read('lib/scoring/second-pass.ts')
    expect(src).toMatch(/from '\.\/gross-net'/)
    expect(src).not.toMatch(/function calculateScores\s*\(/)
  })

  it('ai-service.ts uses the shared calculateScores', () => {
    const src = read('lib/scoring/ai-service.ts')
    expect(src).toMatch(/from '\.\/gross-net'/)
    expect(src).not.toMatch(/function calculateScores\s*\(/)
    expect(src).not.toMatch(/function spreadCredit\s*\(/)
  })
})
