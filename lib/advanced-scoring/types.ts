/**
 * lib/advanced-scoring/types.ts
 *
 * Canonical types for the advanced measurement domain.
 * These are additive — they do not replace or modify existing MeasurementGraph types.
 */

// ─── Method ──────────────────────────────────────────────────────────────────

export type MeasurementMethod =
  | 'quick_ai'
  | 'photo_polyline'
  | 'three_d_point_cloud'
  | 'three_d_mesh_fallback'
  | 'manual_entry'

// ─── Field ───────────────────────────────────────────────────────────────────

export type MeasurementField =
  | 'main_beam_left'
  | 'main_beam_right'
  | 'g1_left'
  | 'g1_right'
  | 'g2_left'
  | 'g2_right'
  | 'g3_left'
  | 'g3_right'
  | 'g4_left'
  | 'g4_right'
  | 'h1_left'
  | 'h1_right'
  | 'h2_left'
  | 'h2_right'
  | 'h3_left'
  | 'h3_right'
  | 'h4_left'
  | 'h4_right'
  | 'inside_spread'
  | 'abnormal_points'

// ─── Points ──────────────────────────────────────────────────────────────────

export interface MeasurementPoint2D {
  x: number
  y: number
}

export interface MeasurementPoint3D {
  x: number
  y: number
  z: number
}

// ─── Calibration ─────────────────────────────────────────────────────────────

export type CalibrationSource = 'physical_reference' | 'estimated'

export interface Calibration2D {
  photoId: string
  pixelsPerInch: number
  referenceLengthInches: number
  referenceLine: {
    start: MeasurementPoint2D
    end: MeasurementPoint2D
  }
  source: CalibrationSource
}

export interface Calibration3D {
  unitsPerInch: number
  referenceLengthInches: number
  source: CalibrationSource
}

// ─── Provenance ───────────────────────────────────────────────────────────────

export interface MeasurementProvenance {
  origin: 'ai' | 'human' | 'fused'
  visibility: 'visible' | 'inferred' | 'corrected'
  source: MeasurementMethod
  snappedToPointCloud?: boolean
  pointCloudDensity?: number | null
  calibrationSource?: CalibrationSource | null
}

// ─── Advanced Measurement ────────────────────────────────────────────────────

export interface AdvancedMeasurement {
  id: string
  field: MeasurementField
  method: MeasurementMethod
  photoId?: string
  points2D?: MeasurementPoint2D[]
  points3D?: MeasurementPoint3D[]
  /** Computed length in inches; null if not yet calculable. */
  lengthInches: number | null
  /** 0–1 confidence score. */
  confidence: number
  warnings: string[]
  provenance: MeasurementProvenance
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface AdvancedMeasurementSession {
  sessionId: string
  calibration2D: Calibration2D | null
  calibration3D: Calibration3D | null
  measurements: AdvancedMeasurement[]
  createdAt: string
  updatedAt: string
}

// ─── Cross-validation ─────────────────────────────────────────────────────────

export type CrossValidationTier = 'high' | 'medium' | 'low'

export interface SourceValue {
  method: MeasurementMethod
  value: number
  confidence: number
}

export interface CrossValidationResult {
  field: MeasurementField
  sources: SourceValue[]
  bestValue: number
  agreementPercent: number
  tier: CrossValidationTier
  warning: string | null
}

export interface VerifiedScoreStatus {
  verified: boolean
  reasons: string[]
  fieldStatuses: Array<{
    field: MeasurementField
    verified: boolean
    reason: string
  }>
}

// ─── Point cloud ─────────────────────────────────────────────────────────────

export interface PointCloudPoint {
  x: number
  y: number
  z: number
  color?: { r: number; g: number; b: number }
}
