import { NextResponse } from 'next/server'
import { listHistory } from '@/lib/storage/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/recent
 * Slim list of recently scored bucks for the RAXrs rescore picker.
 * Public (matches the Classroom tab access). Best-effort — never 500s.
 */
export async function GET() {
  try {
    const { data } = await listHistory({ limit: 24, offset: 0 })
    const bucks = data
      .map((b) => {
        const pred = b.predictions?.[0]
        const images = (b.buck_images ?? [])
          .map((img) => (img as { public_url?: string | null; image_url?: string | null }).public_url
            ?? (img as { public_url?: string | null; image_url?: string | null }).image_url
            ?? null)
          .filter((u): u is string => !!u)
        return {
          buckId: b.id,
          nickname: b.nickname ?? null,
          state: b.state ?? null,
          rackType: (b.rack_type as string) ?? 'typical',
          createdAt: b.created_at ?? null,
          predictionId: pred?.id ?? null,
          predictedGross:
            typeof pred?.predicted_gross === 'number' ? pred.predicted_gross : null,
          imageUrls: images,
          thumbnail: images[0] ?? null,
        }
      })
      .filter((b) => b.predictedGross != null && b.imageUrls.length > 0)
    return NextResponse.json({ bucks })
  } catch (err) {
    console.warn('[classroom/recent] failed (non-blocking):', err)
    return NextResponse.json({ bucks: [] })
  }
}
