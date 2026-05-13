/**
 * Prompt bias detection and correction.
 *
 * Reads from the correction_events table to detect systematic per-field bias
 * (mean delta between AI output and user-corrected value). When the mean delta
 * for a field exceeds the minimum threshold and has enough samples, the
 * correction is applied additively to the AI measurements before they enter
 * the rest of the scoring pipeline.
 *
 * This is intentionally conservative: corrections only fire when the signal is
 * clear (≥10 samples, |mean_delta| ≥ 0.5"). Corrections are clamped to ±3"
 * per field so they can never produce absurd values.
 */

import 'server-only'
import { getServiceSupabase } from '@/lib/supabase/admin'
import type { Measurements } from '@/lib/types'

// Only apply a correction when there are at least this many samples
const MIN_SAMPLE_COUNT = 10
// Only apply a correction when the absolute mean delta is at least this many inches
const MIN_BIAS_MAGNITUDE = 0.5
// Never apply a per-field correction larger than this
const MAX_CORRECTION_CLAMP = 3.0

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

/**
 * Load per-field bias from correction_events.
 * Returns a map of fieldKey → meanDelta (may be empty if no data).
 * Always resolves (never throws) — returns {} on any DB error.
 */
export async function loadFieldBiases(): Promise<Record<string, number>> {
  try {
    const db = await getServiceSupabase()
    const { data, error } = await db
      .from('correction_events')
      .select('field_key, delta')
      .not('delta', 'is', null)
      .limit(10000)

    if (error || !data) return {}

    // Group by field_key and compute mean delta
    const groups: Record<string, number[]> = {}
    for (const row of data) {
      if (typeof row.delta !== 'number') continue
      if (!groups[row.field_key]) groups[row.field_key] = []
      groups[row.field_key].push(row.delta)
    }

    const biases: Record<string, number> = {}
    for (const [key, deltas] of Object.entries(groups)) {
      if (deltas.length < MIN_SAMPLE_COUNT) continue
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
      if (Math.abs(mean) < MIN_BIAS_MAGNITUDE) continue
      // Clamp — never apply more than MAX_CORRECTION_CLAMP per field
      biases[key] = Math.max(-MAX_CORRECTION_CLAMP, Math.min(MAX_CORRECTION_CLAMP, mean))
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
    const db = await getServiceSupabase()
    const { data, error } = await db
      .from('correction_events')
      .select('field_key, delta')
      .not('delta', 'is', null)
      .limit(10000)

    if (error || !data) return { fields: [], generatedAt: new Date().toISOString() }

    const groups: Record<string, number[]> = {}
    for (const row of data) {
      if (typeof row.delta !== 'number') continue
      if (!groups[row.field_key]) groups[row.field_key] = []
      groups[row.field_key].push(row.delta)
    }

    const fields: FieldBias[] = []
    for (const [key, deltas] of Object.entries(groups)) {
      if (deltas.length === 0) continue
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
      const correction =
        deltas.length >= MIN_SAMPLE_COUNT && Math.abs(mean) >= MIN_BIAS_MAGNITUDE
          ? Math.max(-MAX_CORRECTION_CLAMP, Math.min(MAX_CORRECTION_CLAMP, mean))
          : 0
      fields.push({
        fieldKey: key,
        meanDelta: Number(mean.toFixed(4)),
        sampleCount: deltas.length,
        correctionApplied: Number(correction.toFixed(4)),
      })
    }

    fields.sort((a, b) => Math.abs(b.meanDelta) - Math.abs(a.meanDelta))
    return { fields, generatedAt: new Date().toISOString() }
  } catch {
    return { fields: [], generatedAt: new Date().toISOString() }
  }
}
