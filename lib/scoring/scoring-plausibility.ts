import 'server-only'
import type { VisionOutput } from './vision-scorer'

export type PlausibilitySeverity = 'critical' | 'warning'

export type PlausibilityRuleId =
  | 'beam_exceeds_tines'
  | 'paired_asymmetry'
  | 'spread_present'
  | 'deductions_nonneg'
  | 'net_le_gross'
  | 'gross_in_range'
  | 'confidence_in_unit'
  | 'g2_ge_g1'
  | 'h_tapers_distally'

export interface PlausibilityViolation {
  rule: PlausibilityRuleId
  severity: PlausibilitySeverity
  fieldKey?: string
  message: string
}

export interface PlausibilityReport {
  passed: boolean
  violations: PlausibilityViolation[]
  suggestedConfidenceAdjustments: Record<string, number>
}

const GROSS_MIN = 40
const GROSS_MAX = 280
const ASYMMETRY_WARN = 0.35
const ASYMMETRY_CRIT = 0.50
const CONFIDENCE_PCT_MIN = 10
const CONFIDENCE_PCT_MAX = 95

const PAIRED_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['main_beam_left', 'main_beam_right'],
  ['g1_left', 'g1_right'],
  ['g2_left', 'g2_right'],
  ['g3_left', 'g3_right'],
  ['g4_left', 'g4_right'],
  ['h1_left', 'h1_right'],
  ['h2_left', 'h2_right'],
  ['h3_left', 'h3_right'],
  ['h4_left', 'h4_right'],
]

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function applyAdjustment(
  adjustments: Record<string, number>,
  field: string,
  delta: number,
): void {
  adjustments[field] = (adjustments[field] ?? 0) + delta
}

export function validateScoringOutput(output: VisionOutput): PlausibilityReport {
  const violations: PlausibilityViolation[] = []
  const adjustments: Record<string, number> = {}
  const m = output.measurements

  for (const side of ['left', 'right'] as const) {
    const beamKey = `main_beam_${side}` as const
    const beam = m[beamKey]
    const tines = [
      m[`g1_${side}` as const],
      m[`g2_${side}` as const],
      m[`g3_${side}` as const],
      m[`g4_${side}` as const],
    ].filter(isPositiveNumber)
    if (isPositiveNumber(beam) && tines.length > 0) {
      const maxTine = Math.max(...tines)
      if (maxTine >= beam) {
        violations.push({
          rule: 'beam_exceeds_tines',
          severity: 'critical',
          fieldKey: beamKey,
          message: `${beamKey} (${beam}") is not greater than the longest ${side} tine (${maxTine}").`,
        })
        applyAdjustment(adjustments, beamKey, -0.20)
        applyAdjustment(adjustments, `g1_${side}`, -0.20)
        applyAdjustment(adjustments, `g2_${side}`, -0.20)
        applyAdjustment(adjustments, `g3_${side}`, -0.20)
        applyAdjustment(adjustments, `g4_${side}`, -0.20)
      }
    }
  }

  for (const [leftKey, rightKey] of PAIRED_FIELDS) {
    const left = (m as Record<string, number | null | undefined>)[leftKey]
    const right = (m as Record<string, number | null | undefined>)[rightKey]
    if (!isPositiveNumber(left) || !isPositiveNumber(right)) continue
    const denominator = Math.max(left, right)
    if (denominator <= 0) continue
    const asymmetry = Math.abs(left - right) / denominator
    if (asymmetry > ASYMMETRY_CRIT) {
      violations.push({
        rule: 'paired_asymmetry',
        severity: 'critical',
        fieldKey: leftKey,
        message: `${leftKey}/${rightKey} differ by ${(asymmetry * 100).toFixed(0)}% (${left}" vs ${right}").`,
      })
      applyAdjustment(adjustments, leftKey, -0.25)
      applyAdjustment(adjustments, rightKey, -0.25)
    } else if (asymmetry > ASYMMETRY_WARN) {
      violations.push({
        rule: 'paired_asymmetry',
        severity: 'warning',
        fieldKey: leftKey,
        message: `${leftKey}/${rightKey} differ by ${(asymmetry * 100).toFixed(0)}% (${left}" vs ${right}").`,
      })
      applyAdjustment(adjustments, leftKey, -0.10)
      applyAdjustment(adjustments, rightKey, -0.10)
    }
  }

  const hasG2 = isPositiveNumber(m.g2_left) || isPositiveNumber(m.g2_right)
  if (hasG2 && !isPositiveNumber(m.inside_spread)) {
    violations.push({
      rule: 'spread_present',
      severity: 'warning',
      fieldKey: 'inside_spread',
      message: `G2 is measurable but inside_spread is zero or missing.`,
    })
    applyAdjustment(adjustments, 'inside_spread', -0.10)
  }

  if (typeof m.deductions === 'number' && m.deductions < 0) {
    violations.push({
      rule: 'deductions_nonneg',
      severity: 'critical',
      fieldKey: 'deductions',
      message: `Deductions (${m.deductions}) must be >= 0.`,
    })
    applyAdjustment(adjustments, 'deductions', -0.30)
  }

  if (output.net_score > output.gross_score) {
    violations.push({
      rule: 'net_le_gross',
      severity: 'critical',
      message: `net_score (${output.net_score}) exceeds gross_score (${output.gross_score}).`,
    })
  }

  if (output.gross_score < GROSS_MIN || output.gross_score > GROSS_MAX) {
    violations.push({
      rule: 'gross_in_range',
      severity: 'critical',
      message: `gross_score (${output.gross_score}) is outside the plausible whitetail range [${GROSS_MIN}, ${GROSS_MAX}].`,
    })
    applyAdjustment(adjustments, 'gross_score', -0.30)
  }

  if (
    output.confidence_percent < CONFIDENCE_PCT_MIN ||
    output.confidence_percent > CONFIDENCE_PCT_MAX
  ) {
    violations.push({
      rule: 'confidence_in_unit',
      severity: 'critical',
      message: `confidence_percent (${output.confidence_percent}) is outside [${CONFIDENCE_PCT_MIN}, ${CONFIDENCE_PCT_MAX}].`,
    })
  }

  for (const side of ['left', 'right'] as const) {
    const g1 = m[`g1_${side}` as const]
    const g2 = m[`g2_${side}` as const]
    if (isPositiveNumber(g1) && isPositiveNumber(g2) && g1 > g2) {
      violations.push({
        rule: 'g2_ge_g1',
        severity: 'warning',
        fieldKey: `g2_${side}`,
        message: `g1_${side} (${g1}") exceeds g2_${side} (${g2}") — atypical for mature bucks.`,
      })
      applyAdjustment(adjustments, `g1_${side}`, -0.05)
      applyAdjustment(adjustments, `g2_${side}`, -0.05)
    }
  }

  for (const side of ['left', 'right'] as const) {
    const hChain = [
      [`h1_${side}`, m[`h1_${side}` as const]],
      [`h2_${side}`, m[`h2_${side}` as const]],
      [`h3_${side}`, m[`h3_${side}` as const]],
      [`h4_${side}`, m[`h4_${side}` as const]],
    ] as const
    for (let i = 0; i < hChain.length - 1; i += 1) {
      const [aKey, aVal] = hChain[i]
      const [bKey, bVal] = hChain[i + 1]
      if (isPositiveNumber(aVal) && isPositiveNumber(bVal) && bVal > aVal) {
        violations.push({
          rule: 'h_tapers_distally',
          severity: 'warning',
          fieldKey: bKey,
          message: `${bKey} (${bVal}") exceeds ${aKey} (${aVal}") — mass typically tapers distally.`,
        })
        applyAdjustment(adjustments, bKey, -0.05)
      }
    }
  }

  const passed = !violations.some(v => v.severity === 'critical')

  return {
    passed,
    violations,
    suggestedConfidenceAdjustments: adjustments,
  }
}

export function hasCriticalViolation(report: PlausibilityReport): boolean {
  return report.violations.some(v => v.severity === 'critical')
}
