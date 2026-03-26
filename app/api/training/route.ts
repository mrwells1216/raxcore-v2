import { NextResponse } from 'next/server'
import { 
  getBuckById,
  getPredictionByBuckId,
  upsertGroundTruth,
  createTrainingExample,
  getBuckImages
} from '@/lib/storage/service'
import type { GroundTruthData } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      buck_id,
      official_score,
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
      officialScore: official_score ?? undefined,
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
      scorerNotes: scorer_notes ?? undefined,
    }

    // Upsert ground truth record
    const groundTruth = await upsertGroundTruth(buck_id, groundTruthData)

    // If we have both a prediction and an official score, create a training example
    let trainingExample = null
    if (prediction && official_score !== null && official_score !== undefined) {
      // Get buck images
      const images = await getBuckImages(buck_id)
      const imageUrls = images.map(img => img.image_url)

      trainingExample = await createTrainingExample({
        buckId: buck_id,
        imageUrls,
        groundTruthScore: official_score,
        predictedScore: prediction.estimated_score ?? undefined,
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
        notes: scorer_notes || 'Submitted through training flow'
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
