import type { CrossValidationTier } from '@/lib/advanced-scoring/types'
import type { ReconstructionProvider } from '@/lib/reconstruction/types'

export interface VerifiedPdfMeasurementRow {
  field: string
  label: string
  finalValue: number | null
  photoValue?: number | null
  pointCloudValue?: number | null
  meshFallbackValue?: number | null
  manualValue?: number | null
  confidence: number
  tier: CrossValidationTier
  warning?: string | null
  /** Provenance of the measurement source. */
  source?: 'ai' | 'heuristic' | 'human'
  meshCircumferenceValue?: number
}

export interface VerifiedPdfExportData {
  buckName?: string | null
  scoringSystem: 'boone_crockett' | 'pope_young'
  rackType: 'typical' | 'non_typical'
  grossScore: number
  netScore: number
  verified: boolean
  verificationReasons: string[]
  measurements: VerifiedPdfMeasurementRow[]
  calibrationSummary: {
    photoCalibrations: Array<{
      photoId: string
      pixelsPerInch: number
      referenceLengthInches: number
      source: 'physical_reference' | 'estimated'
    }>
    calibration3D?: {
      unitsPerInch: number
      referenceLengthInches: number
      source: 'physical_reference' | 'estimated'
    } | null
  }
  reconstructionSummary: {
    provider: ReconstructionProvider | null
    hasMesh: boolean
    hasPointCloud: boolean
    hasSplat: boolean
    pointCloudPointCount?: number | null
  }
  confidenceSummary: {
    overallConfidence: number
    highCount: number
    mediumCount: number
    lowCount: number
  }
  photoThumbnails?: string[]
  createdAt: string
}
