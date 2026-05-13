/**
 * lib/advanced-scoring/calibration.ts
 *
 * Calibration creation, validation, and quality checks for both 2D and 3D.
 * Physical reference calibration is required for Verified Score status.
 * Estimated calibration is explicitly lower-confidence and cannot be verified.
 */

import type { Calibration2D, Calibration3D, MeasurementPoint2D, CalibrationSource } from './types'
import { distance2D, isFiniteNumber } from './geometry'

// ─── 2D calibration ───────────────────────────────────────────────────────────

export interface CreateCalibration2DResult {
  calibration: Calibration2D | null
  error: string | null
}

export function createCalibration2D(
  photoId: string,
  referenceLine: { start: MeasurementPoint2D; end: MeasurementPoint2D },
  knownLengthInches: number,
  source: CalibrationSource = 'physical_reference',
): CreateCalibration2DResult {
  if (!isFiniteNumber(knownLengthInches) || knownLengthInches <= 0) {
    return { calibration: null, error: 'Known reference length must be a positive number.' }
  }

  const pixelDist = distance2D(referenceLine.start, referenceLine.end)
  if (pixelDist <= 0) {
    return { calibration: null, error: 'Reference line has zero length — click two distinct points.' }
  }

  const pixelsPerInch = pixelDist / knownLengthInches
  if (!isFiniteNumber(pixelsPerInch) || pixelsPerInch <= 0) {
    return { calibration: null, error: 'Could not compute pixels-per-inch from the given inputs.' }
  }

  return {
    calibration: {
      photoId,
      pixelsPerInch,
      referenceLengthInches: knownLengthInches,
      referenceLine,
      source,
    },
    error: null,
  }
}

// ─── 3D calibration ───────────────────────────────────────────────────────────

export interface CreateCalibration3DResult {
  calibration: Calibration3D | null
  error: string | null
}

export function createCalibration3D(
  referenceDistanceUnits: number,
  knownLengthInches: number,
  source: CalibrationSource = 'physical_reference',
): CreateCalibration3DResult {
  if (!isFiniteNumber(knownLengthInches) || knownLengthInches <= 0) {
    return { calibration: null, error: 'Known reference length must be a positive number.' }
  }
  if (!isFiniteNumber(referenceDistanceUnits) || referenceDistanceUnits <= 0) {
    return { calibration: null, error: 'Reference distance in model units must be positive.' }
  }

  const unitsPerInch = referenceDistanceUnits / knownLengthInches
  if (!isFiniteNumber(unitsPerInch) || unitsPerInch <= 0) {
    return { calibration: null, error: 'Could not compute units-per-inch from the given inputs.' }
  }

  return {
    calibration: { unitsPerInch, referenceLengthInches: knownLengthInches, source },
    error: null,
  }
}

// ─── Multi-photo comparison ───────────────────────────────────────────────────

export interface CalibrationComparisonResult {
  consistent: boolean
  maxDeltaPercent: number
  warning: string | null
}

/**
 * Compare pixelsPerInch values across multiple photos.
 * Warns if any two calibrations differ by more than 8%.
 */
export function comparePhotoCalibrations(calibrations: Calibration2D[]): CalibrationComparisonResult {
  const validCalibrations = calibrations.filter(
    (calibration) => isFiniteNumber(calibration.pixelsPerInch) && calibration.pixelsPerInch > 0,
  )

  if (validCalibrations.length < 2) {
    return { consistent: true, maxDeltaPercent: 0, warning: null }
  }

  const ppis = validCalibrations.map(c => c.pixelsPerInch)
  const minPpi = Math.min(...ppis)
  const maxPpi = Math.max(...ppis)
  const maxDeltaPercent = ((maxPpi - minPpi) / minPpi) * 100

  if (maxDeltaPercent > 8) {
    return {
      consistent: false,
      maxDeltaPercent,
      warning: `Photo calibrations differ by ${maxDeltaPercent.toFixed(1)}% — verify reference on each image.`,
    }
  }

  return { consistent: true, maxDeltaPercent, warning: null }
}

// ─── Quality ─────────────────────────────────────────────────────────────────

export interface CalibrationQuality {
  /** 0–1 confidence in the calibration. */
  score: number
  canVerify: boolean
  reason: string
}

export function calibrationQuality(calibration: Calibration2D | Calibration3D): CalibrationQuality {
  if (calibration.source === 'estimated') {
    return {
      score: 0.45,
      canVerify: false,
      reason: 'Estimated calibration — use a physical reference (e.g. known-length object) for Verified Score.',
    }
  }
  // Physical reference
  return {
    score: 0.92,
    canVerify: true,
    reason: 'Physical reference calibration.',
  }
}
