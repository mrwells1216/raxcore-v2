import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startPrecisionPass } from '@/lib/reverse-engineering/service'

export const runtime = 'nodejs'

// Check for development: NODE_ENV=development OR Vercel preview (not production deployment)
const IS_DEV = process.env.NODE_ENV === 'development' || 
  process.env.VERCEL_ENV === 'preview' || 
  process.env.VERCEL_ENV === 'development'
// Dev bypass user ID for anonymous precision passes in development
const DEV_ANON_USER_ID = 'dev-anonymous-user'

/**
 * POST /api/reverse/predictions/[predictionId]/precision-pass
 * Start a precision pass for a prediction
 */
export async function POST(
  _: Request, 
  { params }: { params: Promise<{ predictionId: string }> }
) {
  const { predictionId } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  
  // In development, allow anonymous access; in production, require auth
  if (!user && !IS_DEV) {
    console.error('[precision-pass] Unauthorized: no user and not in dev mode')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requesterId = user?.id ?? DEV_ANON_USER_ID

  try {
    console.log('[precision-pass] Starting precision pass', {
      predictionId,
      requesterId,
      isDev: IS_DEV,
      hasUser: !!user,
    })

    const { run, jobId } = await startPrecisionPass({
      predictionId,
      requestedByUserId: requesterId,
    })
    
    console.log('[precision-pass] Precision pass started', {
      runId: run.id,
      jobId,
      status: run.status,
    })

    return NextResponse.json({ 
      runId: run.id, 
      jobId,
      status: run.status,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to start precision pass'
    const stack = e instanceof Error ? e.stack : undefined
    console.error('[precision-pass] Failed to start precision pass', {
      predictionId,
      requesterId,
      error: message,
      stack,
    })
    const status = message === 'Forbidden' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
