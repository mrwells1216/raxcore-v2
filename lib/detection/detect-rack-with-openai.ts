import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type {
  DetectionImageAnalysis,
  DetectionIssue,
  RackLandmark,
} from './types'
import { clamp01, toBand } from './helpers'

const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

const landmarkSchema = z.object({
  key: z.string(),
  label: z.string(),
  point: pointSchema.nullable(),
  confidence: z.number().min(0).max(1),
  visible: z.boolean(),
  inferred: z.boolean(),
})

const boxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
})

const issueSchema = z.object({
  code: z.enum([
    'non_deer_subject',
    'no_antlers_visible',
    'rack_too_small',
    'too_blurry',
    'too_dark',
    'too_far',
    'heavy_occlusion',
    'bad_angle',
    'mounted_bias',
    'unknown_subject',
  ]),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
})

const detectionSchema = z.object({
  subjectType: z.enum(['deer', 'mounted_deer', 'shed_antlers', 'non_deer', 'unknown']),
  subjectConfidence: z.number().min(0).max(1),
  antlerPresenceConfidence: z.number().min(0).max(1),
  rackVisibilityConfidence: z.number().min(0).max(1),
  usableFrameScore: z.number().min(0).max(1),
  view: z.enum(['front', 'left', 'right', 'front_left', 'front_right', 'rear', 'unknown']),
  mounted: z.boolean(),
  occlusionScore: z.number().min(0).max(1),
  blurScore: z.number().min(0).max(1),
  lightingScore: z.number().min(0).max(1),
  rackBox: boxSchema.nullable(),
  leftRackBox: boxSchema.nullable(),
  rightRackBox: boxSchema.nullable(),
  landmarks: z.array(landmarkSchema),
  issues: z.array(issueSchema),
})

function normalizeIssues(
  issues: z.infer<typeof issueSchema>[],
): DetectionIssue[] {
  return issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
  }))
}

function normalizeLandmarks(
  landmarks: z.infer<typeof landmarkSchema>[],
  imageIndex: number,
): RackLandmark[] {
  return landmarks.map(item => ({
    key: item.key,
    label: item.label,
    point: item.point ? { x: item.point.x, y: item.point.y } : null,
    confidence: clamp01(item.confidence),
    band: toBand(item.confidence),
    visible: item.visible,
    inferred: item.inferred,
    sourceImageIndex: imageIndex,
  }))
}

export const DETECTION_SYSTEM_PROMPT = `
ROLE
You are an antler-admission analyst. You decide whether the image is usable
for downstream B&C scoring. You do NOT score, measure, or rank.

INPUT CONTRACT
A single image. No accompanying data.

OUTPUT CONTRACT
Match the provided schema. subjectType is one of: deer, mounted_deer,
shed_antlers, non_deer, unknown. All confidences 0..1. Coordinates
normalized 0..1 relative to the image. Only emit landmarks with legitimate
visual evidence.

REJECT CRITERIA (set usableFrameScore < 0.5 and add issues[])
- No antler visible in frame.
- Mounted shoulder mount with rack out of frame or covered.
- Blur, motion, or exposure beyond recognition of tines.
- Multiple deer where rack ownership is ambiguous.
- Subject is not a deer (human, dog, decoy, other ungulate).

CONFIDENCE GUIDANCE
- 0.85+   clean, sharp, both antlers visible, single subject, no occlusion.
- 0.60-0.85   usable but one antler partial, moderate angle, or mild blur.
- 0.45-0.60   marginal — admit but expect downstream low confidence.
- < 0.45   reject.

SELF-CHECK
1. Is there a deer (live, mounted, or shed antlers alone)?
2. Are antlers visibly present and at least partly in frame?
3. If you set any landmark, can you point at the pixel that justifies it?
4. If any answer is no, lower confidence and add a string to issues[].

Landmark keys when visible: burr_left, burr_right, beam_tip_left,
beam_tip_right, spread_anchor_left, spread_anchor_right, g1_left_tip,
g2_left_tip, g3_left_tip, g4_left_tip, g1_right_tip, g2_right_tip,
g3_right_tip, g4_right_tip.
`

export async function detectRackWithOpenAI(
  imageUrls: string[],
): Promise<DetectionImageAnalysis[]> {
  // One admission call per image, all in flight at once. Order is preserved
  // by index; any single failure rejects the whole batch (same semantics as
  // the previous serial loop — the caller catches and continues to scoring).
  return Promise.all(
    imageUrls.map(async (imageUrl, i): Promise<DetectionImageAnalysis> => {
      const response = await generateObject({
        model: openai('gpt-4o'),
        schema: detectionSchema,
        system: DETECTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Analyze this image for deer subject validity, rack visibility, view angle, and antler landmarks. Be strict. Reject non-deer and weak frames.',
              },
              {
                type: 'image',
                image: imageUrl,
              },
            ],
          },
        ],
      })

      const obj = response.object

      const accepted =
        (obj.subjectType === 'deer' ||
          obj.subjectType === 'mounted_deer' ||
          obj.subjectType === 'shed_antlers') &&
        obj.antlerPresenceConfidence >= 0.45 &&
        obj.usableFrameScore >= 0.45

      return {
        imageIndex: i,
        subjectType: obj.subjectType,
        subjectConfidence: clamp01(obj.subjectConfidence),
        antlerPresenceConfidence: clamp01(obj.antlerPresenceConfidence),
        rackVisibilityConfidence: clamp01(obj.rackVisibilityConfidence),
        usableFrameScore: clamp01(obj.usableFrameScore),
        view: obj.view,
        mounted: obj.mounted,
        occlusionScore: clamp01(obj.occlusionScore),
        blurScore: clamp01(obj.blurScore),
        lightingScore: clamp01(obj.lightingScore),
        rackBox: obj.rackBox,
        leftRackBox: obj.leftRackBox,
        rightRackBox: obj.rightRackBox,
        landmarks: normalizeLandmarks(obj.landmarks, i),
        issues: normalizeIssues(obj.issues),
        accepted,
      }
    }),
  )
}
