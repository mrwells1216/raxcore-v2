import 'server-only'

import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  PROMPT_STYLE_VERSION,
  PROMPT_SECTIONS,
  roleIsolationParagraph,
} from '@/lib/scoring/prompt-style'
import type {
  ArucoDetection,
  ArucoCornerPx,
} from '@/lib/scoring/aruco-types'

const ArucoCornerSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const ArucoResponseSchema = z.object({
  detected: z.boolean(),
  markerId: z.number().nullable().optional(),
  corners: z.array(ArucoCornerSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
})

/** Public for testability — extracted so the prompt can be snapshot-tested. */
export const ARUCO_DETECTION_SYSTEM_PROMPT = [
  PROMPT_SECTIONS.ROLE,
  roleIsolationParagraph('landmark'),
  ``,
  `${PROMPT_STYLE_VERSION} — ArUco marker detector. You locate a printed,`,
  `square ArUco marker in the image. You do NOT score the rack, locate antler`,
  `landmarks, or estimate inches. Downstream geometry uses your four corner`,
  `coordinates against the user-supplied physical side length to derive`,
  `pixels-per-inch.`,
  ``,
  PROMPT_SECTIONS.INPUT,
  `One image is supplied. The user has stated the marker is present. Your job`,
  `is to find the printed marker — a square black-and-white pattern surrounded`,
  `by a thick black border. It usually appears on a piece of paper near the`,
  `rack.`,
  ``,
  PROMPT_SECTIONS.OUTPUT,
  `Return:`,
  `  detected   — true ONLY if you can locate the marker's four outer corners`,
  `               with high confidence (≥0.5). false otherwise.`,
  `  markerId   — the ArUco dictionary id if visible (number), else null.`,
  `  corners    — array of four {x, y} objects in CLOCKWISE order starting at`,
  `               the marker's TOP-LEFT outer corner. Pixel coordinates as`,
  `               floats with one decimal. ORIGIN: top-left of image.`,
  `  confidence — 0.0 to 1.0. Be honest. Partial occlusion drops below 0.6.`,
  `  reason     — short explanation when detected = false.`,
  ``,
  PROMPT_SECTIONS.PLACEMENT,
  `- Corners are the OUTER black square's vertices, not the white inner pattern.`,
  `- Order is strictly clockwise: top-left, top-right, bottom-right, bottom-left.`,
  `- If you are unsure which corner is "top-left" (e.g. the marker is rotated`,
  `  90°), pick the corner that visually appears at the smallest combined x+y`,
  `  position and continue clockwise from there.`,
  `- Do NOT report the QR-code-like inner cells as separate corners.`,
  ``,
  PROMPT_SECTIONS.MISSING,
  `- If the marker is occluded, blurred, off-frame, or no printed marker is`,
  `  visible: detected = false, corners omitted, confidence ≤ 0.2,`,
  `  reason = short description.`,
  ``,
  PROMPT_SECTIONS.REFUSE,
  `If the image is not a deer/antler photo, return detected = false with`,
  `reason = "non-antler image". Do not invent corner coordinates.`,
  ``,
  PROMPT_SECTIONS.SELF_CHECK,
  `1. Did you return exactly four corners in clockwise order?`,
  `2. Do the four edges connecting consecutive corners form a convex`,
  `   quadrilateral? If they self-intersect or form a bowtie, your ordering`,
  `   is wrong — recheck.`,
  `3. Is the smallest edge at least 20 px and the largest at most ~60% of the`,
  `   image diagonal? Markers outside this range are likely false positives.`,
].join('\n')

/**
 * Detect an ArUco marker in a single image via GPT-4o.
 *
 * Best-effort: returns null on any error, missing API key, schema failure, or
 * model "not detected" response. Never throws.
 */
export async function detectArucoMarker(args: {
  imageUrl: string
  imageIndex: number
}): Promise<ArucoDetection | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  try {
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: ArucoResponseSchema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image' as const, image: args.imageUrl },
            { type: 'text', text: ARUCO_DETECTION_SYSTEM_PROMPT },
          ],
        },
      ],
      maxRetries: 0,
    })

    if (!object.detected) return null
    if (!object.corners || object.corners.length !== 4) return null

    const corners = object.corners.map(c => ({ x: c.x, y: c.y })) as [
      ArucoCornerPx, ArucoCornerPx, ArucoCornerPx, ArucoCornerPx,
    ]

    // Validate convexity: cross products of consecutive edges should agree in sign.
    const isConvex = checkConvex(corners)
    if (!isConvex) return null

    const sides = [
      dist(corners[0], corners[1]),
      dist(corners[1], corners[2]),
      dist(corners[2], corners[3]),
      dist(corners[3], corners[0]),
    ]
    const avgSidePx = sides.reduce((s, v) => s + v, 0) / 4

    // Perspective tilt: ratio of opposite-side lengths. cosTilt = min/max ratio.
    const horizontalRatio = Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2])
    const verticalRatio = Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3])
    const cosTilt = Math.min(horizontalRatio, verticalRatio)

    const warnings: string[] = []
    if (avgSidePx < 20) warnings.push('Marker is very small (<20 px per side)')
    if (cosTilt < 0.6) warnings.push(`Strong perspective skew (cos θ = ${cosTilt.toFixed(2)})`)

    return {
      markerId: object.markerId ?? null,
      corners,
      avgSidePx,
      cosTilt,
      imageUrl: args.imageUrl,
      imageIndex: args.imageIndex,
      confidence: object.confidence ?? 0.5,
      warnings,
    }
  } catch {
    return null
  }
}

/**
 * Detect ArUco markers across all images in parallel. Returns one entry per
 * image where detection succeeded; absent indices simply did not have a
 * detectable marker.
 */
export async function detectArucoMarkersPerImage(
  imageUrls: string[],
): Promise<ArucoDetection[]> {
  if (!imageUrls || imageUrls.length === 0) return []
  const tasks = imageUrls.map((imageUrl, imageIndex) =>
    detectArucoMarker({ imageUrl, imageIndex }),
  )
  const results = await Promise.all(tasks)
  return results.filter((r): r is ArucoDetection => r != null)
}

function dist(a: ArucoCornerPx, b: ArucoCornerPx): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Convexity check via signs of cross products. A convex quadrilateral has all
 * four cross products of consecutive edge vectors with the same sign.
 */
function checkConvex(c: [ArucoCornerPx, ArucoCornerPx, ArucoCornerPx, ArucoCornerPx]): boolean {
  let lastSign = 0
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const cc = c[(i + 2) % 4]
    const v1x = b.x - a.x
    const v1y = b.y - a.y
    const v2x = cc.x - b.x
    const v2y = cc.y - b.y
    const cross = v1x * v2y - v1y * v2x
    if (cross === 0) continue
    const sign = cross > 0 ? 1 : -1
    if (lastSign !== 0 && sign !== lastSign) return false
    lastSign = sign
  }
  return true
}
