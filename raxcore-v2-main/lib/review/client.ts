/**
 * Human Review Client Utilities
 * 
 * Browser-safe utility functions for review sheets.
 * No server imports - safe for client components.
 */

import type { CorrectedMeasurements } from './types'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'

/**
 * Extract flat measurements from a ScoreSheet
 */
export function extractMeasurementsFromScoreSheet(sheet: ScoreSheet): CorrectedMeasurements {
  return {
    inside_spread: sheet.spread.inside.value,
    main_beam_left: sheet.left.main_beam.value,
    main_beam_right: sheet.right.main_beam.value,
    g1_left: sheet.left.g1.value,
    g1_right: sheet.right.g1.value,
    g2_left: sheet.left.g2.value,
    g2_right: sheet.right.g2.value,
    g3_left: sheet.left.g3.value,
    g3_right: sheet.right.g3.value,
    g4_left: sheet.left.g4.value,
    g4_right: sheet.right.g4.value,
    g5_left: sheet.left.g5.value,
    g5_right: sheet.right.g5.value,
    h1_left: sheet.left.h1.value,
    h1_right: sheet.right.h1.value,
    h2_left: sheet.left.h2.value,
    h2_right: sheet.right.h2.value,
    h3_left: sheet.left.h3.value,
    h3_right: sheet.right.h3.value,
    h4_left: sheet.left.h4.value,
    h4_right: sheet.right.h4.value,
    abnormal_points: sheet.abnormal_points.total_length.value,
    deductions: sheet.deductions.symmetry_total.value,
  }
}

/**
 * Calculate gross score from measurements
 */
export function calculateGrossScore(m: CorrectedMeasurements): number {
  const spreadCredit = Math.min(
    m.inside_spread ?? 0,
    Math.max(m.main_beam_left ?? 0, m.main_beam_right ?? 0)
  )
  
  const leftTotal = (m.main_beam_left ?? 0) +
    (m.g1_left ?? 0) + (m.g2_left ?? 0) + (m.g3_left ?? 0) + (m.g4_left ?? 0) + (m.g5_left ?? 0) +
    (m.h1_left ?? 0) + (m.h2_left ?? 0) + (m.h3_left ?? 0) + (m.h4_left ?? 0)
  
  const rightTotal = (m.main_beam_right ?? 0) +
    (m.g1_right ?? 0) + (m.g2_right ?? 0) + (m.g3_right ?? 0) + (m.g4_right ?? 0) + (m.g5_right ?? 0) +
    (m.h1_right ?? 0) + (m.h2_right ?? 0) + (m.h3_right ?? 0) + (m.h4_right ?? 0)
  
  return spreadCredit + leftTotal + rightTotal + (m.abnormal_points ?? 0)
}

/**
 * Calculate net score from measurements (typical scoring)
 */
export function calculateNetScore(m: CorrectedMeasurements, rackType: 'typical' | 'non-typical'): number {
  const gross = calculateGrossScore(m)
  
  if (rackType === 'non-typical') {
    // Non-typical: gross - symmetry deductions only
    return gross - (m.deductions ?? 0)
  }
  
  // Typical: gross - symmetry deductions - abnormal points
  return gross - (m.deductions ?? 0) - (m.abnormal_points ?? 0)
}

/**
 * Calculate symmetry deductions
 */
export function calculateSymmetryDeductions(m: CorrectedMeasurements): number {
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
