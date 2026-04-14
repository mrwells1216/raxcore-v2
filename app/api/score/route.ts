import { NextResponse } from 'next/server'
import { hasRequiredServerEnv } from '@/lib/env'
import { scoreBuck, type ImageAnalysisInput } from '@/lib/scoring/ai-service'
import { computeConfidence } from '@/lib/confidence/engine'
import { SCORING_DISCLAIMER } from '@/lib/constants'
import type { AngleType, RackType, HarvestMethod, SourceType, CaptureDevice, IntakeQualitySummary, YesNoUnsure, AbnormalPointTag } from '@/lib/types'
import { 
  createBuck, 
  addBuckImages, 
  uploadBuckImage,
  getBuckImageBucketName,
  createPrediction, 
  updateBuckStatus,
  getActiveModelVersion,
  getBuckImages
} from '@/lib/storage/service'
import { createGatedUserNotification, createAdminTask } from '@/lib/notifications/service'
import {
  createUsageRecord,
  completeUsageRecord,
  validateScoringRequest,
  recordUsage,
  getActiveCostEstimate,
  calculateCost,
  getActiveProductionConfig,
} from '@/lib/usage/service'
import {
  checkUserLimit,
  checkGuestLimit,
  recordScoringRun,
  ensureUserHasPlan,
  getUserPlanStatus,
} from '@/lib/billing/service'
import { maybeNotifyLowCredits } from '@/lib/billing/notifications'
import { logEventFireForget } from '@/lib/monitoring/service'
import { buildScoreSheet } from '@/lib/scoring/score-sheet'
import { buildFieldProvenanceFromMeasurements } from '@/lib/rules-engine/field-provenance'
import { getBestCalibrationProfile, applyCalibration } from '@/lib/calibration'
import { startPrecisionPass } from '@/lib/reverse-engineering/service'
import { detectRackWithOpenAI } from '@/lib/detection/detect-rack-with-openai'
import { buildMultiImageDetectionSummary } from '@/lib/detection/build-antler-graph'
import type { MultiImageDetectionResult } from '@/lib/detection/types'

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
  // Verify env vars before any scoring logic using shared validator
  const envCheck = hasRequiredServerEnv()
  if (!envCheck.ok) {
    console.error('[score] Missing required environment variables:', envCheck.missing)
    return NextResponse.json(
      {
        error: 'Server configuration error: missing environment variables',
        missing: envCheck.missing,
        fix: 'Set these variables in the Vercel/v0 project environment settings. Do not rely on .env file rewrites during dev restarts.',
      },
      { status: 500 }
    )
  }

  const requestId = generateRequestId()
  const clientKey = getClientKey(request)
  const requestStartTime = Date.now()
  
  // Track initial usage
  let usageRecordCreated = false
  // Phase 39: Log score request started
  logEventFireForget({
    traceId: requestId,
    eventType: 'score_started',
    service: 'score',
    route: '/api/score',
    status: 'info',
  })
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
  const selectedImageAnglesRaw = formData.get('selected_image_angles') as string | null
  const captureQualitySummaryRaw = formData.get('capture_quality_summary') as string | null
  const precisionModeEnabledRaw = formData.get('precision_mode_enabled') as string | null
  const referenceTypeRaw = formData.get('reference_type') as string | null
  const referenceNotesRaw = formData.get('reference_notes') as string | null
  const referenceModeSummaryRaw = formData.get('reference_mode_summary') as string | null
  const imageDiagnosticsRaw = formData.get('image_diagnostics') as string | null
  const imageDiagnosticsSummaryRaw = formData.get('image_diagnostics_summary') as string | null
  const userId = formData.get('user_id') as string | null
    
    // Phase 54: Abnormal/Irregular Points
    const irregularPointsPresent = formData.get('irregular_points_present') as YesNoUnsure | null
    const nonTypicalTraitsPresent = formData.get('non_typical_traits_present') as YesNoUnsure | null
    const estimatedIrregularCountRaw = formData.get('estimated_irregular_points_count') as string | null
    const abnormalPointNotes = formData.get('abnormal_point_notes') as string | null
    const abnormalTagsRaw = formData.get('abnormal_point_tags') as string | null
    
    // Parse abnormal point count
    const estimatedIrregularPointsCount = estimatedIrregularCountRaw ? Number(estimatedIrregularCountRaw) : undefined
    
    // Parse abnormal point tags
    let abnormalPointTags: AbnormalPointTag[] | undefined
    if (abnormalTagsRaw) {
      try {
        abnormalPointTags = JSON.parse(abnormalTagsRaw)
      } catch {
        // Ignore parse errors
      }
    }
    
    // Parse intake quality summary if provided
    let intakeQuality: IntakeQualitySummary | null = null
    if (intakeQualityRaw) {
      try {
        intakeQuality = JSON.parse(intakeQualityRaw)
      } catch {
        // Ignore parse errors
      }
    }

    // Debug: Log parsed form values
    console.log('[v0] Parsed form data - state:', state, 'rackType:', rackType)
    
    if (!state || !rackType) {
      console.error('[v0] Validation failed - state:', state, 'rackType:', rackType)
      return NextResponse.json({ error: 'State and rack type are required' }, { status: 400 })
    }

    const harvestYear = harvestYearRaw ? Number(harvestYearRaw) : null
    const mainFramePoints = mainFrameRaw ? Number(mainFrameRaw) : null

    // Collect images from form data — data URLs are held separately and uploaded
    // to Supabase Storage after the buck is created so we have a real https:// URL
    // to pass to OpenAI. Using data: URLs directly causes "URL scheme must be http
    // or https" errors from the OpenAI API.
    const pendingImages: { dataUrl?: string; url?: string; angle: AngleType }[] = []

    for (let i = 0; i < 10; i++) {
      const dataUrl = formData.get(`image_data_${i}`) as string | null
      const url = formData.get(`image_url_${i}`) as string | null
      const angle = formData.get(`angle_${i}`) as AngleType | null
      if (!angle) continue

      if (dataUrl) {
        pendingImages.push({ dataUrl, angle })
      } else if (url) {
        pendingImages.push({ url, angle })
      }
    }

    if (pendingImages.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
    }
    
    imageCount = pendingImages.length

    // Phase 38: Per-user plan limit enforcement (runs before any DB writes or AI calls)
    const sessionId = formData.get('session_id') as string | null
    const clientIp = clientKey.replace('ip:', '')

    if (userId) {
      // Authenticated user — check plan limits
      await ensureUserHasPlan(userId)
      const limitCheck = await checkUserLimit(userId, imageCount)
      if (!limitCheck.allowed) {
        // Record the blocked attempt in ledger then return
        await recordScoringRun({
          userId,
          sessionId: sessionId ?? undefined,
          clientIp,
          imagesCount: imageCount,
          status: 'blocked',
          blockReason: limitCheck.reason,
        })
        return NextResponse.json({
          error: 'Plan limit reached',
          userMessage: limitCheck.userMessage,
          errorType: 'plan_limit',
          reason: limitCheck.reason,
          plan: limitCheck.plan ? {
            id: limitCheck.plan.plan_id,
            name: limitCheck.plan.plan_name,
          } : null,
        }, { status: 429 })
      }
    } else {
      // Guest — check session-based limit
      const guestSessionId = sessionId ?? `anon_${clientIp}`
      const guestCheck = await checkGuestLimit(guestSessionId, imageCount)
      if (!guestCheck.allowed) {
        await recordScoringRun({
          sessionId: guestSessionId,
          clientIp,
          imagesCount: imageCount,
          planId: 'guest',
          status: 'blocked',
          blockReason: guestCheck.reason,
        })
        return NextResponse.json({
          error: 'Guest limit reached',
          userMessage: guestCheck.userMessage,
          errorType: 'plan_limit',
          reason: guestCheck.reason,
          requiresAuth: true,
        }, { status: 429 })
      }
    }

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

    // Create usage tracking record (non-blocking - scoring continues if this fails)
    try {
      await createUsageRecord({
        request_id: requestId,
        endpoint: '/api/score',
        method: 'POST',
        client_ip: clientKey.replace('ip:', ''),
        images_submitted: imageCount,
        user_agent: request.headers.get('user-agent') || undefined,
      })
      usageRecordCreated = true
    } catch (usageErr) {
      console.error('[score] Non-blocking usage record create failed:', usageErr)
      // Continue scoring - usage logging is not critical
    }

    // Check if vision scoring is enabled
    if (!productionConfig.vision_scoring_enabled) {
      return NextResponse.json({
        error: 'Scoring temporarily unavailable',
        userMessage: 'The scoring service is temporarily unavailable. Please try again later.',
        errorType: 'service_disabled',
      }, { status: 503 })
    }

    // Generate internal buck session ID (distinct from the form session_id)
    const buckSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  // Create buck record in Supabase (pass all fields from wizard)
  const buck = await createBuck({
    state: state,
    rackType: rackType,
    userId: userId || undefined,
    harvestMethod: harvestMethod || undefined,
    sourceType: sourceType || undefined,
    earsFullyVisible: earsFullyVisible,
    notes: notes || undefined,
    // Phase 54: Abnormal/Irregular Points
    irregularPointsPresent: irregularPointsPresent || undefined,
    nonTypicalTraitsPresent: nonTypicalTraitsPresent || undefined,
    estimatedIrregularPointsCount: estimatedIrregularPointsCount,
    abnormalPointNotes: abnormalPointNotes || undefined,
    abnormalPointTags: abnormalPointTags,
  })

    // Upload data URL images to Supabase Storage so we have real https:// URLs.
    // OpenAI vision requires http/https — data: URL scheme is rejected by the API.
    // We never silently fall back to data: when using OpenAI; instead we fail with
    // an actionable error so the user knows exactly what to fix.
    const isOpenAI = !!process.env.OPENAI_API_KEY
    const bucket = getBuckImageBucketName()
    const resolvedImages: ImageAnalysisInput[] = []
    const storedImageUrls: string[] = []

    console.log('[score] image upload phase', {
      bucket,
      imageCount: pendingImages.length,
      provider: isOpenAI ? 'openai' : 'heuristic',
    })

    for (let i = 0; i < pendingImages.length; i++) {
      const p = pendingImages[i]
      let imageUrl: string

      if (p.dataUrl) {
        try {
          imageUrl = await uploadBuckImage(buck.id, p.dataUrl, i)
          console.log(`[score] image ${i} uploaded to storage: ${imageUrl.substring(0, 80)}`)
        } catch (uploadErr) {
          const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr)

          if (isOpenAI) {
            // Hard fail — OpenAI cannot accept data: URLs. Surface the exact error.
            console.error(`[score] image ${i} upload failed and provider is OpenAI — cannot proceed with data: URL`, errMsg)
            return NextResponse.json(
              {
                error: 'Image storage upload failed. OpenAI vision requires https:// image URLs.',
                detail: errMsg,
                bucket,
                fix: `Create a Supabase Storage bucket named exactly "${bucket}" and set it to Public, or check that your service-role key has storage.write permissions.`,
              },
              { status: 500 }
            )
          }

          // Non-OpenAI path (heuristic fallback already handles data: URLs)
          console.warn(`[score] image ${i} upload failed, using data URL (non-OpenAI path):`, errMsg)
          imageUrl = p.dataUrl
        }
      } else {
        imageUrl = p.url || ''
      }

      storedImageUrls.push(imageUrl)
      resolvedImages.push({ imageUrl, angleType: p.angle, width: 1920, height: 1080 })
    }

    // Store the resolved URLs
    await addBuckImages(buck.id, storedImageUrls)

    // Update status to processing
    await updateBuckStatus(buck.id, 'processing')

    // ─────────────────────────────────────────────────────────────────────────────
    // Detection Phase: Validate deer/rack presence before scoring
    // ─────────────────────────────────────────────────────────────────────────────
    let detectionSummary: MultiImageDetectionResult | null = null
    
    try {
      console.log('[score] starting detection phase', { imageCount: storedImageUrls.length })
      const detectionImages = await detectRackWithOpenAI(storedImageUrls)
      detectionSummary = buildMultiImageDetectionSummary(detectionImages)
      
      console.log('[score] detection complete', {
        accepted: detectionSummary.accepted,
        overallSubjectType: detectionSummary.overallSubjectType,
        overallConfidence: detectionSummary.overallConfidence,
        acceptedImageCount: detectionSummary.images.filter(i => i.accepted).length,
        rejectionReasonCount: detectionSummary.rejectionReasons.length,
      })

      if (!detectionSummary.accepted) {
        // Mark buck as failed due to detection rejection
        await updateBuckStatus(buck.id, 'failed')
        
        return NextResponse.json(
          {
            error: 'No usable deer rack detected.',
            userMessage:
              detectionSummary.rejectionReasons[0]?.message ??
              'The uploaded images do not contain a usable deer rack for scoring.',
            errorType: 'detection_rejected',
            detection: detectionSummary,
            buckId: buck.id,
          },
          { status: 422 },
        )
      }
    } catch (detectionError) {
      // Detection failed but we can continue with scoring as fallback
      console.error('[score] detection phase failed, continuing with scoring:', detectionError)
    }

    // Log capture quality metadata
    if (selectedImageAnglesRaw || captureQualitySummaryRaw) {
      let captureQualityData: any = {}
      try {
        if (selectedImageAnglesRaw) captureQualityData.selectedImageAngles = JSON.parse(selectedImageAnglesRaw)
      } catch (e) {
        // ignore parse error
      }
      try {
        if (captureQualitySummaryRaw) captureQualityData.summary = JSON.parse(captureQualitySummaryRaw)
      } catch (e) {
        // ignore parse error
      }
      console.log('[score] capture quality check', captureQualityData)
    }

    // Log reference mode metadata (precision mode)
    if (precisionModeEnabledRaw || referenceModeSummaryRaw) {
      let referenceModeData: any = {}
      referenceModeData.precisionModeEnabled = precisionModeEnabledRaw === 'true'
      if (referenceTypeRaw) referenceModeData.referenceType = referenceTypeRaw
      if (referenceNotesRaw) referenceModeData.referenceNotes = referenceNotesRaw
      try {
        if (referenceModeSummaryRaw) referenceModeData.summary = JSON.parse(referenceModeSummaryRaw)
      } catch (e) {
        // ignore parse error
      }
      console.log('[score] reference mode summary', referenceModeData)
    }

    // Log image diagnostics (quality analysis)
    if (imageDiagnosticsRaw || imageDiagnosticsSummaryRaw) {
      let imageDiagnosticsData: any = {}
      try {
        if (imageDiagnosticsRaw) imageDiagnosticsData.diagnostics = JSON.parse(imageDiagnosticsRaw)
      } catch (e) {
        // ignore parse error
      }
      try {
        if (imageDiagnosticsSummaryRaw) imageDiagnosticsData.summary = JSON.parse(imageDiagnosticsSummaryRaw)
      } catch (e) {
        // ignore parse error
      }
      console.log('[score] image diagnostics', imageDiagnosticsData)
    }

    // Parse metadata for confidence engine
    let captureQualitySummary: any = null
    let imageDiagnosticsSummary: any = null
    let referenceModeSummary: any = null

    try {
      if (captureQualitySummaryRaw) captureQualitySummary = JSON.parse(captureQualitySummaryRaw)
    } catch (e) {
      // ignore parse error
    }
    try {
      if (imageDiagnosticsSummaryRaw) imageDiagnosticsSummary = JSON.parse(imageDiagnosticsSummaryRaw)
    } catch (e) {
      // ignore parse error
    }
    try {
      if (referenceModeSummaryRaw) referenceModeSummary = JSON.parse(referenceModeSummaryRaw)
    } catch (e) {
      // ignore parse error
    }

    // Run AI scoring (Phase 39: pass requestId as traceId for observability)
    const scoringResult = await scoreBuck({
      images: resolvedImages,
      state,
      rackType,
      earsFullyVisible,
      sourceType: sourceType || undefined,
      captureDevice: captureDevice || undefined,
      harvestYear: Number.isFinite(harvestYear) ? harvestYear ?? undefined : undefined,
      mainFramePoints: Number.isFinite(mainFramePoints) ? mainFramePoints ?? undefined : undefined,
      traceId: requestId,
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

    // Apply calibration from training data using unified calibration engine
    const rawPredictedGross =
      typeof scoringResult?.predictedGross === 'number'
        ? scoringResult.predictedGross
        : null

    const rawPredictedNet =
      typeof scoringResult?.predictedNet === 'number'
        ? scoringResult.predictedNet
        : null

    const rawConfidence =
      typeof scoringResult?.confidencePercent === 'number'
        ? scoringResult.confidencePercent
        : null

    const calibrationProfile = await getBestCalibrationProfile({
      state: state ?? null,
      rackType: rackType ?? null,
    })

    const calibrated = applyCalibration({
      rawGross: rawPredictedGross,
      rawNet: rawPredictedNet,
      rawConfidence,
      profile: calibrationProfile,
    })

    // Preserve raw values
    ;(scoringResult as any).rawPredictedGross = rawPredictedGross
    ;(scoringResult as any).rawPredictedNet = rawPredictedNet
    ;(scoringResult as any).rawConfidence = rawConfidence

    // Apply calibrated values
    scoringResult.predictedGross = calibrated.calibratedGross
    scoringResult.predictedNet = calibrated.calibratedNet
    scoringResult.confidencePercent = calibrated.calibratedConfidence

    ;(scoringResult as any).calibrationApplied = calibrated.calibrationApplied
    ;(scoringResult as any).calibrationMeta = calibrated.calibrationMeta

    console.log('[score] calibration applied', {
      applied: calibrated.calibrationApplied,
      meta: calibrated.calibrationMeta,
      rawGross: rawPredictedGross,
      calibratedGross: calibrated.calibratedGross,
    })

    // Get active model version
    const model = await getActiveModelVersion()

    const fieldProvenance = buildFieldProvenanceFromMeasurements({
      measurements: scoringResult.measurements,
      source:
        scoringResult.scoringMethod === 'vision'
          ? 'ai_raw'
          : 'fallback',
      grossScore: scoringResult.predictedGross ?? null,
      netScore: scoringResult.predictedNet ?? null,
      confidence:
        scoringResult.confidencePercent >= 75
          ? 'high'
          : scoringResult.confidencePercent >= 50
            ? 'medium'
            : 'low',
      confidenceScore: scoringResult.confidencePercent ?? null,
    })

    console.log('[score] field provenance created', {
      source:
        scoringResult.scoringMethod === 'vision'
          ? 'ai_raw'
          : 'fallback',
      hasMeasurements: !!scoringResult.measurements,
      grossScore: scoringResult.predictedGross ?? null,
      netScore: scoringResult.predictedNet ?? null,
    })

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
        rackType,
        provenance: fieldProvenance,
        // B&C-style score sheet for measurement comparison
        scoreSheet: buildScoreSheet(scoringResult.measurements, {
          scalingReference: scoringResult.scalingReferencesUsed?.[0] ?? 'unknown',
          rackType: rackType as 'typical' | 'non-typical',
          confidenceNotes: scoringResult.confidenceExplanation ?? [],
          mainFramePoints: scoringResult.mainFramePoints ?? 10,
        }),
        // Detection phase data
        detection: detectionSummary ?? undefined,
        bestImageByPurpose: detectionSummary?.bestImageByPurpose ?? undefined,
        measurementGraph: detectionSummary?.graph ?? undefined,
      },
      intakeQuality: intakeQuality as Record<string, unknown> | null,
      imageDiagnosticsSummary: imageDiagnosticsSummaryRaw ? (() => {
        try {
          return JSON.parse(imageDiagnosticsSummaryRaw)
        } catch {
          return null
        }
      })() : null
    })

    // Update status to completed
    await updateBuckStatus(buck.id, 'completed')

    // Phase 38: Record successful scoring run + fire low-credits notification (fire-and-forget)
    {
      const guestSessionId = sessionId ?? `anon_${clientIp}`;
      (async () => {
        const planStatus = userId ? await getUserPlanStatus(userId).catch(() => null) : null
        await recordScoringRun({
          userId: userId ?? null,
          sessionId: userId ? (sessionId ?? buckSessionId) : guestSessionId,
          clientIp,
          buckId: buck.id,
          imagesCount: imageCount,
          planId: planStatus?.plan_id ?? (userId ? 'free' : 'guest'),
          periodStart: planStatus?.period_start ?? null,
          periodEnd: planStatus?.period_end ?? null,
          status: 'success',
        })
        // Notify user if they're running low on credits
        if (userId && planStatus) {
          await maybeNotifyLowCredits(userId, planStatus).catch(() => null)
        }
      })().catch(err => console.error('[billing] post-score tasks failed:', err))
    }

    // Phase 34: Fire notifications (fire-and-forget, never block the response)
    const notificationPromises: Promise<void>[] = []

    if (userId) {
      // Always notify logged-in user to submit a real score for ground-truth
      // createGatedUserNotification respects user prefs + quiet period
      notificationPromises.push(
        createGatedUserNotification({
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
          createGatedUserNotification({
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
    
    // Non-blocking usage update - scoring response returns even if this fails
    if (usageRecordCreated) {
      try {
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
      } catch (usageErr) {
        console.error('[score] Non-blocking usage record update failed:', usageErr)
      }
      
      // Record usage for rate limiting (also non-blocking)
      try {
        await recordUsage(clientKey, 1, imageCount, cost.total_cost_mc)
      } catch (rateErr) {
        console.error('[score] Non-blocking rate limit update failed:', rateErr)
      }
    }

    // Phase 39: Log score completed
    const totalDurationMs = Date.now() - requestStartTime
    logEventFireForget({
      traceId: requestId,
      eventType: 'score_completed',
      service: 'score',
      route: '/api/score',
      status: 'success',
      durationMs: totalDurationMs,
      modelUsed: scoringResult.visionModelUsed ?? undefined,
      modelVersion: model?.slug ?? undefined,
      fallbackUsed: scoringResult.scoringMethod !== 'vision',
      retryCount: scoringResult.runtimeMetadata?.totalAttempts
        ? scoringResult.runtimeMetadata.totalAttempts - 1
        : 0,
      imagesCount: imageCount,
      userId: userId ?? null,
      buckId: buck.id,
      metadata: {
        scoringMethod: scoringResult.scoringMethod,
        confidence: adjustedConfidence,
        predictedGross: scoringResult.predictedGross,
      },
    })

    // Compute final confidence using the confidence engine
    const confidenceResult = computeConfidence({
      rawConfidence:
        typeof (scoringResult as any).rawConfidence === 'number'
          ? (scoringResult as any).rawConfidence
          : typeof scoringResult?.confidencePercent === 'number'
            ? scoringResult.confidencePercent
            : null,

      captureQualitySummary: captureQualitySummary ?? null,
      imageDiagnosticsSummary: imageDiagnosticsSummary ?? null,
      referenceModeSummary: referenceModeSummary ?? null,

      measurements:
        scoringResult?.measurements ??
        scoringResult?.rawAiResponse?.measurements ??
        null,

      isFallback: Boolean(scoringResult?.isFallback),
      calibrationApplied: Boolean((scoringResult as any).calibrationApplied),
      calibrationMeta: (scoringResult as any).calibrationMeta ?? null,
    })

    ;(scoringResult as any).rawConfidence =
      typeof (scoringResult as any).rawConfidence === 'number'
        ? (scoringResult as any).rawConfidence
        : confidenceResult.rawConfidence

    scoringResult.confidencePercent = confidenceResult.finalConfidence
    ;(scoringResult as any).confidenceBand = confidenceResult.confidenceBand
    ;(scoringResult as any).confidenceReasons = confidenceResult.reasons
    ;(scoringResult as any).confidenceComponentScores = confidenceResult.componentScores

    console.log('[score] confidence engine result', {
      rawConfidence: confidenceResult.rawConfidence,
      finalConfidence: confidenceResult.finalConfidence,
      confidenceBand: confidenceResult.confidenceBand,
      reasons: confidenceResult.reasons,
      componentScores: confidenceResult.componentScores,
    })

    // Phase 50: Shadow precision pass — fire-and-forget, 10% rollout
    // Does not block the response; failures are logged only.
    {
      const SHADOW_ROLLOUT_PERCENT = 10
      const shouldShadow = Math.random() * 100 < SHADOW_ROLLOUT_PERCENT
      if (shouldShadow) {
        ;(async () => {
          try {
            await startPrecisionPass({
              predictionId: prediction.id,
              requestedByUserId: userId ?? null,
            })
          } catch (shadowErr) {
            console.error('[score] Phase 50 shadow precision pass enqueue failed (non-blocking):', shadowErr)
          }
        })()
      }
    }

    // Return result
    return NextResponse.json({
      // Include buck object for UI to access id and property_id
      buck: {
        id: buck.id,
        session_id: buck.session_id,
        property_id: buck.property_id ?? null,
      },
      sessionId: buck.session_id,
      buckId: buck.id,
      estimatedScore: scoringResult.predictedGross,
      netScore: scoringResult.predictedNet,
      scoreRange: {
        low: adjustedErrorBandLow,
        high: adjustedErrorBandHigh
      },
      confidence: (scoringResult as any).confidenceBand ?? (scoringResult.confidencePercent >= 75 ? 'high' : scoringResult.confidencePercent >= 50 ? 'medium' : 'low'),
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
      // Training correction layer output
      trainingCorrectionResult: scoringResult.trainingCorrectionResult ?? null,
      // Phase 15: Intake quality
      intakeQuality: intakeQuality || null,
      // Phase 24: Runtime/fallback metadata
      fallbackMetadata: scoringResult.fallbackMetadata || null,
      runtimeMetadata: scoringResult.runtimeMetadata || null,
      imageValidationSummary: scoringResult.imageValidationSummary || null,
      // B&C-style score sheet for measurement comparison
      scoreSheet: buildScoreSheet(scoringResult.measurements, {
        scalingReference: scoringResult.scalingReferencesUsed?.[0] ?? 'unknown',
        rackType: rackType as 'typical' | 'non-typical',
        confidenceNotes: scoringResult.confidenceExplanation ?? [],
        mainFramePoints: scoringResult.mainFramePoints ?? 10,
      }),
      // Detection phase data
      detection: detectionSummary ?? null,
      bestImageByPurpose: detectionSummary?.bestImageByPurpose ?? null,
      measurementGraph: detectionSummary?.graph ?? null,
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

    // Phase 39: Log score failure to runtime_events
    logEventFireForget({
      traceId: requestId,
      eventType: 'score_failed',
      service: 'score',
      route: '/api/score',
      status: 'failure',
      errorType: errorType as import('@/lib/monitoring/service').ErrorType,
      errorMessage,
      durationMs: Date.now() - requestStartTime,
    })

    // Phase 30: Track failed request
    const processingTimeMs = Date.now() - requestStartTime
    if (usageRecordCreated) {
      // Non-blocking error logging
      try {
        await completeUsageRecord(requestId, false, {
          imagesProcessed: imageCount,
          visionCalls: 0,
          processingTimeMs,
          errorType,
          errorMessage: errorMessage.slice(0, 500), // Truncate long error messages
        })
      } catch (usageErr) {
        console.error('[score] Non-blocking usage record error update failed:', usageErr)
      }
      
      // Still record usage for rate limiting (prevents retry abuse)
      try {
        await recordUsage(clientKey, 1, imageCount, 0)
      } catch (usageError) {
        console.error('[score] Non-blocking rate limit update failed:', usageError)
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
    } else if (errorMessage.includes('harvest_date') || errorMessage.includes('schema cache')) {
      userMessage = 'Scoring is temporarily unavailable due to a database configuration issue. Please try again shortly.'
      statusCode = 503
    }

    return NextResponse.json({ 
      error: 'Scoring failed', 
      userMessage,
      requestId,
      details: errorMessage, // Always include for debugging
      errorType,
    }, { status: statusCode })
  }
}
