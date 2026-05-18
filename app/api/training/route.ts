import { NextResponse } from 'next/server'
import { 
  getBuckById,
  getPredictionByBuckId,
  upsertGroundTruth,
  createTrainingExample,
  getBuckImages
} from '@/lib/storage/service'
import type { GroundTruthData } from '@/lib/types'

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function confidenceLabel(value: unknown): 'low' | 'medium' | 'high' | null {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  const n = toNumber(value)
  if (n === null) return null
  const percent = n <= 1 ? n * 100 : n
  if (percent >= 75) return 'high'
  if (percent >= 50) return 'medium'
  return 'low'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      buck_id,
      prediction_id,
      official_gross,
      official_net,
      official_score,
      score_source,
      scorer_name,
      scoring_organization,
      harvest_year,
      notes,
      main_beam_left,
      main_beam_right,
      inside_spread,
      points_left,
      points_right,
      g1_left,
      g1_right,
      g2_left,
      g2_right,
      g3_left,
      g3_right,
      g4_left,
      g4_right,
      h1_left,
      h1_right,
      h2_left,
      h2_right,
      h3_left,
      h3_right,
      h4_left,
      h4_right,
      scoring_method,
      scorer_notes,
    } = body

    const submittedGross = toNumber(official_score) ?? toNumber(official_gross)
    const submittedNet = toNumber(official_net)
    const submittedNotes = typeof scorer_notes === 'string'
      ? scorer_notes
      : typeof notes === 'string'
        ? notes
        : undefined

    if (!buck_id) {
      return NextResponse.json({ error: 'Buck ID is required' }, { status: 400 })
    }

    // Verify buck exists
    const buck = await getBuckById(buck_id)
    if (!buck) {
      return NextResponse.json({ error: 'Buck not found' }, { status: 404 })
    }

    // Get the prediction for this buck
    const prediction = await getPredictionByBuckId(buck_id)

    // Build ground truth data
    const groundTruthData: GroundTruthData = {
      officialScore: submittedGross ?? undefined,
      officialNet: submittedNet ?? undefined,
      scoreSource: score_source ?? undefined,
      scorerName: scorer_name ?? undefined,
      scoringOrganization: scoring_organization ?? undefined,
      harvestYear: toNumber(harvest_year) ?? undefined,
      notes: typeof notes === 'string' ? notes : undefined,
      mainBeamLeft: main_beam_left ?? undefined,
      mainBeamRight: main_beam_right ?? undefined,
      insideSpread: inside_spread ?? undefined,
      pointsLeft: points_left ?? undefined,
      pointsRight: points_right ?? undefined,
      g1Left: g1_left ?? undefined,
      g1Right: g1_right ?? undefined,
      g2Left: g2_left ?? undefined,
      g2Right: g2_right ?? undefined,
      g3Left: g3_left ?? undefined,
      g3Right: g3_right ?? undefined,
      g4Left: g4_left ?? undefined,
      g4Right: g4_right ?? undefined,
      h1Left: h1_left ?? undefined,
      h1Right: h1_right ?? undefined,
      h2Left: h2_left ?? undefined,
      h2Right: h2_right ?? undefined,
      h3Left: h3_left ?? undefined,
      h3Right: h3_right ?? undefined,
      h4Left: h4_left ?? undefined,
      h4Right: h4_right ?? undefined,
      scoringMethod: scoring_method ?? undefined,
      scorerNotes: submittedNotes,
    }

    // Upsert ground truth record
    const groundTruth = await upsertGroundTruth(buck_id, groundTruthData)

    // If we have both a prediction and an official score, create a training example
    let trainingExample = null
    if (prediction && submittedGross !== null) {
      // Get buck images
      const images = await getBuckImages(buck_id)
      const imageUrls = images.map(img => img.image_url).filter((u): u is string => u != null)
      const predictionRecord = prediction as unknown as Record<string, unknown>
      const rawAi = predictionRecord.raw_ai_response && typeof predictionRecord.raw_ai_response === 'object'
        ? predictionRecord.raw_ai_response as Record<string, unknown>
        : null
      const predictedGross =
        toNumber(prediction.predicted_gross) ??
        toNumber(prediction.estimated_score) ??
        toNumber(rawAi?.predictedGross) ??
        toNumber(rawAi?.estimatedScore)
      const predictedNet =
        toNumber(prediction.predicted_net) ??
        toNumber(rawAi?.predictedNet) ??
        toNumber(rawAi?.netScore)
      const predictedRangeLow =
        toNumber(prediction.score_range_low) ??
        toNumber(rawAi?.errorBandLow)
      const predictedRangeHigh =
        toNumber(prediction.score_range_high) ??
        toNumber(rawAi?.errorBandHigh)
      const imageCount =
        toNumber(prediction.images_used) ??
        (Array.isArray(imageUrls) ? imageUrls.length : null)

      // Build a compact metadata snapshot so we can reconstruct the prediction
      // context later for correction-profile analysis, without requiring new schema columns.
      const predictionSnapshot = {
        prediction_id: prediction_id ?? prediction.id ?? null,
        predicted_gross: predictedGross,
        predicted_net: predictedNet,
        confidence_percent: toNumber(prediction.confidence_percent) ?? toNumber(rawAi?.confidencePercent),
        confidence_label: confidenceLabel(prediction.confidence_label ?? prediction.confidence ?? rawAi?.confidencePercent),
        scoring_method: prediction.scoring_method ?? rawAi?.scoringMethod ?? null,
        fallback_used: prediction.fallback_used ?? predictionRecord.used_fallback ?? rawAi?.fallbackMetadata != null,
        images_used: imageCount,
        score_source: score_source ?? null,
        error_gross:
          predictedGross != null
            ? Number((submittedGross - predictedGross).toFixed(2))
            : null,
        error_net:
          predictedNet != null && submittedNet != null
            ? Number((submittedNet - predictedNet).toFixed(2))
            : null,
        submitted_at: new Date().toISOString(),
      }

      const enrichedNotes = [
        submittedNotes || 'Submitted through training flow',
        `[meta] ${JSON.stringify(predictionSnapshot)}`,
      ].join('\n')

      trainingExample = await createTrainingExample({
        buckId: buck_id,
        predictionId: prediction_id ?? prediction.id ?? undefined,
        groundTruthId: groundTruth.id,
        imageUrls,
        groundTruthScore: submittedGross,
        groundTruthNet: submittedNet ?? undefined,
        predictedScore: predictedGross ?? undefined,
        predictedNet,
        predictedRangeLow,
        predictedRangeHigh,
        state: buck.state ?? null,
        rackType: buck.rack_type ?? null,
        sourceType: buck.source_type ?? null,
        imageCount,
        confidenceLabel: predictionSnapshot.confidence_label,
        fallbackUsed: Boolean(predictionSnapshot.fallback_used),
        measurements: {
          mainBeamLeft: main_beam_left ?? undefined,
          mainBeamRight: main_beam_right ?? undefined,
          insideSpread: inside_spread ?? undefined,
          pointsLeft: points_left ?? undefined,
          pointsRight: points_right ?? undefined,
          tineMeasurements: {
            g1_left: g1_left ?? 0,
            g1_right: g1_right ?? 0,
            g2_left: g2_left ?? 0,
            g2_right: g2_right ?? 0,
            g3_left: g3_left ?? 0,
            g3_right: g3_right ?? 0,
            g4_left: g4_left ?? 0,
            g4_right: g4_right ?? 0,
          },
          circumferenceMeasurements: {
            h1_left: h1_left ?? 0,
            h1_right: h1_right ?? 0,
            h2_left: h2_left ?? 0,
            h2_right: h2_right ?? 0,
            h3_left: h3_left ?? 0,
            h3_right: h3_right ?? 0,
            h4_left: h4_left ?? 0,
            h4_right: h4_right ?? 0,
          }
        },
        source: 'user_submission',
        notes: enrichedNotes,
      })
    }

    return NextResponse.json({ 
      success: true, 
      ground_truth_id: groundTruth.id,
      training_example_id: trainingExample?.id || null,
      message: trainingExample 
        ? 'Ground truth and training example created successfully'
        : 'Ground truth saved. Add an official score to create a training example.'
    })
  } catch (error) {
    console.error('Training API error:', error)
    return NextResponse.json({ error: 'Failed to submit training data', details: String(error) }, { status: 500 })
  }
}
