/**
 * Boone & Crockett Style Score Sheet
 * 
 * This module provides structured score sheet types and utilities
 * for displaying AI-extracted measurements in the official B&C format.
 */

import type { Measurements } from '@/lib/types'

// ============================================================================
// SCORE SHEET TYPES
// ============================================================================

/**
 * Confidence tier for individual measurements
 */
export type MeasurementConfidence = 'high' | 'medium' | 'low' | 'estimated'

/**
 * Individual measurement line item with confidence metadata
 */
export interface MeasurementLine {
  /** Measured value in inches (null if not measurable) */
  value: number | null
  /** Confidence tier for this measurement */
  confidence: MeasurementConfidence
  /** Optional note explaining uncertainty or estimation method */
  note?: string
}

/**
 * Left/right side measurements for a single antler
 */
export interface AntlerSideMeasurements {
  /** Main beam length from base to tip */
  main_beam: MeasurementLine
  /** G1 (brow tine) length */
  g1: MeasurementLine
  /** G2 tine length */
  g2: MeasurementLine
  /** G3 tine length */
  g3: MeasurementLine
  /** G4 tine length (may be 0 for 8-pointers) */
  g4: MeasurementLine
  /** G5 tine length (null if not present) */
  g5: MeasurementLine
  /** H1 circumference (base) */
  h1: MeasurementLine
  /** H2 circumference (between G1 and G2) */
  h2: MeasurementLine
  /** H3 circumference (between G2 and G3) */
  h3: MeasurementLine
  /** H4 circumference (between G3 and G4 or at tip) */
  h4: MeasurementLine
}

/**
 * Deductions breakdown
 */
export interface DeductionsBreakdown {
  /** Total symmetry deductions (difference between left/right) */
  symmetry_total: MeasurementLine
  /** Abnormal points deduction (for typical scoring) */
  abnormal_deduction: MeasurementLine
}

/**
 * Full B&C-style score sheet
 */
export interface ScoreSheet {
  /** Inside spread measurement */
  spread: {
    inside: MeasurementLine
    /** Credit cannot exceed longest main beam */
    credit: MeasurementLine
  }
  /** Left antler measurements */
  left: AntlerSideMeasurements
  /** Right antler measurements */
  right: AntlerSideMeasurements
  /** Abnormal points (stickers, kickers, etc.) */
  abnormal_points: {
    /** Total length of all abnormal points */
    total_length: MeasurementLine
    /** Count of abnormal points detected */
    count: number
    /** Notes about abnormal point locations */
    notes?: string[]
  }
  /** Deductions breakdown */
  deductions: DeductionsBreakdown
  /** Totals */
  totals: {
    /** Sum of all left side measurements */
    left_total: number
    /** Sum of all right side measurements */
    right_total: number
    /** Left + right + spread credit */
    subtotal: number
    /** Gross score before deductions */
    gross: MeasurementLine
    /** Net score after deductions */
    net: MeasurementLine
  }
  /** Overall metadata */
  metadata: {
    /** Primary scaling reference used */
    scaling_reference: string
    /** Overall confidence in the score sheet */
    overall_confidence: MeasurementConfidence
    /** List of measurements with low confidence */
    low_confidence_measurements: string[]
    /** Processing notes */
    notes: string[]
    /** Rack type detected */
    rack_type: 'typical' | 'non-typical'
    /** Main frame point count */
    main_frame_points: number
  }
}

// ============================================================================
// SCORE SHEET BUILDER
// ============================================================================

/**
 * Determine confidence tier based on various factors
 */
function inferConfidence(
  value: number | null,
  isCircumference: boolean = false,
  isOptionalTine: boolean = false
): MeasurementConfidence {
  if (value === null) return 'estimated'
  if (isOptionalTine && value === 0) return 'high' // Zero is valid for missing tines
  
  // Circumferences are harder to estimate from photos
  if (isCircumference) {
    return value > 0 ? 'medium' : 'estimated'
  }
  
  return 'medium' // Default for AI vision estimates
}

/**
 * Create a measurement line from a raw value
 */
function createLine(
  value: number | null,
  options: {
    isCircumference?: boolean
    isOptionalTine?: boolean
    note?: string
  } = {}
): MeasurementLine {
  return {
    value,
    confidence: inferConfidence(value, options.isCircumference, options.isOptionalTine),
    note: options.note
  }
}

/**
 * Calculate symmetry deduction between two values
 */
function calculateSymmetryDeduction(left: number | null, right: number | null): number {
  if (left === null || right === null) return 0
  return Math.abs(left - right)
}

/**
 * Build a B&C-style score sheet from raw measurements
 */
export function buildScoreSheet(
  measurements: Measurements,
  options: {
    scalingReference?: string
    rackType?: 'typical' | 'non-typical'
    confidenceNotes?: string[]
    mainFramePoints?: number
  } = {}
): ScoreSheet {
  const {
    scalingReference = 'unknown',
    rackType = 'typical',
    confidenceNotes = [],
    mainFramePoints = 10
  } = options

  // Build left side measurements
  const left: AntlerSideMeasurements = {
    main_beam: createLine(measurements.main_beam_left),
    g1: createLine(measurements.g1_left),
    g2: createLine(measurements.g2_left),
    g3: createLine(measurements.g3_left),
    g4: createLine(measurements.g4_left, { isOptionalTine: true }),
    g5: createLine(measurements.g5_left, { isOptionalTine: true }),
    h1: createLine(measurements.h1_left, { isCircumference: true }),
    h2: createLine(measurements.h2_left, { isCircumference: true }),
    h3: createLine(measurements.h3_left, { isCircumference: true }),
    h4: createLine(measurements.h4_left, { isCircumference: true }),
  }

  // Build right side measurements
  const right: AntlerSideMeasurements = {
    main_beam: createLine(measurements.main_beam_right),
    g1: createLine(measurements.g1_right),
    g2: createLine(measurements.g2_right),
    g3: createLine(measurements.g3_right),
    g4: createLine(measurements.g4_right, { isOptionalTine: true }),
    g5: createLine(measurements.g5_right, { isOptionalTine: true }),
    h1: createLine(measurements.h1_right, { isCircumference: true }),
    h2: createLine(measurements.h2_right, { isCircumference: true }),
    h3: createLine(measurements.h3_right, { isCircumference: true }),
    h4: createLine(measurements.h4_right, { isCircumference: true }),
  }

  // Calculate spread credit (cannot exceed longest main beam)
  const longestBeam = Math.max(
    measurements.main_beam_left ?? 0,
    measurements.main_beam_right ?? 0
  )
  const insideSpread = measurements.inside_spread ?? 0
  const spreadCredit = Math.min(insideSpread, longestBeam)

  // Calculate symmetry deductions
  const symmetryDeductions = 
    calculateSymmetryDeduction(measurements.main_beam_left, measurements.main_beam_right) +
    calculateSymmetryDeduction(measurements.g1_left, measurements.g1_right) +
    calculateSymmetryDeduction(measurements.g2_left, measurements.g2_right) +
    calculateSymmetryDeduction(measurements.g3_left, measurements.g3_right) +
    calculateSymmetryDeduction(measurements.g4_left, measurements.g4_right) +
    calculateSymmetryDeduction(measurements.h1_left, measurements.h1_right) +
    calculateSymmetryDeduction(measurements.h2_left, measurements.h2_right) +
    calculateSymmetryDeduction(measurements.h3_left, measurements.h3_right) +
    calculateSymmetryDeduction(measurements.h4_left, measurements.h4_right)

  // Calculate totals
  const leftTotal = 
    (measurements.main_beam_left ?? 0) +
    (measurements.g1_left ?? 0) +
    (measurements.g2_left ?? 0) +
    (measurements.g3_left ?? 0) +
    (measurements.g4_left ?? 0) +
    (measurements.g5_left ?? 0) +
    (measurements.h1_left ?? 0) +
    (measurements.h2_left ?? 0) +
    (measurements.h3_left ?? 0) +
    (measurements.h4_left ?? 0)

  const rightTotal = 
    (measurements.main_beam_right ?? 0) +
    (measurements.g1_right ?? 0) +
    (measurements.g2_right ?? 0) +
    (measurements.g3_right ?? 0) +
    (measurements.g4_right ?? 0) +
    (measurements.g5_right ?? 0) +
    (measurements.h1_right ?? 0) +
    (measurements.h2_right ?? 0) +
    (measurements.h3_right ?? 0) +
    (measurements.h4_right ?? 0)

  const subtotal = leftTotal + rightTotal + spreadCredit
  const abnormalTotal = measurements.abnormal_points ?? 0
  
  // For typical scoring: gross = subtotal, net = gross - symmetry - abnormal
  // For non-typical scoring: gross = subtotal + abnormal, net = gross - symmetry
  let gross: number
  let net: number
  
  if (rackType === 'typical') {
    gross = subtotal
    net = gross - symmetryDeductions - abnormalTotal
  } else {
    gross = subtotal + abnormalTotal
    net = gross - symmetryDeductions
  }

  // Identify low confidence measurements
  const lowConfidenceMeasurements: string[] = []
  const checkConfidence = (name: string, line: MeasurementLine) => {
    if (line.confidence === 'low' || line.confidence === 'estimated') {
      lowConfidenceMeasurements.push(name)
    }
  }
  
  // Check all measurements
  checkConfidence('Inside Spread', createLine(measurements.inside_spread))
  checkConfidence('Left Main Beam', left.main_beam)
  checkConfidence('Right Main Beam', right.main_beam)
  checkConfidence('H1 Left', left.h1)
  checkConfidence('H1 Right', right.h1)
  checkConfidence('H2 Left', left.h2)
  checkConfidence('H2 Right', right.h2)
  checkConfidence('H3 Left', left.h3)
  checkConfidence('H3 Right', right.h3)
  checkConfidence('H4 Left', left.h4)
  checkConfidence('H4 Right', right.h4)

  // Build notes
  const notes: string[] = [...confidenceNotes]
  if (lowConfidenceMeasurements.length > 0) {
    notes.push(`Low confidence on: ${lowConfidenceMeasurements.slice(0, 3).join(', ')}${lowConfidenceMeasurements.length > 3 ? ` (+${lowConfidenceMeasurements.length - 3} more)` : ''}`)
  }

  return {
    spread: {
      inside: createLine(measurements.inside_spread),
      credit: createLine(spreadCredit, { note: spreadCredit < insideSpread ? 'Limited to longest main beam' : undefined })
    },
    left,
    right,
    abnormal_points: {
      total_length: createLine(abnormalTotal),
      count: abnormalTotal > 0 ? Math.ceil(abnormalTotal / 3) : 0, // Rough estimate
      notes: abnormalTotal > 0 ? ['Abnormal points detected - count estimated'] : undefined
    },
    deductions: {
      symmetry_total: createLine(symmetryDeductions, { note: 'Sum of left/right differences' }),
      abnormal_deduction: createLine(rackType === 'typical' ? abnormalTotal : 0, {
        note: rackType === 'non-typical' ? 'Not deducted for non-typical' : undefined
      })
    },
    totals: {
      left_total: Math.round(leftTotal * 8) / 8, // Round to nearest 1/8
      right_total: Math.round(rightTotal * 8) / 8,
      subtotal: Math.round(subtotal * 8) / 8,
      gross: createLine(Math.round(gross * 8) / 8),
      net: createLine(Math.round(net * 8) / 8)
    },
    metadata: {
      scaling_reference: scalingReference,
      overall_confidence: lowConfidenceMeasurements.length > 4 ? 'low' : 
                          lowConfidenceMeasurements.length > 2 ? 'medium' : 'high',
      low_confidence_measurements: lowConfidenceMeasurements,
      notes,
      rack_type: rackType,
      main_frame_points: mainFramePoints
    }
  }
}

/**
 * Format a measurement value for display (to 1/8 inch precision)
 */
export function formatMeasurement(value: number | null): string {
  if (value === null) return '—'
  
  // Round to nearest 1/8
  const eighths = Math.round(value * 8)
  const whole = Math.floor(eighths / 8)
  const remainder = eighths % 8
  
  if (remainder === 0) {
    return whole.toString()
  }
  
  // Simplify fraction
  const fractions: Record<number, string> = {
    1: '⅛',
    2: '¼',
    3: '⅜',
    4: '½',
    5: '⅝',
    6: '¾',
    7: '⅞'
  }
  
  return `${whole}${fractions[remainder] || ''}`
}
