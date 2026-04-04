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

export type CalibrationScope = {
  level: 'global' | 'segment'
  state?: string | null
  rack_type?: string | null
  image_count_bucket?: string | null
}

export type SegmentedCalibrationProfile = CalibrationProfile & {
  profile_key: string
  scope: CalibrationScope
}

function avg(values: number[]) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function bucketImageCount(count: number | null | undefined): string {
  if (!count || count <= 1) return '1'
  if (count === 2) return '2'
  if (count === 3) return '3'
  return '4_plus'
}

export function makeProfileKey(scope: CalibrationScope): string {
  if (scope.level === 'global') return 'global_default'

  const state = scope.state ?? 'any'
  const rackType = scope.rack_type ?? 'any'
  const imageBucket = scope.image_count_bucket ?? 'any'

  return `segment:${state}:${rackType}:${imageBucket}`
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

export function buildSegmentedCalibrationProfiles(
  samples: TrainingSampleRow[]
): SegmentedCalibrationProfile[] {
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

  const grouped = new Map<string, { scope: CalibrationScope; rows: TrainingSampleRow[] }>()

  for (const sample of usable) {
    const state = sample.input?.state ?? null
    const rackType = sample.input?.rack_type ?? null
    const imageBucket = bucketImageCount(sample.input?.image_count ?? null)

    const scopes: CalibrationScope[] = [
      {
        level: 'segment',
        state,
        rack_type: rackType,
        image_count_bucket: imageBucket,
      },
      {
        level: 'segment',
        state,
        rack_type: rackType,
        image_count_bucket: null,
      },
      {
        level: 'segment',
        state: null,
        rack_type: rackType,
        image_count_bucket: null,
      },
    ]

    for (const scope of scopes) {
      const key = makeProfileKey(scope)
      const existing = grouped.get(key)

      if (existing) {
        existing.rows.push(sample)
      } else {
        grouped.set(key, {
          scope,
          rows: [sample],
        })
      }
    }
  }

  const profiles: SegmentedCalibrationProfile[] = []

  for (const [, value] of grouped.entries()) {
    const profile = buildCalibrationProfile(value.rows)
    if (!profile) continue

    // keep only segments with enough data
    if (profile.sample_count < 5) continue

    profiles.push({
      ...profile,
      profile_key: makeProfileKey(value.scope),
      scope: value.scope,
    })
  }

  return profiles
}
