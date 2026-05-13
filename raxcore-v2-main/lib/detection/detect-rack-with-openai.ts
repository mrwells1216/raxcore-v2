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

export async function detectRackWithOpenAI(
  imageUrls: string[],
): Promise<DetectionImageAnalysis[]> {
  const results: DetectionImageAnalysis[] = []

  for (let i = 0; i < imageUrls.length; i += 1) {
    const imageUrl = imageUrls[i]

    const response = await generateObject({
      model: openai('gpt-4o'),
      schema: detectionSchema,
      system: `
You are a strict antler-detection analyst.

Your job is NOT to score the rack.
Your job is to determine whether the image contains:
1. a real deer with visible antlers,
2. a mounted deer,
3. shed antlers,
4. or a non-deer / unusable subject.

Return conservative confidence values.
If the frame is doubtful, lower confidence and add issues.

Landmark keys you should use when visible:
- burr_left
- burr_right
- beam_tip_left
- beam_tip_right
- spread_anchor_left
- spread_anchor_right
- g1_left_tip
- g2_left_tip
- g3_left_tip
- g4_left_tip
- g1_right_tip
- g2_right_tip
- g3_right_tip
- g4_right_tip

Coordinates must be normalized 0..1 relative to the image.
Only emit landmarks when you have legitimate visual evidence.
`,
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

    results.push({
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
    })
  }

  return results
}
