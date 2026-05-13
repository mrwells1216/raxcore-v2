export const DEFAULT_REVERSE_SETTINGS = {
  maxCandidates: 28,
  maxEvaluate: 28,
  
  // Candidate ranges
  scaleFactorsStrong: [0.985, 1.0, 1.015],
  scaleFactorsWeak: [0.95, 0.97, 0.985, 1.0, 1.015, 1.03, 1.05],
  spreadDeltas: [-2, -1, -0.5, 0.5, 1, 2],
  beamDeltas: [-1.5, -1, -0.5, 0.5, 1, 1.5],
  tineDeltas: [-1.0, -0.5, 0.5, 1.0],
  massDeltas: [-0.3, -0.2, -0.1, 0.1, 0.2, 0.3],
  deductionDeltas: [-2, -1, -0.5, 0.5, 1],

  // Safety / rollout
  enable: false,
  shadowOnly: true, // don't show to user unless flipped
  maxAutoApplyAbsGrossDelta: 4.0,
  maxAutoApplyAbsGrossDeltaHighConf: 2.0,
  minGeometryImprovementForAutoApply: 0.02,
  minScoreImprovementForAutoApply: 5.0, // evaluation points
  highConfidenceGate: 85,

  // Scoring weights
  wGeometry: 1.0,
  wPenalty: 1.0,
} as const

export type ReverseSettings = typeof DEFAULT_REVERSE_SETTINGS

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Determines whether a hypothesis can be auto-applied based on safety gates
 */
export function canAutoApply(params: {
  baselineConfidence: number
  deltaGross: number
  geometryImprovement: number
  scoreImprovement: number
  settings?: Partial<ReverseSettings>
}): { allowed: boolean; reason: string } {
  const settings = { ...DEFAULT_REVERSE_SETTINGS, ...(params.settings ?? {}) }

  const absDelta = Math.abs(params.deltaGross)
  const isHighConf = params.baselineConfidence >= settings.highConfidenceGate

  // Check gross delta thresholds
  const deltaThreshold = isHighConf 
    ? settings.maxAutoApplyAbsGrossDeltaHighConf 
    : settings.maxAutoApplyAbsGrossDelta

  if (absDelta > deltaThreshold) {
    return {
      allowed: false,
      reason: `Gross delta ${absDelta.toFixed(1)}" exceeds threshold ${deltaThreshold}" for ${isHighConf ? 'high' : 'normal'}-confidence baseline`,
    }
  }

  // Check geometry improvement
  if (params.geometryImprovement < settings.minGeometryImprovementForAutoApply) {
    return {
      allowed: false,
      reason: `Geometry improvement ${(params.geometryImprovement * 100).toFixed(1)}% below threshold ${(settings.minGeometryImprovementForAutoApply * 100).toFixed(1)}%`,
    }
  }

  // Check score improvement
  if (params.scoreImprovement < settings.minScoreImprovementForAutoApply) {
    return {
      allowed: false,
      reason: `Score improvement ${params.scoreImprovement.toFixed(1)} below threshold ${settings.minScoreImprovementForAutoApply}`,
    }
  }

  return {
    allowed: true,
    reason: 'All safety gates passed',
  }
}
