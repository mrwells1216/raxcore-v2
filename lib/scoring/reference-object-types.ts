export type ReferenceObjectType =
  | 'none'
  | 'wedding_ring'
  | 'hat'
  | 'ruler'
  | 'tape_measure'
  | 'known_object'

export interface RingReferenceInput {
  present: boolean
  ringSizeUS: number | null
  innerDiameterInches: number | null
  confidence: 'none' | 'estimated' | 'manual_confirmed'
  notes?: string | null
}

export type HatType =
  | 'baseball_cap'
  | 'baseball_cap_backwards'
  | 'beanie'
  | 'skull_cap'
  | 'stetson'
  | 'wide_brim'

export interface HatReferenceInput {
  present: boolean
  hatType: HatType | null
  brimWidthInches: number | null
  crownHeightInches: number | null
  confidence: 'none' | 'estimated' | 'manual_confirmed'
  notes?: string | null
}

export interface ScoringReferenceObjectInput {
  type: ReferenceObjectType
  ring?: RingReferenceInput | null
  hat?: HatReferenceInput | null
}
