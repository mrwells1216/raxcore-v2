/**
 * Prompt bias detection and correction.
 *
 * Detects systematic per-field bias (mean delta between AI output and the
 * known-better value) from two signal sources, fused with weighting:
 *   1. correction_events — user corrections (delta = userValue - aiValue).
 *   2. official_score_sheets.ai_run_result — AI scored against certified score
 *      sheets (ground truth). Higher quality than user guesses, so weighted up.
 * When the weighted mean delta for a field clears the thresholds it is applied
 * additively to the AI measurements before they enter the rest of the pipeline.
 *
 * Conservative by design: corrections only fire when the signal is clear
 * (≥10 observations, |mean_delta| ≥ 0.5") and are clamped to ±3" per field so
 * they can never produce absurd values.
 */

import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type { Measurements } from '@/lib/types'

// Only apply a correction when there are at least this many observations
const MIN_SAMPLE_COUNT = 10
// Only apply a correction when the absolute mean delta is at least this many inches
const MIN_BIAS_MAGNITUDE = 0.5
// Never apply a per-field correction larger than this
const MAX_CORRECTION_CLAMP = 3.0
// Relative weights of the two bias signals in the fused mean.
const USER_CORRECTION_WEIGHT = 1
// Ground-truth (AI vs certified score sheet) deltas beat user guesses.
const GROUND_TRUTH_WEIGHT = 3

export interface FieldBias {
  fieldKey: string
  meanDelta: number
  sampleCount: number
  correctionApplied: number
}

export interface BiasReport {
  fields: FieldBias[]
  generatedAt: string
}

interface WeightedDelta {
  delta: number
  weight: number
}

function clampCorrection(value: number): number {
  return Math.max(-MAX_CORRECTION_CLAMP, Math.min(MAX_CORRECTION_CLAMP, value))
}

function weightedStats(deltas: WeightedDelta[]): { mean: number; sampleCount: number } {
  const sampleCount = deltas.length
  if (sampleCount === 0) return { mean: 0, sampleCount: 0 }
  let weightSum = 0
  let weightedSum = 0
  for (const d of deltas) {
    if (!Number.isFinite(d.delta) || !Number.isFinite(d.weight) || d.weight <= 0) continue
    weightSum += d.weight
    weightedSum += d.delta * d.weight
  }
  return { mean: weightSum > 0 ? weightedSum / weightSum : 0, sampleCount }
}

/**
 * User corrections from correction_events. delta = userValue - aiValue, which is
 * exactly the amount to add to the AI value, so it is used as-is.
 */
async function loadUserCorrectionDeltas(): Promise<Record<string, WeightedDelta[]>> {
  try {
    const db = await getServiceSupabase()
    const { data, error } = await db
      .from('correction_events')
      .select('field_key, delta')
      .not('delta', 'is', null)
      .limit(10000)
    if (error || !data) return {}

    const groups: Record<string, WeightedDelta[]> = {}
    for (const row of data) {
      if (typeof row.delta !== 'number' || !Number.isFinite(row.delta)) continue
      ;(groups[row.field_key] ||= []).push({ delta: row.delta, weight: USER_CORRECTION_WEIGHT })
    }
    return groups
  } catch {
    return {}
  }
}

/**
 * Ground-truth deltas from official score sheets that have been AI-scored.
 * ai_run_result.fields[].delta = ai - official, so the amount to add to the AI
 * value to reach ground truth is (official - ai) = -delta.
 */
async function loadGroundTruthDeltas(): Promise<Record<string, WeightedDelta[]>> {
  try {
    const db = await getServiceSupabase()
    const { data, error } = await db
      .from('official_score_sheets')
      .select('ai_run_result')
      .not('ai_run_result', 'is', null)
      .limit(10000)
    if (error || !data) return {}

    const groups: Record<string, WeightedDelta[]> = {}
    for (const row of data) {
      const fields = (row.ai_run_result as { fields?: Array<{ field?: string; delta?: number }> } | null)
        ?.fields
      if (!Array.isArray(fields)) continue
      for (const f of fields) {
        if (!f || typeof f.field !== 'string') continue
        if (f.field === 'gross_score' || f.field === 'net_score') continue
        if (typeof f.delta !== 'number' || !Number.isFinite(f.delta)) continue
        ;(groups[f.field] ||= []).push({ delta: -f.delta, weight: GROUND_TRUTH_WEIGHT })
      }
    }
    return groups
  } catch {
    return {}
  }
}

function mergeDeltaGroups(
  ...sources: Record<string, WeightedDelta[]>[]
): Record<string, WeightedDelta[]> {
  const merged: Record<string, WeightedDelta[]> = {}
  for (const src of sources) {
    for (const [key, deltas] of Object.entries(src)) {
      ;(merged[key] ||= []).push(...deltas)
    }
  }
  return merged
}

/**
 * Load per-field bias fused from user corrections + ground-truth comparisons.
 * Returns a map of fieldKey → clamped weighted-mean correction (may be empty).
 * Always resolves (never throws) — returns {} on any DB error.
 */
export async function loadFieldBiases(): Promise<Record<string, number>> {
  try {
    const merged = mergeDeltaGroups(
      await loadUserCorrectionDeltas(),
      await loadGroundTruthDeltas()
    )

    const biases: Record<string, number> = {}
    for (const [key, deltas] of Object.entries(merged)) {
      const { mean, sampleCount } = weightedStats(deltas)
      if (sampleCount < MIN_SAMPLE_COUNT) continue
      if (Math.abs(mean) < MIN_BIAS_MAGNITUDE) continue
      biases[key] = clampCorrection(mean)
    }
    return biases
  } catch {
    return {}
  }
}

/**
 * Apply per-field bias corrections to a Measurements object.
 * Returns the corrected measurements and the list of corrections applied.
 * Always returns a valid Measurements object (never throws).
 */
export function applyBiasCorrections(
  measurements: Measurements,
  biases: Record<string, number>
): { corrected: Measurements; applied: FieldBias[] } {
  if (Object.keys(biases).length === 0) {
    return { corrected: measurements, applied: [] }
  }

  const corrected: Measurements = { ...measurements }
  const applied: FieldBias[] = []

  for (const [key, bias] of Object.entries(biases)) {
    const k = key as keyof Measurements
    const current = corrected[k]
    if (typeof current !== 'number' || !isFinite(current)) continue
    const updated = current + bias
    if (updated <= 0) continue // never produce negative measurement
    ;(corrected as unknown as Record<string, unknown>)[k] = Number(updated.toFixed(3))
    applied.push({
      fieldKey: key,
      meanDelta: bias,
      sampleCount: 0, // filled by callers who have full report
      correctionApplied: bias,
    })
  }

  return { corrected, applied }
}

/**
 * Full bias report for the admin dashboard.
 * Shows all fields with enough data, regardless of threshold.
 */
export async function getBiasReport(): Promise<BiasReport> {
  try {
    const merged = mergeDeltaGroups(
      await loadUserCorrectionDeltas(),
      await loadGroundTruthDeltas()
    )

    const fields: FieldBias[] = []
    for (const [key, deltas] of Object.entries(merged)) {
      const { mean, sampleCount } = weightedStats(deltas)
      if (sampleCount === 0) continue
      const correction =
        sampleCount >= MIN_SAMPLE_COUNT && Math.abs(mean) >= MIN_BIAS_MAGNITUDE
          ? clampCorrection(mean)
          : 0
      fields.push({
        fieldKey: key,
        meanDelta: Number(mean.toFixed(4)),
        sampleCount,
        correctionApplied: Number(correction.toFixed(4)),
      })
    }

    fields.sort((a, b) => Math.abs(b.meanDelta) - Math.abs(a.meanDelta))
    return { fields, generatedAt: new Date().toISOString() }
  } catch {
    return { fields: [], generatedAt: new Date().toISOString() }
  }
}
