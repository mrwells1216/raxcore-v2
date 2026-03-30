import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStructuralRunDetail } from '@/lib/structural-hypothesis/service'

export const runtime = 'nodejs'

/**
 * GET /api/structural/runs/[runId]
 * Get detailed structural run information
 */
export async function GET(
  _: Request, 
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  
  if (!data?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const detail = await getStructuralRunDetail(runId)
    
    // Check authorization
    if (detail.run.requested_by_user_id !== data.user.id) {
      // Check if admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()
      
      if (profile?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    
    return NextResponse.json(detail)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to get run detail'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
