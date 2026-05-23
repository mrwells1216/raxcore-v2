import { describe, it, expect } from 'vitest'
import { validateScoringOutput, hasCriticalViolation } from '@/lib/scoring/scoring-plausibility'
import type { VisionOutput } from '@/lib/scoring/vision-scorer'

function baseMeasurements() {
  return {
    inside_spread: 18,
    main_beam_left: 24,
    main_beam_right: 24,
    g1_left: 4,
    g1_right: 4,
    g2_left: 10,
    g2_right: 10,
    g3_left: 8,
    g3_right: 8,
    g4_left: 5,
    g4_right: 5,
    g5_left: null,
    g5_right: null,
    h1_left: 4.5,
    h1_right: 4.5,
    h2_left: 4.25,
    h2_right: 4.25,
    h3_left: 4,
    h3_right: 4,
    h4_left: 3.75,
    h4_right: 3.75,
    abnormal_points: 0,
    deductions: 3,
  }
}

function baseLandmarks() {
  return {
    ears_visible: true,
    eyes_visible: true,
    antlers_visible: true,
    ear_base_to_tip_estimated: undefined,
    scaling_reference_used: 'eye_box',
    quality_notes: [],
  }
}

function baseReferenceObject() {
  return {
    detected: false,
    type: 'none',
    quality: 0,
    distortion: 0.35,
    notes: [],
  }
}

function makeOutput(overrides: Record<string, unknown> = {}): VisionOutput {
  const m = baseMeasurements()
  const measurements = { ...m, ...((overrides.measurements as object) ?? {}) }
  return {
    measurements,
    landmarks: baseLandmarks(),
    reference_object: baseReferenceObject(),
    gross_score: typeof overrides.gross_score === 'number' ? overrides.gross_score : 165,
    net_score: typeof overrides.net_score === 'number' ? overrides.net_score : 158,
    confidence_percent: typeof overrides.confidence_percent === 'number' ? overrides.confidence_percent : 65,
    main_frame_points: 10,
    rack_type_detected: 'typical',
    angle_quality: {},
    explanation: [],
    anatomical_references_used: [],
  } as unknown as VisionOutput
}

describe('validateScoringOutput', () => {
  describe('beam_exceeds_tines', () => {
    it('passes when beam is longer than every tine on that side', () => {
      const report = validateScoringOutput(makeOutput())
      expect(report.violations.find(v => v.rule === 'beam_exceeds_tines')).toBeUndefined()
    })

    it('flags critical when G2 equals or exceeds the main beam', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g2_left: 25 } }),
      )
      const v = report.violations.find(r => r.rule === 'beam_exceeds_tines')
      expect(v).toBeDefined()
      expect(v?.severity).toBe('critical')
    })
  })

  describe('paired_asymmetry', () => {
    it('passes at 0.34 asymmetry', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g3_left: 10, g3_right: 6.6 } }),
      )
      expect(report.violations.find(v => v.rule === 'paired_asymmetry')).toBeUndefined()
    })

    it('warns at 0.36 asymmetry', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g3_left: 10, g3_right: 6.4 } }),
      )
      const v = report.violations.find(r => r.rule === 'paired_asymmetry')
      expect(v?.severity).toBe('warning')
    })

    it('marks critical at 0.51 asymmetry', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g3_left: 10, g3_right: 4.9 } }),
      )
      const v = report.violations.find(r => r.rule === 'paired_asymmetry')
      expect(v?.severity).toBe('critical')
    })
  })

  describe('spread_present', () => {
    it('warns when G2 exists but inside_spread is zero', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { inside_spread: 0 } }),
      )
      const v = report.violations.find(r => r.rule === 'spread_present')
      expect(v?.severity).toBe('warning')
    })
  })

  describe('deductions_nonneg', () => {
    it('flags critical for negative deductions', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { deductions: -2 } }),
      )
      const v = report.violations.find(r => r.rule === 'deductions_nonneg')
      expect(v?.severity).toBe('critical')
    })
  })

  describe('net_le_gross', () => {
    it('flags critical when net exceeds gross', () => {
      const report = validateScoringOutput(makeOutput({ net_score: 200, gross_score: 165 }))
      const v = report.violations.find(r => r.rule === 'net_le_gross')
      expect(v?.severity).toBe('critical')
    })
  })

  describe('gross_in_range', () => {
    it('flags critical below 40', () => {
      const report = validateScoringOutput(makeOutput({ gross_score: 30 }))
      const v = report.violations.find(r => r.rule === 'gross_in_range')
      expect(v?.severity).toBe('critical')
    })

    it('flags critical above 280', () => {
      const report = validateScoringOutput(makeOutput({ gross_score: 300 }))
      const v = report.violations.find(r => r.rule === 'gross_in_range')
      expect(v?.severity).toBe('critical')
    })
  })

  describe('confidence_in_unit', () => {
    it('flags critical at 9%', () => {
      const report = validateScoringOutput(makeOutput({ confidence_percent: 9 }))
      const v = report.violations.find(r => r.rule === 'confidence_in_unit')
      expect(v?.severity).toBe('critical')
    })

    it('flags critical at 100%', () => {
      const report = validateScoringOutput(makeOutput({ confidence_percent: 100 }))
      const v = report.violations.find(r => r.rule === 'confidence_in_unit')
      expect(v?.severity).toBe('critical')
    })
  })

  describe('g2_ge_g1', () => {
    it('warns when G1 exceeds G2 on a side', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g1_left: 9, g2_left: 6 } }),
      )
      const v = report.violations.find(r => r.rule === 'g2_ge_g1')
      expect(v?.severity).toBe('warning')
    })
  })

  describe('h_tapers_distally', () => {
    it('warns when H3 exceeds H2 on a side', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { h2_left: 4, h3_left: 4.5 } }),
      )
      const v = report.violations.find(r => r.rule === 'h_tapers_distally')
      expect(v?.severity).toBe('warning')
    })
  })

  describe('passed and adjustment aggregation', () => {
    it('returns passed=true when only warnings are present', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { g1_left: 7, g1_right: 7, g2_left: 6, g2_right: 6 } }),
      )
      expect(report.passed).toBe(true)
      expect(report.violations.some(v => v.severity === 'warning')).toBe(true)
      expect(report.violations.some(v => v.severity === 'critical')).toBe(false)
    })

    it('returns passed=false when any critical is present', () => {
      const report = validateScoringOutput(makeOutput({ gross_score: 10 }))
      expect(report.passed).toBe(false)
      expect(hasCriticalViolation(report)).toBe(true)
    })

    it('aggregates adjustments when multiple rules hit the same field', () => {
      const report = validateScoringOutput(
        makeOutput({ measurements: { h2_left: 4, h3_left: 4.5, h4_left: 5 } }),
      )
      expect(report.suggestedConfidenceAdjustments['h3_left']).toBeLessThan(0)
      expect(report.suggestedConfidenceAdjustments['h4_left']).toBeLessThan(0)
    })
  })

  describe('clean output', () => {
    it('produces zero violations for a typical mature buck', () => {
      const report = validateScoringOutput(makeOutput())
      expect(report.violations).toHaveLength(0)
      expect(report.passed).toBe(true)
    })
  })
})
