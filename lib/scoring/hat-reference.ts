import type { HatType, HatReferenceInput } from './reference-object-types'

/**
 * Approximate hat dimensions in inches. Brim widths reflect industry averages;
 * individual hats vary ±0.25". Crown heights are dome height from bottom of
 * hat to top.
 */
export const HAT_DIMENSIONS: Record<HatType, { brim: number | null; crown: number | null; label: string }> = {
  baseball_cap:           { brim: 3.0,  crown: 4.5,  label: 'Baseball Cap'           },
  baseball_cap_backwards: { brim: null, crown: 4.5,  label: 'Baseball Cap (Backwards)' },
  beanie:                 { brim: null, crown: 7.0,  label: 'Beanie'                 },
  skull_cap:              { brim: null, crown: 4.0,  label: 'Skull Cap'              },
  stetson:                { brim: 3.75, crown: 4.5,  label: 'Stetson / Cowboy Hat'   },
  wide_brim:              { brim: 4.25, crown: 5.0,  label: 'Wide Brim'              },
}

export const VALID_HAT_TYPES = Object.keys(HAT_DIMENSIONS) as HatType[]

export function isValidHatType(value: unknown): value is HatType {
  return typeof value === 'string' && VALID_HAT_TYPES.includes(value as HatType)
}

export function buildHatReferenceInput(input: {
  present: boolean
  hatType?: string | null
}): HatReferenceInput {
  if (!input.present) {
    return { present: false, hatType: null, brimWidthInches: null, crownHeightInches: null, confidence: 'none' }
  }
  if (!input.hatType || !isValidHatType(input.hatType)) {
    return { present: true, hatType: null, brimWidthInches: null, crownHeightInches: null, confidence: 'none' }
  }
  const dims = HAT_DIMENSIONS[input.hatType]
  return {
    present: true,
    hatType: input.hatType,
    brimWidthInches: dims.brim,
    crownHeightInches: dims.crown,
    confidence: 'estimated',
  }
}
