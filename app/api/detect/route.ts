import { NextResponse } from 'next/server'
import { detectRackWithOpenAI } from '@/lib/detection/detect-rack-with-openai'
import { buildMultiImageDetectionSummary } from '@/lib/detection/build-antler-graph'
import { uploadBuckImage } from '@/lib/storage/service'

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    // ── Multipart branch: images uploaded directly from the client pre-submit ──
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const tempId = `temp/${crypto.randomUUID()}`
      const imageUrls: string[] = []

      let index = 0
      while (true) {
        const entry = formData.get(`image_data_${index}`) as string | null
        if (!entry) break
        try {
          const url = await uploadBuckImage(tempId, entry, index)
          imageUrls.push(url)
        } catch (uploadErr) {
          console.warn(`[detect] temp upload failed for index ${index}`, uploadErr)
        }
        index++
      }

      if (!imageUrls.length) {
        return NextResponse.json(
          { error: 'No images could be uploaded for detection.' },
          { status: 400 },
        )
      }

      const analyses = await detectRackWithOpenAI(imageUrls)
      const summary = buildMultiImageDetectionSummary(analyses)
      return NextResponse.json(summary)
    }

    // ── JSON branch: remote imageUrls (server-to-server or admin use) ──
    const body = await req.json()
    const imageUrls = Array.isArray(body?.imageUrls) ? body.imageUrls : []

    if (!imageUrls.length) {
      return NextResponse.json(
        { error: 'At least one imageUrl is required.' },
        { status: 400 },
      )
    }

    const analyses = await detectRackWithOpenAI(imageUrls)
    const summary = buildMultiImageDetectionSummary(analyses)

    return NextResponse.json(summary)
  } catch (error) {
    console.error('[detect] failed', error)

    return NextResponse.json(
      {
        error: 'Detection failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
