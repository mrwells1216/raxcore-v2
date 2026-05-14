import { NextResponse } from 'next/server'
import { scoreBuck, type ImageAnalysisInput } from '@/lib/scoring/ai-service'
import type { AngleType, RackType, HarvestMethod, SourceType, CaptureDevice, GroundTruthData } from '@/lib/types'
import { 
  createBuck, 
  addBuckImages, 
  createPrediction, 
  upsertGroundTruth,
  createTrainingExample,
  verifyTrainingExample,
  updateBuckStatus,
  getActiveModelVersion,
  getBuckImages
} from '@/lib/storage/service'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const state = String(formData.get('state') || '')
    const rackType = formData.get('rack_type') as RackType
    const harvestMethod = formData.get('harvest_method') as HarvestMethod | null
    const sourceType = formData.get('source_type') as SourceType | null
    const captureDevice = formData.get('capture_device') as CaptureDevice | null
    const earsFullyVisible = formData.get('ears_fully_visible') === 'true'
    const harvestYear = formData.get('harvest_year') ? Number(formData.get('harvest_year')) : null
    const mainFramePoints = formData.get('main_frame_points') ? Number(formData.get('main_frame_points')) : null
    const notes = formData.get('notes') ? String(formData.get('notes')) : null
    const nickname = formData.get('nickname') ? String(formData.get('nickname')) : null
    const location = formData.get('location') ? String(formData.get('location')) : state
    const harvestDate = formData.get('harvest_date') ? String(formData.get('harvest_date')) : null
    
    // Ground truth fields
    const officialScore = formData.get('official_score') ? Number(formData.get('official_score')) : null
    const mainBeamLeft = formData.get('main_beam_left') ? Number(formData.get('main_beam_left')) : null
    const mainBeamRight = formData.get('main_beam_right') ? Number(formData.get('main_beam_right')) : null
    const insideSpread = formData.get('inside_spread') ? Number(formData.get('inside_spread')) : null
    const pointsLeft = formData.get('points_left') ? Number(formData.get('points_left')) : null
    const pointsRight = formData.get('points_right') ? Number(formData.get('points_right')) : null
    const scoringMethod = formData.get('scoring_method') ? String(formData.get('scoring_method')) : 'official_scorer'
    const scorerNotes = formData.get('scorer_notes') ? String(formData.get('scorer_notes')) : null
    const verifyNow = formData.get('verify_now') === 'true'

    if (!state || !rackType) {
      return NextResponse.json({ error: 'State and rack type are required' }, { status: 400 })
    }

    // Collect images from form data
    const pendingImages: { dataUrl: string; angle: AngleType }[] = []
    const images: ImageAnalysisInput[] = []
    
    for (let i = 0; i < 10; i++) {
      const dataUrl = formData.get(`image_data_${i}`) as string | null
      const angle = formData.get(`angle_${i}`) as AngleType | null
      if (!dataUrl || !angle) continue
      pendingImages.push({ dataUrl, angle })
      images.push({ imageUrl: dataUrl, angleType: angle, width: 1920, height: 1080 })
    }

    if (!images.length) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
    }

    // Generate session ID
    const sessionId = `teach_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    // Create buck record
    const buck = await createBuck({
      sessionId,
      rackType: (rackType as 'typical' | 'non-typical') || 'typical',
      state: state ?? null,
      nickname: nickname || undefined,
      location: location || state,
      harvestDate: harvestDate || undefined,
      notes: notes || undefined
    })

    // Store images
    const imageUrls = pendingImages.map(p => p.dataUrl)
    await addBuckImages(buck.id, imageUrls)

    // Update status to processing
    await updateBuckStatus(buck.id, 'processing')

    // Run AI scoring
    const scored = await scoreBuck({
      images,
      state,
      rackType,
      earsFullyVisible,
      sourceType: sourceType || undefined,
      captureDevice: captureDevice || undefined,
      harvestYear: harvestYear || undefined,
      mainFramePoints: mainFramePoints || undefined,
    })

    // Get active model version
    const model = await getActiveModelVersion()

    // Store prediction
    const prediction = await createPrediction({
      buckId: buck.id,
      modelVersionId: model?.id,
      result: {
        prediction: {
          id: '',
          buck_id: buck.id,
          model_version_id: model?.id ?? null,
          predicted_gross: scored.predictedGross,
          predicted_net: scored.predictedNet ?? null,
          confidence_percent: scored.confidencePercent,
          score_range_low: scored.errorBandLow ?? null,
          score_range_high: scored.errorBandHigh ?? null,
          measurements: scored.measurements ?? null,
          landmarks: null,
          state_calibration: null,
          processing_time_ms: null,
          images_used: null,
          error_band_low: scored.errorBandLow ?? null,
          error_band_high: scored.errorBandHigh ?? null,
        },
      } as import('@/lib/types').ScoringResult
    })

    await updateBuckStatus(buck.id, 'completed')

    let trainingCreated = false
    let trainingExampleId: string | null = null

    // If official score provided, create ground truth and training example
    if (officialScore !== null) {
      // Create ground truth
      const groundTruthData: GroundTruthData = {
        officialScore,
        mainBeamLeft: mainBeamLeft ?? undefined,
        mainBeamRight: mainBeamRight ?? undefined,
        insideSpread: insideSpread ?? undefined,
        pointsLeft: pointsLeft ?? undefined,
        pointsRight: pointsRight ?? undefined,
        scoringMethod,
        scorerNotes: scorerNotes ?? undefined,
      }
      
      await upsertGroundTruth(buck.id, groundTruthData)

      // Get stored images
      const buckImages = await getBuckImages(buck.id)
      const storedImageUrls = buckImages.map(img => img.image_url).filter((u): u is string => u != null)

      // Create training example
      const trainingExample = await createTrainingExample({
        buckId: buck.id,
        imageUrls: storedImageUrls,
        groundTruthScore: officialScore,
        predictedScore: scored.predictedGross,
        measurements: {
          mainBeamLeft: mainBeamLeft ?? undefined,
          mainBeamRight: mainBeamRight ?? undefined,
          insideSpread: insideSpread ?? undefined,
          pointsLeft: pointsLeft ?? undefined,
          pointsRight: pointsRight ?? undefined,
        },
        source: 'admin_teach',
        notes: scorerNotes || 'Created via Admin Teach AI'
      })

      trainingExampleId = trainingExample.id
      trainingCreated = true

      // Verify immediately if requested
      if (verifyNow) {
        await verifyTrainingExample(trainingExample.id, 'admin', 5)
      }
    }

    return NextResponse.json({ 
      success: true, 
      buck_id: buck.id,
      session_id: buck.session_id,
      prediction: {
        estimated_score: scored.predictedGross,
        net_score: scored.predictedNet,
        confidence_percent: scored.confidencePercent,
        error_band_low: scored.errorBandLow,
        error_band_high: scored.errorBandHigh,
      },
      trainingCreated,
      trainingExampleId,
      error: officialScore !== null ? scored.predictedGross - officialScore : null
    })
  } catch (error) {
    console.error('Teach API error:', error)
    return NextResponse.json({ error: 'Failed to store training example', details: String(error) }, { status: 500 })
  }
}
