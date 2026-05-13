/**
 * lib/advanced-scoring/confidence.ts
 *
 * Confidence computation helpers for AdvancedMeasurement objects.
 * Confidence is a 0–1 number; 1 is highest confidence.
 */

import type { AdvancedMeasurement, MeasurementMethod } from './types'
import { isFiniteNumber } from './geometry'

// ─── Method base confidence ───────────────────────────────────────────────────

const METHOD_BASE_CONFIDENCE: Record<MeasurementMethod, number> = {
  three_d_point_cloud:          0.92,
  photo_polyline:               0.78,
  manual_entry:                 0.65,
  three_d_mesh_circumference:   0.70,
  three_d_mesh_fallback:        0.50,
  quick_ai:                     0.45,
}

export function methodBaseConfidence(method: MeasurementMethod): number {
  return METHOD_BASE_CONFIDENCE[method] ?? 0.4
}

// ─── Measurement confidence ───────────────────────────────────────────────────

/**
 * Compute the effective confidence for a single AdvancedMeasurement,
 * factoring in: method base, calibration source, snapping status,
 * point cloud density, and any existing warnings.
 */
export function computeMeasurementConfidence(m: AdvancedMeasurement): number {
  let score = methodBaseConfidence(m.method)
  if (isFiniteNumber(m.confidence) && m.confidence > 0) {
    score = (score + Math.max(0, Math.min(1, m.confidence))) / 2
  }

  // Calibration penalty
  if (m.provenance.calibrationSource === 'estimated') score *= 0.82
  if (m.provenance.calibrationSource === null) score *= 0.70

  // Point cloud snapping bonus
  if (m.method === 'three_d_mesh_fallback' && m.provenance.snappedToPointCloud === false) {
    score *= 0.80
  }
  if (m.method === 'three_d_point_cloud' && m.provenance.snappedToPointCloud === true) {
    score = Math.min(score * 1.05, 1.0)
  }

  // Sparse density penalty
  const density = m.provenance.pointCloudDensity
  if (density !== null && density !== undefined && density < 50) {
    score *= 0.75
  }

  // Warning penalty
  if (m.warnings.length > 0) score *= Math.pow(0.92, m.warnings.length)

  // Null/zero length measurement
  if (m.lengthInches === null || m.lengthInches === 0) score = 0

  return isFiniteNumber(score) ? Math.max(0, Math.min(1, score)) : 0
}

// ─── Session confidence ───────────────────────────────────────────────────────

/**
 * Aggregate confidence across all measurements in a session.
 * Fields with no measurement at all pull the average down.
 */
export function computeSessionConfidence(
  measurements: AdvancedMeasurement[],
  totalExpectedFields: number,
): number {
  if (totalExpectedFields <= 0) return 0
  const measured = measurements.filter(m => m.lengthInches !== null && m.lengthInches > 0)
  if (measured.length === 0) return 0

  const sumConf = measured.reduce((acc, m) => acc + computeMeasurementConfidence(m), 0)
  const avgConf = sumConf / measured.length

  // Penalize for incompleteness
  const completeness = measured.length / totalExpectedFields
  const sessionScore = avgConf * completeness
  return isFiniteNumber(sessionScore) ? Math.max(0, Math.min(1, sessionScore)) : 0
}

// ─── Tier ────────────────────────────────────────────────────────────────────

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'none'

export function confidenceTier(score: number): ConfidenceTier {
  if (score === 0) return 'none'
  if (score >= 0.75) return 'high'
  if (score >= 0.50) return 'medium'
  return 'low'
}
