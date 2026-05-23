import { describe, it, expect } from 'vitest'
import { eyeCircleToPixelsPerInch } from '@/lib/scoring/landmark-geometry'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'
import type { PerImageLandmarkResult } from '@/lib/scoring/landmark-detection'

function img(
  imageIndex: number,
  angleType: PerImageLandmarkResult['angleType'],
  leftRadiusPx: number | null,
  rightRadiusPx: number | null,
): PerImageLandmarkResult {
  return {
    imageIndex,
    imageUrl: `https://example.test/${imageIndex}.jpg`,
    angleType,
    landmarks: [],
    imageWidth: 1024,
    imageHeight: 768,
    modelUsed: 'gpt-4o',
    detectionTimestamp: '2026-05-23T00:00:00.000Z',
    locatedCount: 0,
    requestedCount: 44,
    eyeCircles: (leftRadiusPx == null && rightRadiusPx == null)
      ? undefined
      : { leftRadiusPx, rightRadiusPx },
  }
}

describe('eyeCircleToPixelsPerInch', () => {
  it('returns null when no images report eye circles', () => {
    expect(eyeCircleToPixelsPerInch([])).toBeNull()
    expect(eyeCircleToPixelsPerInch([img(0, 'front', null, null)])).toBeNull()
  })

  it('skips failed images', () => {
    const failed: PerImageLandmarkResult = {
      ...img(0, 'front', 22, 22),
      failed: true,
      failureReason: 'OPENAI_API_KEY missing',
    }
    expect(eyeCircleToPixelsPerInch([failed])).toBeNull()
  })

  it('single front-view eye returns ~front confidence band', () => {
    const r = eyeCircleToPixelsPerInch([img(0, 'front', 22, null)])
    expect(r).not.toBeNull()
    // 22 px / 0.55" = 40 px/in
    expect(r!.pixelsPerInch).toBeCloseTo(22 / ANATOMICAL_REFERENCES.IRIS_RADIUS, 5)
    expect(r!.confidence).toBeGreaterThan(0.55)
    expect(r!.confidence).toBeLessThanOrEqual(0.65)
    expect(r!.contributingObservations).toBe(1)
    expect(r!.warnings).toContain('Single iris observation — no cross-check')
  })

  it('both eyes agreeing on a front-view image reaches the 0.72 ceiling', () => {
    const r = eyeCircleToPixelsPerInch([img(0, 'front', 22.0, 21.8)])
    expect(r).not.toBeNull()
    expect(r!.confidence).toBeGreaterThanOrEqual(0.72)
    expect(r!.contributingObservations).toBe(2)
  })

  it('side-view single eye is capped at 0.50', () => {
    const r = eyeCircleToPixelsPerInch([img(0, 'left', 20, null)])
    expect(r).not.toBeNull()
    expect(r!.confidence).toBeLessThanOrEqual(0.50)
  })

  it('rejects outliers beyond 25% of the median', () => {
    const r = eyeCircleToPixelsPerInch([
      img(0, 'front', 22, 22),
      img(1, 'front', 21.5, 22.5),
      img(2, 'front', 60, null), // clear outlier
    ])
    expect(r).not.toBeNull()
    expect(r!.warnings.join(' ')).toMatch(/Rejected \d+ iris outlier/)
    // Fused PPI should be near 40 (22/0.55), not pulled up by the 60-px outlier.
    expect(r!.pixelsPerInch).toBeLessThan(50)
    expect(r!.pixelsPerInch).toBeGreaterThan(35)
  })

  it('tight agreement (<8% spread) boosts confidence by ~+0.04', () => {
    const tight = eyeCircleToPixelsPerInch([
      img(0, 'front', 22.0, 22.0),
      img(1, 'front', 22.1, 21.9),
    ])
    const loose = eyeCircleToPixelsPerInch([
      img(0, 'front', 22.0, 22.0),
      img(1, 'front', 23.5, 20.5),
    ])
    expect(tight).not.toBeNull()
    expect(loose).not.toBeNull()
    expect(tight!.confidence).toBeGreaterThan(loose!.confidence)
  })

  it('treats null/zero/negative radii as missing without crashing', () => {
    const r = eyeCircleToPixelsPerInch([
      img(0, 'front', 22, 0),
      img(1, 'front', null, -5),
      img(2, 'unknown', 21, null),
    ])
    expect(r).not.toBeNull()
    // Only two valid observations (22 px and 21 px) survive.
    expect(r!.contributingObservations).toBe(2)
  })

  it('falls back to highest-weight reading when survivors are empty', () => {
    // Two readings, each so far apart that the ±25% gate drops both.
    const r = eyeCircleToPixelsPerInch([
      img(0, 'front', 10, null),
      img(1, 'front', 60, null),
    ])
    expect(r).not.toBeNull()
    expect(r!.confidence).toBeLessThanOrEqual(0.50)
    expect(r!.warnings.join(' ')).toMatch(/disagreed/)
  })
})
