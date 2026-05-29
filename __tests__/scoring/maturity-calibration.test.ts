import { describe, it, expect } from 'vitest'
import { resolveCalibration } from '@/lib/scoring/calibration-resolver'
import { maturityFacialScale, MATURITY_FACIAL_SCALE } from '@/lib/constants'
import type { LandmarkDetection } from '@/lib/scoring/landmark-detection'

function eyeLandmarks(): LandmarkDetection[] {
  const base = {
    confidence: 0.9,
    visibility: 'clear' as const,
    sourceAngle: 'front' as const,
    source: 'ai' as const,
  }
  return [
    { id: 'eye_left', px: 100, py: 100, ...base },
    { id: 'eye_right', px: 200, py: 100, ...base },
  ]
}

describe('maturityFacialScale', () => {
  it('returns 1.0 for adult / unknown / absent', () => {
    expect(maturityFacialScale('mature_3plus')).toBe(1.0)
    expect(maturityFacialScale('unknown')).toBe(1.0)
    expect(maturityFacialScale(null)).toBe(1.0)
    expect(maturityFacialScale(undefined)).toBe(1.0)
  })

  it('scales younger classes below 1.0, monotonically', () => {
    expect(MATURITY_FACIAL_SCALE.yearling).toBeLessThan(MATURITY_FACIAL_SCALE.mature_2)
    expect(MATURITY_FACIAL_SCALE.mature_2).toBeLessThan(MATURITY_FACIAL_SCALE.mature_3plus)
    expect(MATURITY_FACIAL_SCALE.mature_3plus).toBe(1.0)
  })
})

describe('maturity-aware anatomical calibration', () => {
  const landmarks = eyeLandmarks()

  it('is identical to adult when maturity is absent/unknown', () => {
    const adult = resolveCalibration(landmarks, null, null, [], null, null, 'mature_3plus')
    const noHint = resolveCalibration(landmarks, null, null, [], null, null)
    const unknown = resolveCalibration(landmarks, null, null, [], null, null, 'unknown')
    expect(adult?.pixelsPerInch).toBeCloseTo(noHint?.pixelsPerInch ?? 0, 6)
    expect(unknown?.pixelsPerInch).toBeCloseTo(noHint?.pixelsPerInch ?? 0, 6)
  })

  it('yields a higher pixels-per-inch for a yearling (smaller real reference)', () => {
    const adult = resolveCalibration(landmarks, null, null, [], null, null, 'mature_3plus')
    const yearling = resolveCalibration(landmarks, null, null, [], null, null, 'yearling')
    expect(yearling).not.toBeNull()
    expect(adult).not.toBeNull()
    // ppi = pixelDist / (refInches * scale); smaller scale ⇒ larger ppi.
    expect(yearling!.pixelsPerInch).toBeGreaterThan(adult!.pixelsPerInch)
    expect(yearling!.pixelsPerInch).toBeCloseTo(
      adult!.pixelsPerInch / MATURITY_FACIAL_SCALE.yearling,
      4
    )
  })

  it('still resolves to the anatomical_prior source (never unlocks Verified)', () => {
    const yearling = resolveCalibration(landmarks, null, null, [], null, null, 'yearling')
    expect(yearling?.source).toBe('anatomical_prior')
  })

  it('does not affect a physical reference object (only no-reference priors)', () => {
    const ref = resolveCalibration(
      landmarks,
      null,
      { type: 'ruler', knownSizeInches: 12, pixelSize: 240 },
      [],
      null,
      null,
      'yearling'
    )
    // Reference object wins and is unscaled: 240 / 12 = 20 ppi.
    expect(ref?.source).toBe('reference_object')
    expect(ref?.pixelsPerInch).toBeCloseTo(20, 6)
  })
})
