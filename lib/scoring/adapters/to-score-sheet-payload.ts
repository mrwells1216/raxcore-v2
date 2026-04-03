/**
 * Adapter: Convert legacy ScoreSheet to canonical ScoreSheetPayload
 * 
 * This is the bridge between the old scoring types and the new rules-engine types.
 * Client-safe - no server imports.
 */

import type { ScoreSheet } from '@/lib/scoring/score-sheet'
import type { 
  ScoreSheetPayload, 
  ScoreSheetMeasurements,
  SideBreakdown,
  TineMeasurement,
  MassMeasurement,
  ScoringSystem,
} from '@/lib/rules-engine/types'

/**
 * Convert legacy ScoreSheet to canonical ScoreSheetPayload
 */
export function toScoreSheetPayload(
  sheet: ScoreSheet,
  options: {
    source?: 'ai' | 'reviewed' | 'manual'
    scoringSystem?: ScoringSystem
    grossScore?: number
    netScore?: number
  } = {}
): ScoreSheetPayload {
  const {
    source = 'ai',
    scoringSystem = 'boone_and_crockett_typical',
    grossScore,
    netScore,
  } = options

  const measurements = convertMeasurements(sheet, grossScore, netScore)

  return {
    version: 1,
    scoringSystem,
    source,
    measurements,
  }
}

/**
 * Convert legacy ScoreSheet measurements to ScoreSheetMeasurements
 */
function convertMeasurements(
  sheet: ScoreSheet,
  grossScore?: number,
  netScore?: number
): ScoreSheetMeasurements {
  return {
    insideSpread: sheet.spread.inside.value,
    left: convertSide(sheet.left),
    right: convertSide(sheet.right),
    deductions: {
      sideToSideDifferences: sheet.deductions.symmetry_total.value,
      abnormalPointDeductions: sheet.abnormal_points.total_length.value,
      totalDeductions: sheet.deductions.symmetry_total.value,
    },
    grossScore: grossScore ?? null,
    netScore: netScore ?? null,
  }
}

/**
 * Convert a side's measurements
 */
function convertSide(side: ScoreSheet['left'] | ScoreSheet['right']): SideBreakdown {
  return {
    mainBeamLength: side.main_beam.value,
    tines: [
      createTine(1, side.g1.value),
      createTine(2, side.g2.value),
      createTine(3, side.g3.value),
      createTine(4, side.g4.value),
      createTine(5, side.g5.value),
    ],
    masses: [
      createMass(1, side.h1.value),
      createMass(2, side.h2.value),
      createMass(3, side.h3.value),
      createMass(4, side.h4.value),
    ],
    abnormalPoints: [],
  }
}

function createTine(index: number, length: number | null): TineMeasurement {
  return { index, length }
}

function createMass(index: number, circumference: number | null): MassMeasurement {
  return { index, circumference }
}

/**
 * Convert CorrectedMeasurements (flat) to ScoreSheetMeasurements (structured)
 */
export function correctedToPayloadMeasurements(
  corrected: {
    inside_spread: number | null
    main_beam_left: number | null
    main_beam_right: number | null
    g1_left: number | null
    g1_right: number | null
    g2_left: number | null
    g2_right: number | null
    g3_left: number | null
    g3_right: number | null
    g4_left: number | null
    g4_right: number | null
    g5_left: number | null
    g5_right: number | null
    h1_left: number | null
    h1_right: number | null
    h2_left: number | null
    h2_right: number | null
    h3_left: number | null
    h3_right: number | null
    h4_left: number | null
    h4_right: number | null
    abnormal_points: number | null
    deductions: number | null
  },
  grossScore: number,
  netScore: number
): ScoreSheetMeasurements {
  return {
    insideSpread: corrected.inside_spread,
    left: {
      mainBeamLength: corrected.main_beam_left,
      tines: [
        { index: 1, length: corrected.g1_left },
        { index: 2, length: corrected.g2_left },
        { index: 3, length: corrected.g3_left },
        { index: 4, length: corrected.g4_left },
        { index: 5, length: corrected.g5_left },
      ],
      masses: [
        { index: 1, circumference: corrected.h1_left },
        { index: 2, circumference: corrected.h2_left },
        { index: 3, circumference: corrected.h3_left },
        { index: 4, circumference: corrected.h4_left },
      ],
      abnormalPoints: [],
    },
    right: {
      mainBeamLength: corrected.main_beam_right,
      tines: [
        { index: 1, length: corrected.g1_right },
        { index: 2, length: corrected.g2_right },
        { index: 3, length: corrected.g3_right },
        { index: 4, length: corrected.g4_right },
        { index: 5, length: corrected.g5_right },
      ],
      masses: [
        { index: 1, circumference: corrected.h1_right },
        { index: 2, circumference: corrected.h2_right },
        { index: 3, circumference: corrected.h3_right },
        { index: 4, circumference: corrected.h4_right },
      ],
      abnormalPoints: [],
    },
    deductions: {
      sideToSideDifferences: corrected.deductions,
      abnormalPointDeductions: corrected.abnormal_points,
      totalDeductions: corrected.deductions,
    },
    grossScore,
    netScore,
  }
}

/**
 * Create a reviewed ScoreSheetPayload from corrected measurements
 */
export function createReviewedPayload(
  corrected: Parameters<typeof correctedToPayloadMeasurements>[0],
  grossScore: number,
  netScore: number,
  options: {
    scoringSystem?: ScoringSystem
  } = {}
): ScoreSheetPayload {
  return {
    version: 1,
    scoringSystem: options.scoringSystem ?? 'boone_and_crockett_typical',
    source: 'reviewed',
    measurements: correctedToPayloadMeasurements(corrected, grossScore, netScore),
  }
}
