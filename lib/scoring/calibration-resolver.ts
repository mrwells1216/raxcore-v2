import 'server-only'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { LandmarkDetection } from './landmark-detection'
import type { DepthCalibrationResult } from '@/lib/calibration/depth-calibration'
// Use the canonical anatomical constants from lib/constants.ts. Keeping a local
// copy here drifted out of sync with the per-image consensus engine and produced
// different px/in values from the same pixel measurement (eye-to-eye was 4.3"
// in the consensus engine but 3.5" here).
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

export interface CalibrationResult {
  pixelsPerInch: number
  source: 'depth_map_lidar' | 'reference_object' | 'anatomical_prior'
  confidence: number
  method: string
  warnings: string[]
}

export interface ReferenceObjectInput {
  type: 'ring' | 'hat' | 'ruler' | 'none'
  knownSizeInches: number | null
  pixelSize: number | null
}

/**
 * Resolve the best available pixelsPerInch calibration.
 *
 * Priority:
 *   1. LiDAR depth map + EXIF (highest)
 *   2. Reference object (ring, hat, ruler)
 *   3. Anatomical priors (eye spacing, pedicle spacing)
 */
export function resolveCalibration(
  landmarks: LandmarkDetection[],
  depthCalibration: DepthCalibrationResult | null,
  referenceObject: ReferenceObjectInput | null,
): CalibrationResult | null {
  // Priority 1: LiDAR depth calibration
  if (
    depthCalibration &&
    isFiniteNumber(depthCalibration.pixelsPerInch) &&
    depthCalibration.pixelsPerInch > 0 &&
    depthCalibration.confidence > 0.4
  ) {
    return {
      pixelsPerInch: depthCalibration.pixelsPerInch,
      source: 'depth_map_lidar',
      confidence: depthCalibration.confidence,
      method: `LiDAR depth at ${depthCalibration.subjectDistanceMeters.toFixed(2)}m`,
      warnings: depthCalibration.warnings,
    }
  }

  // Priority 2: Reference object
  if (
    referenceObject &&
    referenceObject.type !== 'none' &&
    isFiniteNumber(referenceObject.knownSizeInches) &&
    referenceObject.knownSizeInches > 0 &&
    isFiniteNumber(referenceObject.pixelSize) &&
    referenceObject.pixelSize > 0
  ) {
    const pixelsPerInch = referenceObject.pixelSize / referenceObject.knownSizeInches
    const confidence = referenceObject.type === 'ruler' ? 0.75
      : referenceObject.type === 'ring' ? 0.45
      : 0.40

    return {
      pixelsPerInch,
      source: 'reference_object',
      confidence,
      method: `${referenceObject.type} reference (${referenceObject.knownSizeInches}" known)`,
      warnings: [],
    }
  }

  // Priority 3: Anatomical priors from landmarks
  return resolveAnatomicalPrior(landmarks)
}

function resolveAnatomicalPrior(landmarks: LandmarkDetection[]): CalibrationResult | null {
  const byId = new Map(landmarks.map((lm) => [lm.id, lm]))
  const estimates: { ppi: number; confidence: number; label: string }[] = []

  // Eye spacing
  const eyeL = byId.get('eye_left')
  const eyeR = byId.get('eye_right')
  if (
    eyeL && eyeR &&
    eyeL.px != null && eyeL.py != null &&
    eyeR.px != null && eyeR.py != null &&
    eyeL.confidence > 0.5 && eyeR.confidence > 0.5
  ) {
    const dx = eyeR.px - eyeL.px
    const dy = eyeR.py - eyeL.py
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 10) {
      const ppi = pixelDist / ANATOMICAL_REFERENCES.EYE_TO_EYE
      estimates.push({ ppi, confidence: Math.min(eyeL.confidence, eyeR.confidence) * 0.65, label: 'eye spacing' })
    }
  }

  // Pedicle spacing
  const pedL = byId.get('pedicle_left')
  const pedR = byId.get('pedicle_right')
  if (
    pedL && pedR &&
    pedL.px != null && pedL.py != null &&
    pedR.px != null && pedR.py != null &&
    pedL.confidence > 0.5 && pedR.confidence > 0.5
  ) {
    const dx = pedR.px - pedL.px
    const dy = pedR.py - pedL.py
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 10) {
      const ppi = pixelDist / ANATOMICAL_REFERENCES.PEDICLE_SPACING
      estimates.push({ ppi, confidence: Math.min(pedL.confidence, pedR.confidence) * 0.60, label: 'pedicle spacing' })
    }
  }

  if (estimates.length === 0) return null

  const warnings: string[] = []

  // Single estimate: nothing to cross-check against, return as-is with a penalty
  // so the caller knows we couldn't corroborate.
  if (estimates.length === 1) {
    return {
      pixelsPerInch: estimates[0].ppi,
      source: 'anatomical_prior',
      confidence: estimates[0].confidence * 0.85,
      method: `anatomical prior (${estimates[0].label}, unconfirmed)`,
      warnings: ['Single anatomical reference — no corroboration available'],
    }
  }

  // Median + relative-deviation outlier rejection. Mean is poisoned by one bad
  // reading; median tolerates a single outlier when we have 3+ estimates.
  const sortedPpi = [...estimates].map(e => e.ppi).sort((a, b) => a - b)
  const med = sortedPpi.length % 2 === 0
    ? (sortedPpi[sortedPpi.length / 2 - 1] + sortedPpi[sortedPpi.length / 2]) / 2
    : sortedPpi[Math.floor(sortedPpi.length / 2)]

  const survivors = estimates.filter(e => {
    const relDeviation = med > 0 ? Math.abs(e.ppi - med) / med : 0
    return relDeviation <= 0.25  // tolerate up to ±25% from the median
  })

  // If everyone got rejected (degenerate case), fall back to highest confidence
  if (survivors.length === 0) {
    estimates.sort((x, y) => y.confidence - x.confidence)
    warnings.push(`All anatomical estimates deviated >25% from median — using highest confidence (${estimates[0].label})`)
    return {
      pixelsPerInch: estimates[0].ppi,
      source: 'anatomical_prior',
      confidence: estimates[0].confidence * 0.6,
      method: `anatomical prior (${estimates[0].label}, fallback)`,
      warnings,
    }
  }

  // Flag any rejected outliers so the UI can surface them
  const rejected = estimates.filter(e => !survivors.includes(e))
  if (rejected.length > 0) {
    const pct = rejected
      .map(e => `${e.label} ${Math.round(((e.ppi - med) / med) * 100)}%`)
      .join(', ')
    warnings.push(`Rejected anatomical outliers vs median: ${pct}`)
  }

  // Weighted average over survivors (weight = confidence)
  const totalWeight = survivors.reduce((s, e) => s + e.confidence, 0)
  const avgPpi = totalWeight > 0
    ? survivors.reduce((s, e) => s + e.ppi * e.confidence, 0) / totalWeight
    : survivors.reduce((s, e) => s + e.ppi, 0) / survivors.length
  const avgConf = totalWeight / survivors.length

  // Reward agreement: if survivors are tight (<10% spread), boost confidence
  const survivorPpis = survivors.map(e => e.ppi)
  const survivorMax = Math.max(...survivorPpis)
  const survivorMin = Math.min(...survivorPpis)
  const relSpread = survivorMax > 0 ? (survivorMax - survivorMin) / survivorMax : 0
  const agreementBoost = survivors.length >= 2 && relSpread < 0.10 ? 1.10 : 1.0

  const labels = survivors.map((e) => e.label).join(' + ')

  return {
    pixelsPerInch: avgPpi,
    source: 'anatomical_prior',
    confidence: Math.min(0.95, avgConf * agreementBoost),
    method: `anatomical prior (${labels})`,
    warnings,
  }
}
