import { compareMeasurementSources } from '@/lib/advanced-scoring/cross-validation'
import { computeMeasurementConfidence } from '@/lib/advanced-scoring/confidence'
import type {
  AdvancedMeasurement,
  Calibration2D,
  Calibration3D,
  MeasurementField,
  VerifiedScoreStatus,
} from '@/lib/advanced-scoring/types'
import type { ReconstructionAsset, ReconstructionJob } from '@/lib/reconstruction/types'
import type { VerifiedPdfExportData, VerifiedPdfMeasurementRow } from './score-pdf-types'

export interface VerifiedPdfFieldDefinition {
  measurementField: MeasurementField
  label: string
}

export interface BuildVerifiedPdfDataInput {
  buckName?: string | null
  scoringSystem?: VerifiedPdfExportData['scoringSystem']
  rackType?: VerifiedPdfExportData['rackType']
  grossScore: number
  netScore: number
  verifiedStatus: VerifiedScoreStatus
  measurements: AdvancedMeasurement[]
  fieldDefinitions: VerifiedPdfFieldDefinition[]
  calibration2D: Calibration2D | null
  calibration3D: Calibration3D | null
  reconstructionJob?: ReconstructionJob | null
  reconstructionAssets?: ReconstructionAsset[]
  pointCloudPointCount?: number | null
  overallConfidence: number
  photoThumbnails?: string[]
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function bestValueForMethod(measurements: AdvancedMeasurement[], method: AdvancedMeasurement['method']): number | null {
  const values = measurements
    .filter((measurement) => measurement.method === method)
    .map((measurement) => finiteOrNull(measurement.lengthInches))
    .filter((value): value is number => value !== null)

  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildMeasurementRow(
  definition: VerifiedPdfFieldDefinition,
  measurements: AdvancedMeasurement[],
): VerifiedPdfMeasurementRow {
  const fieldMeasurements = measurements.filter((measurement) => measurement.field === definition.measurementField)
  const comparison = compareMeasurementSources(definition.measurementField, fieldMeasurements)
  const confidences = fieldMeasurements.map(computeMeasurementConfidence).filter((value) => Number.isFinite(value))
  const confidence = confidences.length > 0
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0
  const warning = comparison.warning ?? fieldMeasurements.flatMap((measurement) => measurement.warnings)[0] ?? null

  return {
    field: definition.measurementField,
    label: definition.label,
    finalValue: finiteOrNull(comparison.bestValue),
    photoValue: bestValueForMethod(fieldMeasurements, 'photo_polyline'),
    pointCloudValue: bestValueForMethod(fieldMeasurements, 'three_d_point_cloud'),
    meshFallbackValue: bestValueForMethod(fieldMeasurements, 'three_d_mesh_fallback'),
    manualValue: bestValueForMethod(fieldMeasurements, 'manual_entry'),
    confidence: Math.max(0, Math.min(1, confidence)),
    tier: comparison.tier,
    warning,
  }
}

export function buildVerifiedPdfExportData(input: BuildVerifiedPdfDataInput): VerifiedPdfExportData {
  const assets = input.reconstructionAssets ?? input.reconstructionJob?.assets ?? []
  const rows = input.fieldDefinitions.map((definition) => buildMeasurementRow(definition, input.measurements))
  const highCount = rows.filter((row) => row.tier === 'high').length
  const mediumCount = rows.filter((row) => row.tier === 'medium').length
  const lowCount = rows.filter((row) => row.tier === 'low').length
  const fieldFailures = input.verifiedStatus.fieldStatuses
    .filter((status) => !status.verified)
    .slice(0, 12)
    .map((status) => `${status.field}: ${status.reason}`)

  return {
    buckName: input.buckName ?? null,
    scoringSystem: input.scoringSystem ?? 'boone_crockett',
    rackType: input.rackType ?? 'typical',
    grossScore: Number.isFinite(input.grossScore) ? input.grossScore : 0,
    netScore: Number.isFinite(input.netScore) ? input.netScore : 0,
    verified: input.verifiedStatus.verified,
    verificationReasons: input.verifiedStatus.verified
      ? ['All RAX CORE internal verification checks passed.']
      : [...input.verifiedStatus.reasons, ...fieldFailures],
    measurements: rows,
    calibrationSummary: {
      photoCalibrations: input.calibration2D
        ? [{
            photoId: input.calibration2D.photoId,
            pixelsPerInch: input.calibration2D.pixelsPerInch,
            referenceLengthInches: input.calibration2D.referenceLengthInches,
            source: input.calibration2D.source,
          }]
        : [],
      calibration3D: input.calibration3D
        ? {
            unitsPerInch: input.calibration3D.unitsPerInch,
            referenceLengthInches: input.calibration3D.referenceLengthInches,
            source: input.calibration3D.source,
          }
        : null,
    },
    reconstructionSummary: {
      provider: input.reconstructionJob?.provider ?? assets[0]?.provider ?? null,
      hasMesh: assets.some((asset) => asset.type === 'mesh_glb'),
      hasPointCloud: assets.some((asset) =>
        asset.type === 'point_cloud_xyz' || asset.type === 'point_cloud_ply' || asset.type === 'point_cloud_csv'
      ),
      hasSplat: assets.some((asset) => asset.type === 'gaussian_splat'),
      pointCloudPointCount: input.pointCloudPointCount ?? null,
    },
    confidenceSummary: {
      overallConfidence: Math.max(0, Math.min(1, Number.isFinite(input.overallConfidence) ? input.overallConfidence : 0)),
      highCount,
      mediumCount,
      lowCount,
    },
    photoThumbnails: input.photoThumbnails,
    createdAt: new Date().toISOString(),
  }
}
