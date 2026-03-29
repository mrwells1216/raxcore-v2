import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCaseTimeline } from '@/lib/supervision/service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ buckId: string }> }
) {
  const supabase = await createClient()
  const { buckId } = await params
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const timeline = await getCaseTimeline(buckId)
  return NextResponse.json(timeline)
}
