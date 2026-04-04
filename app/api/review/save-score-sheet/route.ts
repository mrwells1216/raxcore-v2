import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildTrainingSample } from '@/lib/training/build-training-sample'
import { getReviewCompleteness } from '@/lib/review/review-completeness'

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
  const isOfficial = isTrainingTruth && reviewCompleteness >= 90
  const reviewedBy = 'human_review'

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
    bucket_id: buckId,
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
        warning: 'Reviewed sheet saved, but training sample refresh failed',
      },
      { status: 200 }
    )
  }

  return NextResponse.json({
    ok: true,
    reviewedScoreSheet: savedReviewedScoreSheet,
    updated,
    reviewCompleteness,
    isOfficial,
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
    const isOfficial = Boolean(data?.is_training_truth) && reviewCompleteness >= 90

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
