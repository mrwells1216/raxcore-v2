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

function getAiMeasurements(row: TrainingRow) {
  return row?.ai_output?.measurements ?? null
}

function getReviewedMeasurements(row: TrainingRow) {
  return row?.ground_truth?.measurements ?? null
}

function getFieldPairs(row: TrainingRow) {
  const ai = getAiMeasurements(row) ?? {}
  const reviewed = getReviewedMeasurements(row) ?? {}

  const pairs: Array<{ key: string; ai: number | null; reviewed: number | null }> = []

  const pushPair = (key: string, aiValue: any, reviewedValue: any) => {
    const aiNum = toNumber(aiValue)
    const reviewedNum = toNumber(reviewedValue)
    if (reviewedNum === null) return
    pairs.push({ key, ai: aiNum, reviewed: reviewedNum })
  }

  pushPair(
    'inside_spread',
    ai?.insideSpread ?? ai?.inside_spread,
    reviewed?.insideSpread ?? reviewed?.inside_spread
  )

  pushPair(
    'main_beam_left',
    ai?.leftBeamLength ?? ai?.main_beam_left,
    reviewed?.leftBeamLength ?? reviewed?.main_beam_left
  )

  pushPair(
    'main_beam_right',
    ai?.rightBeamLength ?? ai?.main_beam_right,
    reviewed?.rightBeamLength ?? reviewed?.main_beam_right
  )

  for (let i = 1; i <= 5; i++) {
    pushPair(`g${i}_left`, ai?.[`g${i}_left`], reviewed?.[`g${i}_left`])
    pushPair(`g${i}_right`, ai?.[`g${i}_right`], reviewed?.[`g${i}_right`])
  }

  for (let i = 1; i <= 4; i++) {
    pushPair(`h${i}_left`, ai?.[`h${i}_left`], reviewed?.[`h${i}_left`])
    pushPair(`h${i}_right`, ai?.[`h${i}_right`], reviewed?.[`h${i}_right`])
  }

  pushPair(
    'gross_score',
    row?.ai_output?.gross_score ?? ai?.grossScore ?? ai?.gross_score,
    row?.ground_truth?.gross_score ?? reviewed?.grossScore ?? reviewed?.gross_score
  )

  pushPair(
    'net_score',
    row?.ai_output?.net_score ?? ai?.netScore ?? ai?.net_score,
    row?.ground_truth?.net_score ?? reviewed?.netScore ?? reviewed?.net_score
  )

  return pairs
}

export function buildTrainingAnalytics(rows: TrainingRow[]) {
  const officialRows = (rows ?? []).filter((row) => row?.is_official === true)

  const grossDeltas: number[] = []
  const netDeltas: number[] = []
  const stateMap = new Map<string, number[]>()
  const rackTypeMap = new Map<string, number[]>()
  const imageCountMap = new Map<string, number[]>()
  const fieldMap = new Map<string, number[]>()

  let calibratedCount = 0

  const biggestGrossMisses: Array<{
    training_sample_id: string
    buck_id: string | null
    prediction_id: string | null
    state: string | null
    rack_type: string | null
    ai_gross: number | null
    reviewed_gross: number | null
    gross_delta: number | null
    abs_gross_delta: number
  }> = []

  for (const row of officialRows) {
    const input = row?.input ?? {}
    const aiOutput = row?.ai_output ?? {}
    const truth = row?.ground_truth ?? {}

    const aiGross =
      toNumber(aiOutput?.gross_score) ??
      toNumber(aiOutput?.measurements?.grossScore) ??
      toNumber(aiOutput?.measurements?.gross_score)

    const reviewedGross =
      toNumber(truth?.gross_score) ??
      toNumber(truth?.measurements?.grossScore) ??
      toNumber(truth?.measurements?.gross_score)

    const aiNet =
      toNumber(aiOutput?.net_score) ??
      toNumber(aiOutput?.measurements?.netScore) ??
      toNumber(aiOutput?.measurements?.net_score)

    const reviewedNet =
      toNumber(truth?.net_score) ??
      toNumber(truth?.measurements?.netScore) ??
      toNumber(truth?.measurements?.net_score)

    if (typeof aiGross === 'number' && typeof reviewedGross === 'number') {
      const delta = reviewedGross - aiGross
      grossDeltas.push(delta)

      biggestGrossMisses.push({
        training_sample_id: row?.id ?? '',
        buck_id: row?.buck_id ?? null,
        prediction_id: row?.prediction_id ?? null,
        state: input?.state ?? null,
        rack_type: input?.rack_type ?? null,
        ai_gross: aiGross,
        reviewed_gross: reviewedGross,
        gross_delta: Number(delta.toFixed(1)),
        abs_gross_delta: Math.abs(delta),
      })

      const stateKey = input?.state ?? 'unknown'
      stateMap.set(stateKey, [...(stateMap.get(stateKey) ?? []), delta])

      const rackTypeKey = input?.rack_type ?? 'unknown'
      rackTypeMap.set(rackTypeKey, [...(rackTypeMap.get(rackTypeKey) ?? []), delta])

      const imageCountKey =
        typeof input?.image_count === 'number' ? String(input.image_count) : 'unknown'
      imageCountMap.set(imageCountKey, [...(imageCountMap.get(imageCountKey) ?? []), delta])
    }

    if (typeof aiNet === 'number' && typeof reviewedNet === 'number') {
      netDeltas.push(reviewedNet - aiNet)
    }

    if (aiOutput?.calibration_applied) {
      calibratedCount += 1
    }

    const pairs = getFieldPairs(row)
    for (const pair of pairs) {
      if (pair.ai === null || pair.reviewed === null) continue
      const delta = pair.reviewed - pair.ai
      fieldMap.set(pair.key, [...(fieldMap.get(pair.key) ?? []), delta])
    }
  }

  biggestGrossMisses.sort((a, b) => b.abs_gross_delta - a.abs_gross_delta)

  const fieldErrorSummary = Array.from(fieldMap.entries())
    .map(([field, deltas]) => ({
      field,
      sample_count: deltas.length,
      mean_signed_error: Number(avg(deltas).toFixed(2)),
      mean_absolute_error: Number(absAvg(deltas).toFixed(2)),
    }))
    .sort((a, b) => b.mean_absolute_error - a.mean_absolute_error)

  const byState = Array.from(stateMap.entries())
    .map(([state, deltas]) => ({
      state,
      sample_count: deltas.length,
      mean_signed_error: Number(avg(deltas).toFixed(2)),
      mean_absolute_error: Number(absAvg(deltas).toFixed(2)),
    }))
    .sort((a, b) => b.sample_count - a.sample_count)

  const byRackType = Array.from(rackTypeMap.entries())
    .map(([rack_type, deltas]) => ({
      rack_type,
      sample_count: deltas.length,
      mean_signed_error: Number(avg(deltas).toFixed(2)),
      mean_absolute_error: Number(absAvg(deltas).toFixed(2)),
    }))
    .sort((a, b) => b.sample_count - a.sample_count)

  const byImageCount = Array.from(imageCountMap.entries())
    .map(([image_count, deltas]) => ({
      image_count,
      sample_count: deltas.length,
      mean_signed_error: Number(avg(deltas).toFixed(2)),
      mean_absolute_error: Number(absAvg(deltas).toFixed(2)),
    }))
    .sort((a, b) => Number(a.image_count) - Number(b.image_count))

  return {
    total_official_samples: officialRows.length,
    calibrated_sample_count: calibratedCount,
    avg_gross_signed_error: Number(avg(grossDeltas).toFixed(2)),
    avg_gross_absolute_error: Number(absAvg(grossDeltas).toFixed(2)),
    avg_net_signed_error: Number(avg(netDeltas).toFixed(2)),
    avg_net_absolute_error: Number(absAvg(netDeltas).toFixed(2)),
    biggest_gross_misses: biggestGrossMisses.slice(0, 25),
    field_error_summary: fieldErrorSummary,
    by_state: byState,
    by_rack_type: byRackType,
    by_image_count: byImageCount,
  }
}
