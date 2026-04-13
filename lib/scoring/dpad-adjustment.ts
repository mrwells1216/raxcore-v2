/**
 * D-PAD Adjustment Logic - Step 9
 * 
 * Handles the geometry-to-measurement conversion for landmark adjustments:
 * - Extract adjustable points from detailed landmarks
 * - Recalculate measurements from adjusted point positions
 * - Track adjustment provenance for training
 */

import type { DetailedLandmarks, Measurements } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjustablePoint {
  id: string
  label: string
  /** Normalized coordinates (0-1) */
  x: number
  y: number
  /** Which measurement family this point affects */
  family: 'tine' | 'beam' | 'spread' | 'circumference'
  /** Specific measurement key, e.g., 'g1_left', 'main_beam_left' */
  measurementKey: string
  /** Original confidence (0-1) */
  confidence: number
  /** Point role: 'tip' or 'base' */
  role: 'tip' | 'base'
  /** Connected point ID (e.g., tine tip connects to base) */
  connectedPointId?: string
  /** Side of the rack */
  side: 'left' | 'right' | 'center'
}

export interface PointAdjustment {
  pointId: string
  originalPosition: { x: number; y: number }
  newPosition: { x: number; y: number }
  measurementKey: string
  deltaPixels: { x: number; y: number }
}

export interface AdjustmentSession {
  id: string
  predictionId: string
  buckId: string
  imageIndex: number
  adjustments: PointAdjustment[]
  originalMeasurements: Partial<Measurements>
  adjustedMeasurements: Partial<Measurements>
  originalScore: number | null
  adjustedScore: number | null
  createdAt: Date
  confirmedAt?: Date
}

export interface MeasurementRecalcResult {
  measurementKey: string
  originalValue: number | null
  newValue: number | null
  delta: number
  confidence: number
  method: 'geometric' | 'estimated'
}

// ─────────────────────────────────────────────────────────────────────────────
// Point Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract adjustable points from detailed landmarks.
 * Maps landmark keys to measurement families and roles.
 */
export function extractAdjustablePoints(
  landmarks: DetailedLandmarks | null,
  imageDimensions: { width: number; height: number },
  confidenceMap?: Record<string, number>
): AdjustablePoint[] {
  if (!landmarks) return []

  const points: AdjustablePoint[] = []

  // Helper to add a point if it exists
  const addPoint = (
    key: string,
    label: string,
    family: AdjustablePoint['family'],
    measurementKey: string,
    role: AdjustablePoint['role'],
    side: AdjustablePoint['side'],
    connectedPointId?: string
  ) => {
    const landmark = (landmarks as any)[key]
    if (!landmark || landmark.x == null || landmark.y == null) return

    // Normalize coordinates to 0-1 range
    const x = landmark.x / imageDimensions.width
    const y = landmark.y / imageDimensions.height

    const confidence = landmark.confidence ?? 
      confidenceMap?.[key] ?? 
      confidenceMap?.[measurementKey] ?? 
      0.5

    points.push({
      id: key,
      label,
      x,
      y,
      family,
      measurementKey,
      confidence,
      role,
      side,
      connectedPointId,
    })
  }

  // ─── Tine Tips ────────────────────────────────────────────────────────────

  // G1 (brow tines)
  addPoint('g1_left_tip', 'G1 Left Tip', 'tine', 'g1_left', 'tip', 'left', 'g1_left_base')
  addPoint('g1_left_base', 'G1 Left Base', 'tine', 'g1_left', 'base', 'left', 'g1_left_tip')
  addPoint('g1_right_tip', 'G1 Right Tip', 'tine', 'g1_right', 'tip', 'right', 'g1_right_base')
  addPoint('g1_right_base', 'G1 Right Base', 'tine', 'g1_right', 'base', 'right', 'g1_right_tip')

  // G2
  addPoint('g2_left_tip', 'G2 Left Tip', 'tine', 'g2_left', 'tip', 'left', 'g2_left_base')
  addPoint('g2_left_base', 'G2 Left Base', 'tine', 'g2_left', 'base', 'left', 'g2_left_tip')
  addPoint('g2_right_tip', 'G2 Right Tip', 'tine', 'g2_right', 'tip', 'right', 'g2_right_base')
  addPoint('g2_right_base', 'G2 Right Base', 'tine', 'g2_right', 'base', 'right', 'g2_right_tip')

  // G3
  addPoint('g3_left_tip', 'G3 Left Tip', 'tine', 'g3_left', 'tip', 'left', 'g3_left_base')
  addPoint('g3_left_base', 'G3 Left Base', 'tine', 'g3_left', 'base', 'left', 'g3_left_tip')
  addPoint('g3_right_tip', 'G3 Right Tip', 'tine', 'g3_right', 'tip', 'right', 'g3_right_base')
  addPoint('g3_right_base', 'G3 Right Base', 'tine', 'g3_right', 'base', 'right', 'g3_right_tip')

  // G4
  addPoint('g4_left_tip', 'G4 Left Tip', 'tine', 'g4_left', 'tip', 'left', 'g4_left_base')
  addPoint('g4_left_base', 'G4 Left Base', 'tine', 'g4_left', 'base', 'left', 'g4_left_tip')
  addPoint('g4_right_tip', 'G4 Right Tip', 'tine', 'g4_right', 'tip', 'right', 'g4_right_base')
  addPoint('g4_right_base', 'G4 Right Base', 'tine', 'g4_right', 'base', 'right', 'g4_right_tip')

  // G5 (if present)
  addPoint('g5_left_tip', 'G5 Left Tip', 'tine', 'g5_left', 'tip', 'left', 'g5_left_base')
  addPoint('g5_left_base', 'G5 Left Base', 'tine', 'g5_left', 'base', 'left', 'g5_left_tip')
  addPoint('g5_right_tip', 'G5 Right Tip', 'tine', 'g5_right', 'tip', 'right', 'g5_right_base')
  addPoint('g5_right_base', 'G5 Right Base', 'tine', 'g5_right', 'base', 'right', 'g5_right_tip')

  // G6 (if present)
  addPoint('g6_left_tip', 'G6 Left Tip', 'tine', 'g6_left', 'tip', 'left', 'g6_left_base')
  addPoint('g6_left_base', 'G6 Left Base', 'tine', 'g6_left', 'base', 'left', 'g6_left_tip')
  addPoint('g6_right_tip', 'G6 Right Tip', 'tine', 'g6_right', 'tip', 'right', 'g6_right_base')
  addPoint('g6_right_base', 'G6 Right Base', 'tine', 'g6_right', 'base', 'right', 'g6_right_tip')

  // G7 (if present)
  addPoint('g7_left_tip', 'G7 Left Tip', 'tine', 'g7_left', 'tip', 'left', 'g7_left_base')
  addPoint('g7_left_base', 'G7 Left Base', 'tine', 'g7_left', 'base', 'left', 'g7_left_tip')
  addPoint('g7_right_tip', 'G7 Right Tip', 'tine', 'g7_right', 'tip', 'right', 'g7_right_base')
  addPoint('g7_right_base', 'G7 Right Base', 'tine', 'g7_right', 'base', 'right', 'g7_right_tip')

  // ─── Main Beam Points ─────────────────────────────────────────────────────

  addPoint('beam_left_base', 'Left Beam Base', 'beam', 'main_beam_left', 'base', 'left', 'beam_left_tip')
  addPoint('beam_left_tip', 'Left Beam Tip', 'beam', 'main_beam_left', 'tip', 'left', 'beam_left_base')
  addPoint('beam_right_base', 'Right Beam Base', 'beam', 'main_beam_right', 'base', 'right', 'beam_right_tip')
  addPoint('beam_right_tip', 'Right Beam Tip', 'beam', 'main_beam_right', 'tip', 'right', 'beam_right_base')

  // Alternative beam point names
  addPoint('main_beam_left_base', 'Left Beam Base', 'beam', 'main_beam_left', 'base', 'left')
  addPoint('main_beam_left_tip', 'Left Beam Tip', 'beam', 'main_beam_left', 'tip', 'left')
  addPoint('main_beam_right_base', 'Right Beam Base', 'beam', 'main_beam_right', 'base', 'right')
  addPoint('main_beam_right_tip', 'Right Beam Tip', 'beam', 'main_beam_right', 'tip', 'right')

  // ─── Spread Points ────────────────────────────────────────────────────────

  addPoint('spread_left', 'Inside Spread Left', 'spread', 'inside_spread', 'base', 'left', 'spread_right')
  addPoint('spread_right', 'Inside Spread Right', 'spread', 'inside_spread', 'base', 'right', 'spread_left')
  addPoint('inside_spread_left', 'Inside Spread Left', 'spread', 'inside_spread', 'base', 'left')
  addPoint('inside_spread_right', 'Inside Spread Right', 'spread', 'inside_spread', 'base', 'right')

  // ─── Circumference Points ─────────────────────────────────────────────────

  // H1 (base circumference)
  addPoint('h1_left_point', 'H1 Left', 'circumference', 'h1_left', 'base', 'left')
  addPoint('h1_right_point', 'H1 Right', 'circumference', 'h1_right', 'base', 'right')

  // H2
  addPoint('h2_left_point', 'H2 Left', 'circumference', 'h2_left', 'base', 'left')
  addPoint('h2_right_point', 'H2 Right', 'circumference', 'h2_right', 'base', 'right')

  // H3
  addPoint('h3_left_point', 'H3 Left', 'circumference', 'h3_left', 'base', 'left')
  addPoint('h3_right_point', 'H3 Right', 'circumference', 'h3_right', 'base', 'right')

  // H4
  addPoint('h4_left_point', 'H4 Left', 'circumference', 'h4_left', 'base', 'left')
  addPoint('h4_right_point', 'H4 Right', 'circumference', 'h4_right', 'base', 'right')

  return points
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurement Recalculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recalculate a measurement based on adjusted point positions.
 * Uses geometric distance calculation with scaling factor.
 */
export function recalculateMeasurement(
  measurementKey: string,
  originalValue: number | null,
  adjustment: PointAdjustment,
  allPoints: AdjustablePoint[],
  scalingFactor: number, // pixels per inch
  imageDimensions: { width: number; height: number }
): MeasurementRecalcResult {
  // Find the adjusted point and its connected point
  const adjustedPoint = allPoints.find(p => p.id === adjustment.pointId)
  if (!adjustedPoint) {
    return {
      measurementKey,
      originalValue,
      newValue: originalValue,
      delta: 0,
      confidence: 0.5,
      method: 'estimated',
    }
  }

  // Find the connected point (base for tip, tip for base)
  const connectedPoint = adjustedPoint.connectedPointId 
    ? allPoints.find(p => p.id === adjustedPoint.connectedPointId)
    : null

  if (!connectedPoint) {
    // For spread and circumference, we might not have a direct connection
    // Use the delta to estimate the new value
    const deltaInches = Math.sqrt(
      Math.pow(adjustment.deltaPixels.x / scalingFactor, 2) +
      Math.pow(adjustment.deltaPixels.y / scalingFactor, 2)
    )

    // For tines/beams, movement toward the base reduces length
    // Movement away from base increases length
    const newValue = originalValue != null 
      ? originalValue + (adjustedPoint.role === 'tip' ? deltaInches : -deltaInches)
      : null

    return {
      measurementKey,
      originalValue,
      newValue: newValue != null ? Math.max(0, newValue) : null,
      delta: newValue != null && originalValue != null ? newValue - originalValue : 0,
      confidence: 0.6,
      method: 'estimated',
    }
  }

  // Calculate new distance between points
  const newTipX = adjustment.newPosition.x * imageDimensions.width
  const newTipY = adjustment.newPosition.y * imageDimensions.height
  const baseX = connectedPoint.x * imageDimensions.width
  const baseY = connectedPoint.y * imageDimensions.height

  const newDistancePixels = Math.sqrt(
    Math.pow(newTipX - baseX, 2) + Math.pow(newTipY - baseY, 2)
  )

  const newValue = newDistancePixels / scalingFactor

  return {
    measurementKey,
    originalValue,
    newValue: Math.round(newValue * 8) / 8, // Round to nearest 1/8 inch
    delta: originalValue != null ? newValue - originalValue : 0,
    confidence: 0.85,
    method: 'geometric',
  }
}

/**
 * Apply multiple adjustments and recalculate all affected measurements.
 */
export function applyAdjustments(
  adjustments: PointAdjustment[],
  originalMeasurements: Partial<Measurements>,
  allPoints: AdjustablePoint[],
  scalingFactor: number,
  imageDimensions: { width: number; height: number }
): {
  adjustedMeasurements: Partial<Measurements>
  recalcResults: MeasurementRecalcResult[]
} {
  const adjustedMeasurements = { ...originalMeasurements }
  const recalcResults: MeasurementRecalcResult[] = []

  for (const adjustment of adjustments) {
    const result = recalculateMeasurement(
      adjustment.measurementKey,
      (originalMeasurements as any)[adjustment.measurementKey] ?? null,
      adjustment,
      allPoints,
      scalingFactor,
      imageDimensions
    )

    recalcResults.push(result)

    if (result.newValue != null) {
      (adjustedMeasurements as any)[adjustment.measurementKey] = result.newValue
    }
  }

  return { adjustedMeasurements, recalcResults }
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate the score delta from measurement changes.
 * This is a quick approximation for live preview.
 */
export function estimateScoreDelta(
  recalcResults: MeasurementRecalcResult[]
): number {
  let totalDelta = 0

  for (const result of recalcResults) {
    const delta = result.delta

    // Weight by measurement type
    // Tines and beams contribute directly to score
    // Circumferences contribute at 1/4 rate for typical racks
    if (result.measurementKey.startsWith('g') || result.measurementKey.includes('beam')) {
      totalDelta += delta
    } else if (result.measurementKey.startsWith('h')) {
      totalDelta += delta * 0.25
    } else if (result.measurementKey.includes('spread')) {
      totalDelta += delta
    }
  }

  return Math.round(totalDelta * 10) / 10
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new adjustment session.
 */
export function createAdjustmentSession(
  predictionId: string,
  buckId: string,
  imageIndex: number,
  originalMeasurements: Partial<Measurements>,
  originalScore: number | null
): AdjustmentSession {
  return {
    id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    predictionId,
    buckId,
    imageIndex,
    adjustments: [],
    originalMeasurements,
    adjustedMeasurements: { ...originalMeasurements },
    originalScore,
    adjustedScore: originalScore,
    createdAt: new Date(),
  }
}

/**
 * Add an adjustment to a session and recalculate.
 */
export function addAdjustmentToSession(
  session: AdjustmentSession,
  adjustment: PointAdjustment,
  allPoints: AdjustablePoint[],
  scalingFactor: number,
  imageDimensions: { width: number; height: number }
): AdjustmentSession {
  // Remove any existing adjustment for this point
  const existingAdjustments = session.adjustments.filter(
    a => a.pointId !== adjustment.pointId
  )

  const newAdjustments = [...existingAdjustments, adjustment]

  // Recalculate from original measurements
  const { adjustedMeasurements, recalcResults } = applyAdjustments(
    newAdjustments,
    session.originalMeasurements,
    allPoints,
    scalingFactor,
    imageDimensions
  )

  const scoreDelta = estimateScoreDelta(recalcResults)

  return {
    ...session,
    adjustments: newAdjustments,
    adjustedMeasurements,
    adjustedScore: session.originalScore != null 
      ? session.originalScore + scoreDelta 
      : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Training Data Generation
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjustmentTrainingRecord {
  sessionId: string
  predictionId: string
  buckId: string
  imageIndex: number
  pointId: string
  measurementKey: string
  originalPosition: { x: number; y: number }
  newPosition: { x: number; y: number }
  originalValue: number | null
  newValue: number | null
  originalConfidence: number
  userAction: 'confirm' | 'cancel'
  createdAt: Date
}

/**
 * Generate training records from a confirmed adjustment session.
 */
export function generateTrainingRecords(
  session: AdjustmentSession,
  allPoints: AdjustablePoint[],
  userAction: 'confirm' | 'cancel'
): AdjustmentTrainingRecord[] {
  return session.adjustments.map(adjustment => {
    const point = allPoints.find(p => p.id === adjustment.pointId)
    return {
      sessionId: session.id,
      predictionId: session.predictionId,
      buckId: session.buckId,
      imageIndex: session.imageIndex,
      pointId: adjustment.pointId,
      measurementKey: adjustment.measurementKey,
      originalPosition: adjustment.originalPosition,
      newPosition: adjustment.newPosition,
      originalValue: (session.originalMeasurements as any)[adjustment.measurementKey] ?? null,
      newValue: (session.adjustedMeasurements as any)[adjustment.measurementKey] ?? null,
      originalConfidence: point?.confidence ?? 0.5,
      userAction,
      createdAt: new Date(),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AdjustmentSession,
  MeasurementRecalcResult,
  AdjustmentTrainingRecord,
}
