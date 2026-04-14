import { NextResponse } from 'next/server'
import { detectRackWithOpenAI } from '@/lib/detection/detect-rack-with-openai'
import { buildMultiImageDetectionSummary } from '@/lib/detection/build-antler-graph'

export async function POST(req: Request) {
  try {
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
