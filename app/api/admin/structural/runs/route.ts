import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listStructuralRuns } from '@/lib/structural-hypothesis/service'

export const runtime = 'nodejs'

/**
 * GET /api/admin/structural/runs
 * List all structural hypothesis runs (admin only)
 */
export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const runs = await listStructuralRuns(200)
    return NextResponse.json({ runs })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list runs'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
