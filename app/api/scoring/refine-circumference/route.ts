/**
 * §4.5 — Circumference taper refinement.
 *
 * Accepts a single tape-measured H1 (left or right side) and applies the
 * published whitetail taper ratios to derive H2–H4 + the opposite-side
 * H1–H4. Updates the prediction row in place; non-circumference fields are
 * untouched.
 *
 * Provenance: derived values are tagged `source: 'derived_taper'`. This
 * route NEVER unlocks Verified Score; tape alone is `physical_reference`
 * only when run through the Advanced Scoring graph (§3.3).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  deriveCircumferences,
  applyTaperToMeasurements,
  CircumferenceTaperError,
  TAPER_H1_TO_H1_MIN_INCHES,
  TAPER_H1_TO_H1_MAX_INCHES,
} from '@/lib/scoring/circumference-taper'
import type { Measurements } from '@/lib/types'

const RefineBody = z.object({
  predictionId: z.string().uuid(),
  measuredH1Inches: z.number().min(TAPER_H1_TO_H1_MIN_INCHES).max(TAPER_H1_TO_H1_MAX_INCHES),
  side: z.enum(['left', 'right']),
})

export async function POST(request: NextRequest) {
  let body: z.infer<typeof RefineBody>
  try {
    body = RefineBody.parse(await request.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  let derived
  try {
    derived = deriveCircumferences(body.measuredH1Inches, body.side)
  } catch (err) {
    const message = err instanceof CircumferenceTaperError ? err.message : 'taper computation failed'
    return NextResponse.json({ error: 'taper_failed', message }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: prediction, error: predictionError } = await supabase
    .from('predictions')
    .select('id, buck_id, measurements, predicted_gross, predicted_net, user_measurements_metadata')
    .eq('id', body.predictionId)
    .single()

  if (predictionError || !prediction) {
    return NextResponse.json({ error: 'prediction_not_found' }, { status: 404 })
  }

  const existing = (prediction.measurements as Measurements | null) ?? null
  if (!existing) {
    return NextResponse.json({ error: 'no_measurements' }, { status: 422 })
  }

  const updated = applyTaperToMeasurements(existing, derived)

  // Recompute gross/net using the same field set the original scorer used.
  const grossDelta = grossDeltaFromCircumferences(existing, updated)
  const newGross = roundOneDp((prediction.predicted_gross ?? 0) + grossDelta)
  const newNet = roundOneDp((prediction.predicted_net ?? 0) + grossDelta)

  // Persist measurements + derived metadata. The taper inputs are captured in
  // user_measurements_metadata so the learning flywheel can correlate
  // taper-refinement deltas vs original AI estimates.
  const taperMetadata = {
    measuredH1Inches: body.measuredH1Inches,
    measuredSide: body.side,
    derivedValues: derived,
    grossDelta,
    refinedAt: new Date().toISOString(),
  }

  const existingMetadata = (prediction.user_measurements_metadata as Record<string, unknown> | null) ?? {}
  const mergedMetadata = {
    ...existingMetadata,
    circumferenceTaper: taperMetadata,
  }

  const { error: updateError } = await supabase
    .from('predictions')
    .update({
      measurements: updated,
      predicted_gross: newGross,
      predicted_net: newNet,
      user_measurements_metadata: mergedMetadata,
    })
    .eq('id', body.predictionId)

  if (updateError) {
    console.warn('[refine-circumference] update failed:', updateError.message)
    return NextResponse.json({ error: 'update_failed', message: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    predictionId: body.predictionId,
    measurements: updated,
    predictedGross: newGross,
    predictedNet: newNet,
    grossDelta,
    derived,
    taperMetadata,
  })
}

function grossDeltaFromCircumferences(prev: Measurements, next: Measurements): number {
  const fields: Array<keyof Measurements> = [
    'h1_left', 'h1_right',
    'h2_left', 'h2_right',
    'h3_left', 'h3_right',
    'h4_left', 'h4_right',
  ]
  let delta = 0
  for (const f of fields) {
    const a = prev[f]
    const b = next[f]
    if (typeof a === 'number' && typeof b === 'number') delta += b - a
  }
  return roundOneDp(delta)
}

function roundOneDp(n: number): number {
  return Math.round(n * 10) / 10
}
