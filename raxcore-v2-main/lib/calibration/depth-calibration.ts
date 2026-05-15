import 'server-only'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type { DepthExtractionResult, ExifCalibrationData } from './depth-extractor'

export interface DepthCalibrationResult {
  pixelsPerInch: number
  subjectDistanceMeters: number
  focalLengthPx: number
  /** 0..1 */
  confidence: number
  source: 'depth_map_lidar'
  warnings: string[]
}

// Known sensor widths (mm) keyed by model string for when EXIF lacks FocalPlaneXResolution
const SENSOR_WIDTH_MM: Record<string, number> = {
  'iPhone 12 Pro':      5.76,
  'iPhone 12 Pro Max':  5.76,
  'iPhone 13 Pro':      5.76,
  'iPhone 13 Pro Max':  5.76,
  'iPhone 14 Pro':      7.01,
  'iPhone 14 Pro Max':  7.01,
  'iPhone 15 Pro':      7.01,
  'iPhone 15 Pro Max':  9.80,
  'iPhone 16 Pro':      9.80,
  'iPhone 16 Pro Max':  9.80,
  'iPad Pro 11-inch':   5.76,
  'iPad Pro 12.9-inch': 5.76,
}

/**
 * Compute pixelsPerInch from a LiDAR depth map + EXIF focal length.
 *
 * Returns null if calibration is not possible (missing focal length or depth data).
 */
export function computeDepthCalibration(
  depth: DepthExtractionResult,
  exif: ExifCalibrationData,
): DepthCalibrationResult | null {
  const warnings: string[] = []

  // Need focal length in mm
  if (!isFiniteNumber(exif.focalLengthMm) || exif.focalLengthMm <= 0) return null

  // Resolve sensor width
  let sensorWidthMm = exif.sensorWidthMm
  let sensorFromLookup = false

  if (!isFiniteNumber(sensorWidthMm) || sensorWidthMm <= 0) {
    sensorWidthMm = lookupSensorWidth(exif.model)
    if (sensorWidthMm) {
      sensorFromLookup = true
    } else {
      warnings.push('Sensor width unknown — falling back to iPhone 14 Pro default (7.01mm)')
      sensorWidthMm = 7.01
      sensorFromLookup = true
    }
  }

  // focalLengthPx = focalLengthMm × (imageWidthPx / sensorWidthMm)
  const imageWidthPx = depth.imageWidth > 0 ? depth.imageWidth : exif.imageWidthPx
  if (!imageWidthPx || imageWidthPx <= 0) return null

  const focalLengthPx = exif.focalLengthMm * (imageWidthPx / sensorWidthMm)
  if (!isFiniteNumber(focalLengthPx) || focalLengthPx <= 0) return null

  // Sample the center 40% of the depth map to find the antler region distance
  const medianDepth = sampleCenterMedianDepth(depth)
  if (!isFiniteNumber(medianDepth) || medianDepth <= 0) return null

  if (medianDepth < 0.3) {
    warnings.push(`Depth ${medianDepth.toFixed(2)}m is very close — calibration may be unreliable`)
  }
  if (medianDepth > 10) {
    warnings.push(`Depth ${medianDepth.toFixed(1)}m exceeds reliable LiDAR range (>10m)`)
  }

  // pixelsPerInch = focalLengthPx / (distanceMeters × 39.3701)
  const pixelsPerInch = focalLengthPx / (medianDepth * 39.3701)
  if (!isFiniteNumber(pixelsPerInch) || pixelsPerInch <= 0) return null

  // Confidence computation
  let confidence = 0.90

  if (medianDepth > 5) {
    confidence *= 0.85
    warnings.push('Distance > 5m: LiDAR accuracy reduced')
  } else if (medianDepth > 3) {
    confidence *= 0.95
  }

  if (sensorFromLookup) {
    confidence *= 0.90
  }

  if (depth.confidenceMap) {
    const centerConfidenceFraction = computeCenterHighConfidenceFraction(depth)
    if (centerConfidenceFraction < 0.5) {
      confidence *= 0.80
      warnings.push(`Only ${Math.round(centerConfidenceFraction * 100)}% high-confidence LiDAR pixels in center region`)
    }
  }

  confidence = Math.max(0, Math.min(1, confidence))

  return {
    pixelsPerInch,
    subjectDistanceMeters: medianDepth,
    focalLengthPx,
    confidence,
    source: 'depth_map_lidar',
    warnings,
  }
}

function lookupSensorWidth(model: string | null): number | null {
  if (!model) return null
  for (const [key, width] of Object.entries(SENSOR_WIDTH_MM)) {
    if (model.includes(key)) return width
  }
  return null
}

function sampleCenterMedianDepth(depth: DepthExtractionResult): number {
  const { depthMap, depthWidth, depthHeight } = depth

  const xStart = Math.floor(depthWidth * 0.30)
  const xEnd = Math.floor(depthWidth * 0.70)
  const yStart = Math.floor(depthHeight * 0.30)
  const yEnd = Math.floor(depthHeight * 0.70)

  const samples: number[] = []
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const v = depthMap[y * depthWidth + x]
      if (isFiniteNumber(v) && v > 0.1 && v < 20) {
        samples.push(v)
      }
    }
  }

  if (samples.length === 0) return 0

  samples.sort((a, b) => a - b)
  const mid = Math.floor(samples.length / 2)
  return samples.length % 2 === 0
    ? (samples[mid - 1] + samples[mid]) / 2
    : samples[mid]
}

function computeCenterHighConfidenceFraction(depth: DepthExtractionResult): number {
  if (!depth.confidenceMap) return 1

  const { confidenceMap, depthWidth, depthHeight } = depth
  const xStart = Math.floor(depthWidth * 0.30)
  const xEnd = Math.floor(depthWidth * 0.70)
  const yStart = Math.floor(depthHeight * 0.30)
  const yEnd = Math.floor(depthHeight * 0.70)

  let total = 0
  let highConf = 0
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      total++
      if (confidenceMap[y * depthWidth + x] >= 3) highConf++
    }
  }

  return total > 0 ? highConf / total : 1
}
