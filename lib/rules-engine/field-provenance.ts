import type { FieldProvenanceMap, ProvenanceSource } from '@/lib/rules-engine/types'
import { createMeasuredField } from '@/lib/rules-engine/types'

type FlatMeasurements = {
  inside_spread?: number | null
  main_beam_left?: number | null
  main_beam_right?: number | null
  g1_left?: number | null
  g1_right?: number | null
  g2_left?: number | null
  g2_right?: number | null
  g3_left?: number | null
  g3_right?: number | null
  g4_left?: number | null
  g4_right?: number | null
  g5_left?: number | null
  g5_right?: number | null
  h1_left?: number | null
  h1_right?: number | null
  h2_left?: number | null
  h2_right?: number | null
  h3_left?: number | null
  h3_right?: number | null
  h4_left?: number | null
  h4_right?: number | null
  abnormal_points?: number | null
  deductions?: number | null
}

export function buildFieldProvenanceFromMeasurements(params: {
  measurements: FlatMeasurements
  source: ProvenanceSource
  grossScore?: number | null
  netScore?: number | null
  confidence?: 'high' | 'medium' | 'low'
  confidenceScore?: number | null
}): FieldProvenanceMap {
  const {
    measurements,
    source,
    grossScore = null,
    netScore = null,
    confidence = source === 'fallback' ? 'low' : 'medium',
    confidenceScore = null,
  } = params

  const make = (value: number | null | undefined) =>
    createMeasuredField(value ?? null, source, {
      confidence,
      confidenceScore,
      originalValue: value ?? null,
    })

  return {
    insideSpread: make(measurements.inside_spread),
    leftMainBeam: make(measurements.main_beam_left),
    rightMainBeam: make(measurements.main_beam_right),

    leftTines: {
      1: make(measurements.g1_left),
      2: make(measurements.g2_left),
      3: make(measurements.g3_left),
      4: make(measurements.g4_left),
      5: make(measurements.g5_left),
    },

    rightTines: {
      1: make(measurements.g1_right),
      2: make(measurements.g2_right),
      3: make(measurements.g3_right),
      4: make(measurements.g4_right),
      5: make(measurements.g5_right),
    },

    leftMasses: {
      1: make(measurements.h1_left),
      2: make(measurements.h2_left),
      3: make(measurements.h3_left),
      4: make(measurements.h4_left),
    },

    rightMasses: {
      1: make(measurements.h1_right),
      2: make(measurements.h2_right),
      3: make(measurements.h3_right),
      4: make(measurements.h4_right),
    },

    abnormalPoints: make(measurements.abnormal_points),
    deductions: make(measurements.deductions),
    grossScore: make(grossScore),
    netScore: make(netScore),
  }
}
