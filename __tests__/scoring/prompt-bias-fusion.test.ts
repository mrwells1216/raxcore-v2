import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mutable fixture the mocked Supabase client reads from.
let mockData: Record<string, unknown[]> = {}

function makeDb(data: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: data[table] ?? [], error: null }
      const builder: Record<string, unknown> = {
        select: () => builder,
        not: () => builder,
        limit: () => Promise.resolve(result),
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  getServiceSupabase: async () => makeDb(mockData),
}))

import { loadFieldBiases, getBiasReport } from '@/lib/scoring/prompt-bias-correction'

function userRows(field: string, delta: number, n: number) {
  return Array.from({ length: n }, () => ({ field_key: field, delta }))
}

function gtSheet(fields: Array<{ field: string; delta: number }>) {
  return { ai_run_result: { fields } }
}

beforeEach(() => {
  mockData = {}
})

describe('prompt bias fusion', () => {
  it('flips the ground-truth delta sign (ai - official) into a correction', async () => {
    // AI reads 2" over official on every sheet → correction should be -2.
    mockData = {
      correction_events: [],
      official_score_sheets: Array.from({ length: 10 }, () =>
        gtSheet([{ field: 'g2_left', delta: 2 }])
      ),
    }
    const biases = await loadFieldBiases()
    expect(biases.g2_left).toBeCloseTo(-2, 5)
  })

  it('weights ground truth above user corrections in the fused mean', async () => {
    // user: +1 x5 (weight 1); ground truth correction: +3 x5 (weight 3)
    // weighted mean = (5*1*1 + 5*3*3) / (5*1 + 5*3) = 50/20 = 2.5
    mockData = {
      correction_events: userRows('h1_left', 1, 5),
      official_score_sheets: Array.from({ length: 5 }, () =>
        gtSheet([{ field: 'h1_left', delta: -3 }])
      ),
    }
    const biases = await loadFieldBiases()
    expect(biases.h1_left).toBeCloseTo(2.5, 5)
  })

  it('does not fire below the minimum observation count', async () => {
    mockData = {
      correction_events: userRows('g3_right', 2, 9),
      official_score_sheets: [],
    }
    const biases = await loadFieldBiases()
    expect(biases.g3_right).toBeUndefined()
  })

  it('does not fire below the minimum magnitude', async () => {
    mockData = {
      correction_events: userRows('g1_left', 0.2, 20),
      official_score_sheets: [],
    }
    const biases = await loadFieldBiases()
    expect(biases.g1_left).toBeUndefined()
  })

  it('clamps corrections to ±3"', async () => {
    mockData = {
      correction_events: userRows('main_beam_left', 12, 20),
      official_score_sheets: [],
    }
    const biases = await loadFieldBiases()
    expect(biases.main_beam_left).toBe(3)
  })

  it('ignores gross/net pseudo-fields from ground truth', async () => {
    mockData = {
      correction_events: [],
      official_score_sheets: Array.from({ length: 10 }, () =>
        gtSheet([{ field: 'gross_score', delta: 5 }])
      ),
    }
    const biases = await loadFieldBiases()
    expect(biases.gross_score).toBeUndefined()
  })

  it('reports combined sample counts across both sources', async () => {
    mockData = {
      correction_events: userRows('g4_left', 1, 4),
      official_score_sheets: Array.from({ length: 6 }, () =>
        gtSheet([{ field: 'g4_left', delta: -1 }])
      ),
    }
    const report = await getBiasReport()
    const g4 = report.fields.find((f) => f.fieldKey === 'g4_left')
    expect(g4?.sampleCount).toBe(10)
  })
})
