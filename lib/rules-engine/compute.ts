/**
 * Boone & Crockett Rules Engine - Score Computation
 * 
 * Pure, deterministic functions for computing scores from measurements.
 * No AI, no network, no side effects - just math.
 * 
 * These functions are the authoritative source for how scores are calculated.
 * AI provides measurements; this module computes scores.
 */

import type {
  ScoreSheetMeasurements,
  ScoreSheetPayload,
  SideBreakdown,
  TineMeasurement,
  MassMeasurement,
  ComputedScores,
  ScoringSystem,
} from './types'

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Round to 1/8 inch precision (B&C standard)
 */
export function roundToEighth(n: number): number {
  return Math.round(n * 8) / 8
}

/**
 * Round to 2 decimal places
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sum tine lengths, treating null as 0
 */
export function sumTines(tines: TineMeasurement[]): number {
  return tines.reduce((sum, t) => sum + (t.length ?? 0), 0)
}

/**
 * Sum mass circumferences, treating null as 0
 */
export function sumMasses(masses: MassMeasurement[]): number {
  return masses.reduce((sum, m) => sum + (m.circumference ?? 0), 0)
}

/**
 * Calculate total for one side (beam + tines + masses)
 */
export function computeSideTotal(side: SideBreakdown): number {
  const beam = side.mainBeamLength ?? 0
  const tines = sumTines(side.tines)
  const masses = sumMasses(side.masses)
  return round2(beam + tines + masses)
}

/**
 * Calculate total abnormal points length for one side
 */
export function computeAbnormalTotal(side: SideBreakdown): number {
  if (!side.abnormalPoints || side.abnormalPoints.length === 0) {
    return 0
  }
  return sumTines(side.abnormalPoints)
}

// ============================================================================
// DEDUCTION CALCULATIONS
// ============================================================================

/**
 * Calculate main beam length difference
 */
export function computeMainBeamDifference(
  left: SideBreakdown,
  right: SideBreakdown
): number {
  const leftBeam = left.mainBeamLength ?? 0
  const rightBeam = right.mainBeamLength ?? 0
  return round2(Math.abs(leftBeam - rightBeam))
}

/**
 * Calculate tine differences (G1-G7)
 * Returns array of differences for each tine index
 */
export function computeTineDifferences(
  left: SideBreakdown,
  right: SideBreakdown
): number[] {
  // Find max tine index between both sides
  const maxIndex = Math.max(
    ...left.tines.map(t => t.index),
    ...right.tines.map(t => t.index),
    0
  )
  
  const diffs: number[] = []
  
  for (let i = 1; i <= maxIndex; i++) {
    const leftTine = left.tines.find(t => t.index === i)
    const rightTine = right.tines.find(t => t.index === i)
    const leftLen = leftTine?.length ?? 0
    const rightLen = rightTine?.length ?? 0
    diffs.push(round2(Math.abs(leftLen - rightLen)))
  }
  
  return diffs
}

/**
 * Calculate mass/circumference differences (H1-H4)
 */
export function computeMassDifferences(
  left: SideBreakdown,
  right: SideBreakdown
): number[] {
  const diffs: number[] = []
  
  for (let i = 1; i <= 4; i++) {
    const leftMass = left.masses.find(m => m.index === i)
    const rightMass = right.masses.find(m => m.index === i)
    const leftCirc = leftMass?.circumference ?? 0
    const rightCirc = rightMass?.circumference ?? 0
    diffs.push(round2(Math.abs(leftCirc - rightCirc)))
  }
  
  return diffs
}

/**
 * Calculate total symmetry deductions (side-to-side differences)
 */
export function computeSymmetryDeductions(
  left: SideBreakdown,
  right: SideBreakdown
): number {
  const beamDiff = computeMainBeamDifference(left, right)
  const tineDiffs = computeTineDifferences(left, right)
  const massDiffs = computeMassDifferences(left, right)
  
  const totalTineDiffs = tineDiffs.reduce((sum, d) => sum + d, 0)
  const totalMassDiffs = massDiffs.reduce((sum, d) => sum + d, 0)
  
  return round2(beamDiff + totalTineDiffs + totalMassDiffs)
}

// ============================================================================
// SPREAD CREDIT
// ============================================================================

/**
 * Calculate spread credit
 * Credit cannot exceed the length of the longest main beam
 */
export function computeSpreadCredit(measurements: ScoreSheetMeasurements): number {
  const insideSpread = measurements.insideSpread ?? 0
  const leftBeam = measurements.left.mainBeamLength ?? 0
  const rightBeam = measurements.right.mainBeamLength ?? 0
  const longestBeam = Math.max(leftBeam, rightBeam)
  
  // Spread credit is the lesser of inside spread and longest beam
  return round2(Math.min(insideSpread, longestBeam))
}

// ============================================================================
// GROSS SCORE
// ============================================================================

/**
 * Compute gross score from measurements
 * Gross = Spread Credit + Left Total + Right Total + Abnormal Points Total
 * 
 * This is the same for both typical and non-typical scoring
 */
export function computeGrossScore(measurements: ScoreSheetMeasurements): number {
  const spreadCredit = computeSpreadCredit(measurements)
  const leftTotal = computeSideTotal(measurements.left)
  const rightTotal = computeSideTotal(measurements.right)
  const abnormalTotal = 
    computeAbnormalTotal(measurements.left) + 
    computeAbnormalTotal(measurements.right)
  
  return round2(spreadCredit + leftTotal + rightTotal + abnormalTotal)
}

// ============================================================================
// NET SCORE
// ============================================================================

/**
 * Compute net score for TYPICAL scoring
 * Net = Gross - Symmetry Deductions - Abnormal Points
 * 
 * In typical scoring, abnormal points are deducted from the net score
 */
export function computeNetScoreTypical(measurements: ScoreSheetMeasurements): number {
  const gross = computeGrossScore(measurements)
  const symmetryDeductions = computeSymmetryDeductions(
    measurements.left,
    measurements.right
  )
  const abnormalTotal = 
    computeAbnormalTotal(measurements.left) + 
    computeAbnormalTotal(measurements.right)
  
  return round2(gross - symmetryDeductions - abnormalTotal)
}

/**
 * Compute net score for NON-TYPICAL scoring
 * Net = Gross - Symmetry Deductions
 * 
 * In non-typical scoring, abnormal points ADD to the score (already in gross)
 * Only symmetry deductions are subtracted
 */
export function computeNetScoreNonTypical(measurements: ScoreSheetMeasurements): number {
  const gross = computeGrossScore(measurements)
  const symmetryDeductions = computeSymmetryDeductions(
    measurements.left,
    measurements.right
  )
  
  return round2(gross - symmetryDeductions)
}

/**
 * Compute net score based on scoring system
 */
export function computeNetScore(
  measurements: ScoreSheetMeasurements,
  scoringSystem: ScoringSystem
): number {
  const isTypical = scoringSystem.includes('typical') && 
    !scoringSystem.includes('non_typical')
  
  if (isTypical) {
    return computeNetScoreTypical(measurements)
  } else {
    return computeNetScoreNonTypical(measurements)
  }
}

// ============================================================================
// FULL COMPUTATION
// ============================================================================

/**
 * Compute all scores from a measurement set
 * Returns detailed breakdown of all calculations
 */
export function computeAllScores(
  measurements: ScoreSheetMeasurements,
  scoringSystem: ScoringSystem
): ComputedScores {
  const spreadCredit = computeSpreadCredit(measurements)
  const leftTotal = computeSideTotal(measurements.left)
  const rightTotal = computeSideTotal(measurements.right)
  const abnormalTotal = 
    computeAbnormalTotal(measurements.left) + 
    computeAbnormalTotal(measurements.right)
  
  const mainBeamDiff = computeMainBeamDifference(
    measurements.left,
    measurements.right
  )
  const tineDiffs = computeTineDifferences(
    measurements.left,
    measurements.right
  )
  const massDiffs = computeMassDifferences(
    measurements.left,
    measurements.right
  )
  
  const symmetryDeductions = round2(
    mainBeamDiff + 
    tineDiffs.reduce((s, d) => s + d, 0) + 
    massDiffs.reduce((s, d) => s + d, 0)
  )
  
  const isTypical = scoringSystem.includes('typical') && 
    !scoringSystem.includes('non_typical')
  
  const abnormalDeduction = isTypical ? abnormalTotal : 0
  const totalDeductions = round2(symmetryDeductions + abnormalDeduction)
  
  const gross = round2(spreadCredit + leftTotal + rightTotal + abnormalTotal)
  const net = round2(gross - totalDeductions)
  
  return {
    gross,
    net,
    spreadCredit,
    leftTotal,
    rightTotal,
    abnormalTotal,
    totalDeductions,
    deductionBreakdown: {
      mainBeamDiff,
      tineDiffs,
      massDiffs,
      abnormalDeduction,
    },
  }
}

/**
 * Compute scores from a full ScoreSheetPayload
 */
export function computeFromPayload(payload: ScoreSheetPayload): ComputedScores {
  return computeAllScores(payload.measurements, payload.scoringSystem)
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Check if a measurement set has the minimum required data for scoring
 */
export function canComputeScore(measurements: ScoreSheetMeasurements): boolean {
  // At minimum we need inside spread and both main beams
  if (measurements.insideSpread === null) return false
  if (measurements.left.mainBeamLength === null) return false
  if (measurements.right.mainBeamLength === null) return false
  
  // Need at least one tine on each side
  const hasLeftTines = measurements.left.tines.some(t => t.length !== null)
  const hasRightTines = measurements.right.tines.some(t => t.length !== null)
  if (!hasLeftTines || !hasRightTines) return false
  
  // Need at least one mass on each side
  const hasLeftMass = measurements.left.masses.some(m => m.circumference !== null)
  const hasRightMass = measurements.right.masses.some(m => m.circumference !== null)
  if (!hasLeftMass || !hasRightMass) return false
  
  return true
}

/**
 * Get a list of missing measurements
 */
export function getMissingMeasurements(measurements: ScoreSheetMeasurements): string[] {
  const missing: string[] = []
  
  if (measurements.insideSpread === null) missing.push('Inside Spread')
  if (measurements.left.mainBeamLength === null) missing.push('Left Main Beam')
  if (measurements.right.mainBeamLength === null) missing.push('Right Main Beam')
  
  // Check tines G1-G4 (minimum for an 8-point)
  for (let i = 1; i <= 4; i++) {
    const leftTine = measurements.left.tines.find(t => t.index === i)
    const rightTine = measurements.right.tines.find(t => t.index === i)
    if (!leftTine || leftTine.length === null) missing.push(`Left G${i}`)
    if (!rightTine || rightTine.length === null) missing.push(`Right G${i}`)
  }
  
  // Check masses H1-H4
  for (let i = 1; i <= 4; i++) {
    const leftMass = measurements.left.masses.find(m => m.index === i)
    const rightMass = measurements.right.masses.find(m => m.index === i)
    if (!leftMass || leftMass.circumference === null) missing.push(`Left H${i}`)
    if (!rightMass || rightMass.circumference === null) missing.push(`Right H${i}`)
  }
  
  return missing
}
