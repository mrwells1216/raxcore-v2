import { createClient } from '@/lib/supabase/server'

export interface CalibrationProfile {
  profile_key: string
  profile_type: 'global' | 'state' | 'rack_type' | 'state_rack_type'
  state?: string | null
  rack_type?: string | null
  sample_count: number
  gross_bias: number
  net_bias: number
  gross_mae: number
  net_mae: number
  confidence_multiplier: number
  is_active?: boolean
}

function normalizeRackType(value: string | null | undefined) {
  if (!value) return null
  return value.trim().toLowerCase()
}

function normalizeState(value: string | null | undefined) {
  if (!value) return null
  return value.trim().toUpperCase()
}

function toNumber(value: any): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

export function makeCalibrationProfileKey(params: {
  profileType: CalibrationProfile['profile_type']
  state?: string | null
  rackType?: string | null
}) {
  const state = normalizeState(params.state) ?? 'any'
  const rackType = normalizeRackType(params.rackType) ?? 'any'

  switch (params.profileType) {
    case 'state_rack_type':
      return `state_rack_type:${state}:${rackType}`
    case 'state':
      return `state:${state}`
    case 'rack_type':
      return `rack_type:${rackType}`
    case 'global':
    default:
      return 'global'
  }
}

export function applyCalibration(params: {
  rawGross: number | null
  rawNet: number | null
  rawConfidence: number | null
  profile: CalibrationProfile | null
}) {
  const { rawGross, rawNet, rawConfidence, profile } = params

  if (!profile) {
    return {
      calibratedGross: rawGross,
      calibratedNet: rawNet,
      calibratedConfidence: rawConfidence,
      calibrationApplied: false,
      calibrationMeta: null,
    }
  }

  const calibratedGross =
    typeof rawGross === 'number'
      ? Number((rawGross + Number(profile.gross_bias || 0)).toFixed(1))
      : rawGross

  const calibratedNet =
    typeof rawNet === 'number'
      ? Number((rawNet + Number(profile.net_bias || 0)).toFixed(1))
      : rawNet

  const calibratedConfidence =
    typeof rawConfidence === 'number'
      ? Math.max(
          1,
          Math.min(
            100,
            Math.round(rawConfidence * Number(profile.confidence_multiplier || 1))
          )
        )
      : rawConfidence

  return {
    calibratedGross,
    calibratedNet,
    calibratedConfidence,
    calibrationApplied: true,
    calibrationMeta: {
      profile_key: profile.profile_key,
      profile_type: profile.profile_type,
      state: profile.state ?? null,
      rack_type: profile.rack_type ?? null,
      sample_count: profile.sample_count,
      gross_bias: profile.gross_bias,
      net_bias: profile.net_bias,
      gross_mae: profile.gross_mae,
      net_mae: profile.net_mae,
      confidence_multiplier: profile.confidence_multiplier,
    },
  }
}

// Track whether we've already warned about the schema mismatch to avoid log spam
let _hasWarnedCalibrationSchema = false

export async function getBestCalibrationProfile(params: {
  state?: string | null
  rackType?: string | null
}): Promise<CalibrationProfile | null> {
  const supabase = await createClient()

  const state = normalizeState(params.state)
  const rackType = normalizeRackType(params.rackType)

  const candidateKeys = [
    makeCalibrationProfileKey({
      profileType: 'state_rack_type',
      state,
      rackType,
    }),
    makeCalibrationProfileKey({
      profileType: 'state',
      state,
    }),
    makeCalibrationProfileKey({
      profileType: 'rack_type',
      rackType,
    }),
    makeCalibrationProfileKey({
      profileType: 'global',
    }),
  ]

  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('is_active', true)
    .in('profile_key', candidateKeys)

  if (error) {
    // Only warn once per process lifetime to avoid log spam when the column
    // or table doesn't exist in this environment
    if (!_hasWarnedCalibrationSchema) {
      console.warn('[calibration] failed loading profiles (will use raw scores):', error.message)
      _hasWarnedCalibrationSchema = true
    }
    return null
  }

  if (!data?.length) return null

  const selected =
    candidateKeys
      .map((key) => data.find((row) => row.profile_key === key))
      .find(Boolean) ?? null

  if (!selected) return null

  return {
    profile_key: selected.profile_key,
    profile_type: selected.profile_type,
    state: selected.state,
    rack_type: selected.rack_type,
    sample_count: Number(selected.sample_count || 0),
    gross_bias: Number(selected.gross_bias || 0),
    net_bias: Number(selected.net_bias || 0),
    gross_mae: Number(selected.gross_mae || 0),
    net_mae: Number(selected.net_mae || 0),
    confidence_multiplier: Number(selected.confidence_multiplier || 1),
    is_active: selected.is_active,
  }
}

export function extractTrainingScores(row: any) {
  const ai = row?.ai_output ?? {}
  const truth = row?.ground_truth ?? {}

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

  return {
    aiGross,
    aiNet,
    reviewedGross,
    reviewedNet,
  }
}

export function buildCalibrationAggregate(rows: any[]) {
  const usable = rows
    .map((row) => {
      const input = row?.input ?? {}
      const { aiGross, aiNet, reviewedGross, reviewedNet } = extractTrainingScores(row)

      return {
        state: normalizeState(input?.state),
        rackType: normalizeRackType(input?.rack_type),
        aiGross,
        aiNet,
        reviewedGross,
        reviewedNet,
      }
    })
    .filter(
      (row) =>
        typeof row.aiGross === 'number' &&
        typeof row.aiNet === 'number' &&
        typeof row.reviewedGross === 'number' &&
        typeof row.reviewedNet === 'number'
    )

  return usable
}

export function buildProfileFromRows(params: {
  profileType: CalibrationProfile['profile_type']
  state?: string | null
  rackType?: string | null
  rows: Array<{
    aiGross: number
    aiNet: number
    reviewedGross: number
    reviewedNet: number
  }>
}): CalibrationProfile | null {
  const { profileType, state = null, rackType = null, rows } = params

  if (!rows.length) return null
  if (rows.length < 5) return null

  const grossDeltas = rows.map((r) => r.reviewedGross - r.aiGross)
  const netDeltas = rows.map((r) => r.reviewedNet - r.aiNet)
  const grossAbs = grossDeltas.map((v) => Math.abs(v))
  const netAbs = netDeltas.map((v) => Math.abs(v))

  const avg = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length

  const grossBias = avg(grossDeltas)
  const netBias = avg(netDeltas)
  const grossMae = avg(grossAbs)
  const netMae = avg(netAbs)

  const confidenceMultiplier = Math.max(0.65, 1 - grossMae / 100)

  return {
    profile_key: makeCalibrationProfileKey({
      profileType,
      state,
      rackType,
    }),
    profile_type: profileType,
    state: normalizeState(state),
    rack_type: normalizeRackType(rackType),
    sample_count: rows.length,
    gross_bias: Number(grossBias.toFixed(4)),
    net_bias: Number(netBias.toFixed(4)),
    gross_mae: Number(grossMae.toFixed(4)),
    net_mae: Number(netMae.toFixed(4)),
    confidence_multiplier: Number(confidenceMultiplier.toFixed(4)),
  }
}
