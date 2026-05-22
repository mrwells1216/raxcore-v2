import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { refineReferenceEndpoints } from '@/lib/advanced-scoring/subpixel-refine'

export const runtime = 'nodejs'

interface RequestBody {
  imageDataUrl?: string
  points?: Array<{ x: unknown; y: unknown }>
}

/**
 * POST /api/measure/refine-reference
 *
 * Body: { imageDataUrl: string, points: [{x,y}, {x,y}] }
 *   imageDataUrl — base64-encoded data URL of the photo the user just
 *                  calibrated. The photo already lives in the browser
 *                  (measure-store.photoDataUrl), so re-uploading it for
 *                  the refinement is the simplest available path. The
 *                  alternative — persisting the photo to a bucket first —
 *                  would force a much larger refactor of the calibration
 *                  flow.
 *
 * Returns { endpoints, lineQuality, lengthDelta } — see
 * `lib/advanced-scoring/subpixel-refine.ts`.
 *
 * Failure modes (silent — never 500):
 *   - missing/invalid body  → 400 with a short reason; UI keeps raw points
 *   - decode failure        → 200 with method='unchanged' on both endpoints
 *   - low edge contrast     → 200 with lineQuality < 0.25; UI keeps raw points
 */
export async function POST(req: Request) {
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { imageDataUrl, points } = body
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  }
  if (!Array.isArray(points) || points.length !== 2) {
    return NextResponse.json({ error: 'invalid_points' }, { status: 400 })
  }
  const [pa, pb] = points
  if (
    typeof pa?.x !== 'number' ||
    typeof pa?.y !== 'number' ||
    typeof pb?.x !== 'number' ||
    typeof pb?.y !== 'number'
  ) {
    return NextResponse.json({ error: 'invalid_points' }, { status: 400 })
  }

  const commaIdx = imageDataUrl.indexOf(',')
  if (commaIdx < 0) {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  }
  let buffer: Buffer
  try {
    buffer = Buffer.from(imageDataUrl.slice(commaIdx + 1), 'base64')
  } catch {
    return NextResponse.json({ error: 'invalid_image_base64' }, { status: 400 })
  }

  let width: number
  let height: number
  try {
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) {
      return NextResponse.json({ error: 'invalid_image_dimensions' }, { status: 400 })
    }
    width = meta.width
    height = meta.height
  } catch {
    return NextResponse.json({ error: 'image_decode_failed' }, { status: 400 })
  }

  try {
    const result = await refineReferenceEndpoints({
      imageBuffer: buffer,
      imageWidth: width,
      imageHeight: height,
      endpoints: [
        { x: pa.x, y: pa.y },
        { x: pb.x, y: pb.y },
      ],
    })
    return NextResponse.json(result)
  } catch (err) {
    // The lib is built to never throw, but defense-in-depth: a thrown
    // error here is not a 500 — the UI just keeps the user's raw points.
    console.warn('[refine-reference] unexpected error', err)
    return NextResponse.json(
      {
        endpoints: [
          { x: pa.x, y: pa.y, refinementConfidence: 0.2, method: 'unchanged', reason: 'server_error' },
          { x: pb.x, y: pb.y, refinementConfidence: 0.2, method: 'unchanged', reason: 'server_error' },
        ],
        lineQuality: 0,
        lengthDelta: 0,
      },
      { status: 200 },
    )
  }
}
