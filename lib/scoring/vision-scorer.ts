/**
 * RutAI Vision Scoring Service
 * Analyzes deer antler images using a vision-capable AI model to estimate measurements.
 * Phase 24: Enhanced with runtime hardening, validation, and fallback support.
 */

import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type { Measurements, LandmarksDetected, AngleType, FallbackMetadataInfo, RuntimeMetadataInfo } from '@/lib/types'
import type { AntlerLandmarkId, LandmarkDetection, LandmarkDetectionResult, PerImageLandmarkResult } from './landmark-detection'
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
import type { PrecisionReferenceProfile } from './reference-mode'
import { HAT_DIMENSIONS } from './hat-reference'
import { buildLandmarkDetectionPrompt } from './landmark-prompt'
import { roleIsolationParagraph } from './prompt-style'

// OpenAI is the only provider for scoring vision calls.
// Requires @ai-sdk/openai@^2.0.0 — the v2 package implements LanguageModelV2
// (specificationVersion "v2") which ai@6 requires.
// openai('gpt-4o') is the standard chat path — supports vision inputs, spec v2.
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



export interface VisionImageInput {
  imageUrl: string
  angleType: AngleType
  width: number
  height: number
  /** True when this image was server-cropped to the antler region. */
  hasCropBox?: boolean
}

export interface PreAiScoringContext {
  selectedImageAngles?: string[] | null
  intakeQuality?: Record<string, unknown> | null
  captureQualitySummary?: Record<string, unknown> | null
  imageDiagnostics?: unknown[] | null
  imageDiagnosticsSummary?: Record<string, unknown> | null
  referenceModeSummary?: Record<string, unknown> | null
  detectionSummary?: Record<string, unknown> | null
  cropBoxMetadata?: Record<string, unknown> | null
  userNotes?: string | null
  abnormalPointContext?: Record<string, unknown> | null
}

export interface VisionScoringInput {
  images: VisionImageInput[]
  state?: string | null
  rackType: 'typical' | 'non-typical'
  earsFullyVisible?: boolean
  sourceType?: string
  captureDevice?: string
  mainFramePoints?: number
  totalPoints?: number
  preScoringMeasurements?: import('@/lib/types').PreScoringMeasurements | null
  precisionReference?: PrecisionReferenceProfile | null
  referenceObject?: import('@/lib/scoring/reference-object-types').ScoringReferenceObjectInput | null
  preAiScoringContext?: PreAiScoringContext | null
  /** Phase 39: optional correlation ID inherited from the parent score request */
  traceId?: string
  // NOTE: there is deliberately no `fieldBiases` here. Learned biases are
  // applied once, arithmetically, after scoring (ai-service STAGE 2.5).
  // Passing them into the prompt as well double-applied the correction.
  /** Classroom: extra instruction appended to the prompt. Never replaces the contract. */
  customPromptOverride?: string | null
}

// ============================================================================
// RELAXED ZOD SCHEMAS WITH COERCION FOR VISION OUTPUT PARSING
// These schemas use z.preprocess to handle string/null values from the model
// ============================================================================

// Helper: coerce string/null to number with default
const coerceNumber = (defaultVal: number) =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return defaultVal
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const parsed = parseFloat(val)
      return isNaN(parsed) ? defaultVal : parsed
    }
    return defaultVal
  }, z.number())

// Helper: optional coerced number (nullable)
const coerceOptionalNumber = () =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const parsed = parseFloat(val)
      return isNaN(parsed) ? null : parsed
    }
    return null
  }, z.number().nullable())

// Helper: coerce to boolean with default
const coerceBool = (defaultVal: boolean) =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return defaultVal
    if (typeof val === 'boolean') return val
    if (typeof val === 'string') return val.toLowerCase() === 'true'
    return defaultVal
  }, z.boolean())

// Zod schema for structured vision output - RELAXED with coercion
const VisionMeasurementsSchema = z.object({
  inside_spread: coerceNumber(17).describe('Inside spread measurement in inches'),
  main_beam_left: coerceNumber(22).describe('Left main beam length in inches'),
  main_beam_right: coerceNumber(22).describe('Right main beam length in inches'),
  g1_left: coerceNumber(4).describe('Left G1 (brow tine) length in inches'),
  g1_right: coerceNumber(4).describe('Right G1 (brow tine) length in inches'),
  g2_left: coerceNumber(8).describe('Left G2 tine length in inches'),
  g2_right: coerceNumber(8).describe('Right G2 tine length in inches'),
  g3_left: coerceNumber(6).describe('Left G3 tine length in inches'),
  g3_right: coerceNumber(6).describe('Right G3 tine length in inches'),
  g4_left: coerceNumber(0).describe('Left G4 tine length in inches'),
  g4_right: coerceNumber(0).describe('Right G4 tine length in inches'),
  g5_left: coerceOptionalNumber().describe('Left G5 tine length if present'),
  g5_right: coerceOptionalNumber().describe('Right G5 tine length if present'),
  h1_left: coerceNumber(4.25).describe('Left H1 circumference in inches'),
  h1_right: coerceNumber(4.25).describe('Right H1 circumference in inches'),
  h2_left: coerceNumber(4).describe('Left H2 circumference in inches'),
  h2_right: coerceNumber(4).describe('Right H2 circumference in inches'),
  h3_left: coerceNumber(3.75).describe('Left H3 circumference in inches'),
  h3_right: coerceNumber(3.75).describe('Right H3 circumference in inches'),
  h4_left: coerceNumber(3.5).describe('Left H4 circumference in inches'),
  h4_right: coerceNumber(3.5).describe('Right H4 circumference in inches'),
  abnormal_points: coerceNumber(0).describe('Total abnormal points in inches'),
  deductions: coerceNumber(3).describe('Estimated deductions for asymmetry'),
})

// Per-reference observation sub-schema - RELAXED with coercion
const ReferenceObservationSchema = z.object({
  visibility: coerceBool(false).describe('Whether this reference is clearly visible'),
  quality: coerceNumber(0.5).describe('Detection quality (0–1)'),
  distortion: coerceNumber(0.3).describe('Perspective/lens distortion (0–1)'),
}).partial()

// Helper: optional number (not null, just undefined if missing)
const optionalCoercedNumber = () =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return undefined
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const parsed = parseFloat(val)
      return isNaN(parsed) ? undefined : parsed
    }
    return undefined
  }, z.number().optional())

// Landmarks schema - RELAXED with coercion and defaults
// Note: core fields are required, optional fields use .optional()
const VisionLandmarksSchema = z.object({
  // Required fields with coercion
  ears_visible: coerceBool(false).describe('Whether both ears are visible'),
  eyes_visible: coerceBool(false).describe('Whether both eyes are visible'),
  antlers_visible: coerceBool(true).describe('Whether both antlers are fully visible'),
  ear_base_to_tip_estimated: optionalCoercedNumber().describe('Estimated ear base-to-tip length if visible'),
  scaling_reference_used: z.preprocess(
    (val) => (typeof val === 'string' && val) ? val : 'unknown',
    z.string()
  ).describe('Primary anatomical reference used for scaling'),
  quality_notes: z.preprocess(
    (val) => Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [],
    z.array(z.string())
  ).describe('Notes about image quality'),

  // Multi-reference consensus data - all optional
  eye_box: ReferenceObservationSchema.optional(),
  pedicle_spacing: ReferenceObservationSchema.optional(),
  eye_to_pedicle: ReferenceObservationSchema.optional(),
  skull_width: ReferenceObservationSchema.optional(),
  nose_bridge: ReferenceObservationSchema.optional(),
  muzzle_width: ReferenceObservationSchema.optional(),
  ear_base_spacing: ReferenceObservationSchema.optional(),
  ear_base_to_tip: ReferenceObservationSchema.optional(),

  // Pixel-space measurements - optional with coercion
  eye_width_px_inches: optionalCoercedNumber(),
  pedicle_spacing_px_inches: optionalCoercedNumber(),
  eye_to_pedicle_px_inches: optionalCoercedNumber(),
  skull_forehead_width_px_inches: optionalCoercedNumber(),
  nose_bridge_px_inches: optionalCoercedNumber(),
  muzzle_width_px_inches: optionalCoercedNumber(),
  ear_base_spacing_px_inches: optionalCoercedNumber(),
})

const ReferenceObjectSchema = z.object({
  detected: coerceBool(false).describe('Whether the user-supplied precision reference was detected clearly'),
  type: z.preprocess(
    (val) => (typeof val === 'string' && val.trim()) ? val.trim() : 'none',
    z.string()
  ).describe('Detected reference object type'),
  quality: coerceNumber(0).describe('Detection quality for the reference object (0-1)'),
  distortion: coerceNumber(0.35).describe('Perspective distortion affecting the reference object (0-1)'),
  estimated_long_edge_inches: optionalCoercedNumber().describe('Estimated long-edge length under the current non-reference anatomical scale'),
  estimated_short_edge_inches: optionalCoercedNumber().describe('Estimated short-edge length under the current non-reference anatomical scale'),
  estimated_diameter_inches: optionalCoercedNumber().describe('Estimated diameter under the current non-reference anatomical scale'),
  visible_span_inches: optionalCoercedNumber().describe('Visible real-world span if ruler or tape marks are directly readable'),
  notes: z.preprocess(
    (val) => Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [],
    z.array(z.string())
  ).describe('Reference-specific notes or caveats'),
}).default({
  detected: false,
  type: 'none',
  quality: 0,
  distortion: 0.35,
  notes: [],
})

// Helper: coerce angle enum values with fallback
const coerceAngleEnum = () =>
  z.preprocess(
    (val) => {
      const valid = ['front', 'left', 'right', 'back', 'other', 'none']
      if (typeof val === 'string' && valid.includes(val)) return val
      return 'none'
    },
    z.enum(['front', 'left', 'right', 'back', 'other', 'none'])
  )

// Helper: coerce rack type enum
const coerceRackType = () =>
  z.preprocess(
    (val) => {
      if (val === 'typical' || val === 'non-typical') return val
      if (typeof val === 'string' && val.toLowerCase().includes('non')) return 'non-typical'
      return 'typical'
    },
    z.enum(['typical', 'non-typical'])
  )

// Main output schema - RELAXED with coercion throughout
const VisionOutputSchema = z.object({
  measurements: VisionMeasurementsSchema,
  landmarks: VisionLandmarksSchema,
  reference_object: ReferenceObjectSchema,
  gross_score: coerceNumber(120).describe('Calculated gross B&C score'),
  net_score: coerceNumber(115).describe('Calculated net B&C score'),
  confidence_percent: coerceNumber(50).describe('Confidence in the estimate (10-95%)'),
  main_frame_points: coerceNumber(10).describe('Total number of scoreable points'),
  rack_type_detected: coerceRackType().describe('Whether rack appears typical or non-typical'),
  angle_quality: z.object({
    best_for_spread: coerceAngleEnum(),
    best_for_beams: coerceAngleEnum(),
    best_for_tines: coerceAngleEnum(),
  }).partial().default({}).describe('Which angles were most useful'),
  explanation: z.preprocess(
    (val) => Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [],
    z.array(z.string())
  ).describe('Detailed explanation of estimates'),
  anatomical_references_used: z.preprocess(
    (val) => Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [],
    z.array(z.string())
  ).describe('List of anatomical references used'),
})

export type VisionOutput = z.infer<typeof VisionOutputSchema>

/**
 * Build a detailed prompt for the vision model
 */
function compactPromptJson(value: unknown): string {
  if (value === null || value === undefined) return 'none'
  try {
    const text = JSON.stringify(value)
    return text.length > 1400 ? `${text.slice(0, 1400)}...` : text
  } catch {
    return String(value)
  }
}

function buildPreAiContextBlock(context?: PreAiScoringContext | null): string {
  if (!context) return ''

  const lines: string[] = []
  if (context.selectedImageAngles?.length) {
    lines.push(`- UI-resolved image angles: ${context.selectedImageAngles.join(', ')}`)
  }
  if (context.intakeQuality) {
    lines.push(`- Intake quality assessment: ${compactPromptJson(context.intakeQuality)}`)
  }
  if (context.captureQualitySummary) {
    lines.push(`- Capture coverage summary: ${compactPromptJson(context.captureQualitySummary)}`)
  }
  if (context.imageDiagnosticsSummary) {
    lines.push(`- Image diagnostics summary: ${compactPromptJson(context.imageDiagnosticsSummary)}`)
  }
  if (context.imageDiagnostics?.length) {
    lines.push(`- Per-image diagnostics: ${compactPromptJson(context.imageDiagnostics)}`)
  }
  if (context.referenceModeSummary) {
    lines.push(`- Reference-mode summary: ${compactPromptJson(context.referenceModeSummary)}`)
  }
  if (context.detectionSummary) {
    lines.push(`- Pre-AI rack detection summary: ${compactPromptJson(context.detectionSummary)}`)
  }
  if (context.cropBoxMetadata && Object.keys(context.cropBoxMetadata).length > 0) {
    lines.push(`- Antler crop metadata: ${compactPromptJson(context.cropBoxMetadata)}`)
  }
  if (context.abnormalPointContext) {
    lines.push(`- User abnormal/non-typical point notes: ${compactPromptJson(context.abnormalPointContext)}`)
  }
  if (context.userNotes?.trim()) {
    lines.push(`- User notes: ${context.userNotes.trim().slice(0, 800)}`)
  }

  if (lines.length === 0) return ''

  return `
PRE-AI SCORING CONTEXT
Use these user-entered, UI-derived, and detection-derived signals as evidence while scoring.
They should guide confidence, angle selection, quality penalties, reference-object handling,
and non-typical/abnormal-point interpretation, but visual evidence from the images still wins
when there is a direct contradiction.
${lines.join('\n')}
`
}

export function buildVisionPrompt(input: VisionScoringInput): string {
  const angleDescriptions = input.images.map((img, i) =>
    `Image ${i + 1}: ${img.angleType} angle (${img.width}x${img.height})${img.hasCropBox ? ' [CROPPED]' : ''}`
  ).join('\n')

  const anyCropped = input.images.some((img) => img.hasCropBox)
  const cropNote = anyCropped
    ? `\nUSER CROP NOTE: One or more images have been cropped server-side to focus on the antler region. The full photo context (hunter, background, body) has been removed from cropped frames. The antlers fill most of these frames, so do not expect to see ears, eyes, or body for anatomical proportion references on cropped images — rely on other calibration signals (precision reference, ring/hat reference, or remaining un-cropped frames). Uncropped images are marked with their original angle only.\n`
    : ''
  const precisionReferenceBlock = input.precisionReference?.promptBlock
    ? `
PRECISION REFERENCE MODE
- User intentionally included a known-size reference object.
- ${input.precisionReference.promptBlock}
- If the hard reference is clearly visible and its size is known, prioritize it over anatomical priors for absolute scale.
- Always populate reference_object. If the object is not visible, set detected to false.
- For fixed-size references, estimated_*_inches must represent how large that object would measure under your current non-reference anatomical scale before downstream correction.
- For rulers or tape measures, visible_span_inches should reflect the directly readable real-world span when markings are visible.
- If the reference is not in the same depth plane as the rack, increase distortion and lower quality.
`
    : ''

  const ring = input.referenceObject?.ring
  const ringReferenceBlock =
    ring?.present && ring.innerDiameterInches
      ? `
RING REFERENCE (user-reported, estimated only)
- The user reports a wedding band or ring is visible in the image.
- US ring size: ${ring.ringSizeUS ?? 'not specified'}
- Approximate inner diameter: ${ring.innerDiameterInches} inches
- Use this ONLY as an estimated scale reference if the ring is clearly visible, lying flat, and near the antler.
- Do NOT rely on this reference if the ring is angled, occluded, distorted, or not clearly visible.
- Treat ring-based scale as lower confidence than a ruler or tape measure.
- This does NOT satisfy precision reference mode.
`
      : ''

  const hat = input.referenceObject?.hat
  const hatReferenceBlock =
    hat?.present && hat.hatType
      ? `
HAT REFERENCE (user-reported, estimated only)
- The user reports a ${HAT_DIMENSIONS[hat.hatType].label} is visible in the image.
${hat.brimWidthInches
        ? `- Approximate brim width: ${hat.brimWidthInches} inches (use as scale reference).`
        : `- This hat has no visible brim. Use crown height only as a weak reference (~${hat.crownHeightInches}" tall).`}
- Use this ONLY as an estimated scale reference if the hat is clearly visible.
- Hat brim widths vary by manufacturer — treat as ±0.25" tolerance.
- Do NOT rely on this reference if the hat is angled, occluded, distorted, or far from the antlers.
- Treat hat-based scale as lower confidence than a ruler or tape measure.
- This does NOT satisfy precision reference mode.
`
      : ''

  const preAiContextBlock = buildPreAiContextBlock(input.preAiScoringContext)
  const MEASUREMENT_LABELS: Record<string, string> = {
    main_beam_left: 'Main beam left',
    main_beam_right: 'Main beam right',
    g1_left: 'G1 left', g1_right: 'G1 right',
    g2_left: 'G2 left', g2_right: 'G2 right',
    g3_left: 'G3 left', g3_right: 'G3 right',
    g4_left: 'G4 left', g4_right: 'G4 right',
    h1_left: 'H1 left', h1_right: 'H1 right',
    h2_left: 'H2 left', h2_right: 'H2 right',
    h3_left: 'H3 left', h3_right: 'H3 right',
    h4_left: 'H4 left', h4_right: 'H4 right',
    inside_spread: 'Inside spread',
  }
  const preMeasurements = input.preScoringMeasurements
  const preMeasurementLines = preMeasurements
    ? Object.entries(preMeasurements)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `  ${MEASUREMENT_LABELS[k] ?? k}: ${v}"`)
    : []
  const preMeasurementBlock = preMeasurementLines.length > 0
    ? `
USER-PROVIDED MEASUREMENTS (treat as ground truth)
The user measured these fields with a tape before submitting.
These are verified physical measurements. DO NOT contradict them.
Use them as fixed anchors when estimating all unmeasured fields.

${preMeasurementLines.join('\n')}

Estimate all unmeasured fields based on these confirmed anchors.
`
    : ''

  // Learned field biases are intentionally absent from this prompt. They are
  // applied once, arithmetically, after the model returns (ai-service STAGE
  // 2.5). Asking the model to pre-compensate here as well applied the same
  // correction twice. Do not re-add a bias block.

  const customPromptBlock = input.customPromptOverride?.trim()
    ? `\nADDITIONAL OPERATOR INSTRUCTION (experimental — does not override the rules above)\n${input.customPromptOverride.trim()}\n`
    : ''

  return `${roleIsolationParagraph('measurement')}

INPUT CONTRACT
- Images: ${input.images.length}
${angleDescriptions}
- Crop status: ${anyCropped ? 'one or more images server-cropped to the antler region' : 'no crops applied'}
- State: ${input.state ?? 'not provided'}
- User-indicated rack type: ${input.rackType}
- Source: ${input.sourceType || 'unknown'} / device: ${input.captureDevice || 'unknown'}
- User-indicated total points: ${input.totalPoints || 'not provided'}; main-frame: ${input.mainFramePoints || 'not provided'}
- User says ears fully visible: ${input.earsFullyVisible ? 'yes' : 'unknown/no'}
${cropNote}${preMeasurementBlock}${precisionReferenceBlock}${ringReferenceBlock}${hatReferenceBlock}${preAiContextBlock}
OUTPUT CONTRACT
- All linear measurements in inches, float, one decimal place.
- confidence_percent honest, integer 10-95.
- null (or 0 for required schema fields) for any field you cannot measure; do not invent.
- quality_notes: short strings for every value you flag.
- scaling_reference_used: the single reference tier you committed to.

SCALING DECISION TREE (commit to exactly ONE tier; never blend tiers)
if user tape measurements present:           tier = "user_tape"
elif precision_reference detected:           tier = "precision_reference"
elif eye box visible:                        tier = "eye_box"             (known ${ANATOMICAL_REFERENCES.EYE_BOX_WIDTH}")
elif pedicle spacing visible:                tier = "pedicle_spacing"     (known ${ANATOMICAL_REFERENCES.PEDICLE_SPACING}")
elif eye-to-pedicle visible:                 tier = "eye_to_pedicle"      (known ${ANATOMICAL_REFERENCES.EYE_TO_PEDICLE}")
elif skull forehead width visible:           tier = "skull_width"         (known ${ANATOMICAL_REFERENCES.SKULL_FOREHEAD_WIDTH}")
else:                                        tier = "secondary"
- Record the tier in scaling_reference_used.
- Secondary references (nose bridge ${ANATOMICAL_REFERENCES.NOSE_BRIDGE_LENGTH}", muzzle width ${ANATOMICAL_REFERENCES.MUZZLE_WIDTH}", ear base spacing ${ANATOMICAL_REFERENCES.EAR_BASE_SPACING}", ear base-to-tip ${ANATOMICAL_REFERENCES.EAR_BASE_TO_TIP}") are CROSS-CHECK ONLY — do not let them override a top-tier choice.
- For each reference, populate visibility (true/false), quality (0-1), distortion (0-1). If a reference is not visible, set visibility: false rather than omitting it.
- Set *_px_inches fields to your best inch-equivalent estimate of each reference's detected size, in the same inch space as your other measurements. Leave as undefined if not detected.

MEASUREMENT RULES
- Inside spread: widest interior point between main beams. Mature bucks 16-22".
- Main beams: outside curve, burr to tip. Mature 22-28" per side.
- Tine base: where the tine first separates from the main beam, NOT the visual start.
- Tine length ranges: G1 3-6", G2 8-12", G3 7-11", G4 4-9", G5 (if present) 2-5".
- Circumferences (smallest point between tines): H1 4-5.5", H2 4-5", H3 4-4.5", H4 3.5-4.5".
- Abnormal points: any point outside the typical pattern; sum lengths into abnormal_points.
- Point qualification (B&C): a bump qualifies as a point ONLY if length >= 1 inch AND length > width measured at one inch from the tip. Sub-1" stubs and wider-than-long bumps ("stickers"/"worm holes") do NOT qualify — exclude them from tine totals AND from abnormal_points. Note borderline cases in quality_notes.
- Broken tines: if a tine is clearly snapped, splintered, or rubbed off, report its CURRENT remaining length (not the inferred original). Add the tine key to quality_notes (e.g. "broken: g3_left"). Never invent the missing length.
- Velvet: if the rack is in velvet, score the underlying hard-antler dimensions visible through the velvet. Do not subtract for velvet bulk and do not add a separate velvet measurement.
- Deductions: sum |left - right| asymmetries; estimate non-typical-on-typical penalties.
- typical frame = sum(beams) + sum(tines) + sum(H) + inside_spread.
- gross_score (typical) = typical frame. Do NOT add abnormal_points to it.
- net_score (typical) = gross_score - abnormal_points - deductions.
- gross_score (non-typical) = typical frame + abnormal_points (they count positively).
- net_score (non-typical) = gross_score - deductions.

ANGLE GUIDANCE
- Front: best for spread, eye box, pedicle, skull width.
- Side (left/right): best for main beam length and tine lengths.
- 45-degree: good cross-check; expect moderate perspective distortion.
- Side/oblique distortion 0.3-0.7; front 0.05-0.2; trail-cam/fisheye higher.

PLAUSIBILITY RULES (verify EACH before returning)
- main_beam_{side} > max(g1_{side}, g2_{side}, g3_{side}, g4_{side}) on the same side.
- For each paired field |left - right| / max(left, right) < 0.35 unless the rack is visibly broken or asymmetric; if greater, set confidence_percent < 60 and explain in quality_notes.
- deductions >= 0 and abnormal_points >= 0.
- net_score <= gross_score.
- 40 <= gross_score <= 280 for any real whitetail.
- H1 >= H2 >= H3 >= H4 typically (mass tapers distally); violations -> note in quality_notes; do not "fix" by inventing values.
- G2 typically >= G1 on mature bucks; sub-mature bucks may legitimately violate.
- Any reported tine length < 1.0" is a non-qualifying point and must be excluded from tine totals and abnormal_points; if you included one, recompute.

SELF-CHECK (perform before returning)
1. Did you commit to ONE scaling tier and record it in scaling_reference_used?
2. Recompute gross_score from the fields above. Does it match what you set?
3. net_score <= gross_score? deductions >= 0? All measurements within ranges?
4. For every value with low confidence, did you add a quality_note explaining why?
5. If the image is too poor to measure: set confidence_percent < 40 and explain in quality_notes. Do not invent inches.
6. Did you exclude every sub-1" bump from tine totals and abnormal_points, and flag any clearly broken tines in quality_notes?

REFUSE
If image quality fails (blur beyond recognition, obstruction, rack absent), do NOT invent numbers. Return your best honest estimate with confidence_percent < 40 and quality_notes explaining what failed.
${customPromptBlock}
Respond with structured JSON matching the required schema.`
}

/**
 * Normalize a raw vision response to fix common parsing issues.
 * This is a fallback layer that coerces types and fills in defaults
 * when the model returns partial or malformed data.
 */
function normalizeVisionResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    console.warn('[vision-scorer] normalizeVisionResponse: raw is not an object')
    return raw
  }

  const obj = raw as Record<string, unknown>
  
  // Helper to coerce a value to number
  const toNum = (val: unknown, defaultVal: number): number => {
    if (typeof val === 'number' && !isNaN(val)) return val
    if (typeof val === 'string') {
      const parsed = parseFloat(val)
      if (!isNaN(parsed)) return parsed
    }
    return defaultVal
  }

  // Helper to coerce to boolean
  const toBool = (val: unknown, defaultVal: boolean): boolean => {
    if (typeof val === 'boolean') return val
    if (typeof val === 'string') return val.toLowerCase() === 'true'
    return defaultVal
  }

  // Normalize measurements
  const rawMeasurements = obj.measurements as Record<string, unknown> | undefined
  const measurements = {
    inside_spread: toNum(rawMeasurements?.inside_spread, 17),
    main_beam_left: toNum(rawMeasurements?.main_beam_left, 22),
    main_beam_right: toNum(rawMeasurements?.main_beam_right, 22),
    g1_left: toNum(rawMeasurements?.g1_left, 4),
    g1_right: toNum(rawMeasurements?.g1_right, 4),
    g2_left: toNum(rawMeasurements?.g2_left, 8),
    g2_right: toNum(rawMeasurements?.g2_right, 8),
    g3_left: toNum(rawMeasurements?.g3_left, 6),
    g3_right: toNum(rawMeasurements?.g3_right, 6),
    g4_left: toNum(rawMeasurements?.g4_left, 0),
    g4_right: toNum(rawMeasurements?.g4_right, 0),
    g5_left: rawMeasurements?.g5_left != null ? toNum(rawMeasurements.g5_left, 0) : null,
    g5_right: rawMeasurements?.g5_right != null ? toNum(rawMeasurements.g5_right, 0) : null,
    h1_left: toNum(rawMeasurements?.h1_left, 4.25),
    h1_right: toNum(rawMeasurements?.h1_right, 4.25),
    h2_left: toNum(rawMeasurements?.h2_left, 4),
    h2_right: toNum(rawMeasurements?.h2_right, 4),
    h3_left: toNum(rawMeasurements?.h3_left, 3.75),
    h3_right: toNum(rawMeasurements?.h3_right, 3.75),
    h4_left: toNum(rawMeasurements?.h4_left, 3.5),
    h4_right: toNum(rawMeasurements?.h4_right, 3.5),
    abnormal_points: toNum(rawMeasurements?.abnormal_points, 0),
    deductions: toNum(rawMeasurements?.deductions, 3),
  }

  // Normalize landmarks
  const rawLandmarks = obj.landmarks as Record<string, unknown> | undefined
  const landmarks = {
    ears_visible: toBool(rawLandmarks?.ears_visible, false),
    eyes_visible: toBool(rawLandmarks?.eyes_visible, false),
    antlers_visible: toBool(rawLandmarks?.antlers_visible, true),
    ear_base_to_tip_estimated: rawLandmarks?.ear_base_to_tip_estimated != null 
      ? toNum(rawLandmarks.ear_base_to_tip_estimated, 7.5) 
      : undefined,
    scaling_reference_used: typeof rawLandmarks?.scaling_reference_used === 'string' 
      ? rawLandmarks.scaling_reference_used 
      : 'unknown',
    quality_notes: Array.isArray(rawLandmarks?.quality_notes) 
      ? rawLandmarks.quality_notes.filter((n): n is string => typeof n === 'string')
      : [],
    // Pass through optional reference observations
    eye_box: rawLandmarks?.eye_box,
    pedicle_spacing: rawLandmarks?.pedicle_spacing,
    eye_to_pedicle: rawLandmarks?.eye_to_pedicle,
    skull_width: rawLandmarks?.skull_width,
    nose_bridge: rawLandmarks?.nose_bridge,
    muzzle_width: rawLandmarks?.muzzle_width,
    ear_base_spacing: rawLandmarks?.ear_base_spacing,
    ear_base_to_tip: rawLandmarks?.ear_base_to_tip,
    // Pixel measurements
    eye_width_px_inches: rawLandmarks?.eye_width_px_inches,
    pedicle_spacing_px_inches: rawLandmarks?.pedicle_spacing_px_inches,
    eye_to_pedicle_px_inches: rawLandmarks?.eye_to_pedicle_px_inches,
    skull_forehead_width_px_inches: rawLandmarks?.skull_forehead_width_px_inches,
    nose_bridge_px_inches: rawLandmarks?.nose_bridge_px_inches,
    muzzle_width_px_inches: rawLandmarks?.muzzle_width_px_inches,
    ear_base_spacing_px_inches: rawLandmarks?.ear_base_spacing_px_inches,
  }

  const rawReferenceObject = obj.reference_object as Record<string, unknown> | undefined
  const reference_object = {
    detected: toBool(rawReferenceObject?.detected, false),
    type: typeof rawReferenceObject?.type === 'string' ? rawReferenceObject.type : 'none',
    quality: Math.max(0, Math.min(1, toNum(rawReferenceObject?.quality, 0))),
    distortion: Math.max(0, Math.min(1, toNum(rawReferenceObject?.distortion, 0.35))),
    estimated_long_edge_inches: rawReferenceObject?.estimated_long_edge_inches != null
      ? toNum(rawReferenceObject.estimated_long_edge_inches, 0)
      : undefined,
    estimated_short_edge_inches: rawReferenceObject?.estimated_short_edge_inches != null
      ? toNum(rawReferenceObject.estimated_short_edge_inches, 0)
      : undefined,
    estimated_diameter_inches: rawReferenceObject?.estimated_diameter_inches != null
      ? toNum(rawReferenceObject.estimated_diameter_inches, 0)
      : undefined,
    visible_span_inches: rawReferenceObject?.visible_span_inches != null
      ? toNum(rawReferenceObject.visible_span_inches, 0)
      : undefined,
    notes: Array.isArray(rawReferenceObject?.notes)
      ? rawReferenceObject.notes.filter((n): n is string => typeof n === 'string')
      : [],
  }

  // Normalize angle_quality
  const rawAngleQuality = obj.angle_quality as Record<string, unknown> | undefined
  const validAngles = ['front', 'left', 'right', 'back', 'other', 'none']
  const toAngle = (val: unknown): string => {
    if (typeof val === 'string' && validAngles.includes(val)) return val
    return 'none'
  }
  const angle_quality = {
    best_for_spread: toAngle(rawAngleQuality?.best_for_spread),
    best_for_beams: toAngle(rawAngleQuality?.best_for_beams),
    best_for_tines: toAngle(rawAngleQuality?.best_for_tines),
  }

  // Normalize rack_type_detected
  let rack_type_detected = 'typical'
  if (obj.rack_type_detected === 'non-typical') {
    rack_type_detected = 'non-typical'
  } else if (typeof obj.rack_type_detected === 'string' && obj.rack_type_detected.toLowerCase().includes('non')) {
    rack_type_detected = 'non-typical'
  }

  return {
    measurements,
    landmarks,
    reference_object,
    gross_score: toNum(obj.gross_score, 120),
    net_score: toNum(obj.net_score, 115),
    confidence_percent: Math.min(95, Math.max(10, toNum(obj.confidence_percent, 50))),
    main_frame_points: Math.min(20, Math.max(6, toNum(obj.main_frame_points, 10))),
    rack_type_detected,
    angle_quality,
    explanation: Array.isArray(obj.explanation) 
      ? obj.explanation.filter((e): e is string => typeof e === 'string')
      : [],
    anatomical_references_used: Array.isArray(obj.anatomical_references_used)
      ? obj.anatomical_references_used.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

/**
 * Prepare image content for the vision model.
 *
 * Transport rules:
 *  - https:// URL  → URL object  (preferred, works with all providers)
 *  - data:         → string      (only supported by gateway, NOT OpenAI)
 *
 * For OpenAI: throws if any image is a data: URL, because the OpenAI API
 * requires http/https scheme and returns "URL scheme must be http or https".
 */
function prepareImageContent(
  images: VisionImageInput[],
  provider: string
): Array<{ type: 'image'; image: URL | string }> {
  const transportTypes = images.map(img => {
    if (img.imageUrl.startsWith('https://')) return 'https_url'
    if (img.imageUrl.startsWith('http://'))  return 'http_url'
    if (img.imageUrl.startsWith('data:'))    return 'data_url'
    return 'unknown'
  })

  const allHttps = transportTypes.every(t => t === 'https_url')
  const hasDataUrl = transportTypes.some(t => t === 'data_url')

  console.log('[vision-scorer] image transport check', {
    provider,
    imageCount: images.length,
    transportTypes,
    allHttps,
    hasDataUrl,
  })

  // OpenAI requires https:// — reject data: URLs before they reach the API
  if (provider === 'openai' && hasDataUrl) {
    const badIndices = transportTypes
      .map((t, i) => (t === 'data_url' ? i : -1))
      .filter(i => i >= 0)
    throw new Error(
      `[vision-scorer] OpenAI vision requires https:// image URLs. ` +
      `data: URLs found at indices [${badIndices.join(', ')}]. ` +
      `Ensure images are uploaded to storage before scoring.`
    )
  }

  return images.map(img => {
    if (img.imageUrl.startsWith('data:')) {
      // Non-OpenAI providers (gateway) accept data URL strings directly
      return { type: 'image' as const, image: img.imageUrl }
    }
    return { type: 'image' as const, image: new URL(img.imageUrl) }
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

  const imageContent = prepareImageContent(validImages, visionProvider)
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
  // Enhanced with detailed logging for debugging validation failures
  const visionCallResult = await executeWithRuntime(async () => {
    const prompt = buildVisionPrompt({ ...input, images: validImages })

    const { object: rawOutput } = await generateObject({
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
      // Greedy decoding. This is a measurement task: the same photos must
      // produce the same inches. Without this the OpenAI default (1.0) is
      // used, so identical submissions came back several inches apart purely
      // from sampling noise, which is indistinguishable from real measurement
      // error and poisons the correction flywheel with phantom deltas.
      temperature: 0,
      // Note: AI SDK has its own retry logic, but we wrap it for timeout/monitoring
      maxRetries: 1,
    })

    // Log raw model response BEFORE any post-processing
    console.log('[vision-scorer] raw model response received', {
      provider: visionProvider,
      model: visionModelName,
      hasOutput: !!rawOutput,
      outputType: typeof rawOutput,
      hasGrossScore: rawOutput && typeof rawOutput === 'object' && 'gross_score' in rawOutput,
      hasMeasurements: rawOutput && typeof rawOutput === 'object' && 'measurements' in rawOutput,
      hasLandmarks: rawOutput && typeof rawOutput === 'object' && 'landmarks' in rawOutput,
    })

    // Attempt manual safeParse to get detailed validation errors
    const parseResult = VisionOutputSchema.safeParse(rawOutput)
    
    if (!parseResult.success) {
      // Log detailed Zod validation errors
      console.error('[vision-scorer] Zod validation FAILED - detailed errors:', {
        provider: visionProvider,
        model: visionModelName,
        errorCount: parseResult.error.errors.length,
        errors: parseResult.error.errors.map(err => ({
          path: err.path.join('.'),
          code: err.code,
          message: err.message,
          received: err.code === 'invalid_type' ? (err as unknown as Record<string, unknown>).received : undefined,
          expected: err.code === 'invalid_type' ? (err as unknown as Record<string, unknown>).expected : undefined,
        })),
        rawOutputSample: JSON.stringify(rawOutput).slice(0, 2000),
      })
      
      // Attempt to normalize and coerce the raw output to fix common issues
      const normalizedOutput = normalizeVisionResponse(rawOutput)
      const retryParse = VisionOutputSchema.safeParse(normalizedOutput)
      
      if (retryParse.success) {
        console.log('[vision-scorer] normalization rescued the response', {
          provider: visionProvider,
          model: visionModelName,
        })
        return retryParse.data
      } else {
        console.error('[vision-scorer] normalization could not rescue response', {
          remainingErrors: retryParse.error.errors.length,
          errors: retryParse.error.errors.slice(0, 5).map(e => `${e.path.join('.')}: ${e.message}`),
        })
        // Still throw to trigger retry/fallback
        throw new Error(`Zod validation failed: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`)
      }
    }

    console.log('[vision-scorer] post-call success', {
      provider: visionProvider,
      model: visionModelName,
      visionSucceeded: true,
      fallbackUsed: false,
    })

    return parseResult.data
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
 * Since ReferenceObservationSchema is now partial, we provide defaults for quality/distortion.
 */
export function visionOutputToReferenceQualityData(
  output: VisionOutput
): Partial<Record<import('./reference-consensus').ReferenceLabel, { quality: number; distortion: number }>> {
  const lm = output.landmarks
  const result: Partial<Record<import('./reference-consensus').ReferenceLabel, { quality: number; distortion: number }>> = {}

  // Helper to safely extract quality/distortion with defaults
  const getQD = (ref: { visibility?: boolean; quality?: number; distortion?: number } | undefined) => {
    if (!ref?.visibility) return null
    return { quality: ref.quality ?? 0.5, distortion: ref.distortion ?? 0.3 }
  }

  const eye_box_qd = getQD(lm.eye_box)
  if (eye_box_qd) result.eye_box = eye_box_qd
  
  const pedicle_qd = getQD(lm.pedicle_spacing)
  if (pedicle_qd) result.pedicle_spacing = pedicle_qd
  
  const eye_to_pedicle_qd = getQD(lm.eye_to_pedicle)
  if (eye_to_pedicle_qd) result.eye_to_pedicle = eye_to_pedicle_qd
  
  const skull_qd = getQD(lm.skull_width)
  if (skull_qd) result.skull_width = skull_qd
  
  const nose_qd = getQD(lm.nose_bridge)
  if (nose_qd) result.nose_bridge = nose_qd
  
  const muzzle_qd = getQD(lm.muzzle_width)
  if (muzzle_qd) result.muzzle_width = muzzle_qd
  
  const ear_spacing_qd = getQD(lm.ear_base_spacing)
  if (ear_spacing_qd) result.ear_base_spacing = ear_spacing_qd

  const ear_tip_qd = getQD(lm.ear_base_to_tip)
  if (ear_tip_qd) result.ear_base_to_tip = ear_tip_qd

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// P2: Landmark pixel detection — detect precise (px, py) for every antler landmark
// ─────────────────────────────────────────────────────────────────────────────

const LandmarkPointSchema = z.object({
  id: z.string(),
  px: z.number().nullable(),
  py: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  visibility: z.enum(['clear', 'partially_visible', 'occluded', 'not_visible']),
  sourceAngle: z.enum(['front', 'left', 'right', 'unknown']),
})

const ParallelLinePairSchema = z.object({
  label: z.string().optional(),
  line1: z.array(z.object({ x: z.number(), y: z.number() })).length(2),
  line2: z.array(z.object({ x: z.number(), y: z.number() })).length(2),
})

const LandmarkDetectionSchema = z.object({
  imageWidth: z.number(),
  imageHeight: z.number(),
  landmarks: z.array(LandmarkPointSchema),
  // Eye-circle calibration radii — optional per §4.3 of CLAUDE.md so older
  // model responses without these fields still parse cleanly.
  eyeCircleLeftRadiusPx: z.number().positive().nullable().optional(),
  eyeCircleRightRadiusPx: z.number().positive().nullable().optional(),
  // Optional vanishing-point cross-check (§4.7). Two background line pairs
  // the model believes are parallel in 3D. Always optional — absent ⇒ skip.
  parallelLinePairs: z.array(ParallelLinePairSchema).max(2).optional(),
})

const LANDMARK_IDS: AntlerLandmarkId[] = [
  'eye_left', 'eye_right', 'pedicle_left', 'pedicle_right', 'nose_tip', 'nose_bridge_top',
  'ear_base_left', 'ear_base_right', 'ear_tip_left', 'ear_tip_right',
  'burr_left', 'burr_right', 'beam_tip_left', 'beam_tip_right',
  'spread_anchor_left', 'spread_anchor_right',
  'g1_base_left', 'g1_tip_left', 'g2_base_left', 'g2_tip_left',
  'g3_base_left', 'g3_tip_left', 'g4_base_left', 'g4_tip_left',
  'g5_base_left', 'g5_tip_left',
  'g1_base_right', 'g1_tip_right', 'g2_base_right', 'g2_tip_right',
  'g3_base_right', 'g3_tip_right', 'g4_base_right', 'g4_tip_right',
  'g5_base_right', 'g5_tip_right',
  'h1_center_left', 'h1_center_right', 'h2_center_left', 'h2_center_right',
  'h3_center_left', 'h3_center_right', 'h4_center_left', 'h4_center_right',
]

/**
 * Run landmark detection on a SINGLE image. The model never sees more than one
 * image at a time, so every landmark in the response is unambiguously tagged
 * with the supplied imageIndex and angleType — no risk of the model conflating
 * which image a coordinate came from.
 *
 * Best-effort — returns a failed result on any error so the caller can keep
 * processing other images. Never throws.
 */
async function detectLandmarksForOneImage(args: {
  imageUrl: string
  imageIndex: number
  angleType: 'front' | 'left' | 'right' | 'unknown'
  /** True pixel size measured server-side. 0 ⇒ unknown (legacy behavior). */
  knownWidth?: number
  knownHeight?: number
}): Promise<PerImageLandmarkResult> {
  const { imageUrl, imageIndex, angleType } = args
  const knownWidth = args.knownWidth ?? 0
  const knownHeight = args.knownHeight ?? 0

  const fail = (reason: string): PerImageLandmarkResult => ({
    imageIndex,
    imageUrl,
    angleType,
    landmarks: [],
    imageWidth: 0,
    imageHeight: 0,
    modelUsed: 'gpt-4o',
    detectionTimestamp: new Date().toISOString(),
    locatedCount: 0,
    requestedCount: LANDMARK_IDS.length,
    failed: true,
    failureReason: reason,
  })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fail('OPENAI_API_KEY not configured')

  const landmarkList = LANDMARK_IDS.join(', ')

  // Real dimensions measured server-side are stated in the prompt so the
  // model anchors its coordinates to the actual pixel grid. 0/0 falls back to
  // the old "you tell us the size" wording only when the probe failed.
  const prompt = buildLandmarkDetectionPrompt({
    imageWidth: knownWidth,
    imageHeight: knownHeight,
    angleType,
    landmarkList,
  })

  try {
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: LandmarkDetectionSchema,
      // Deterministic: landmark pixel coordinates must not wander between runs.
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image' as const, image: imageUrl },
            { type: 'text', text: prompt },
          ],
        },
      ],
      maxRetries: 0,
    })

    const landmarks: LandmarkDetection[] = object.landmarks
      .filter((lm) => LANDMARK_IDS.includes(lm.id as AntlerLandmarkId))
      .map((lm) => ({
        id: lm.id as AntlerLandmarkId,
        px: lm.px,
        py: lm.py,
        confidence: lm.confidence,
        visibility: lm.visibility,
        // Trust the model's angle if it agrees, otherwise override with the
        // angle the caller declared — single-image calls remove the ambiguity.
        sourceAngle: angleType === 'unknown' ? lm.sourceAngle : angleType,
        source: 'ai' as const,
      }))

    const locatedCount = landmarks.filter(
      (lm) => lm.px != null && lm.py != null && lm.visibility !== 'not_visible',
    ).length

    const leftIris = object.eyeCircleLeftRadiusPx
    const rightIris = object.eyeCircleRightRadiusPx
    const eyeCircles = (leftIris != null || rightIris != null)
      ? {
          leftRadiusPx: leftIris ?? null,
          rightRadiusPx: rightIris ?? null,
        }
      : undefined

    const parallelLinePairs = object.parallelLinePairs
      ? object.parallelLinePairs.map((p) => ({
          label: p.label,
          line1: [p.line1[0], p.line1[1]] as [
            { x: number; y: number }, { x: number; y: number },
          ],
          line2: [p.line2[0], p.line2[1]] as [
            { x: number; y: number }, { x: number; y: number },
          ],
        }))
      : undefined

    return {
      imageIndex,
      imageUrl,
      angleType,
      landmarks,
      // Measured size wins. The model's self-reported dimensions are only a
      // fallback for the rare case the probe failed — trusting its guess is
      // what put every landmark dot in the wrong place.
      imageWidth: knownWidth > 0 ? knownWidth : object.imageWidth,
      imageHeight: knownHeight > 0 ? knownHeight : object.imageHeight,
      modelUsed: 'gpt-4o',
      detectionTimestamp: new Date().toISOString(),
      locatedCount,
      requestedCount: LANDMARK_IDS.length,
      eyeCircles,
      parallelLinePairs,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return fail(msg)
  }
}

/**
 * Detect antler landmarks for every supplied image in parallel.
 *
 * Each image gets its own GPT-4o call so the model cannot mix up which image a
 * landmark came from. Returns one PerImageLandmarkResult per input URL (failed
 * entries marked with failed === true rather than thrown).
 *
 * angleTypes must align positionally with imageUrls; pass 'unknown' for any
 * slot whose angle was not declared.
 */
export async function detectLandmarkPositionsPerImage(
  imageUrls: string[],
  angleTypes?: Array<'front' | 'left' | 'right' | 'unknown'>,
): Promise<PerImageLandmarkResult[]> {
  if (!imageUrls || imageUrls.length === 0) return []

  // Measure each image's true pixel size before asking for coordinates.
  // Previously the prompt told the model to report imageWidth/imageHeight
  // itself, and that guess became the denominator the overlay divides by —
  // so whenever the model guessed wrong (it usually does), every landmark
  // was drawn at the wrong place. Reading the real size costs one HEAD-ish
  // fetch per image and runs in parallel with nothing else blocking on it.
  const dims = await Promise.all(imageUrls.map(probeImageDimensions))

  const tasks = imageUrls.map((imageUrl, imageIndex) =>
    detectLandmarksForOneImage({
      imageUrl,
      imageIndex,
      angleType: angleTypes?.[imageIndex] ?? 'unknown',
      knownWidth: dims[imageIndex]?.width ?? 0,
      knownHeight: dims[imageIndex]?.height ?? 0,
    }),
  )

  return Promise.all(tasks)
}

/**
 * True pixel dimensions of a remote image, or null when it can't be read.
 * sharp is imported dynamically so this module stays importable from tests
 * (and any non-node context) that never call it.
 */
export async function probeImageDimensions(
  imageUrl: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const { default: sharp } = await import('sharp')
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height) return null
    return { width: meta.width, height: meta.height }
  } catch (err) {
    console.warn('[vision-scorer] image dimension probe failed:', err)
    return null
  }
}

/**
 * Backwards-compatible single-result wrapper. Runs the per-image detector and
 * flattens the per-image arrays into the legacy LandmarksDetectionResult shape.
 * Returns null only when ALL per-image calls failed, matching the old contract.
 */
export async function detectLandmarkPositions(
  imageUrls: string[],
  angleTypes?: Array<'front' | 'left' | 'right' | 'unknown'>,
): Promise<LandmarkDetectionResult | null> {
  const perImage = await detectLandmarkPositionsPerImage(imageUrls, angleTypes)
  const usable = perImage.filter(r => !r.failed)
  if (usable.length === 0) return null

  // Pick the image with the most located landmarks as the canonical source for
  // imageWidth/imageHeight — older callers expect a single canvas size.
  const best = [...usable].sort((a, b) => b.locatedCount - a.locatedCount)[0]
  const allLandmarks: LandmarkDetection[] = usable.flatMap(r => r.landmarks)
  const locatedCount = allLandmarks.filter(
    (lm) => lm.px != null && lm.py != null && lm.visibility !== 'not_visible',
  ).length

  return {
    landmarks: allLandmarks,
    imageWidth: best.imageWidth,
    imageHeight: best.imageHeight,
    modelUsed: 'gpt-4o',
    detectionTimestamp: new Date().toISOString(),
    locatedCount,
    requestedCount: LANDMARK_IDS.length,
  }
}
