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
  SheetMutationCandidate,
  MeasurementPatch,
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

// ============================================================================
// MUTATION APPLICATION (for precision pass)
// ============================================================================

/**
 * Apply a mutation patch to a measurement sheet.
 * Returns a new sheet with the mutations applied and scores recomputed.
 * 
 * This is the core function for precision pass field-level adjustments.
 * Instead of adjusting gross/net directly, we mutate individual fields
 * and then recompute through the rules engine.
 */
export function applySheetMutation(
  sheet: ScoreSheetMeasurements,
  candidate: SheetMutationCandidate
): ScoreSheetMeasurements {
  // Deep clone to avoid mutation
  const next: ScoreSheetMeasurements = JSON.parse(JSON.stringify(sheet))
  const patch = candidate.patch

  // Log what we're applying
  console.log(`[precision-pass] Applying mutation: ${candidate.hypothesisType}`, {
    patch,
    notes: candidate.notes,
  })

  // Apply inside spread delta
  if (patch.insideSpreadDelta !== undefined) {
    next.insideSpread = round2((next.insideSpread ?? 0) + patch.insideSpreadDelta)
    console.log(`[precision-pass]   insideSpread: ${sheet.insideSpread} -> ${next.insideSpread} (delta: ${patch.insideSpreadDelta})`)
  }

  // Apply main beam deltas
  if (patch.leftMainBeamDelta !== undefined) {
    next.left.mainBeamLength = round2((next.left.mainBeamLength ?? 0) + patch.leftMainBeamDelta)
    console.log(`[precision-pass]   leftMainBeam: ${sheet.left.mainBeamLength} -> ${next.left.mainBeamLength} (delta: ${patch.leftMainBeamDelta})`)
  }
  if (patch.rightMainBeamDelta !== undefined) {
    next.right.mainBeamLength = round2((next.right.mainBeamLength ?? 0) + patch.rightMainBeamDelta)
    console.log(`[precision-pass]   rightMainBeam: ${sheet.right.mainBeamLength} -> ${next.right.mainBeamLength} (delta: ${patch.rightMainBeamDelta})`)
  }

  // Apply tine deltas
  if (patch.leftTineDeltas) {
    for (const [indexStr, delta] of Object.entries(patch.leftTineDeltas)) {
      const index = Number(indexStr)
      const tine = next.left.tines.find(t => t.index === index)
      if (tine) {
        const oldLen = tine.length
        tine.length = round2((tine.length ?? 0) + delta)
        console.log(`[precision-pass]   leftG${index}: ${oldLen} -> ${tine.length} (delta: ${delta})`)
      }
    }
  }
  if (patch.rightTineDeltas) {
    for (const [indexStr, delta] of Object.entries(patch.rightTineDeltas)) {
      const index = Number(indexStr)
      const tine = next.right.tines.find(t => t.index === index)
      if (tine) {
        const oldLen = tine.length
        tine.length = round2((tine.length ?? 0) + delta)
        console.log(`[precision-pass]   rightG${index}: ${oldLen} -> ${tine.length} (delta: ${delta})`)
      }
    }
  }

  // Apply mass deltas
  if (patch.leftMassDeltas) {
    for (const [indexStr, delta] of Object.entries(patch.leftMassDeltas)) {
      const index = Number(indexStr)
      const mass = next.left.masses.find(m => m.index === index)
      if (mass) {
        const oldCirc = mass.circumference
        mass.circumference = round2((mass.circumference ?? 0) + delta)
        console.log(`[precision-pass]   leftH${index}: ${oldCirc} -> ${mass.circumference} (delta: ${delta})`)
      }
    }
  }
  if (patch.rightMassDeltas) {
    for (const [indexStr, delta] of Object.entries(patch.rightMassDeltas)) {
      const index = Number(indexStr)
      const mass = next.right.masses.find(m => m.index === index)
      if (mass) {
        const oldCirc = mass.circumference
        mass.circumference = round2((mass.circumference ?? 0) + delta)
        console.log(`[precision-pass]   rightH${index}: ${oldCirc} -> ${mass.circumference} (delta: ${delta})`)
      }
    }
  }

  // Apply deduction delta
  if (patch.deductionDelta !== undefined) {
    next.deductions.totalDeductions = round2(
      (next.deductions.totalDeductions ?? 0) + patch.deductionDelta
    )
    console.log(`[precision-pass]   deductions: ${sheet.deductions.totalDeductions} -> ${next.deductions.totalDeductions} (delta: ${patch.deductionDelta})`)
  }

  // Recompute gross and net through the rules engine
  const oldGross = next.grossScore
  const oldNet = next.netScore
  next.grossScore = computeGrossScore(next)
  next.netScore = computeNetScoreTypical(next) // Default to typical

  console.log(`[precision-pass] Scores recomputed: gross ${oldGross} -> ${next.grossScore}, net ${oldNet} -> ${next.netScore}`)

  return next
}

/**
 * Generate mutation candidates for precision pass.
 * Each candidate is a specific field-level adjustment.
 */
export function generateMutationCandidates(
  sheet: ScoreSheetMeasurements,
  options: {
    weakReference?: boolean
    errorDirection?: 'high' | 'low' | 'unknown'
  } = {}
): SheetMutationCandidate[] {
  const candidates: SheetMutationCandidate[] = []
  const { weakReference = false, errorDirection = 'unknown' } = options

  // 1. Baseline (no-op)
  candidates.push({
    hypothesisType: 'noop',
    patch: {},
    notes: ['Baseline - no changes'],
  })

  // 2. Spread adjustments
  if (sheet.insideSpread !== null) {
    candidates.push({
      hypothesisType: 'spread_expand',
      patch: { insideSpreadDelta: 0.5 },
      notes: ['+0.5"'],
    })
    candidates.push({
      hypothesisType: 'spread_reduce',
      patch: { insideSpreadDelta: -0.5 },
      notes: ['-0.5"'],
    })
    if (weakReference) {
      candidates.push({
        hypothesisType: 'spread_expand',
        patch: { insideSpreadDelta: 2.0 },
        notes: ['+2.0"'],
      })
      candidates.push({
        hypothesisType: 'spread_reduce',
        patch: { insideSpreadDelta: -2.0 },
        notes: ['-2.0"'],
      })
    }
  }

  // 3. Main beam adjustments (both sides together)
  if (sheet.left.mainBeamLength !== null && sheet.right.mainBeamLength !== null) {
    candidates.push({
      hypothesisType: 'beam_extend',
      patch: { leftMainBeamDelta: 0.5, rightMainBeamDelta: 0.5 },
      notes: ['+0.5" each'],
    })
    candidates.push({
      hypothesisType: 'beam_reduce',
      patch: { leftMainBeamDelta: -0.5, rightMainBeamDelta: -0.5 },
      notes: ['-0.5" each'],
    })
    if (weakReference) {
      candidates.push({
        hypothesisType: 'beam_extend',
        patch: { leftMainBeamDelta: 2.0, rightMainBeamDelta: 2.0 },
        notes: ['+2.0" each'],
      })
      candidates.push({
        hypothesisType: 'beam_reduce',
        patch: { leftMainBeamDelta: -2.0, rightMainBeamDelta: -2.0 },
        notes: ['-2.0" each'],
      })
    }
  }

  // 4. Tine adjustments (G2 is typically the longest, most impactful)
  const g2Left = sheet.left.tines.find(t => t.index === 2)
  const g2Right = sheet.right.tines.find(t => t.index === 2)
  if (g2Left?.length !== null && g2Right?.length !== null) {
    candidates.push({
      hypothesisType: 'tine_extend',
      patch: { leftTineDeltas: { 2: 0.5 }, rightTineDeltas: { 2: 0.5 } },
      notes: ['G2 +0.5" each'],
    })
    candidates.push({
      hypothesisType: 'tine_reduce',
      patch: { leftTineDeltas: { 2: -0.5 }, rightTineDeltas: { 2: -0.5 } },
      notes: ['G2 -0.5" each'],
    })
  }

  // 5. Mass adjustments (H1 is the most impactful circumference)
  const h1Left = sheet.left.masses.find(m => m.index === 1)
  const h1Right = sheet.right.masses.find(m => m.index === 1)
  if (h1Left?.circumference !== null && h1Right?.circumference !== null) {
    candidates.push({
      hypothesisType: 'mass_boost',
      patch: { leftMassDeltas: { 1: 0.25 }, rightMassDeltas: { 1: 0.25 } },
      notes: ['H1 +0.25" each'],
    })
    candidates.push({
      hypothesisType: 'mass_reduce',
      patch: { leftMassDeltas: { 1: -0.25 }, rightMassDeltas: { 1: -0.25 } },
      notes: ['H1 -0.25" each'],
    })
  }

  // 6. Deduction adjustments
  if (sheet.deductions.totalDeductions !== null) {
    candidates.push({
      hypothesisType: 'deduction_reduce',
      patch: { deductionDelta: -1.0 },
      notes: ['-1.0"'],
    })
    candidates.push({
      hypothesisType: 'deduction_increase',
      patch: { deductionDelta: 1.0 },
      notes: ['+1.0"'],
    })
  }

  // 7. Combo adjustments for larger errors
  if (weakReference || errorDirection !== 'unknown') {
    const sign = errorDirection === 'high' ? -1 : 1
    candidates.push({
      hypothesisType: 'combo',
      patch: {
        leftMainBeamDelta: sign * 1.0,
        rightMainBeamDelta: sign * 1.0,
        insideSpreadDelta: sign * 0.5,
      },
      notes: [errorDirection === 'high' ? 'Scale down combo' : 'Scale up combo'],
    })
  }

  return candidates
}

/**
 * Describe a mutation candidate in human-readable form
 */
export function describeMutation(candidate: SheetMutationCandidate): string {
  const { hypothesisType, patch, notes } = candidate
  const notesStr = notes?.join(', ') || ''

  switch (hypothesisType) {
    case 'noop':
      return 'Baseline (no changes)'
    case 'spread_expand':
      return `Expand spread ${notesStr}`
    case 'spread_reduce':
      return `Reduce spread ${notesStr}`
    case 'beam_extend':
      return `Extend main beams ${notesStr}`
    case 'beam_reduce':
      return `Reduce main beams ${notesStr}`
    case 'tine_extend':
      return `Extend tines ${notesStr}`
    case 'tine_reduce':
      return `Reduce tines ${notesStr}`
    case 'mass_boost':
      return `Increase mass ${notesStr}`
    case 'mass_reduce':
      return `Reduce mass ${notesStr}`
    case 'deduction_reduce':
      return `Reduce deductions ${notesStr}`
    case 'deduction_increase':
      return `Increase deductions ${notesStr}`
    case 'symmetry_beam':
      return `Symmetrize beams ${notesStr}`
    case 'symmetry_tine':
      return `Symmetrize tines ${notesStr}`
    case 'swap_sides':
      return 'Swap left/right'
    case 'combo':
      return `Combination adjustment ${notesStr}`
    default:
      return `${hypothesisType} ${notesStr}`
  }
}
