import { describe, it, expect } from 'vitest'
import {
  bakeRedactionsIntoDataUrl,
  estimateRedactionCoverage,
  PEN_SIZES,
} from '@/components/scoring/redaction-pen'

const SAMPLE_DATA_URL = 'data:image/jpeg;base64,dGVzdA=='

describe('redaction pen', () => {
  it('bake with no strokes returns the original data URL untouched', async () => {
    const out = await bakeRedactionsIntoDataUrl(SAMPLE_DATA_URL, [])
    expect(out).toBe(SAMPLE_DATA_URL)
  })

  it('bake with undefined-ish empty strokes never rejects', async () => {
    await expect(
      bakeRedactionsIntoDataUrl(SAMPLE_DATA_URL, [] as never),
    ).resolves.toBe(SAMPLE_DATA_URL)
  })

  it('coverage of zero strokes is 0', () => {
    expect(estimateRedactionCoverage([])).toBe(0)
  })

  it('coverage degrades to 0 outside a DOM environment instead of throwing', () => {
    // vitest node environment has no document — must not throw.
    expect(
      estimateRedactionCoverage([
        { size: 0.1, points: [{ x: 0.5, y: 0.5 }] },
      ]),
    ).toBe(0)
  })

  it('pen sizes are ordered small to large and stay sane fractions', () => {
    const fracs = PEN_SIZES.map(s => s.frac)
    expect([...fracs].sort((a, b) => a - b)).toEqual(fracs)
    for (const f of fracs) {
      expect(f).toBeGreaterThan(0)
      expect(f).toBeLessThan(0.5)
    }
  })
})
