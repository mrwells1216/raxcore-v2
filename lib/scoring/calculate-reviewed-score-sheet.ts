/**
 * Calculate Reviewed Score Sheet
 * 
 * Deterministic score calculation utility.
 * Accepts canonical ScoreSheetPayload and computes gross/net totals.
 * 
 * This is the single source of truth for B&C score computation.
 * No AI calls - pure math based on measurements.
 */

import type { ScoreSheetPayload, ScoreSheetMeasurements, ComputedScores } from '@/lib/rules-engine/types'
import { computeAllScores, computeGrossScore, computeNetScoreTypical, computeNetScoreNonTypical } from '@/lib/rules-engine/compute'

export interface ReviewedScoreResult {
  grossScore: number
  netScore: number
  spreadCredit: number
  leftTotal: number
  rightTotal: number
  abnormalTotal: number
  totalDeductions: number
  isValid: boolean
  validationErrors: string[]
}

/**
 * Calculate scores from a ScoreSheetPayload.
 * Delegates to the rules engine for deterministic computation.
 */
export function calculateReviewedScoreSheet(payload: ScoreSheetPayload): ReviewedScoreResult {
  const { measurements, scoringSystem } = payload
  
  // Validate required measurements
  const validationErrors: string[] = []
  
  if (measurements.insideSpread === null) {
    validationErrors.push('Missing inside spread measurement')
  }
  if (measurements.left.mainBeamLength === null) {
    validationErrors.push('Missing left main beam measurement')
  }
  if (measurements.right.mainBeamLength === null) {
    validationErrors.push('Missing right main beam measurement')
  }
  
  // Compute scores using rules engine
  const scores = computeAllScores(measurements, scoringSystem)
  
  return {
    grossScore: scores.gross,
    netScore: scores.net,
    spreadCredit: scores.spreadCredit,
    leftTotal: scores.leftTotal,
    rightTotal: scores.rightTotal,
    abnormalTotal: scores.abnormalTotal,
    totalDeductions: scores.totalDeductions,
    isValid: validationErrors.length === 0,
    validationErrors,
  }
}

/**
 * Calculate gross score from flat measurements (CorrectedMeasurements format).
 * Used by the editor for live recalculation.
 */
export function calculateGrossFromFlat(m: {
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
}): number {
  // Spread credit = min(inside spread, longest main beam)
  const spreadCredit = Math.min(
    m.inside_spread ?? 0,
    Math.max(m.main_beam_left ?? 0, m.main_beam_right ?? 0)
  )
  
  // Left side total
  const leftTotal = (m.main_beam_left ?? 0) +
    (m.g1_left ?? 0) + (m.g2_left ?? 0) + (m.g3_left ?? 0) + (m.g4_left ?? 0) + (m.g5_left ?? 0) +
    (m.h1_left ?? 0) + (m.h2_left ?? 0) + (m.h3_left ?? 0) + (m.h4_left ?? 0)
  
  // Right side total
  const rightTotal = (m.main_beam_right ?? 0) +
    (m.g1_right ?? 0) + (m.g2_right ?? 0) + (m.g3_right ?? 0) + (m.g4_right ?? 0) + (m.g5_right ?? 0) +
    (m.h1_right ?? 0) + (m.h2_right ?? 0) + (m.h3_right ?? 0) + (m.h4_right ?? 0)
  
  return spreadCredit + leftTotal + rightTotal + (m.abnormal_points ?? 0)
}

/**
 * Calculate symmetry deductions from flat measurements.
 */
export function calculateDeductionsFromFlat(m: {
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
}): number {
  const diffs = [
    Math.abs((m.main_beam_left ?? 0) - (m.main_beam_right ?? 0)),
    Math.abs((m.g1_left ?? 0) - (m.g1_right ?? 0)),
    Math.abs((m.g2_left ?? 0) - (m.g2_right ?? 0)),
    Math.abs((m.g3_left ?? 0) - (m.g3_right ?? 0)),
    Math.abs((m.g4_left ?? 0) - (m.g4_right ?? 0)),
    Math.abs((m.g5_left ?? 0) - (m.g5_right ?? 0)),
    Math.abs((m.h1_left ?? 0) - (m.h1_right ?? 0)),
    Math.abs((m.h2_left ?? 0) - (m.h2_right ?? 0)),
    Math.abs((m.h3_left ?? 0) - (m.h3_right ?? 0)),
    Math.abs((m.h4_left ?? 0) - (m.h4_right ?? 0)),
  ]
  return diffs.reduce((sum, d) => sum + d, 0)
}

/**
 * Calculate net score from flat measurements.
 */
export function calculateNetFromFlat(m: {
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
}, rackType: 'typical' | 'non-typical'): number {
  const gross = calculateGrossFromFlat(m)
  
  if (rackType === 'non-typical') {
    // Non-typical: gross - symmetry deductions only
    return gross - (m.deductions ?? 0)
  }
  
  // Typical: gross - symmetry deductions - abnormal points
  return gross - (m.deductions ?? 0) - (m.abnormal_points ?? 0)
}

/**
 * Format a decimal score to B&C fractional format (e.g., 23 4/8)
 */
export function formatToFractional(value: number | null): string {
  if (value === null) return '—'
  
  const whole = Math.floor(value)
  const decimal = value - whole
  
  // Convert to eighths
  const eighths = Math.round(decimal * 8)
  
  if (eighths === 0) {
    return `${whole}`
  } else if (eighths === 8) {
    return `${whole + 1}`
  } else {
    return `${whole} ${eighths}/8`
  }
}

/**
 * Parse a B&C fractional format to decimal (e.g., "23 4/8" -> 23.5)
 */
export function parseFractional(value: string): number | null {
  if (!value || value === '—') return null
  
  const trimmed = value.trim()
  
  // Check for fraction
  const fractionMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (fractionMatch) {
    const whole = parseInt(fractionMatch[1], 10)
    const numerator = parseInt(fractionMatch[2], 10)
    const denominator = parseInt(fractionMatch[3], 10)
    return whole + (numerator / denominator)
  }
  
  // Plain number
  const num = parseFloat(trimmed)
  return isNaN(num) ? null : num
}
