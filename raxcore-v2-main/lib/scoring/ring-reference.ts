import type { RingReferenceInput } from './ring-reference-types'

// US ring size → approximate inner diameter (mm), standard jeweler table
// Source: US standard ring sizing
export const US_RING_SIZE_TABLE: Record<number, number> = {
  3: 14.1, 3.5: 14.5, 4: 14.9, 4.5: 15.3, 5: 15.7,
  5.5: 16.1, 6: 16.5, 6.5: 16.9, 7: 17.3, 7.5: 17.7,
  8: 18.1, 8.5: 18.5, 9: 19.0, 9.5: 19.4, 10: 19.8,
  10.5: 20.2, 11: 20.6, 11.5: 21.0, 12: 21.4, 12.5: 21.8,
  13: 22.2, 13.5: 22.6, 14: 23.0, 14.5: 23.4, 15: 23.8,
  15.5: 24.2, 16: 24.6,
}

export const VALID_RING_SIZES = Object.keys(US_RING_SIZE_TABLE).map(Number)

/** Parses a raw input to a supported US ring size number, or null. */
export function normalizeRingSizeUS(value: unknown): number | null {
  const n = parseFloat(String(value))
  if (!isFinite(n)) return null
  // Round to nearest 0.5
  const rounded = Math.round(n * 2) / 2
  if (!VALID_RING_SIZES.includes(rounded)) return null
  return rounded
}

/** Converts a valid US ring size to inner diameter in inches (mm / 25.4), rounded to 4dp. Returns null if unsupported. */
export function ringSizeToInnerDiameterInches(size: number): number | null {
  const mm = US_RING_SIZE_TABLE[size]
  if (mm === undefined) return null
  return Math.round((mm / 25.4) * 10000) / 10000
}

/** Builds a RingReferenceInput from raw form inputs. */
export function buildRingReferenceInput(input: {
  present: boolean
  ringSizeUS?: number | string | null
}): RingReferenceInput {
  if (!input.present) {
    return { present: false, ringSizeUS: null, innerDiameterInches: null, confidence: 'none' }
  }
  const size = input.ringSizeUS != null ? normalizeRingSizeUS(input.ringSizeUS) : null
  if (size !== null) {
    return {
      present: true,
      ringSizeUS: size,
      innerDiameterInches: ringSizeToInnerDiameterInches(size),
      confidence: 'estimated',
    }
  }
  return { present: true, ringSizeUS: null, innerDiameterInches: null, confidence: 'none' }
}
