/**
 * POST /api/measure/refine-point
 *
 * Body: { imageDataUrl: string, point: { x: number; y: number } }
 *
 * Runs `refineSinglePoint` from `lib/scoring/subpixel-refine.ts` (Sobel +
 * Gaussian-2D / parabolic-fallback peak fit) against the decoded grayscale
 * image and returns the refined coordinate plus method and confidence.
 *
 * Best-effort: any decode/refinement failure returns the raw point with
 * `method: 'unchanged'`. Never 500s.
 */

import { NextResponse } from 'next/server'
import { decodeGrayscale, refineSinglePoint } from '@/lib/scoring/subpixel-refine'

export const runtime = 'nodejs'

interface RequestBody {
  imageDataUrl?: string
  point?: { x: unknown; y: unknown }
}

export async function POST(req: Request) {
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { imageDataUrl, point } = body
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  }
  if (
    !point ||
    typeof point.x !== 'number' ||
    typeof point.y !== 'number' ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return NextResponse.json({ error: 'invalid_point' }, { status: 400 })
  }

  const commaIdx = imageDataUrl.indexOf(',')
  if (commaIdx < 0) {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(imageDataUrl.substring(commaIdx + 1), 'base64')
  } catch {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  }

  const decoded = await decodeGrayscale(buffer)
  if (!decoded) {
    return NextResponse.json({
      x: point.x,
      y: point.y,
      method: 'unchanged',
      reason: 'decode_failed',
      refinementConfidence: 0.2,
      deltaPx: 0,
    })
  }

  const refined = refineSinglePoint(
    { id: 'measure', x: point.x, y: point.y },
    decoded.pixels,
    decoded.width,
    decoded.height,
  )

  return NextResponse.json({
    x: refined.x,
    y: refined.y,
    method: refined.method,
    reason: refined.reason ?? null,
    refinementConfidence: refined.refinementConfidence,
    deltaPx: refined.deltaPx,
  })
}
