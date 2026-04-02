/**
 * Boone & Crockett Rules Engine
 * 
 * Deterministic score computation from measurements.
 * 
 * Flow: AI produces measurements -> Rules engine computes scores
 * 
 * Usage:
 * ```ts
 * import { computeAllScores, fromFlatMeasurements } from '@/lib/rules-engine'
 * 
 * // From AI measurements
 * const sheetMeasurements = fromFlatMeasurements(aiMeasurements, 'ai')
 * const scores = computeAllScores(sheetMeasurements, 'boone_and_crockett_typical')
 * 
 * console.log(scores.gross) // e.g., 156.375
 * console.log(scores.net)   // e.g., 148.25
 * ```
 */

// Types
export type {
  Side,
  MeasurementSource,
  ScoringSystem,
  TineMeasurement,
  MassMeasurement,
  SideBreakdown,
  DeductionBreakdown,
  ScoreSheetMeasurements,
  ScoreSheetLandmarks,
  ScoreSheetPayload,
  ComputedScores,
  Point2D,
  LandmarkLine,
} from './types'

// Computation functions
export {
  roundToEighth,
  round2,
  sumTines,
  sumMasses,
  computeSideTotal,
  computeAbnormalTotal,
  computeMainBeamDifference,
  computeTineDifferences,
  computeMassDifferences,
  computeSymmetryDeductions,
  computeSpreadCredit,
  computeGrossScore,
  computeNetScoreTypical,
  computeNetScoreNonTypical,
  computeNetScore,
  computeAllScores,
  computeFromPayload,
  canComputeScore,
  getMissingMeasurements,
} from './compute'

// Format converters
export {
  fromFlatMeasurements,
  toFlatMeasurements,
  fromCorrectedMeasurements,
  fromUIScoreSheet,
  createPayload,
  createPayloadFromFlat,
} from './converters'
