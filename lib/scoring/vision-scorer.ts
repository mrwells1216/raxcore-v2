/**
 * RutAI Vision Scoring Service
 * Analyzes deer antler images using a vision-capable AI model to estimate measurements.
 * Phase 24: Enhanced with runtime hardening, validation, and fallback support.
 */

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import type { Measurements, LandmarksDetected, AngleType, FallbackMetadataInfo, RuntimeMetadataInfo } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'
import { 
  validateImages, 
  type ImageValidationResult, 
  type ImageInput 
} from './image-validation'
import { 
  executeWithRuntime, 
  validateVisionOutput,
  classifyError,
  type RuntimeConfig,
  type RuntimeMetadata,
  type VisionRuntimeError
} from './vision-runtime'
import {
  makeFallbackDecision,
  createFallbackMetadata,
  type FallbackMetadata
} from './fallback-handler'
import { logEventFireForget } from '@/lib/monitoring/service'

// Vision model to use - Gemini 2.0 Flash has strong vision capabilities
const VISION_MODEL = 'google/gemini-2.0-flash-001'

export interface VisionImageInput {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
}

export interface VisionScoringInput {
  images: VisionImageInput[]
  state: string
  rackType: 'typical' | 'non-typical'
  earsFullyVisible?: boolean
  sourceType?: string
  captureDevice?: string
  mainFramePoints?: number
  /** Phase 39: optional correlation ID inherited from the parent score request */
  traceId?: string
}

// Zod schema for structured vision output
const VisionMeasurementsSchema = z.object({
  inside_spread: z.number().min(10).max(35).describe('Inside spread measurement in inches'),
  main_beam_left: z.number().min(15).max(35).describe('Left main beam length in inches'),
  main_beam_right: z.number().min(15).max(35).describe('Right main beam length in inches'),
  g1_left: z.number().min(1).max(12).describe('Left G1 (brow tine) length in inches'),
  g1_right: z.number().min(1).max(12).describe('Right G1 (brow tine) length in inches'),
  g2_left: z.number().min(3).max(18).describe('Left G2 tine length in inches'),
  g2_right: z.number().min(3).max(18).describe('Right G2 tine length in inches'),
  g3_left: z.number().min(2).max(16).describe('Left G3 tine length in inches'),
  g3_right: z.number().min(2).max(16).describe('Right G3 tine length in inches'),
  g4_left: z.number().min(0).max(14).describe('Left G4 tine length in inches'),
  g4_right: z.number().min(0).max(14).describe('Right G4 tine length in inches'),
  g5_left: z.number().min(0).max(10).nullable().describe('Left G5 tine length if present'),
  g5_right: z.number().min(0).max(10).nullable().describe('Right G5 tine length if present'),
  h1_left: z.number().min(3).max(8).describe('Left H1 circumference in inches'),
  h1_right: z.number().min(3).max(8).describe('Right H1 circumference in inches'),
  h2_left: z.number().min(3).max(7).describe('Left H2 circumference in inches'),
  h2_right: z.number().min(3).max(7).describe('Right H2 circumference in inches'),
  h3_left: z.number().min(2.5).max(7).describe('Left H3 circumference in inches'),
  h3_right: z.number().min(2.5).max(7).describe('Right H3 circumference in inches'),
  h4_left: z.number().min(2).max(6).describe('Left H4 circumference in inches'),
  h4_right: z.number().min(2).max(6).describe('Right H4 circumference in inches'),
  abnormal_points: z.number().min(0).max(50).describe('Total abnormal points in inches'),
  deductions: z.number().min(0).max(20).describe('Estimated deductions for asymmetry'),
})

const VisionLandmarksSchema = z.object({
  ears_visible: z.boolean().describe('Whether both ears are visible in the image(s)'),
  eyes_visible: z.boolean().describe('Whether both eyes are visible in the image(s)'),
  antlers_visible: z.boolean().describe('Whether both antlers are fully visible'),
  ear_base_to_tip_estimated: z.number().optional().describe('Estimated ear length if visible'),
  scaling_reference_used: z.string().describe('Primary anatomical reference used for scaling'),
  quality_notes: z.array(z.string()).describe('Notes about image quality affecting estimates'),
})

const VisionOutputSchema = z.object({
  measurements: VisionMeasurementsSchema,
  landmarks: VisionLandmarksSchema,
  gross_score: z.number().describe('Calculated gross B&C score'),
  net_score: z.number().describe('Calculated net B&C score (gross minus deductions and abnormal for typical)'),
  confidence_percent: z.number().min(10).max(95).describe('Confidence in the estimate (10-95%)'),
  main_frame_points: z.number().min(6).max(20).describe('Total number of scoreable points'),
  rack_type_detected: z.enum(['typical', 'non-typical']).describe('Whether rack appears typical or non-typical'),
  angle_quality: z.object({
    best_for_spread: z.enum(['front', 'left', 'right', 'back', 'other', 'none']),
    best_for_beams: z.enum(['front', 'left', 'right', 'back', 'other', 'none']),
    best_for_tines: z.enum(['front', 'left', 'right', 'back', 'other', 'none']),
  }).describe('Which angles were most useful for each measurement type'),
  explanation: z.array(z.string()).describe('Detailed explanation of how estimates were derived'),
  anatomical_references_used: z.array(z.string()).describe('List of anatomical references used for scaling'),
})

export type VisionOutput = z.infer<typeof VisionOutputSchema>

/**
 * Build a detailed prompt for the vision model
 */
function buildVisionPrompt(input: VisionScoringInput): string {
  const angleDescriptions = input.images.map((img, i) => 
    `Image ${i + 1}: ${img.angleType} angle (${img.width}x${img.height})`
  ).join('\n')

  return `You are an expert whitetail deer antler scorer with decades of experience measuring trophy bucks for Boone & Crockett and Pope & Young records. 

TASK: Analyze the provided deer antler image(s) and estimate all B&C scoring measurements.

CONTEXT:
- State: ${input.state}
- User-indicated rack type: ${input.rackType}
- User says ears fully visible: ${input.earsFullyVisible ? 'Yes' : 'Unknown/No'}
- Source type: ${input.sourceType || 'Unknown'}
- Capture device: ${input.captureDevice || 'Unknown'}
- User-suggested main frame points: ${input.mainFramePoints || 'Not provided'}

IMAGES PROVIDED:
${angleDescriptions}

ANATOMICAL SCALING REFERENCES (use these to convert pixel measurements to inches):
- Whitetail deer ear base-to-tip length: ${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP} inches (average)
- Whitetail deer eye-to-eye distance: ${ANATOMICAL_REFERENCES.EYE_TO_EYE} inches (average)
- Whitetail deer ear tip-to-tip (alert): ${ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT} inches (average)
- Whitetail deer ear tip-to-tip (relaxed): ${ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_RELAXED} inches (average)

MEASUREMENT GUIDELINES:
1. INSIDE SPREAD: Measure the widest point between main beams at a right angle to the skull centerline. Most mature bucks are 16-22 inches.

2. MAIN BEAMS: Measure along the outer curve from the burr to the tip. Typical mature bucks are 22-28 inches per side.

3. TINE LENGTHS (G1-G5): Measure from the top of the main beam to the tine tip along the outer edge:
   - G1 (brow tine): Usually 3-6 inches
   - G2: Usually the longest tine, 8-12 inches on mature bucks
   - G3: Often second longest, 7-11 inches
   - G4: Shorter, 4-9 inches
   - G5: If present, usually 2-5 inches

4. CIRCUMFERENCES (H1-H4): Measure at the smallest point between tines:
   - H1: Between burr and G1, typically 4-5.5 inches
   - H2: Between G1 and G2, typically 4-5 inches
   - H3: Between G2 and G3, typically 4-4.5 inches
   - H4: Between G3 and G4 (or halfway to beam tip), typically 3.5-4.5 inches

5. ABNORMAL POINTS: Any point not in the normal typical pattern (extra tines, drop tines, etc.)

6. DEDUCTIONS: Estimate asymmetry deductions by comparing left/right differences.

ANGLE-SPECIFIC GUIDANCE:
- FRONT angles: Best for inside spread and ear/eye references
- SIDE angles (left/right): Best for main beam length and tine measurements
- 45-degree angles: Good for overall verification

SCORING CALCULATION:
- Gross = Sum of all measurements including abnormal points
- Net (Typical) = Gross - abnormal points - deductions
- Net (Non-typical) = Gross - deductions (abnormals count as score)

Be conservative with estimates - it's better to slightly underestimate than overestimate.
Consider image quality, angle limitations, and perspective distortion in your confidence level.

Provide your analysis as structured JSON matching the required schema.`
}

/**
 * Prepare image content for the vision model
 * Handles both data URLs and regular URLs
 */
function prepareImageContent(images: VisionImageInput[]): Array<{ type: 'image'; image: URL | string }> {
  return images.map(img => {
    // Data URLs are passed as strings directly
    if (img.imageUrl.startsWith('data:image/')) {
      return {
        type: 'image' as const,
        image: img.imageUrl,
      }
    }
    // Regular URLs need to be URL objects
    return {
      type: 'image' as const,
      image: new URL(img.imageUrl),
    }
  })
}

export interface VisionScoringResult {
  success: true
  output: VisionOutput
  processingTimeMs: number
  modelUsed: string
  // Phase 24: Runtime metadata
  runtimeMetadata: RuntimeMetadata
  imageValidation: ImageValidationResult
}

export interface VisionScoringError {
  success: false
  error: string
  userMessage: string
  fallbackReason: string
  // Phase 24: Enhanced error metadata
  runtimeMetadata: RuntimeMetadata | null
  imageValidation: ImageValidationResult | null
  visionErrors: VisionRuntimeError[]
  fallbackMetadata: FallbackMetadata
}

export type VisionScoringResponse = VisionScoringResult | VisionScoringError

// Phase 24: Runtime configuration for vision calls
const VISION_RUNTIME_CONFIG: Partial<RuntimeConfig> = {
  totalTimeoutMs: 55000,      // 55s total (leave room for request overhead)
  singleCallTimeoutMs: 25000, // 25s per attempt
  maxRetries: 2,
  retryDelayBaseMs: 1000,
  retryDelayMaxMs: 4000,
  exponentialBackoff: true,
}

/**
 * Score deer antlers using vision model analysis
 * Phase 24: Enhanced with full runtime hardening
 */
export async function scoreWithVision(input: VisionScoringInput): Promise<VisionScoringResponse> {
  const startTime = Date.now()
  const visionErrors: VisionRuntimeError[] = []

  // Phase 39: Log vision call started
  logEventFireForget({
    traceId: input.traceId,
    eventType: 'vision_started',
    service: 'vision',
    route: '/api/score',
    status: 'info',
    imagesCount: input.images?.length ?? 0,
    modelUsed: VISION_MODEL,
  })

  // Phase 24: Comprehensive image validation
  if (!input.images || input.images.length === 0) {
    const fallbackDecision = makeFallbackDecision(
      { type: 'validation_error', message: 'No images provided', retryable: false },
      null,
      null
    )
    return {
      success: false,
      error: 'No images provided',
      userMessage: 'Please provide at least one image for scoring.',
      fallbackReason: 'no_valid_images',
      runtimeMetadata: null,
      imageValidation: null,
      visionErrors: [],
      fallbackMetadata: createFallbackMetadata(fallbackDecision, [], null, null),
    }
  }

  // Validate all images with full checks
  const imageInputs: ImageInput[] = input.images.map(img => ({
    imageUrl: img.imageUrl,
    angleType: img.angleType,
    width: img.width,
    height: img.height,
  }))
  
  const imageValidation = await validateImages(imageInputs, {
    skipAccessibilityChecks: false,
    skipDuplicateCheck: false,
    minValidImages: 1,
    maxImages: 10,
  })

  // If no valid images, fail early
  if (!imageValidation.valid || imageValidation.validImageCount === 0) {
    const validationError: VisionRuntimeError = {
      type: 'validation_error',
      message: imageValidation.summary,
      retryable: false,
    }
    const fallbackDecision = makeFallbackDecision(validationError, null, imageValidation)
    
    return {
      success: false,
      error: imageValidation.summary,
      userMessage: 'Could not process images. Please check image URLs and formats.',
      fallbackReason: 'image_validation_failed',
      runtimeMetadata: null,
      imageValidation,
      visionErrors: [validationError],
      fallbackMetadata: createFallbackMetadata(fallbackDecision, [validationError], imageValidation, null),
    }
  }

  // Use only valid images for vision call
  const validImages = imageValidation.validImageIndices.map(i => input.images[i])

  // Phase 24: Execute vision call with runtime hardening
  const visionCallResult = await executeWithRuntime(async () => {
    const prompt = buildVisionPrompt({ ...input, images: validImages })
    const imageContent = prepareImageContent(validImages)
    
    const { object: visionOutput } = await generateObject({
      model: gateway(VISION_MODEL),
      schema: VisionOutputSchema,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: prompt },
          ],
        },
      ],
      // Note: AI SDK has its own retry logic, but we wrap it for timeout/monitoring
      maxRetries: 1,
    })

    return visionOutput
  }, VISION_RUNTIME_CONFIG)

  // Collect any errors from the runtime
  if (visionCallResult.metadata.errorsEncountered.length > 0) {
    visionErrors.push(...visionCallResult.metadata.errorsEncountered)
  }

  // Handle vision call failure
  if (!visionCallResult.success) {
    const runtimeError = visionCallResult.error || {
      type: 'unknown' as const,
      message: 'Unknown vision error',
      retryable: false,
    }
    visionErrors.push(runtimeError)
    
    const fallbackDecision = makeFallbackDecision(runtimeError, visionCallResult.metadata, imageValidation)
    
    console.error('Vision scoring failed:', {
      error: runtimeError.type,
      message: runtimeError.message,
      attempts: visionCallResult.metadata.totalAttempts,
      timeMs: visionCallResult.metadata.totalTimeMs,
      timedOut: visionCallResult.metadata.timedOut,
    })

    // Phase 39: Log vision failure + fallback
    logEventFireForget({
      traceId: input.traceId,
      eventType: visionCallResult.metadata.wasRetried ? 'vision_retry' : 'vision_failed',
      service: 'vision',
      route: '/api/score',
      status: 'failure',
      errorType: runtimeError.type as import('@/lib/monitoring/service').ErrorType,
      errorMessage: runtimeError.message,
      durationMs: visionCallResult.metadata.totalTimeMs,
      retryCount: visionCallResult.metadata.totalAttempts - 1,
      imagesCount: input.images?.length ?? 0,
      modelUsed: VISION_MODEL,
      fallbackUsed: true,
      metadata: { timedOut: visionCallResult.metadata.timedOut },
    })

    return {
      success: false,
      error: runtimeError.message,
      userMessage: fallbackDecision.userMessage,
      fallbackReason: fallbackDecision.reason || 'unknown_error',
      runtimeMetadata: visionCallResult.metadata,
      imageValidation,
      visionErrors,
      fallbackMetadata: createFallbackMetadata(fallbackDecision, visionErrors, imageValidation, visionCallResult.metadata),
    }
  }

  // Phase 24: Validate vision output for sanity
  const outputValidation = validateVisionOutput(visionCallResult.result)
  
  if (!outputValidation.valid || outputValidation.severity === 'critical') {
    const validationError: VisionRuntimeError = {
      type: 'validation_error',
      message: `Output validation failed: ${outputValidation.issues.join('; ')}`,
      retryable: true,
    }
    visionErrors.push(validationError)
    
    const fallbackDecision = makeFallbackDecision(validationError, visionCallResult.metadata, imageValidation)
    
    console.error('Vision output validation failed:', outputValidation.issues)

    // Phase 39: Log malformed output event
    logEventFireForget({
      traceId: input.traceId,
      eventType: 'vision_output_invalid',
      service: 'vision',
      route: '/api/score',
      status: 'warning',
      errorType: 'malformed_response',
      errorMessage: outputValidation.issues.join('; '),
      durationMs: visionCallResult.metadata.totalTimeMs,
      modelUsed: VISION_MODEL,
      fallbackUsed: true,
    })

    return {
      success: false,
      error: 'Vision model returned invalid output',
      userMessage: 'Image analysis returned unexpected results. Please try again.',
      fallbackReason: 'vision_validation_failed',
      runtimeMetadata: visionCallResult.metadata,
      imageValidation,
      visionErrors,
      fallbackMetadata: createFallbackMetadata(fallbackDecision, visionErrors, imageValidation, visionCallResult.metadata),
    }
  }

  const visionOutput = visionCallResult.result as VisionOutput

  // Additional sanity check on score range
  if (visionOutput.gross_score < 50 || visionOutput.gross_score > 350) {
    const rangeError: VisionRuntimeError = {
      type: 'validation_error',
      message: `Gross score ${visionOutput.gross_score} outside reasonable range (50-350)`,
      retryable: false,
    }
    visionErrors.push(rangeError)
    
    const fallbackDecision = makeFallbackDecision(rangeError, visionCallResult.metadata, imageValidation)

    return {
      success: false,
      error: 'Vision model returned implausible score',
      userMessage: 'Image analysis returned an unexpected score. Please try different images.',
      fallbackReason: 'vision_validation_failed',
      runtimeMetadata: visionCallResult.metadata,
      imageValidation,
      visionErrors,
      fallbackMetadata: createFallbackMetadata(fallbackDecision, visionErrors, imageValidation, visionCallResult.metadata),
    }
  }

  // Log any minor validation issues as warnings
  if (outputValidation.issues.length > 0 && outputValidation.severity !== 'none') {
    console.warn('Vision output has minor issues:', outputValidation.issues)
  }

  // Phase 39: Log vision success
  const processingTimeMs = Date.now() - startTime
  logEventFireForget({
    traceId: input.traceId,
    eventType: 'vision_completed',
    service: 'vision',
    route: '/api/score',
    status: 'success',
    durationMs: processingTimeMs,
    modelUsed: VISION_MODEL,
    retryCount: visionCallResult.metadata.totalAttempts - 1,
    imagesCount: validImages.length,
    metadata: {
      confidence: visionOutput.confidence_percent,
      grossScore: visionOutput.gross_score,
      outputIssues: outputValidation.issues.length,
    },
  })

  // Success!
  return {
    success: true,
    output: visionOutput,
    processingTimeMs,
    modelUsed: VISION_MODEL,
    runtimeMetadata: visionCallResult.metadata,
    imageValidation,
  }
}

/**
 * Convert vision output to standard measurements format
 */
export function visionOutputToMeasurements(output: VisionOutput): Measurements {
  return {
    inside_spread: output.measurements.inside_spread,
    main_beam_left: output.measurements.main_beam_left,
    main_beam_right: output.measurements.main_beam_right,
    g1_left: output.measurements.g1_left,
    g1_right: output.measurements.g1_right,
    g2_left: output.measurements.g2_left,
    g2_right: output.measurements.g2_right,
    g3_left: output.measurements.g3_left,
    g3_right: output.measurements.g3_right,
    g4_left: output.measurements.g4_left,
    g4_right: output.measurements.g4_right,
    g5_left: output.measurements.g5_left,
    g5_right: output.measurements.g5_right,
    h1_left: output.measurements.h1_left,
    h1_right: output.measurements.h1_right,
    h2_left: output.measurements.h2_left,
    h2_right: output.measurements.h2_right,
    h3_left: output.measurements.h3_left,
    h3_right: output.measurements.h3_right,
    h4_left: output.measurements.h4_left,
    h4_right: output.measurements.h4_right,
    abnormal_points: output.measurements.abnormal_points,
    deductions: output.measurements.deductions,
  }
}

/**
 * Convert vision output to standard landmarks format
 */
export function visionOutputToLandmarks(output: VisionOutput): LandmarksDetected {
  return {
    ears_visible: output.landmarks.ears_visible,
    eyes_visible: output.landmarks.eyes_visible,
    antlers_visible: output.landmarks.antlers_visible,
    ear_base_to_tip: output.landmarks.ear_base_to_tip_estimated ?? ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
    eye_to_eye: ANATOMICAL_REFERENCES.EYE_TO_EYE,
    ear_tip_to_tip: ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT,
    quality_notes: output.landmarks.quality_notes,
  }
}
