import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createValidationResult } from '@/lib/validation/service'
import type { ConfidenceTier, TrustTier } from '@/lib/types'

const CONFIDENCE_TIERS: ConfidenceTier[] = ['very_high', 'high', 'medium', 'low', 'very_low']
const TRUST_TIERS: TrustTier[] = ['excellent', 'good', 'fair', 'limited', 'uncertain']

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// POST /api/admin/validation/record-result
// Records ground-truth verification for a prediction and fires Phase 52 supervision hooks.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const runId = typeof body.runId === 'string' ? body.runId : null
    const predictionId = typeof body.predictionId === 'string' ? body.predictionId : null
    const groundTruthGross = isNumber(body.groundTruthGross) ? body.groundTruthGross : null
    const groundTruthNet = isNumber(body.groundTruthNet) ? body.groundTruthNet : null

    if (!runId || !predictionId || groundTruthGross === null) {
      return NextResponse.json(
        { success: false, error: 'runId, predictionId, and groundTruthGross are required' },
        { status: 400 }
      )
    }

    const { data: prediction, error: predErr } = await supabase
      .from('predictions')
      .select(
        'id, buck_id, predicted_gross, predicted_net, confidence_percent, scoring_method, processing_time_ms, error_band_low, error_band_high'
      )
      .eq('id', predictionId)
      .single()

    if (predErr || !prediction) {
      return NextResponse.json({ success: false, error: 'Prediction not found' }, { status: 404 })
    }

    if (!isNumber(prediction.predicted_gross)) {
      return NextResponse.json(
        { success: false, error: 'Prediction has no predicted_gross' },
        { status: 400 }
      )
    }

    const { data: existingExample } = await supabase
      .from('training_examples')
      .select('id')
      .eq('prediction_id', predictionId)
      .maybeSingle()

    const trainingExampleId =
      typeof body.trainingExampleId === 'string' ? body.trainingExampleId : existingExample?.id

    if (!trainingExampleId) {
      return NextResponse.json(
        { success: false, error: 'No training_example found for this prediction; create one first' },
        { status: 400 }
      )
    }

    const { data: buck } = await supabase
      .from('bucks')
      .select('state, rack_type')
      .eq('id', prediction.buck_id)
      .single()

    const predictedIntervalLow = isNumber(body.predictedIntervalLow)
      ? body.predictedIntervalLow
      : isNumber(prediction.error_band_low)
      ? prediction.error_band_low
      : undefined
    const predictedIntervalHigh = isNumber(body.predictedIntervalHigh)
      ? body.predictedIntervalHigh
      : isNumber(prediction.error_band_high)
      ? prediction.error_band_high
      : undefined

    const confidenceTierRaw = typeof body.confidenceTier === 'string' ? body.confidenceTier : null
    const confidenceTier = confidenceTierRaw && CONFIDENCE_TIERS.includes(confidenceTierRaw as ConfidenceTier)
      ? (confidenceTierRaw as ConfidenceTier)
      : undefined

    const trustTierRaw = typeof body.trustTier === 'string' ? body.trustTier : null
    const trustTier = trustTierRaw && TRUST_TIERS.includes(trustTierRaw as TrustTier)
      ? (trustTierRaw as TrustTier)
      : undefined

    const segment = typeof body.segment === 'string' ? body.segment : undefined

    const result = await createValidationResult({
      runId,
      trainingExampleId,
      buckId: prediction.buck_id,
      groundTruthGross,
      groundTruthNet,
      predictedGross: prediction.predicted_gross,
      predictedNet: prediction.predicted_net,
      confidencePercent: prediction.confidence_percent,
      state: buck?.state ?? null,
      rackType: buck?.rack_type ?? null,
      scoringMethod: prediction.scoring_method ?? null,
      processingTimeMs: prediction.processing_time_ms,
      predictionId,
      predictedIntervalLow,
      predictedIntervalHigh,
      confidenceTier,
      trustTier,
      segment,
    })

    return NextResponse.json({
      success: true,
      data: result,
      supervision: {
        intervalAvailable: predictedIntervalLow !== undefined && predictedIntervalHigh !== undefined,
        confidenceTierProvided: confidenceTier !== undefined,
      },
    })
  } catch (error) {
    console.error('Error recording validation result:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to record validation result' },
      { status: 500 }
    )
  }
}
