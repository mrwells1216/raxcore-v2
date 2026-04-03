import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startStructuralSolving, checkStructuralSolvingTrigger } from '@/lib/structural-hypothesis/service'

export const runtime = 'nodejs'

/**
 * POST /api/structural/predictions/[predictionId]/solve
 * Start structural hypothesis solving for a prediction
 */
export async function POST(
  _: Request, 
  { params }: { params: Promise<{ predictionId: string }> }
) {
  const { predictionId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data?.user

  // Fetch prediction to check ownership
  const { data: prediction } = await supabase
    .from('predictions')
    .select('user_id')
    .eq('id', predictionId)
    .maybeSingle()

  const isDev =
    process.env.NODE_ENV === 'development' ||
    process.env.VERCEL_ENV === 'development'
  const isOwner = user?.id === prediction?.user_id

  if (!isOwner && !isDev) {
    console.warn('[structural-solve] blocked by auth', {
      predictionId,
      userId: user?.id ?? null,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isDev && !isOwner) {
    console.log('[structural-solve] DEV BYPASS enabled', {
      predictionId,
    })
  }

  try {
    const { run, jobId } = await startStructuralSolving({
      predictionId,
      requestedByUserId: user.id,
      analysisMode: 'structural',
    })
    
    return NextResponse.json({ 
      runId: run.id, 
      jobId,
      status: run.status,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to start structural solving'
    const status = message === 'Forbidden' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * GET /api/structural/predictions/[predictionId]/solve
 * Check if structural solving should be triggered for a prediction
 */
export async function GET(
  _: Request, 
  { params }: { params: Promise<{ predictionId: string }> }
) {
  const { predictionId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  
  if (!data?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkStructuralSolvingTrigger(predictionId)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to check trigger'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
