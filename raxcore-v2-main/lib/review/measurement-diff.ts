type DiffRow = {
  key: string
  label: string
  aiValue: number | null
  reviewedValue: number | null
  delta: number | null
  changed: boolean
}

function toNum(value: any): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

function makeRow(
  key: string,
  label: string,
  aiValue: any,
  reviewedValue: any
): DiffRow | null {
  const ai = toNum(aiValue)
  const reviewed = toNum(reviewedValue)

  if (reviewed === null) return null

  const delta =
    ai !== null && reviewed !== null
      ? Number((reviewed - ai).toFixed(1))
      : null

  return {
    key,
    label,
    aiValue: ai,
    reviewedValue: reviewed,
    delta,
    changed: ai !== reviewed,
  }
}

export function buildMeasurementDiff(params: {
  aiMeasurements: any
  reviewedMeasurements: any
}): DiffRow[] {
  const { aiMeasurements, reviewedMeasurements } = params

  if (!reviewedMeasurements) return []

  const rows: Array<DiffRow | null> = []

  rows.push(
    makeRow(
      'insideSpread',
      'Inside spread',
      aiMeasurements?.insideSpread ?? aiMeasurements?.inside_spread,
      reviewedMeasurements?.insideSpread ?? reviewedMeasurements?.inside_spread
    )
  )

  rows.push(
    makeRow(
      'leftBeamLength',
      'Main beam left',
      aiMeasurements?.leftBeamLength ?? aiMeasurements?.main_beam_left,
      reviewedMeasurements?.leftBeamLength ?? reviewedMeasurements?.main_beam_left
    )
  )

  rows.push(
    makeRow(
      'rightBeamLength',
      'Main beam right',
      aiMeasurements?.rightBeamLength ?? aiMeasurements?.main_beam_right,
      reviewedMeasurements?.rightBeamLength ?? reviewedMeasurements?.main_beam_right
    )
  )

  const gLabels = ['G1', 'G2', 'G3', 'G4', 'G5']
  for (let i = 0; i < gLabels.length; i++) {
    const idx = i + 1
    rows.push(
      makeRow(
        `g${idx}_left`,
        `${gLabels[i]} left`,
        aiMeasurements?.[`g${idx}_left`] ?? aiMeasurements?.leftTines?.[i],
        reviewedMeasurements?.[`g${idx}_left`] ?? reviewedMeasurements?.leftTines?.[i]
      )
    )

    rows.push(
      makeRow(
        `g${idx}_right`,
        `${gLabels[i]} right`,
        aiMeasurements?.[`g${idx}_right`] ?? aiMeasurements?.rightTines?.[i],
        reviewedMeasurements?.[`g${idx}_right`] ?? reviewedMeasurements?.rightTines?.[i]
      )
    )
  }

  const hLabels = ['H1', 'H2', 'H3', 'H4']
  for (let i = 0; i < hLabels.length; i++) {
    const idx = i + 1
    rows.push(
      makeRow(
        `h${idx}_left`,
        `${hLabels[i]} left`,
        aiMeasurements?.[`h${idx}_left`] ?? aiMeasurements?.leftMass?.[i],
        reviewedMeasurements?.[`h${idx}_left`] ?? reviewedMeasurements?.leftMass?.[i]
      )
    )

    rows.push(
      makeRow(
        `h${idx}_right`,
        `${hLabels[i]} right`,
        aiMeasurements?.[`h${idx}_right`] ?? aiMeasurements?.rightMass?.[i],
        reviewedMeasurements?.[`h${idx}_right`] ?? reviewedMeasurements?.rightMass?.[i]
      )
    )
  }

  rows.push(
    makeRow(
      'grossScore',
      'Gross score',
      aiMeasurements?.grossScore ?? aiMeasurements?.gross_score,
      reviewedMeasurements?.grossScore ?? reviewedMeasurements?.gross_score
    )
  )

  rows.push(
    makeRow(
      'netScore',
      'Net score',
      aiMeasurements?.netScore ?? aiMeasurements?.net_score,
      reviewedMeasurements?.netScore ?? reviewedMeasurements?.net_score
    )
  )

  return rows.filter(Boolean) as DiffRow[]
}
