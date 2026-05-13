export type ReferenceObjectType =
  | 'none'
  | 'wedding_ring'
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

export interface ScoringReferenceObjectInput {
  type: ReferenceObjectType
  ring?: RingReferenceInput | null
}
