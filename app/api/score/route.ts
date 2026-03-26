import { NextResponse } from 'next/server'
import { scoreBuck, type ImageAnalysisInput } from '@/lib/scoring/ai-service'
import { SCORING_DISCLAIMER } from '@/lib/constants'
import type { AngleType, RackType, HarvestMethod, SourceType, CaptureDevice } from '@/lib/types'
import { 
  createBuck, 
  addBuckImages, 
  createPrediction, 
  updateBuckStatus,
  getActiveModelVersion,
  getBuckImages
} from '@/lib/storage/service'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const state = formData.get('state') as string
    const rackType = formData.get('rack_type') as RackType
    const harvestMethod = formData.get('harvest_method') as HarvestMethod | null
    const sourceType = formData.get('source_type') as SourceType | null
    const captureDevice = formData.get('capture_device') as CaptureDevice | null
    const earsFullyVisible = formData.get('ears_fully_visible') === 'true'
    const harvestYearRaw = formData.get('harvest_year') as string | null
    const mainFrameRaw = formData.get('main_frame_points') as string | null
    const notes = formData.get('notes') as string | null
    const nickname = formData.get('nickname') as string | null
    const location = formData.get('location') as string | null
    const harvestDate = formData.get('harvest_date') as string | null

    if (!state || !rackType) {
      return NextResponse.json({ error: 'State and rack type are required' }, { status: 400 })
    }

    const harvestYear = harvestYearRaw ? Number(harvestYearRaw) : null
    const mainFramePoints = mainFrameRaw ? Number(mainFrameRaw) : null

    // Collect images from form data
    const pendingImages: { dataUrl?: string; url?: string; angle: AngleType }[] = []
    const images: ImageAnalysisInput[] = []

    for (let i = 0; i < 10; i++) {
      const dataUrl = formData.get(`image_data_${i}`) as string | null
      const url = formData.get(`image_url_${i}`) as string | null
      const angle = formData.get(`angle_${i}`) as AngleType | null
      if (!angle) continue
      
      if (dataUrl) {
        pendingImages.push({ dataUrl, angle })
        images.push({ imageUrl: dataUrl, angleType: angle, width: 1920, height: 1080 })
      } else if (url) {
        pendingImages.push({ url, angle })
        images.push({ imageUrl: url, angleType: angle, width: 1920, height: 1080 })
      }
    }

    if (images.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
    }

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    // Create buck record in Supabase
    const buck = await createBuck({
      sessionId,
      nickname: nickname || undefined,
      location: location || state,
      harvestDate: harvestDate || undefined,
      notes: notes || undefined
    })

    // Store image URLs (using data URLs or external URLs for now)
    const imageUrls = pendingImages.map(p => p.dataUrl || p.url || '')
    await addBuckImages(buck.id, imageUrls)

    // Update status to processing
    await updateBuckStatus(buck.id, 'processing')

    // Run AI scoring
    const scoringResult = await scoreBuck({
      images,
      state,
      rackType,
      earsFullyVisible,
      sourceType: sourceType || undefined,
      captureDevice: captureDevice || undefined,
      harvestYear: Number.isFinite(harvestYear) ? harvestYear ?? undefined : undefined,
      mainFramePoints: Number.isFinite(mainFramePoints) ? mainFramePoints ?? undefined : undefined,
    })

    // Get active model version
    const model = await getActiveModelVersion()

    // Store prediction
    const prediction = await createPrediction({
      buckId: buck.id,
      modelVersionId: model?.id,
      result: {
        estimatedScore: scoringResult.predictedGross,
        scoreRange: { low: scoringResult.errorBandLow, high: scoringResult.errorBandHigh },
        confidence: scoringResult.confidencePercent >= 75 ? 'high' : scoringResult.confidencePercent >= 50 ? 'medium' : 'low',
        mainBeamLeft: scoringResult.measurements.main_beam_left ?? undefined,
        mainBeamRight: scoringResult.measurements.main_beam_right ?? undefined,
        insideSpread: scoringResult.measurements.inside_spread ?? undefined,
        pointsLeft: scoringResult.measurements.g5_left ? 6 : scoringResult.measurements.g4_left ? 5 : 4,
        pointsRight: scoringResult.measurements.g5_right ? 6 : scoringResult.measurements.g4_right ? 5 : 4,
        massEstimate: 'average',
        tineLengths: {
          g1_left: scoringResult.measurements.g1_left ?? 0,
          g1_right: scoringResult.measurements.g1_right ?? 0,
          g2_left: scoringResult.measurements.g2_left ?? 0,
          g2_right: scoringResult.measurements.g2_right ?? 0,
          g3_left: scoringResult.measurements.g3_left ?? 0,
          g3_right: scoringResult.measurements.g3_right ?? 0,
          g4_left: scoringResult.measurements.g4_left ?? 0,
          g4_right: scoringResult.measurements.g4_right ?? 0,
        },
        circumferences: {
          h1_left: scoringResult.measurements.h1_left ?? 0,
          h1_right: scoringResult.measurements.h1_right ?? 0,
          h2_left: scoringResult.measurements.h2_left ?? 0,
          h2_right: scoringResult.measurements.h2_right ?? 0,
          h3_left: scoringResult.measurements.h3_left ?? 0,
          h3_right: scoringResult.measurements.h3_right ?? 0,
          h4_left: scoringResult.measurements.h4_left ?? 0,
          h4_right: scoringResult.measurements.h4_right ?? 0,
        },
        confidenceExplanation: scoringResult.confidenceExplanation,
        scalingReferencesUsed: scoringResult.scalingReferencesUsed,
        disclaimer: SCORING_DISCLAIMER
      },
      rawResponse: {
        ...scoringResult,
        state,
        rackType
      }
    })

    // Update status to completed
    await updateBuckStatus(buck.id, 'completed')

    // Get stored images
    const buckImages = await getBuckImages(buck.id)

    // Return result
    return NextResponse.json({
      sessionId: buck.session_id,
      buckId: buck.id,
      estimatedScore: scoringResult.predictedGross,
      netScore: scoringResult.predictedNet,
      scoreRange: {
        low: scoringResult.errorBandLow,
        high: scoringResult.errorBandHigh
      },
      confidence: scoringResult.confidencePercent >= 75 ? 'high' : scoringResult.confidencePercent >= 50 ? 'medium' : 'low',
      confidencePercent: scoringResult.confidencePercent,
      measurements: scoringResult.measurements,
      landmarks: scoringResult.landmarks,
      stateCalibration: scoringResult.stateCalibration,
      confidenceExplanation: scoringResult.confidenceExplanation,
      scalingReferencesUsed: scoringResult.scalingReferencesUsed,
      learningSummary: scoringResult.learningSummary,
      disclaimer: SCORING_DISCLAIMER,
      images: buckImages.map(img => img.image_url),
      prediction,
      processingTimeMs: scoringResult.processingTimeMs,
      // Vision scoring metadata
      scoringMethod: scoringResult.scoringMethod,
      visionModelUsed: scoringResult.visionModelUsed,
      visionConfidence: scoringResult.visionConfidence,
      // Phase 9: Stabilization metadata
      normalizationApplied: scoringResult.normalizationApplied,
      normalizationAdjustments: scoringResult.normalizationAdjustments,
      landmarkConsistencyScore: scoringResult.landmarkConsistencyScore,
      confidenceReliability: scoringResult.confidenceReliability,
      // Phase 10: Extended learning data (for admin)
      extendedLearningSummary: scoringResult.extendedLearningSummary,
    })
  } catch (error) {
    console.error('Scoring API error:', error)
    return NextResponse.json({ error: 'Scoring failed', details: String(error) }, { status: 500 })
  }
}
