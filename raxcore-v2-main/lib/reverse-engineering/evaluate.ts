import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import { applyHypothesis, calculateGrossNet } from './hypotheses'
import type { HypothesisParams } from './types'

/**
 * Compute L1 distance between two measurement sets
 */
export function l1Delta(a: Measurements, b: Measurements): number {
  const keys = Object.keys(a) as (keyof Measurements)[]
  let sum = 0
  for (const k of keys) {
    const av = a[k]
    const bv = b[k]
    if (typeof av === 'number' && typeof bv === 'number') {
      sum += Math.abs(av - bv)
    }
  }
  return Number(sum.toFixed(1))
}

/**
 * Simple geometry consistency check for hypothesis evaluation
 * Returns a score 0-1 and flags for issues
 */
function checkGeometrySimple(measurements: Measurements): {
  consistencyScore: number
  tier: 'excellent' | 'good' | 'fair' | 'poor'
  flags: Array<{ code: string; severity: 'critical' | 'warning' | 'info'; message: string }>
} {
  const flags: Array<{ code: string; severity: 'critical' | 'warning' | 'info'; message: string }> = []
  let score = 1.0

  const { inside_spread, main_beam_left, main_beam_right } = measurements

  // Check spread vs beam ratio (typical whitetail: spread should be ~60-90% of beam)
  if (inside_spread !== null && main_beam_left !== null && main_beam_right !== null) {
    const avgBeam = (main_beam_left + main_beam_right) / 2
    const spreadRatio = inside_spread / avgBeam

    if (spreadRatio > 1.3) {
      flags.push({
        code: 'spread_too_wide',
        severity: 'warning',
        message: `Spread ratio ${spreadRatio.toFixed(2)} unusually high`,
      })
      score -= 0.15
    } else if (spreadRatio < 0.4) {
      flags.push({
        code: 'spread_too_narrow',
        severity: 'warning',
        message: `Spread ratio ${spreadRatio.toFixed(2)} unusually low`,
      })
      score -= 0.15
    }
  }

  // Check beam asymmetry
  if (main_beam_left !== null && main_beam_right !== null) {
    const beamDiff = Math.abs(main_beam_left - main_beam_right)
    const maxBeam = Math.max(main_beam_left, main_beam_right)
    const beamAsymmetry = beamDiff / maxBeam

    if (beamAsymmetry > 0.3) {
      flags.push({
        code: 'beam_asymmetry_high',
        severity: 'critical',
        message: `Beam asymmetry ${(beamAsymmetry * 100).toFixed(0)}% is very high`,
      })
      score -= 0.25
    } else if (beamAsymmetry > 0.15) {
      flags.push({
        code: 'beam_asymmetry_moderate',
        severity: 'warning',
        message: `Beam asymmetry ${(beamAsymmetry * 100).toFixed(0)}% is elevated`,
      })
      score -= 0.1
    }
  }

  // Check G2/G3 tine ratios (G2 should typically be longer than G3)
  const g2Left = measurements.g2_left
  const g3Left = measurements.g3_left
  if (g2Left !== null && g3Left !== null && g3Left > g2Left * 1.3) {
    flags.push({
      code: 'g3_longer_than_g2',
      severity: 'info',
      message: 'G3 significantly longer than G2 (unusual)',
    })
    score -= 0.05
  }

  // Check for negative or zero values
  const numericFields = [
    'inside_spread', 'main_beam_left', 'main_beam_right',
    'g1_left', 'g1_right', 'g2_left', 'g2_right',
  ] as const

  for (const field of numericFields) {
    const val = measurements[field]
    if (val !== null && val <= 0) {
      flags.push({
        code: `negative_${field}`,
        severity: 'critical',
        message: `${field} has invalid value ${val}`,
      })
      score -= 0.2
    }
  }

  // Check deductions sanity
  const { gross } = calculateGrossNet(measurements)
  if (measurements.deductions !== null && measurements.deductions > gross * 0.3) {
    flags.push({
      code: 'excessive_deductions',
      severity: 'warning',
      message: `Deductions ${measurements.deductions} is >30% of gross ${gross.toFixed(1)}`,
    })
    score -= 0.1
  }

  // Clamp and tier
  score = Math.max(0, Math.min(1, score))
  
  let tier: 'excellent' | 'good' | 'fair' | 'poor'
  if (score >= 0.9) tier = 'excellent'
  else if (score >= 0.75) tier = 'good'
  else if (score >= 0.5) tier = 'fair'
  else tier = 'poor'

  return { consistencyScore: score, tier, flags }
}

export interface HypothesisEvaluation {
  measurements: Measurements
  gross: number
  net: number
  geometryScore: number
  plausibilityPenalty: number
  changePenalty: number
  totalScore: number
  flags: Record<string, unknown>
}

// Small constant penalty applied to the noop hypothesis so it doesn't trivially
// win against real adjustments that only marginally improve geometry.
const NOOP_EPSILON_PENALTY = 0.5

/**
 * Evaluate a hypothesis by applying it and scoring geometry + change penalty
 */
export function evaluateHypothesis(input: {
  base: Measurements
  params: HypothesisParams
  baseGross: number
  baseNet: number
  baseConfidence: number
  isNoop?: boolean
  landmarks?: LandmarksDetected
  angleTypes?: AngleType[]
  earsFullyVisible?: boolean
}): HypothesisEvaluation {
  // Apply hypothesis to get candidate measurements
  const m = applyHypothesis(input.base, input.params)
  const { gross, net } = calculateGrossNet(m)

  // Check geometry consistency
  const geo = checkGeometrySimple(m)

  const critical = geo.flags.filter(f => f.severity === 'critical').length
  const warning = geo.flags.filter(f => f.severity === 'warning').length
  const info = geo.flags.filter(f => f.severity === 'info').length

  const geometryScore = geo.consistencyScore * 100

  // Plausibility penalty heavily punishes critical geometry violations
  const plausibilityPenalty = (critical * 30) + (warning * 10) + (info * 2)

  // Change penalty increases sharply for high-confidence baselines
  const deltaGross = Math.abs(gross - input.baseGross)
  const l1 = l1Delta(input.base, m)
  
  // Higher confidence = higher penalty for changes
  const confK = input.baseConfidence >= 85 ? 6 : input.baseConfidence >= 70 ? 4 : 2.5
  const changePenalty = (deltaGross * confK) + (l1 * 0.35)

  // Noop gets a small epsilon penalty so real adjustments with equivalent geometry win
  const noopPenalty = input.isNoop ? NOOP_EPSILON_PENALTY : 0

  // Total score: maximize geometry, minimize penalties
  const totalScore = Number((geometryScore - plausibilityPenalty - changePenalty - noopPenalty).toFixed(3))

  return {
    measurements: m,
    gross,
    net,
    geometryScore,
    plausibilityPenalty,
    changePenalty,
    totalScore,
    flags: {
      consistencyScore: geo.consistencyScore,
      tier: geo.tier,
      critical,
      warning,
      info,
      geoFlags: geo.flags,
    },
  }
}

/**
 * Select the best hypothesis from evaluations
 */
export function selectBestHypothesis(
  evaluations: Array<{ candidateId: string; evaluation: HypothesisEvaluation }>
): { candidateId: string; evaluation: HypothesisEvaluation } | null {
  if (evaluations.length === 0) return null

  // Sort by total score descending
  const sorted = [...evaluations].sort((a, b) => b.evaluation.totalScore - a.evaluation.totalScore)
  
  return sorted[0]
}
