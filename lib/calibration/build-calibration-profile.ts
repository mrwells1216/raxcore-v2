type TrainingSampleRow = {
  input?: {
    rack_type?: string | null
    state?: string | null
    image_count?: number | null
    source_type?: string | null
  } | null
  ai_output?: {
    gross_score?: number | null
    net_score?: number | null
  } | null
  ground_truth?: {
    gross_score?: number | null
    net_score?: number | null
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

function avg(values: number[]) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function buildCalibrationProfile(samples: TrainingSampleRow[]): CalibrationProfile | null {
  const usable = samples.filter((s) => {
    const aiGross = s.ai_output?.gross_score
    const truthGross = s.ground_truth?.gross_score
    const aiNet = s.ai_output?.net_score
    const truthNet = s.ground_truth?.net_score

    return (
      typeof aiGross === 'number' &&
      typeof truthGross === 'number' &&
      typeof aiNet === 'number' &&
      typeof truthNet === 'number'
    )
  })

  if (!usable.length) return null

  const grossDiffs = usable.map(
    (s) => (s.ground_truth!.gross_score as number) - (s.ai_output!.gross_score as number)
  )

  const netDiffs = usable.map(
    (s) => (s.ground_truth!.net_score as number) - (s.ai_output!.net_score as number)
  )

  const grossAbs = grossDiffs.map((v) => Math.abs(v))
  const netAbs = netDiffs.map((v) => Math.abs(v))

  const grossMae = avg(grossAbs)
  const netMae = avg(netAbs)

  // Higher MAE should reduce confidence.
  // Clamp to keep things sane.
  const confidenceScale = Math.max(0.55, Math.min(1, 1 - grossMae / 40))

  return {
    sample_count: usable.length,
    gross_bias: avg(grossDiffs),
    net_bias: avg(netDiffs),
    gross_mae: grossMae,
    net_mae: netMae,
    confidence_scale: confidenceScale,
  }
}
