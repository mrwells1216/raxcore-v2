import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listSupervisionEvents } from '@/lib/supervision/service'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  
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

  const searchParams = request.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const eventType = searchParams.get('eventType') || undefined
  const severityLevel = searchParams.get('severityLevel') || undefined

  const events = await listSupervisionEvents({ 
    limit, 
    offset, 
    eventType: eventType as 'prediction' | 'validation' | 'pattern_detected' | 'action_applied' | undefined,
    severityLevel: severityLevel as 'info' | 'warning' | 'critical' | undefined,
  })
  
  return NextResponse.json(events)
}
