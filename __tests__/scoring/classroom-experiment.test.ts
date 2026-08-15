import { describe, it, expect } from 'vitest'
import {
  parseExperimentConfig,
  isFeatureEnabled,
  resolveFeaturesUsed,
  toAiServiceFlags,
  toCalibrationOverride,
  EXPERIMENT_FEATURE_KEYS,
} from '@/lib/scoring/experiment-config'
import {
  applyCalibration,
  DEFAULT_GLOBAL_GROSS_BIAS,
  type CalibrationProfile,
} from '@/lib/calibration'

describe('parseExperimentConfig', () => {
  it('returns null for absent / empty / invalid input', () => {
    expect(parseExperimentConfig(null)).toBeNull()
    expect(parseExperimentConfig('')).toBeNull()
    expect(parseExperimentConfig('not json')).toBeNull()
    expect(parseExperimentConfig('{}')).toBeNull()
  })

  it('keeps only known feature keys and boolean values', () => {
    const cfg = parseExperimentConfig(
      JSON.stringify({ features: { landmarks: false, bogus: true, secondPass: 'no' } }),
    )
    expect(cfg?.features).toEqual({ landmarks: false })
  })

  it('clamps numeric variables to sane bands and length-limits the prompt', () => {
    const cfg = parseExperimentConfig(
      JSON.stringify({
        variables: {
          grossBias: 999,
          grossMultiplier: 5,
          confidenceMultiplier: 0.1,
          customPrompt: 'x'.repeat(5000),
        },
      }),
    )
    expect(cfg?.variables?.grossBias).toBe(50)
    expect(cfg?.variables?.grossMultiplier).toBe(1.5)
    expect(cfg?.variables?.confidenceMultiplier).toBe(0.5)
    expect(cfg?.variables?.customPrompt?.length).toBe(2000)
  })
})

describe('isFeatureEnabled / resolveFeaturesUsed', () => {
  it('treats features as ON unless explicitly false', () => {
    expect(isFeatureEnabled(null, 'landmarks')).toBe(true)
    expect(isFeatureEnabled({ features: { landmarks: false } }, 'landmarks')).toBe(false)
    expect(isFeatureEnabled({ features: { landmarks: true } }, 'landmarks')).toBe(true)
  })

  it('resolves a full on/off map for every feature key', () => {
    const map = resolveFeaturesUsed({ features: { landmarks: false } })
    expect(Object.keys(map).sort()).toEqual([...EXPERIMENT_FEATURE_KEYS].sort())
    expect(map.landmarks).toBe(false)
    expect(map.plausibilityValidator).toBe(true)
  })
})

describe('toAiServiceFlags', () => {
  it('returns undefined when no config (production default)', () => {
    expect(toAiServiceFlags(null)).toBeUndefined()
  })
  it('maps feature flags + custom prompt', () => {
    const flags = toAiServiceFlags({
      features: { secondPass: false },
      variables: { customPrompt: 'hi' },
    })
    expect(flags).toEqual({
      promptBiasCorrection: true,
      plausibilityValidator: true,
      secondPass: false,
      customPrompt: 'hi',
    })
  })
})

describe('toCalibrationOverride', () => {
  it('is null without config', () => {
    expect(toCalibrationOverride(null)).toBeNull()
  })
  it('returns an identity override when calibration is disabled', () => {
    const o = toCalibrationOverride({ features: { calibrationProfile: false } })
    expect(o).toEqual({
      grossBias: 0,
      netBias: 0,
      grossMultiplier: 1,
      netMultiplier: 1,
      confidenceMultiplier: 1,
    })
  })
  it('passes through user variable overrides when calibration is on', () => {
    expect(toCalibrationOverride({ variables: { grossBias: 3 } })).toEqual({ grossBias: 3 })
    expect(toCalibrationOverride({ variables: {} })).toBeNull()
  })
})

describe('applyCalibration', () => {
  const profile: CalibrationProfile = {
    profile_key: 'global',
    profile_type: 'global',
    sample_count: 30,
    gross_bias: 2,
    net_bias: 1,
    gross_mae: 5,
    net_mae: 4,
    confidence_multiplier: 1,
  }

  it('passes the score through untouched when no profile exists', () => {
    // The seeded global default is held at 0 — a flat offset guessed from a
    // couple of photos was making every score worse. With no learned profile
    // the raw estimate must survive unchanged, and calibrationApplied must
    // report false because nothing actually was applied.
    expect(DEFAULT_GLOBAL_GROSS_BIAS).toBe(0)
    const r = applyCalibration({ rawGross: 160, rawNet: 155, rawConfidence: 65, profile: null })
    expect(r.calibratedGross).toBe(160)
    expect(r.calibratedNet).toBe(155)
    expect(r.calibrationMeta.source).toBe('default')
    expect(r.calibrationApplied).toBe(false)
  })

  it('uses the learned profile bias when present', () => {
    const r = applyCalibration({ rawGross: 160, rawNet: 155, rawConfidence: 65, profile })
    expect(r.calibratedGross).toBe(162)
    expect(r.calibrationMeta.source).toBe('profile')
  })

  it('lets an override supersede the profile and the default', () => {
    const r = applyCalibration({
      rawGross: 160,
      rawNet: 155,
      rawConfidence: 65,
      profile,
      override: { grossBias: 10 },
    })
    expect(r.calibratedGross).toBe(170)
    expect(r.calibrationMeta.source).toBe('override')
  })

  it('an identity override yields raw scores (calibration off)', () => {
    const r = applyCalibration({
      rawGross: 160,
      rawNet: 155,
      rawConfidence: 65,
      profile: null,
      override: { grossBias: 0, netBias: 0, grossMultiplier: 1, netMultiplier: 1, confidenceMultiplier: 1 },
    })
    expect(r.calibratedGross).toBe(160)
    expect(r.calibratedNet).toBe(155)
    expect(r.calibrationApplied).toBe(false)
  })

  it('supports a multiplicative override', () => {
    const r = applyCalibration({
      rawGross: 100,
      rawNet: 100,
      rawConfidence: 50,
      profile: null,
      override: { grossBias: 0, grossMultiplier: 1.05 },
    })
    expect(r.calibratedGross).toBe(105)
  })

  it('passes nulls through untouched', () => {
    const r = applyCalibration({ rawGross: null, rawNet: null, rawConfidence: null, profile: null })
    expect(r.calibratedGross).toBeNull()
    expect(r.calibratedNet).toBeNull()
  })
})
