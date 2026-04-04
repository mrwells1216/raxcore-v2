function isNum(value: any) {
  return typeof value === 'number' && !Number.isNaN(value)
}

function countNums(values: any[] | undefined | null) {
  if (!Array.isArray(values)) return 0
  return values.filter((v) => isNum(v)).length
}

export function isOfficialReview(params: {
  reviewCompleteness: number
  measurements: any
  isTrainingTruth?: boolean
}) {
  const { reviewCompleteness, measurements, isTrainingTruth = false } = params

  if (!isTrainingTruth) return false
  if (reviewCompleteness < 90) return false
  if (!measurements) return false

  const insideSpread =
    measurements.insideSpread ?? measurements.inside_spread

  const leftBeam =
    measurements.leftBeamLength ?? measurements.main_beam_left

  const rightBeam =
    measurements.rightBeamLength ?? measurements.main_beam_right

  const gross =
    measurements.grossScore ?? measurements.gross_score

  const net =
    measurements.netScore ?? measurements.net_score

  const leftTines =
    measurements.leftTines ??
    [
      measurements.g1_left,
      measurements.g2_left,
      measurements.g3_left,
      measurements.g4_left,
      measurements.g5_left,
    ]

  const rightTines =
    measurements.rightTines ??
    [
      measurements.g1_right,
      measurements.g2_right,
      measurements.g3_right,
      measurements.g4_right,
      measurements.g5_right,
    ]

  const leftMass =
    measurements.leftMass ??
    [
      measurements.h1_left,
      measurements.h2_left,
      measurements.h3_left,
      measurements.h4_left,
    ]

  const rightMass =
    measurements.rightMass ??
    [
      measurements.h1_right,
      measurements.h2_right,
      measurements.h3_right,
      measurements.h4_right,
    ]

  if (!isNum(gross)) return false
  if (!isNum(net)) return false
  if (!isNum(insideSpread)) return false
  if (!isNum(leftBeam)) return false
  if (!isNum(rightBeam)) return false

  if (countNums(leftTines) < 1) return false
  if (countNums(rightTines) < 1) return false

  if (countNums(leftMass) < 2) return false
  if (countNums(rightMass) < 2) return false

  return true
}
