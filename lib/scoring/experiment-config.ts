// Classroom experiment configuration.
//
// A single optional `experiment_config` JSON blob travels on the /api/score
// FormData. When absent, EVERY gate below resolves to its current production
// behavior — the live scoring flow is byte-for-byte unchanged. The Classroom
// uses this to flip individual scoring sub-systems on/off and override a few
// numeric knobs so the user can experiment and calibrate.

export const EXPERIMENT_FEATURE_KEYS = [
  'detectionGate',
  'landmarks',
  'eyeCircleCalibration',
  'pedicleCalibration',
  'arucoCalibration',
  'vanishingPoint',
  'perImageConsensus',
  'promptBiasCorrection',
  'plausibilityValidator',
  'secondPass',
  'calibrationProfile',
  'precisionPassShadow',
] as const

export type ExperimentFeatureKey = (typeof EXPERIMENT_FEATURE_KEYS)[number]

export const FEATURE_LABELS: Record<ExperimentFeatureKey, string> = {
  detectionGate: 'Rack admission gate',
  landmarks: 'Landmark detection',
  eyeCircleCalibration: 'Eye-circle calibration',
  pedicleCalibration: 'Pedicle-dot calibration',
  arucoCalibration: 'ArUco marker calibration',
  vanishingPoint: 'Vanishing-point cross-check',
  perImageConsensus: 'Per-image consensus',
  promptBiasCorrection: 'Prompt bias correction',
  plausibilityValidator: 'Plausibility validator',
  secondPass: 'Second-pass solver',
  calibrationProfile: 'Score calibration',
  precisionPassShadow: 'Shadow precision pass',
}

export const FEATURE_DESCRIPTIONS: Record<ExperimentFeatureKey, string> = {
  detectionGate: 'Reject images that do not contain a usable rack (422). Off = score anything.',
  landmarks: 'GPT-4o pixel landmark detection (drives the overlay + landmark calibration).',
  eyeCircleCalibration: 'Derive scale from iris radius when landmarks are present.',
  pedicleCalibration: 'Use user-placed pedicle dots for scale.',
  arucoCalibration: 'Detect a printed ArUco marker for scale.',
  vanishingPoint: 'Warn when background perspective disagrees with the primary calibration.',
  perImageConsensus: 'Fuse anatomical references across images with outlier rejection.',
  promptBiasCorrection: 'Inject learned per-field biases into the prompt and post-correct measurements.',
  plausibilityValidator: 'Run deterministic sanity checks on the AI output.',
  secondPass: 'Re-score automatically when the self-check / plausibility flags instability.',
  calibrationProfile: 'Apply the learned/seeded score calibration offset.',
  precisionPassShadow: 'Fire the background reverse-engineering shadow pass (10% rollout).',
}

export interface ExperimentVariables {
  /** Additive gross offset (inches). Supersedes the calibration profile when set. */
  grossBias?: number | null
  /** Additive net offset (inches). */
  netBias?: number | null
  /** Multiplicative gross scale (e.g. 1.05). */
  grossMultiplier?: number | null
  /** Multiplicative net scale. */
  netMultiplier?: number | null
  /** Multiplicative confidence scale. */
  confidenceMultiplier?: number | null
  /** Extra instruction appended to the vision prompt (never replaces the contract). */
  customPrompt?: string | null
}

export interface ExperimentConfig {
  features?: Partial<Record<ExperimentFeatureKey, boolean>>
  variables?: ExperimentVariables
}

/** A feature is ON unless the config explicitly sets it to false. */
export function isFeatureEnabled(
  cfg: ExperimentConfig | null | undefined,
  key: ExperimentFeatureKey,
): boolean {
  return cfg?.features?.[key] !== false
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function sanitizeNumber(
  value: unknown,
  lo: number,
  hi: number,
): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return clamp(n, lo, hi)
}

const MAX_CUSTOM_PROMPT_CHARS = 2000

/**
 * Parse + sanitize the raw `experiment_config` string. Unknown keys are dropped,
 * numeric overrides are clamped to sane bands, and the custom prompt is length
 * limited. Returns null on absent / invalid input so callers fall back to
 * production behavior.
 */
export function parseExperimentConfig(
  raw: string | null | undefined,
): ExperimentConfig | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  const out: ExperimentConfig = {}

  if (obj.features && typeof obj.features === 'object') {
    const features: Partial<Record<ExperimentFeatureKey, boolean>> = {}
    for (const key of EXPERIMENT_FEATURE_KEYS) {
      const v = (obj.features as Record<string, unknown>)[key]
      if (typeof v === 'boolean') features[key] = v
    }
    if (Object.keys(features).length > 0) out.features = features
  }

  if (obj.variables && typeof obj.variables === 'object') {
    const vRaw = obj.variables as Record<string, unknown>
    const variables: ExperimentVariables = {}
    const grossBias = sanitizeNumber(vRaw.grossBias, -50, 50)
    const netBias = sanitizeNumber(vRaw.netBias, -50, 50)
    const grossMultiplier = sanitizeNumber(vRaw.grossMultiplier, 0.5, 1.5)
    const netMultiplier = sanitizeNumber(vRaw.netMultiplier, 0.5, 1.5)
    const confidenceMultiplier = sanitizeNumber(vRaw.confidenceMultiplier, 0.5, 1.5)
    if (grossBias !== undefined) variables.grossBias = grossBias
    if (netBias !== undefined) variables.netBias = netBias
    if (grossMultiplier !== undefined) variables.grossMultiplier = grossMultiplier
    if (netMultiplier !== undefined) variables.netMultiplier = netMultiplier
    if (confidenceMultiplier !== undefined) variables.confidenceMultiplier = confidenceMultiplier
    if (typeof vRaw.customPrompt === 'string' && vRaw.customPrompt.trim()) {
      variables.customPrompt = vRaw.customPrompt.slice(0, MAX_CUSTOM_PROMPT_CHARS)
    }
    if (Object.keys(variables).length > 0) out.variables = variables
  }

  if (!out.features && !out.variables) return null
  return out
}

/** Resolve the actual on/off map applied this run — persisted + shown in results. */
export function resolveFeaturesUsed(
  cfg: ExperimentConfig | null | undefined,
): Record<ExperimentFeatureKey, boolean> {
  const map = {} as Record<ExperimentFeatureKey, boolean>
  for (const key of EXPERIMENT_FEATURE_KEYS) map[key] = isFeatureEnabled(cfg, key)
  return map
}

/** Narrow flag set threaded into the AI scoring service. */
export interface AiServiceExperimentFlags {
  promptBiasCorrection: boolean
  plausibilityValidator: boolean
  secondPass: boolean
  customPrompt: string | null
}

export function toAiServiceFlags(
  cfg: ExperimentConfig | null | undefined,
): AiServiceExperimentFlags | undefined {
  if (!cfg) return undefined
  return {
    promptBiasCorrection: isFeatureEnabled(cfg, 'promptBiasCorrection'),
    plausibilityValidator: isFeatureEnabled(cfg, 'plausibilityValidator'),
    secondPass: isFeatureEnabled(cfg, 'secondPass'),
    customPrompt: cfg.variables?.customPrompt ?? null,
  }
}

import type { CalibrationOverride } from '@/lib/calibration-constants'

/**
 * Build the calibration override for `applyCalibration`. When the calibration
 * feature is OFF, returns an identity override (all biases 0, mults 1) so the
 * score stays raw. When ON, returns any user-set variable overrides (or null,
 * meaning "use the resolved profile / seeded default").
 */
export function toCalibrationOverride(
  cfg: ExperimentConfig | null | undefined,
): CalibrationOverride | null {
  if (!cfg) return null
  if (!isFeatureEnabled(cfg, 'calibrationProfile')) {
    return { grossBias: 0, netBias: 0, grossMultiplier: 1, netMultiplier: 1, confidenceMultiplier: 1 }
  }
  const v = cfg.variables
  if (!v) return null
  const override: CalibrationOverride = {}
  if (typeof v.grossBias === 'number') override.grossBias = v.grossBias
  if (typeof v.netBias === 'number') override.netBias = v.netBias
  if (typeof v.grossMultiplier === 'number') override.grossMultiplier = v.grossMultiplier
  if (typeof v.netMultiplier === 'number') override.netMultiplier = v.netMultiplier
  if (typeof v.confidenceMultiplier === 'number') override.confidenceMultiplier = v.confidenceMultiplier
  return Object.keys(override).length > 0 ? override : null
}
