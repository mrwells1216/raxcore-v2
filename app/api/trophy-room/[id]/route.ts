import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getTrophyEntry, softDeleteTrophyEntry, updateTrophyEntry } from '@/lib/trophy-room/service'

export const runtime = 'nodejs'

const PatchSchema = z.object({
  displayLabel: z.string().max(80).nullable().optional(),
  displayPhotoUrl: z.string().url().optional(),
})

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entry = await getTrophyEntry(id, user.id)
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof PatchSchema>
  try {
    body = PatchSchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json({ error: 'Invalid body', details: String(err) }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (body.displayLabel !== undefined) patch.display_label = body.displayLabel
  if (body.displayPhotoUrl !== undefined) {
    patch.display_photo_url = body.displayPhotoUrl
    patch.watermark_status = 'pending'
    patch.watermarked_url = null
  }

  const updated = await updateTrophyEntry(id, user.id, patch)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.displayPhotoUrl !== undefined) {
    const origin = new URL(req.url).origin
    fetch(`${origin}/api/trophy-room/${id}/generate-watermark`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    }).catch(err => console.warn('[trophy-room] watermark regen trigger failed', err))
  }

  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await softDeleteTrophyEntry(id, user.id)
  if (!ok) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
