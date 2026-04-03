import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupervisionDashboardStats } from '@/lib/supervision/service'

export async function GET() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const metrics = await getSupervisionDashboardStats()
  return NextResponse.json(metrics)
}
