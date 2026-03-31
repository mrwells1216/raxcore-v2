/**
 * RutAI Vision Scoring Service
 * Analyzes deer antler images using a vision-capable AI model to estimate measurements.
 * Phase 24: Enhanced with runtime hardening, validation, and fallback support.
 */

import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
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

// OpenAI is the only provider for scoring vision calls.
// Requires @ai-sdk/openai@^2.0.0 — the v2 package implements LanguageModelV2
// (specificationVersion "v2") which ai@6 requires. v1.x only implements v1 and
// will throw "Unsupported model version v1" regardless of which method is used.
//
// Use openai('gpt-4o') — the standard chat path in @ai-sdk/openai v2.
// This model supports image inputs (vision) and implements spec v2.
const OPENAI_VISION_MODEL = 'gpt-4o'

function getVisionModel() {
  const hasKey = !!process.env.OPENAI_API_KEY

  console.log('[vision-scorer] provider check', {
    selectedProvider: 'openai',
    selectedModel: OPENAI_VISION_MODEL,
    sdkMethod: 'generateObject',
    providerPackage: '@ai-sdk/openai',
    providerAdapter: 'openai.chat (spec v2)',
    hasOpenAIKey: hasKey,
    visionCapable: true,
    isFallback: false,
  })

  if (!hasKey) {
    throw new Error(
      '[vision-scorer] Missing OPENAI_API_KEY — cannot score. ' +
      'Set OPENAI_API_KEY in your server environment variables.'
    )
  }

  // openai('gpt-4o') uses the chat completions path which supports vision
  // inputs (image_url content parts) and implements LanguageModelV2 in
  // @ai-sdk/openai v2.x — compatible with ai@6's generateObject.
  return {
    model: openai(OPENAI_VISION_MODEL),
    provider: 'openai',
    providerAdapter: 'openai.chat',
    modelName: OPENAI_VISION_MODEL,
  }
}

  // openai.responses() is the AI SDK 6 / spec-v2 Responses API path.
  // Do NOT use openai('gpt-4o') — that resolves to spec v1 chat and throws
  // "Unsupported model version v1 for provider openai.chat".
  return {
    model: openai.responses(OPENAI_VISION_MODEL),
    provider: 'openai',
    providerAdapter: 'openai.responses',
    modelName: OPENAI_VISION_MODEL,
  }
}

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

// Per-reference observation sub-schema (Steps 1–2 of multi-reference consensus)
const ReferenceObservationSchema = z.object({
  visibility: z.boolean().describe('Whether this reference is clearly visible'),
  quality: z.number().min(0).max(1).describe('Detection quality (0–1): sharpness, occlusion, angle clarity'),
  distortion: z.number().min(0).max(1).describe('Perspective/lens distortion on this reference (0–1)'),
})

const VisionLandmarksSchema = z.object({
  ears_visible: z.boolean().describe('Whether both ears are visible in the image(s)'),
  eyes_visible: z.boolean().describe('Whether both eyes are visible in the image(s)'),
  antlers_visible: z.boolean().describe('Whether both antlers are fully visible'),
  ear_base_to_tip_estimated: z.number().optional().describe('Estimated ear base-to-tip length in inches if visible'),
  scaling_reference_used: z.string().describe('Primary anatomical reference used for scaling'),
  quality_notes: z.array(z.string()).describe('Notes about image quality affecting estimates'),

  // Multi-reference consensus data (Step 1 of weighted reference system)
  // Top-tier references — these should dominate scaling:
  eye_box: ReferenceObservationSchema.optional().describe(
    'Eye socket / orbital box — top-tier reference. Best detected from front-angle images.'
  ),
  pedicle_spacing: ReferenceObservationSchema.optional().describe(
    'Antler base (pedicle) center-to-center spacing — top-tier reference. Front angle only.'
  ),
  eye_to_pedicle: ReferenceObservationSchema.optional().describe(
    'Eye center to nearest pedicle base distance — top-tier structural proportion.'
  ),
  skull_width: ReferenceObservationSchema.optional().describe(
    'Forehead width between orbital ridges — top-tier reference. Front angle.'
  ),

  // Secondary references
  nose_bridge: ReferenceObservationSchema.optional().describe(
    'Nose bridge length from brow to tip — secondary reference.'
  ),
  muzzle_width: ReferenceObservationSchema.optional().describe(
    'Muzzle width at widest point — secondary reference. Front angle.'
  ),
  ear_base_spacing: ReferenceObservationSchema.optional().describe(
    'Ear base center-to-center spacing — secondary reference. Less reliable than pedicle.'
  ),

  // Bonus (only populate when ears confirmed visible)
  ear_base_to_tip: ReferenceObservationSchema.optional().describe(
    'Ear base-to-tip length — bonus reference. Only populate when ears are fully visible.'
  ),

  // Detected pixel-space measurements for top-tier references (optional, used by consensus engine)
  eye_width_px_inches: z.number().optional().describe('Estimated eye box width in the same inch-space as measurements'),
  pedicle_spacing_px_inches: z.number().optional().describe('Estimated pedicle spacing in inch-space'),
  eye_to_pedicle_px_inches: z.number().optional().describe('Estimated eye-to-pedicle distance in inch-space'),
  skull_forehead_width_px_inches: z.number().optional().describe('Estimated skull forehead width in inch-space'),
  nose_bridge_px_inches: z.number().optional().describe('Estimated nose bridge length in inch-space'),
  muzzle_width_px_inches: z.number().optional().describe('Estimated muzzle width in inch-space'),
  ear_base_spacing_px_inches: z.number().optional().describe('Estimated ear base spacing in inch-space'),
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

═══════════════════════════════════════════════════════════════
MULTI-REFERENCE SCALING SYSTEM — CRITICAL INSTRUCTIONS
═══════════════════════════════════════════════════════════════
You MUST use MULTIPLE anatomical references to derive scale, not just ears.
For EACH reference below, report: visibility (true/false), quality (0–1),
and distortion (0–1). Then use detected sizes to set *_px_inches fields.

REFERENCE PRIORITY — use top-tier references first:

TOP-TIER (highest accuracy — use these to anchor all measurements):
  1. Eye box (orbital socket)          — known width: ${ANATOMICAL_REFERENCES.EYE_BOX_WIDTH}" | Best angle: front
  2. Pedicle spacing (antler bases)    — known c-to-c: ${ANATOMICAL_REFERENCES.PEDICLE_SPACING}"  | Best angle: front
  3. Eye-to-pedicle distance           — known: ${ANATOMICAL_REFERENCES.EYE_TO_PEDICLE}"         | Best angle: front/45°
  4. Skull forehead width              — known: ${ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH}"    | Best angle: front

SECONDARY (use to corroborate if top-tier is unclear):
  5. Nose bridge length                — known: ${ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH}"      | Best angle: front/45°
  6. Muzzle width                      — known: ${ANATOMICAL_REFERENCES.MUZZLE_WIDTH}"            | Best angle: front
  7. Ear base spacing                  — known c-to-c: ${ANATOMICAL_REFERENCES.EAR_BASE_SPACING}"  | Best angle: front

BONUS (only if ears confirmed fully visible — less reliable, do NOT let this override top-tier):
  8. Ear base-to-tip                   — known: ${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}"         | Front/45° only

IMPORTANT RULES:
- DO NOT rely primarily on ears for scaling.
- Eye box + pedicle spacing + eye-to-pedicle MUST dominate scaling.
- Nose bridge is secondary; ears are a bonus check only.
- If you can see the eye socket clearly, you MUST populate eye_box.
- If pedicle bases are visible from front, you MUST populate pedicle_spacing.
- For distortion: side/oblique angles distort perspective heavily (0.3–0.7).
  Front angle = low distortion (0.05–0.2). Trail cam / fisheye = higher.
- If a reference is NOT visible, still include it with visibility: false.
- Set *_px_inches fields to your best inch-equivalent estimate of each
  reference's detected size in the image's scale (same inch space as your
  other measurements). Leave as undefined if not detected.

═══════════════════════════════════════════════════════════════
MEASUREMENT GUIDELINES
═══════════════════════════════════════════════════════════════
1. INSIDE SPREAD: Widest point between main beams. Mature bucks: 16–22".

2. MAIN BEAMS: Outer curve from burr to tip. Mature bucks: 22–28" per side.

3. TINE LENGTHS (G1–G5): Base of tine at main beam to tine tip:
   - G1 (brow): 3–6"  |  G2: 8–12"  |  G3: 7–11"  |  G4: 4–9"  |  G5 if present: 2–5"

4. CIRCUMFERENCES (H1–H4): Smallest point between tines:
   - H1: 4–5.5"  |  H2: 4–5"  |  H3: 4–4.5"  |  H4: 3.5–4.5"

5. ABNORMAL POINTS: Any point outside the normal typical pattern.

6. DEDUCTIONS: Estimate asymmetry from left/right differences.

ANGLE-SPECIFIC GUIDANCE:
- FRONT: Best for spread, eye box, pedicle, skull width, ear/eye refs.
- SIDE (left/right): Best for main beam length and tine lengths.
- 45-degree: Good for overall cross-check.

SCORING CALCULATION:
- Gross = Sum of all measurements including abnormal points
- Net (Typical) = Gross − abnormal points − deductions
- Net (Non-typical) = Gross − deductions (abnormals count positively)

Be conservative — slightly under rather than over. Account for perspective
distortion, occlusion, and image quality in your confidence level.

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

  // Get the vision model configuration — throws clearly if OPENAI_API_KEY is missing
  let visionConfig: ReturnType<typeof getVisionModel>
  try {
    visionConfig = getVisionModel()
  } catch (configErr) {
    const msg = configErr instanceof Error ? configErr.message : String(configErr)
    console.error('[vision-scorer] Configuration error — cannot score:', msg)
    return {
      success: false,
      error: msg,
      userMessage: 'Scoring is unavailable: missing API key configuration. Contact support.',
      fallbackReason: 'missing_api_key',
      runtimeMetadata: null,
      imageValidation: null,
      visionErrors: [{ type: 'config_error' as const, message: msg, retryable: false }],
      fallbackMetadata: createFallbackMetadata(
        makeFallbackDecision({ type: 'config_error' as const, message: msg, retryable: false }, null, null),
        [{ type: 'config_error' as const, message: msg, retryable: false }],
        null,
        null
      ),
    }
  }

  // Phase 39: Log vision call started
  logEventFireForget({
    traceId: input.traceId,
    eventType: 'vision_started',
    service: 'vision',
    route: '/api/score',
    status: 'info',
    imagesCount: input.images?.length ?? 0,
    modelUsed: `${visionConfig.provider}/${visionConfig.modelName}`,
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

  // Use vision config from earlier
  const { model: visionModel, provider: visionProvider, modelName: visionModelName, providerAdapter } = visionConfig

  const imageContent = prepareImageContent(validImages)
  console.log('[vision-scorer] pre-call', {
    provider: visionProvider,
    model: visionModelName,
    providerAdapter,
    sdkMethod: 'generateObject',
    imageCount: validImages.length,
    imageAngles: validImages.map(img => img.angleType),
    imagePayloadAttached: imageContent.length > 0,
    visionCapable: true,
  })

  // Phase 24: Execute vision call with runtime hardening
  const visionCallResult = await executeWithRuntime(async () => {
    const prompt = buildVisionPrompt({ ...input, images: validImages })

    const { object: visionOutput } = await generateObject({
      model: visionModel,
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

    console.log('[vision-scorer] post-call success', {
      provider: visionProvider,
      model: visionModelName,
      visionSucceeded: true,
      fallbackUsed: false,
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
    
    console.error('[vision-scorer] vision call failed — falling back to heuristic', {
      provider: visionProvider,
      model: visionModelName,
      providerAdapter,
      visionSucceeded: false,
      fallbackUsed: true,
      fallbackReason: runtimeError.type,
      fallbackMessage: runtimeError.message,
      retryable: runtimeError.retryable,
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
      modelUsed: `${visionProvider}/${visionModelName}`,
      fallbackUsed: true,
      metadata: { timedOut: visionCallResult.metadata.timedOut, provider: visionProvider },
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
      modelUsed: `${visionProvider}/${visionModelName}`,
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
    modelUsed: `${visionProvider}/${visionModelName}`,
    retryCount: visionCallResult.metadata.totalAttempts - 1,
    imagesCount: validImages.length,
    metadata: {
      confidence: visionOutput.confidence_percent,
      grossScore: visionOutput.gross_score,
      outputIssues: outputValidation.issues.length,
      provider: visionProvider,
    },
  })

  console.log(`[vision-scorer] Vision scoring successful via ${visionProvider}`)

  // Success!
  return {
    success: true,
    output: visionOutput,
    processingTimeMs,
    modelUsed: `${visionProvider}/${visionModelName}`,
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
  const lm = output.landmarks
  return {
    ears_visible:      lm.ears_visible,
    eyes_visible:      lm.eyes_visible,
    antlers_visible:   lm.antlers_visible,
    ear_base_to_tip:   lm.ear_base_to_tip_estimated ?? ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP,
    eye_to_eye:        ANATOMICAL_REFERENCES.EYE_TO_EYE,
    ear_tip_to_tip:    ANATOMICAL_REFERENCES.EAR_TIP_TO_TIP_ALERT,
    quality_notes:     lm.quality_notes,

    // Top-tier reference pixel-space measurements (inch-equivalent)
    eye_width:                lm.eye_width_px_inches,
    eye_box_detected:         lm.eye_box?.visibility,
    pedicle_spacing:          lm.pedicle_spacing_px_inches,
    pedicle_visible:          lm.pedicle_spacing?.visibility,
    eye_to_pedicle_distance:  lm.eye_to_pedicle_px_inches,
    skull_forehead_width:     lm.skull_forehead_width_px_inches,
    skull_width_visible:      lm.skull_width?.visibility,

    // Secondary reference sizes
    nose_bridge_length:       lm.nose_bridge_px_inches,
    muzzle_width:             lm.muzzle_width_px_inches,
    ear_base_spacing:         lm.ear_base_spacing_px_inches,
  }
}

/**
 * Extract per-reference quality/distortion data from a VisionOutput's landmarks
 * for use by the ReferenceConsensus engine.
 */
export function visionOutputToReferenceQualityData(
  output: VisionOutput
): Partial<Record<import('./reference-consensus').ReferenceLabel, { quality: number; distortion: number }>> {
  const lm = output.landmarks
  const result: Partial<Record<import('./reference-consensus').ReferenceLabel, { quality: number; distortion: number }>> = {}

  if (lm.eye_box?.visibility)      result.eye_box         = { quality: lm.eye_box.quality,         distortion: lm.eye_box.distortion }
  if (lm.pedicle_spacing?.visibility) result.pedicle_spacing = { quality: lm.pedicle_spacing.quality, distortion: lm.pedicle_spacing.distortion }
  if (lm.eye_to_pedicle?.visibility)  result.eye_to_pedicle  = { quality: lm.eye_to_pedicle.quality,  distortion: lm.eye_to_pedicle.distortion }
  if (lm.skull_width?.visibility)     result.skull_width     = { quality: lm.skull_width.quality,     distortion: lm.skull_width.distortion }
  if (lm.nose_bridge?.visibility)     result.nose_bridge     = { quality: lm.nose_bridge.quality,     distortion: lm.nose_bridge.distortion }
  if (lm.muzzle_width?.visibility)    result.muzzle_width    = { quality: lm.muzzle_width.quality,    distortion: lm.muzzle_width.distortion }
  if (lm.ear_base_spacing?.visibility) result.ear_base_spacing = { quality: lm.ear_base_spacing.quality, distortion: lm.ear_base_spacing.distortion }
  if (lm.ear_base_to_tip?.visibility) result.ear_base_to_tip = { quality: lm.ear_base_to_tip.quality,  distortion: lm.ear_base_to_tip.distortion }

  return result
}
