type ExportRow = {
  training_sample_id: string
  buck_id: string | null
  prediction_id: string | null
  reviewed_score_sheet_id: string | null

  state: string | null
  rack_type: string | null
  source_type: string | null
  image_count: number | null

  ai_gross_score: number | null
  ai_net_score: number | null

  reviewed_gross_score: number | null
  reviewed_net_score: number | null

  gross_delta: number | null
  net_delta: number | null

  review_completeness: number
  is_official: boolean
  reviewed_by: string | null
  reviewed_at: string | null

  calibration_applied: boolean
  calibration_profile_type: string | null
  calibration_sample_count: number | null

  ai_measurements: any
  reviewed_measurements: any
  measurement_diffs: any
}

function toNumber(value: any): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

export function buildOfficialTrainingExportRow(row: any): ExportRow {
  const input = row?.input ?? {}
  const ai = row?.ai_output ?? {}
  const truth = row?.ground_truth ?? {}
  const diffs = row?.measurement_diffs ?? null

  const aiGross =
    toNumber(ai?.gross_score) ??
    toNumber(ai?.measurements?.grossScore) ??
    toNumber(ai?.measurements?.gross_score)

  const aiNet =
    toNumber(ai?.net_score) ??
    toNumber(ai?.measurements?.netScore) ??
    toNumber(ai?.measurements?.net_score)

  const reviewedGross =
    toNumber(truth?.gross_score) ??
    toNumber(truth?.measurements?.grossScore) ??
    toNumber(truth?.measurements?.gross_score)

  const reviewedNet =
    toNumber(truth?.net_score) ??
    toNumber(truth?.measurements?.netScore) ??
    toNumber(truth?.measurements?.net_score)

  const grossDelta =
    aiGross !== null && reviewedGross !== null
      ? Number((reviewedGross - aiGross).toFixed(1))
      : null

  const netDelta =
    aiNet !== null && reviewedNet !== null
      ? Number((reviewedNet - aiNet).toFixed(1))
      : null

  return {
    training_sample_id: row?.id ?? '',
    buck_id: row?.buck_id ?? null,
    prediction_id: row?.prediction_id ?? null,
    reviewed_score_sheet_id: row?.reviewed_score_sheet_id ?? null,

    state: input?.state ?? null,
    rack_type: input?.rack_type ?? null,
    source_type: input?.source_type ?? null,
    image_count:
      typeof input?.image_count === 'number' ? input.image_count : null,

    ai_gross_score: aiGross,
    ai_net_score: aiNet,

    reviewed_gross_score: reviewedGross,
    reviewed_net_score: reviewedNet,

    gross_delta: grossDelta,
    net_delta: netDelta,

    review_completeness: Number(row?.review_completeness ?? 0),
    is_official: Boolean(row?.is_official),
    reviewed_by: row?.reviewed_by ?? null,
    reviewed_at: row?.reviewed_at ?? null,

    calibration_applied: Boolean(ai?.calibration_applied ?? false),
    calibration_profile_type: ai?.calibration_meta?.profile_type ?? null,
    calibration_sample_count:
      typeof ai?.calibration_meta?.sample_count === 'number'
        ? ai.calibration_meta.sample_count
        : null,

    ai_measurements: ai?.measurements ?? null,
    reviewed_measurements: truth?.measurements ?? null,
    measurement_diffs: diffs,
  }
}
