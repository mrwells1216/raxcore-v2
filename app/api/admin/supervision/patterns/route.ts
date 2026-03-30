import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getHardCasePatterns, runPatternAnalysis } from '@/lib/supervision/hard-case-patterns'

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
  const status = searchParams.get('status') || undefined

  const patterns = await getHardCasePatterns({ 
    limit, 
    status: status as 'active' | 'resolved' | 'investigating' | undefined,
  })
  
  return NextResponse.json(patterns)
}

export async function POST(request: NextRequest) {
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

  // Trigger pattern analysis
  const body = await request.json()
  const result = await runPatternAnalysis({
    limit: body.limit || 100,
    lookbackDays: body.lookbackDays || 30,
  })
  
  return NextResponse.json(result)
}
