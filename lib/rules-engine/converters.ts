/**
 * Boone & Crockett Rules Engine - Format Converters
 * 
 * Convert between different measurement formats:
 * - Old flat Measurements type (lib/types.ts)
 * - New ScoreSheetMeasurements type (rules-engine/types.ts)
 * - ScoreSheet type (scoring/score-sheet.ts)
 * - CorrectedMeasurements type (review/types.ts)
 */

import type { Measurements } from '@/lib/types'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'
import type { CorrectedMeasurements } from '@/lib/review/types'
import type {
  ScoreSheetMeasurements,
  ScoreSheetPayload,
  SideBreakdown,
  TineMeasurement,
  MassMeasurement,
  MeasurementSource,
  ScoringSystem,
} from './types'

// ============================================================================
// FROM FLAT MEASUREMENTS
// ============================================================================

/**
 * Convert old flat Measurements type to ScoreSheetMeasurements
 */
export function fromFlatMeasurements(
  m: Measurements,
  source: MeasurementSource = 'ai'
): ScoreSheetMeasurements {
  const makeTine = (index: number, length: number | null | undefined): TineMeasurement => ({
    index,
    length: length ?? null,
    source,
  })
  
  const makeMass = (index: number, circumference: number | null | undefined): MassMeasurement => ({
    index,
    circumference: circumference ?? null,
    source,
  })
  
  const leftSide: SideBreakdown = {
    mainBeamLength: m.main_beam_left ?? null,
    mainBeamSource: source,
    tines: [
      makeTine(1, m.g1_left),
      makeTine(2, m.g2_left),
      makeTine(3, m.g3_left),
      makeTine(4, m.g4_left),
      makeTine(5, m.g5_left),
    ].filter(t => t.length !== null || t.index <= 4), // Always include G1-G4
    masses: [
      makeMass(1, m.h1_left),
      makeMass(2, m.h2_left),
      makeMass(3, m.h3_left),
      makeMass(4, m.h4_left),
    ],
    abnormalPoints: [],
  }
  
  const rightSide: SideBreakdown = {
    mainBeamLength: m.main_beam_right ?? null,
    mainBeamSource: source,
    tines: [
      makeTine(1, m.g1_right),
      makeTine(2, m.g2_right),
      makeTine(3, m.g3_right),
      makeTine(4, m.g4_right),
      makeTine(5, m.g5_right),
    ].filter(t => t.length !== null || t.index <= 4),
    masses: [
      makeMass(1, m.h1_right),
      makeMass(2, m.h2_right),
      makeMass(3, m.h3_right),
      makeMass(4, m.h4_right),
    ],
    abnormalPoints: [],
  }
  
  // Handle abnormal points
  if (m.abnormal_points && m.abnormal_points > 0) {
    // We don't have per-point data, just total - split evenly as placeholder
    const halfAbnormal = m.abnormal_points / 2
    leftSide.abnormalPoints = [{ index: 1, length: halfAbnormal, source }]
    rightSide.abnormalPoints = [{ index: 1, length: halfAbnormal, source }]
  }
  
  return {
    insideSpread: m.inside_spread ?? null,
    left: leftSide,
    right: rightSide,
    deductions: {
      sideToSideDifferences: m.deductions ?? null,
      abnormalPointDeductions: m.abnormal_points ?? null,
      totalDeductions: (m.deductions ?? 0) + (m.abnormal_points ?? 0),
    },
    grossScore: m.gross_score ?? null,
    netScore: m.net_score ?? null,
    confidence: m.confidence ?? null,
  }
}

/**
 * Convert ScoreSheetMeasurements back to flat Measurements format
 */
export function toFlatMeasurements(sheet: ScoreSheetMeasurements): Measurements {
  const getTineLength = (tines: TineMeasurement[], index: number): number | undefined => {
    const tine = tines.find(t => t.index === index)
    return tine?.length ?? undefined
  }
  
  const getMassCirc = (masses: MassMeasurement[], index: number): number | undefined => {
    const mass = masses.find(m => m.index === index)
    return mass?.circumference ?? undefined
  }
  
  const leftAbnormal = sheet.left.abnormalPoints?.reduce((s, t) => s + (t.length ?? 0), 0) ?? 0
  const rightAbnormal = sheet.right.abnormalPoints?.reduce((s, t) => s + (t.length ?? 0), 0) ?? 0
  
  return {
    inside_spread: sheet.insideSpread ?? null,
    main_beam_left: sheet.left.mainBeamLength ?? null,
    main_beam_right: sheet.right.mainBeamLength ?? null,
    g1_left: getTineLength(sheet.left.tines, 1) ?? null,
    g1_right: getTineLength(sheet.right.tines, 1) ?? null,
    g2_left: getTineLength(sheet.left.tines, 2) ?? null,
    g2_right: getTineLength(sheet.right.tines, 2) ?? null,
    g3_left: getTineLength(sheet.left.tines, 3) ?? null,
    g3_right: getTineLength(sheet.right.tines, 3) ?? null,
    g4_left: getTineLength(sheet.left.tines, 4) ?? null,
    g4_right: getTineLength(sheet.right.tines, 4) ?? null,
    g5_left: getTineLength(sheet.left.tines, 5) ?? null,
    g5_right: getTineLength(sheet.right.tines, 5) ?? null,
    h1_left: getMassCirc(sheet.left.masses, 1) ?? null,
    h1_right: getMassCirc(sheet.right.masses, 1) ?? null,
    h2_left: getMassCirc(sheet.left.masses, 2) ?? null,
    h2_right: getMassCirc(sheet.right.masses, 2) ?? null,
    h3_left: getMassCirc(sheet.left.masses, 3) ?? null,
    h3_right: getMassCirc(sheet.right.masses, 3) ?? null,
    h4_left: getMassCirc(sheet.left.masses, 4) ?? null,
    h4_right: getMassCirc(sheet.right.masses, 4) ?? null,
    abnormal_points: leftAbnormal + rightAbnormal || null,
    deductions: sheet.deductions.sideToSideDifferences ?? null,
    gross_score: sheet.grossScore ?? null,
    net_score: sheet.netScore ?? null,
    confidence: sheet.confidence ?? null,
  }
}

// ============================================================================
// FROM CORRECTED MEASUREMENTS
// ============================================================================

/**
 * Convert CorrectedMeasurements to ScoreSheetMeasurements
 */
export function fromCorrectedMeasurements(
  m: CorrectedMeasurements,
  source: MeasurementSource = 'reviewed'
): ScoreSheetMeasurements {
  const makeTine = (index: number, length: number | null): TineMeasurement => ({
    index,
    length,
    source,
  })
  
  const makeMass = (index: number, circumference: number | null): MassMeasurement => ({
    index,
    circumference,
    source,
  })
  
  return {
    insideSpread: m.inside_spread,
    left: {
      mainBeamLength: m.main_beam_left,
      mainBeamSource: source,
      tines: [
        makeTine(1, m.g1_left),
        makeTine(2, m.g2_left),
        makeTine(3, m.g3_left),
        makeTine(4, m.g4_left),
        makeTine(5, m.g5_left),
      ],
      masses: [
        makeMass(1, m.h1_left),
        makeMass(2, m.h2_left),
        makeMass(3, m.h3_left),
        makeMass(4, m.h4_left),
      ],
      abnormalPoints: m.abnormal_points ? [{ index: 1, length: m.abnormal_points / 2, source }] : [],
    },
    right: {
      mainBeamLength: m.main_beam_right,
      mainBeamSource: source,
      tines: [
        makeTine(1, m.g1_right),
        makeTine(2, m.g2_right),
        makeTine(3, m.g3_right),
        makeTine(4, m.g4_right),
        makeTine(5, m.g5_right),
      ],
      masses: [
        makeMass(1, m.h1_right),
        makeMass(2, m.h2_right),
        makeMass(3, m.h3_right),
        makeMass(4, m.h4_right),
      ],
      abnormalPoints: m.abnormal_points ? [{ index: 1, length: m.abnormal_points / 2, source }] : [],
    },
    deductions: {
      sideToSideDifferences: m.deductions,
      abnormalPointDeductions: m.abnormal_points,
      totalDeductions: (m.deductions ?? 0) + (m.abnormal_points ?? 0),
    },
    grossScore: null, // Will be computed
    netScore: null,   // Will be computed
  }
}

// ============================================================================
// FROM UI SCORE SHEET
// ============================================================================

/**
 * Convert the UI ScoreSheet type to ScoreSheetMeasurements
 */
export function fromUIScoreSheet(
  sheet: ScoreSheet,
  source: MeasurementSource = 'ai'
): ScoreSheetMeasurements {
  const makeTine = (index: number, line: { value: number | null }): TineMeasurement => ({
    index,
    length: line.value,
    source,
  })
  
  const makeMass = (index: number, line: { value: number | null }): MassMeasurement => ({
    index,
    circumference: line.value,
    source,
  })
  
  return {
    insideSpread: sheet.spread.inside.value,
    left: {
      mainBeamLength: sheet.left.main_beam.value,
      mainBeamSource: source,
      tines: [
        makeTine(1, sheet.left.g1),
        makeTine(2, sheet.left.g2),
        makeTine(3, sheet.left.g3),
        makeTine(4, sheet.left.g4),
        makeTine(5, sheet.left.g5),
      ],
      masses: [
        makeMass(1, sheet.left.h1),
        makeMass(2, sheet.left.h2),
        makeMass(3, sheet.left.h3),
        makeMass(4, sheet.left.h4),
      ],
      abnormalPoints: sheet.abnormal_points.total_length.value 
        ? [{ index: 1, length: sheet.abnormal_points.total_length.value / 2, source }]
        : [],
    },
    right: {
      mainBeamLength: sheet.right.main_beam.value,
      mainBeamSource: source,
      tines: [
        makeTine(1, sheet.right.g1),
        makeTine(2, sheet.right.g2),
        makeTine(3, sheet.right.g3),
        makeTine(4, sheet.right.g4),
        makeTine(5, sheet.right.g5),
      ],
      masses: [
        makeMass(1, sheet.right.h1),
        makeMass(2, sheet.right.h2),
        makeMass(3, sheet.right.h3),
        makeMass(4, sheet.right.h4),
      ],
      abnormalPoints: sheet.abnormal_points.total_length.value 
        ? [{ index: 1, length: sheet.abnormal_points.total_length.value / 2, source }]
        : [],
    },
    deductions: {
      sideToSideDifferences: sheet.deductions.symmetry_total.value,
      abnormalPointDeductions: sheet.abnormal_points.total_length.value,
      totalDeductions: (sheet.deductions.symmetry_total.value ?? 0) + 
        (sheet.deductions.abnormal_deduction.value ?? 0),
    },
    grossScore: sheet.totals.gross.value,
    netScore: sheet.totals.net.value,
  }
}

// ============================================================================
// CREATE PAYLOAD
// ============================================================================

/**
 * Create a full ScoreSheetPayload from measurements
 */
export function createPayload(
  measurements: ScoreSheetMeasurements,
  options: {
    scoringSystem?: ScoringSystem
    source?: MeasurementSource
    rawModelNotes?: string
  } = {}
): ScoreSheetPayload {
  return {
    version: 1,
    scoringSystem: options.scoringSystem ?? 'boone_and_crockett_typical',
    source: options.source ?? 'ai',
    measurements,
    rawModelNotes: options.rawModelNotes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Create a payload from flat Measurements
 */
export function createPayloadFromFlat(
  m: Measurements,
  options: {
    scoringSystem?: ScoringSystem
    source?: MeasurementSource
    rawModelNotes?: string
  } = {}
): ScoreSheetPayload {
  const measurements = fromFlatMeasurements(m, options.source)
  return createPayload(measurements, options)
}
