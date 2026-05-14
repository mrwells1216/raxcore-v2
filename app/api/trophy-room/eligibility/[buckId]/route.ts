import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkTrophyEligibility } from '@/lib/trophy-room/eligibility'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ buckId: string }> },
) {
  const { buckId } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const eligibility = await checkTrophyEligibility(buckId, user.id)
    return NextResponse.json(eligibility)
  } catch (err) {
    console.error('[trophy-room/eligibility]', err)
    return NextResponse.json({ error: 'Failed to compute eligibility' }, { status: 500 })
  }
}
