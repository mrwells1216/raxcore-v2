import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listLearningActions, reviewLearningAction, archiveLearningAction } from '@/lib/supervision/learning-actions'

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
  const actionType = searchParams.get('actionType') || undefined

  const actions = await listLearningActions({ 
    limit, 
    status: status as 'pending' | 'approved' | 'applied' | 'rejected' | undefined,
    actionType: actionType as string | undefined,
  })
  
  return NextResponse.json(actions)
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

  const body = await request.json()
  const { actionId, operation } = body

  if (!actionId) {
    return NextResponse.json({ error: 'actionId required' }, { status: 400 })
  }

  if (operation === 'apply') {
    await reviewLearningAction(actionId, 'approved', user.id, body.reason)
    return NextResponse.json({ success: true })
  } else if (operation === 'reject') {
    await reviewLearningAction(actionId, 'rejected', user.id, body.reason)
    return NextResponse.json({ success: true })
  } else if (operation === 'archive') {
    await archiveLearningAction(actionId)
    return NextResponse.json({ success: true })
  } else {
    return NextResponse.json({ error: 'Invalid operation. Use "apply", "reject", or "archive"' }, { status: 400 })
  }
}
