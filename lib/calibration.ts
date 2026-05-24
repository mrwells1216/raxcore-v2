import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_GLOBAL_GROSS_BIAS,
  DEFAULT_GLOBAL_NET_BIAS,
  type CalibrationOverride,
} from '@/lib/calibration-constants'

export { DEFAULT_GLOBAL_GROSS_BIAS, DEFAULT_GLOBAL_NET_BIAS, type CalibrationOverride }

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
  gross_multiplier?: number
  net_multiplier?: number
  is_active?: boolean
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
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
  /** Optional per-request override (Classroom experiments). Supersedes the profile. */
  override?: CalibrationOverride | null
}) {
  const { rawGross, rawNet, rawConfidence, profile, override } = params

  // Resolve each knob: override > learned profile > seeded default.
  // Multipliers default to 1 (additive-only learning today); the seeded default
  // offset re-centers scores app-wide until a learned profile exists.
  const grossBias =
    firstFinite(override?.grossBias, profile?.gross_bias, DEFAULT_GLOBAL_GROSS_BIAS) ?? 0
  const netBias =
    firstFinite(override?.netBias, profile?.net_bias, DEFAULT_GLOBAL_NET_BIAS) ?? 0
  const grossMult =
    firstFinite(override?.grossMultiplier, profile?.gross_multiplier, 1) ?? 1
  const netMult =
    firstFinite(override?.netMultiplier, profile?.net_multiplier, 1) ?? 1
  const confidenceMult =
    firstFinite(override?.confidenceMultiplier, profile?.confidence_multiplier, 1) ?? 1

  const hasOverride =
    !!override &&
    [
      override.grossBias,
      override.netBias,
      override.grossMultiplier,
      override.netMultiplier,
      override.confidenceMultiplier,
    ].some((v) => typeof v === 'number' && Number.isFinite(v))

  const source: 'override' | 'profile' | 'default' = hasOverride
    ? 'override'
    : profile
      ? 'profile'
      : 'default'

  const calibratedGross =
    typeof rawGross === 'number'
      ? Number((rawGross * grossMult + grossBias).toFixed(1))
      : rawGross

  const calibratedNet =
    typeof rawNet === 'number'
      ? Number((rawNet * netMult + netBias).toFixed(1))
      : rawNet

  const calibratedConfidence =
    typeof rawConfidence === 'number'
      ? Math.max(1, Math.min(100, Math.round(rawConfidence * confidenceMult)))
      : rawConfidence

  const calibrationApplied =
    grossBias !== 0 || netBias !== 0 || grossMult !== 1 || netMult !== 1 || confidenceMult !== 1

  return {
    calibratedGross,
    calibratedNet,
    calibratedConfidence,
    calibrationApplied,
    calibrationMeta: {
      source,
      profile_key: profile?.profile_key ?? (source === 'default' ? 'global_default' : null),
      profile_type: profile?.profile_type ?? null,
      state: profile?.state ?? null,
      rack_type: profile?.rack_type ?? null,
      sample_count: profile?.sample_count ?? 0,
      gross_bias: grossBias,
      net_bias: netBias,
      gross_multiplier: grossMult,
      net_multiplier: netMult,
      gross_mae: profile?.gross_mae ?? 0,
      net_mae: profile?.net_mae ?? 0,
      confidence_multiplier: confidenceMult,
    },
  }
}

// Warn at most once per process lifetime if the calibration schema is not ready.
let _hasWarnedCalibrationSchema = false

export async function getBestCalibrationProfile(params: {
  state?: string | null
  rackType?: string | null
}): Promise<CalibrationProfile | null> {
  const supabase = await createClient()

  const state = normalizeState(params.state)
  const rackType = normalizeRackType(params.rackType)

  // Priority order: most-specific segment first, global last.
  const candidateKeys = [
    makeCalibrationProfileKey({ profileType: 'state_rack_type', state, rackType }),
    makeCalibrationProfileKey({ profileType: 'state', state }),
    makeCalibrationProfileKey({ profileType: 'rack_type', rackType }),
    makeCalibrationProfileKey({ profileType: 'global' }),
  ]

  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('is_active', true)
    .in('profile_key', candidateKeys)

  if (error) {
    // Warn once so the dev console is clean after the initial startup.
    // The most common cause is migration 095 not yet applied (profile_key column missing).
    // Scoring falls through to raw scores — no user-facing impact.
    if (!_hasWarnedCalibrationSchema) {
      _hasWarnedCalibrationSchema = true
      console.warn(
        '[calibration] profile lookup failed — scoring will use raw scores.' ,
        'Run migration 095_add_calibration_profile_key.sql to fix.',
        `(${error.message})`
      )
    }
    return null
  }

  if (!data?.length) return null

  // Pick the highest-priority key that has a matching row.
  const selected =
    candidateKeys
      .map((key) => data.find((row) => row.profile_key === key))
      .find(Boolean) ?? null

  if (!selected) return null

  return {
    profile_key: selected.profile_key,
    profile_type: selected.profile_type ?? 'global',
    state: selected.state ?? null,
    rack_type: selected.rack_type ?? null,
    sample_count: Number(selected.sample_count ?? 0),
    gross_bias: Number(selected.gross_bias ?? 0),
    net_bias: Number(selected.net_bias ?? 0),
    gross_mae: Number(selected.gross_mae ?? 0),
    net_mae: Number(selected.net_mae ?? 0),
    confidence_multiplier: Number(selected.confidence_multiplier ?? 1),
    gross_multiplier: Number(selected.gross_multiplier ?? 1),
    net_multiplier: Number(selected.net_multiplier ?? 1),
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
