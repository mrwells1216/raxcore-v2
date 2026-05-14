import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildTrainingSample } from '@/lib/training/build-training-sample'
import { getReviewCompleteness } from '@/lib/review/review-completeness'
import { isOfficialReview } from '@/lib/review/is-official-review'
import { loadEffectiveMeasurementGraph } from '@/lib/scoring/load-effective-measurement-graph'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { onIntervalMiss, onHighConfidenceMiss } from '@/lib/supervision/hooks'
import { isIntervalMiss } from '@/lib/supervision/interval-miss-detector'
import { recordMeasurementDiff } from '@/lib/training/correction-events'

export async function POST(req: Request) {
  const db = await createClient()
  const body = await req.json()

  const {
    predictionId,
    buckId,
    reviewedSheet,
    isTrainingTruth = false,
  } = body ?? {}

  if (!predictionId || !buckId || !reviewedSheet) {
    return NextResponse.json(
      { error: 'Missing predictionId, buckId, or reviewedSheet' },
      { status: 400 }
    )
  }

  const reviewStatus = isTrainingTruth ? 'final' : 'draft'
  const reviewedMeasurements = reviewedSheet?.measurements ?? null
  const reviewCompleteness = getReviewCompleteness(reviewedMeasurements)
  const isOfficial = isOfficialReview({
    reviewCompleteness,
    measurements: reviewedMeasurements,
    isTrainingTruth,
  })
  const reviewedBy = 'human_review'

  console.log('[review-save] official review gate', {
    predictionId,
    reviewCompleteness,
    isTrainingTruth,
    isOfficial,
  })

  const reviewedGross =
    reviewedSheet?.measurements?.grossScore ??
    reviewedSheet?.grossScore ??
    null

  const reviewedNet =
    reviewedSheet?.measurements?.netScore ??
    reviewedSheet?.netScore ??
    null

  const { data: existing, error: existingError } = await db
    .from('reviewed_score_sheets')
    .select('*')
    .eq('prediction_id', predictionId)
    .maybeSingle()

  if (existingError) {
    console.error('[review-save] failed checking existing reviewed sheet', existingError)
    return NextResponse.json(
      { error: 'Failed checking existing reviewed sheet' },
      { status: 500 }
    )
  }

  let savedReviewedScoreSheet: any = null
  let updated = false

  const reviewedScoreSheetPayload = {
    buck_id: buckId,
    prediction_id: predictionId,
    sheet_json: reviewedSheet,
    reviewed_gross: reviewedGross,
    reviewed_net: reviewedNet,
    review_status: reviewStatus,
    is_training_truth: isTrainingTruth,
    created_by: reviewedBy,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { data, error } = await db
      .from('reviewed_score_sheets')
      .update(reviewedScoreSheetPayload)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      console.error('[review-save] failed updating reviewed score sheet', error)
      return NextResponse.json(
        { error: 'Failed updating reviewed score sheet' },
        { status: 500 }
      )
    }

    savedReviewedScoreSheet = data
    updated = true
  } else {
    const { data, error } = await db
      .from('reviewed_score_sheets')
      .insert({
        ...reviewedScoreSheetPayload,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('[review-save] failed inserting reviewed score sheet', error)
      return NextResponse.json(
        { error: 'Failed inserting reviewed score sheet' },
        { status: 500 }
      )
    }

    savedReviewedScoreSheet = data
    updated = false
  }

  // Part 5: Patch canonical measurement graph with human-corrected values.
  // Each edited measurement is stamped: origin='human', visibility='corrected'.
  // Fields that cannot map to graph segments are noted as warnings, not errors.
  // This is best-effort: failures are reported as warnings but do not fail the save.
  let graphPatchWarnings: string[] = []
  {
    const m = reviewedSheet?.measurements ?? {}
    const graphWarnings: string[] = []
    await (async () => {
      try {
        const effective = await loadEffectiveMeasurementGraph(buckId)
        if (effective.source === 'fallback') return

        const graph = structuredClone(effective.graph) as typeof effective.graph & Record<string, unknown>
        const humanProv = {
          origin: 'human' as const,
          visibility: 'corrected' as const,
          notes: 'Manual score edit',
        }

        // Beams
        if (typeof m.main_beam_left === 'number' && m.main_beam_left > 0) {
          graph.beams.left.length = m.main_beam_left
          graph.beams.left.provenance = humanProv
        }
        if (typeof m.main_beam_right === 'number' && m.main_beam_right > 0) {
          graph.beams.right.length = m.main_beam_right
          graph.beams.right.provenance = humanProv
        }
        // Spread
        if (typeof m.inside_spread === 'number' && m.inside_spread > 0) {
          graph.spread.distance = m.inside_spread
          graph.spread.provenance = humanProv
        }
        // Tines: g1_left … g5_right
        const tineKeys: Array<[string, string, 'left' | 'right']> = [
          ['g1_left', 'G1', 'left'], ['g1_right', 'G1', 'right'],
          ['g2_left', 'G2', 'left'], ['g2_right', 'G2', 'right'],
          ['g3_left', 'G3', 'left'], ['g3_right', 'G3', 'right'],
          ['g4_left', 'G4', 'left'], ['g4_right', 'G4', 'right'],
          ['g5_left', 'G5', 'left'], ['g5_right', 'G5', 'right'],
        ]
        for (const [key, label, side] of tineKeys) {
          const val = m[key]
          if (typeof val !== 'number' || val <= 0) continue
          const existing = graph.tines.find((t: any) => t.label === label && t.side === side)
          if (existing) {
            existing.length = val
            existing.provenance = humanProv
          } else {
            graphWarnings.push(`Edited field ${key} not graph-mapped yet — no matching tine in graph`)
          }
        }
        // Circumferences: h1_left … h4_right
        const circKeys: Array<[string, string, 'left' | 'right']> = [
          ['h1_left', 'H1', 'left'], ['h1_right', 'H1', 'right'],
          ['h2_left', 'H2', 'left'], ['h2_right', 'H2', 'right'],
          ['h3_left', 'H3', 'left'], ['h3_right', 'H3', 'right'],
          ['h4_left', 'H4', 'left'], ['h4_right', 'H4', 'right'],
        ]
        for (const [key, label, side] of circKeys) {
          const val = m[key]
          if (typeof val !== 'number' || val <= 0) continue
          const existing = graph.circumferences.find((c: any) => c.label === label && c.side === side)
          if (existing) {
            existing.circumference = val
            existing.provenance = humanProv
          } else {
            graphWarnings.push(`Edited field ${key} not graph-mapped yet — no matching circumference in graph`)
          }
        }

        // Persist new version
        const adminDb = await getServiceSupabase()
        const newVersion = (effective.version ?? 0) + 1
        const insertPayload: Record<string, unknown> = {
          graph,
          version: newVersion,
          confidence: null,
          source: 'human_review',
          created_at: new Date().toISOString(),
        }

        // Use correct FK column (buck_id modern, rack_id legacy)
        if (effective.graphId) {
          // We have a persisted row — check which column it uses
          const { data: existingRow } = await adminDb
            .from('measurement_graphs')
            .select('buck_id, rack_id')
            .eq('id', effective.graphId)
            .maybeSingle()
          if (existingRow?.buck_id) insertPayload.buck_id = buckId
          else insertPayload.rack_id = buckId
        } else {
          insertPayload.buck_id = buckId
        }

        const { error: graphErr } = await adminDb
          .from('measurement_graphs')
          .insert(insertPayload)

        if (graphErr) {
          if ((graphErr as { code?: string }).code === '42703' && 'buck_id' in insertPayload) {
            delete insertPayload.buck_id
            insertPayload.rack_id = buckId
            const { error: rackErr } = await adminDb
              .from('measurement_graphs')
              .insert(insertPayload)
            if (rackErr) {
              graphWarnings.push(`Graph patch persistence failed: ${rackErr.message}`)
              console.warn('[review-save] graph patch insert failed (non-blocking):', rackErr.message)
            }
          } else {
            graphWarnings.push(`Graph patch persistence failed: ${graphErr.message}`)
            console.warn('[review-save] graph patch insert failed (non-blocking):', graphErr.message)
          }
        } else {
          console.log('[review-save] graph patch persisted', {
            buckId,
            newVersion,
            warnings: graphWarnings,
          })
        }
      } catch (gErr) {
        console.warn('[review-save] graph patch error (non-blocking):', gErr instanceof Error ? gErr.message : String(gErr))
      }
    })()
    graphPatchWarnings = graphWarnings
  }

  // Load original prediction for training truth build
  const { data: prediction, error: predictionError } = await db
    .from('predictions')
    .select('*')
    .eq('id', predictionId)
    .single()

  if (predictionError) {
    console.error('[review-save] failed loading prediction for training sample', predictionError)
    return NextResponse.json(
      {
        ok: true,
        reviewedScoreSheet: savedReviewedScoreSheet,
        updated,
        reviewCompleteness,
        isOfficial,
        graphWarnings: graphPatchWarnings,
        warning: 'Reviewed sheet saved, but training sample was not refreshed',
      },
      { status: 200 }
    )
  }

  const trainingSample = buildTrainingSample({
    buckId,
    predictionId,
    reviewedSheet,
    originalPrediction: prediction,
    reviewCompleteness,
    isOfficial,
    reviewedBy,
  })

  const { error: trainingError } = await db
    .from('training_samples')
    .upsert(trainingSample, { onConflict: 'prediction_id' })

  if (trainingError) {
    console.error('[review-save] failed upserting training sample', trainingError)
    return NextResponse.json(
      {
        ok: true,
        reviewedScoreSheet: savedReviewedScoreSheet,
        updated,
        reviewCompleteness,
        isOfficial,
        graphWarnings: graphPatchWarnings,
        warning: 'Reviewed sheet saved, but training sample refresh failed',
      },
      { status: 200 }
    )
  }

  // WI-2: Record per-field correction events (non-blocking) when reviewed measurements differ from AI.
  if (reviewedSheet?.measurements && prediction.measurements) {
    const { data: authUser } = await db.auth.getUser()
    recordMeasurementDiff({
      buckId,
      predictionId,
      userId: authUser?.user?.id ?? null,
      correctionSource: 'review_sheet',
      aiMeasurements: prediction.measurements as Record<string, number | null | undefined>,
      userMeasurements: reviewedSheet.measurements as Record<string, number | null | undefined>,
      confidenceTierBefore: (() => {
        const pct = prediction.confidence_percent ?? 0
        return pct >= 80 ? 'very_high' : pct >= 65 ? 'high' : pct >= 45 ? 'medium' : 'low'
      })(),
    }).catch(err => console.warn('[review-save] recordMeasurementDiff failed (non-blocking)', err))
  }

  // Phase 52: Fire supervision hooks non-blocking after ground truth is known.
  // onIntervalMiss   — when verified gross falls outside the predicted interval.
  // onHighConfidenceMiss — when a high-confidence prediction was far off.
  if (reviewedGross != null && isOfficial) {
    const predGross = prediction.predicted_gross
    const bandLow = prediction.error_band_low
    const bandHigh = prediction.error_band_high
    const confPct = prediction.confidence_percent ?? 0
    // Map confidence percent to tier label for the hook
    const confTier = confPct >= 80 ? 'very_high' : confPct >= 65 ? 'high' : confPct >= 45 ? 'medium' : 'low'

    if (predGross != null && bandLow != null && bandHigh != null) {
      if (isIntervalMiss(bandLow, bandHigh, reviewedGross)) {
        onIntervalMiss({
          predictionId,
          buckId,
          predictedIntervalLow: bandLow,
          predictedIntervalHigh: bandHigh,
          actualScore: reviewedGross,
          confidenceTier: confTier,
          confidencePercent: confPct,
        }).catch(err => console.warn('[review-save] onIntervalMiss failed (non-blocking)', err))
      }
    }

    if (predGross != null) {
      const missMagnitude = Math.abs(reviewedGross - predGross)
      if (missMagnitude > 10 && (confTier === 'high' || confTier === 'very_high')) {
        const intervalMissed = bandLow != null && bandHigh != null
          ? isIntervalMiss(bandLow, bandHigh, reviewedGross)
          : false
        onHighConfidenceMiss({
          predictionId,
          buckId,
          confidenceTier: confTier,
          missMagnitude,
          intervalMiss: intervalMissed,
          predicted: predGross,
          actual: reviewedGross,
        }).catch(err => console.warn('[review-save] onHighConfidenceMiss failed (non-blocking)', err))
      }
    }
  }

  return NextResponse.json({
    ok: true,
    reviewedScoreSheet: savedReviewedScoreSheet,
    updated,
    reviewCompleteness,
    isOfficial,
    graphWarnings: graphPatchWarnings,
  })
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const predictionId = searchParams.get('predictionId')

    if (!predictionId) {
      return NextResponse.json(
        { error: 'Missing predictionId query parameter' },
        { status: 400 }
      )
    }

    const db = await createClient()

    const { data, error } = await db
      .from('reviewed_score_sheets')
      .select('*')
      .eq('prediction_id', predictionId)
      .maybeSingle()

    if (error) {
      console.error('[save-score-sheet] GET error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch reviewed score sheet', details: error.message },
        { status: 500 }
      )
    }

    const measurements = data?.sheet_json?.measurements ?? null
    const reviewCompleteness = getReviewCompleteness(measurements)
    const isOfficial = isOfficialReview({
      reviewCompleteness,
      measurements,
      isTrainingTruth: Boolean(data?.is_training_truth),
    })

    return NextResponse.json({
      reviewedScoreSheet: data,
      reviewCompleteness,
      isOfficial,
    })
  } catch (err) {
    console.error('[save-score-sheet] Unexpected GET error:', err)
    return NextResponse.json(
      { error: 'Unexpected error fetching score sheet' },
      { status: 500 }
    )
  }
}
