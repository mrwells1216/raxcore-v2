type ScoreLike = {
  predictedGross?: number | null
  predictedNet?: number | null
  confidencePercent?: number | null
  errorMargin?: {
    low: number
    high: number
  } | null
}

type CalibrationProfile = {
  sample_count: number
  gross_bias: number
  net_bias: number
  gross_mae: number
  net_mae: number
  confidence_scale: number
}

export function applyCalibration<T extends ScoreLike>(
  score: T,
  profile: CalibrationProfile | null
): T & {
  calibrationApplied: boolean
  calibrationMeta: Record<string, unknown> | null
} {
  if (!profile || profile.sample_count < 5) {
    return {
      ...score,
      calibrationApplied: false,
      calibrationMeta: null,
    }
  }

  const gross =
    typeof score.predictedGross === 'number'
      ? Number((score.predictedGross + profile.gross_bias).toFixed(1))
      : score.predictedGross ?? null

  const net =
    typeof score.predictedNet === 'number'
      ? Number((score.predictedNet + profile.net_bias).toFixed(1))
      : score.predictedNet ?? null

  const confidence =
    typeof score.confidencePercent === 'number'
      ? Math.max(10, Math.min(99, Math.round(score.confidencePercent * profile.confidence_scale)))
      : score.confidencePercent ?? null

  const halfBand = Math.max(profile.gross_mae, 4)

  const errorMargin =
    typeof gross === 'number'
      ? {
          low: Number((gross - halfBand).toFixed(1)),
          high: Number((gross + halfBand).toFixed(1)),
        }
      : score.errorMargin ?? null

  return {
    ...score,
    predictedGross: gross,
    predictedNet: net,
    confidencePercent: confidence,
    errorMargin,
    calibrationApplied: true,
    calibrationMeta: {
      sampleCount: profile.sample_count,
      grossBias: profile.gross_bias,
      netBias: profile.net_bias,
      grossMae: profile.gross_mae,
      netMae: profile.net_mae,
      confidenceScale: profile.confidence_scale,
    },
  }
}
