import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkTrophyEligibility } from '@/lib/trophy-room/eligibility'
import { createTrophyEntry, listTrophyEntries } from '@/lib/trophy-room/service'

export const runtime = 'nodejs'

const SCORING_SYSTEMS = ['bc_typical', 'bc_nontypical', 'py_typical', 'py_nontypical'] as const

const CreateSchema = z.object({
  buckId: z.string().uuid(),
  predictionId: z.string().uuid().nullable().optional(),
  displayPhotoUrl: z.string().url(),
  displayLabel: z.string().max(80).nullable().optional(),
  displayGross: z.number().finite(),
  displayNet: z.number().finite().nullable().optional(),
  scoringSystem: z.enum(SCORING_SYSTEMS),
  confidenceTier: z.string().max(40),
  isVerifiedScore: z.boolean().optional().default(false),
})

export async function GET(req: Request) {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 50) : 20

  try {
    const result = await listTrophyEntries(user.id, { limit, cursor })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[trophy-room GET]', err)
    return NextResponse.json({ error: 'Failed to list trophies' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof CreateSchema>
  try {
    const raw = await req.json()
    body = CreateSchema.parse(raw)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid body', details: String(err) }, { status: 400 })
  }

  // Server-side eligibility check — never trust the client claim
  const eligibility = await checkTrophyEligibility(body.buckId, user.id)
  if (!eligibility.eligible) {
    return NextResponse.json({ error: 'Buck not eligible for Trophy Room', reason: eligibility.reason }, { status: 403 })
  }

  // Verify the chosen photo is one of the candidate URLs for this buck
  if (!eligibility.candidatePhotoUrls.includes(body.displayPhotoUrl)) {
    return NextResponse.json({ error: 'Display photo must be one of the buck\'s images' }, { status: 400 })
  }

  // Use server-verified eligibility values rather than client claims
  const entry = await createTrophyEntry({
    userId: user.id,
    buckId: body.buckId,
    predictionId: body.predictionId ?? eligibility.predictionId,
    displayPhotoUrl: body.displayPhotoUrl,
    displayLabel: body.displayLabel ?? null,
    displayGross: body.displayGross,
    displayNet: body.displayNet ?? null,
    scoringSystem: body.scoringSystem,
    confidenceTier: eligibility.suggestedConfidenceTier ?? body.confidenceTier,
    isVerifiedScore: eligibility.isVerifiedScore,
  })

  // Kick off watermark generation (fire-and-forget — client polls for status)
  const origin = new URL(req.url).origin
  fetch(`${origin}/api/trophy-room/${entry.id}/generate-watermark`, {
    method: 'POST',
    headers: { cookie: req.headers.get('cookie') ?? '' },
  }).catch(err => console.warn('[trophy-room] watermark trigger failed', err))

  return NextResponse.json(entry, { status: 201 })
}
