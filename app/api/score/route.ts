import { NextResponse } from 'next/server'
import { scoreBuck, type ImageAnalysisInput } from '@/lib/scoring/ai-service'
import { SCORING_DISCLAIMER } from '@/lib/constants'
import type { AngleType, RackType, HarvestMethod, SourceType, CaptureDevice, IntakeQualitySummary } from '@/lib/types'
import { 
  createBuck, 
  addBuckImages, 
  createPrediction, 
  updateBuckStatus,
  getActiveModelVersion,
  getBuckImages
} from '@/lib/storage/service'
import { createUserNotification, createAdminTask } from '@/lib/notifications/service'
import {
  createUsageRecord,
  completeUsageRecord,
  validateScoringRequest,
  recordUsage,
  getActiveCostEstimate,
  calculateCost,
  getActiveProductionConfig,
} from '@/lib/usage/service'

// Generate a unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

// Extract client identifier from request
function getClientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown'
  return `ip:${ip}`
}

export async function POST(request: Request) {
  const requestId = generateRequestId()
  const clientKey = getClientKey(request)
  const requestStartTime = Date.now()
  
  // Track initial usage
  let usageRecordCreated = false
  let imageCount = 0
  
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
    const intakeQualityRaw = formData.get('intake_quality') as string | null
    const userId = formData.get('user_id') as string | null
    
    // Parse intake quality summary if provided
    let intakeQuality: IntakeQualitySummary | null = null
    if (intakeQualityRaw) {
      try {
        intakeQuality = JSON.parse(intakeQualityRaw)
      } catch {
        // Ignore parse errors
      }
    }

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
    
    imageCount = images.length

    // Phase 30: Validate request and check rate limits
    const productionConfig = await getActiveProductionConfig()
    const validationResult = await validateScoringRequest(imageCount, clientKey)
    
    if (!validationResult.valid) {
      return NextResponse.json({ 
        error: 'Request validation failed',
        userMessage: validationResult.errors[0] || 'Invalid request.',
        errors: validationResult.errors,
        errorType: 'validation',
      }, { status: 400 })
    }

    // Create usage tracking record
    await createUsageRecord({
      request_id: requestId,
      endpoint: '/api/score',
      method: 'POST',
      client_ip: clientKey.replace('ip:', ''),
      images_submitted: imageCount,
      user_agent: request.headers.get('user-agent') || undefined,
    })
    usageRecordCreated = true

    // Check if vision scoring is enabled
    if (!productionConfig.vision_scoring_enabled) {
      return NextResponse.json({
        error: 'Scoring temporarily unavailable',
        userMessage: 'The scoring service is temporarily unavailable. Please try again later.',
        errorType: 'service_disabled',
      }, { status: 503 })
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

    // Apply intake quality adjustments to confidence and error bands
    let adjustedConfidence = scoringResult.confidencePercent
    let adjustedErrorBandLow = scoringResult.errorBandLow
    let adjustedErrorBandHigh = scoringResult.errorBandHigh
    
    if (intakeQuality) {
      // Apply confidence adjustment from intake quality
      adjustedConfidence = Math.max(15, Math.min(95, adjustedConfidence + intakeQuality.confidenceAdjustment))
      
      // Apply error band widening
      if (intakeQuality.errorBandWidening > 1.0) {
        const midpoint = scoringResult.predictedGross
        const originalRange = scoringResult.errorBandHigh - scoringResult.errorBandLow
        const newRange = originalRange * intakeQuality.errorBandWidening
        adjustedErrorBandLow = midpoint - (newRange / 2)
        adjustedErrorBandHigh = midpoint + (newRange / 2)
      }
      
      // Add intake quality factors to confidence explanation
      if (intakeQuality.weakestFactors.length > 0) {
        scoringResult.confidenceExplanation.push(
          `Image quality factors: ${intakeQuality.weakestFactors.join(', ')}`
        )
      }
    }

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
      },
      intakeQuality: intakeQuality as Record<string, unknown> | null
    })

    // Update status to completed
    await updateBuckStatus(buck.id, 'completed')

    // Phase 34: Fire notifications (fire-and-forget, never block the response)
    const notificationPromises: Promise<void>[] = []

    if (userId) {
      // Always notify logged-in user to submit a real score for ground-truth
      notificationPromises.push(
        createUserNotification({
          userId,
          type: 'submit_real_score',
          title: 'Submit your real score to improve accuracy',
          body: 'Once you officially score this buck, adding the measurement helps train the AI.',
          linkHref: `/results/${buck.id}`,
          buckId: buck.id,
          priority: 'normal',
        })
      )

      // Notify if photo quality was poor
      if (intakeQuality && intakeQuality.tier === 'poor') {
        notificationPromises.push(
          createUserNotification({
            userId,
            type: 'better_photos_needed',
            title: 'Better photos would improve this score',
            body: `Accuracy was limited by image quality. ${intakeQuality.weakestFactors?.[0] ?? 'Try better lighting or a clearer angle.'}`,
            linkHref: `/results/${buck.id}`,
            buckId: buck.id,
            priority: 'high',
          })
        )
      }
    }

    // Admin task: flag low-quality submissions for dataset review
    if (intakeQuality && intakeQuality.tier === 'poor') {
      notificationPromises.push(
        createAdminTask({
          type: 'data_gap',
          title: `Low-quality submission: Buck ${buck.id.slice(-8)}`,
          body: `Intake quality tier: ${intakeQuality.tier}. Confidence: ${adjustedConfidence}%. May not be suitable for training.`,
          priority: 'low',
          linkHref: `/admin/submissions/${buck.id}`,
          relatedId: buck.id,
          relatedType: 'buck',
        })
      )
    }

    // Fire all notifications in parallel, don't await
    Promise.all(notificationPromises).catch(err =>
      console.error('[score] notification error:', err)
    )

    // Get stored images
    const buckImages = await getBuckImages(buck.id)

    // Phase 30: Complete usage tracking with success
    const processingTimeMs = Date.now() - requestStartTime
    const costEstimate = await getActiveCostEstimate()
    const cost = costEstimate ? calculateCost(imageCount, 1, costEstimate) : { total_cost_mc: 0 }
    
    if (usageRecordCreated) {
      await completeUsageRecord(requestId, true, {
        predictionId: prediction.id,
        imagesProcessed: imageCount,
        visionCalls: 1,
        retryCount: scoringResult.runtimeMetadata?.totalAttempts ? scoringResult.runtimeMetadata.totalAttempts - 1 : 0,
        usedFallback: scoringResult.scoringMethod === 'vision_with_fallback' || scoringResult.scoringMethod === 'heuristic',
        processingTimeMs,
        visionTimeMs: scoringResult.processingTimeMs,
        modelVersionId: model?.id,
        visionModel: scoringResult.visionModelUsed || undefined,
      })
      
      // Record usage for rate limiting
      await recordUsage(clientKey, 1, imageCount, cost.total_cost_mc)
    }

    // Return result
    return NextResponse.json({
      sessionId: buck.session_id,
      buckId: buck.id,
      estimatedScore: scoringResult.predictedGross,
      netScore: scoringResult.predictedNet,
      scoreRange: {
        low: adjustedErrorBandLow,
        high: adjustedErrorBandHigh
      },
      confidence: adjustedConfidence >= 75 ? 'high' : adjustedConfidence >= 50 ? 'medium' : 'low',
      confidencePercent: adjustedConfidence,
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
      // Phase 15: Intake quality
      intakeQuality: intakeQuality || null,
      // Phase 24: Runtime/fallback metadata
      fallbackMetadata: scoringResult.fallbackMetadata || null,
      runtimeMetadata: scoringResult.runtimeMetadata || null,
      imageValidationSummary: scoringResult.imageValidationSummary || null,
    })
  } catch (error) {
    // Phase 24: Enhanced error handling with user-safe messages
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isTimeout = errorMessage.toLowerCase().includes('timeout')
    const isRateLimit = errorMessage.toLowerCase().includes('rate') || errorMessage.includes('429')
    const isNetwork = errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fetch')
    
    // Determine error type for tracking
    const errorType = isTimeout ? 'timeout' : isRateLimit ? 'rate_limit' : isNetwork ? 'network' : 'unknown'
    
    // Log detailed error for debugging
    console.error('Scoring API error:', {
      requestId,
      error: errorMessage,
      errorType,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Phase 30: Track failed request
    const processingTimeMs = Date.now() - requestStartTime
    if (usageRecordCreated) {
      await completeUsageRecord(requestId, false, {
        imagesProcessed: imageCount,
        visionCalls: 0,
        processingTimeMs,
        errorType,
        errorMessage: errorMessage.slice(0, 500), // Truncate long error messages
      })
      
      // Still record usage for rate limiting (prevents retry abuse)
      try {
        await recordUsage(clientKey, 1, imageCount, 0)
      } catch (usageError) {
        console.error('Failed to record usage:', usageError)
      }
    }

    // Determine user-safe error message
    let userMessage = 'An unexpected error occurred during scoring. Please try again.'
    let statusCode = 500
    
    if (isTimeout) {
      userMessage = 'The scoring service is taking longer than expected. Please try again.'
      statusCode = 504
    } else if (isRateLimit) {
      userMessage = 'The service is currently busy. Please wait a moment and try again.'
      statusCode = 429
    } else if (isNetwork) {
      userMessage = 'A network error occurred. Please check your connection and try again.'
      statusCode = 503
    }

    return NextResponse.json({ 
      error: 'Scoring failed', 
      userMessage,
      requestId,
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      errorType,
    }, { status: statusCode })
  }
}
