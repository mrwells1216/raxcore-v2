import 'server-only'
import { z } from 'zod'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import type {
  ArucoCalibrationInput,
  ArucoCorners,
  ArucoDetectionResult,
} from '@/lib/scoring/aruco-types'

const ArucoCornerSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const ArucoResponseSchema = z.object({
  detected: z.boolean(),
  markerId: z.number().nullable().optional(),
  dictionary: z.string().nullable().optional(),
  corners: z
    .object({
      topLeft: ArucoCornerSchema,
      topRight: ArucoCornerSchema,
      bottomRight: ArucoCornerSchema,
      bottomLeft: ArucoCornerSchema,
    })
    .nullable()
    .optional(),
})

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function cornersToScale(
  corners: ArucoCorners,
  markerSizeInches: number,
): { pixelsPerInch: number; sidePixels: number; sideVariance: number } | null {
  const sides = [
    dist(corners.topLeft, corners.topRight),
    dist(corners.topRight, corners.bottomRight),
    dist(corners.bottomRight, corners.bottomLeft),
    dist(corners.bottomLeft, corners.topLeft),
  ]
  if (sides.some((s) => !isFiniteNumber(s) || s <= 1)) return null

  const avgSide = sides.reduce((a, b) => a + b, 0) / 4
  const minSide = Math.min(...sides)
  const maxSide = Math.max(...sides)
  const sideVariance = (maxSide - minSide) / maxSide

  if (markerSizeInches <= 0) return null

  return {
    pixelsPerInch: avgSide / markerSizeInches,
    sidePixels: avgSide,
    sideVariance,
  }
}

function dataUrlFromBuffer(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

/**
 * GPT-4o based ArUco detection. Returns four-corner pixel coordinates.
 * Never throws — failure is reported via { detected: false, method: 'none' }.
 */
async function detectWithGpt4o(
  input: ArucoCalibrationInput,
): Promise<{
  detected: boolean
  markerId: number | null
  dictionary: string | null
  corners: ArucoCorners | null
}> {
  const prompt =
    `Look at this image carefully.\n` +
    `Is there an ArUco marker visible? ArUco markers are square black-and-white patterns used for computer vision calibration — ` +
    `they look like a small QR code with a thick black border and a unique binary pattern inside.\n\n` +
    `If you see one, return the pixel coordinates of all four corners in clockwise order ` +
    `(topLeft, topRight, bottomRight, bottomLeft). Use the image's pixel coordinate system ` +
    `(0,0 = top-left). The image is ${input.imageWidth}×${input.imageHeight} pixels.\n` +
    `Also estimate the marker dictionary (e.g. "DICT_4X4_50") and marker ID if recognisable.\n\n` +
    `If no ArUco marker is visible, return { "detected": false }.`

  const imageUrl = dataUrlFromBuffer(input.imageBuffer)

  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: ArucoResponseSchema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image' as const, image: imageUrl },
          { type: 'text' as const, text: prompt },
        ],
      },
    ],
    maxRetries: 0,
  })

  if (!object.detected || !object.corners) {
    return { detected: false, markerId: null, dictionary: null, corners: null }
  }
  return {
    detected: true,
    markerId: object.markerId ?? null,
    dictionary: object.dictionary ?? null,
    corners: object.corners,
  }
}

export async function detectArucoMarker(
  input: ArucoCalibrationInput,
): Promise<ArucoDetectionResult> {
  const baseFail: ArucoDetectionResult = {
    detected: false,
    markerId: null,
    dictionary: null,
    corners: null,
    sidePixels: null,
    pixelsPerInch: null,
    confidence: 0,
    method: 'none',
    warnings: [],
    markerSizeInches: input.markerSizeInches,
  }

  if (!process.env.OPENAI_API_KEY) {
    return { ...baseFail, warnings: ['OPENAI_API_KEY missing — ArUco detection skipped'] }
  }
  if (!isFiniteNumber(input.markerSizeInches) || input.markerSizeInches <= 0) {
    return { ...baseFail, warnings: ['Marker size not provided — ArUco detection skipped'] }
  }
  if (input.imageWidth <= 0 || input.imageHeight <= 0) {
    return { ...baseFail, warnings: ['Invalid image dimensions'] }
  }

  let raw: Awaited<ReturnType<typeof detectWithGpt4o>>
  try {
    raw = await detectWithGpt4o(input)
  } catch (err) {
    return {
      ...baseFail,
      warnings: [`GPT-4o detection threw: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  if (!raw.detected || !raw.corners) {
    return { ...baseFail, method: 'gpt4o' }
  }

  const scale = cornersToScale(raw.corners, input.markerSizeInches)
  if (!scale) {
    return {
      ...baseFail,
      method: 'gpt4o',
      detected: true,
      markerId: raw.markerId,
      dictionary: raw.dictionary,
      corners: raw.corners,
      warnings: ['Corner geometry invalid — could not derive scale'],
    }
  }

  // Confidence rules
  const warnings: string[] = []
  let confidence: number
  if (scale.sideVariance <= 0.10) {
    confidence = 0.72
  } else if (scale.sideVariance <= 0.25) {
    confidence = 0.62
  } else if (scale.sideVariance <= 0.40) {
    confidence = 0.55
    warnings.push(`Marker angled — sides differ by ${Math.round(scale.sideVariance * 100)}%`)
  } else {
    confidence = 0.35
    warnings.push(`Marker strongly angled or folded — sides differ by ${Math.round(scale.sideVariance * 100)}%`)
  }

  return {
    detected: true,
    markerId: raw.markerId,
    dictionary: raw.dictionary,
    corners: raw.corners,
    sidePixels: scale.sidePixels,
    pixelsPerInch: scale.pixelsPerInch,
    confidence,
    method: 'gpt4o',
    warnings,
    markerSizeInches: input.markerSizeInches,
  }
}
