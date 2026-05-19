/**
 * D-PAD Adjustment API - Step 9
 * 
 * Handles:
 * - POST /api/scoring/dpad-adjust/preview - Live preview of adjustment effects
 * - POST /api/scoring/dpad-adjust/confirm - Confirm and persist adjustment
 * - GET /api/scoring/dpad-adjust?predictionId=xxx - Get adjustable points for a prediction
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  extractAdjustablePoints,
  recalculateMeasurement,
  estimateScoreDelta,
  generateTrainingRecords,
  createAdjustmentSession,
  addAdjustmentToSession,
  type PointAdjustment,
  type AdjustablePoint,
} from '@/lib/scoring/dpad-adjustment'
import type { DetailedLandmarks, Measurements } from '@/lib/types'
import { recordCorrectionEvent } from '@/lib/training/correction-events'

// ─────────────────────────────────────────────────────────────────────────────
// GET - Fetch adjustable points for a prediction
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const predictionId = searchParams.get('predictionId')
    const imageIndex = parseInt(searchParams.get('imageIndex') ?? '0', 10)

    if (!predictionId) {
      return NextResponse.json(
        { message: 'Missing predictionId parameter' },
        { status: 400 }
      )
    }

    // Fetch prediction with landmarks and measurements
    const { data: prediction, error: predictionError } = await supabase
      .from('predictions')
      .select(`
        id,
        buck_id,
        raw_ai_response,
        measurements,
        predicted_gross,
        confidence_percent,
        bucks!inner (
          id,
          buck_images (
            id,
            public_url,
            width,
            height,
            angle
          )
        )
      `)
      .eq('id', predictionId)
      .single()

    if (predictionError || !prediction) {
      return NextResponse.json(
        { message: 'Prediction not found' },
        { status: 404 }
      )
    }

    // Extract landmarks from raw AI response
    const rawResponse = prediction.raw_ai_response as any
    const landmarks = rawResponse?.landmarks as DetailedLandmarks | null
    const confidenceMap = rawResponse?.fieldConfidence as Record<string, number> | undefined

    // Get image dimensions
    const images = (prediction.bucks as any)?.buck_images ?? []
    const selectedImage = images[imageIndex] ?? images[0]
    
    if (!selectedImage) {
      return NextResponse.json(
        { message: 'No images found for this prediction' },
        { status: 404 }
      )
    }

    const imageDimensions = {
      width: selectedImage.width ?? 1920,
      height: selectedImage.height ?? 1080,
    }

    // Extract adjustable points
    const points = extractAdjustablePoints(landmarks, imageDimensions, confidenceMap)

    // Get current measurements
    const measurements = prediction.measurements as Partial<Measurements> ?? {}

    // Estimate scaling factor from image if available
    // Default to typical deer antler scale if not determinable
    const scalingFactor = rawResponse?.scalingFactor ?? 25 // ~25 pixels per inch as default

    return NextResponse.json({
      predictionId,
      buckId: prediction.buck_id,
      imageUrl: selectedImage.public_url,
      imageDimensions,
      points,
      measurements,
      currentScore: prediction.predicted_gross,
      scalingFactor,
      imageCount: images.length,
    })
  } catch (error) {
    console.error('[dpad-adjust GET] Error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST - Preview or confirm adjustment
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewRequest {
  action: 'preview'
  predictionId: string
  pointId: string
  newPosition: { x: number; y: number }
  allPoints: AdjustablePoint[]
  scalingFactor: number
  imageDimensions: { width: number; height: number }
  currentMeasurements: Record<string, number | null>
}

interface ConfirmRequest {
  action: 'confirm'
  predictionId: string
  buckId: string
  imageIndex: number
  adjustment: PointAdjustment
  allPoints: AdjustablePoint[]
  scalingFactor: number
  imageDimensions: { width: number; height: number }
  originalMeasurements: Record<string, number | null>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (action === 'preview') {
      return handlePreview(body as PreviewRequest, supabase)
    } else if (action === 'confirm') {
      return handleConfirm(body as ConfirmRequest, supabase, user.id)
    } else {
      return NextResponse.json(
        { message: 'Invalid action. Use "preview" or "confirm".' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('[dpad-adjust POST] Error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePreview(
  body: PreviewRequest,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const {
    predictionId,
    pointId,
    newPosition,
    allPoints,
    scalingFactor,
    imageDimensions,
    currentMeasurements,
  } = body

  // Find the point being adjusted
  const point = allPoints.find(p => p.id === pointId)
  if (!point) {
    return NextResponse.json(
      { message: 'Point not found' },
      { status: 400 }
    )
  }

  // Create a temporary adjustment
  const adjustment: PointAdjustment = {
    pointId,
    originalPosition: { x: point.x, y: point.y },
    newPosition,
    measurementKey: point.measurementKey,
    deltaPixels: {
      x: Math.round((newPosition.x - point.x) * imageDimensions.width),
      y: Math.round((newPosition.y - point.y) * imageDimensions.height),
    },
  }

  // Recalculate measurement
  const recalcResult = recalculateMeasurement(
    point.measurementKey,
    currentMeasurements[point.measurementKey] ?? null,
    adjustment,
    allPoints,
    scalingFactor,
    imageDimensions
  )

  // Estimate score delta
  const scoreDelta = estimateScoreDelta([recalcResult])

  // Get current score from prediction
  const { data: prediction } = await supabase
    .from('predictions')
    .select('predicted_gross')
    .eq('id', predictionId)
    .single()

  const currentScore = prediction?.predicted_gross ?? null
  const newScore = currentScore != null ? currentScore + scoreDelta : null

  return NextResponse.json({
    preview: {
      measurementKey: point.measurementKey,
      originalValue: recalcResult.originalValue,
      newMeasurementValue: recalcResult.newValue,
      delta: recalcResult.delta,
      confidence: recalcResult.confidence,
      method: recalcResult.method,
      currentScore,
      newScore,
      scoreDelta,
    },
  })
}

async function handleConfirm(
  body: ConfirmRequest,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const {
    predictionId,
    buckId,
    imageIndex,
    adjustment,
    allPoints,
    scalingFactor,
    imageDimensions,
    originalMeasurements,
  } = body

  // Get the current prediction
  const { data: prediction, error: predictionError } = await supabase
    .from('predictions')
    .select('id, predicted_gross, confidence_percent, measurements, raw_ai_response')
    .eq('id', predictionId)
    .single()

  if (predictionError || !prediction) {
    return NextResponse.json(
      { message: 'Prediction not found' },
      { status: 404 }
    )
  }

  // Recalculate measurement
  const recalcResult = recalculateMeasurement(
    adjustment.measurementKey,
    originalMeasurements[adjustment.measurementKey] ?? null,
    adjustment,
    allPoints,
    scalingFactor,
    imageDimensions
  )

  // Update measurements
  const updatedMeasurements = {
    ...(prediction.measurements as Record<string, any> ?? {}),
    [adjustment.measurementKey]: recalcResult.newValue,
  }

  // Calculate new score delta
  const scoreDelta = estimateScoreDelta([recalcResult])
  const newGross = prediction.predicted_gross != null 
    ? prediction.predicted_gross + scoreDelta 
    : null

  // Update raw AI response with adjustment metadata
  const rawResponse = prediction.raw_ai_response as Record<string, any> ?? {}
  const adjustmentHistory = rawResponse.dpadAdjustments ?? []
  adjustmentHistory.push({
    timestamp: new Date().toISOString(),
    userId,
    pointId: adjustment.pointId,
    measurementKey: adjustment.measurementKey,
    originalPosition: adjustment.originalPosition,
    newPosition: adjustment.newPosition,
    originalValue: recalcResult.originalValue,
    newValue: recalcResult.newValue,
    scoreDelta,
  })

  // Update prediction
  const { error: updateError } = await supabase
    .from('predictions')
    .update({
      measurements: updatedMeasurements,
      predicted_gross: newGross,
      raw_ai_response: {
        ...rawResponse,
        dpadAdjustments: adjustmentHistory,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', predictionId)

  if (updateError) {
    console.error('[dpad-adjust confirm] Update error:', updateError)
    return NextResponse.json(
      { message: 'Failed to save adjustment' },
      { status: 500 }
    )
  }

  // Record adjustment for training
  const trainingRecord = {
    prediction_id: predictionId,
    buck_id: buckId,
    user_id: userId,
    image_index: imageIndex,
    adjustment_type: 'dpad',
    point_id: adjustment.pointId,
    measurement_key: adjustment.measurementKey,
    original_position: adjustment.originalPosition,
    new_position: adjustment.newPosition,
    original_value: recalcResult.originalValue,
    new_value: recalcResult.newValue,
    score_delta: scoreDelta,
    created_at: new Date().toISOString(),
  }

  // Insert training record (non-blocking)
  supabase
    .from('dpad_adjustment_records')
    .insert(trainingRecord)
    .then(({ error }) => {
      if (error) {
        console.error('[dpad-adjust] Training record insert error:', error)
      }
    })

  // Derive confidence tier from stored confidence_percent for training analytics
  const confPct = (prediction as any).confidence_percent as number | null | undefined
  const confidenceTierBefore =
    confPct == null ? null :
    confPct >= 85 ? 'very_high' :
    confPct >= 75 ? 'high' :
    confPct >= 60 ? 'medium' :
    confPct >= 45 ? 'low' : 'very_low'

  // Also write to correction_events for unified flywheel tracking (non-blocking)
  recordCorrectionEvent({
    buckId,
    predictionId,
    userId: userId ?? null,
    correctionSource: 'dpad',
    fieldKey: adjustment.measurementKey,
    aiValue: recalcResult.originalValue ?? null,
    userValue: recalcResult.newValue ?? null,
    confidenceTierBefore,
  }).catch(err => console.warn('[dpad-adjust] correction_events insert failed (non-blocking)', err))

  return NextResponse.json({
    success: true,
    result: {
      measurementKey: adjustment.measurementKey,
      originalValue: recalcResult.originalValue,
      newValue: recalcResult.newValue,
      delta: recalcResult.delta,
      newScore: newGross,
      scoreDelta,
    },
  })
}
