import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/supabase/admin'
import { generateTrophyWatermark, TROPHY_WATERMARKS_BUCKET } from '@/lib/trophy-room/watermark'
import { getTrophyEntry, updateTrophyEntry } from '@/lib/trophy-room/service'

export const runtime = 'nodejs'
export const maxDuration = 60

const STUCK_AFTER_SECONDS = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entry = await getTrophyEntry(id, user.id)
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Soft lock: if status is 'generating' and updated_at is recent, refuse.
  if (entry.watermark_status === 'generating') {
    const stale = Date.now() - new Date(entry.updated_at).getTime() > STUCK_AFTER_SECONDS * 1000
    if (!stale) {
      return NextResponse.json({ error: 'Generation already in progress' }, { status: 409 })
    }
  }
  if (entry.watermark_status === 'ready' && entry.watermarked_url) {
    return NextResponse.json({ ok: true, watermarkedUrl: entry.watermarked_url })
  }

  await updateTrophyEntry(id, user.id, { watermark_status: 'generating' })

  try {
    const jpeg = await generateTrophyWatermark({
      sourceImageUrl: entry.display_photo_url,
      grossScore: entry.display_gross,
      netScore: entry.display_net,
      scoringSystem: entry.scoring_system,
      isVerified: entry.is_verified_score,
      buckName: entry.display_label,
    })

    const admin = await getServiceSupabase()
    const path = `${user.id}/${entry.id}.jpg`
    const { error: uploadErr } = await admin.storage
      .from(TROPHY_WATERMARKS_BUCKET)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

    const { data: publicData } = admin.storage.from(TROPHY_WATERMARKS_BUCKET).getPublicUrl(path)
    const watermarkedUrl = publicData?.publicUrl
    if (!watermarkedUrl) throw new Error('Failed to derive public URL')

    await updateTrophyEntry(id, user.id, {
      watermarked_url: watermarkedUrl,
      watermark_status: 'ready',
    })

    return NextResponse.json({ ok: true, watermarkedUrl })
  } catch (err) {
    console.error('[trophy-room/generate-watermark]', err)
    await updateTrophyEntry(id, user.id, { watermark_status: 'failed' })
    return NextResponse.json({ error: 'Watermark generation failed', details: String(err) }, { status: 500 })
  }
}
