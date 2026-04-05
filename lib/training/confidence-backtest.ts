type TrainingRow = any

function toNumber(value: any): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

function avg(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function absAvg(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length
}

function getConfidence(row: TrainingRow) {
  return (
    toNumber(row?.ai_output?.confidence_percent) ??
    toNumber(row?.ai_output?.confidencePercent) ??
    toNumber(row?.ai_output?.final_confidence) ??
    toNumber(row?.ai_output?.raw_ai_response?.confidencePercent)
  )
}

function getGrossDelta(row: TrainingRow) {
  const aiGross =
    toNumber(row?.ai_output?.gross_score) ??
    toNumber(row?.ai_output?.measurements?.grossScore) ??
    toNumber(row?.ai_output?.measurements?.gross_score)

  const reviewedGross =
    toNumber(row?.ground_truth?.gross_score) ??
    toNumber(row?.ground_truth?.measurements?.grossScore) ??
    toNumber(row?.ground_truth?.measurements?.gross_score)

  if (aiGross === null || reviewedGross === null) return null
  return reviewedGross - aiGross
}

function getBand(confidence: number) {
  if (confidence >= 75) return 'high'
  if (confidence >= 45) return 'medium'
  return 'low'
}

export function buildConfidenceBacktest(rows: TrainingRow[]) {
  const officialRows = (rows ?? []).filter((row) => row?.is_official === true)

  const usable = officialRows
    .map((row) => {
      const confidence = getConfidence(row)
      const grossDelta = getGrossDelta(row)
      if (confidence === null || grossDelta === null) return null

      return {
        id: row?.id ?? '',
        buck_id: row?.buck_id ?? null,
        prediction_id: row?.prediction_id ?? null,
        confidence,
        band: getBand(confidence),
        gross_delta: grossDelta,
        abs_gross_delta: Math.abs(grossDelta),
      }
    })
    .filter(Boolean) as Array<{
      id: string
      buck_id: string | null
      prediction_id: string | null
      confidence: number
      band: 'low' | 'medium' | 'high'
      gross_delta: number
      abs_gross_delta: number
    }>

  const overallAbsErrors = usable.map((row) => row.abs_gross_delta)

  const byBand = ['high', 'medium', 'low'].map((band) => {
    const rowsForBand = usable.filter((row) => row.band === band)
    const absErrors = rowsForBand.map((row) => row.abs_gross_delta)

    return {
      band,
      sample_count: rowsForBand.length,
      mean_absolute_error: Number(absAvg(absErrors).toFixed(2)),
      mean_signed_error: Number(avg(rowsForBand.map((row) => row.gross_delta)).toFixed(2)),
    }
  })

  const buckets = [
    { label: '90-100', min: 90, max: 100 },
    { label: '75-89', min: 75, max: 89 },
    { label: '60-74', min: 60, max: 74 },
    { label: '45-59', min: 45, max: 59 },
    { label: '30-44', min: 30, max: 44 },
    { label: '0-29', min: 0, max: 29 },
  ].map((bucket) => {
    const rowsForBucket = usable.filter(
      (row) => row.confidence >= bucket.min && row.confidence <= bucket.max
    )

    return {
      label: bucket.label,
      sample_count: rowsForBucket.length,
      mean_absolute_error: Number(
        absAvg(rowsForBucket.map((row) => row.abs_gross_delta)).toFixed(2)
      ),
    }
  })

  const highBand = byBand.find((b) => b.band === 'high')
  const mediumBand = byBand.find((b) => b.band === 'medium')
  const lowBand = byBand.find((b) => b.band === 'low')

  const confidenceOrderingPasses =
    Boolean(
      highBand &&
        mediumBand &&
        lowBand &&
        highBand.sample_count > 0 &&
        mediumBand.sample_count > 0 &&
        lowBand.sample_count > 0 &&
        highBand.mean_absolute_error <= mediumBand.mean_absolute_error &&
        mediumBand.mean_absolute_error <= lowBand.mean_absolute_error
    )

  return {
    total_official_samples: officialRows.length,
    usable_samples: usable.length,
    overall_mean_absolute_error: Number(absAvg(overallAbsErrors).toFixed(2)),
    by_band: byBand,
    by_confidence_bucket: buckets,
    confidence_ordering_passes: confidenceOrderingPasses,
    worst_mismatches: usable
      .slice()
      .sort((a, b) => b.abs_gross_delta - a.abs_gross_delta)
      .slice(0, 25),
  }
}
