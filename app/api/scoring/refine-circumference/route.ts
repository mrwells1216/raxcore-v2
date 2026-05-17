import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  deriveCircumferencesFromH1,
  deriveCircumferencesFromH1H2,
  validateCircumferenceEntry,
  sumCircumferenceContribution,
  type DerivedCircumference,
} from '@/lib/scoring/circumference-taper'

interface RefineRequest {
  predictionId: string
  buckId?: string
  h1LeftInches: number
  h1RightInches?: number | null
  h2LeftInches?: number | null
  h2RightInches?: number | null
}

export async function POST(request: NextRequest) {
  let body: RefineRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { predictionId, h1LeftInches, h1RightInches, h2LeftInches, h2RightInches } = body
  if (!predictionId || typeof predictionId !== 'string') {
    return NextResponse.json({ error: 'predictionId is required' }, { status: 400 })
  }

  // Validate the user inputs (warn but do not hard-fail unless H1L missing)
  const validationWarnings: string[] = []
  const h1Warn = validateCircumferenceEntry('h1', h1LeftInches)
  if (h1Warn) return NextResponse.json({ error: h1Warn }, { status: 400 })
  if (h1RightInches != null) {
    const w = validateCircumferenceEntry('h1', h1RightInches)
    if (w) validationWarnings.push(w)
  }
  if (h2LeftInches != null) {
    const w = validateCircumferenceEntry('h2', h2LeftInches, { h1: h1LeftInches })
    if (w) validationWarnings.push(w)
  }

  // Derive H1–H4 on both sides
  const derive =
    h2LeftInches != null
      ? deriveCircumferencesFromH1H2(
          h1LeftInches,
          h2LeftInches,
          h1RightInches ?? undefined,
          h2RightInches ?? undefined,
        )
      : deriveCircumferencesFromH1(h1LeftInches, h1RightInches ?? undefined)

  const newCircumferences = byField(derive.values)
  const totalCircumferenceInches = sumCircumferenceContribution(derive.values) ?? 0

  // Load the existing prediction and patch its raw_ai_response measurements
  const supabase = await createClient()
  const { data: prediction, error: predErr } = await supabase
    .from('predictions')
    .select('id, buck_id, estimated_score, raw_ai_response, score_range_low, score_range_high')
    .eq('id', predictionId)
    .single()

  if (predErr || !prediction) {
    return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })
  }

  const raw = (prediction.raw_ai_response ?? {}) as Record<string, any>
  const previousMeas = (raw.measurements ?? {}) as Record<string, number | null | undefined>

  // Build a new measurements object preserving every non-H field
  const updatedMeas: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(previousMeas)) {
    updatedMeas[k] = v ?? null
  }
  let previousCircumferenceTotal = 0
  for (const field of ['h1', 'h2', 'h3', 'h4'] as const) {
    for (const side of ['left', 'right'] as const) {
      const key = `${field}_${side}`
      const prev = Number(previousMeas[key] ?? 0)
      if (Number.isFinite(prev)) previousCircumferenceTotal += prev
      const next = newCircumferences[`${field}_${side}`]
      if (next != null) updatedMeas[key] = next
    }
  }

  const delta = totalCircumferenceInches - previousCircumferenceTotal
  const newGross =
    typeof prediction.estimated_score === 'number'
      ? round2(prediction.estimated_score + delta)
      : null

  // Persist
  const refinementMetadata = {
    source: 'circumference_taper_refine',
    refinedAt: new Date().toISOString(),
    inputs: {
      h1LeftInches,
      h1RightInches: h1RightInches ?? null,
      h2LeftInches: h2LeftInches ?? null,
      h2RightInches: h2RightInches ?? null,
    },
    perField: derive.values,
    warnings: [...derive.warnings, ...validationWarnings],
    previousCircumferenceTotal: round2(previousCircumferenceTotal),
    totalCircumferenceInches,
    deltaInches: round2(delta),
    previousGross:
      typeof prediction.estimated_score === 'number' ? prediction.estimated_score : null,
    newGross,
  }

  const newRaw = {
    ...raw,
    measurements: updatedMeas,
    circumferenceRefinement: refinementMetadata,
  }

  const updates: Record<string, unknown> = {
    raw_ai_response: newRaw,
  }
  if (newGross != null) updates.estimated_score = newGross
  if (
    newGross != null &&
    typeof prediction.score_range_low === 'number' &&
    typeof prediction.score_range_high === 'number' &&
    typeof prediction.estimated_score === 'number'
  ) {
    // Shift the score range with the gross delta
    updates.score_range_low = round2(prediction.score_range_low + delta)
    updates.score_range_high = round2(prediction.score_range_high + delta)
  }

  const { error: updateErr } = await supabase
    .from('predictions')
    .update(updates)
    .eq('id', predictionId)

  if (updateErr) {
    console.error('[refine-circumference] update failed:', updateErr.message)
    return NextResponse.json({ error: 'Failed to persist refinement' }, { status: 500 })
  }

  return NextResponse.json({
    predictionId,
    newGross,
    deltaInches: round2(delta),
    measurements: updatedMeas,
    derivedCircumferences: derive.values,
    warnings: refinementMetadata.warnings,
  })
}

function byField(values: DerivedCircumference[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) {
    out[`${v.field}_${v.side}`] = v.valueInches
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
