/**
 * RutAI Vision Scoring Service
 * Analyzes deer antler images using a vision-capable AI model to estimate measurements.
 */

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import type { Measurements, LandmarksDetected, AngleType } from '@/lib/types'
import { ANATOMICAL_REFERENCES } from '@/lib/constants'

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
}

export interface VisionScoringError {
  success: false
  error: string
  fallbackReason: string
}

export type VisionScoringResponse = VisionScoringResult | VisionScoringError

/**
 * Score deer antlers using vision model analysis
 */
export async function scoreWithVision(input: VisionScoringInput): Promise<VisionScoringResponse> {
  const startTime = Date.now()

  // Validate input
  if (!input.images || input.images.length === 0) {
    return {
      success: false,
      error: 'No images provided',
      fallbackReason: 'missing_images',
    }
  }

  // Filter to valid image URLs
  const validImages = input.images.filter(img => {
    try {
      // Check if it's a valid URL or data URL
      if (img.imageUrl.startsWith('data:image/')) return true
      new URL(img.imageUrl)
      return true
    } catch {
      return false
    }
  })

  if (validImages.length === 0) {
    return {
      success: false,
      error: 'No valid image URLs provided',
      fallbackReason: 'invalid_image_urls',
    }
  }

  try {
    const prompt = buildVisionPrompt({ ...input, images: validImages })
    
    // Build message content with images
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
      maxRetries: 2,
    })

    // Validate the response has reasonable values
    if (!visionOutput.measurements || visionOutput.gross_score < 50 || visionOutput.gross_score > 300) {
      return {
        success: false,
        error: 'Vision model returned invalid score range',
        fallbackReason: 'invalid_response_range',
      }
    }

    return {
      success: true,
      output: visionOutput,
      processingTimeMs: Date.now() - startTime,
      modelUsed: VISION_MODEL,
    }
  } catch (error) {
    console.error('Vision scoring error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown vision scoring error',
      fallbackReason: 'vision_model_error',
    }
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
