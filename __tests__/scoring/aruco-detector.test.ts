import { describe, it, expect } from 'vitest'
import {
  resolveCalibration,
  type ArucoResolverInput,
} from '@/lib/scoring/calibration-resolver'
import type { ArucoDetection } from '@/lib/scoring/aruco-types'
import { ARUCO_DETECTION_SYSTEM_PROMPT } from '@/lib/calibration/aruco-detector'

function det(
  imageIndex: number,
  avgSidePx: number,
  cosTilt = 1.0,
  confidence = 0.8,
): ArucoDetection {
  return {
    markerId: 23,
    corners: [
      { x: 0, y: 0 },
      { x: avgSidePx, y: 0 },
      { x: avgSidePx, y: avgSidePx },
      { x: 0, y: avgSidePx },
    ],
    avgSidePx,
    cosTilt,
    imageUrl: `https://example.test/${imageIndex}.jpg`,
    imageIndex,
    confidence,
    warnings: [],
  }
}

function input(detections: ArucoDetection[], knownSideInches = 2.0): ArucoResolverInput {
  return { detections, knownSideInches }
}

describe('resolveCalibration — ArUco', () => {
  it('returns null when knownSideInches is non-positive', () => {
    expect(resolveCalibration([], null, null, undefined, null, input([det(0, 100)], 0))).toBeNull()
    expect(resolveCalibration([], null, null, undefined, null, input([det(0, 100)], -1))).toBeNull()
  })

  it('returns null when no detections', () => {
    expect(resolveCalibration([], null, null, undefined, null, input([], 2.0))).toBeNull()
  })

  it('computes pixelsPerInch as avgSidePx / knownSideInches', () => {
    // 100 px / 2.0" = 50 px/in
    const r = resolveCalibration([], null, null, undefined, null, input([det(0, 100)], 2.0))
    expect(r).not.toBeNull()
    expect(r!.source).toBe('aruco_marker')
    expect(r!.pixelsPerInch).toBe(50)
  })

  it('hits the 0.72 ceiling for an orthogonal marker (cos θ = 1.0)', () => {
    const r = resolveCalibration([], null, null, undefined, null, input([det(0, 100, 1.0)], 2.0))
    expect(r!.confidence).toBeCloseTo(0.72, 2)
  })

  it('floors at 0.55 for a severely skewed marker (cos θ <= 0.5)', () => {
    const r = resolveCalibration([], null, null, undefined, null, input([det(0, 100, 0.4)], 2.0))
    expect(r!.confidence).toBeCloseTo(0.55, 2)
  })

  it('lerps confidence linearly between cosTilt 0.5 and 1.0', () => {
    const mid = resolveCalibration([], null, null, undefined, null, input([det(0, 100, 0.75)], 2.0))
    // halfway between 0.55 and 0.72 = 0.635
    expect(mid!.confidence).toBeCloseTo(0.635, 2)
  })

  it('uses the WORST cosTilt across multiple detections', () => {
    const r = resolveCalibration([], null, null, undefined, null, input([
      det(0, 100, 1.0),
      det(1, 100, 0.6),
    ], 2.0))
    // worst cos = 0.6 → confidence = 0.55 + 0.1 * 0.34 = 0.584
    expect(r!.confidence).toBeCloseTo(0.584, 2)
  })

  it('rejects PPI outliers across multiple detections via median ± 25%', () => {
    const r = resolveCalibration([], null, null, undefined, null, input([
      det(0, 100, 1.0), // 50 px/in
      det(1, 102, 1.0), // 51 px/in
      det(2, 300, 1.0), // 150 px/in — outlier
    ], 2.0))
    expect(r).not.toBeNull()
    expect(r!.warnings.join(' ')).toMatch(/Rejected 1 ArUco outlier/)
    expect(r!.pixelsPerInch).toBeGreaterThan(45)
    expect(r!.pixelsPerInch).toBeLessThan(55)
  })

  it('clamps knownSideInches to a 0.5-12.0" sanity band', () => {
    // 100 px / clamped(15) → clamped to 12" → 100/12 ≈ 8.33 px/in
    const r = resolveCalibration([], null, null, undefined, null, input([det(0, 100)], 15))
    expect(r!.pixelsPerInch).toBeCloseTo(100 / 12, 2)
  })

  it('skips detections with zero or NaN avgSidePx', () => {
    const r = resolveCalibration([], null, null, undefined, null, input([
      det(0, 0),
      det(1, NaN),
      det(2, 100),
    ], 2.0))
    expect(r).not.toBeNull()
    expect(r!.pixelsPerInch).toBe(50)
  })
})

describe('ARUCO_DETECTION_SYSTEM_PROMPT', () => {
  it('declares the surgical-precision style version and required sections', () => {
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toContain('surgical-precision-v1')
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toContain('ROLE')
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toContain('OUTPUT CONTRACT')
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toContain('SELF-CHECK')
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toContain('REFUSE')
  })

  it('explicitly forbids inventing corner coordinates', () => {
    expect(ARUCO_DETECTION_SYSTEM_PROMPT).toMatch(/Do not invent corner coordinates|never invent/i)
  })
})
